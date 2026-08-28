#!/usr/bin/env node
/**
 * نقطهٔ ورود خط فرمان کاکو نیوز.
 *
 *   npm run kako -- <command> [options]
 *
 * فرمان‌ها:
 *   migrate        اعمال مهاجرت‌های دیتابیس
 *   db:status      نمایش وضعیت اتصال و مهاجرت‌ها
 *   config:check   اعتبارسنجی .env و فایل‌های کانفیگ بدون اجرای کاری
 *   sources:sync   همگام‌سازی config/sources.yaml با دیتابیس
 *   sources:list   نمایش منابع و وضعیت سلامتشان
 *   collect        اجرای یک دور جمع‌آوری (اختیاری: --source=<slug> --force)
 *   filter         فیلتر مرتبط‌بودن با شیراز (اختیاری: --dry-run)
 *   dedup          تشخیص خبرهای تکراری (اختیاری: --dry-run)
 *   rewrite        بازنویسی خبرهای آماده و قرار دادن در صف تأیید
 *   queue          نمایش صف تأیید
 *   pipeline       اجرای پشت‌سرهم: collect → filter → dedup → rewrite
 *   serve          راه‌اندازی پنل مدیریت (صف تأیید)
 *   admin:create   ساخت یا تغییر رمز کاربر پنل
 *   worker         اجرای مداوم زمان‌بند تا زمان توقف دستی
 */
import { env } from '../config/env.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { loadSourcesConfig } from '../config/sources-config.ts';
import { runMigrations, migrationStatus } from '../db/migrate.ts';
import { ping, closePool } from '../db/pool.ts';
import { syncSources, listSources } from '../db/repositories/sources.ts';
import { countByStatus } from '../db/repositories/raw-articles.ts';
import { runCollection } from '../pipeline/collect.ts';
import { runFilter } from '../pipeline/relevance.ts';
import { runDedup } from '../pipeline/dedup.ts';
import { runRewrite } from '../pipeline/rewrite.ts';
import { buildSourceLine } from '../pipeline/rewrite-validate.ts';
import {
  articlesByStatus, articleSources, countArticlesByStatus,
} from '../db/repositories/articles.ts';
import { isOpenAiConfigured } from '../lib/openai.ts';
import { startAdminServer } from '../admin/server.ts';
import { createAdminUser, adminUserCount } from '../admin/auth.ts';
import { runSchedulerUntilSignal } from '../pipeline/scheduler.ts';
import { supportedTypes } from '../collectors/registry.ts';
import { formatTehran } from '../lib/date.ts';
import { createLogger } from '../lib/logger.ts';
import { errorMessage } from '../lib/errors.ts';

const logger = createLogger('system');

