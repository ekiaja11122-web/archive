/**
 * مرحلهٔ فیلتر مرتبط‌بودن با شیراز.
 *
 * تصمیم در دو لایه گرفته می‌شود تا هزینهٔ مدل زبانی فقط جایی خرج شود
 * که واقعاً لازم است:
 *
 *   امتیاز کلیدواژه‌ای ≥ آستانهٔ قطعی   → مرتبط، بدون تماس با مدل
 *   امتیاز < آستانهٔ نامرتبط           → نامرتبط، بدون تماس با مدل
 *   بینابین                            → از مدل زبانی پرسیده می‌شود
 *
 * اگر مدل در دسترس نباشد یا خطا بدهد، سیستم متوقف نمی‌شود: تصمیم به
 * همان معیار کلیدواژه‌ای برمی‌گردد و روش تصمیم `llm_failed` ثبت می‌شود
 * تا بعداً قابل بازبینی باشد.
 */
import fs from 'node:fs';
import { loadAppConfig } from '../config/app-config.ts';
import { fromRoot } from '../config/paths.ts';
import { chatJson, isOpenAiConfigured } from '../lib/openai.ts';
import { createLogger } from '../lib/logger.ts';
import { errorMessage, settleAll } from '../lib/errors.ts';
import { truncate } from '../lib/text.ts';
import { scoreRelevance, type KeywordScore } from './relevance-score.ts';
import {
  rawArticlesByStatus, updateRawArticleStatus, deleteRawArticle, type RawArticleRow,
} from '../db/repositories/raw-articles.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';

const logger = createLogger('filter');

export type RelevanceMethod = 'keyword' | 'llm' | 'llm_failed';

export type RelevanceDecision = {
  relevant: boolean;
  score: number;
  method: RelevanceMethod;
  reason: string;
  details: Record<string, unknown>;
};

let cachedPrompt: string | null = null;

function relevancePrompt(): string {
  if (cachedPrompt !== null) return cachedPrompt;
  const app = loadAppConfig();
  const path = fromRoot(app.relevance.llm_prompt_file);
  if (!fs.existsSync(path)) {
    throw new Error(`فایل پرامپت طبقه‌بندی پیدا نشد: ${path}`);
  }
  cachedPrompt = fs.readFileSync(path, 'utf8');
  return cachedPrompt;
}

type LlmVerdict = { relevant?: boolean; confidence?: number; reason?: string };

/** پرسیدن از مدل زبانی برای یک مورد مرزی. */
async function askLlm(
  title: string,
  body: string | null | undefined,
): Promise<{ relevant: boolean; confidence: number; reason: string }> {
  const { data } = await chatJson<LlmVerdict>(
    [
      { role: 'system', content: relevancePrompt() },
      {
        role: 'user',
        content: `تیتر: ${title}\n\nمتن:\n${truncate(body ?? '', 1500)}`,
      },
    ],
    { temperature: 0, maxOutputTokens: 200, logger },
  );

  return {
    relevant: data.relevant === true,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    reason: typeof data.reason === 'string' ? data.reason : 'بدون توضیح',
  };
}

/**
 * تصمیم‌گیری دربارهٔ یک خبر. از دیتابیس جداست تا مستقیم قابل تست باشد.
 */
export async function decideRelevance(
  title: string,
  body: string | null | undefined,
): Promise<RelevanceDecision> {
  const app = loadAppConfig();
  const keyword: KeywordScore = scoreRelevance(title, body, {
    titleMultiplier: app.relevance.title_multiplier,
    maxNegativePenalty: app.relevance.max_negative_penalty,
  });

  const details: Record<string, unknown> = {
    keyword_score: keyword.score,
    matches: keyword.matches.slice(0, 12),
    negative: keyword.negativeMatches.slice(0, 6),
  };

  if (keyword.score >= app.relevance.certain_threshold) {
    return { relevant: true, score: keyword.score, method: 'keyword', reason: keyword.reason, details };
  }

  if (keyword.score < app.relevance.irrelevant_threshold) {
    return { relevant: false, score: keyword.score, method: 'keyword', reason: keyword.reason, details };
  }

  // بازهٔ مشکوک
  if (!app.relevance.use_llm_for_uncertain || !isOpenAiConfigured()) {
    const why = !isOpenAiConfigured() ? 'کلید OpenAI تنظیم نشده' : 'پرسش از مدل غیرفعال است';
    return {
      relevant: keyword.score >= app.relevance.irrelevant_threshold,
      score: keyword.score,
      method: 'keyword',
      reason: `${keyword.reason} (مورد مرزی؛ ${why})`,
      details: { ...details, uncertain: true },
    };
  }

  try {
    const verdict = await askLlm(title, body);
    return {
      relevant: verdict.relevant,
      score: keyword.score,
      method: 'llm',
      reason: `مورد مرزی (امتیاز ${keyword.score}) — نظر مدل: ${verdict.reason}`,
      details: { ...details, uncertain: true, llm: verdict },
    };
  } catch (err) {
    // خطای مدل نباید خبر را از بین ببرد؛ به معیار کلیدواژه‌ای برمی‌گردیم
    logger.warn('پرسش از مدل زبانی ناموفق بود؛ تصمیم با کلیدواژه گرفته شد', {}, err);
    return {
      relevant: keyword.score >= app.relevance.irrelevant_threshold,
      score: keyword.score,
      method: 'llm_failed',
      reason: `${keyword.reason} (تماس با مدل ناموفق: ${errorMessage(err)})`,
      details: { ...details, uncertain: true, llm_error: errorMessage(err) },
    };
  }
}

