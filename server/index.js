/**
 * سرور نرم‌افزار آرشیو — بدون هیچ وابستگی خارجی
 * اجرا:  npm start   سپس مرورگر:  http://localhost:7788
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, stat as fstat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize as pathNormalize, sep } from 'node:path';
import { db, getSetting, setSetting, checkpoint, ROOT, DATA_DIR, BACKUP_DIR, DB_PATH } from './db.js';
import * as repo from './repo.js';
import { scanFolder, probeDurations, hasFfprobe } from './scan.js';
import { createBackup, listBackups, pruneBackups, verifyBackup, restoreBackup, buildPayload, stamp } from './backup.js';
import { todayJalali, nowJalaliDateTime } from '../public/lib/jalali.js';

const PORT = Number(process.env.PORT || 7788);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/* ------------------------------------------------------------- ابزارها */

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, text, contentType, status = 200, extraHeaders = {}) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': body.length, ...extraHeaders });
  res.end(body);
}

async function readBody(req, limitBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('حجم درخواست بیش از حد مجاز است');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw new Error('قالب JSON درخواست معتبر نیست'); }
}

const actorOf = (req) => req.headers['x-archive-user'] ? decodeURIComponent(req.headers['x-archive-user']) : null;

/** آیا درخواست از روی همین رایانه آمده است؟ */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

/** تبدیل پارامترهای آدرس به شیء ساده */
function queryOf(url) {
  const out = {};
  for (const [k, v] of url.searchParams) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] ||= []).push(v);
    } else out[k] = v;
  }
  return out;
}

/* --------------------------------------------------------- فایل‌های ثابت */

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // جلوگیری از خروج از پوشهٔ public
  const safe = pathNormalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== join(PUBLIC_DIR, 'index.html')) {
    return sendText(res, 'دسترسی مجاز نیست', 'text/plain; charset=utf-8', 403);
  }
  if (!existsSync(filePath)) {
    // مسیرهای داخلی برنامه به صفحهٔ اصلی هدایت می‌شوند
    if (!extname(safe)) return serveStatic(req, res, '/index.html');
    return sendText(res, 'یافت نشد', 'text/plain; charset=utf-8', 404);
  }
  const data = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

/* ------------------------------------------------------------ مسیرهای API */

