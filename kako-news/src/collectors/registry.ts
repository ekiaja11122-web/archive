/**
 * ثبت‌گاه آداپتورها.
 *
 * برای افزودن نوع منبع جدید (مثلاً کانال تلگرام یا API اختصاصی):
 *   ۱. یک آداپتور بنویسید که `SourceAdapter` را پیاده کند.
 *   ۲. اینجا ثبتش کنید.
 *   ۳. نوعش را به `sourceSchema` در `src/config/sources-config.ts` و به
 *      محدودیت `sources_type_check` در دیتابیس اضافه کنید.
 * هیچ جای دیگری از پایپ‌لاین لازم نیست تغییر کند.
 */
import { AppError } from '../lib/errors.ts';
import { rssAdapter } from './rss.ts';
import { scrapeAdapter } from './scrape.ts';
import { mockAdapter } from './mock.ts';
import type { SourceAdapter } from './types.ts';

const ADAPTERS = new Map<string, SourceAdapter>(
  [rssAdapter, scrapeAdapter, mockAdapter].map((a) => [a.type, a]),
);

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS.get(type);
  if (!adapter) {
    throw new AppError('UNKNOWN_ADAPTER', `نوع منبع پشتیبانی نمی‌شود: ${type}`, {
      type,
      supported: [...ADAPTERS.keys()],
    });
  }
  return adapter;
}

export function supportedTypes(): string[] {
  return [...ADAPTERS.keys()];
}

export type { SourceAdapter, CollectedItem, CollectResult } from './types.ts';
