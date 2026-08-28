/**
 * دسترسی به جدول `sources`.
 *
 * منبع حقیقت، فایل `config/sources.yaml` است؛ این جدول آینهٔ آن است
 * به‌علاوهٔ وضعیت اجرایی (آخرین بررسی، آخرین خطا، شمار شکست‌های پیاپی).
 */
import { query, queryOne } from '../pool.ts';
import { sourceConfigPayload, type ResolvedSource } from '../../config/sources-config.ts';
import { createLogger } from '../../lib/logger.ts';

const logger = createLogger('collect');

export type SourceRow = {
  id: number;
  slug: string;
  name: string;
  url: string;
  homepage: string | null;
  type: string;
  enabled: boolean;
  poll_interval_seconds: number;
  config: Record<string, unknown>;
  last_polled_at: Date | null;
  last_success_at: Date | null;
  last_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
  consecutive_failures: number;
};

export type SyncSummary = { created: number; updated: number; disabled: string[] };

/**
 * همگام‌سازی فایل کانفیگ با دیتابیس.
 *
 * منبعی که از فایل حذف شده باشد، *پاک نمی‌شود* — فقط غیرفعال می‌شود،
 * چون خبرهای جمع‌آوری‌شده‌اش به آن ارجاع دارند و تاریخچه نباید از بین برود.
 */
export async function syncSources(sources: ResolvedSource[]): Promise<SyncSummary> {
  let created = 0;
  let updated = 0;

  for (const source of sources) {
    const row = await queryOne<{ id: number; existed: boolean }>(
      `INSERT INTO sources (slug, name, url, homepage, type, enabled, poll_interval_seconds, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name                  = EXCLUDED.name,
         url                   = EXCLUDED.url,
         homepage              = EXCLUDED.homepage,
         type                  = EXCLUDED.type,
         enabled               = EXCLUDED.enabled,
         poll_interval_seconds = EXCLUDED.poll_interval_seconds,
         config                = EXCLUDED.config
       RETURNING id, (xmax <> 0) AS existed`,
      [
        source.slug,
        source.name,
        source.url,
        source.homepage ?? null,
        source.type,
        source.enabled,
        source.pollIntervalSeconds,
        JSON.stringify(sourceConfigPayload(source)),
      ],
    );
    if (row?.existed) updated++;
    else created++;
  }

  // منابعی که دیگر در فایل نیستند
  const slugs = sources.map((s) => s.slug);
  const orphans = await query<{ slug: string }>(
    `UPDATE sources SET enabled = FALSE
     WHERE enabled = TRUE AND NOT (slug = ANY($1::text[]))
     RETURNING slug`,
    [slugs],
  );

  const disabled = orphans.map((o) => o.slug);
  if (disabled.length > 0) {
    logger.warn('منابعی که از فایل کانفیگ حذف شده‌اند غیرفعال شدند (پاک نشدند)', { disabled });
  }

  return { created, updated, disabled };
}

export async function listSources(onlyEnabled = false): Promise<SourceRow[]> {
  return query<SourceRow>(
    `SELECT * FROM sources ${onlyEnabled ? 'WHERE enabled' : ''} ORDER BY slug`,
  );
}

export async function findSourceBySlug(slug: string): Promise<SourceRow | null> {
  return queryOne<SourceRow>('SELECT * FROM sources WHERE slug = $1', [slug]);
}

/**
 * منابعی که وقت بررسی‌شان رسیده است.
 * منبعی که هرگز بررسی نشده، همیشه در نوبت است.
 */
export async function sourcesDueForPolling(): Promise<SourceRow[]> {
  return query<SourceRow>(
    `SELECT * FROM sources
     WHERE enabled
       AND (last_polled_at IS NULL
            OR last_polled_at < now() - (poll_interval_seconds || ' seconds')::interval)
     ORDER BY last_polled_at ASC NULLS FIRST`,
  );
}

export async function markSourcePolled(
  sourceId: number,
  result: { status: 'ok' | 'error' | 'skipped'; error?: string },
): Promise<void> {
  if (result.status === 'ok') {
    await query(
      `UPDATE sources
       SET last_polled_at = now(), last_success_at = now(),
           last_status = 'ok', last_error = NULL, consecutive_failures = 0
       WHERE id = $1`,
      [sourceId],
    );
    return;
  }

  await query(
    `UPDATE sources
     SET last_polled_at = now(), last_status = $2, last_error = $3,
         consecutive_failures = consecutive_failures + 1
     WHERE id = $1`,
    [sourceId, result.status, result.error?.slice(0, 1000) ?? null],
  );
}
