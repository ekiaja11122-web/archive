/**
 * مسیرهای API
 * همهٔ مسیرها به‌جز /api/config و /api/auth/* نیاز به ورود دارند.
 */
import { json, bad, newId, now, readJson } from './util.js';
import {
  publicConfig, handleSetup, handleLogin, handleLogout, checkSession,
  handleChangePassword, allSettings, setSetting, isConfigured,
} from './auth.js';
import { getAgenda } from './agenda.js';
import { runReminders } from './reminders.js';
import { ensureVapidKeys, saveSubscription, sendToAll } from './push.js';
import { nowTehran, todayISO, addJalaliMonths, jalaliMonthRange } from '../public/lib/dt.js';
import { toPersianDigits } from '../public/lib/jalali.js';

/* ------------------------------------------------------ جدول‌های مجاز */

const TABLES = {
  tasks: {
    fields: ['title', 'notes', 'category', 'priority', 'due_date', 'due_time',
      'repeat_rule', 'repeat_every', 'repeat_days', 'remind_before', 'status', 'done_at'],
    order: 'COALESCE(due_date, \'9999\') ASC, priority DESC',
  },
  vault: { fields: ['category', 'data_enc', 'favorite'], order: 'updated_at DESC' },
  debts: { fields: ['kind', 'person', 'amount', 'paid', 'due_date', 'note', 'status'], order: 'status ASC, COALESCE(due_date, \'9999\') ASC' },
  installments: { fields: ['title', 'entity', 'amount', 'total_count', 'paid_count', 'next_due', 'note', 'status'], order: 'status ASC, COALESCE(next_due, \'9999\') ASC' },
  payments: { fields: ['title', 'amount', 'direction', 'due_date', 'repeat_rule', 'category', 'note', 'status', 'paid_at'], order: 'status ASC, COALESCE(due_date, \'9999\') ASC' },
  ledger: { fields: ['date', 'direction', 'amount', 'title', 'category', 'ref', 'note'], order: 'date DESC' },
  notes: { fields: ['title', 'body', 'color', 'pinned'], order: 'pinned DESC, updated_at DESC' },
  contacts: { fields: ['name', 'phone', 'phone2', 'email', 'tags', 'note'], order: 'name ASC' },
  events: { fields: ['title', 'date', 'kind', 'repeat_rule', 'remind_days', 'note'], order: 'date ASC' },
};

const HAS_UPDATED_AT = new Set(['tasks', 'vault', 'debts', 'installments', 'payments', 'notes', 'contacts', 'events']);

