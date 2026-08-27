/**
 * ورود و نگه‌داشتن نشست
 *
 * روش کار:
 *   ۱. کاربر یک «رمز اصلی» انتخاب می‌کند. این رمز هرگز به سرور نمی‌رسد.
 *   ۲. مرورگر از روی رمز، دو کلید می‌سازد:
 *        - کلید ورود  (با نمک auth_salt)  → به سرور فرستاده می‌شود
 *        - کلید رمزگذاری (با نمک enc_salt) → هرگز از مرورگر خارج نمی‌شود
 *   ۳. سرور فقط چکیدهٔ کلید ورود را نگه می‌دارد.
 */
import { json, bad, newId, now, sha256Hex, safeEqual, parseCookies, cookieHeader } from './util.js';

const SESSION_DAYS = 60;
const MAX_FAILS = 10;
const FAIL_WINDOW_MIN = 15;

export async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, String(value)).run();
}

export async function allSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of results || []) out[r.key] = r.value;
  return out;
}

/** آیا برنامه هنوز راه‌اندازی نشده است؟ */
export async function isConfigured(env) {
  return !!(await getSetting(env, 'auth_verifier'));
}

/** اطلاعات عمومی لازم برای صفحهٔ ورود (نمک‌ها محرمانه نیستند) */
export async function publicConfig(env) {
  const s = await allSettings(env);
  return {
    configured: !!s.auth_verifier,
    auth_salt: s.auth_salt || null,
    enc_salt: s.enc_salt || null,
    kdf_iterations: parseInt(s.kdf_iterations || '310000', 10),
    app_name: env.APP_NAME || 'دستیار',
    vapid_public: s.vapid_public || null,
  };
}

/* ------------------------------------------------------- راه‌اندازی اولیه */

export async function handleSetup(env, body) {
  if (await isConfigured(env)) return bad('برنامه قبلاً راه‌اندازی شده است', 409);
  const { auth_key, auth_salt, enc_salt, kdf_iterations, hint } = body || {};
  if (!auth_key || !auth_salt || !enc_salt) return bad('اطلاعات راه‌اندازی ناقص است');

  await setSetting(env, 'auth_verifier', await sha256Hex(auth_key));
  await setSetting(env, 'auth_salt', auth_salt);
  await setSetting(env, 'enc_salt', enc_salt);
  await setSetting(env, 'kdf_iterations', String(parseInt(kdf_iterations, 10) || 310000));
  await setSetting(env, 'hint', hint || '');
  await setSetting(env, 'created_at', now());
  await setSetting(env, 'notify_hour', '8');
  await setSetting(env, 'notify_enabled', '1');

  return withSession(env, { ok: true });
}

/* ---------------------------------------------------------------- ورود */

export async function handleLogin(env, body, request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
  const fails = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ok = 0 AND at > ?',
  ).bind(since).first();
  if ((fails?.n || 0) >= MAX_FAILS) {
    return bad('به دلیل تلاش‌های ناموفق، ورود موقتاً بسته است. چند دقیقه بعد دوباره امتحان کنید.', 429);
  }

  const verifier = await getSetting(env, 'auth_verifier');
  const given = await sha256Hex(String(body?.auth_key || ''));
  const ok = !!verifier && safeEqual(verifier, given);

  await env.DB.prepare('INSERT INTO login_attempts (at, ok, ip) VALUES (?, ?, ?)')
    .bind(now(), ok ? 1 : 0, ip).run();

  if (!ok) return bad('رمز اصلی درست نیست', 401);
  await env.DB.prepare('DELETE FROM login_attempts WHERE ok = 0').run();
  return withSession(env, { ok: true }, request);
}

async function withSession(env, payload, request) {
  const token = newId() + newId();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const agent = (request?.headers.get('user-agent') || '').slice(0, 200);
  await env.DB.prepare('INSERT INTO sessions (token, created_at, expires_at, agent) VALUES (?, ?, ?, ?)')
    .bind(token, now(), expires, agent).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
  return json(payload, 200, { 'set-cookie': cookieHeader('dsid', token, SESSION_DAYS * 86400) });
}

export async function handleLogout(env, request) {
  const token = parseCookies(request).dsid;
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader('dsid', '', 0) });
}

/** آیا درخواست، نشست معتبر دارد؟ */
export async function checkSession(env, request) {
  const token = parseCookies(request).dsid;
  if (!token) return false;
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return false;
  if (row.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return false;
  }
  return true;
}

/** تغییر رمز اصلی: مرورگر همهٔ آیتم‌های گاوصندوق را دوباره رمزگذاری می‌کند و می‌فرستد */
export async function handleChangePassword(env, body) {
  const { auth_key, auth_salt, enc_salt, kdf_iterations, items, hint } = body || {};
  if (!auth_key || !auth_salt || !enc_salt) return bad('اطلاعات ناقص است');

  const stmts = [
    env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(await sha256Hex(auth_key), 'auth_verifier'),
    env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(auth_salt, 'auth_salt'),
    env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(enc_salt, 'enc_salt'),
    env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .bind(String(parseInt(kdf_iterations, 10) || 310000), 'kdf_iterations'),
  ];
  for (const it of items || []) {
    stmts.push(env.DB.prepare('UPDATE vault SET data_enc = ?, updated_at = ? WHERE id = ?')
      .bind(it.data_enc, now(), it.id));
  }
  await env.DB.batch(stmts);
  if (hint !== undefined) await setSetting(env, 'hint', hint || '');
  await env.DB.prepare('DELETE FROM sessions').run();
  return withSession(env, { ok: true });
}
