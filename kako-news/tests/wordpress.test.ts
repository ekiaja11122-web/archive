/**
 * تست‌های انتشار در وردپرس.
 *
 * در برابر یک وردپرس ساختگی اجرا می‌شوند که REST API واقعی را
 * شبیه‌سازی می‌کند — از جمله رفتارهای دردسرسازش: تطبیق جزئی در
 * جست‌وجوی دسته، خطای «نام تکراری» هنگام ساخت دسته، و نیاز آپلود
 * رسانه به هدر Content-Disposition.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { startMockWordPress, MOCK_CREDENTIALS, type MockWordPress } from './helpers/mock-wordpress.ts';
import { WordPressClient } from '../src/publisher/wordpress.ts';
import { publishArticleToWordPress, isPermanentPublishFailure } from '../src/publisher/website.ts';
import { renderWordPressContent, renderExcerpt } from '../src/publisher/render.ts';
import { AppError } from '../src/lib/errors.ts';
import type { ArticleRow } from '../src/db/repositories/articles.ts';

let wp: MockWordPress;

function client(overrides: Partial<{ username: string; appPassword: string }> = {}): WordPressClient {
  return new WordPressClient({
    baseUrl: wp.url,
    username: overrides.username ?? MOCK_CREDENTIALS.username,
    appPassword: overrides.appPassword ?? MOCK_CREDENTIALS.appPassword,
    retries: 1,
    timeoutMs: 3000,
  });
}

function article(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 1,
    raw_article_id: 1,
    title: 'خط دو قطار شهری شیراز تا پایان سال به بهره‌برداری می‌رسد',
    lead: 'چهار ایستگاه نخست خط دو مترو شیراز تا پایان امسال آمادهٔ پذیرش مسافر می‌شود.',
    body: 'پیشرفت فیزیکی این بخش از مرز 85 درصد گذشته است.\n\nروزانه 40 هزار نفر از این مسیر استفاده خواهند کرد.',
    category: 'شهری و عمرانی',
    tags: ['شیراز', 'قطار شهری'],
    slug: 'خط-دو-قطار-شهری-شیراز',
    image_url: null,
    image_path: null,
    image_credit: null,
    status: 'approved',
    reject_reason: null,
    editor_notes: null,
    rewrite_model: 'fake',
    rewrite_meta: {},
    edited_by_human: false,
    approved_at: new Date(),
    approved_by: 'admin',
    published_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

before(async () => {
  wp = await startMockWordPress();
});
after(async () => {
  await wp.close();
});
beforeEach(() => {
  wp.posts.length = 0;
  wp.media.length = 0;
  wp.tags.length = 0;
  wp.categories.length = 1;
  wp.requests.length = 0;
  wp.failPostTimes = 0;
  wp.rejectDuplicateSlug = false;
});

describe('اتصال و احراز هویت', () => {
  test('رمز برنامهٔ درست پذیرفته می‌شود', async () => {
    const me = await client().checkConnection();
    assert.equal(me.name, 'ربات کاکو نیوز');
  });

  test('رمز برنامه با فاصله درست ارسال می‌شود', async () => {
    await client().checkConnection();
    const auth = wp.requests.at(-1)?.auth ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    assert.equal(decoded, `${MOCK_CREDENTIALS.username}:${MOCK_CREDENTIALS.appPassword}`);
    assert.ok(decoded.includes(' '), 'فاصله‌های رمز برنامه باید حفظ شوند');
  });

  test('رمز اشتباه، خطای گویا با راهنمای رفع می‌دهد', async () => {
    await assert.rejects(
      () => client({ appPassword: 'رمز غلط' }).checkConnection(),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'WORDPRESS_AUTH' &&
        /رمز برنامه/.test(err.message),
    );
  });

  test('خطای احراز هویت دائمی است و بی‌جهت تکرار نمی‌شود', async () => {
    const before = wp.requests.length;
    await assert.rejects(() => client({ appPassword: 'غلط' }).checkConnection());
    assert.equal(wp.requests.length - before, 1, 'نباید برای رمز اشتباه تلاش مجدد کند');
  });
});

describe('دسته‌بندی و برچسب', () => {
  test('دستهٔ تازه ساخته می‌شود', async () => {
    const id = await client().ensureTerm('categories', 'شهری و عمرانی');
    assert.ok(id > 0);
    assert.ok(wp.categories.some((c) => c.name === 'شهری و عمرانی'));
  });

  test('دستهٔ موجود دوباره ساخته نمی‌شود', async () => {
    const first = await client().ensureTerm('categories', 'ورزشی');
    const second = await client().ensureTerm('categories', 'ورزشی');
    assert.equal(first, second);
    assert.equal(wp.categories.filter((c) => c.name === 'ورزشی').length, 1);
  });

  test('تطبیق جزئی وردپرس، دستهٔ اشتباه را انتخاب نمی‌کند', async () => {
    // «ورزشی بانوان» از قبل هست؛ درخواست «ورزشی» نباید به آن وصل شود
    wp.categories.push({ id: 50, name: 'ورزشی بانوان', slug: 'women-sports' });
    const id = await client().ensureTerm('categories', 'ورزشی');
    assert.notEqual(id, 50, 'نباید به دستهٔ مشابه ولی متفاوت وصل شود');
    assert.ok(wp.categories.some((c) => c.id === id && c.name === 'ورزشی'));
  });

  test('چند برچسب با هم ساخته می‌شوند', async () => {
    const ids = await client().ensureTags(['شیراز', 'مترو', 'حمل و نقل']);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
  });

  test('برچسب خالی، انتشار را متوقف نمی‌کند', async () => {
    const ids = await client().ensureTags(['شیراز', '', '   ']);
    assert.equal(ids.length, 1, 'فقط برچسب معتبر ثبت می‌شود');
  });
});

describe('ساخت پست', () => {
  test('پست با تیتر، اسلاگ فارسی، دسته و برچسب ساخته می‌شود', async () => {
    const result = await publishArticleToWordPress(client(), article(), 'منبع: خبرگزاری نمونه');

    assert.ok(result.postId > 0);
    const post = wp.posts[0]!;
    assert.equal(post.title, article().title);
    assert.equal(post.slug, 'خط-دو-قطار-شهری-شیراز');
    assert.equal(post.status, 'publish');
    assert.equal(post.categories.length, 1);
    assert.equal(post.tags.length, 2);
  });

  test('خط منبع در انتهای متن پست می‌آید', async () => {
    await publishArticleToWordPress(client(), article(), 'منبع: خبرگزاری نمونه');
    const post = wp.posts[0]!;
    assert.ok(post.content.includes('منبع: خبرگزاری نمونه'));
    assert.ok(post.content.trimEnd().endsWith('</p>'));
    assert.ok(post.content.indexOf('منبع:') > post.content.indexOf('پیشرفت فیزیکی'));
  });

  test('لید در متن پررنگ و در خلاصه می‌آید', async () => {
    await publishArticleToWordPress(client(), article(), '');
    const post = wp.posts[0]!;
    assert.ok(post.content.includes('<strong>'));
    assert.ok(post.excerpt.includes('چهار ایستگاه'));
  });

  test('ارقام متن به فارسی تبدیل می‌شوند', async () => {
    await publishArticleToWordPress(client(), article(), '');
    const post = wp.posts[0]!;
    assert.ok(post.content.includes('۸۵'), 'باید ارقام فارسی باشد');
    assert.ok(!post.content.includes('85'));
  });

  test('خطای گذرای سایت با تلاش مجدد جبران می‌شود', async () => {
    wp.failPostTimes = 1;   // اولین تلاش ۵۰۳ می‌گیرد
    const result = await publishArticleToWordPress(client(), article(), '');
    assert.ok(result.postId > 0, 'باید در تلاش دوم موفق شود');
    assert.equal(wp.posts.length, 1);
  });

  test('خطای دائمی سایت، خبر را ناموفق اعلام می‌کند', async () => {
    wp.failPostTimes = 5;   // بیش از تعداد تلاش‌ها
    await assert.rejects(
      () => publishArticleToWordPress(client(), article(), ''),
      (err: unknown) => err instanceof AppError,
    );
    assert.equal(wp.posts.length, 0);
  });
});

describe('تصویر شاخص', () => {
  test('تصویر آپلود و به پست وصل می‌شود', async () => {
    // فایل تصویر ساختگی روی دیسک
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kako-img-'));
    const file = path.join(dir, 'test.jpg');
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]));

    const media = await client().uploadMedia(file, 'test.jpg', 'image/jpeg');
    assert.ok(media.id > 0);
    assert.equal(wp.media[0]?.filename, 'test.jpg');
    assert.equal(wp.media[0]?.mime, 'image/jpeg');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('آپلود رسانه هدر Content-Disposition می‌فرستد', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kako-img-'));
    const file = path.join(dir, 'a.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await client().uploadMedia(file, 'a.png', 'image/png');
    // وردپرس ساختگی بدون این هدر ۴۰۰ می‌داد، پس رسیدن تا اینجا یعنی فرستاده شده
    assert.equal(wp.media.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('خبر بدون تصویر هم منتشر می‌شود', async () => {
    const result = await publishArticleToWordPress(client(), article({ image_url: null }), '');
    assert.equal(result.mediaId, undefined);
    assert.equal(wp.posts[0]?.featured_media, 0);
  });
});

describe('قالب متن پست', () => {
  const sample = {
    title: 'تیتر', lead: 'لید خبر.', body: 'پاراگراف یک.\n\nپاراگراف دو.',
    slug: 'test', imageCredit: 'عکس: منبع',
  };

  test('هر پاراگراف در تگ جدا می‌آید', () => {
    const out = renderWordPressContent(sample, {});
    assert.equal((out.match(/<p/g) ?? []).length, 4);   // لید + دو پاراگراف + عکس
  });

  test('محتوای مخرب منبع در پست وردپرس escape می‌شود', () => {
    const out = renderWordPressContent(
      { ...sample, body: '<script>alert(1)</script> متن' },
      {},
    );
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });

  test('خلاصه، همان لید بدون تگ است', () => {
    assert.equal(renderExcerpt(sample, false), 'لید خبر.');
  });
});

describe('تفکیک خطای دائمی از گذرا', () => {
  test('رمز اشتباه، خطای دائمی است', () => {
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_AUTH', 'رمز غلط')), true);
  });

  test('قطعی سایت، خطای گذراست و دوباره تلاش می‌شود', () => {
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_ERROR', 'پاسخ 503')), false);
    assert.equal(isPermanentPublishFailure(new AppError('WORDPRESS_UNREACHABLE', 'شبکه')), false);
  });
});
