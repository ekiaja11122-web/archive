/**
 * تست‌های موتور بازنویسی.
 *
 * تماس با OpenAI با یک تابع ساختگی جایگزین می‌شود، پس کل مسیر — از ساخت
 * پرامپت تا اعتبارسنجی و محافظ کپی — بدون شبکه و بدون هزینه آزمایش می‌شود.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.OPENAI_MODEL ??= 'gpt-4o-mini';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  validateRewrite, matchCategory, buildSourceLine, type RawRewriteOutput,
} from '../src/pipeline/rewrite-validate.ts';
import {
  rewriteOne, buildSystemPrompt, buildUserMessage, isContentFailure,
  type ChatFn, type SourceMaterial,
} from '../src/pipeline/rewrite.ts';
import { verbatimOverlap } from '../src/lib/similarity.ts';
import { slugify } from '../src/lib/text.ts';
import { loadAppConfig } from '../src/config/app-config.ts';
import { fromRoot } from '../src/config/paths.ts';
import { AppError } from '../src/lib/errors.ts';

const app = loadAppConfig();
const CATEGORIES = app.categories;

const fixture = JSON.parse(fs.readFileSync(fromRoot('fixtures/mock-source.json'), 'utf8')).items;
const metro = fixture[0];

const GOOD_OUTPUT: RawRewriteOutput = {
  title: 'خط دو قطار شهری شیراز تا پایان سال به بهره‌برداری می‌رسد',
  lead: 'چهار ایستگاه نخست خط دو مترو شیراز تا پایان امسال آمادهٔ پذیرش مسافر می‌شود. پیشرفت فیزیکی این بخش از مرز ۸۵ درصد گذشته است.',
  body:
    'به گفتهٔ مدیر این مجموعه، هم‌اکنون تجهیز ایستگاه‌ها و آزمایش سامانه‌های ایمنی در جریان است و کار طبق برنامه پیش می‌رود.\n\n' +
    'پیش‌بینی می‌شود روزانه نزدیک به ۴۰ هزار نفر از ساکنان شمال غربی شهر از این مسیر استفاده کنند و بخشی از فشار ترافیکی بلوار امیرکبیر کم شود.\n\n' +
    'تأمین اعتبار برای تکمیل ایستگاه‌های باقی‌مانده نیز در همان نشست مورد تأکید قرار گرفت.',
  category: 'شهری و عمرانی',
  tags: ['شیراز', 'قطار شهری', 'حمل و نقل'],
};

function material(): SourceMaterial {
  return {
    primary: {
      title: metro.title,
      body: metro.body,
      sourceName: 'منبع تستی محلی',
      publishedAt: new Date('2026-08-27T09:30:00Z'),
    },
    supplementary: [],
  };
}

/** تابع ساختگی مدل: هر بار خروجی داده‌شده را برمی‌گرداند. */
function fakeChat(outputs: RawRewriteOutput[]): ChatFn {
  let call = 0;
  return async () => {
    const data = outputs[Math.min(call, outputs.length - 1)]!;
    call++;
    return { data, model: 'fake-model', usage: { total: 100 }, durationMs: 5 };
  };
}

