/**
 * تست‌های ابزارهای افزودن منبع خبری.
 *
 * یک خبرگزاری ساختگی با ساختار رایج سایت‌های خبری ایرانی بالا می‌آید:
 * یک فید سراسری و یک فید استانی. ابزار باید بتواند هر دو را پیدا کند و
 * تشخیص بدهد کدام برای کاکو نیوز به درد می‌خورد.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { inspectFeed } from '../src/cli/discover.ts';
import { loadAppConfig } from '../src/config/app-config.ts';

const app = loadAppConfig();

const NATIONAL: [string, string][] = [
  ['افزایش نرخ سود سپرده‌های بانکی', 'بانک مرکزی نرخ سود را در سراسر کشور بازنگری کرد.'],
  ['قیمت جهانی طلا افزایش یافت', 'بازارهای جهانی امروز رشد داشتند.'],
];
const FARS: [string, string][] = [
  ['افتتاح خط دو قطار شهری شیراز', 'سازمان قطار شهری شیراز اعلام کرد این خط تا پایان سال افتتاح می‌شود.'],
  ['مرمت خانه‌های تاریخی محله سنگ سیاه شیراز', 'شهرداری شیراز از آغاز مرمت شش خانهٔ تاریخی خبر داد.'],
  ['بازدید از تخت جمشید رکورد زد', 'میراث فرهنگی استان فارس از افزایش بازدید خبر داد.'],
];

let server: http.Server;
let baseUrl: string;

function rss(title: string, items: [string, string][], base: string, full: boolean): string {
  const entries = items
    .map(([t, b], i) => `
      <item>
        <title>${t}</title>
        <link>${base}/news/${i + 1}</link>
        <description>${b}</description>
        ${full ? `<content:encoded><![CDATA[<p>${b.repeat(12)}</p>]]></content:encoded>` : ''}
        <pubDate>${new Date(Date.now() - i * 3600_000).toUTCString()}</pubDate>
      </item>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel><title>${title}</title><link>${base}</link>${entries}</channel></rss>`;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/rss') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      res.end(rss('خبرگزاری آزمایشی — سراسری', NATIONAL, baseUrl, false));
      return;
    }
    if (url === '/rss/fars') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      res.end(rss('خبرگزاری آزمایشی — فارس', FARS, baseUrl, false));
      return;
    }
    if (url === '/rss/full') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      res.end(rss('فید با متن کامل', FARS, baseUrl, true));
      return;
    }
    if (url === '/rss/empty') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>خالی</title></channel></rss>');
      return;
    }
    if (url === '/not-a-feed') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body>صفحهٔ معمولی</body></html>');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('آزمودن فید', () => {
  test('فید سالم شناسایی می‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/fars`);
    assert.equal(report.ok, true);
    assert.equal(report.itemCount, FARS.length);
    assert.match(report.title ?? '', /فارس/);
  });

  test('تاریخ تازه‌ترین خبر خوانده می‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/fars`);
    assert.ok(report.latest instanceof Date);
  });

  test('صفحهٔ معمولی به‌عنوان فید پذیرفته نمی‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/not-a-feed`);
    assert.equal(report.ok, false);
  });

  test('فید بدون خبر، سالم شمرده نمی‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/empty`);
    assert.equal(report.ok, false);
    assert.match(report.error ?? '', /خبری ندارد/);
  });

  test('نشانی ناموجود کرش نمی‌کند', async () => {
    const report = await inspectFeed(`${baseUrl}/does-not-exist`);
    assert.equal(report.ok, false);
    assert.ok(report.error);
  });
});

describe('تشخیص فید مناسب کاکو نیوز', () => {
  test('فید استانی، خبر مرتبط با شیراز دارد', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/fars`);
    assert.equal(report.shirazCount, FARS.length, 'همهٔ خبرهای فید استانی باید مرتبط باشند');
  });

  test('فید سراسری، خبر مرتبط با شیراز ندارد', async () => {
    const report = await inspectFeed(`${baseUrl}/rss`);
    assert.equal(report.shirazCount, 0, 'خبر بانک مرکزی و طلای جهانی نباید محلی شمرده شوند');
  });

  test('فید استانی بر فید سراسری ترجیح دارد', async () => {
    const provincial = await inspectFeed(`${baseUrl}/rss/fars`);
    const national = await inspectFeed(`${baseUrl}/rss`);
    assert.ok(
      (provincial.shirazCount ?? 0) > (national.shirazCount ?? 0),
      'ابزار باید فید استانی را پیشنهاد بدهد',
    );
  });

  test('نمونهٔ تیترها با امتیازشان برگردانده می‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/fars`);
    assert.ok((report.samples?.length ?? 0) > 0);
    for (const sample of report.samples ?? []) {
      assert.equal(typeof sample.score, 'number');
      assert.ok(sample.title.length > 0);
    }
  });
});

describe('تشخیص متن کامل در فید', () => {
  test('فید دارای متن کامل شناسایی می‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/full`);
    assert.equal(report.hasFullText, true, 'باید بفهمد نیازی به باز کردن صفحهٔ خبر نیست');
  });

  test('فید فقط خلاصه‌دار شناسایی می‌شود', async () => {
    const report = await inspectFeed(`${baseUrl}/rss/fars`);
    assert.equal(report.hasFullText, false, 'باید بفهمد متن کامل از صفحهٔ خبر لازم است');
  });
});

describe('آستانه‌های تصمیم', () => {
  test('آستانهٔ مرتبط‌بودن با کانفیگ هماهنگ است', () => {
    assert.ok(app.relevance.irrelevant_threshold <= app.relevance.certain_threshold);
  });
});
