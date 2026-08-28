/**
 * کشف خودکار فید RSS یک سایت خبری.
 *
 * چرا این ابزار لازم است: سلکتورهای CSS هر سایت را باید *دید* تا نوشت،
 * و فید RSS هر سایت را باید *امتحان کرد* تا مطمئن شد کار می‌کند. این
 * دستور روی سیستمی اجرا می‌شود که به آن سایت دسترسی دارد، فیدهایش را
 * پیدا و آزمایش می‌کند، و یک بلوک آمادهٔ کپی برای `sources.yaml` می‌دهد.
 *
 *   npm run kako -- sources:discover https://www.example.ir
 *
 * برای هر فید پیداشده نشان می‌دهد چند خبر دارد، تازه‌ترینش برای چه
 * زمانی است، و — مهم‌تر از همه — **چند درصد خبرهایش به شیراز مربوط‌اند**.
 * این‌طور پیش از افزودن یک منبع می‌فهمید ارزشش را دارد یا نه.
 */
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { fetchText, absoluteUrl } from '../lib/http.ts';
import { htmlToText, normalizeForDisplay, truncate } from '../lib/text.ts';
import { parseDate, formatTehran } from '../lib/date.ts';
import { scoreRelevance } from '../pipeline/relevance-score.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { createLogger } from '../lib/logger.ts';
import { errorMessage } from '../lib/errors.ts';

const logger = createLogger('collect');
const parser = new Parser();

/** مسیرهای رایج فید در سایت‌های خبری فارسی. */
const COMMON_FEED_PATHS = [
  '/rss',
  '/rss.xml',
  '/feed',
  '/feeds',
  '/rss/allnews',
  '/rss/tp/1',
  '/?feed=rss2',
  '/rss/last-news',
];

export type FeedReport = {
  url: string;
  ok: boolean;
  title?: string;
  itemCount?: number;
  latest?: Date | undefined;
  hasFullText?: boolean;
  shirazCount?: number;
  samples?: { title: string; score: number }[];
  error?: string;
};

/** فیدهای اعلام‌شده در خود صفحهٔ HTML. */
async function declaredFeeds(pageUrl: string): Promise<string[]> {
  const response = await fetchText(pageUrl, { retries: 1, logger });
  const $ = cheerio.load(response.body);
  const found = new Set<string>();

  $('link[rel="alternate"]').each((_, el) => {
    const type = String($(el).attr('type') ?? '');
    if (!/rss|atom|xml/i.test(type)) return;
    const href = absoluteUrl($(el).attr('href'), response.url);
    if (href) found.add(href);
  });

  // بعضی سایت‌های فارسی فید را فقط با لینک معمولی معرفی می‌کنند
  $('a[href*="rss"], a[href*="feed"]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'), response.url);
    if (href && /rss|feed/i.test(href)) found.add(href);
  });

  return [...found];
}

/** آزمودن یک نشانی به‌عنوان فید و گزارش آنچه می‌دهد. */
export async function inspectFeed(feedUrl: string): Promise<FeedReport> {
  try {
    const response = await fetchText(feedUrl, { retries: 1, logger });
    const feed = await parser.parseString(response.body);
    const items = feed.items ?? [];

    if (items.length === 0) {
      return { url: feedUrl, ok: false, error: 'فید معتبر است ولی خبری ندارد' };
    }

    const samples = items.slice(0, 12).map((item) => {
      const title = normalizeForDisplay(item.title ?? '');
      const body = htmlToText(
        String((item as Record<string, unknown>)['content:encoded'] ?? item.content ?? ''),
      );
      return { title, score: scoreRelevance(title, body || (item.contentSnippet ?? '')).score };
    });

    const app = loadAppConfig();
    const shirazCount = samples.filter((s) => s.score >= app.relevance.irrelevant_threshold).length;

    // آیا فید متن کامل می‌دهد یا فقط خلاصه؟
    const firstBody = String(
      (items[0] as Record<string, unknown> | undefined)?.['content:encoded'] ??
        items[0]?.content ?? '',
    );
    const hasFullText = htmlToText(firstBody).length > 600;

    return {
      url: feedUrl,
      ok: true,
      title: normalizeForDisplay(feed.title ?? ''),
      itemCount: items.length,
      latest: parseDate(items[0]?.isoDate ?? items[0]?.pubDate),
      hasFullText,
      shirazCount,
      samples: samples.slice(0, 5),
    };
  } catch (err) {
    return { url: feedUrl, ok: false, error: errorMessage(err) };
  }
}

function slugFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0]?.replace(/[^a-z0-9-]/gi, '') || 'source';
  } catch {
    return 'source';
  }
}

