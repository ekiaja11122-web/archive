/**
 * رمزگذاری سمت مرورگر
 *
 * رمز اصلی هرگز به سرور فرستاده نمی‌شود. از روی آن دو کلید ساخته می‌شود:
 *   authKey → فقط برای اثبات هویت به سرور (سرور چکیدهٔ آن را نگه می‌دارد)
 *   encKey  → برای رمزگذاری محتوای گاوصندوق؛ این کلید از مرورگر خارج نمی‌شود
 */

const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
  to: (str) => {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function randomBase64(bytes = 16) {
  return b64.from(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pbkdf2(password, saltB64, iterations, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const salt = b64.to(saltB64);
  if (usage === 'bits') {
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256);
    return b64.from(bits);
  }
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

/** ساخت هر دو کلید از روی رمز اصلی */
export async function deriveKeys(password, authSalt, encSalt, iterations = ITERATIONS) {
  const [authKey, encKey] = await Promise.all([
    pbkdf2(password, authSalt, iterations, 'bits'),
    pbkdf2(password, encSalt, iterations, 'key'),
  ]);
  return { authKey, encKey };
}

/** ساخت نمک‌های تازه برای راه‌اندازی اولیه یا تغییر رمز */
export function freshSalts() {
  return { auth_salt: randomBase64(16), enc_salt: randomBase64(16), kdf_iterations: ITERATIONS };
}

/** رمزگذاری یک شیء → رشتهٔ base64 */
export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0); out.set(cipher, iv.length);
  return b64.from(out);
}

/** بازگشایی رشتهٔ رمزشده → شیء */
export async function decryptJSON(key, payload) {
  const raw = b64.to(payload);
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(dec.decode(plain));
}

/* ------------------------------------------- نگه‌داشتن کلید روی دستگاه */

const STORE_KEY = 'dastyar.vaultkey';

/** کلید را برای دفعات بعد روی همین دستگاه نگه می‌دارد (اختیاری) */
export async function rememberKey(key, persistent) {
  const raw = await crypto.subtle.exportKey('raw', key).catch(() => null);
  if (!raw) return;
  const store = persistent ? localStorage : sessionStorage;
  store.setItem(STORE_KEY, b64.from(raw));
}

export async function recallKey() {
  const raw = localStorage.getItem(STORE_KEY) || sessionStorage.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey('raw', b64.to(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch { return null; }
}

export function forgetKey() {
  localStorage.removeItem(STORE_KEY);
  sessionStorage.removeItem(STORE_KEY);
}

/** سنجش قدرت رمز (۰ تا ۴) */
export function passwordStrength(pw) {
  let score = 0;
  if (!pw) return 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 0.5;
  if (/[^\w\s]/.test(pw)) score += 0.5;
  return Math.min(4, Math.round(score));
}

/** ساخت رمز تصادفی قوی */
export function generatePassword(length = 16, opts = {}) {
  const sets = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    '23456789',
    opts.symbols === false ? '' : '!@#$%^&*-_=+?',
  ].filter(Boolean);
  const all = sets.join('');
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = '';
  for (let i = 0; i < length; i += 1) out += all[bytes[i] % all.length];
  return out;
}