async function handleApi(req, res, url) {
  const method = req.method;
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const q = queryOf(url);
  const actor = actorOf(req);
  const seg = path.split('/').filter(Boolean);          // مثال: ['items','12']
  const id = seg[1] && /^\d+$/.test(seg[1]) ? Number(seg[1]) : null;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

  switch (seg[0]) {
    /* ---------------------------------------------------------- راه‌اندازی */
    case 'bootstrap':
      return sendJson(res, {
        drives: repo.listDrives(),
        categories: repo.listCategories(),
        speakers: repo.listSpeakers(),
        tags: repo.listTags(),
        settings: Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])),
        facets: facets(),
        today: todayJalali(),
        next_codes: { item: repo.nextItemCode(), drive: repo.nextDriveCode() },
      });

    case 'stats':
      return sendJson(res, repo.stats());

    /* -------------------------------------------------------------- آیتم‌ها */
    case 'items': {
      if (method === 'GET' && id) {
        const item = repo.getItem(id);
        return item ? sendJson(res, item) : sendJson(res, { error: 'آیتم یافت نشد' }, 404);
      }
      if (method === 'GET') return sendJson(res, repo.listItems(q));
      if (method === 'POST' && seg[1] === 'bulk') return sendJson(res, bulkUpdate(body, actor));
      if (method === 'POST' && seg[1] === 'batch') {
        const created = repo.createBatch(body, actor);
        return sendJson(res, { ok: true, created: created.length, items: created }, 201);
      }
      if (method === 'POST') return sendJson(res, repo.saveItem(body, actor), 201);
      if (method === 'PUT' && id) return sendJson(res, repo.saveItem({ ...body, id }, actor));
      if (method === 'POST' && seg[2] === 'restore') return sendJson(res, repo.restoreItem(id, actor));
      if (method === 'DELETE' && id) {
        const soft = q.soft === '1';
        return sendJson(res, { ok: repo.deleteItem(id, actor, { soft }) });
      }
      break;
    }

    case 'restore': {   // POST /api/restore/:id  — بازگردانی از بایگانی
      if (method === 'POST' && id) return sendJson(res, repo.restoreItem(id, actor));
      break;
    }

    /* --------------------------------------------------------------- نسخه‌ها */
    case 'copies': {
      if (method === 'POST') return sendJson(res, repo.saveCopy(body, actor), 201);
      if (method === 'PUT' && id) return sendJson(res, repo.saveCopy({ ...body, id }, actor));
      if (method === 'DELETE' && id) return sendJson(res, { ok: repo.deleteCopy(id, actor) });
      break;
    }

    /* ---------------------------------------------------------------- هاردها */
    case 'drives': {
      if (method === 'GET' && id) {
        const d = repo.getDrive(id);
        return d ? sendJson(res, d) : sendJson(res, { error: 'هارد یافت نشد' }, 404);
      }
      if (method === 'GET') return sendJson(res, repo.listDrives(q));
      if (method === 'POST') return sendJson(res, repo.saveDrive(body, actor), 201);
      if (method === 'PUT' && id) return sendJson(res, repo.saveDrive({ ...body, id }, actor));
      if (method === 'DELETE' && id) return sendJson(res, { ok: repo.deleteDrive(id, actor) });
      break;
    }

    /* ------------------------------------------------------------ دسته‌بندی */
    case 'categories': {
      if (method === 'GET') return sendJson(res, repo.listCategories());
      if (method === 'POST') return sendJson(res, repo.saveCategory(body, actor), 201);
      if (method === 'PUT' && id) return sendJson(res, repo.saveCategory({ ...body, id }, actor));
      if (method === 'DELETE' && id) return sendJson(res, { ok: repo.deleteCategory(id, actor) });
      break;
    }

    /* --------------------------------------------------------------- اشخاص */
    case 'speakers': {
      if (method === 'GET') return sendJson(res, repo.listSpeakers());
      if (method === 'POST') return sendJson(res, repo.saveSpeaker(body, actor), 201);
      if (method === 'PUT' && id) return sendJson(res, repo.saveSpeaker({ ...body, id }, actor));
      if (method === 'DELETE' && id) return sendJson(res, { ok: repo.deleteSpeaker(id, actor) });
      break;
    }

    /* ------------------------------------------------------------- برچسب‌ها */
    case 'tags': {
      if (method === 'GET') return sendJson(res, repo.listTags());
      if (method === 'POST') return sendJson(res, repo.ensureTag(body.name, body.color), 201);
      if (method === 'DELETE' && id) return sendJson(res, { ok: repo.deleteTag(id, actor) });
      break;
    }

    /* -------------------------------------------------------------- گزارش‌ها */
    case 'reports': {
      const name = seg[1];
      if (repo.reports[name]) return sendJson(res, repo.reports[name]());
      return sendJson(res, { error: 'گزارش ناشناخته', available: Object.keys(repo.reports) }, 404);
    }

    /* ------------------------------------------------------------- رویدادها */
    case 'activity':
      return sendJson(res, db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?')
        .all(Math.min(Number(q.limit) || 100, 1000)));

    /* -------------------------------------------------------------- تنظیمات */
    case 'settings': {
      if (method === 'GET') {
        return sendJson(res, Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])));
      }
      if (method === 'PUT' || method === 'POST') {
        for (const [k, v] of Object.entries(body)) setSetting(k, v);
        repo.log('system', null, 'update', 'تنظیمات به‌روزرسانی شد', actor);
        return sendJson(res, { ok: true });
      }
      break;
    }

    /* ------------------------------------------------------- پویش پوشه */
    case 'scan': {
      // خواندن پوشه‌های رایانه تنها از روی همین دستگاه مجاز است.
      // اگر برنامه با HOST=0.0.0.0 روی شبکه باز شده باشد، این مسیر بسته می‌ماند.
      if (!isLoopback(req)) {
        return sendJson(res, {
          error: 'پویش پوشه فقط از روی همین رایانه امکان‌پذیر است، نه از راه شبکه.',
        }, 403);
      }
      if (seg[1] === 'tools') return sendJson(res, { ffprobe: await hasFfprobe() });
      if (method !== 'POST') break;

      const result = await scanFolder({
        path: body.path,
        recursive: !!body.recursive,
        kinds: Array.isArray(body.kinds) && body.kinds.length ? body.kinds : null,
      });

      // مشخص کردن فایل‌هایی که پیش‌تر ثبت شده‌اند تا دوباره ثبت نشوند
      const registered = repo.findRegisteredFiles(body.drive_id, result.files);
      for (const f of result.files) {
        f.registered = registered[`${f.folder_path}|${f.file_name}`] || null;
      }

      // خواندن مدت زمان — تنها اگر کاربر خواسته باشد و ابزار موجود باشد
      let durations = null;
      if (body.with_duration) {
        durations = await probeDurations(result.files.map((f) => f.full_path));
        if (durations) for (const f of result.files) f.duration_sec = durations[f.full_path] ?? null;
      }

      return sendJson(res, {
        ...result,
        ffprobe: await hasFfprobe(),
        duration_read: !!durations,
        registered_count: Object.keys(registered).length,
      });
    }

    /* ---------------------------------------------------- خروجی و پشتیبان */
    case 'export': {
      if (seg[1] === 'json') {
        const payload = JSON.stringify(buildPayload(), null, 2);
        return sendText(res, payload, 'application/json; charset=utf-8', 200,
          { 'Content-Disposition': `attachment; filename="archive-backup-${stamp()}.json"` });
      }
      if (seg[1] === 'csv') {
        return sendText(res, repo.exportItemsCsv(q), 'text/csv; charset=utf-8', 200,
          { 'Content-Disposition': `attachment; filename="archive-items-${stamp()}.csv"` });
      }
      break;
    }

    case 'import': {
      if (seg[1] === 'verify' && method === 'POST') {
        return sendJson(res, verifyBackup(body));
      }
      if (method === 'POST') {
        try {
          const result = await restoreBackup(body, actor);
          return sendJson(res, result);
        } catch (e) {
          return sendJson(res, { error: e.message, verification: e.verification || null }, 400);
        }
      }
      break;
    }

    case 'backup': {
      if (method === 'GET') return sendJson(res, await listBackups());
      if (method === 'POST') {
        const info = await createBackup({ actor });
        await pruneBackups();
        return sendJson(res, info);
      }
      if (method === 'DELETE' && seg[1]) {
        const name = decodeURIComponent(seg[1]);
        if (!/^[\w.\-]+\.json$/.test(name)) return sendJson(res, { error: 'نام فایل نامعتبر' }, 400);
        await unlink(join(BACKUP_DIR, name));
        return sendJson(res, { ok: true });
      }
      break;
    }

    case 'maintenance': {
      if (seg[1] === 'rebuild-search' && method === 'POST') {
        const n = repo.rebuildAllSearchBlobs();
        return sendJson(res, { ok: true, rebuilt: n });
      }
      if (seg[1] === 'vacuum' && method === 'POST') {
        db.exec('VACUUM');
        return sendJson(res, { ok: true });
      }
      if (seg[1] === 'info') {
        const size = existsSync(DB_PATH) ? (await fstat(DB_PATH)).size : 0;
        return sendJson(res, {
          db_path: DB_PATH, db_size_mb: +(size / 1048576).toFixed(2),
          data_dir: DATA_DIR, backup_dir: BACKUP_DIR,
          node: process.version, today: todayJalali(),
        });
      }
      break;
    }
  }
  return sendJson(res, { error: 'مسیر یافت نشد', path, method }, 404);
}

