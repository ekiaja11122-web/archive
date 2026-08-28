/**
 * آداپتور سایت‌های بدون RSS.
 *
 * دو مرحله دارد، دقیقاً مثل کاری که یک خبرنگار می‌کند:
 *   ۱) صفحهٔ فهرست/آرشیو را باز می‌کند و عنوان، لینک، خلاصه و تاریخ را برمی‌دارد.
 *   ۲) به صفحهٔ هر خبر می‌رود و متن کامل را می‌گیرد.
 *
 * همهٔ سلکتورها از `config/sources.yaml` می‌آیند. اگر قالب سایت عوض شود
 * و سلکتور نتیجه ندهد، آداپتور خطای گویا می‌دهد تا در پنل «سلامت منابع»
 * دیده شود — و بقیهٔ منابع بدون وقفه ادامه می‌دهند.
 */
import * as cheerio from 'cheerio';
import { SourceError } from '../lib/errors.ts';
import { fetchText, sleep, absoluteUrl } from '../lib/http.ts';
import { normalizeForDisplay, truncate } from '../lib/text.ts';
import { parseDate } from '../lib/date.ts';
import { fetchArticlePage } from './article-page.ts';
import type { CollectContext, CollectResult, CollectedItem, SourceAdapter } from './types.ts';

export const scrapeAdapter: SourceAdapter = {
  type: 'scrape',

  async collect({ source, logger, limit }: CollectContext): Promise<CollectResult> {
    if (source.type !== 'scrape') {
      throw new SourceError(source.slug, 'آداپتور اسکرِیپ برای منبعی با نوع دیگر صدا زده شد');
    }

    const warnings: string[] = [];
    const fetchOptions = {
      timeoutMs: source.fetchSettings.timeout_ms,
      retries: source.fetchSettings.retries,
      ...(source.fetchSettings.user_agent ? { userAgent: source.fetchSettings.user_agent } : {}),
    };

    const listPage = await fetchText(source.url, { ...fetchOptions, logger });
    const $ = cheerio.load(listPage.body);
    const { list } = source;

    const elements = $(list.item_selector).toArray();
    if (elements.length === 0) {
      // این تقریباً همیشه یعنی قالب سایت عوض شده است
      throw new SourceError(
        source.slug,
        `سلکتور «${list.item_selector}» هیچ خبری پیدا نکرد — احتمالاً قالب سایت منبع تغییر کرده است`,
        { url: source.url, selector: list.item_selector },
      );
    }

    logger.debug('صفحهٔ فهرست خوانده شد', { found: elements.length });

    // مرحلهٔ ۱ — استخراج فهرست
    const listings: CollectedItem[] = [];
    for (const [index, element] of elements.slice(0, limit).entries()) {
      const $item = $(element);

      const linkEl = list.link_selector ? $item.find(list.link_selector).first() : $item.find('a').first();
      const href = linkEl.attr(list.link_attribute) ?? linkEl.attr('href');
      const url = absoluteUrl(href, listPage.url);

      const titleRaw = list.title_selector
        ? $item.find(list.title_selector).first().text()
        : (linkEl.attr('title') ?? linkEl.text());
      const title = normalizeForDisplay(titleRaw ?? '');

      if (!url || !title) {
        warnings.push(`آیتم ${index + 1} فهرست عنوان یا لینک نداشت و رد شد`);
        continue;
      }

      const summary = list.summary_selector
        ? normalizeForDisplay($item.find(list.summary_selector).first().text())
        : undefined;

      let publishedAt: Date | undefined;
      if (list.date_selector) {
        const dateEl = $item.find(list.date_selector).first();
        const rawDate = list.date_attribute ? dateEl.attr(list.date_attribute) : dateEl.text();
        publishedAt = parseDate(rawDate);
      }

      const imageUrl = list.image_selector
        ? absoluteUrl(
            $item.find(list.image_selector).first().attr(list.image_attribute),
            listPage.url,
          )
        : undefined;

      listings.push({
        sourceUrl: url,
        title,
        summary: summary || undefined,
        publishedAt,
        imageUrl,
        raw: { list_html: truncate($item.html() ?? '', 2000) },
      });
    }

    if (!source.fetch_full_content) return { items: listings, warnings };

    // مرحلهٔ ۲ — متن کامل هر خبر از صفحهٔ خودش
    const items: CollectedItem[] = [];
    for (const [index, listing] of listings.entries()) {
      if (index > 0) await sleep(source.fetchSettings.request_delay_ms);
      try {
        const page = await fetchArticlePage(listing.sourceUrl, source.article, fetchOptions, logger);
        items.push({
          ...listing,
          // عنوان فهرست گاهی کوتاه‌شده است؛ اگر عنوان صفحهٔ خبر کامل‌تر بود آن را برمی‌داریم
          title: page.title && page.title.length > listing.title.length + 5 ? page.title : listing.title,
          body: page.body,
          imageUrl: listing.imageUrl ?? page.imageUrl,
          publishedAt: listing.publishedAt ?? page.publishedAt,
          author: page.author,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`صفحهٔ «${truncate(listing.title, 40)}» باز نشد: ${message}`);
        logger.warn('دریافت صفحهٔ خبر ناموفق بود؛ فقط اطلاعات فهرست ذخیره می‌شود',
          { url: listing.sourceUrl }, err);
        // خبر را با همان دادهٔ فهرست نگه می‌داریم؛ متن کامل بعداً قابل تکمیل است
        items.push(listing);
      }
    }

    return { items, warnings };
  },
};
