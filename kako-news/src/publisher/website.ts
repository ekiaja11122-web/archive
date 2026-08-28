/**
 * انتشار خبر در سایت وردپرسی کاکو نیوز.
 *
 * ورودی این ماژول ردیف‌های `publications` با مقصد `website` و وضعیت
 * `pending` است — یعنی چیزهایی که **سردبیر تأیید کرده**. هیچ مسیری
 * وجود ندارد که خبری بدون آن ردیف منتشر شود.
 *
 * مثل مرحلهٔ بازنویسی، خطای گذرا (قطعی سایت، ۵۰۳) با خطای دائمی
 * (رمز اشتباه، دستهٔ نامعتبر) فرق دارد و در پنل جدا نمایش داده می‌شود.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { env, requireEnv } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { AppError, errorMessage } from '../lib/errors.ts';
import { truncate } from '../lib/text.ts';
import { WordPressClient } from './wordpress.ts';
import { downloadImage } from './images.ts';
import { renderWordPressContent, renderExcerpt } from './render.ts';
import {
  pendingPublications, markPublicationSent, markPublicationFailed,
  type PublicationRow,
} from '../db/repositories/publications.ts';
import {
  findArticle, articleSources, setArticleStatus, type ArticleRow,
} from '../db/repositories/articles.ts';
import { query } from '../db/pool.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';
import { buildSourceLine } from '../pipeline/rewrite-validate.ts';

const logger = createLogger('publish');

export type WebsitePublishResult = {
  postId: number;
  url: string;
  mediaId?: number | undefined;
  categoryId: number;
  tagIds: number[];
};

/** آیا وردپرس تنظیم شده است؟ (بدون پرتاب خطا) */
export function isWordPressConfigured(): boolean {
  const e = env();
  return Boolean(e.WORDPRESS_URL && e.WORDPRESS_USERNAME && e.WORDPRESS_APP_PASSWORD);
}

export function createWordPressClient(): WordPressClient {
  const e = requireEnv(
    ['WORDPRESS_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'],
    'انتشار در سایت وردپرسی',
  );
  return new WordPressClient({
    baseUrl: e.WORDPRESS_URL!,
    username: e.WORDPRESS_USERNAME!,
    appPassword: e.WORDPRESS_APP_PASSWORD!,
    logger,
  });
}

/**
 * انتشار یک خبر در وردپرس.
 * از دیتابیس جداست (کلاینت و منابع تزریق می‌شوند) تا مستقیم قابل تست باشد.
 */
export async function publishArticleToWordPress(
  client: WordPressClient,
  article: ArticleRow,
  sourceLine: string,
): Promise<WebsitePublishResult> {
  const app = loadAppConfig();

  // دستهٔ وردپرسی: اگر در کانفیگ نگاشت صریح داده شده از آن استفاده کن،
  // وگرنه بر اساس نام پیدا یا ساخته می‌شود.
  const mappedId = app.publishing.wordpress.category_map[article.category];
  const categoryId = mappedId ?? (await client.ensureTerm('categories', article.category));

  const tagIds = await client.ensureTags(article.tags);

  // تصویر شاخص — شکست آن نباید انتشار خبر را متوقف کند
  let mediaId: number | undefined;
  if (article.image_url) {
    try {
      const image = await downloadImage(article.image_url, { logger });
      if (image) {
        const uploaded = await client.uploadMedia(image.path, image.filename, image.mimeType);
        mediaId = uploaded.id;
        await query('UPDATE articles SET image_path = $2 WHERE id = $1', [article.id, image.path]);
      }
    } catch (err) {
      logger.warn('آپلود تصویر شاخص ناموفق بود؛ خبر بدون تصویر منتشر می‌شود',
        { article_id: article.id, url: article.image_url }, err);
    }
  }

  const post = await client.createPost({
    title: article.title,
    content: renderWordPressContent(
      {
        title: article.title,
        lead: article.lead,
        body: article.body,
        slug: article.slug,
        imageCredit: article.image_credit,
      },
      { sourceLine },
    ),
    excerpt: renderExcerpt({
      title: article.title, lead: article.lead, body: article.body, slug: article.slug,
    }),
    slug: article.slug,
    status: app.publishing.wordpress.post_status,
    categoryIds: [categoryId],
    tagIds,
    featuredMediaId: mediaId,
  });

  return { postId: post.id, url: post.link, mediaId, categoryId, tagIds };
}

/** خطای دائمی (تنظیمات غلط) یا گذرا (سایت پایین)؟ */
export function isPermanentPublishFailure(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.code === 'WORDPRESS_AUTH' || err.code === 'WORDPRESS_EMPTY_TERM';
}

export type PublishStats = {
  examined: number;
  published: number;
  failed: number;
};

export type PublishOptions = {
  limit?: number;
  dryRun?: boolean;
  /** کلاینت جایگزین، برای تست */
  client?: WordPressClient;
};