describe('اعتبارسنجی خروجی مدل', () => {
  test('خروجی سالم بدون اصلاح رد می‌شود', () => {
    const v = validateRewrite(GOOD_OUTPUT, { categories: CATEGORIES });
    assert.equal(v.title, GOOD_OUTPUT.title);
    assert.equal(v.category, 'شهری و عمرانی');
    assert.equal(v.tags.length, 3);
    assert.deepEqual(v.corrections, []);
  });

  test('خط «منبع: …» که مدل نوشته باشد حذف می‌شود', () => {
    const v = validateRewrite(
      { ...GOOD_OUTPUT, body: `${GOOD_OUTPUT.body}\n\nمنبع: خبرگزاری نمونه` },
      { categories: CATEGORIES },
    );
    assert.ok(!v.body.includes('منبع:'));
    assert.ok(v.corrections.some((c) => c.includes('منبع')));
  });

  test('تکرار لید در ابتدای متن حذف می‌شود', () => {
    const v = validateRewrite(
      { ...GOOD_OUTPUT, body: `${GOOD_OUTPUT.lead}\n\n${GOOD_OUTPUT.body}` },
      { categories: CATEGORIES },
    );
    assert.ok(!v.body.startsWith('چهار ایستگاه نخست'));
    assert.ok(v.corrections.some((c) => c.includes('لید')));
  });

  test('نشانه‌گذاری مارک‌داون از متن پاک می‌شود', () => {
    const v = validateRewrite(
      { ...GOOD_OUTPUT, title: '## تیتر با **تأکید**' },
      { categories: CATEGORIES },
    );
    assert.equal(v.title, 'تیتر با تأکید');
  });

  test('تگ تکراری و خالی حذف می‌شود', () => {
    const v = validateRewrite(
      { ...GOOD_OUTPUT, tags: ['شیراز', 'شیراز', '', '#مترو', 'مترو'] },
      { categories: CATEGORIES },
    );
    assert.deepEqual(v.tags, ['شیراز', 'مترو']);
  });

  test('تگ به‌صورت رشتهٔ جدا شده با ویرگول هم پذیرفته می‌شود', () => {
    const v = validateRewrite(
      { ...GOOD_OUTPUT, tags: 'شیراز، قطار شهری، حمل و نقل' },
      { categories: CATEGORIES },
    );
    assert.equal(v.tags.length, 3);
  });

  test('متن بیش از حد کوتاه پذیرفته نمی‌شود', () => {
    assert.throws(
      () => validateRewrite({ ...GOOD_OUTPUT, body: 'خیلی کوتاه.' }, { categories: CATEGORIES }),
      (err: unknown) => err instanceof AppError && err.code === 'REWRITE_BODY_TOO_SHORT',
    );
  });

  test('نبود تیتر یا لید خطای گویا می‌دهد', () => {
    assert.throws(
      () => validateRewrite({ ...GOOD_OUTPUT, title: '' }, { categories: CATEGORIES }),
      (err: unknown) => err instanceof AppError && err.code === 'REWRITE_NO_TITLE',
    );
    assert.throws(
      () => validateRewrite({ ...GOOD_OUTPUT, lead: '' }, { categories: CATEGORIES }),
      (err: unknown) => err instanceof AppError && err.code === 'REWRITE_NO_LEAD',
    );
  });
});

describe('تطبیق دسته‌بندی', () => {
  test('دستهٔ دقیق شناسایی می‌شود', () => {
    assert.equal(matchCategory('ورزشی', CATEGORIES), 'ورزشی');
  });

  test('دستهٔ ناقص به نزدیک‌ترین دستهٔ مجاز نگاشت می‌شود', () => {
    assert.equal(matchCategory('شهری', CATEGORIES), 'شهری و عمرانی');
    assert.equal(matchCategory('عمرانی', CATEGORIES), 'شهری و عمرانی');
  });

  test('دستهٔ کاملاً بی‌ربط، تطبیق پیدا نمی‌کند', () => {
    assert.equal(matchCategory('آشپزی', CATEGORIES), null);
  });

  test('دستهٔ نامعتبر با اصلاح به اولین دستهٔ مجاز برمی‌گردد', () => {
    const v = validateRewrite({ ...GOOD_OUTPUT, category: 'آشپزی' }, { categories: CATEGORIES });
    assert.ok(CATEGORIES.includes(v.category));
    assert.ok(v.corrections.some((c) => c.includes('فهرست مجاز')));
  });
});