/* ------------------------------------------------- مقادیر یکتا برای پالایه */

function facets() {
  const distinct = (col) => db.prepare(
    `SELECT DISTINCT ${col} AS v FROM items WHERE archived=0 AND IFNULL(${col},'') <> '' ORDER BY v`).all().map((r) => r.v);
  return {
    series: distinct('series'),
    occasions: distinct('occasion'),
    cities: distinct('city'),
    places: distinct('event_place'),
    sources: distinct('source'),
    contributors: distinct('contributor'),
    registrars: distinct('registered_by'),
    languages: distinct('language'),
    years: db.prepare(`SELECT DISTINCT SUBSTR(speech_date,1,4) AS v FROM items
        WHERE archived=0 AND speech_date IS NOT NULL ORDER BY v`).all().map((r) => r.v),
  };
}

/* ------------------------------------------------------- عملیات گروهی */

function bulkUpdate({ ids = [], patch = {}, action }, actor) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'هیچ آیتمی انتخاب نشده' };
  let n = 0;
  for (const rawId of ids) {
    const itemId = Number(rawId);
    const current = repo.getItem(itemId);
    if (!current) continue;
    if (action === 'delete') { repo.deleteItem(itemId, actor, { soft: true }); n++; continue; }
    if (action === 'restore') { repo.restoreItem(itemId, actor); n++; continue; }
    if (action === 'purge') { repo.deleteItem(itemId, actor, { soft: false }); n++; continue; }
    // ویرایش گروهی فیلدها؛ برچسب‌ها در حالت افزودن عمل می‌کنند
    const next = { ...current, ...patch, id: itemId };
    if (patch.add_tags) {
      next.tags = [...new Set([...(current.tags || []).map((t) => t.name), ...patch.add_tags])];
      delete next.add_tags;
    } else {
      next.tags = (current.tags || []).map((t) => t.name);
    }
    next.copies = undefined;             // نسخه‌ها در ویرایش گروهی دست‌نخورده می‌مانند
    next.defect_flags = patch.defect_flags ?? current.defect_list ?? [];
    repo.saveItem(next, actor);
    n++;
  }
  repo.log('item', null, 'update', `عملیات گروهی روی ${n} آیتم (${action || 'ویرایش'})`, actor);
  return { ok: true, affected: n };
}

