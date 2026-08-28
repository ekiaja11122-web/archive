/**
 * قرارداد مشترک آداپتورهای منابع خبری (الگوی Adapter).
 *
 * هر منبع خبری هرچقدر هم عجیب باشد، فقط باید `CollectedItem` تولید کند.
 * بقیهٔ پایپ‌لاین اصلاً نمی‌داند خبر از RSS آمده یا از اسکرِیپ HTML.
 * برای افزودن نوع منبع جدید کافی است یک آداپتور تازه بنویسید و در
 * `registry.ts` ثبتش کنید — هیچ جای دیگری از کد عوض نمی‌شود.
 */
import type { ResolvedSource } from '../config/sources-config.ts';
import type { Logger } from '../lib/logger.ts';

/** یک خبر همان‌طور که از منبع بیرون آمده، پیش از هر پردازشی. */
export type CollectedItem = {
  /** نشانی خبر در سایت منبع — کلید یکتای خبر در آن منبع */
  sourceUrl: string;
  title: string;
  summary?: string | undefined;
  /** متن کامل؛ اگر منبع فقط خلاصه داده و متن کامل گرفته نشده، خالی است */
  body?: string | undefined;
  publishedAt?: Date | undefined;
  author?: string | undefined;
  imageUrl?: string | undefined;
  /** دادهٔ خام منبع، برای دیباگ وقتی چیزی اشتباه استخراج شد */
  raw?: Record<string, unknown> | undefined;
};

export type CollectContext = {
  source: ResolvedSource;
  logger: Logger;
  /** سقف تعداد خبر در این اجرا */
  limit: number;
};

export type CollectResult = {
  items: CollectedItem[];
  /** خطاهای غیرکشنده — مثلاً یک آیتم از فهرست خراب بود ولی بقیه سالم */
  warnings: string[];
};

export interface SourceAdapter {
  /** نوع منبعی که این آداپتور پشتیبانی می‌کند */
  readonly type: string;
  /** فهرست خبرهای تازه را از منبع می‌گیرد */
  collect(context: CollectContext): Promise<CollectResult>;
}
