/**
 * انتشار خبر در کانال تلگرام کاکو نیوز.
 *
 * مثل انتشار در سایت، ورودی فقط ردیف‌های `publications` با مقصد
 * `telegram` و وضعیت `pending` است — یعنی چیزی که سردبیر تأیید کرده.
 *
 * دو نکتهٔ اختصاصی تلگرام:
 *   - اگر خبر تصویر داشته باشد، به‌صورت **عکس + کپشن** می‌رود، نه متن
 *     خالی. کپشن سقف ۱۰۲۴ نویسه دارد، پس متن خبر کوتاه می‌شود ولی
 *     تیتر و لینک «ادامه در سایت» همیشه می‌مانند.
 *   - لینک پست به نشانی واقعی خبر در سایت اشاره می‌کند؛ اگر خبر هنوز
 *     در سایت منتشر نشده، نشانی از روی اسلاگ ساخته می‌شود.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { env, requireEnv } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';
import { AppError, errorMessage } from '../lib/errors.ts';
import { truncate } from '../lib/text.ts';
import { sleep } from '../lib/http.ts';
import { TelegramClient } from './telegram.ts';
import { renderTelegramMessage, renderTelegramCaption } from './render.ts';
import { downloadImage } from './images.ts';
import { markArticlePublishedIfDone } from './website.ts';
import {
  pendingPublications, markPublicationSent, markPublicationFailed,
  publicationsFor, type PublicationRow,
} from '../db/repositories/publications.ts';
import {
  findArticle, articleSources, setArticleStatus, type ArticleRow,
} from '../db/repositories/articles.ts';
import { query } from '../db/pool.ts';
import { startJobRun, finishJobRun, recordEvent } from '../db/repositories/job-runs.ts';
import { buildSourceLine } from '../pipeline/rewrite-validate.ts';

const logger = createLogger('publish');

export function isTelegramConfigured(): boolean {
  const e = env();
  return Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHANNEL_ID);
}

export function createTelegramClient(): TelegramClient {
  const e = requireEnv(['TELEGRAM_BOT_TOKEN'], 'انتشار در کانال تلگرام');
  return new TelegramClient({ botToken: e.TELEGRAM_BOT_TOKEN!, logger });
}

/**
 * نشانی خبر برای لینک پست.
 * اگر خبر در سایت منتشر شده، نشانی واقعی همان پست استفاده می‌شود؛
 * وگرنه از روی اسلاگ ساخته می‌شود (وردپرس هم همین اسلاگ را می‌گیرد).
 */
export async function articleLink(article: ArticleRow): Promise<string> {
  const app = loadAppConfig();
  const publications = await publicationsFor(article.id);
  const website = publications.find((p) => p.target === 'website' && p.status === 'sent');
  if (website?.external_url) return website.external_url;

  return `${app.brand.site_url.replace(/\/+$/, '')}/${article.slug}`;
}

export type TelegramPublishResult = {
  messageId: number;
  asPhoto: boolean;
  truncated: boolean;
  length: number;
};

/**
 * انتشار یک خبر در کانال. از دیتابیس جداست تا مستقیم قابل تست باشد.
 */
export async function publishArticleToTelegram(
  client: TelegramClient,
  article: ArticleRow,
  context: { sourceLine: string; link: string; channelId: string },
): Promise<TelegramPublishResult> {
  const app = loadAppConfig();
  const renderable = {
    title: article.title,
    lead: article.lead,
    body: article.body,
    slug: article.slug,
    imageCredit: article.image_credit,
  };
  const renderOptions = {
    link: context.link,
    readMoreLabel: app.publishing.telegram.read_more_label,
    sourceLine: context.sourceLine,
    footer: app.brand.telegram_footer,
  };

  // --- تلاش برای ارسال عکس + کپشن ---
  if (app.publishing.telegram.prefer_photo && article.image_url) {
    try {
      // فایل دانلودشده در مرحلهٔ انتشار سایت را دوباره استفاده می‌کنیم
      const local = article.image_path
        ? { path: article.image_path, filename: article.image_path.split('/').pop() ?? 'photo.jpg' }
        : await downloadImage(article.image_url, { logger }).then((img) =>
            img ? { path: img.path, filename: img.filename } : null,
          );

      const caption = renderTelegramCaption(renderable, renderOptions);
      const result = local
        ? await client.sendPhoto({
            chatId: context.channelId,
            caption: caption.text,
            filePath: local.path,
            filename: local.filename,
          })
        : await client.sendPhoto({
            chatId: context.channelId,
            caption: caption.text,
            photoUrl: article.image_url,
          });

      return {
        messageId: result.messageId,
        asPhoto: true,
        truncated: caption.truncated,
        length: caption.length,
      };
    } catch (err) {
      // عکس نرفت — خبر نباید قربانی تصویر شود، پس متنی می‌فرستیم
      logger.warn('ارسال عکس به تلگرام ناموفق بود؛ خبر به‌صورت متن فرستاده می‌شود',
        { article_id: article.id }, err);
    }
  }

  const message = renderTelegramMessage(renderable, renderOptions);
  const result = await client.sendMessage({
    chatId: context.channelId,
    text: message.text,
    disableWebPagePreview: app.publishing.telegram.disable_web_page_preview,
  });

  return {
    messageId: result.messageId,
    asPhoto: false,
    truncated: message.truncated,
    length: message.length,
  };
}

/** خطای دائمی (توکن غلط، ساختار پیام) یا گذرا (قطعی تلگرام)؟ */
export function isPermanentTelegramFailure(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.code === 'TELEGRAM_AUTH' || err.code === 'TELEGRAM_BAD_REQUEST';
}

export type TelegramPublishStats = {
  examined: number;
  published: number;
  failed: number;
};