describe('محافظ کپی عینی', () => {
  test('کپی کامل متن منبع تشخیص داده می‌شود', () => {
    const r = verbatimOverlap(metro.body, metro.body);
    assert.equal(r.ratio, 1);
    assert.ok(r.longestRun > app.rewrite.max_verbatim_run);
  });

  test('کپی با جابه‌جایی چند کلمه هم تشخیص داده می‌شود', () => {
    const sneaky = metro.body.replace('اعلام کرد', 'گفت').replace('افزود', 'اضافه کرد');
    const r = verbatimOverlap(metro.body, sneaky);
    assert.ok(
      r.ratio > app.rewrite.max_verbatim_ratio,
      `باید کپی تشخیص داده شود، نسبت: ${r.ratio}`,
    );
  });

  test('بازنویسی واقعی از محافظ رد می‌شود', () => {
    const r = verbatimOverlap(metro.body, `${GOOD_OUTPUT.lead}\n\n${GOOD_OUTPUT.body}`);
    assert.ok(
      r.ratio <= app.rewrite.max_verbatim_ratio && r.longestRun <= app.rewrite.max_verbatim_run,
      `بازنویسی سالم نباید رد شود، نسبت: ${r.ratio}، دنباله: ${r.longestRun}`,
    );
  });

  test('نقل قول مستقیم داخل گیومه کپی حساب نمی‌شود', () => {
    const quote = 'او گفت: «این پروژه تا پایان سال به بهره‌برداری می‌رسد و چهار ایستگاه دارد».';
    const r = verbatimOverlap(quote, quote);
    assert.equal(r.ratio, 0);
  });
});

describe('بازنویسی کامل (با مدل ساختگی)', () => {
  test('خروجی سالم پذیرفته می‌شود', async () => {
    const result = await rewriteOne(material(), { app, chat: fakeChat([GOOD_OUTPUT]) });
    assert.equal(result.article.title, GOOD_OUTPUT.title);
    assert.equal(result.model, 'fake-model');
    assert.equal(result.meta.final_attempt, 1);
  });

  test('اگر مدل کپی کند، بار دوم با تذکر امتحان می‌شود', async () => {
    const copied: RawRewriteOutput = { ...GOOD_OUTPUT, body: metro.body };
    const result = await rewriteOne(material(), {
      app,
      chat: fakeChat([copied, GOOD_OUTPUT]),   // تلاش اول کپی، تلاش دوم سالم
    });
    assert.equal(result.meta.final_attempt, 2);
    assert.equal(result.article.body, GOOD_OUTPUT.body);
  });

  test('اگر هر دو تلاش کپی باشند، خبر کنار گذاشته می‌شود', async () => {
    const copied: RawRewriteOutput = { ...GOOD_OUTPUT, body: metro.body };
    await assert.rejects(
      () => rewriteOne(material(), { app, chat: fakeChat([copied]) }),
      (err: unknown) => err instanceof AppError && err.code === 'REWRITE_TOO_SIMILAR',
    );
  });

  test('تذکر ضدکپی فقط در تلاش دوم فرستاده می‌شود', async () => {
    const seen: number[] = [];
    const copied: RawRewriteOutput = { ...GOOD_OUTPUT, body: metro.body };
    const outputs = [copied, GOOD_OUTPUT];
    let call = 0;

    await rewriteOne(material(), {
      app,
      chat: async (messages) => {
        seen.push(messages.filter((m) => m.role === 'system').length);
        const data = outputs[call++]!;
        return { data, model: 'fake', usage: {}, durationMs: 1 };
      },
    });

    assert.deepEqual(seen, [1, 2], 'تلاش اول یک پیام سیستمی، تلاش دوم دو تا');
  });

  test('هزینه و مدت هر تلاش در متادیتا ثبت می‌شود', async () => {
    const result = await rewriteOne(material(), { app, chat: fakeChat([GOOD_OUTPUT]) });
    const attempts = result.meta.attempts as Record<string, unknown>[];
    assert.equal(attempts.length, 1);
    assert.ok('usage' in attempts[0]!);
    assert.ok('verbatim_ratio' in attempts[0]!);
  });
});

