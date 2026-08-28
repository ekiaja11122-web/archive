/**
 * دسترسی به جدول `raw_articles` — خبرهای خام پیش از هر پردازشی.
 *
 * دو لایه محافظت در برابر ثبت تکراری:
 *   ۱. کلید یکتای (منبع، نشانی خبر) — همان خبر از همان منبع دوبار ثبت نمی‌شود.
 *   ۲. هش محتوا — اگر منبع نشانی خبر را عوض کند ولی متن همان باشد،
 *      باز هم تشخیص داده می‌شود.
 * (تشخیص خبر مشابه از منابع *مختلف* کار مایل‌استون ۳ است.)
 */
import { query, queryOne } from '../pool.ts';
import { contentHash, titleFingerprint, truncate } from '../../lib/text.ts';
import type { CollectedItem } from '../../collectors/types.ts';

export type RawArticleStatus =
  | 'new' | 'irrelevant' | 'duplicate' | 'processing' | 'processed' | 'failed';

export type RawArticleRow = {
  id: number;
  source_id: number;
  source_url: string;
  title: string;
  summary: string | null;
  body: string | null;
  published_at: Date | null;
  author: string | null;
  image_url: string | null;
  content_hash: string;
  title_fingerprint: string;
  status: RawArticleStatus;
  relevance_score: number | null;
  relevance_reason: string | null;
  duplicate_of_id: number | null;
  error: string | null;
  raw: Record<string, unknown>;
  collected_at: Date;
};

export type InsertOutcome =
  | { outcome: 'inserted'; id: number }
  | { outcome: 'duplicate_url'; id: number }
  | { outcome: 'duplicate_content'; id: number };

/**
 * ثبت یک خبر خام. اگر قبلاً ثبت شده باشد چیزی بازنویسی نمی‌شود و
 * فقط گزارش می‌دهد که تکراری بود.
 */
export async function insertRawArticle(
  sourceId: number,
  item: CollectedItem,
): Promise<InsertOutcome> {
  const hash = contentHash(item.title, item.body ?? item.summary ?? '');
  const fingerprint = titleFingerprint(item.title);

  // خبری با همین محتوا از همین منبع، حتی اگر نشانی‌اش فرق کند
  const sameContent = await queryOne<{ id: number }>(
    'SELECT id FROM raw_articles WHERE source_id = $1 AND content_hash = $2 LIMIT 1',
    [sourceId, hash],
  );
  if (sameContent) return { outcome: 'duplicate_content', id: sameContent.id };

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO raw_articles
       (source_id, source_url, title, summary, body, published_at, author,
        image_url, content_hash, title_fingerprint, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (source_id, source_url) DO NOTHING
     RETURNING id`,
    [
      sourceId,
      item.sourceUrl,
      truncate(item.title, 500, ''),
      item.summary ?? null,
      item.body ?? null,
      item.publishedAt ?? null,
      item.author ?? null,
      item.imageUrl ?? null,
      hash,
      fingerprint,
      JSON.stringify(item.raw ?? {}),
    ],
  );

  if (inserted) return { outcome: 'inserted', id: inserted.id };

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM raw_articles WHERE source_id = $1 AND source_url = $2',
    [sourceId, item.sourceUrl],
  );
  return { outcome: 'duplicate_url', id: existing?.id ?? 0 };
}

export async function findRawArticle(id: number): Promise<RawArticleRow | null> {
  return queryOne<RawArticleRow>('SELECT * FROM raw_articles WHERE id = $1', [id]);
}

/** خبرهای خام با وضعیت مشخص، برای مرحلهٔ بعدی پایپ‌لاین. */
export async function rawArticlesByStatus(
  status: RawArticleStatus,
  limit = 50,
): Promise<RawArticleRow[]> {
  return query<RawArticleRow>(
    `SELECT * FROM raw_articles WHERE status = $1
     ORDER BY published_at DESC NULLS LAST, collected_at DESC
     LIMIT $2`,
    [status, limit],
  );
}

export async function updateRawArticleStatus(
  id: number,
  status: RawArticleStatus,
  fields: {
    relevanceScore?: number | null;
    relevanceReason?: string | null;
    duplicateOfId?: number | null;
    error?: string | null;
  } = {},
): Promise<void> {
  await query(
    `UPDATE raw_articles SET
       status            = $2,
       relevance_score   = COALESCE($3, relevance_score),
       relevance_reason  = COALESCE($4, relevance_reason),
       duplicate_of_id   = COALESCE($5, duplicate_of_id),
       error             = $6
     WHERE id = $1`,
    [
      id,
      status,
      fields.relevanceScore ?? null,
      fields.relevanceReason ?? null,
      fields.duplicateOfId ?? null,
      fields.error?.slice(0, 2000) ?? null,
    ],
  );
}

/** شمار خبرها به تفکیک وضعیت — برای آمار پنل مدیریت. */
export async function countByStatus(since?: Date): Promise<Record<string, number>> {
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count FROM raw_articles
     ${since ? 'WHERE collected_at >= $1' : ''}
     GROUP BY status`,
    since ? [since] : [],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}
