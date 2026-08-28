/**
 * موتور بازنویسی خبر.
 *
 * خبر خامِ آمادهٔ بازنویسی را به مدل زبانی می‌دهد و خروجی ساختاریافته را
 * پس از اعتبارسنجی، به‌صورت خبر کاکو نیوز با وضعیت `pending_review` ثبت
 * می‌کند. **هیچ مسیری برای انتشار خودکار وجود ندارد.**
 *
 * سه محافظ روی خروجی مدل:
 *   ۱. اعتبارسنجی ساختار (rewrite-validate.ts)
 *   ۲. تشخیص کپی عینی — اگر مدل به‌جای بازنویسی کپی کرده باشد، یک بار
 *      دیگر با تذکر صریح‌تر امتحان می‌شود و اگر باز هم کپی بود، خبر
 *      با وضعیت failed کنار گذاشته می‌شود تا هرگز منتشر نشود.
 *   ۳. ثبت هزینه و مدت زمان هر تماس، برای بازبینی کیفیت و هزینه.
 */
import fs from 'node:fs';
import { loadAppConfig, type AppConfig } from '../config/app-config.ts';
import { fromRoot } from '../config/paths.ts';
import { env } from '../config/env.ts';
import { chatJson, isOpenAiConfigured, type ChatMessage } from '../lib/openai.ts';
import { verbatimOverlap, type VerbatimReport } from '../lib/similarity.ts';
import { createLogger } from '../lib/logger.ts';
import { AppError, errorMessage, settleAll } from '../lib/errors.ts';
import { truncate } from '../lib/text.ts';
import {
  rawArticlesByStatus, updateRawArticleStatus, duplicatesOf, type RawArticleRow,
} from '../db/repositories/raw-articles.ts';
import { insertArticle, articleExistsForRaw } from '../db/repositories/articles.ts';
import { listSources } from '../db/repositories/sources.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';
import { validateRewrite, type RawRewriteOutput, type ValidatedRewrite } from './rewrite-validate.ts';

const logger = createLogger('rewrite');

// ---------------------------------------------------------------
// ساخت پیام‌های ارسالی به مدل
// ---------------------------------------------------------------

let cachedPrompt: string | null = null;