const COMMANDS: Record<string, { describe: string; run: () => Promise<number> }> = {
  migrate: {
    describe: 'اعمال مهاجرت‌های دیتابیس',
    run: async () => {
      const count = await runMigrations();
      logger.info('مهاجرت‌ها تمام شد', { applied: count });
      return 0;
    },
  },

  'db:status': {
    describe: 'نمایش وضعیت دیتابیس و مهاجرت‌ها',
    run: async () => {
      const alive = await ping();
      if (!alive) {
        logger.error('دیتابیس در دسترس نیست', { url: redactUrl(env().DATABASE_URL) });
        return 1;
      }
      logger.info('اتصال دیتابیس برقرار است', { url: redactUrl(env().DATABASE_URL) });

      const status = await migrationStatus();
      if (status.length === 0) {
        logger.warn('هیچ فایل مهاجرتی پیدا نشد');
        return 0;
      }
      for (const m of status) {
        const mark = m.applied ? '✓' : '·';
        const note = m.changedSinceApplied ? ' (فایل بعد از اعمال تغییر کرده!)' : '';
        process.stdout.write(`  ${mark} ${m.name}${note}\n`);
      }
      const pending = status.filter((m) => !m.applied).length;
      logger.info('خلاصهٔ مهاجرت‌ها', { total: status.length, pending });
      return 0;
    },
  },

  'config:check': {
    describe: 'اعتبارسنجی تنظیمات محیطی و فایل app.yaml',
    run: async () => {
      const e = env();
      const app = loadAppConfig();

      logger.info('تنظیمات محیطی سالم است', {
        node_env: e.NODE_ENV,
        database: redactUrl(e.DATABASE_URL),
      });
      logger.info('app.yaml سالم است', {
        brand: app.brand.name,
        categories: app.categories.length,
        scheduler: app.scheduler.enabled ? 'فعال' : 'غیرفعال',
      });

      const sources = loadSourcesConfig();
      logger.info('sources.yaml سالم است', {
        total: sources.length,
        enabled: sources.filter((s) => s.enabled).length,
        types: supportedTypes().join('/'),
      });

      const optional: [string, boolean][] = [
        ['OpenAI (بازنویسی)', Boolean(e.OPENAI_API_KEY)],
        ['تلگرام (انتشار در کانال)', Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHANNEL_ID)],
        ['وردپرس (انتشار در سایت)', Boolean(e.WORDPRESS_URL && e.WORDPRESS_APP_PASSWORD)],
        ['پنل مدیریت', Boolean(e.ADMIN_PASSWORD && e.SESSION_SECRET)],
      ];
      for (const [name, ready] of optional) {
        process.stdout.write(`  ${ready ? '✓' : '·'} ${name}${ready ? '' : ' — تنظیم نشده'}\n`);
      }
      return 0;
    },
  },

  'sources:sync': {
    describe: 'همگام‌سازی config/sources.yaml با دیتابیس',
    run: async () => {
      const sources = loadSourcesConfig();
      const summary = await syncSources(sources);
      logger.info('منابع همگام شدند', {
        new: summary.created,
        updated: summary.updated,
        disabled: summary.disabled.length,
      });
      if (summary.disabled.length > 0) {
        process.stdout.write(
          `  ⚠ این منابع دیگر در فایل نیستند و غیرفعال شدند: ${summary.disabled.join('، ')}\n`,
        );
      }
      return 0;
    },
  },

  'sources:list': {
    describe: 'نمایش منابع و وضعیت سلامت هرکدام',
    run: async () => {
      const rows = await listSources();
      if (rows.length === 0) {
        logger.warn('هیچ منبعی در دیتابیس نیست — اول npm run sources:sync را اجرا کنید');
        return 0;
      }
      for (const row of rows) {
        const state = !row.enabled ? '⏸ غیرفعال'
          : row.last_status === 'error' ? '✗ خطا'
          : row.last_status === 'ok' ? '✓ سالم'
          : '· بررسی‌نشده';
        process.stdout.write(
          `  ${state}  ${row.slug.padEnd(18)} ${row.type.padEnd(7)} ` +
          `هر ${row.poll_interval_seconds}ث  آخرین بررسی: ${formatTehran(row.last_polled_at)}\n`,
        );
        if (row.last_error) {
          process.stdout.write(`      └ ${row.last_error.slice(0, 150)}\n`);
        }
      }
      return 0;
    },
  },

  collect: {
    describe: 'اجرای یک دور جمع‌آوری  [--source=<slug>] [--force]',
    run: async () => {
      const only = flagValue('--source');
      const force = hasFlag('--force');

      const stats = await runCollection({ only, force });
      if (stats.length === 0) {
        logger.info('هیچ منبعی در نوبت بررسی نبود (برای اجرای فوری --force بزنید)');
        return 0;
      }

      process.stdout.write('\n  نتیجهٔ جمع‌آوری:\n');
      for (const s of stats) {
        const mark = s.error ? '✗' : '✓';
        process.stdout.write(
          `  ${mark} ${s.slug.padEnd(18)} یافت‌شده: ${String(s.found).padStart(3)}  ` +
          `تازه: ${String(s.inserted).padStart(3)}  تکراری: ${String(s.duplicates).padStart(3)}\n`,
        );
        if (s.error) process.stdout.write(`      └ خطا: ${s.error.slice(0, 150)}\n`);
        for (const warning of s.warnings.slice(0, 3)) {
          process.stdout.write(`      └ هشدار: ${warning.slice(0, 150)}\n`);
        }
      }

      const counts = await countByStatus();
      process.stdout.write(`\n  وضعیت خبرهای خام: ${JSON.stringify(counts)}\n\n`);
      return stats.some((s) => s.error) ? 1 : 0;
    },
  },

  filter: {
    describe: 'فیلتر مرتبط‌بودن خبرها با شیراز  [--dry-run] [--limit=<n>]',
    run: async () => {
      const dryRun = hasFlag('--dry-run');
      if (!isOpenAiConfigured()) {
        logger.warn('کلید OpenAI تنظیم نشده؛ موارد مرزی فقط با کلیدواژه تصمیم‌گیری می‌شوند');
      }
      const stats = await runFilter({ dryRun, limit: Number(flagValue('--limit') ?? 100) });
      process.stdout.write(
        `\n  بررسی‌شده: ${stats.examined}   مرتبط: ${stats.relevant}   ` +
        `نامرتبط: ${stats.irrelevant}   پرسش از مدل: ${stats.askedLlm}\n` +
        (dryRun ? '  (حالت آزمایشی — چیزی در دیتابیس تغییر نکرد)\n' : '') + '\n',
      );
      return 0;
    },
  },

  dedup: {
    describe: 'تشخیص خبرهای تکراری  [--dry-run] [--limit=<n>]',
    run: async () => {
      const dryRun = hasFlag('--dry-run');
      const stats = await runDedup({ dryRun, limit: Number(flagValue('--limit') ?? 100) });
      process.stdout.write(
        `\n  بررسی‌شده: ${stats.examined}   یکتا: ${stats.unique}   ` +
        `تکراری: ${stats.duplicates}\n` +
        (dryRun ? '  (حالت آزمایشی — چیزی در دیتابیس تغییر نکرد)\n' : '') + '\n',
      );
      return 0;
    },
  },

  rewrite: {
    describe: 'بازنویسی خبرهای آماده و قرار دادن در صف تأیید  [--dry-run] [--limit=<n>]',
    run: async () => {
      const dryRun = hasFlag('--dry-run');
      const stats = await runRewrite({ dryRun, limit: Number(flagValue('--limit') ?? 20) });
      process.stdout.write(
        `\n  بررسی‌شده: ${stats.examined}   بازنویسی‌شده: ${stats.created}   ` +
        `ناموفق: ${stats.failed}   رد شده: ${stats.skipped}\n` +
        (dryRun ? '  (حالت آزمایشی — چیزی در دیتابیس ثبت نشد)\n' : '') + '\n',
      );
      return 0;
    },
  },

  queue: {
    describe: 'نمایش صف تأیید (خبرهای منتظر تصمیم سردبیر)',
    run: async () => {
      const app = loadAppConfig();
      const pending = await articlesByStatus('pending_review', Number(flagValue('--limit') ?? 20));

      if (pending.length === 0) {
        logger.info('صف تأیید خالی است');
        return 0;
      }

      process.stdout.write(`\n  ${pending.length} خبر در انتظار تأیید:\n\n`);
      for (const article of pending) {
        const sources = await articleSources(article.id);
        const supplementary = sources.filter((s) => s.role === 'supplementary').length;

        process.stdout.write(`  ── #${article.id} ─────────────────────────────────\n`);
        process.stdout.write(`  تیتر : ${article.title}\n`);
        process.stdout.write(`  دسته : ${article.category}    برچسب‌ها: ${article.tags.join('، ')}\n`);
        process.stdout.write(`  لید  : ${article.lead}\n`);
        process.stdout.write(
          `  ${buildSourceLine(sources, app.rewrite.source_line_template)}` +
          `${supplementary > 0 ? `  (+${supplementary} منبع تکمیلی)` : ''}\n`,
        );
        process.stdout.write(`  نشانی: /${article.slug}\n\n`);
      }
      return 0;
    },
  },

  pipeline: {
    describe: 'اجرای پشت‌سرهم: جمع‌آوری ← فیلتر ← تکراری ← بازنویسی  [--force]',
    run: async () => {
      const force = hasFlag('--force');
      const collected = await runCollection({ force });
      const filtered = await runFilter({});
      const deduped = await runDedup({});
      const rewritten = await runRewrite({});

      const found = collected.reduce((n, s) => n + s.found, 0);
      const fresh = collected.reduce((n, s) => n + s.inserted, 0);
      process.stdout.write(
        `\n  جمع‌آوری : ${found} یافت‌شده، ${fresh} تازه\n` +
        `  فیلتر   : ${filtered.relevant} مرتبط، ${filtered.irrelevant} نامرتبط\n` +
        `  تکراری  : ${deduped.unique} یکتا، ${deduped.duplicates} تکراری\n` +
        `  بازنویسی: ${rewritten.created} خبر ساخته شد، ${rewritten.failed} ناموفق\n` +
        `\n  ${rewritten.created} خبر در صف تأیید قرار گرفت (npm run queue)\n\n`,
      );

      const raw = await countByStatus();
      const articles = await countArticlesByStatus();
      process.stdout.write(`  خبرهای خام      : ${JSON.stringify(raw)}\n`);
      process.stdout.write(`  خبرهای بازنویسی‌شده: ${JSON.stringify(articles)}\n\n`);
      return 0;
    },
  },

  serve: {
    describe: 'راه‌اندازی پنل مدیریت و صف تأیید',
    run: async () => {
      const e = env();
      await startAdminServer();
      process.stdout.write(
        `\n  پنل مدیریت روی این نشانی باز است:\n` +
        `      http://${e.ADMIN_HOST}:${e.ADMIN_PORT}\n\n` +
        `  برای توقف Ctrl+C بزنید.\n\n`,
      );
      // سرور تا رسیدن سیگنال توقف زنده می‌ماند
      await new Promise<void>(() => {});
      return 0;
    },
  },

  'admin:create': {
    describe: 'ساخت کاربر پنل یا تغییر رمز  --user=<نام> --password=<رمز>',
    run: async () => {
      const username = flagValue('--user') ?? env().ADMIN_USERNAME;
      const password = flagValue('--password') ?? env().ADMIN_PASSWORD;

      if (!password) {
        logger.error('رمز عبور مشخص نشده', {
          help: 'یا --password=<رمز> بدهید یا ADMIN_PASSWORD را در .env بگذارید',
        });
        return 1;
      }

      const existed = (await adminUserCount()) > 0;
      await createAdminUser(username, password, flagValue('--name') ?? 'سردبیر');
      logger.info(existed ? 'کاربر ساخته/به‌روزرسانی شد' : 'کاربر اول پنل ساخته شد', { username });
      return 0;
    },
  },

  worker: {
    describe: 'اجرای مداوم زمان‌بند (Ctrl+C برای توقف)',
    run: async () => {
      await runSchedulerUntilSignal();
      return 0;
    },
  },
};

function flagValue(name: string): string | undefined {
  const prefixed = process.argv.find((a) => a.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '***';
  }
}

function usage(): void {
  process.stdout.write('\nکاکو نیوز — ابزار خط فرمان\n\n  npm run kako -- <command>\n\nفرمان‌ها:\n');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    process.stdout.write(`  ${name.padEnd(14)} ${cmd.describe}\n`);
  }
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const name = process.argv[2];

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    usage();
    process.exitCode = name ? 0 : 1;
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    logger.error('فرمان ناشناخته', { command: name });
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    process.exitCode = await command.run();
  } catch (err) {
    logger.error('اجرای فرمان با خطا متوقف شد', { command: name, reason: errorMessage(err) }, err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await main();
