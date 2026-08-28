/**
 * تست‌های انتشار در کانال تلگرام.
 *
 * در برابر یک ربات تلگرام ساختگی اجرا می‌شوند که محدودیت‌های واقعی
 * Bot API را اعمال می‌کند: سقف ۴۰۹۶/۱۰۲۴ نویسه، خطای «can't parse
 * entities» برای HTML نامعتبر، و ۴۲۹ همراه retry_after.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  startMockTelegram, MOCK_BOT_TOKEN, MOCK_CHANNEL, type MockTelegram,
} from './helpers/mock-telegram.ts';
import {
  TelegramClient, escapeTelegramHtml, TELEGRAM_MAX_CAPTION, TELEGRAM_MAX_TEXT,
} from '../src/publisher/telegram.ts';
import {
  publishArticleToTelegram, isPermanentTelegramFailure,
} from '../src/publisher/channel.ts';
import { renderTelegramMessage, renderTelegramCaption } from '../src/publisher/render.ts';
import { AppError } from '../src/lib/errors.ts';
import { loadAppConfig } from '../src/config/app-config.ts';
import type { ArticleRow } from '../src/db/repositories/articles.ts';

const app = loadAppConfig();
let tg: MockTelegram;
let imageFile: string;
let imageDir: string;

function client(token = MOCK_BOT_TOKEN): TelegramClient {
  return new TelegramClient({ botToken: token, apiBaseUrl: tg.url, retries: 2, timeoutMs: 3000 });
}

function article(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 1, raw_article_id: 1,
    title: 'خط دو قطار شهری شیراز تا پایان سال به بهره‌برداری می‌رسد',
    lead: 'چهار ایستگاه نخست خط دو مترو شیراز تا پایان امسال آمادهٔ پذیرش مسافر می‌شود.',
    body: 'پیشرفت فیزیکی این بخش از مرز 85 درصد گذشته است.\n\nروزانه 40 هزار نفر استفاده خواهند کرد.',
    category: 'شهری و عمرانی', tags: ['شیراز'], slug: 'خط-دو-مترو-شیراز',
    image_url: null, image_path: null, image_credit: null,
    status: 'approved', reject_reason: null, editor_notes: null,
    rewrite_model: 'fake', rewrite_meta: {}, edited_by_human: false,
    approved_at: new Date(), approved_by: 'admin', published_at: null,
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

const context = {
  sourceLine: 'منبع: خبرگزاری نمونه',
  link: 'https://kakonews.ir/خط-دو-مترو-شیراز',
  channelId: MOCK_CHANNEL,
};

const renderable = {
  title: article().title, lead: article().lead, body: article().body,
  slug: 'test', imageCredit: null,
};
const renderOptions = {
  link: context.link,
  readMoreLabel: app.publishing.telegram.read_more_label,
  sourceLine: context.sourceLine,
  footer: app.brand.telegram_footer,
};

before(async () => {
  tg = await startMockTelegram();
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kako-tg-'));
  imageFile = path.join(imageDir, 'shiraz.jpg');
  fs.writeFileSync(imageFile, Buffer.alloc(2048, 0x42));
});
after(async () => {
  await tg.close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});
beforeEach(() => {
  tg.sent.length = 0;
  tg.requests.length = 0;
  tg.rateLimitTimes = 0;
  tg.retryAfter = 1;
  tg.failTimes = 0;
});

describe('اتصال ربات', () => {
  test('توکن درست پذیرفته می‌شود', async () => {
    assert.equal((await client().checkConnection()).username, 'kakonews_bot');
  });

  test('توکن نادرست خطای گویا می‌دهد', async () => {
    await assert.rejects(
      () => client('999:بدون-اعتبار').checkConnection(),
      (err: unknown) => err instanceof AppError && err.code === 'TELEGRAM_AUTH',
    );
  });
});

describe('ارسال پیام متنی', () => {
  test('خبر بدون تصویر به‌صورت متن می‌رود', async () => {
    const result = await publishArticleToTelegram(client(), article(), context);
    assert.equal(result.asPhoto, false);
    assert.equal(tg.sent[0]?.method, 'sendMessage');
    assert.ok(result.messageId > 0);
  });

  test('تیتر بولد است و لینک «ادامه در سایت» دارد', async () => {
    await publishArticleToTelegram(client(), article(), context);
    const sent = tg.sent[0]!;
    assert.ok(sent.text.startsWith('<b>'));
    assert.ok(sent.text.includes(app.publishing.telegram.read_more_label));
    assert.ok(sent.text.includes(context.link));
  });

  test('خط منبع و امضای کانال در پیام می‌آید', async () => {
    await publishArticleToTelegram(client(), article(), context);
    const sent = tg.sent[0]!;
    assert.ok(sent.text.includes('منبع: خبرگزاری نمونه'));
    assert.ok(sent.text.includes(app.brand.telegram_footer));
  });

  test('پیام با parse_mode برابر HTML فرستاده می‌شود', async () => {
    await publishArticleToTelegram(client(), article(), context);
    assert.equal(tg.sent[0]?.parse_mode, 'HTML');
  });

  test('ارقام متن فارسی می‌شوند', async () => {
    await publishArticleToTelegram(client(), article(), context);
    assert.ok(tg.sent[0]?.text.includes('۸۵'));
    assert.ok(!tg.sent[0]?.text.includes('85'));
  });
});

describe('محتوای مخرب یا HTML خراب', () => {
  test('نویسهٔ < در متن خبر، پیام را نمی‌شکند', async () => {
    // بدون escape، تلگرام کل پیام را با can't parse entities رد می‌کند
    const evil = article({ body: 'متن با <b>تگ ناقص و <script>alert(1)</script> در آن.' });
    const result = await publishArticleToTelegram(client(), evil, context);
    assert.ok(result.messageId > 0, 'پیام باید پذیرفته شود');
    assert.ok(!tg.sent[0]?.text.includes('<script>'));
    assert.ok(tg.sent[0]?.text.includes('&lt;script&gt;'));
  });

  test('علامت & در تیتر درست فرار داده می‌شود', async () => {
    const result = await publishArticleToTelegram(
      client(), article({ title: 'شیراز & فارس' }), context,
    );
    assert.ok(result.messageId > 0);
    assert.ok(tg.sent[0]?.text.includes('&amp;'));
  });

  test('تابع فرار فقط سه نویسهٔ لازم را عوض می‌کند', () => {
    assert.equal(escapeTelegramHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
    assert.equal(escapeTelegramHtml('متن «فارسی» عادی'), 'متن «فارسی» عادی');
  });
});

describe('محدودیت طول', () => {
  // به‌اندازه‌ای بلند که از سقف ۴۰۹۶ نویسه هم رد شود (≈۹ هزار نویسه)
  const longArticle = article({
    body: Array.from({ length: 100 }, (_, i) =>
      `پاراگراف ${i + 1} با توضیحات تکمیلی دربارهٔ روند اجرای پروژه و جزئیات فنی و زمان‌بندی آن.`,
    ).join('\n\n'),
  });

  test('پیام بلند در سقف ۴۰۹۶ نویسه جا می‌شود', async () => {
    const result = await publishArticleToTelegram(client(), longArticle, context);
    assert.ok(result.length <= TELEGRAM_MAX_TEXT, `طول ${result.length} بیش از حد است`);
    assert.equal(result.truncated, true);
    assert.ok(result.messageId > 0);
  });

  test('کپشن عکس در سقف ۱۰۲۴ نویسه جا می‌شود', () => {
    const caption = renderTelegramCaption(
      { ...renderable, body: longArticle.body }, renderOptions,
    );
    assert.ok(caption.length <= TELEGRAM_MAX_CAPTION, `طول ${caption.length} بیش از حد است`);
    assert.equal(caption.truncated, true);
  });

  test('در پیام کوتاه‌شده، تیتر و لینک هرگز حذف نمی‌شوند', () => {
    const caption = renderTelegramCaption(
      { ...renderable, body: longArticle.body }, renderOptions,
    );
    assert.ok(caption.text.includes('<b>'), 'تیتر باید بماند');
    assert.ok(caption.text.includes(context.link), 'لینک باید بماند');
    assert.ok(caption.text.includes(app.brand.telegram_footer), 'امضا باید بماند');
    assert.ok(caption.text.includes('منبع:'), 'خط منبع باید بماند');
  });

  test('خبر کوتاه بی‌جهت بریده نمی‌شود', () => {
    const message = renderTelegramMessage(renderable, renderOptions);
    assert.equal(message.truncated, false);
    assert.ok(message.text.includes('روزانه'));
  });

  test('بریدن متن، موجودیت HTML را نصفه نمی‌کند', () => {
    // متنی پر از & که در مرز بریدن قرار می‌گیرد
    const amps = article({ body: Array.from({ length: 300 }, () => 'شیراز & فارس').join(' ') });
    const caption = renderTelegramCaption(
      { ...renderable, body: amps.body }, renderOptions,
    );
    assert.ok(!/&[a-z]{0,6}$/i.test(caption.text.split('\n')[2] ?? ''), 'موجودیت نصفه نماند');
  });
});

describe('ارسال عکس', () => {
  test('خبر دارای تصویر به‌صورت عکس + کپشن می‌رود', async () => {
    const withImage = article({
      image_url: 'https://example.test/photo.jpg',
      image_path: imageFile,
      image_credit: 'عکس: خبرگزاری نمونه',
    });
    const result = await publishArticleToTelegram(client(), withImage, context);

    assert.equal(result.asPhoto, true);
    assert.equal(tg.sent[0]?.method, 'sendPhoto');
    assert.ok(tg.sent[0]?.photo, 'باید فایل عکس فرستاده شود');
    assert.ok(tg.sent[0]?.text.includes('<b>'), 'کپشن باید تیتر داشته باشد');
  });

  test('فایل عکس واقعاً آپلود می‌شود، نه فقط نشانی', async () => {
    const withImage = article({
      image_url: 'https://example.test/photo.jpg', image_path: imageFile,
    });
    await publishArticleToTelegram(client(), withImage, context);
    const photo = tg.sent[0]?.photo as { filename: string; bytes: number };
    assert.equal(photo.filename, 'shiraz.jpg');
    assert.ok(photo.bytes > 1000);
  });
});

describe('محدودیت نرخ و خطاها', () => {
  test('خطای ۴۲۹ با صبر به‌اندازهٔ خواستهٔ تلگرام جبران می‌شود', async () => {
    tg.rateLimitTimes = 1;
    tg.retryAfter = 1;
    const started = Date.now();
    const result = await publishArticleToTelegram(client(), article(), context);
    const elapsed = Date.now() - started;

    assert.ok(result.messageId > 0, 'باید در تلاش دوم موفق شود');
    assert.ok(elapsed >= 900, `باید حدود ۱ ثانیه صبر کرده باشد، صبر کرد: ${elapsed}ms`);
  });

  test('خطای ۵۰۰ گذرا با تلاش مجدد جبران می‌شود', async () => {
    tg.failTimes = 1;
    const result = await publishArticleToTelegram(client(), article(), context);
    assert.ok(result.messageId > 0);
  });

  test('پیام غیرقابل قبول، خطای دائمی می‌دهد', async () => {
    // پیام خالی را تلگرام رد می‌کند
    await assert.rejects(
      () => client().sendMessage({ chatId: MOCK_CHANNEL, text: '' }),
      (err: unknown) => err instanceof AppError && err.code === 'TELEGRAM_BAD_REQUEST',
    );
  });

  test('توکن غلط دائمی است و بی‌جهت تکرار نمی‌شود', async () => {
    const before = tg.requests.length;
    await assert.rejects(
      () => client('999:غلط').sendMessage({ chatId: MOCK_CHANNEL, text: 'سلام' }),
      (err: unknown) => err instanceof AppError && err.code === 'TELEGRAM_AUTH',
    );
    assert.equal(tg.requests.length - before, 1, 'نباید برای توکن غلط تلاش مجدد کند');
  });
});

describe('تفکیک خطای دائمی از گذرا', () => {
  test('توکن غلط و پیام نامعتبر، دائمی‌اند', () => {
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_AUTH', 'توکن')), true);
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_BAD_REQUEST', 'پیام')), true);
  });

  test('قطعی تلگرام گذراست و دوباره تلاش می‌شود', () => {
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_ERROR', '503')), false);
    assert.equal(isPermanentTelegramFailure(new AppError('TELEGRAM_UNREACHABLE', 'شبکه')), false);
  });
});
