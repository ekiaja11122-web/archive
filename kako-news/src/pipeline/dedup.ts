/**
 * مرحلهٔ تشخیص خبر تکراری.
 *
 * وقتی چند خبرگزاری یک رویداد را پوشش می‌دهند، کاکو نیوز نباید چند بار
 * همان خبر را منتشر کند. اما منبع دوم دور هم ریخته نمی‌شود: به همان خبر
 * به‌عنوان «منبع تکمیلی» وصل می‌شود تا در بازنویسی (مایل‌استون ۴) بتوان
 * از جزئیات هر دو استفاده کرد و در پایان خبر همهٔ منابع ذکر شوند.
 *
 * خبرها به ترتیب زمان انتشار پردازش می‌شوند، پس همیشه **قدیمی‌ترین
 * گزارش از یک رویداد، خبر اصلی** می‌شود و بقیه به آن وصل می‌شوند.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { articleSimilarity, type SimilarityBreakdown } from '../lib/similarity.ts';
import { createLogger } from '../lib/logger.ts';
import { settleAll } from '../lib/errors.ts';
import { truncate } from '../lib/text.ts';
import {
  articlesAwaitingDedup, dedupCandidates, updateRawArticleStatus, type RawArticleRow,
} from '../db/repositories/raw-articles.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';

const logger = createLogger('dedup');

export type DuplicateMatch = {
  primaryId: number;
  similarity: SimilarityBreakdown;
  /** آیا خبر مشابه از منبع دیگری بود؟ */
  crossSource: boolean;
};

export type DedupStats = {
  examined: number;
  unique: number;
  duplicates: number;
  failed: number;
};

export type DedupOptions = {
  limit?: number;
  dryRun?: boolean;
};

/**
 * پیدا کردن بهترین خبر مشابه در میان نامزدها.
 * اگر خبر مشابه خودش تکراری بوده، زنجیره دنبال می‌شود تا به خبر اصلی
 * برسیم — این‌طور به‌جای زنجیرهٔ A→B→C، همه به A وصل می‌شوند.
 */
export function findBestMatch(
  article: { id?: number; title: string; body?: string | null; source_id: number },
  candidates: {
    id: number; source_id: number; title: string; body: string | null;
    summary: string | null; duplicate_of_id: number | null;
  }[],
  options: { threshold: number; titleWeight: number },
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;

  for (const candidate of candidates) {
    const similarity = articleSimilarity(
      { title: article.title, body: article.body },
      { title: candidate.title, body: candidate.body ?? candidate.summary },
      { titleWeight: options.titleWeight },
    );

    if (similarity.score < options.threshold) continue;
    if (best && similarity.score <= best.similarity.score) continue;

    // اگر نامزد خودش تکراری بوده، به ریشهٔ زنجیره وصل می‌شویم
    const primaryId = candidate.duplicate_of_id ?? candidate.id;
    // سپر ایمنی: خبر هرگز نباید تکراریِ خودش اعلام شود
    if (article.id !== undefined && primaryId === article.id) continue;

    best = {
      primaryId,
      similarity,
      crossSource: candidate.source_id !== article.source_id,
    };
  }

  return best;
}

export async function runDedup(options: DedupOptions = {}): Promise<DedupStats> {
  const { limit = 100, dryRun = false } = options;
  const app = loadAppConfig();
  const jobId = dryRun ? 0 : await startJobRun('dedup');

  const pending = await articlesAwaitingDedup(limit);
  const stats: DedupStats = { examined: pending.length, unique: 0, duplicates: 0, failed: 0 };

  if (pending.length === 0) {
    logger.debug('خبری در انتظار تشخیص تکراری نیست');
    if (!dryRun) await finishJobRun(jobId, { status: 'success' });
    return stats;
  }

  logger.info('شروع تشخیص تکراری', {
    pending: pending.length,
    threshold: app.deduplication.similarity_threshold,
    lookback_hours: app.deduplication.lookback_hours,
    dry_run: dryRun,
  });

  const since = new Date(Date.now() - app.deduplication.lookback_hours * 3600_000);

  // ترتیبی، نه موازی: هر خبر باید تصمیم‌های خبرهای قبلی را ببیند،
  // وگرنه دو گزارش از یک رویداد هم‌زمان «یکتا» اعلام می‌شوند.
  const result = await settleAll(
    pending,
    async (row: RawArticleRow) => {
      const candidates = await dedupCandidates(row.id, since, app.deduplication.max_candidates);
      const match = findBestMatch(row, candidates, {
        threshold: app.deduplication.similarity_threshold,
        titleWeight: app.deduplication.title_weight,
      });

      if (!match) {
        stats.unique++;
        logger.debug(`یکتا — ${truncate(row.title, 50)}`, { raw_id: row.id });
        if (!dryRun) await updateRawArticleStatus(row.id, 'ready');
        return;
      }

      stats.duplicates++;
      const linking = app.deduplication.on_duplicate === 'link';
      const reason =
        `تکراریِ خبر #${match.primaryId} (شباهت ${match.similarity.score}` +
        `، تیتر ${match.similarity.titleScore}، متن ${match.similarity.bodyScore})` +
        `${match.similarity.sharedTerms.length > 0 ? ` — واژه‌های مشترک: ${match.similarity.sharedTerms.join('، ')}` : ''}`;

      logger.info(`تکراری — ${truncate(row.title, 45)}`, {
        raw_id: row.id,
        primary_id: match.primaryId,
        similarity: match.similarity.score,
        cross_source: match.crossSource,
      });

      if (dryRun) return;

      await updateRawArticleStatus(row.id, 'duplicate', {
        duplicateOfId: match.primaryId,
        duplicateSimilarity: match.similarity.score,
      });

      await recordEvent({
        stage: 'dedup',
        message: linking
          ? `به‌عنوان منبع تکمیلی به خبر #${match.primaryId} وصل شد — ${reason}`
          : `به‌عنوان تکراری کنار گذاشته شد — ${reason}`,
        rawArticleId: row.id,
        sourceId: row.source_id,
        meta: {
          primary_id: match.primaryId,
          similarity: match.similarity,
          cross_source: match.crossSource,
          mode: app.deduplication.on_duplicate,
        },
      });
    },
    { concurrency: 1, label: (row) => `raw#${row.id}`, logger },
  );

  stats.failed = result.failed.length;

  if (!dryRun) {
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.examined,
      itemsNew: stats.unique,
      itemsFailed: stats.failed,
      meta: { duplicates: stats.duplicates },
    });
  }

  logger.info('تشخیص تکراری تمام شد', {
    examined: stats.examined, unique: stats.unique, duplicates: stats.duplicates,
  });

  return stats;
}
