/**
 * بررسی سلامت کل سامانه.
 *
 * هدف: وقتی چیزی کار نمی‌کند، به‌جای گشتن در لاگ‌ها یک دستور بزنید و
 * ببینید کجا مشکل دارد. همان چیزی که بعد از راه‌اندازی روی سرور و هر
 * وقت اوضاع عجیب شد، اول اجرا می‌شود.
 */
import { env } from '../config/env.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { loadSourcesConfig } from '../config/sources-config.ts';
import { loadKeywords } from '../config/keywords-config.ts';
import { ping, queryOne, query } from '../db/pool.ts';
import { migrationStatus } from '../db/migrate.ts';
import { listSources } from '../db/repositories/sources.ts';
import { countByStatus } from '../db/repositories/raw-articles.ts';
import { countArticlesByStatus } from '../db/repositories/articles.ts';
import { scheduledRetries } from '../db/repositories/publications.ts';
import { isOpenAiConfigured } from '../lib/openai.ts';
import { isWordPressConfigured, createWordPressClient } from '../publisher/website.ts';
import { isTelegramConfigured, createTelegramClient } from '../publisher/channel.ts';
import { errorMessage } from '../lib/errors.ts';
import { formatTehran } from '../lib/date.ts';

type Level = 'ok' | 'warn' | 'error' | 'info';

type Check = { level: Level; label: string; detail?: string };

const MARK: Record<Level, string> = { ok: '✓', warn: '!', error: '✗', info: '·' };

function print(section: string, checks: Check[]): void {
  process.stdout.write(`\n  ${section}\n`);
  for (const check of checks) {
    process.stdout.write(`    ${MARK[check.level]} ${check.label}\n`);
    if (check.detail) process.stdout.write(`        ${check.detail}\n`);
  }
}

