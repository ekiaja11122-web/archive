#!/usr/bin/env node
/**
 * نقطهٔ ورود خط فرمان کاکو نیوز.
 *
 *   npm run kako -- <command> [options]
 *
 * فرمان‌های موجود در این مایل‌استون:
 *   migrate       اعمال مهاجرت‌های دیتابیس
 *   db:status     نمایش وضعیت اتصال و مهاجرت‌ها
 *   config:check  اعتبارسنجی .env و config/app.yaml بدون اجرای کاری
 */
import { env } from '../config/env.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { runMigrations, migrationStatus } from '../db/migrate.ts';
import { ping, closePool } from '../db/pool.ts';
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
};

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
