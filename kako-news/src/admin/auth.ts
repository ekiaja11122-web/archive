/**
 * احراز هویت پنل مدیریت.
 *
 * تصمیم‌های امنیتی:
 *   - رمز با **scrypt** هش می‌شود (تابع داخلی Node، بدون وابستگی بومی).
 *     نمک تصادفی برای هر کاربر، پس دو رمز یکسان هش یکسان نمی‌دهند.
 *   - مقایسهٔ هش با `timingSafeEqual` انجام می‌شود تا از حمله‌های زمانی
 *     جلوگیری شود.
 *   - نشست بدون جدول در دیتابیس است: کوکی امضاشده با HMAC-SHA256 که
 *     شناسهٔ کاربر و زمان انقضا را حمل می‌کند. دستکاری کوکی امضا را
 *     خراب می‌کند و نشست باطل می‌شود.
 *   - رمز هرگز لاگ نمی‌شود و هرگز به قالب HTML نمی‌رسد.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.ts';
import { query, queryOne } from '../db/pool.ts';
import { AppError } from '../lib/errors.ts';

const SCRYPT_N = 16384;   // هزینهٔ محاسباتی
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** مدت اعتبار نشست: یک هفته */
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export type AdminUser = {
  id: number;
  username: string;
  display_name: string | null;
  is_active: boolean;
};

// ---------------------------------------------------------------
// رمز عبور
// ---------------------------------------------------------------

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFC'),
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

/** ساخت هش رمز به قالب: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new AppError('WEAK_PASSWORD', 'رمز عبور باید حداقل ۸ نویسه باشد', {});
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt);
  return [
    'scrypt', SCRYPT_N, SCRYPT_r, SCRYPT_p,
    salt.toString('base64'), derived.toString('base64'),
  ].join('$');
}

/** بررسی رمز در برابر هش ذخیره‌شده. هیچ‌وقت خطا پرتاب نمی‌کند. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(hashB64!, 'base64');

    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(
        password.normalize('NFC'), salt, expected.length,
        { N: Number(n), r: Number(r), p: Number(p) },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });

    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------
// کاربران
// ---------------------------------------------------------------

export async function createAdminUser(
  username: string,
  password: string,
  displayName?: string,
): Promise<number> {
  const passwordHash = await hashPassword(password);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO admin_users (username, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [username.trim().toLowerCase(), passwordHash, displayName ?? null],
  );
  return row?.id ?? 0;
}

/** ورود. در صورت نادرست بودن، `null` برمی‌گرداند — بدون افشای اینکه کدام بخش غلط بود. */
export async function authenticate(username: string, password: string): Promise<AdminUser | null> {
  const row = await queryOne<{
    id: number; username: string; password_hash: string;
    display_name: string | null; is_active: boolean;
  }>('SELECT * FROM admin_users WHERE username = $1', [username.trim().toLowerCase()]);

  if (!row) {
    // برای اینکه زمان پاسخ «کاربر نیست» و «رمز غلط» یکسان بماند
    await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
    return null;
  }
  if (!row.is_active) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;

  await query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [row.id]);
  return {
    id: row.id, username: row.username,
    display_name: row.display_name, is_active: row.is_active,
  };
}

export async function findAdminUser(id: number): Promise<AdminUser | null> {
  return queryOne<AdminUser>(
    'SELECT id, username, display_name, is_active FROM admin_users WHERE id = $1 AND is_active',
    [id],
  );
}

export async function adminUserCount(): Promise<number> {
  const row = await queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM admin_users');
  return row?.count ?? 0;
}

// ---------------------------------------------------------------
// نشست (کوکی امضاشده)
// ---------------------------------------------------------------

function sessionSecret(): string {
  const secret = env().SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new AppError(
      'NO_SESSION_SECRET',
      'مقدار SESSION_SECRET در .env تنظیم نشده یا خیلی کوتاه است',
      { help: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' },
    );
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/** ساخت مقدار کوکی نشست. */
export function createSessionToken(userId: number, now = Date.now()): string {
  const payload = `${userId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** خواندن شناسهٔ کاربر از کوکی. اگر امضا یا تاریخ خراب باشد `null`. */
export function readSessionToken(token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, expiresAt, signature] = parts;
  const payload = `${userId}.${expiresAt}`;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature ?? '');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return null;
  }
  if (Number(expiresAt) < now) return null;

  const id = Number(userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------
// محافظ CSRF
// ---------------------------------------------------------------

/**
 * توکن CSRF وابسته به نشست.
 * فرم‌های پنل بدون این توکن پذیرفته نمی‌شوند، پس سایت دیگری نمی‌تواند
 * مرورگر سردبیر را وادار به تأیید یا انتشار خبری کند.
 */
export function csrfToken(sessionToken: string): string {
  return crypto.createHmac('sha256', sessionSecret())
    .update(`csrf:${sessionToken}`)
    .digest('base64url');
}

export function verifyCsrf(sessionToken: string, submitted: string | undefined): boolean {
  if (!submitted) return false;
  const expected = Buffer.from(csrfToken(sessionToken));
  const received = Buffer.from(submitted);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
