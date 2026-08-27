/** ابزارهای عمومی سمت سرور */

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const bad = (message, status = 400) => json({ error: message }, status);

/** شناسهٔ یکتا و کوتاه */
export const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const now = () => new Date().toISOString();

/** خواندن بدنهٔ JSON با محدودیت اندازه */
export async function readJson(request, limit = 2_000_000) {
  const text = await request.text();
  if (text.length > limit) throw new Error('حجم داده بیش از حد مجاز است');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('قالب داده نامعتبر است'); }
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return bits.join('; ');
}

/* ---------------------------------------------- تبدیل‌های رمزنگاری */

export function bytesToB64u(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uToBytes(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(s);

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', utf8(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** مقایسهٔ امن رشته‌ها (بدون نشت زمانی) */
export function safeEqual(a, b) {
  const x = utf8(String(a || '')), y = utf8(String(b || ''));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