/** بررسی کامل. اگر مشکل جدی باشد کد خروج غیرصفر برمی‌گرداند. */
export async function runDoctor(options: { deep?: boolean } = {}): Promise<number> {
  let problems = 0;
  const note = (checks: Check[]): void => {
    problems += checks.filter((c) => c.level === 'error').length;
  };

  process.stdout.write('\n  بررسی سلامت سامانهٔ کاکو نیوز\n  ' + '─'.repeat(46) + '\n');

  // --- تنظیمات ---
  const configChecks: Check[] = [];
  try {
    const app = loadAppConfig();
    configChecks.push({ level: 'ok', label: `app.yaml — ${app.categories.length} دسته‌بندی` });
  } catch (err) {
    configChecks.push({ level: 'error', label: 'app.yaml', detail: errorMessage(err) });
  }
  try {
    const sources = loadSourcesConfig();
    const enabled = sources.filter((s) => s.enabled).length;
    configChecks.push({
      level: enabled === 0 ? 'warn' : 'ok',
      label: `sources.yaml — ${sources.length} منبع (${enabled} فعال)`,
      detail: enabled === 0 ? 'هیچ منبع فعالی نیست؛ خبری جمع‌آوری نمی‌شود' : undefined,
    });
  } catch (err) {
    configChecks.push({ level: 'error', label: 'sources.yaml', detail: errorMessage(err) });
  }
  try {
    const keywords = loadKeywords();
    configChecks.push({
      level: 'ok',
      label: `واژه‌نامهٔ شیراز — ${keywords.positive.length} عبارت، ${keywords.negative.length} نشانهٔ منفی`,
    });
  } catch (err) {
    configChecks.push({ level: 'error', label: 'واژه‌نامهٔ شیراز', detail: errorMessage(err) });
  }
  print('تنظیمات', configChecks);
  note(configChecks);

  // --- دیتابیس ---
  const dbChecks: Check[] = [];
  const alive = await ping();
  if (!alive) {
    dbChecks.push({
      level: 'error', label: 'اتصال دیتابیس برقرار نیست',
      detail: 'مقدار DATABASE_URL را بررسی کنید و مطمئن شوید PostgreSQL بالاست',
    });
    print('دیتابیس', dbChecks);
    note(dbChecks);
    process.stdout.write('\n  بدون دیتابیس، بررسی بیشتر ممکن نیست.\n\n');
    return 1;
  }
  dbChecks.push({ level: 'ok', label: 'اتصال دیتابیس برقرار است' });

  const migrations = await migrationStatus();
  const pendingMigrations = migrations.filter((m) => !m.applied);
  const changed = migrations.filter((m) => m.changedSinceApplied);
  dbChecks.push(
    pendingMigrations.length > 0
      ? {
          level: 'error',
          label: `${pendingMigrations.length} مهاجرت اعمال‌نشده`,
          detail: 'دستور «npm run migrate» را اجرا کنید',
        }
      : { level: 'ok', label: `${migrations.length} مهاجرت، همه اعمال شده` },
  );
  if (changed.length > 0) {
    dbChecks.push({
      level: 'warn',
      label: `${changed.length} فایل مهاجرت پس از اعمال تغییر کرده`,
      detail: changed.map((m) => m.name).join('، '),
    });
  }

  const dbSize = await queryOne<{ size: string }>(
    'SELECT pg_size_pretty(pg_database_size(current_database())) AS size',
  );
  dbChecks.push({ level: 'info', label: `حجم دیتابیس: ${dbSize?.size ?? 'نامشخص'}` });
  print('دیتابیس', dbChecks);
  note(dbChecks);

  // --- منابع ---
  const sources = await listSources();
  const sourceChecks: Check[] = [];
  if (sources.length === 0) {
    sourceChecks.push({
      level: 'warn', label: 'هیچ منبعی در دیتابیس نیست',
      detail: 'دستور «npm run sources:sync» را اجرا کنید',
    });
  } else {
    const broken = sources.filter((s) => s.enabled && s.last_status === 'error');
    const never = sources.filter((s) => s.enabled && !s.last_polled_at);
    const healthy = sources.filter((s) => s.enabled && s.last_status === 'ok');

    if (healthy.length > 0) sourceChecks.push({ level: 'ok', label: `${healthy.length} منبع سالم` });
    if (never.length > 0) {
      sourceChecks.push({ level: 'info', label: `${never.length} منبع هنوز بررسی نشده` });
    }
    for (const source of broken) {
      sourceChecks.push({
        level: source.consecutive_failures >= 5 ? 'error' : 'warn',
        label: `«${source.name}» خطا می‌دهد (${source.consecutive_failures} بار پیاپی)`,
        detail: (source.last_error ?? '').slice(0, 120),
      });
    }
    // منبعی که خیلی وقت است بررسی نشده، یعنی زمان‌بند کار نمی‌کند
    const stale = sources.filter(
      (s) => s.enabled && s.last_polled_at &&
        Date.now() - s.last_polled_at.getTime() > s.poll_interval_seconds * 4000,
    );
    if (stale.length > 0) {
      sourceChecks.push({
        level: 'warn',
        label: `${stale.length} منبع خیلی وقت است بررسی نشده`,
        detail: 'شاید سرویس worker اجرا نمی‌شود؟',
      });
    }
  }
  print('منابع خبری', sourceChecks);
  note(sourceChecks);

  // --- سرویس‌های بیرونی ---
  const serviceChecks: Check[] = [];

  serviceChecks.push(
    isOpenAiConfigured()
      ? { level: 'ok', label: `OpenAI تنظیم شده (مدل ${env().OPENAI_MODEL})` }
      : { level: 'warn', label: 'OpenAI تنظیم نشده', detail: 'بدون آن بازنویسی انجام نمی‌شود' },
  );

  if (!isWordPressConfigured()) {
    serviceChecks.push({ level: 'warn', label: 'وردپرس تنظیم نشده' });
  } else if (options.deep) {
    try {
      const me = await createWordPressClient().checkConnection();
      serviceChecks.push({ level: 'ok', label: `وردپرس متصل — کاربر «${me.name}»` });
    } catch (err) {
      serviceChecks.push({ level: 'error', label: 'اتصال وردپرس ناموفق', detail: errorMessage(err).slice(0, 120) });
    }
  } else {
    serviceChecks.push({ level: 'info', label: 'وردپرس تنظیم شده (برای آزمودن اتصال: --deep)' });
  }

  if (!isTelegramConfigured()) {
    serviceChecks.push({ level: 'warn', label: 'تلگرام تنظیم نشده' });
  } else if (options.deep) {
    try {
      const bot = await createTelegramClient().checkConnection();
      serviceChecks.push({
        level: 'ok',
        label: `تلگرام متصل — ربات @${bot.username} → ${env().TELEGRAM_CHANNEL_ID}`,
        detail: 'مطمئن شوید ربات در کانال ادمین است',
      });
    } catch (err) {
      serviceChecks.push({ level: 'error', label: 'اتصال تلگرام ناموفق', detail: errorMessage(err).slice(0, 120) });
    }
  } else {
    serviceChecks.push({ level: 'info', label: 'تلگرام تنظیم شده (برای آزمودن اتصال: --deep)' });
  }

  const e = env();
  serviceChecks.push(
    e.SESSION_SECRET && e.SESSION_SECRET.length >= 32
      ? { level: 'ok', label: 'کلید نشست پنل تنظیم شده' }
      : {
          level: 'error',
          label: 'SESSION_SECRET تنظیم نشده یا خیلی کوتاه است',
          detail: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        },
  );
  if (e.ADMIN_PASSWORD && ['change-me-please', 'admin', '12345678'].includes(e.ADMIN_PASSWORD)) {
    serviceChecks.push({
      level: 'error',
      label: 'رمز پنل هنوز مقدار پیش‌فرض است',
      detail: 'حتماً پیش از قرار دادن پنل روی اینترنت عوضش کنید',
    });
  }
  print('سرویس‌های بیرونی', serviceChecks);
  note(serviceChecks);

  // --- وضعیت کار ---
  const raw = await countByStatus();
  const articles = await countArticlesByStatus();
  const retries = await scheduledRetries();

  const workChecks: Check[] = [
    { level: 'info', label: `خبر خام: ${describeCounts(raw)}` },
    { level: 'info', label: `خبر بازنویسی‌شده: ${describeCounts(articles)}` },
  ];

  const pendingReview = articles.pending_review ?? 0;
  if (pendingReview > 30) {
    workChecks.push({
      level: 'warn',
      label: `${pendingReview} خبر در صف تأیید انباشته شده`,
      detail: 'با «npm run serve» پنل را باز کنید و تصمیم بگیرید',
    });
  }

  if (retries.length > 0) {
    workChecks.push({
      level: 'warn',
      label: `${retries.length} انتشار منتظر تلاش مجدد`,
      detail: `نزدیک‌ترین: ${formatTehran(retries[0]?.next_attempt_at)}`,
    });
  }

  const failedPublications = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM publications WHERE status = 'failed'",
  );
  if ((failedPublications?.count ?? 0) > 0) {
    workChecks.push({
      level: 'warn',
      label: `${failedPublications?.count} انتشار پس از چند تلاش ناموفق مانده`,
      detail: 'در پنل، صفحهٔ هر خبر دکمهٔ «تلاش مجدد» دارد',
    });
  }

  const lastJob = await queryOne<{ job_name: string; started_at: Date }>(
    'SELECT job_name, started_at FROM job_runs ORDER BY started_at DESC LIMIT 1',
  );
  workChecks.push(
    lastJob
      ? { level: 'info', label: `آخرین اجرا: ${lastJob.job_name} — ${formatTehran(lastJob.started_at)}` }
      : { level: 'warn', label: 'هیچ اجرایی ثبت نشده؛ هنوز چیزی اجرا نشده است' },
  );
  print('وضعیت کار', workChecks);
  note(workChecks);

  // --- خطاهای اخیر ---
  const recentErrors = await query<{ stage: string; message: string; created_at: Date }>(
    `SELECT stage, message, created_at FROM pipeline_events
     WHERE level = 'error' AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 5`,
  );
  if (recentErrors.length > 0) {
    print('خطاهای ۲۴ ساعت اخیر', recentErrors.map((row) => ({
      level: 'warn' as Level,
      label: `[${row.stage}] ${row.message.slice(0, 90)}`,
      detail: formatTehran(row.created_at),
    })));
  }

  process.stdout.write(
    '\n  ' + '─'.repeat(46) + '\n' +
    (problems === 0
      ? '  سامانه سالم است.\n\n'
      : `  ${problems} مشکل جدی پیدا شد که باید رفع شود.\n\n`),
  );

  return problems > 0 ? 1 : 0;
}

function describeCounts(counts: Record<string, number>): string {
  const labels: Record<string, string> = {
    new: 'تازه', irrelevant: 'نامرتبط', duplicate: 'تکراری', ready: 'آمادهٔ بازنویسی',
    processing: 'در حال پردازش', processed: 'بازنویسی‌شده', failed: 'ناموفق',
    pending_review: 'در انتظار تأیید', approved: 'تأییدشده', publishing: 'در حال ارسال',
    published: 'منتشرشده', rejected: 'ردشده',
  };
  const parts = Object.entries(counts).map(([key, value]) => `${labels[key] ?? key}: ${value}`);
  return parts.length > 0 ? parts.join('، ') : 'خالی';
}