/* -------------------------------------------------------------- پشتیبان */

/* ------------------------------------------------------------- راه‌اندازی */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      // فقط درخواست‌های محلی — این برنامه برای استفادهٔ شخصی روی رایانهٔ شماست
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET') return sendText(res, 'روش پشتیبانی نمی‌شود', 'text/plain; charset=utf-8', 405);
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[خطا]', err);
    return sendJson(res, { error: err.message || 'خطای داخلی سرور' }, 500);
  }
});

repo.seedIfEmpty();

// پشتیبان‌گیری خودکار روزانه (اگر فعال باشد)
if (getSetting('auto_backup', '1') === '1') {
  const DAY = 24 * 60 * 60 * 1000;
  setInterval(() => {
    createBackup({ actor: 'پشتیبان‌گیری خودکار' }).then(pruneBackups).catch(() => {});
  }, DAY).unref();
}

server.listen(PORT, HOST, () => {
  const title = getSetting('archive_title', 'آرشیو');
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n  ${title}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  آمادهٔ استفاده:  ${url}`);
  console.log(`  پایگاه داده:     ${DB_PATH}`);
  console.log(`  پشتیبان‌ها:      ${BACKUP_DIR}`);
  console.log(`  برای توقف: Ctrl+C\n`);
  if (process.env.ARCHIVE_NO_OPEN !== '1') openBrowser(url);
});

/** باز کردن خودکار مرورگر — برای اینکه کاربر نیازی به تایپ نشانی نداشته باشد */
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* اگر باز نشد، کاربر نشانی بالا را دستی باز می‌کند */ });
    child.unref();
  } catch { /* نادیده */ }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    // نوشته‌های معلق به فایل اصلی منتقل می‌شوند تا archive.db همیشه کامل باشد
    try { checkpoint(); } catch { /* نادیده */ }
    try { db.close(); } catch { /* نادیده */ }
    process.exit(0);
  });
}
