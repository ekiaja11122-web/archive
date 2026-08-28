/**
 * ابزارهای مدیریت خطا.
 *
 * قاعدهٔ اصلی سامانه: خطای یک منبع یا یک خبر نباید کل اجرا را متوقف کند.
 * `settleAll` و `attempt` همین را تضمین می‌کنند.
 */
import type { Logger } from './logger.ts';

/** خطایی که انتظارش را داریم و لازم نیست stack کامل لاگ شود. */
export class AppError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/** خطای مربوط به یک منبع خبری مشخص (سایت پایین است، HTML عوض شده و…). */
export class SourceError extends AppError {
  constructor(sourceSlug: string, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super('SOURCE_ERROR', message, { source: sourceSlug, ...details }, cause);
    this.name = 'SourceError';
  }
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** اجرای یک کار با گرفتن خطا به‌جای پرتاب آن. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

export type SettleResult<T> = {
  succeeded: T[];
  failed: { item: string; error: unknown }[];
};

/**
 * اجرای موازی چند کار مستقل با محدودیت هم‌زمانی.
 * شکست یک کار فقط لاگ می‌شود و بقیه ادامه می‌دهند.
 */
export async function settleAll<I, T>(
  items: I[],
  worker: (item: I) => Promise<T>,
  options: { concurrency?: number; label: (item: I) => string; logger: Logger },
): Promise<SettleResult<T>> {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const queue = [...items];
  const succeeded: T[] = [];
  const failed: { item: string; error: unknown }[] = [];

  async function runner(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      const label = options.label(item);
      const result = await attempt(() => worker(item));
      if (result.ok) {
        succeeded.push(result.value);
      } else {
        failed.push({ item: label, error: result.error });
        options.logger.error('کار با خطا متوقف شد و از آن عبور شد', { item: label }, result.error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, runner));
  return { succeeded, failed };
}

/** پیام خوانا از هر نوع خطا. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
