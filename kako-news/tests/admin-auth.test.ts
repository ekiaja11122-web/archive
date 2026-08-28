/**
 * تست‌های امنیتی پنل مدیریت.
 *
 * این‌ها به دیتابیس نیاز ندارند: هش رمز، توکن نشست و محافظ CSRF همه
 * توابع محاسباتی‌اند و مستقیم آزمایش می‌شوند.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET = 'a'.repeat(64);

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword, verifyPassword, createSessionToken, readSessionToken,
  csrfToken, verifyCsrf, SESSION_TTL_MS,
} from '../src/admin/auth.ts';
import { AppError } from '../src/lib/errors.ts';
import { layout } from '../src/admin/views/layout.ts';
import { html } from '../src/admin/html.ts';

describe('هش رمز عبور', () => {
  test('رمز درست پذیرفته می‌شود', async () => {
    const hash = await hashPassword('rooz-name-kako-1404');
    assert.equal(await verifyPassword('rooz-name-kako-1404', hash), true);
  });

  test('رمز نادرست پذیرفته نمی‌شود', async () => {
    const hash = await hashPassword('rooz-name-kako-1404');
    assert.equal(await verifyPassword('rooz-name-kako-1405', hash), false);
  });

  test('رمز به‌صورت متن ساده در هش نیست', async () => {
    const hash = await hashPassword('my-secret-password');
    assert.ok(!hash.includes('my-secret-password'));
    assert.ok(hash.startsWith('scrypt$'));
  });

  test('دو کاربر با رمز یکسان، هش متفاوت می‌گیرند (نمک تصادفی)', async () => {
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('same-password-here', a), true);
    assert.equal(await verifyPassword('same-password-here', b), true);
  });

  test('رمز کوتاه پذیرفته نمی‌شود', async () => {
    await assert.rejects(
      () => hashPassword('kotah'),
      (err: unknown) => err instanceof AppError && err.code === 'WEAK_PASSWORD',
    );
  });

  test('هش دستکاری‌شده یا خراب، خطا نمی‌دهد و فقط رد می‌شود', async () => {
    for (const bad of ['', 'چیز نامربوط', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e']) {
      assert.equal(await verifyPassword('any-password', bad), false);
    }
  });

  test('رمز فارسی هم کار می‌کند', async () => {
    const hash = await hashPassword('رمزعبورفارسی۱۴۰۵');
    assert.equal(await verifyPassword('رمزعبورفارسی۱۴۰۵', hash), true);
    assert.equal(await verifyPassword('رمزعبورفارسی۱۴۰۴', hash), false);
  });
});

describe('توکن نشست', () => {
  test('توکن ساخته‌شده، همان کاربر را برمی‌گرداند', () => {
    assert.equal(readSessionToken(createSessionToken(42)), 42);
  });

  test('توکن دستکاری‌شده باطل است', () => {
    const token = createSessionToken(42);
    const [, expires, signature] = token.split('.');
    // تلاش برای جا زدن خود به‌عنوان کاربر ۱ با همان امضا
    assert.equal(readSessionToken(`1.${expires}.${signature}`), null);
  });

  test('امضای جعلی باطل است', () => {
    const [userId, expires] = createSessionToken(42).split('.');
    assert.equal(readSessionToken(`${userId}.${expires}.جعلی`), null);
  });

  test('توکن منقضی‌شده باطل است', () => {
    const old = createSessionToken(42, Date.now() - SESSION_TTL_MS - 1000);
    assert.equal(readSessionToken(old), null);
  });

  test('توکن نامفهوم یا خالی باطل است', () => {
    for (const bad of [undefined, '', 'abc', 'a.b', 'a.b.c.d']) {
      assert.equal(readSessionToken(bad), null);
    }
  });

  test('تمدید نشست تا یک هفته معتبر است', () => {
    const token = createSessionToken(7);
    assert.equal(readSessionToken(token, Date.now() + SESSION_TTL_MS - 60_000), 7);
  });
});

describe('محافظ CSRF', () => {
  test('توکن درست پذیرفته می‌شود', () => {
    const session = createSessionToken(5);
    assert.equal(verifyCsrf(session, csrfToken(session)), true);
  });

  test('توکن نشست دیگر پذیرفته نمی‌شود', () => {
    const mine = createSessionToken(5);
    const other = createSessionToken(6);
    assert.equal(verifyCsrf(mine, csrfToken(other)), false);
  });

  test('توکن خالی یا جعلی پذیرفته نمی‌شود', () => {
    const session = createSessionToken(5);
    assert.equal(verifyCsrf(session, undefined), false);
    assert.equal(verifyCsrf(session, ''), false);
    assert.equal(verifyCsrf(session, 'جعلی'), false);
  });
});

describe('پوستهٔ صفحه', () => {
  test('عنوان صفحه escape می‌شود', () => {
    const page = layout(
      { title: '<script>alert(1)</script>', brandName: 'کاکو نیوز' },
      html`<p>سلام</p>`,
    );
    assert.ok(!page.includes('<title><script>'));
    assert.ok(page.includes('&lt;script&gt;'));
  });

  test('صفحه راست‌چین و فارسی است', () => {
    const page = layout({ title: 'آزمایش', brandName: 'کاکو نیوز' }, html`<p>متن</p>`);
    assert.ok(page.includes('lang="fa"'));
    assert.ok(page.includes('dir="rtl"'));
  });

  test('پنل از موتورهای جست‌وجو پنهان است', () => {
    const page = layout({ title: 'آزمایش', brandName: 'کاکو نیوز' }, html`<p>متن</p>`);
    assert.ok(page.includes('noindex'));
  });

  test('هیچ منبع بیرونی بارگذاری نمی‌شود', () => {
    const page = layout({ title: 'آزمایش', brandName: 'کاکو نیوز' }, html`<p>متن</p>`);
    assert.ok(!/(src|href)=["']https?:/.test(page), 'پنل نباید به اینترنت وابسته باشد');
  });

  test('هیچ رویداد inline در پوسته نیست (CSP آن را مسدود می‌کند)', () => {
    const page = layout(
      { title: 'آزمایش', brandName: 'کاکو نیوز', user: { username: 'admin', display_name: null } },
      html`<p>متن</p>`,
    );
    assert.ok(!/\son(click|error|load)\s*=/.test(page));
  });
});
