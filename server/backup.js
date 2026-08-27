/**
 * پشتیبان‌گیری، بررسی سلامت و بازیابی — برای انتقال آرشیو به رایانهٔ دیگر
 *
 * هم از داخل نرم‌افزار استفاده می‌شود و هم به‌تنهایی از خط فرمان:
 *
 *   npm run backup                          ساخت پشتیبان تازه
 *   npm run backup -- --out "E:\\Flash"      ذخیره روی فلش یا هارد
 *   npm run backup -- --list                فهرست پشتیبان‌های موجود
 *   npm run backup -- --verify <فایل>       بررسی سالم بودن یک فایل پشتیبان
 *   npm run backup -- --restore <فایل>      بازیابی از یک فایل پشتیبان
 */
import { writeFile, readFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { db, checkpoint, getSetting, BACKUP_DIR, DB_PATH } from './db.js';
import * as repo from './repo.js';
import { todayJalali, nowJalaliDateTime } from '../public/lib/jalali.js';

/** جدول‌هایی که یک پشتیبان کامل باید داشته باشد */
const REQUIRED_TABLES = ['drives', 'categories', 'speakers', 'tags', 'items', 'copies', 'item_tags'];

/** مهر زمانی برای نام فایل: 1405-06-05_1432 */
export const stamp = () =>
  todayJalali().replace(/\//g, '-') + '_' + new Date().toISOString().slice(11, 16).replace(':', '');

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/* ============================================================ ساخت پشتیبان */

/** محتوای پشتیبان به‌همراه اثر انگشت، برای تشخیص فایل خراب یا دست‌کاری‌شده */
export function buildPayload() {
  checkpoint();                       // نوشته‌های معلق WAL وارد فایل اصلی شوند
  const payload = repo.exportAll();
  const { meta, ...data } = payload;
  return { meta: { ...meta, checksum: sha256(JSON.stringify(data)) }, ...data };
}

/**
 * ساخت فایل پشتیبان
 * @param {{dir?: string, name?: string, actor?: string}} options
 */
export async function createBackup({ dir = BACKUP_DIR, name, actor } = {}) {
  const payload = buildPayload();
  const target = resolve(dir);
  if (!existsSync(target)) await mkdir(target, { recursive: true });

  const fileName = name || `backup-${stamp()}.json`;
  const filePath = join(target, fileName);
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  const info = await stat(filePath);
  repo.log('system', null, 'backup', `پشتیبان «${fileName}» ساخته شد`, actor);
  return {
    ok: true,
    name: fileName,
    path: filePath,
    size_kb: Math.round(info.size / 1024),
    at: nowJalaliDateTime(),
    counts: payload.meta.counts,
  };
}

/** نگه داشتن تنها N پشتیبان تازه در پوشهٔ پیش‌فرض */
export async function pruneBackups(keep = Number(getSetting('backup_keep', '30'))) {
  const files = await listBackups();
  for (const f of files.slice(keep)) {
    try { await unlink(join(BACKUP_DIR, f.name)); } catch { /* نادیده */ }
  }
}

export async function listBackups(dir = BACKUP_DIR) {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const name of names) {
    const s = await stat(join(dir, name));
    out.push({ name, size_kb: Math.round(s.size / 1024), mtime: s.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/* ========================================================== بررسی سلامت */

/**
 * بررسی می‌کند یک فایل پشتیبان سالم و کامل است یا نه.
 * پیش از پاک کردن داده‌های فعلی حتماً صدا زده می‌شود.
 */
export function verifyBackup(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['این فایل یک پشتیبان معتبر نیست.'], warnings: [], counts: null };
  }

  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(payload[table])) errors.push(`بخش «${table}» در فایل نیست یا خراب است.`);
  }
  if (errors.length) return { ok: false, errors, warnings, counts: null };

  // اثر انگشت — فایل‌های قدیمی‌تر آن را ندارند و این ایراد نیست
  const { meta, ...data } = payload;
  if (meta?.checksum) {
    if (sha256(JSON.stringify(data)) !== meta.checksum) {
      errors.push('اثر انگشت فایل با محتوای آن نمی‌خواند؛ فایل ناقص یا دست‌کاری شده است.');
    }
  } else {
    warnings.push('این پشتیبان اثر انگشت ندارد (ساختهٔ نسخهٔ قدیمی‌تر برنامه است).');
  }

  // یکپارچگی ارجاع‌ها
  const itemIds = new Set(payload.items.map((r) => r.id));
  const driveIds = new Set(payload.drives.map((r) => r.id));
  const orphanCopies = payload.copies.filter((c) => c.item_id != null && !itemIds.has(c.item_id)).length;
  const lostDrives = payload.copies.filter((c) => c.drive_id != null && !driveIds.has(c.drive_id)).length;
  if (orphanCopies) warnings.push(`${orphanCopies} نسخه به رکوردی اشاره می‌کند که در فایل نیست.`);
  if (lostDrives) warnings.push(`${lostDrives} نسخه به هاردی اشاره می‌کند که در فایل نیست.`);

  const counts = {
    items: payload.items.length,
    drives: payload.drives.length,
    copies: payload.copies.length,
    categories: payload.categories.length,
    speakers: payload.speakers.length,
    tags: payload.tags.length,
  };
  if (!counts.items && !counts.drives) warnings.push('این پشتیبان هیچ رکورد و هاردی ندارد.');

  return { ok: errors.length === 0, errors, warnings, counts, exported_at: meta?.exported_at || null };
}

/* ============================================================== بازیابی */

/**
 * بازیابی از یک فایل پشتیبان.
 * پیش از پاک کردن داده‌های فعلی، خودکار یک پشتیبان ایمنی گرفته می‌شود
 * تا اگر کاربر اشتباه کرد، راه برگشت داشته باشد.
 */
export async function restoreBackup(payload, actor) {
  const check = verifyBackup(payload);
  if (!check.ok) {
    const err = new Error('فایل پشتیبان سالم نیست:\n' + check.errors.join('\n'));
    err.verification = check;
    throw err;
  }

  let safety = null;
  const hasData = db.prepare('SELECT COUNT(*) AS c FROM items').get().c > 0
    || db.prepare('SELECT COUNT(*) AS c FROM drives').get().c > 0;
  if (hasData) {
    safety = await createBackup({ name: `پیش-از-بازیابی-${stamp()}.json`, actor });
  }

  const result = repo.importAll(payload, actor);
  return { ok: true, ...result, safety_backup: safety?.name || null, warnings: check.warnings };
}

/* ============================================================= خط فرمان */

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
  };

  const run = async () => {
    if (flag('--help')) {
      console.log(`
  پشتیبان‌گیری آرشیو

    npm run backup                        ساخت پشتیبان تازه در پوشهٔ backups
    npm run backup -- --out "E:\\Flash"    ساخت پشتیبان در مسیر دلخواه
    npm run backup -- --list              فهرست پشتیبان‌های موجود
    npm run backup -- --verify <فایل>     بررسی سالم بودن یک فایل پشتیبان
    npm run backup -- --restore <فایل>    بازیابی از یک فایل پشتیبان
`);
      return;
    }

    if (flag('--list')) {
      const files = await listBackups();
      if (!files.length) return console.log('\n  هنوز پشتیبانی ساخته نشده است.\n');
      console.log(`\n  ${files.length} پشتیبان در ${BACKUP_DIR}\n`);
      for (const f of files) {
        console.log(`   ${f.name}   ${String(f.size_kb).padStart(6)} کیلوبایت   ${new Date(f.mtime).toLocaleString('fa-IR')}`);
      }
      console.log('');
      return;
    }

    const verifyPath = flag('--verify');
    if (typeof verifyPath === 'string') {
      const payload = JSON.parse(await readFile(resolve(verifyPath), 'utf8'));
      const check = verifyBackup(payload);
      console.log(`\n  بررسی «${basename(verifyPath)}»`);
      console.log(`  ${check.ok ? '✓ فایل سالم است' : '✗ فایل مشکل دارد'}`);
      if (check.counts) {
        console.log(`  محتوا: ${check.counts.items} رکورد، ${check.counts.drives} هارد، ${check.counts.copies} نسخه`);
      }
      for (const e of check.errors) console.log('   ✗ ' + e);
      for (const w of check.warnings) console.log('   ! ' + w);
      console.log('');
      process.exitCode = check.ok ? 0 : 1;
      return;
    }

    const restorePath = flag('--restore');
    if (typeof restorePath === 'string') {
      const payload = JSON.parse(await readFile(resolve(restorePath), 'utf8'));
      const check = verifyBackup(payload);
      if (!check.ok) {
        console.log('\n  ✗ بازیابی انجام نشد؛ فایل سالم نیست:');
        for (const e of check.errors) console.log('    - ' + e);
        console.log('');
        process.exitCode = 1;
        return;
      }
      console.log(`\n  در حال بازیابی ${check.counts.items} رکورد و ${check.counts.drives} هارد…`);
      const res = await restoreBackup(payload, 'خط فرمان');
      console.log(`  ✓ بازیابی انجام شد.`);
      if (res.safety_backup) console.log(`  از وضعیت پیشین پشتیبان گرفته شد: ${res.safety_backup}`);
      for (const w of res.warnings) console.log('   ! ' + w);
      console.log('');
      return;
    }

    // حالت پیش‌فرض: ساخت پشتیبان
    const outDir = flag('--out');
    const info = await createBackup({ dir: typeof outDir === 'string' ? outDir : BACKUP_DIR, actor: 'خط فرمان' });
    console.log(`\n  ✓ پشتیبان ساخته شد`);
    console.log(`    فایل  : ${info.path}`);
    console.log(`    حجم   : ${info.size_kb} کیلوبایت`);
    console.log(`    محتوا : ${info.counts.items} رکورد، ${info.counts.drives} هارد، ${info.counts.copies} نسخه`);
    console.log(`\n  این فایل را روی فلش یا فضای ابری کپی کنید تا در رایانهٔ دیگر قابل بازیابی باشد.\n`);
  };

  run()
    .catch((e) => { console.error('\n  ✗ خطا:', e.message, '\n'); process.exitCode = 1; })
    .finally(() => { try { checkpoint(); db.close(); } catch { /* نادیده */ } });
}
