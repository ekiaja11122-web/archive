/**
 * استخراج متن کامل خبر از صفحهٔ اختصاصی آن.
 *
 * هم آداپتور RSS از این استفاده می‌کند (چون فیدها معمولاً فقط خلاصه دارند)
 * و هم آداپتور اسکرِیپ. اگر سلکتوری در کانفیگ تعریف نشده باشد، سراغ
 * حدس‌های عمومی می‌رود: متاتگ‌های og:‎ و سپس تگ‌های <article> / <main>.
 */
import * as cheerio from 'cheerio';
import type { ArticleSelectors } from '../config/sources-config.ts';
import { fetchText, absoluteUrl, type FetchOptions } from '../lib/http.ts';
import { htmlToText, normalizeForDisplay } from '../lib/text.ts';
import { parseDate } from '../lib/date.ts';
import type { Logger } from '../lib/logger.ts';

export type ArticlePageData = {
  title?: string | undefined;
  body?: string | undefined;
  imageUrl?: string | undefined;
  publishedAt?: Date | undefined;
  author?: string | undefined;
};

/** سلکتورهایی که وقتی کانفیگ چیزی نگفته امتحان می‌شوند. */
const FALLBACK_BODY_SELECTORS = [
  'article',
  '[itemprop="articleBody"]',
  '.article-body',
  '.entry-content',
  '.post-content',
  '.news-body',
  '.item-text',
  'main',
];

/** المان‌هایی که تقریباً هیچ‌وقت بخشی از متن خبر نیستند. */
const ALWAYS_REMOVE = [
  'script', 'style', 'noscript', 'iframe', 'form', 'nav', 'aside',
  'header', 'footer', 'figcaption', '.advertisement', '.ads', '.related',
];

export async function fetchArticlePage(
  url: string,
  selectors: Partial<ArticleSelectors> | undefined,
  fetchOptions: FetchOptions,
  logger: Logger,
): Promise<ArticlePageData> {
  const response = await fetchText(url, { ...fetchOptions, logger });
  return extractArticlePage(response.body, response.url, selectors, logger);
}

/** جدا از دریافت شبکه نگه داشته شده تا بشود مستقیم روی HTML تست کرد. */
export function extractArticlePage(
  html: string,
  pageUrl: string,
  selectors: Partial<ArticleSelectors> | undefined,
  logger?: Logger,
): ArticlePageData {
  const $ = cheerio.load(html);

  // تصویر و تاریخ را پیش از حذف المان‌ها می‌خوانیم، چون ممکن است
  // داخل بخش‌هایی باشند که برای متن حذف می‌شوند (مثل figure).
  const imageUrl = extractImage($, pageUrl, selectors);
  const publishedAt = extractDate($, selectors);
  const author = extractAuthor($, selectors);
  const title = extractTitle($, selectors);

  for (const selector of [...ALWAYS_REMOVE, ...(selectors?.remove_selectors ?? [])]) {
    try {
      $(selector).remove();
    } catch {
      logger?.debug('سلکتور حذف نامعتبر بود و نادیده گرفته شد', { selector });
    }
  }

  const body = extractBody($, selectors, logger);

  return { title, body, imageUrl, publishedAt, author };
}

function extractTitle($: cheerio.CheerioAPI, selectors?: Partial<ArticleSelectors>): string | undefined {
  const candidates = [
    selectors?.title_selector,
    'meta[property="og:title"]',
    'h1',
    'title',
  ].filter(Boolean) as string[];

  for (const selector of candidates) {
    const el = $(selector).first();
    if (el.length === 0) continue;
    const value = selector.startsWith('meta') ? el.attr('content') : el.text();
    const cleaned = normalizeForDisplay(value ?? '');
    if (cleaned.length > 3) return cleaned;
  }
  return undefined;
}

function extractBody(
  $: cheerio.CheerioAPI,
  selectors?: Partial<ArticleSelectors>,
  logger?: Logger,
): string | undefined {
  const configured = selectors?.body_selector;
  const candidates = configured ? [configured, ...FALLBACK_BODY_SELECTORS] : FALLBACK_BODY_SELECTORS;

  let best: string | undefined;
  for (const selector of candidates) {
    let html: string;
    try {
      html = $(selector).map((_, el) => $(el).html() ?? '').get().join('\n');
    } catch {
      continue;
    }
    if (!html) continue;

    const text = normalizeForDisplay(htmlToText(html));
    // کوتاه‌ترین متن قابل قبول برای یک خبر
    if (text.length >= 200) {
      if (selector === configured) return text;   // سلکتور کانفیگ اولویت دارد
      best ??= text;
    }
  }

  if (configured && best) {
    logger?.warn('سلکتور متن در کانفیگ نتیجه نداد؛ از حدس عمومی استفاده شد', {
      selector: configured,
    });
  }
  return best;
}

function extractImage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  selectors?: Partial<ArticleSelectors>,
): string | undefined {
  if (selectors?.image_selector) {
    const attr = selectors.image_attribute ?? 'src';
    const value = $(selectors.image_selector).first().attr(attr);
    const url = absoluteUrl(value, pageUrl);
    if (url) return url;
  }

  const fallbacks: [string, string][] = [
    ['meta[property="og:image"]', 'content'],
    ['meta[name="twitter:image"]', 'content'],
    ['article img', 'src'],
  ];
  for (const [selector, attr] of fallbacks) {
    const url = absoluteUrl($(selector).first().attr(attr), pageUrl);
    if (url) return url;
  }
  return undefined;
}

function extractDate($: cheerio.CheerioAPI, selectors?: Partial<ArticleSelectors>): Date | undefined {
  if (selectors?.date_selector) {
    const el = $(selectors.date_selector).first();
    const raw = selectors.date_attribute ? el.attr(selectors.date_attribute) : el.text();
    const parsed = parseDate(raw);
    if (parsed) return parsed;
  }

  const fallbacks: [string, string | undefined][] = [
    ['meta[property="article:published_time"]', 'content'],
    ['meta[itemprop="datePublished"]', 'content'],
    ['time[datetime]', 'datetime'],
    ['time', undefined],
  ];
  for (const [selector, attr] of fallbacks) {
    const el = $(selector).first();
    if (el.length === 0) continue;
    const parsed = parseDate(attr ? el.attr(attr) : el.text());
    if (parsed) return parsed;
  }
  return undefined;
}

function extractAuthor($: cheerio.CheerioAPI, selectors?: Partial<ArticleSelectors>): string | undefined {
  const candidates = [selectors?.author_selector, 'meta[name="author"]', '[rel="author"]'].filter(
    Boolean,
  ) as string[];

  for (const selector of candidates) {
    const el = $(selector).first();
    if (el.length === 0) continue;
    const value = selector.startsWith('meta') ? el.attr('content') : el.text();
    const cleaned = normalizeForDisplay(value ?? '');
    if (cleaned) return cleaned;
  }
  return undefined;
}