async function listTable(env, table, url) {
  const cfg = TABLES[table];
  let sql = `SELECT * FROM ${table}`;
  const binds = [];
  const status = url.searchParams.get('status');
  if (status && cfg.fields.includes('status')) { sql += ' WHERE status = ?'; binds.push(status); }
  sql += ` ORDER BY ${cfg.order}`;
  const limit = parseInt(url.searchParams.get('limit') || '0', 10);
  if (limit > 0) sql += ` LIMIT ${Math.min(limit, 2000)}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

async function createRow(env, table, body) {
  const cfg = TABLES[table];
  const id = String(body.id || newId());
  const cols = ['id'], vals = [id];
  for (const f of cfg.fields) {
    if (body[f] !== undefined && body[f] !== null) { cols.push(f); vals.push(body[f]); }
  }
  cols.push('created_at'); vals.push(now());
  if (HAS_UPDATED_AT.has(table)) { cols.push('updated_at'); vals.push(now()); }
  await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).bind(...vals).run();
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

async function updateRow(env, table, id, body) {
  const cfg = TABLES[table];
  const sets = [], vals = [];
  for (const f of cfg.fields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
  }
  if (!sets.length) return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (HAS_UPDATED_AT.has(table)) { sets.push('updated_at = ?'); vals.push(now()); }
  vals.push(id);
  await env.DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

/* ------------------------------------------------------------ مسیریاب */

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const parts = path ? path.split('/') : [];
  const method = request.method.toUpperCase();

  /* ------------------------------ مسیرهای باز (بدون نیاز به ورود) */
  if (path === 'config') return json(await publicConfig(env));

  if (path === 'auth/setup' && method === 'POST') return handleSetup(env, await readJson(request));
  if (path === 'auth/login' && method === 'POST') return handleLogin(env, await readJson(request), request);
  if (path === 'auth/logout' && method === 'POST') return handleLogout(env, request);

  /* --------------------------------------------- از این‌جا به بعد: ورود لازم */
  if (!(await isConfigured(env))) return bad('برنامه هنوز راه‌اندازی نشده است', 428);
  if (!(await checkSession(env, request))) return bad('وارد نشده‌اید', 401);

  if (path === 'auth/change-password' && method === 'POST') {
    return handleChangePassword(env, await readJson(request));
  }

  /* ----------------------------------------------------- صفحهٔ امروز */
  if (path === 'bootstrap') {
    const s = await allSettings(env);
    delete s.vapid_private; delete s.auth_verifier;
    const today = todayISO();
    const agenda = await getAgenda(env, today, 7);
    const counts = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"),
      env.DB.prepare('SELECT COUNT(*) AS n FROM vault'),
      env.DB.prepare("SELECT COUNT(*) AS n FROM debts WHERE status = 'open'"),
      env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs'),
    ]);
    return json({
      settings: s,
      today,
      clock: nowTehran().time,
      agenda,
      counts: {
        tasks: counts[0].results[0].n,
        vault: counts[1].results[0].n,
        debts: counts[2].results[0].n,
        devices: counts[3].results[0].n,
      },
    });
  }

  if (path === 'agenda') {
    const date = url.searchParams.get('date') || todayISO();
    const horizon = parseInt(url.searchParams.get('horizon') || '7', 10);
    return json(await getAgenda(env, date, Math.min(Math.max(horizon, 0), 60)));
  }

  /* ------------------------------------------------ عملیات ویژهٔ کارها */
  if (parts[0] === 'tasks' && parts[2] === 'toggle' && method === 'POST') {
    const id = parts[1];
    const body = await readJson(request);
    const date = body.date || todayISO();
    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!task) return bad('کار پیدا نشد', 404);

    if ((task.repeat_rule || 'none') !== 'none') {
      if (body.done === false) {
        await env.DB.prepare('DELETE FROM task_log WHERE task_id = ? AND date = ?').bind(id, date).run();
      } else {
        await env.DB.prepare('INSERT OR IGNORE INTO task_log (id, task_id, date, done_at) VALUES (?, ?, ?, ?)')
          .bind(newId(), id, date, now()).run();
      }
      return json({ ok: true, repeating: true, date, done: body.done !== false });
    }

    const done = body.done !== false;
    await env.DB.prepare('UPDATE tasks SET status = ?, done_at = ?, updated_at = ? WHERE id = ?')
      .bind(done ? 'done' : 'open', done ? now() : null, now(), id).run();
    return json({ ok: true, repeating: false, done });
  }

  if (path === 'tasks/history' && method === 'GET') {
    const from = url.searchParams.get('from') || todayISO();
    const { results } = await env.DB.prepare('SELECT * FROM task_log WHERE date >= ? ORDER BY date DESC').bind(from).all();
    return json(results || []);
  }

  /* -------------------------------------------------- عملیات ویژهٔ مالی */
  if (parts[0] === 'debts' && parts[2] === 'pay' && method === 'POST') {
    const id = parts[1];
    const body = await readJson(request);
    const debt = await env.DB.prepare('SELECT * FROM debts WHERE id = ?').bind(id).first();
    if (!debt) return bad('مورد پیدا نشد', 404);
    const amount = Math.max(0, parseInt(body.amount, 10) || 0);
    const date = body.date || todayISO();
    const paid = (debt.paid || 0) + amount;
    const settled = paid >= (debt.amount || 0);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO debt_payments (id, debt_id, amount, date, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(newId(), id, amount, date, body.note || '', now()),
      env.DB.prepare('UPDATE debts SET paid = ?, status = ?, updated_at = ? WHERE id = ?')
        .bind(paid, settled ? 'settled' : 'open', now(), id),
      env.DB.prepare('INSERT INTO ledger (id, date, direction, amount, title, category, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), date, debt.kind === 'payable' ? 'out' : 'in', amount,
          debt.kind === 'payable' ? `پرداخت به ${debt.person}` : `دریافت از ${debt.person}`,
          'بدهی و طلب', 'debt:' + id, body.note || '', now()),
    ]);
    return json({ ok: true, paid, settled });
  }

  if (parts[0] === 'installments' && parts[2] === 'pay' && method === 'POST') {
    const id = parts[1];
    const body = await readJson(request);
    const it = await env.DB.prepare('SELECT * FROM installments WHERE id = ?').bind(id).first();
    if (!it) return bad('مورد پیدا نشد', 404);
    const date = body.date || todayISO();
    const amount = parseInt(body.amount, 10) || it.amount || 0;
    const paidCount = Math.min((it.paid_count || 0) + 1, it.total_count || 1);
    const finished = paidCount >= (it.total_count || 1);
    const nextDue = finished ? null : addJalaliMonths(it.next_due || date, 1);
    await env.DB.batch([
      env.DB.prepare('UPDATE installments SET paid_count = ?, next_due = ?, status = ?, updated_at = ? WHERE id = ?')
        .bind(paidCount, nextDue, finished ? 'done' : 'open', now(), id),
      env.DB.prepare('INSERT INTO ledger (id, date, direction, amount, title, category, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), date, 'out', amount, `قسط ${it.title}`, 'اقساط', 'installment:' + id,
          `قسط ${toPersianDigits(paidCount)} از ${toPersianDigits(it.total_count)}`, now()),
    ]);
    return json({ ok: true, paid_count: paidCount, next_due: nextDue, finished });
  }

  if (parts[0] === 'payments' && parts[2] === 'pay' && method === 'POST') {
    const id = parts[1];
    const body = await readJson(request);
    const p = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
    if (!p) return bad('مورد پیدا نشد', 404);
    const date = body.date || todayISO();
    const stmts = [
      env.DB.prepare('INSERT INTO ledger (id, date, direction, amount, title, category, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), date, p.direction || 'out', p.amount || 0, p.title, p.category || 'واریز', 'payment:' + id, body.note || '', now()),
    ];
    if ((p.repeat_rule || 'none') === 'none') {
      stmts.push(env.DB.prepare('UPDATE payments SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?')
        .bind('paid', date, now(), id));
    } else {
      const next = p.repeat_rule === 'yearly'
        ? addJalaliMonths(p.due_date || date, 12)
        : addJalaliMonths(p.due_date || date, 1);
      stmts.push(env.DB.prepare('UPDATE payments SET due_date = ?, paid_at = ?, updated_at = ? WHERE id = ?')
        .bind(next, date, now(), id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (path === 'finance/summary') {
    const date = url.searchParams.get('date') || todayISO();
    const range = jalaliMonthRange(date);
    const [inOut, byCat, open] = await env.DB.batch([
      env.DB.prepare('SELECT direction, SUM(amount) AS total, COUNT(*) AS n FROM ledger WHERE date BETWEEN ? AND ? GROUP BY direction')
        .bind(range.from, range.to),
      env.DB.prepare('SELECT category, direction, SUM(amount) AS total FROM ledger WHERE date BETWEEN ? AND ? GROUP BY category, direction')
        .bind(range.from, range.to),
      env.DB.prepare(`SELECT
          (SELECT COALESCE(SUM(amount - paid), 0) FROM debts WHERE status = 'open' AND kind = 'payable') AS payable,
          (SELECT COALESCE(SUM(amount - paid), 0) FROM debts WHERE status = 'open' AND kind = 'receivable') AS receivable,
          (SELECT COALESCE(SUM(amount * (total_count - paid_count)), 0) FROM installments WHERE status = 'open') AS installments_left,
          (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'open' AND direction = 'out') AS payments_out`),
    ]);
    return json({
      range,
      month: inOut.results || [],
      by_category: byCat.results || [],
      totals: (open.results || [])[0] || {},
    });
  }

  /* ------------------------------------------------------ نوتیفیکیشن */
  if (path === 'push/key') {
    const { pub } = await ensureVapidKeys(env);
    return json({ key: pub });
  }
  if (path === 'push/subscribe' && method === 'POST') {
    const body = await readJson(request);
    try {
      await saveSubscription(env, body.subscription, body.label);
      return json({ ok: true });
    } catch (e) { return bad(e.message); }
  }
  if (path === 'push/unsubscribe' && method === 'POST') {
    const body = await readJson(request);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(body.endpoint || '').run();
    return json({ ok: true });
  }
  if (path === 'push/devices') {
    const { results } = await env.DB.prepare('SELECT id, label, created_at FROM push_subs ORDER BY created_at DESC').all();
    return json(results || []);
  }
  if (parts[0] === 'push' && parts[1] === 'devices' && parts[2] && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(parts[2]).run();
    return json({ ok: true });
  }
  if (path === 'push/test' && method === 'POST') {
    const res = await sendToAll(env, {
      title: 'آزمایش نوتیفیکیشن ✅',
      body: 'اگر این پیام را می‌بینید، یادآوری‌ها درست کار می‌کنند.',
      tag: 'test', url: '/#/today',
    });
    return json(res);
  }
  if (path === 'reminders/run' && method === 'POST') {
    return json(await runReminders(env));
  }

  /* ---------------------------------------------------------- تنظیمات */
  if (path === 'settings' && method === 'PUT') {
    const body = await readJson(request);
    const allowed = ['notify_hour', 'notify_enabled', 'hint', 'display_name', 'theme', 'currency'];
    for (const [k, v] of Object.entries(body)) {
      if (allowed.includes(k)) await setSetting(env, k, v);
    }
    const s = await allSettings(env);
    delete s.vapid_private; delete s.auth_verifier;
    return json(s);
  }

  /* ------------------------------------------- پشتیبان‌گیری و بازیابی */
  if (path === 'backup') {
    const names = Object.keys(TABLES).concat(['task_log', 'debt_payments']);
    const out = { version: 1, exported_at: now(), tables: {} };
    for (const t of names) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
      out.tables[t] = results || [];
    }
    const s = await allSettings(env);
    delete s.vapid_private;
    out.settings = s;
    return json(out, 200, {
      'content-disposition': `attachment; filename="dastyar-backup-${todayISO()}.json"`,
    });
  }

  if (path === 'restore' && method === 'POST') {
    const body = await readJson(request, 20_000_000);
    if (!body?.tables) return bad('فایل پشتیبان معتبر نیست');
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const names = Object.keys(body.tables).filter((t) => TABLES[t] || t === 'task_log' || t === 'debt_payments');
    const stmts = [];
    for (const t of names) {
      const rows = body.tables[t] || [];
      if (mode === 'replace') stmts.push(env.DB.prepare(`DELETE FROM ${t}`));
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => /^[a-z_0-9]+$/.test(c));
        if (!cols.length) continue;
        stmts.push(env.DB.prepare(
          `INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ).bind(...cols.map((c) => row[c])));
      }
    }
    // در دسته‌های کوچک اجرا می‌شود تا از محدودیت D1 عبور نکند
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    return json({ ok: true, restored: names.length, rows: stmts.length });
  }

  /* -------------------------------------------------- CRUD جدول‌های عادی */
  if (parts.length >= 1 && TABLES[parts[0]]) {
    const table = parts[0];
    const id = parts[1];

    if (method === 'GET' && !id) return json(await listTable(env, table, url));
    if (method === 'GET' && id) {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
      return row ? json(row) : bad('پیدا نشد', 404);
    }
    if (method === 'POST' && !id) return json(await createRow(env, table, await readJson(request)), 201);
    if ((method === 'PUT' || method === 'PATCH') && id) {
      return json(await updateRow(env, table, id, await readJson(request)));
    }
    if (method === 'DELETE' && id) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      if (table === 'tasks') await env.DB.prepare('DELETE FROM task_log WHERE task_id = ?').bind(id).run();
      if (table === 'debts') await env.DB.prepare('DELETE FROM debt_payments WHERE debt_id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (parts[0] === 'debt_payments' && method === 'GET') {
    const debtId = url.searchParams.get('debt_id') || '';
    const { results } = await env.DB.prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY date DESC')
      .bind(debtId).all();
    return json(results || []);
  }

  return bad('مسیر پیدا نشد: ' + path, 404);
}
