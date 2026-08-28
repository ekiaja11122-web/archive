/**
 * آداپتور منابع RSS/Atom.
 *
 * هر جا سایت منبع فید دارد، این آداپتور بر اسکرِیپ ترجیح دارد: فید یک
 * قرارداد پایدار است و با عوض شدن قالب سایت خراب نمی‌شود.
 * چون فیدها معمولاً فقط خلاصه دارند، در صورت فعال بودن `fetch_full_content`
 * متن کامل از صفحهٔ خود خبر گرفته می‌شود.
 */
import Parser from 'rss-parser';
import { SourceError } from '../lib/errors.ts';
import { fetchText, sleep, absoluteUrl } from '../lib/http.ts';
import { htmlToText, normalizeForDisplay, truncate } from '../lib/text.ts';
import { parseDate } from '../lib/date.ts';
import { fetchArticlePage } from './article-page.ts';
import type { CollectContext, CollectResult, CollectedItem, SourceAdapter } from './types.ts';

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
  author?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  enclosure?: { url?: string; type?: string };
  'media:content'?: { $?: { url?: string } };
  'media:thumbnail'?: { $?: { url?: string } };
};

const parser = new Parser<Record<string, unknown>, FeedItem>({
  customFields: {
    item: ['content:encoded', 'media:content', 'media:thumbnail'],
  },
});

export const rssAdapter: SourceAdapter = {
  type: 'rss',

  async collect({ source, logger, limit }: CollectContext): Promise<CollectResult> {
    const warnings: string[] = [];
    const fetchOptions = {
      timeoutMs: source.fetchSettings.timeout_ms,
      retries: source.fetchSettings.retries,
      ...(source.fetchSettings.user_agent ? { userAgent: source.fetchSettings.user_agent } : {}),
    };

    // خودمان فید را می‌گیریم (به‌جای parseURL) تا مهلت زمانی، تلاش مجدد
    // و تشخیص کدگذاری فارسی از لایهٔ http اعمال شود.
    const response = await fetchText(source.url, { ...fetchOptions, logger });

    let feed: Awaited<ReturnType<typeof parser.parseString>>;
    try {
      feed = await parser.parseString(response.body);
    } catch (err) {
      throw new SourceError(source.slug, `فید ${source.url} قابل تحلیل نبود`, { url: source.url }, err);
    }

    const entries = (feed.items ?? []).slice(0, limit);
    logger.debug('فید خوانده شد', { entries: entries.length, feed_title: feed.title });

    const items: CollectedItem[] = [];

    for (const [index, entry] of entries.entries()) {
      const link = absoluteUrl(entry.link ?? entry.guid, source.url);
      const title = normalizeForDisplay(entry.title ?? '');

      if (!link || !title) {
        warnings.push(`آیتم ${index + 1} فید عنوان یا لینک نداشت و رد شد`);
        continue;
      }

      const feedBodyHtml = entry['content:encoded'] ?? entry.content ?? '';
      const feedBody = feedBodyHtml ? normalizeForDisplay(htmlToText(feedBodyHtml)) : '';
      const summary = normalizeForDisplay(entry.contentSnippet ?? '') || truncate(feedBody, 300);

      const item: CollectedItem = {
        sourceUrl: link,
        title,
        summary: summary || undefined,
        body: feedBody || undefined,
        publishedAt: parseDate(entry.isoDate ?? entry.pubDate),
        author: normalizeForDisplay(entry.creator ?? entry.author ?? '') || undefined,
        imageUrl: imageFromEntry(entry, link),
        raw: { feed_item: entry as unknown as Record<string, unknown> },
      };

      // متن کامل را از صفحهٔ خبر می‌گیریم. اگر شکست خورد، همان خلاصهٔ فید
      // را نگه می‌داریم — خبر ناقص بهتر از خبر ازدست‌رفته است.
      if (source.fetch_full_content) {
        if (index > 0) await sleep(source.fetchSettings.request_delay_ms);
        try {
          const page = await fetchArticlePage(link, source.article, fetchOptions, logger);
          if (page.body && page.body.length > (item.body?.length ?? 0)) item.body = page.body;
          item.imageUrl ??= page.imageUrl;
          item.publishedAt ??= page.publishedAt;
          item.author ??= page.author;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`متن کامل «${truncate(title, 40)}» گرفته نشد: ${message}`);
          logger.warn('دریافت صفحهٔ خبر ناموفق بود؛ با خلاصهٔ فید ادامه می‌دهیم', { url: link }, err);
        }
      }

      items.push(item);
    }

    return { items, warnings };
  },
};

function imageFromEntry(entry: FeedItem, baseUrl: string): string | undefined {
  const enclosure = entry.enclosure?.type?.startsWith('image/') ? entry.enclosure.url : undefined;
  const candidate =
    enclosure ?? entry['media:content']?.$?.url ?? entry['media:thumbnail']?.$?.url;
  if (candidate) return absoluteUrl(candidate, baseUrl);

  // آخرین تلاش: اولین <img> داخل متن خود فید
  const html = entry['content:encoded'] ?? entry.content ?? '';
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return absoluteUrl(match?.[1], baseUrl);
}