/** بلوک آمادهٔ کپی برای sources.yaml. */
function yamlBlock(report: FeedReport, siteUrl: string): string {
  const slug = slugFromUrl(report.url);
  const fetchFull = report.hasFullText ? 'false' : 'true';

  return [
    `  - slug: ${slug}-fars`,
    `    name: "${report.title || slug}"`,
    `    type: rss`,
    `    url: "${report.url}"`,
    `    homepage: "${siteUrl}"`,
    `    enabled: true`,
    `    poll_interval_seconds: 900`,
    ...(report.hasFullText
      ? [
          `    # این فید خودش متن کامل دارد، پس نیازی به باز کردن صفحهٔ هر خبر نیست`,
          `    fetch_full_content: ${fetchFull}`,
        ]
      : [
          `    # این فید فقط خلاصه دارد؛ متن کامل از صفحهٔ خود خبر گرفته می‌شود`,
          `    fetch_full_content: ${fetchFull}`,
          `    article:`,
          `      # ⚠️ این سلکتور را با «npm run kako -- sources:test ${slug}-fars» تنظیم کنید`,
          `      body_selector: ".item-text, .news-body, article"`,
          `      image_selector: "meta[property='og:image']"`,
          `      image_attribute: "content"`,
          `      remove_selectors: ["script", "style", ".related", ".tags"]`,
        ]),
  ].join('\n');
}

export async function runDiscover(siteUrl: string): Promise<number> {
  process.stdout.write(`\n  جست‌وجوی فید در ${siteUrl}\n  ${'─'.repeat(48)}\n`);

  let candidates: string[] = [];
  try {
    candidates = await declaredFeeds(siteUrl);
    process.stdout.write(
      candidates.length > 0
        ? `\n  ${candidates.length} فید در خود صفحه اعلام شده است.\n`
        : '\n  صفحه فیدی اعلام نکرده؛ مسیرهای رایج امتحان می‌شوند.\n',
    );
  } catch (err) {
    process.stdout.write(`\n  ✗ صفحهٔ اصلی باز نشد: ${errorMessage(err)}\n`);
    process.stdout.write('    مسیرهای رایج فید را مستقیم امتحان می‌کنیم…\n');
  }

  // مسیرهای رایج را هم اضافه می‌کنیم
  let base: URL;
  try {
    base = new URL(siteUrl);
  } catch {
    process.stdout.write('  ✗ نشانی معتبر نیست.\n\n');
    return 1;
  }
  for (const path of COMMON_FEED_PATHS) {
    candidates.push(new URL(path, base.origin).toString());
  }

  const unique = [...new Set(candidates)].slice(0, 25);
  const working: FeedReport[] = [];

  for (const candidate of unique) {
    const report = await inspectFeed(candidate);
    if (!report.ok) continue;

    working.push(report);
    process.stdout.write(
      `\n  ✓ ${report.url}\n` +
      `      «${report.title}»\n` +
      `      ${report.itemCount} خبر · تازه‌ترین: ${formatTehran(report.latest)}\n` +
      `      متن کامل در فید: ${report.hasFullText ? 'بله' : 'خیر (باید صفحهٔ خبر باز شود)'}\n` +
      `      مرتبط با شیراز: ${report.shirazCount} از ${report.samples?.length ?? 0} نمونه\n`,
    );
    for (const sample of report.samples ?? []) {
      const mark = sample.score >= 4 ? '✓' : sample.score >= 1 ? '~' : '·';
      process.stdout.write(`        ${mark} [${String(sample.score).padStart(5)}] ${truncate(sample.title, 60)}\n`);
    }
  }

  if (working.length === 0) {
    process.stdout.write(
      '\n  هیچ فید سالمی پیدا نشد.\n\n' +
      '  گام بعدی: صفحهٔ آرشیو اخبار شیراز/فارس آن سایت را پیدا کنید و\n' +
      '  منبع را از نوع «scrape» تعریف کنید. راهنمای سلکتورها در\n' +
      '  config/sources.example.yaml است.\n\n',
    );
    return 1;
  }

  // بهترین گزینه: بیشترین خبر مرتبط با شیراز
  const best = [...working].sort(
    (a, b) => (b.shirazCount ?? 0) - (a.shirazCount ?? 0) || (b.itemCount ?? 0) - (a.itemCount ?? 0),
  )[0]!;

  process.stdout.write(
    `\n  ${'─'.repeat(48)}\n` +
    `  پیشنهاد: این بلوک را به config/sources.yaml اضافه کنید\n` +
    `  ${'─'.repeat(48)}\n\n` +
    yamlBlock(best, siteUrl) + '\n\n' +
    `  سپس:\n` +
    `    npm run sources:sync\n` +
    `    npm run kako -- sources:test ${slugFromUrl(best.url)}-fars\n\n`,
  );

  if ((best.shirazCount ?? 0) === 0) {
    process.stdout.write(
      '  ⚠️ در نمونه‌ها هیچ خبر مرتبط با شیراز نبود. احتمالاً این فید\n' +
      '     سراسری است. دنبال فید *استان فارس* آن سایت بگردید — بیشتر\n' +
      '     خبرگزاری‌ها برای هر استان فید جدا دارند.\n\n',
    );
  }

  return 0;
}
