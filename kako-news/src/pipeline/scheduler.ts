/**
 * زمان‌بند سرویس کاکو نیوز.
 *
 * این چیزی است که روی سرور به‌صورت دائم اجرا می‌شود (`npm run worker`)
 * و کل مسیر خبر را دوره‌ای پیش می‌برد:
 *
 *     جمع‌آوری → فیلتر شیراز → تشخیص تکراری → بازنویسی → [صف تأیید] → انتشار
 *
 * صف تأیید عمداً وسط این زنجیره است: زمان‌بند خبر را تا `pending_review`
 * جلو می‌برد و آنجا می‌ایستد. انتشار فقط چیزهایی را برمی‌دارد که سردبیر
 * در پنل تأیید کرده است.
 *
 * چرا node-cron استفاده نشده: بازهٔ خواندن هر منبع در `sources.yaml`
 * جداگانه تعریف می‌شود و در خودِ کوئری دیتابیس اعمال می‌گردد. با cron
 * باید برای هر منبع یک زمان‌بندی جدا ثبت و با هر ویرایش فایل همه را
 * دوباره ساخت. یک «تیک» ساده هر ۳۰ ثانیه، هم دقیق‌تر است و هم بعد از
 * خاموشی برنامه، کارهای عقب‌افتاده را در همان تیک اول جبران می‌کند.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { createLogger } from '../lib/logger.ts';
import { attempt, errorMessage } from '../lib/errors.ts';
import { isOpenAiConfigured } from '../lib/openai.ts';
import { runCollection } from './collect.ts';
import { runFilter } from './relevance.ts';
import { runDedup } from './dedup.ts';
import { runRewrite } from './rewrite.ts';
import { runWebsitePublisher, isWordPressConfigured } from '../publisher/website.ts';
import { runTelegramPublisher, isTelegramConfigured } from '../publisher/channel.ts';

const logger = createLogger('scheduler');

const TICK_INTERVAL_MS = 30_000;

export type SchedulerHandle = { stop: () => Promise<void> };

/** یک کار دوره‌ای با بازهٔ خودش. */
type ScheduledTask = {
  name: string;
  intervalMs: number;
  enabled: boolean;
  lastRunAt: number;
  run: () => Promise<void>;
};

export function startScheduler(): SchedulerHandle {
  const app = loadAppConfig();

  if (!app.scheduler.enabled) {
    logger.warn('زمان‌بند در app.yaml غیرفعال است؛ همه‌چیز باید دستی اجرا شود');
    return { stop: async () => {} };
  }

  const stages = app.scheduler.stages;

  const tasks: ScheduledTask[] = [
    {
      name: 'جمع‌آوری',
      // بازهٔ واقعی هر منبع در دیتابیس اعمال می‌شود؛ اینجا فقط هر تیک
      // می‌پرسیم «کدام منبع وقتش رسیده؟»
      intervalMs: TICK_INTERVAL_MS,
      enabled: stages.collect,
      lastRunAt: 0,
      run: async () => {
        await runCollection();
      },
    },
    {
      name: 'پردازش',
      intervalMs: app.scheduler.pipeline_interval_seconds * 1000,
      enabled: stages.filter || stages.dedup || stages.rewrite,
      lastRunAt: 0,
      run: async () => {
        if (stages.filter) await runFilter({});
        if (stages.dedup) await runDedup({});
        if (stages.rewrite) {
          if (isOpenAiConfigured()) await runRewrite({});
          else logger.debug('بازنویسی رد شد: کلید OpenAI تنظیم نشده');
        }
      },
    },
    {
      name: 'انتشار',
      intervalMs: app.scheduler.publish_interval_seconds * 1000,
      enabled: stages.publish,
      lastRunAt: 0,
      run: async () => {
        // ترتیب مهم است: اول سایت، بعد تلگرام — تا لینک پست تلگرام به
        // نشانی واقعی خبر در سایت اشاره کند.
        if (isWordPressConfigured()) await runWebsitePublisher({});
        if (isTelegramConfigured()) await runTelegramPublisher({});
      },
    },
  ].filter((task) => task.enabled);

  let stopped = false;
  let running = false;
  let currentRun: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    // اجراهای هم‌پوشان ممنوع: اگر یک دور طول کشیده، تیک بعدی صبر می‌کند
    if (running || stopped) return;
    running = true;

    currentRun = (async () => {
      const now = Date.now();
      for (const task of tasks) {
        if (stopped) break;
        if (now - task.lastRunAt < task.intervalMs) continue;

        task.lastRunAt = now;
        const result = await attempt(task.run);
        if (!result.ok) {
          // شکست یک مرحله نباید بقیه یا خود سرویس را متوقف کند
          logger.error(`مرحلهٔ «${task.name}» با خطای غیرمنتظره تمام شد`, {
            stage: task.name, reason: errorMessage(result.error),
          }, result.error);
        }
      }
    })();

    await currentRun;
    running = false;
  }

  logger.info('زمان‌بند فعال شد', {
    tick_seconds: TICK_INTERVAL_MS / 1000,
    stages: tasks.map((t) => t.name).join('، '),
    pipeline_interval: app.scheduler.pipeline_interval_seconds,
    publish_interval: app.scheduler.publish_interval_seconds,
  });

  // دور اول بلافاصله، تا برای دیدن نتیجه منتظر تیک بعدی نمانیم
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
 * اجرای زمان‌بند تا رسیدن سیگنال توقف.
 * خاموش شدن تمیز مهم است: دور نیمه‌کاره نباید وسط ثبت خبر یا ارسال
 * به کانال قطع شود.
 */
export async function runSchedulerUntilSignal(): Promise<void> {
  const handle = startScheduler();

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string): void => {
      logger.info('سیگنال توقف دریافت شد', { signal });
      void handle.stop().then(resolve);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });
}