describe('ساخت پیام‌های ارسالی', () => {
  test('راهنمای سبک و دسته‌بندی‌ها داخل پرامپت می‌آیند', () => {
    const prompt = buildSystemPrompt(app);
    assert.ok(prompt.includes('هرم وارونه'), 'راهنمای سبک باید تزریق شده باشد');
    for (const category of CATEGORIES) {
      assert.ok(prompt.includes(category), `دستهٔ «${category}» باید در پرامپت باشد`);
    }
    assert.ok(prompt.includes(app.brand.name));
    assert.ok(!prompt.includes('{{'), 'هیچ جانشین پرنشده‌ای نباید بماند');
  });

  test('منابع تکمیلی در پیام کاربر می‌آیند', () => {
    const withExtra: SourceMaterial = {
      ...material(),
      supplementary: [{ title: fixture[3].title, body: fixture[3].body, sourceName: 'منبع دوم' }],
    };
    const message = buildUserMessage(withExtra);
    assert.ok(message.includes('منابع تکمیلی'));
    assert.ok(message.includes('منبع دوم'));
    assert.ok(message.includes(fixture[3].title));
  });

  test('بدون منبع تکمیلی، بخش اضافه‌ای در پیام نیست', () => {
    assert.ok(!buildUserMessage(material()).includes('منابع تکمیلی'));
  });
});

describe('خط منبع و نشانی خبر', () => {
  test('خط منبع از منابع واقعی ساخته می‌شود', () => {
    const line = buildSourceLine([
      { source_name: 'خبرگزاری الف', role: 'primary' },
      { source_name: 'خبرگزاری ب', role: 'supplementary' },
    ]);
    assert.equal(line, 'منبع: خبرگزاری الف، خبرگزاری ب');
  });

  test('نام تکراری منبع دو بار نمی‌آید', () => {
    const line = buildSourceLine([
      { source_name: 'خبرگزاری الف', role: 'primary' },
      { source_name: 'خبرگزاری الف', role: 'supplementary' },
    ]);
    assert.equal(line, 'منبع: خبرگزاری الف');
  });

  test('اسلاگ فارسی سئوفرندلی ساخته می‌شود', () => {
    const slug = slugify(GOOD_OUTPUT.title as string);
    assert.ok(slug.includes('شیراز'));
    assert.ok(!slug.includes(' '));
    assert.ok(!/[!؟.,،:]/.test(slug));
  });

  test('اسلاگ طولانی روی مرز کلمه کوتاه می‌شود', () => {
    const slug = slugify('آغاز مرمت خانه‌های تاریخی محله سنگ سیاه شیراز با اعتبار شهرداری و مشارکت بخش خصوصی استان فارس');
    assert.ok(slug.length <= 80);
    assert.ok(!slug.endsWith('-'));
  });
});

describe('تفکیک خطای گذرا از خطای محتوا', () => {
  test('کپی بودن خروجی، خطای محتواست و خبر کنار گذاشته می‌شود', () => {
    assert.equal(isContentFailure(new AppError('REWRITE_TOO_SIMILAR', 'کپی بود')), true);
    assert.equal(isContentFailure(new AppError('REWRITE_BODY_TOO_SHORT', 'کوتاه بود')), true);
  });

  test('خطای سرویس گذراست و خبر برای تلاش بعدی می‌ماند', () => {
    // بدون این تفکیک، یک قطعی چنددقیقه‌ای OpenAI کل صف خبر را دور می‌ریخت
    assert.equal(isContentFailure(new AppError('OPENAI_ERROR', 'پاسخ 503')), false);
    assert.equal(isContentFailure(new AppError('OPENAI_FAILED', 'شبکه قطع بود')), false);
    assert.equal(isContentFailure(new Error('خطای ناشناخته')), false);
  });
});
