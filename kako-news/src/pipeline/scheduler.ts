/**
 * زمان‌بند اجرای دوره‌ای.
 *
 * چرا node-cron استفاده نشده: cron برای «هر روز ساعت ۸» ساخته شده، اما نیاز
 * ما این است که *هر منبع بازهٔ خودش* را داشته باشد (یکی هر ۵ دقیقه، یکی هر
 * ساعت). با cron باید برای هر منبع یک زمان‌بندی جدا ساخت و با هر ویرایش
 * فایل کانفیگ همه را دوباره ثبت کرد.
 *
 * راه ساده‌تر و دقیق‌تر: هر ۳۰ ثانیه یک «تیک» می‌زنیم و از دیتابیس می‌پرسیم
 * «کدام منبع وقتش رسیده؟». بازهٔ هر منبع در خودِ کوئری اعمال می‌شود، پس
 * تغییر کانفیگ بدون ری‌استارت اثر می‌کند و اگر برنامه مدتی خاموش بوده باشد،
 * منابع عقب‌افتاده در همان تیک اول بررسی می‌شوند.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { createLogger } from '../lib/logger.ts';
import { attempt } from '../lib/errors.ts';
import { runCollection } from './collect.ts';

const logger = createLogger('scheduler');

const TICK_INTERVAL_MS = 30_000;

export type SchedulerHandle = { stop: () => Promise<void> };

export function startScheduler(): SchedulerHandle {
  const app = loadAppConfig();

  if (!app.scheduler.enabled) {
    logger.warn('زمان‌بند در app.yaml غیرفعال است؛ جمع‌آوری فقط دستی انجام می‌شود');
    return { stop: async () => {} };
  }

  let running = false;      // جلوگیری از هم‌پوشانی دو دور جمع‌آوری
  let stopped = false;
  let currentRun: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    currentRun = (async () => {
      const result = await attempt(() => runCollection());
      if (!result.ok) {
        logger.error('دور جمع‌آوری با خطای غیرمنتظره تمام شد', {}, result.error);
      }
    })();
    await currentRun;
    running = false;
  }

  logger.info('زمان‌بند فعال شد', {
    tick_seconds: TICK_INTERVAL_MS / 1000,
    concurrency: app.scheduler.concurrency,
  });

  // اولین دور بلافاصله، تا لازم نباشد برای دیدن نتیجه منتظر تیک بعدی بمانیم
  void tick();
  const timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  timer.unref?.();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      logger.info('زمان‌بند در حال توقف؛ منتظر پایان دور جاری…');
      await currentRun.catch(() => {});
      logger.info('زمان‌بند متوقف شد');
    },
  };
}

/**
 * اجرای زمان‌بند تا وقتی سیگنال توقف برسد.
 * خاموش شدن تمیز مهم است: دور نیمه‌کاره نباید وسط ثبت خبر قطع شود.
 */
export async function runSchedulerUntilSignal(): Promise<void> {
  const handle = startScheduler();

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      logger.info('سیگنال توقف دریافت شد', { signal });
      void handle.stop().then(resolve);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });
}