export type FilterStats = {
  examined: number;
  relevant: number;
  irrelevant: number;
  askedLlm: number;
  failed: number;
};

export type FilterOptions = {
  limit?: number;
  /** تصمیم‌ها را فقط نمایش بده و در دیتابیس چیزی تغییر نده */
  dryRun?: boolean;
};

/** اجرای فیلتر روی خبرهای خامِ بررسی‌نشده. */
export async function runFilter(options: FilterOptions = {}): Promise<FilterStats> {
  const { limit = 100, dryRun = false } = options;
  const app = loadAppConfig();
  const jobId = dryRun ? 0 : await startJobRun('filter');

  const pending = (await rawArticlesByStatus('new', limit)).filter(
    (row) => row.relevance_score === null,
  );

  const stats: FilterStats = {
    examined: pending.length, relevant: 0, irrelevant: 0, askedLlm: 0, failed: 0,
  };

  if (pending.length === 0) {
    logger.debug('خبر بررسی‌نشده‌ای برای فیلتر وجود ندارد');
    if (!dryRun) await finishJobRun(jobId, { status: 'success' });
    return stats;
  }

  logger.info('شروع فیلتر مرتبط‌بودن با شیراز', { pending: pending.length, dry_run: dryRun });

  // ترتیبی اجرا می‌شود، نه موازی: موارد مرزی به OpenAI می‌روند و
  // موازی‌سازی بی‌دلیل، محدودیت نرخ سرویس را فعال می‌کند.
  await settleAll(
    pending,
    async (row: RawArticleRow) => {
      const decision = await decideRelevance(row.title, row.body ?? row.summary);
      if (decision.method !== 'keyword') stats.askedLlm++;

      const label = decision.relevant ? '✓ مرتبط' : '✗ نامرتبط';
      logger.debug(`${label} — ${truncate(row.title, 50)}`, {
        raw_id: row.id, score: decision.score, method: decision.method,
      });

      if (decision.relevant) stats.relevant++;
      else stats.irrelevant++;

      if (dryRun) return;

      if (decision.relevant) {
        // مرتبط است؛ در وضعیت new می‌ماند تا مرحلهٔ تشخیص تکراری آن را بردارد
        await updateRawArticleStatus(row.id, 'new', {
          relevanceScore: decision.score,
          relevanceReason: decision.reason,
          relevanceDetails: decision.details,
          relevanceMethod: decision.method,
        });
      } else if (app.relevance.keep_irrelevant) {
        // پیش‌فرض: بایگانی، نه حذف — تا بتوان تصمیم فیلتر را بعداً بازبینی
        // کرد و واژه‌نامه را بر اساس خطاهای واقعی بهبود داد.
        await updateRawArticleStatus(row.id, 'irrelevant', {
          relevanceScore: decision.score,
          relevanceReason: decision.reason,
          relevanceDetails: decision.details,
          relevanceMethod: decision.method,
        });
      } else {
        // فقط اگر سردبیر صراحتاً در app.yaml خواسته باشد
        await deleteRawArticle(row.id);
      }

      await recordEvent({
        stage: 'filter',
        level: decision.relevant ? 'info' : 'debug',
        message: `${label}: ${truncate(row.title, 60)}`,
        rawArticleId: row.id,
        sourceId: row.source_id,
        meta: { score: decision.score, method: decision.method },
      });
    },
    { concurrency: 1, label: (row) => `raw#${row.id}`, logger },
  ).then((result) => {
    stats.failed = result.failed.length;
  });

  if (!dryRun) {
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.examined,
      itemsNew: stats.relevant,
      itemsFailed: stats.failed,
      meta: { irrelevant: stats.irrelevant, asked_llm: stats.askedLlm },
    });
  }

  logger.info('فیلتر تمام شد', {
    examined: stats.examined, relevant: stats.relevant,
    irrelevant: stats.irrelevant, asked_llm: stats.askedLlm,
  });

  return stats;
}