/** پرامپت سیستمی با جانشین‌های پرشده. */
export function buildSystemPrompt(app: AppConfig): string {
  if (cachedPrompt !== null) return cachedPrompt;

  const promptPath = fromRoot(app.rewrite.system_prompt_file);
  const stylePath = fromRoot(app.rewrite.style_guide_file);

  for (const [label, path] of [['پرامپت بازنویسی', promptPath], ['راهنمای سبک', stylePath]]) {
    if (!fs.existsSync(path!)) throw new Error(`فایل ${label} پیدا نشد: ${path}`);
  }

  const styleGuide = fs.readFileSync(stylePath, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();

  cachedPrompt = fs
    .readFileSync(promptPath, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replaceAll('{{STYLE_GUIDE}}', styleGuide)
    .replaceAll('{{CATEGORIES}}', app.categories.map((c) => `- ${c}`).join('\n'))
    .replaceAll('{{BRAND_NAME}}', app.brand.name)
    .trim();

  return cachedPrompt;
}

export type SourceMaterial = {
  primary: { title: string; body: string; sourceName: string; publishedAt?: Date | null };
  supplementary: { title: string; body: string; sourceName: string }[];
};

/** متن ورودی که به مدل داده می‌شود. */
export function buildUserMessage(material: SourceMaterial): string {
  const parts: string[] = [
    '# خبر منبع',
    `منبع: ${material.primary.sourceName}`,
    material.primary.publishedAt
      ? `تاریخ انتشار در منبع: ${material.primary.publishedAt.toISOString()}`
      : '',
    '',
    `تیتر منبع: ${material.primary.title}`,
    '',
    'متن منبع:',
    material.primary.body,
  ].filter(Boolean);

  if (material.supplementary.length > 0) {
    parts.push(
      '',
      '---',
      '# منابع تکمیلی',
      'این‌ها گزارش‌های دیگری از همان رویدادند. جزئیاتی که فقط در این‌ها آمده',
      'را هم در متن بیاور، ولی خبر را دو بار تعریف نکن.',
    );
    for (const extra of material.supplementary) {
      parts.push('', `## ${extra.sourceName}`, `تیتر: ${extra.title}`, '', extra.body);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------
// یک بازنویسی
// ---------------------------------------------------------------

export type RewriteResult = {
  article: ValidatedRewrite;
  model: string;
  meta: Record<string, unknown>;
};

/**
 * تابعی که واقعاً با مدل حرف می‌زند. در تست‌ها با یک تابع ساختگی
 * جایگزین می‌شود تا کل مسیر بدون شبکه قابل آزمایش باشد.
 */
export type ChatFn = (
  messages: ChatMessage[],
  options: { model: string; temperature: number; maxOutputTokens: number },
) => Promise<{ data: RawRewriteOutput; model: string; usage: Record<string, number>; durationMs: number }>;

const defaultChat: ChatFn = async (messages, options) => {
  const { data, result } = await chatJson<RawRewriteOutput>(messages, {
    model: options.model,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    logger,
  });
  return {
    data,
    model: result.model,
    usage: { ...result.usage },
    durationMs: result.durationMs,
  };
};

/** تذکری که در تلاش دوم اضافه می‌شود، وقتی تلاش اول کپی از آب درآمده. */
const VERBATIM_WARNING =
  'تلاش قبلی تو بخش‌هایی از متن منبع را عیناً کپی کرده بود و پذیرفته نشد. ' +
  'این بار هر جمله را با ساختار و واژه‌های متفاوت از نو بنویس. ' +
  'اطلاعات، عددها و نام‌ها باید دقیقاً همان بمانند، ولی هیچ دنبالهٔ چندکلمه‌ای ' +
  'نباید با متن منبع یکسان باشد. فقط نقل قول مستقیم داخل گیومه می‌تواند عیناً بماند.';

/**
 * بازنویسی یک خبر، با اعتبارسنجی و بررسی کپی.
 * از دیتابیس جداست تا مستقیم قابل تست باشد.
 */
export async function rewriteOne(
  material: SourceMaterial,
  options: { app?: AppConfig; chat?: ChatFn } = {},
): Promise<RewriteResult> {
  const app = options.app ?? loadAppConfig();
  const chatFn = options.chat ?? defaultChat;

  const model = app.rewrite.model || env().OPENAI_MODEL;
  const systemPrompt = buildSystemPrompt(app);
  const userMessage = buildUserMessage(material);

  // متنی که خروجی مدل با آن مقایسه می‌شود: منبع اصلی به‌علاوهٔ تکمیلی‌ها
  const sourceText = [material.primary.body, ...material.supplementary.map((s) => s.body)].join('\n');

  const attempts: Record<string, unknown>[] = [];
  let lastVerbatim: VerbatimReport | null = null;
  let lastValidated: ValidatedRewrite | null = null;

  const maxAttempts = 2;   // تلاش دوم فقط برای حالت کپی
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(attempt > 1 ? [{ role: 'system' as const, content: VERBATIM_WARNING }] : []),
      { role: 'user', content: userMessage },
    ];

    const response = await chatFn(messages, {
      model,
      temperature: app.rewrite.temperature,
      maxOutputTokens: app.rewrite.max_output_tokens,
    });

    const validated = validateRewrite(response.data, { categories: app.categories });
    lastValidated = validated;

    const verbatim = verbatimOverlap(sourceText, `${validated.lead}\n\n${validated.body}`);
    lastVerbatim = verbatim;

    attempts.push({
      attempt,
      usage: response.usage,
      duration_ms: response.durationMs,
      verbatim_ratio: verbatim.ratio,
      longest_run: verbatim.longestRun,
      corrections: validated.corrections,
    });

    const tooClose =
      verbatim.ratio > app.rewrite.max_verbatim_ratio ||
      verbatim.longestRun > app.rewrite.max_verbatim_run;

    if (!tooClose) {
      return {
        article: validated,
        model: response.model,
        meta: { attempts, verbatim, final_attempt: attempt },
      };
    }

    logger.warn('خروجی مدل بیش از حد به متن منبع نزدیک بود', {
      attempt,
      ratio: verbatim.ratio,
      longest_run: verbatim.longestRun,
      sample: verbatim.sample ? truncate(verbatim.sample, 80) : null,
    });
  }

  // هر دو تلاش کپی بودند — خبر منتشر نمی‌شود
  throw new AppError(
    'REWRITE_TOO_SIMILAR',
    'بازنویسی پس از دو تلاش هنوز بیش از حد به متن منبع نزدیک است؛ خبر کنار گذاشته شد',
    {
      verbatim_ratio: lastVerbatim?.ratio,
      longest_run: lastVerbatim?.longestRun,
      sample: lastVerbatim?.sample,
      attempts,
      title: lastValidated?.title,
    },
  );
}


/**
 * آیا این شکست، مشکل *محتوای* خبر است یا مشکل *سرویس*؟
 *
 * مشکل محتوا (خروجی کپی بود، متن منبع ناقص است) با تلاش دوباره حل نمی‌شود
 * و خبر باید کنار گذاشته شود. مشکل سرویس (قطعی OpenAI، محدودیت نرخ، خطای
 * شبکه) گذراست و خبر باید برای اجرای بعدی نگه داشته شود.
 */
export function isContentFailure(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.code.startsWith('REWRITE_');
}

// ---------------------------------------------------------------
// اجرای مرحله روی دیتابیس
// ---------------------------------------------------------------

export type RewriteStats = {
  examined: number;
  created: number;
  failed: number;
  skipped: number;
};

export type RewriteOptions = {
  limit?: number;
  dryRun?: boolean;
};

export async function runRewrite(options: RewriteOptions = {}): Promise<RewriteStats> {
  const { limit = 20, dryRun = false } = options;
  const app = loadAppConfig();

  const stats: RewriteStats = { examined: 0, created: 0, failed: 0, skipped: 0 };

  if (!isOpenAiConfigured()) {
    logger.error('کلید OpenAI تنظیم نشده؛ بازنویسی ممکن نیست', {
      help: 'مقدار OPENAI_API_KEY را در فایل .env بگذارید',
    });
    return stats;
  }

  const jobId = dryRun ? 0 : await startJobRun('rewrite');
  const pending = await rawArticlesByStatus('ready', limit);
  stats.examined = pending.length;

  if (pending.length === 0) {
    logger.debug('خبری در انتظار بازنویسی نیست');
    if (!dryRun) await finishJobRun(jobId, { status: 'success' });
    return stats;
  }

  const sourceNames = new Map((await listSources()).map((s) => [s.id, s.name]));
  logger.info('شروع بازنویسی', {
    pending: pending.length,
    model: app.rewrite.model || env().OPENAI_MODEL,
    dry_run: dryRun,
  });

  // ترتیبی اجرا می‌شود تا محدودیت نرخ OpenAI فعال نشود
  const result = await settleAll(
    pending,
    async (row: RawArticleRow) => {
      if (await articleExistsForRaw(row.id)) {
        stats.skipped++;
        logger.debug('برای این خبر قبلاً نسخهٔ بازنویسی‌شده ساخته شده', { raw_id: row.id });
        if (!dryRun) await updateRawArticleStatus(row.id, 'processed');
        return;
      }

      const body = row.body ?? row.summary ?? '';
      if (body.trim().length < 100) {
        stats.skipped++;
        logger.warn('متن منبع برای بازنویسی خیلی کوتاه است؛ رد شد', {
          raw_id: row.id, length: body.trim().length,
        });
        if (!dryRun) {
          await updateRawArticleStatus(row.id, 'failed', { error: 'متن منبع برای بازنویسی کافی نیست' });
        }
        return;
      }

      if (!dryRun) await updateRawArticleStatus(row.id, 'processing');

      // منابع تکمیلی: خبرهایی که تکراریِ همین خبر تشخیص داده شده‌اند
      const duplicates = app.deduplication.on_duplicate === 'link'
        ? await duplicatesOf(row.id)
        : [];

      const material: SourceMaterial = {
        primary: {
          title: row.title,
          body,
          sourceName: sourceNames.get(row.source_id) ?? 'نامشخص',
          publishedAt: row.published_at,
        },
        supplementary: duplicates
          .filter((d) => (d.body ?? d.summary ?? '').trim().length > 80)
          .map((d) => ({
            title: d.title,
            body: d.body ?? d.summary ?? '',
            sourceName: sourceNames.get(d.source_id) ?? 'نامشخص',
          })),
      };

      try {
        const rewritten = await rewriteOne(material, { app });

        logger.info(`بازنویسی شد — ${truncate(rewritten.article.title, 50)}`, {
          raw_id: row.id,
          category: rewritten.article.category,
          tags: rewritten.article.tags.length,
          supplementary: material.supplementary.length,
        });

        for (const correction of rewritten.article.corrections) {
          logger.debug('اصلاح روی خروجی مدل', { raw_id: row.id, correction });
        }

        stats.created++;
        if (dryRun) return;

        const articleId = await insertArticle({
          rawArticleId: row.id,
          title: rewritten.article.title,
          lead: rewritten.article.lead,
          body: rewritten.article.body,
          category: rewritten.article.category,
          tags: rewritten.article.tags,
          imageUrl: row.image_url,
          imageCredit: row.image_url
            ? `عکس: ${sourceNames.get(row.source_id) ?? 'منبع'}`
            : null,
          rewriteModel: rewritten.model,
          rewriteMeta: { ...rewritten.meta, corrections: rewritten.article.corrections },
          supplementaryRawIds: duplicates.map((d) => d.id),
        });

        await updateRawArticleStatus(row.id, 'processed');
        await recordEvent({
          stage: 'rewrite',
          message: `بازنویسی شد و در صف تأیید قرار گرفت: ${truncate(rewritten.article.title, 60)}`,
          rawArticleId: row.id,
          articleId,
          sourceId: row.source_id,
          meta: {
            category: rewritten.article.category,
            supplementary_sources: material.supplementary.length,
            corrections: rewritten.article.corrections,
          },
        });
      } catch (err) {
        stats.failed++;
        const message = errorMessage(err);
        const permanent = isContentFailure(err);

        logger.error(
          permanent
            ? 'بازنویسی این خبر ناموفق بود؛ کنار گذاشته شد'
            : 'بازنویسی این خبر موقتاً ناموفق بود؛ در اجرای بعدی دوباره تلاش می‌شود',
          { raw_id: row.id, permanent },
          err,
        );

        if (!dryRun) {
          // خطای محتوایی (کپی بودن، متن ناقص) خودبه‌خود درست نمی‌شود → failed.
          // خطای سرویس (قطعی OpenAI، محدودیت نرخ، شبکه) گذراست → خبر در
          // وضعیت ready می‌ماند تا اجرای بعدی دوباره امتحان کند. بدون این
          // تفکیک، یک قطعی چنددقیقه‌ای OpenAI کل صف خبر را برای همیشه
          // دور می‌ریخت.
          await updateRawArticleStatus(row.id, permanent ? 'failed' : 'ready', { error: message });
          await recordEvent({
            stage: 'rewrite',
            level: 'error',
            message: permanent
              ? `بازنویسی ناموفق (کنار گذاشته شد): ${message}`
              : `بازنویسی موقتاً ناموفق (دوباره تلاش می‌شود): ${message}`,
            rawArticleId: row.id,
            sourceId: row.source_id,
            meta: err instanceof AppError ? { code: err.code, permanent, ...err.details } : { permanent },
          });
        }
      }
    },
    { concurrency: 1, label: (row) => `raw#${row.id}`, logger },
  );

  stats.failed += result.failed.length;

  if (!dryRun) {
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.examined,
      itemsNew: stats.created,
      itemsFailed: stats.failed,
      meta: { skipped: stats.skipped },
    });
  }

  logger.info('بازنویسی تمام شد', {
    examined: stats.examined, created: stats.created,
    failed: stats.failed, skipped: stats.skipped,
  });

  return stats;
}

/** فقط برای تست‌ها: کش پرامپت را پاک می‌کند. */
export function resetPromptCache(): void {
  cachedPrompt = null;
}