export type TelegramPublishOptions = {
  limit?: number;
  dryRun?: boolean;
  client?: TelegramClient;
  channelId?: string;
};

export async function runTelegramPublisher(
  options: TelegramPublishOptions = {},
): Promise<TelegramPublishStats> {
  const { limit = 20, dryRun = false } = options;
  const app = loadAppConfig();
  const stats: TelegramPublishStats = { examined: 0, published: 0, failed: 0 };

  const channelId = options.channelId ?? env().TELEGRAM_CHANNEL_ID;
  if (!options.client && !isTelegramConfigured()) {
    logger.error('تلگرام تنظیم نشده؛ انتشار در کانال ممکن نیست', {
      help: 'TELEGRAM_BOT_TOKEN و TELEGRAM_CHANNEL_ID را در .env بگذارید',
    });
    return stats;
  }
  if (!channelId) {
    logger.error('شناسهٔ کانال تلگرام مشخص نیست', { help: 'TELEGRAM_CHANNEL_ID را در .env بگذارید' });
    return stats;
  }

  const pending = await pendingPublications('telegram', limit);
  stats.examined = pending.length;

  if (pending.length === 0) {
    logger.debug('خبری در صف انتشار تلگرام نیست');
    return stats;
  }

  const jobId = dryRun ? 0 : await startJobRun('publish');
  const client = options.client ?? createTelegramClient();

  logger.info('شروع انتشار در کانال تلگرام', {
    pending: pending.length, channel: channelId, dry_run: dryRun,
  });

  for (const [index, publication] of pending.entries()) {
    // فاصله بین پست‌ها، تا محدودیت نرخ تلگرام فعال نشود
    if (index > 0 && !dryRun) await sleep(app.publishing.telegram.delay_between_posts_ms);
    await publishOne(client, publication, channelId, dryRun, stats);
  }

  if (!dryRun) {
    await finishJobRun(jobId, {
      status: 'success',
      itemsFound: stats.examined,
      itemsNew: stats.published,
      itemsFailed: stats.failed,
      meta: { target: 'telegram' },
    });
  }

  logger.info('انتشار در کانال تلگرام تمام شد', {
    examined: stats.examined, published: stats.published, failed: stats.failed,
  });
  return stats;
}

async function publishOne(
  client: TelegramClient,
  publication: PublicationRow,
  channelId: string,
  dryRun: boolean,
  stats: TelegramPublishStats,
): Promise<void> {
  const app = loadAppConfig();
  const article = await findArticle(publication.article_id);

  if (!article) {
    logger.warn('خبر مربوط به این درخواست انتشار پیدا نشد', { publication_id: publication.id });
    if (!dryRun) await markPublicationFailed(publication.id, 'خبر در دیتابیس پیدا نشد');
    stats.failed++;
    return;
  }

  if (article.status !== 'approved' && article.status !== 'publishing' && article.status !== 'published') {
    logger.warn('خبر در وضعیت تأییدشده نیست؛ انتشار انجام نشد', {
      article_id: article.id, status: article.status,
    });
    if (!dryRun) {
      await markPublicationFailed(publication.id, `وضعیت خبر «${article.status}» است، نه تأییدشده`);
    }
    stats.failed++;
    return;
  }

  const sources = await articleSources(article.id);
  const sourceLine = buildSourceLine(sources, app.rewrite.source_line_template);
  const link = await articleLink(article);

  if (dryRun) {
    logger.info(`(آزمایشی) آمادهٔ ارسال به کانال — ${truncate(article.title, 45)}`, {
      article_id: article.id, link,
    });
    stats.published++;
    return;
  }

  try {
    const result = await publishArticleToTelegram(client, article, {
      sourceLine, link, channelId,
    });

    await markPublicationSent(publication.id, {
      externalId: String(result.messageId),
      externalUrl: telegramMessageUrl(channelId, result.messageId),
    });
    await query('UPDATE publications SET meta = $2 WHERE id = $1', [
      publication.id,
      JSON.stringify({
        message_id: result.messageId,
        as_photo: result.asPhoto,
        truncated: result.truncated,
        length: result.length,
        channel: channelId,
      }),
    ]);

    await markArticlePublishedIfDone(article.id);

    logger.info(`در کانال منتشر شد — ${truncate(article.title, 45)}`, {
      article_id: article.id,
      message_id: result.messageId,
      as_photo: result.asPhoto,
      truncated: result.truncated,
    });

    await recordEvent({
      stage: 'publish',
      message: `در کانال تلگرام منتشر شد: ${truncate(article.title, 60)}`,
      articleId: article.id,
      meta: { target: 'telegram', message_id: result.messageId, as_photo: result.asPhoto },
    });

    stats.published++;
  } catch (err) {
    stats.failed++;
    const message = errorMessage(err);
    const permanent = isPermanentTelegramFailure(err);

    await setArticleStatus(article.id, 'approved');
    await markPublicationFailed(publication.id, message);

    logger.error(
      permanent
        ? 'انتشار در کانال ناموفق بود (مشکل تنظیمات یا ساختار پیام)'
        : 'انتشار در کانال ناموفق بود؛ در اجرای بعدی دوباره تلاش می‌شود',
      { article_id: article.id, permanent },
      err,
    );

    await recordEvent({
      stage: 'publish',
      level: 'error',
      message: `انتشار در کانال ناموفق: ${message}`,
      articleId: article.id,
      meta: { target: 'telegram', permanent },
    });
  }
}

/** نشانی پست در کانال عمومی؛ برای کانال خصوصی نشانی عمومی وجود ندارد. */
function telegramMessageUrl(channelId: string, messageId: number): string | null {
  if (!channelId.startsWith('@')) return null;
  return `https://t.me/${channelId.slice(1)}/${messageId}`;
}
