/**
 * تست‌های فیلتر مرتبط‌بودن با شیراز.
 *
 * این تست‌ها به دیتابیس و اینترنت نیاز ندارند: امتیازدهی کلیدواژه‌ای
 * تابعی خالص است و تصمیم‌گیری هم بدون کلید OpenAI به همان معیار
 * کلیدواژه‌ای برمی‌گردد.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
delete process.env.OPENAI_API_KEY;   // مسیر بدون مدل زبانی آزمایش می‌شود

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scoreRelevance } from '../src/pipeline/relevance-score.ts';
import { decideRelevance } from '../src/pipeline/relevance.ts';
import { loadAppConfig } from '../src/config/app-config.ts';

const app = loadAppConfig();
const CERTAIN = app.relevance.certain_threshold;
const IRRELEVANT = app.relevance.irrelevant_threshold;

describe('امتیازدهی کلیدواژه‌ای', () => {
  test('خبر آشکارا شیرازی امتیاز قطعی می‌گیرد', () => {
    const r = scoreRelevance(
      'افتتاح خط دو قطار شهری شیراز',
      'سازمان قطار شهری شیراز اعلام کرد این خط تا پایان سال افتتاح می‌شود.',
    );
    assert.ok(r.score >= CERTAIN, `امتیاز باید حداقل ${CERTAIN} باشد، بود: ${r.score}`);
  });

  test('خبر سراسری امتیاز منفی یا صفر می‌گیرد', () => {
    const r = scoreRelevance(
      'افزایش نرخ سود سپرده‌های بانکی',
      'بانک مرکزی در بخشنامه‌ای به شبکهٔ بانکی، نرخ سود را در سراسر کشور بازنگری کرد.',
    );
    assert.ok(r.score < IRRELEVANT, `امتیاز باید کمتر از ${IRRELEVANT} باشد، بود: ${r.score}`);
  });

  test('تطبیق در تیتر بیشتر از متن ارزش دارد', () => {
    const inTitle = scoreRelevance('حادثه در شیراز', 'گزارشی از یک حادثه.');
    const inBody = scoreRelevance('حادثه در یک شهر', 'این حادثه در شیراز رخ داد.');
    assert.ok(inTitle.score > inBody.score);
  });

  test('جاذبه‌های شیراز بدون نام بردن شهر هم شناسایی می‌شوند', () => {
    const r = scoreRelevance('بازدید از تخت جمشید رکورد زد', 'شمار بازدیدکنندگان افزایش یافت.');
    assert.ok(r.score >= CERTAIN);
  });
});

describe('تله‌های کلمهٔ «فارس»', () => {
  test('«خبرگزاری فارس» نباید خبر را مرتبط با استان فارس کند', () => {
    const r = scoreRelevance(
      'خبرگزاری فارس: نرخ ارز اعلام شد',
      'به گزارش خبرگزاری فارس، بانک مرکزی نرخ جدید ارز را اعلام کرد.',
    );
    assert.ok(r.score < IRRELEVANT, `امتیاز نباید مثبت باشد، بود: ${r.score}`);
  });

  test('«خلیج فارس» جغرافیای ملی است، نه استان فارس', () => {
    const r = scoreRelevance('تردد کشتی‌ها در خلیج فارس', 'ناوگان تجاری در خلیج فارس فعال است.');
    assert.ok(r.score < IRRELEVANT, `امتیاز نباید مثبت باشد، بود: ${r.score}`);
  });

  test('«زبان فارسی» ربطی به استان فارس ندارد', () => {
    const r = scoreRelevance('آموزش زبان فارسی', 'برنامهٔ آموزش زبان فارسی در مدارس اجرا می‌شود.');
    assert.ok(r.score < IRRELEVANT);
  });

  test('کلمهٔ «فارسی» نباید با «فارس» اشتباه گرفته شود', () => {
    const r = scoreRelevance('ادبیات فارسی', 'پژوهشی دربارهٔ ادبیات فارسی منتشر شد.');
    assert.ok(r.score < IRRELEVANT);
  });
});

describe('نشانه‌های منفی', () => {
  test('خبر شیرازی که تهران را هم نام برده، حذف نمی‌شود', () => {
    const r = scoreRelevance(
      'شهردار شیراز در تهران با وزیر کشور دیدار کرد',
      'شهردار شیراز امروز در تهران با وزیر کشور دربارهٔ بودجهٔ شهری گفت‌وگو کرد.',
    );
    assert.ok(r.score >= CERTAIN, `خبر شیرازی نباید با جریمهٔ تهران بیفتد، امتیاز: ${r.score}`);
  });

  test('جریمه سقف دارد و امتیاز را بی‌نهایت پایین نمی‌برد', () => {
    const many = scoreRelevance(
      'نشست کلانشهرها',
      'نمایندگان تهران، اصفهان، مشهد، تبریز، کرج، اهواز، قم و رشت حاضر بودند.',
    );
    assert.ok(many.score >= -app.relevance.max_negative_penalty);
  });
});

describe('پسوندهای فارسی', () => {
  test('«شیرازی» هم مثل «شیراز» شناسایی می‌شود', () => {
    const r = scoreRelevance('هنرمندان شیرازی درخشیدند', 'گروهی از هنرمندان شیرازی جایزه گرفتند.');
    assert.ok(r.score > 0, `باید شناسایی شود، امتیاز: ${r.score}`);
  });
});

describe('توضیح تصمیم', () => {
  test('کلیدواژه‌های پیداشده در توضیح می‌آیند', () => {
    const r = scoreRelevance('افتتاح پروژه در شیراز', 'شهرداری شیراز اعلام کرد.');
    assert.match(r.reason, /شیراز/);
    assert.ok(r.matches.length > 0);
  });

  test('وقتی چیزی پیدا نشد، توضیح گویاست', () => {
    const r = scoreRelevance('خبر بی‌ربط', 'متنی بدون هیچ نشانهٔ محلی.');
    assert.match(r.reason, /هیچ نشانه/);
  });
});

describe('تصمیم نهایی بدون مدل زبانی', () => {
  test('خبر قطعی مرتبط، بدون تماس با مدل تصمیم‌گیری می‌شود', async () => {
    const d = await decideRelevance('افتتاح مترو شیراز', 'سازمان قطار شهری شیراز اعلام کرد.');
    assert.equal(d.relevant, true);
    assert.equal(d.method, 'keyword');
  });

  test('خبر قطعی نامرتبط، بدون تماس با مدل رد می‌شود', async () => {
    const d = await decideRelevance('قیمت جهانی طلا', 'بازارهای جهانی امروز رشد داشتند.');
    assert.equal(d.relevant, false);
    assert.equal(d.method, 'keyword');
  });

  test('مورد مرزی بدون کلید OpenAI کرش نمی‌کند و تصمیم می‌گیرد', async () => {
    const d = await decideRelevance('برداشت انار در مرودشت', 'کشاورزان برداشت را آغاز کردند.');
    assert.equal(d.method, 'keyword');
    assert.match(d.reason, /مورد مرزی/);
    assert.equal(typeof d.relevant, 'boolean');
  });

  test('جزئیات تصمیم برای بازبینی ثبت می‌شود', async () => {
    const d = await decideRelevance('افتتاح مترو شیراز', 'سازمان قطار شهری شیراز اعلام کرد.');
    assert.ok(typeof d.details.keyword_score === 'number');
    assert.ok(Array.isArray(d.details.matches));
  });
});
