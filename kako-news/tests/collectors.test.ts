/**
 * تست‌های ماژول جمع‌آوری.
 *
 * یک سرور HTTP محلی بالا می‌آید که فید RSS و صفحه‌های HTML فارسی سرو می‌کند،
 * و آداپتورها دقیقاً مثل کار با یک سایت واقعی روی آن اجرا می‌شوند.
 * اجرا:  npm test
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { rssAdapter } from '../src/collectors/rss.ts';
import { scrapeAdapter } from '../src/collectors/scrape.ts';
import { mockAdapter } from '../src/collectors/mock.ts';
import { getAdapter } from '../src/collectors/registry.ts';
import { createLogger } from '../src/lib/logger.ts';
import { SourceError, AppError } from '../src/lib/errors.ts';
import type { ResolvedSource } from '../src/config/sources-config.ts';

const logger = createLogger('collect');

const FETCH_SETTINGS = {
  timeout_ms: 3000,
  max_items_per_run: 20,
  request_delay_ms: 0,   // در تست منتظر نمی‌مانیم
  retries: 0,
};

// ---------------------------------------------------------------
// سرور آزمایشی: یک سایت خبری فارسی کوچک
// ---------------------------------------------------------------

function articleHtml(title: string, body: string, image: string, date: string): string {
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head>
    <meta charset="utf-8">
    <meta property="og:title" content="${title}">
    <meta property="og:image" content="${image}">
    <meta property="article:published_time" content="${date}">
    <meta name="author" content="گروه شهری">
    <title>${title}</title></head><body>
    <header><nav>منو سایت</nav></header>
    <article class="article-body">
      <script>var ads = 1;</script>
      <p>${body}</p>
      <p>پاراگراف دوم خبر که باید در متن استخراج‌شده بیاید و به اندازهٔ کافی طولانی باشد تا شرط حداقل طول متن برقرار شود.</p>
      <div class="related">اخبار مرتبط که نباید در متن بیاید</div>
    </article>
    <footer>تمام حقوق محفوظ است</footer></body></html>`;
}

const LONG_BODY =
  'شهردار شیراز در نشست خبری امروز از آغاز عملیات اجرایی این طرح خبر داد و گفت اعتبار لازم تأمین شده است. ' +
  'این طرح در مدت هجده ماه به بهره‌برداری می‌رسد و بخشی از مشکلات ترافیکی منطقه را برطرف می‌کند.';

let server: http.Server;
let baseUrl: string;
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount++;
    const url = req.url ?? '/';

    if (url === '/feed') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <title>خبرگزاری آزمایشی</title>
          <item>
            <title>افتتاح پل جدید در بلوار چمران شیراز</title>
            <link>${baseUrl}/news/1</link>
            <description>پل جدید بلوار چمران امروز به بهره‌برداری رسید.</description>
            <pubDate>Wed, 27 Aug 2026 09:30:00 +0330</pubDate>
          </item>
          <item>
            <title>برگزاری جشنواره حافظ در شیراز</title>
            <link>${baseUrl}/news/2</link>
            <description>جشنواره امسال با حضور شاعران برگزار می‌شود.</description>
            <pubDate>Wed, 27 Aug 2026 11:00:00 +0330</pubDate>
          </item>
        </channel></rss>`);
      return;
    }

    if (url === '/archive') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html dir="rtl"><body>
        <ul class="news-list">
          <li>
            <h3><a href="/news/1">افتتاح پل جدید در بلوار چمران شیراز</a></h3>
            <p class="summary">پل جدید بلوار چمران امروز به بهره‌برداری رسید.</p>
            <time datetime="۱۴۰۵/۰۶/۰۵">۵ شهریور ۱۴۰۵</time>
            <img src="/img/1.jpg">
          </li>
          <li>
            <h3><a href="/news/2">برگزاری جشنواره حافظ در شیراز</a></h3>
            <p class="summary">جشنواره امسال با حضور شاعران برگزار می‌شود.</p>
            <time datetime="۱۴۰۵/۰۶/۰۵">۵ شهریور ۱۴۰۵</time>
          </li>
          <li><span>آیتم خراب بدون لینک و عنوان</span></li>
        </ul></body></html>`);
      return;
    }

    if (url.startsWith('/news/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(articleHtml(
        'افتتاح پل جدید در بلوار چمران شیراز',
        LONG_BODY,
        `${baseUrl}/img/big.jpg`,
        '2026-08-27T09:30:00+03:30',
      ));
      return;
    }

    if (url === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>هیچ خبری اینجا نیست</p></body></html>');
      return;
    }

    if (url === '/boom') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('server error');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function rssSource(overrides: Partial<ResolvedSource> = {}): ResolvedSource {
  return {
    slug: 'test-rss',
    name: 'منبع آزمایشی',
    type: 'rss',
    url: `${baseUrl}/feed`,
    enabled: true,
    fetch_full_content: true,
    pollIntervalSeconds: 900,
    fetchSettings: FETCH_SETTINGS,
    article: { body_selector: '.article-body', remove_selectors: ['.related'] },
    ...overrides,
  } as ResolvedSource;
}

function scrapeSource(overrides: Record<string, unknown> = {}): ResolvedSource {
  return {
    slug: 'test-scrape',
    name: 'سایت آزمایشی',
    type: 'scrape',
    url: `${baseUrl}/archive`,
    enabled: true,
    fetch_full_content: true,
    pollIntervalSeconds: 900,
    fetchSettings: FETCH_SETTINGS,
    list: {
      item_selector: 'ul.news-list > li',
      title_selector: 'h3 a',
      link_selector: 'h3 a',
      link_attribute: 'href',
      summary_selector: 'p.summary',
      date_selector: 'time',
      date_attribute: 'datetime',
      image_selector: 'img',
      image_attribute: 'src',
    },
    article: { body_selector: '.article-body', remove_selectors: ['.related'] },
    ...overrides,
  } as ResolvedSource;
}

// ---------------------------------------------------------------

describe('آداپتور RSS', () => {
  test('عنوان، لینک و تاریخ را از فید می‌خواند', async () => {
    const result = await rssAdapter.collect({ source: rssSource(), logger, limit: 20 });

    assert.equal(result.items.length, 2);
    const [first] = result.items;
    assert.equal(first?.title, 'افتتاح پل جدید در بلوار چمران شیراز');
    assert.equal(first?.sourceUrl, `${baseUrl}/news/1`);
    assert.equal(first?.publishedAt?.toISOString(), '2026-08-27T06:00:00.000Z');
  });

  test('متن کامل را از صفحهٔ خبر می‌گیرد، نه فقط خلاصهٔ فید', async () => {
    const result = await rssAdapter.collect({ source: rssSource(), logger, limit: 20 });
    const body = result.items[0]?.body ?? '';

    assert.ok(body.includes('شهردار شیراز'), 'متن کامل باید از صفحهٔ خبر آمده باشد');
    assert.ok(body.length > 200, 'متن کامل باید طولانی‌تر از خلاصه باشد');
  });

  test('اسکریپت، منو و بخش «اخبار مرتبط» در متن نمی‌آید', async () => {
    const result = await rssAdapter.collect({ source: rssSource(), logger, limit: 20 });
    const body = result.items[0]?.body ?? '';

    assert.ok(!body.includes('var ads'), 'کد جاوااسکریپت نباید در متن باشد');
    assert.ok(!body.includes('اخبار مرتبط'), 'بخش اخبار مرتبط باید حذف شده باشد');
    assert.ok(!body.includes('منو سایت'), 'منوی سایت نباید در متن باشد');
  });

  test('تصویر شاخص را از og:image برمی‌دارد', async () => {
    const result = await rssAdapter.collect({ source: rssSource(), logger, limit: 20 });
    assert.equal(result.items[0]?.imageUrl, `${baseUrl}/img/big.jpg`);
  });

  test('با fetch_full_content=false به صفحهٔ خبر مراجعه نمی‌کند', async () => {
    const before = requestCount;
    await rssAdapter.collect({
      source: rssSource({ fetch_full_content: false }), logger, limit: 20,
    });
    // فقط یک درخواست: خود فید
    assert.equal(requestCount - before, 1);
  });

  test('سقف limit رعایت می‌شود', async () => {
    const result = await rssAdapter.collect({ source: rssSource(), logger, limit: 1 });
    assert.equal(result.items.length, 1);
  });

  test('فید نامعتبر خطای گویا با نام منبع می‌دهد', async () => {
    await assert.rejects(
      () => rssAdapter.collect({ source: rssSource({ url: `${baseUrl}/empty` }), logger, limit: 5 }),
      (err: unknown) => err instanceof SourceError && err.details.source === 'test-rss',
    );
  });
});

describe('آداپتور اسکرِیپ', () => {
  test('فهرست خبرها را با سلکتورهای کانفیگ استخراج می‌کند', async () => {
    const result = await scrapeAdapter.collect({ source: scrapeSource(), logger, limit: 20 });

    assert.equal(result.items.length, 2, 'آیتم خراب باید رد شود و دو خبر سالم بماند');
    assert.equal(result.items[0]?.title, 'افتتاح پل جدید در بلوار چمران شیراز');
    assert.equal(result.items[0]?.summary, 'پل جدید بلوار چمران امروز به بهره‌برداری رسید.');
  });

  test('لینک نسبی را به نشانی کامل تبدیل می‌کند', async () => {
    const result = await scrapeAdapter.collect({ source: scrapeSource(), logger, limit: 20 });
    assert.equal(result.items[0]?.sourceUrl, `${baseUrl}/news/1`);
    assert.equal(result.items[0]?.imageUrl, `${baseUrl}/img/1.jpg`);
  });

  test('تاریخ شمسی صفحهٔ فهرست را می‌فهمد', async () => {
    const result = await scrapeAdapter.collect({ source: scrapeSource(), logger, limit: 20 });
    // ۵ شهریور ۱۴۰۵ برابر است با ۲۷ اوت ۲۰۲۶
    assert.equal(result.items[0]?.publishedAt?.toISOString().slice(0, 10), '2026-08-26');
  });

  test('آیتم ناقص فهرست فقط هشدار می‌دهد و بقیه را خراب نمی‌کند', async () => {
    const result = await scrapeAdapter.collect({ source: scrapeSource(), logger, limit: 20 });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /عنوان یا لینک نداشت/);
  });

  test('تغییر قالب سایت (سلکتور بی‌نتیجه) خطای قابل فهم می‌دهد', async () => {
    const source = scrapeSource({ list: { item_selector: '.does-not-exist', link_attribute: 'href', image_attribute: 'src' } });
    await assert.rejects(
      () => scrapeAdapter.collect({ source, logger, limit: 5 }),
      (err: unknown) =>
        err instanceof SourceError && /قالب سایت منبع تغییر کرده/.test((err as Error).message),
    );
  });

  test('پاسخ ۵۰۰ سرور منبع، خطای HTTP می‌دهد و کرش نمی‌کند', async () => {
    const source = scrapeSource({ url: `${baseUrl}/boom` });
    await assert.rejects(
      () => scrapeAdapter.collect({ source, logger, limit: 5 }),
      (err: unknown) => err instanceof AppError && err.code === 'HTTP_ERROR',
    );
  });
});

describe('آداپتور تستی و ثبت‌گاه', () => {
  test('دادهٔ نمونه را از فایل می‌خواند', async () => {
    const source = {
      slug: 'mock-local', name: 'تستی', type: 'mock', url: 'fixtures/mock-source.json',
      enabled: true, fetch_full_content: false, pollIntervalSeconds: 60,
      fetchSettings: FETCH_SETTINGS,
    } as ResolvedSource;

    const result = await mockAdapter.collect({ source, logger, limit: 20 });
    assert.equal(result.items.length, 5);
    assert.ok(result.items[0]?.title.includes('شیراز'));
    assert.ok(result.items[0]?.body);
  });

  test('ثبت‌گاه هر سه نوع منبع را می‌شناسد', () => {
    for (const type of ['rss', 'scrape', 'mock']) {
      assert.equal(getAdapter(type).type, type);
    }
  });

  test('نوع ناشناخته خطای گویا می‌دهد', () => {
    assert.throws(() => getAdapter('telegram'), /پشتیبانی نمی‌شود/);
  });
});
