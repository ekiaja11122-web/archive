/**
 * تست‌های نرمال‌سازی متن فارسی و تحلیل تاریخ.
 *
 * این‌ها پایهٔ تشخیص تکراری و فیلتر شیراز هستند: اگر «شيراز» عربی و
 * «شیراز» فارسی یکی حساب نشوند، هر دو مرحله از کار می‌افتند.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeForCompare, normalizeForDisplay, contentHash, titleFingerprint,
  htmlToText, toEnglishDigits, toPersianDigits, truncate, wordCount,
} from '../src/lib/text.ts';
import { parseDate, jalaliToGregorian } from '../src/lib/date.ts';

describe('نرمال‌سازی برای مقایسه', () => {
  test('حروف عربی را به فارسی یکسان می‌کند', () => {
    assert.equal(normalizeForCompare('شيراز'), normalizeForCompare('شیراز'));
    assert.equal(normalizeForCompare('كتاب'), normalizeForCompare('کتاب'));
    assert.equal(normalizeForCompare('مدرسة'), normalizeForCompare('مدرسه'));
  });

  test('ارقام فارسی و عربی و انگلیسی را یکسان می‌کند', () => {
    assert.equal(normalizeForCompare('۱۴۰۵'), '1405');
    assert.equal(normalizeForCompare('١٤٠٥'), '1405');
  });

  test('اعراب، نیم‌فاصله و علائم نگارشی را حذف می‌کند', () => {
    assert.equal(normalizeForCompare('مَدرِسه‌ی بزرگ!'), 'مدرسه ی بزرگ');
  });
});

describe('هش محتوا', () => {
  test('دو نگارش مختلف از یک متن، هش یکسان می‌دهند', () => {
    assert.equal(
      contentHash('شهرداري شيراز', 'خبر مهم'),
      contentHash('شهرداری شیراز', 'خبر مهم'),
    );
  });

  test('دو متن واقعاً متفاوت، هش متفاوت می‌دهند', () => {
    assert.notEqual(contentHash('خبر یک', 'متن'), contentHash('خبر دو', 'متن'));
  });

  test('عنوان یکسان با متن متفاوت، هش متفاوت می‌دهد', () => {
    assert.notEqual(contentHash('عنوان', 'متن اول'), contentHash('عنوان', 'متن دوم'));
  });
});

describe('اثر انگشت عنوان', () => {
  test('واژه‌های پرتکرار بی‌معنا را حذف می‌کند', () => {
    assert.equal(
      titleFingerprint('افتتاح پل جدید در بلوار چمران شیراز اعلام شد'),
      'افتتاح پل جدید بلوار چمران شیراز',
    );
  });

  test('دو تیتر از یک رویداد، واژه‌های مشترک زیادی دارند', () => {
    const a = new Set(titleFingerprint('بهره‌برداری از فاز نخست خط دو قطار شهری شیراز').split(' '));
    const b = new Set(titleFingerprint('فاز اول خط دو قطار شهری شیراز افتتاح می‌شود').split(' '));
    const shared = [...a].filter((w) => b.has(w));
    assert.ok(shared.length >= 4, `واژهٔ مشترک کافی نبود: ${shared.join('، ')}`);
  });
});

describe('نرمال‌سازی برای نمایش', () => {
  test('فاصلهٔ پیش از علائم را درست می‌کند', () => {
    assert.equal(normalizeForDisplay('سلام  ،دنیا'), 'سلام، دنیا');
  });

  test('نیم‌فاصله را نگه می‌دارد', () => {
    assert.ok(normalizeForDisplay('می‌رود').includes('‌'));
  });

  test('خط خالی اضافه را جمع می‌کند ولی پاراگراف را نگه می‌دارد', () => {
    assert.equal(normalizeForDisplay('یک\n\n\n\nدو'), 'یک\n\nدو');
  });
});

describe('تبدیل HTML به متن', () => {
  test('تگ‌ها را برمی‌دارد و پاراگراف را نگه می‌دارد', () => {
    assert.equal(htmlToText('<p>یک</p><p>دو</p>'), 'یک\n\nدو');
  });

  test('اسکریپت و استایل را کامل حذف می‌کند', () => {
    assert.equal(htmlToText('<p>متن</p><script>alert(1)</script>'), 'متن');
  });

  test('کدهای HTML فارسی را رمزگشایی می‌کند', () => {
    assert.equal(htmlToText('<p>&laquo;شیراز&raquo; &amp; فارس</p>'), '«شیراز» & فارس');
  });
});

describe('تاریخ', () => {
  test('تاریخ استاندارد ISO را می‌فهمد', () => {
    assert.equal(parseDate('2026-08-27T09:30:00+03:30')?.toISOString(), '2026-08-27T06:00:00.000Z');
  });

  test('تاریخ شمسی عددی با ارقام فارسی را می‌فهمد', () => {
    assert.equal(parseDate('۱۴۰۵/۰۶/۰۵')?.toISOString().slice(0, 10), '2026-08-26');
  });

  test('تاریخ شمسی حروفی را می‌فهمد', () => {
    const parsed = parseDate('۵ شهریور ۱۴۰۵ ساعت ۱۴:۲۰');
    assert.equal(parsed?.toISOString(), '2026-08-27T10:50:00.000Z');
  });

  test('تبدیل شمسی به میلادی درست است', () => {
    assert.deepEqual(jalaliToGregorian(1404, 1, 1), [2025, 3, 21]);   // اول فروردین ۱۴۰۴
    assert.deepEqual(jalaliToGregorian(1405, 6, 5), [2026, 8, 27]);
  });

  test('رشتهٔ بی‌معنا تاریخ غلط نمی‌سازد', () => {
    assert.equal(parseDate('چیز نامفهوم'), undefined);
    assert.equal(parseDate(''), undefined);
    assert.equal(parseDate(null), undefined);
  });
});

describe('ابزارهای کمکی', () => {
  test('ارقام را به فارسی و انگلیسی برمی‌گرداند', () => {
    assert.equal(toPersianDigits('سال 1404'), 'سال ۱۴۰۴');
    assert.equal(toEnglishDigits('سال ۱۴۰۴'), 'سال 1404');
  });

  test('کوتاه‌سازی روی مرز کلمه انجام می‌شود', () => {
    const result = truncate('یک دو سه چهار پنج شش هفت', 12);
    assert.ok(result.endsWith('…'));
    assert.ok(!result.includes('چهار'), `نباید کلمه نصفه بماند: ${result}`);
  });

  test('متن کوتاه‌تر از حد، دست‌نخورده می‌ماند', () => {
    assert.equal(truncate('کوتاه', 50), 'کوتاه');
  });

  test('شمارش کلمات', () => {
    assert.equal(wordCount('یک دو سه'), 3);
    assert.equal(wordCount(''), 0);
  });
});
