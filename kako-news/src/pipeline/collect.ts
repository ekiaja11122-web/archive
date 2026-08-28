/**
 * هماهنگ‌کنندهٔ مرحلهٔ جمع‌آوری.
 *
 * قاعدهٔ کلیدی این ماژول: **خطای یک منبع نباید بقیه را زمین بزند.**
 * هر منبع در محفظهٔ خودش اجرا می‌شود؛ اگر سایت پایین باشد یا قالبش عوض
 * شده باشد، خطا در `sources.last_error` ثبت و در پنل دیده می‌شود، و
 * جمع‌آوری بقیهٔ منابع بدون وقفه ادامه پیدا می‌کند.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { loadSourcesConfig, type ResolvedSource } from '../config/sources-config.ts';
import { getAdapter } from '../collectors/registry.ts';
import { createLogger } from '../lib/logger.ts';
import { settleAll, errorMessage } from '../lib/errors.ts';
import {
  listSources, sourcesDueForPolling, markSourcePolled, type SourceRow,
} from '../db/repositories/sources.ts';
import { insertRawArticle } from '../db/repositories/raw-articles.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';

const logger = createLogger('collect');

export type SourceCollectStats = {
  slug: string;
  found: number;
  inserted: number;
  duplicates: number;
  warnings: string[];
  error?: string;
};

/**
 * تعریف منبع را از فایل کانفیگ برمی‌دارد و با ردیف دیتابیس تطبیق می‌دهد.
 * اگر منبعی در دیتابیس باشد ولی در فایل نه (مثلاً تازه حذف شده)، رد می‌شود.
 */
function resolveDefinition(row: SourceRow, definitions: ResolvedSource[]): ResolvedSource | null {
  return definitions.find((d) => d.slug === row.slug) ?? null;
}

/** جمع‌آوری از یک منبع مشخص. خطا را خودش مدیریت و ثبت می‌کند. */
export async function collectFromSource(
  row: SourceRow,
  definition: ResolvedSource,
): Promise<SourceCollectStats> {
  const sourceLogger = logger.child({ source: row.slug });
  const jobId = await startJobRun('collect', row.id);
  const stats: SourceCollectStats = {
    slug: row.slug, found: 0, inserted: 0, duplicates: 0, warnings: [],
  };

  try {
    sourceLogger.info('شروع جمع‌آوری از منبع', { type: row.type, url: row.url });

    const adapter = getAdapter(row.type);
    const result = await adapter.collect({
      source: definition,
      logger: sourceLogger,
      limit: definition.fetchSettings.max_items_per_run,
    });

    stats.found = result.items.length;
    stats.warnings = result.warnings;

    for (const item of result.items) {
      const outcome = await insertRawArticle(row.id, item);
      if (outcome.outcome === 'inserted') {
        stats.inserted++;
        await recordEvent({
          stage: 'collect',
          message: `خبر تازه ثبت شد: ${item.title}`,
          rawArticleId: outcome.id,
          sourceId: row.id,
          meta: { url: item.sourceUrl, has_body: Boolean(item.body) },
        });
      } else {
        stats.duplicates++;
      }
    }

    for (const warning of result.warnings) {
      sourceLogger.warn('هشدار در جمع‌آوری', { warning });
    }

    await markSourcePolled(row.id, { status: 'ok' });
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.found,
      itemsNew: stats.inserted,
      meta: { duplicates: stats.duplicates, warnings: stats.warnings.length },
    });

    sourceLogger.info('جمع‌آوری از منبع تمام شد', {
      found: stats.found, new: stats.inserted, duplicate: stats.duplicates,
    });
  } catch (err) {
    // اینجا خطا *بلعیده* می‌شود تا بقیهٔ منابع ادامه دهند؛ ثبتش در دیتابیس
    // و لاگ کافی است.
    const message = errorMessage(err);
    stats.error = message;

    sourceLogger.error('جمع‌آوری از این منبع شکست خورد؛ از آن عبور شد', { url: row.url }, err);
    await markSourcePolled(row.id, { status: 'error', error: message });
    await finishJobRun(jobId, { status: 'error', error: message, itemsFound: stats.found });
    await recordEvent({
      stage: 'collect',
      level: 'error',
      message: `جمع‌آوری از «${row.name}» ناموفق بود: ${message}`,
      sourceId: row.id,
    });
  }

  return stats;
}

export type CollectRunOptions = {
  /** فقط همین منبع (بر اساس slug) */
  only?: string | undefined;
  /** بازهٔ زمانی منابع را نادیده بگیر و همه را همین حالا بررسی کن */
  force?: boolean;
};

/** یک دور کامل جمع‌آوری از همهٔ منابعی که وقتشان رسیده است. */
export async function runCollection(options: CollectRunOptions = {}): Promise<SourceCollectStats[]> {
  const app = loadAppConfig();
  const definitions = loadSourcesConfig();

  let rows = options.force || options.only ? await listSources(true) : await sourcesDueForPolling();

  if (options.only) {
    rows = rows.filter((r) => r.slug === options.only);
    if (rows.length === 0) {
      logger.warn('منبعی با این شناسه پیدا نشد یا غیرفعال است', { slug: options.only });
      return [];
    }
  }

  if (rows.length === 0) {
    logger.debug('هیچ منبعی در نوبت بررسی نیست');
    return [];
  }

  logger.info('شروع دور جمع‌آوری', { sources: rows.length, concurrency: app.scheduler.concurrency });

  const { succeeded } = await settleAll(
    rows,
    async (row) => {
      const definition = resolveDefinition(row, definitions);
      if (!definition) {
        logger.warn('منبع در دیتابیس هست ولی در sources.yaml نیست؛ رد شد', { slug: row.slug });
        await markSourcePolled(row.id, { status: 'skipped', error: 'در فایل کانفیگ تعریف نشده' });
        return { slug: row.slug, found: 0, inserted: 0, duplicates: 0, warnings: [],
                 error: 'در sources.yaml تعریف نشده' } satisfies SourceCollectStats;
      }
      return collectFromSource(row, definition);
    },
    { concurrency: app.scheduler.concurrency, label: (row) => row.slug, logger },
  );

  const totals = succeeded.reduce(
    (acc, s) => ({
      found: acc.found + s.found,
      inserted: acc.inserted + s.inserted,
      failed: acc.failed + (s.error ? 1 : 0),
    }),
    { found: 0, inserted: 0, failed: 0 },
  );

  logger.info('دور جمع‌آوری تمام شد', {
    sources: rows.length,
    found: totals.found,
    new: totals.inserted,
    failed_sources: totals.failed,
  });

  return succeeded;
}
