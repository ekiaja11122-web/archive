/**
 * تست‌های تلاش مجدد انتشار.
 *
 * باگی که این‌ها نگهبانش هستند: پیش از این، هر خطای انتشار — حتی یک
 * قطعی چنددقیقه‌ای سایت — وضعیت را «failed» می‌کرد و چون صف انتشار
 * فقط «pending» را برمی‌دارد، آن خبر دیگر هرگز فرستاده نمی‌شد.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isPermanentPublishFailure } from '../src/publisher/website.ts';
import { isPermanentTelegramFailure } from '../src/publisher/channel.ts';
import { AppError } from '../src/lib/errors.ts';
import { loadAppConfig } from '../src/config/app-config.ts';

const app = loadAppConfig();

/**
 * همان منطق تصمیم‌گیری `markPublicationFailed`، جدا شده تا بدون
 * دیتابیس قابل آزمایش باشد.
 */
function decideOutcome(
  attemptsBefore: number,
  permanent: boolean,
  maxAttempts = app.publishing.max_attempts,
  backoffSeconds = app.publishing.retry_backoff_seconds,
): { status: 'pending' | 'failed'; attempts: number; delaySeconds: number | null } {
  const attempts = attemptsBefore + 1;
  const giveUp = permanent || attempts >= maxAttempts;
  return {
    status: giveUp ? 'failed' : 'pending',
    attempts,
    delaySeconds: giveUp ? null : backoffSeconds * 2 ** (attempts - 1),
  };
}

describe('تصمیم پس از شکست انتشار', () => {
  test('خطای گذرا خبر را در صف نگه می‌دارد', () => {
    const outcome = decideOutcome(0, false);
    assert.equal(outcome.status, 'pending', 'خبر نباید با یک خطای گذرا کنار گذاشته شود');
    assert.equal(outcome.attempts, 1);
  });

  test('فاصلهٔ تلاش‌ها با هر شکست دو برابر می‌شود', () => {
    const delays = [0, 1, 2, 3].map((n) => decideOutcome(n, false).delaySeconds);
    const base = app.publishing.retry_backoff_seconds;
    assert.deepEqual(delays, [base, base * 2, base * 4, base * 8]);
  });

  test('پس از رسیدن به سقف تلاش‌ها، خبر ناموفق علامت می‌خورد', () => {
    const outcome = decideOutcome(app.publishing.max_attempts - 1, false);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.delaySeconds, null);
  });

  test('خطای دائمی حتی در تلاش اول، ناموفق است', () => {
    const outcome = decideOutcome(0, true);
    assert.equal(outcome.status, 'failed', 'رمز اشتباه با تلاش دوباره درست نمی‌شود');
  });

  test('سقف تلاش‌ها در کانفیگ منطقی است', () => {
    assert.ok(app.publishing.max_attempts >= 2, 'حداقل یک تلاش مجدد باید ممکن باشد');
    assert.ok(app.publishing.max_attempts <= 20, 'تلاش بی‌نهایت، سایت منبع را می‌کوبد');
  });
});

describe('دسته‌بندی خطاها', () => {
  test('خطاهای وردپرس درست دسته‌بندی می‌شوند', () => {
    // دائمی: تا وقتی سردبیر تنظیمات را درست نکند، تکرار بی‌فایده است
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_AUTH', 'رمز غلط')), true);
    // گذرا: سایت برمی‌گردد
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_ERROR', '503')), false);
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_UNREACHABLE', 'شبکه')), false);
  });

  test('خطاهای تلگرام درست دسته‌بندی می‌شوند', () => {
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_AUTH', 'توکن')), true);
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_BAD_REQUEST', 'پیام')), true);
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_ERROR', '503')), false);
  });

  test('خطای ناشناخته گذرا فرض می‌شود', () => {
    // فرض محافظه‌کارانه: خبر را نگه دار و دوباره تلاش کن،
    // به‌جای اینکه شاید بی‌جهت دورش بیندازی
    assert.equal(isPermanentPublishFailure(new Error('چیز عجیب')), false);
    assert.equal(isPermanentTelegramFailure(new Error('چیز عجیب')), false);
  });
});

describe('تنظیمات زمان‌بند سرویس', () => {
  test('همهٔ مراحل پایپ‌لاین در زمان‌بند تعریف شده‌اند', () => {
    const stages = app.scheduler.stages;
    for (const stage of ['collect', 'filter', 'dedup', 'rewrite', 'publish'] as const) {
      assert.equal(typeof stages[stage], 'boolean', `مرحلهٔ ${stage} باید قابل خاموش کردن باشد`);
    }
  });

  test('بازهٔ انتشار کوتاه‌تر از بازهٔ پردازش است', () => {
    // خبر تأییدشده نباید پشت چرخهٔ کند بازنویسی معطل بماند
    assert.ok(app.scheduler.publish_interval_seconds <= app.scheduler.pipeline_interval_seconds);
  });

  test('بازه‌ها آن‌قدر کوتاه نیستند که منابع را بکوبند', () => {
    assert.ok(app.scheduler.min_poll_interval_seconds >= 60);
  });
});