/** ارسال همهٔ خبرهای تأییدشده‌ای که منتظر انتشار در سایت‌اند. */
export async function runWebsitePublisher(options: PublishOptions = {}): Promise<PublishStats> {
  const { limit = 20, dryRun = false } = options;
  const app = loadAppConfig();
  const stats: PublishStats = { examined: 0, published: 0, failed: 0 };

  if (!options.client && !isWordPressConfigured()) {
    logger.error('وردپرس تنظیم نشده؛ انتشار در سایت ممکن نیست', {
      help: 'WORDPRESS_URL، WORDPRESS_USERNAME و WORDPRESS_APP_PASSWORD را در .env بگذارید',
    });
    return stats;
  }

  const pending = await pendingPublications('website', limit);
  stats.examined = pending.length;

  if (pending.length === 0) {
    logger.debug('خبری در صف انتشار سایت نیست');
    return stats;
  }

  const jobId = dryRun ? 0 : await startJobRun('publish');
  const client = options.client ?? createWordPressClient();

  logger.info('شروع انتشار در سایت', { pending: pending.length, dry_run: dryRun });

  // ترتیبی، تا فشار ناگهانی روی سایت وردپرسی نیاید
  for (const publication of pending) {
    await publishOne(client, publication, app.rewrite.source_line_template, dryRun, stats);
  }

  if (!dryRun) {
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.examined,
      itemsNew: stats.published,
      itemsFailed: stats.failed,
      meta: { target: 'website' },
    });
  }

  logger.info('انتشار در سایت تمام شد', {
    examined: stats.examined, published: stats.published, failed: stats.failed,
  });
  return stats;
}

async function publishOne(
  client: WordPressClient,
  publication: PublicationRow,
  sourceTemplate: string,
  dryRun: boolean,
  stats: PublishStats,
): Promise<void> {
  const app = loadAppConfig();
  const article = await findArticle(publication.article_id);

  if (!article) {
    logger.warn('خبر مربوط به این درخواست انتشار پیدا نشد', { publication_id: publication.id });
    if (!dryRun) await markPublicationFailed(publication.id, 'خبر در دیتابیس پیدا نشد');
    stats.failed++;
    return;
  }

  // سپر ایمنی: فقط خبر تأییدشده منتشر می‌شود
  if (article.status !== 'approved' && article.status !== 'publishing') {
    logger.warn('خبر در وضعیت تأییدشده نیست؛ انتشار انجام نشد', {
      article_id: article.id, status: article.status,
    });
    if (!dryRun) await markPublicationFailed(publication.id, `وضعیت خبر «${article.status}» است، نه تأییدشده`);
    stats.failed++;
    return;
  }

  const sources = await articleSources(article.id);
  const sourceLine = buildSourceLine(sources, sourceTemplate);

  if (dryRun) {
    logger.info(`(آزمایشی) آمادهٔ انتشار — ${truncate(article.title, 50)}`, {
      article_id: article.id, slug: article.slug,
    });
    stats.published++;
    return;
  }

  try {
    await setArticleStatus(article.id, 'publishing');
    const result = await publishArticleToWordPress(client, article, sourceLine);

    await markPublicationSent(publication.id, {
      externalId: String(result.postId),
      externalUrl: result.url,
    });
    await query('UPDATE publications SET meta = $2 WHERE id = $1', [
      publication.id,
      JSON.stringify({
        wp_post_id: result.postId,
        wp_media_id: result.mediaId ?? null,
        wp_category_id: result.categoryId,
        wp_tag_ids: result.tagIds,
      }),
    ]);

    await markArticlePublishedIfDone(article.id);

    logger.info(`منتشر شد در سایت — ${truncate(article.title, 50)}`, {
      article_id: article.id, wp_post_id: result.postId, url: result.url,
    });

    await recordEvent({
      stage: 'publish',
      message: `در سایت منتشر شد: ${truncate(article.title, 60)}`,
      articleId: article.id,
      meta: { target: 'website', wp_post_id: result.postId, url: result.url },
    });

    stats.published++;
  } catch (err) {
    stats.failed++;
    const message = errorMessage(err);
    const permanent = isPermanentPublishFailure(err);

    // خبر به وضعیت تأییدشده برمی‌گردد تا اجرای بعدی دوباره تلاش کند
    await setArticleStatus(article.id, 'approved');
    const outcome = await markPublicationFailed(publication.id, message, {
      permanent,
      maxAttempts: app.publishing.max_attempts,
      backoffSeconds: app.publishing.retry_backoff_seconds,
    });

    // پیام لاگ باید همان چیزی را بگوید که واقعاً اتفاق افتاده
    logger.error(
      outcome.status === 'failed'
        ? 'انتشار در سایت ناموفق بود و کنار گذاشته شد؛ در پنل قابل تلاش مجدد است'
        : 'انتشار در سایت ناموفق بود؛ تلاش بعدی زمان‌بندی شد',
      {
        article_id: article.id,
        permanent,
        attempt: outcome.attempts,
        max_attempts: app.publishing.max_attempts,
        next_attempt_at: outcome.nextAttemptAt,
      },
      err,
    );

    await recordEvent({
      stage: 'publish',
      level: 'error',
      message: `انتشار در سایت ناموفق: ${message}`,
      articleId: article.id,
      meta: {
        target: 'website', permanent,
        attempt: outcome.attempts, gave_up: outcome.status === 'failed',
      },
    });
  }
}

/**
 * اگر همهٔ مقصدهای درخواست‌شدهٔ یک خبر ارسال شده باشند، خبر «منتشرشده»
 * علامت می‌خورد. اگر یکی از مقصدها هنوز مانده، خبر در وضعیت تأییدشده
 * می‌ماند تا آن یکی هم برود.
 */
export async function markArticlePublishedIfDone(articleId: number): Promise<boolean> {
  const rows = await query<{ remaining: number }>(
    `SELECT COUNT(*)::int AS remaining FROM publications
     WHERE article_id = $1 AND status <> 'sent' AND status <> 'skipped'`,
    [articleId],
  );

  if ((rows[0]?.remaining ?? 0) > 0) {
    await setArticleStatus(articleId, 'approved');
    return false;
  }

  await query(
    `UPDATE articles SET status = 'published', published_at = COALESCE(published_at, now())
     WHERE id = $1`,
    [articleId],
  );
  return true;
}
