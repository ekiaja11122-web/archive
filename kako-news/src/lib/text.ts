/**
 * ابزارهای متن فارسی.
 *
 * چرا لازم است: در فارسی یک کلمه به چند شکل نوشته می‌شود — «ي» عربی در برابر
 * «ی» فارسی، «ك» در برابر «ک»، اعداد عربی/انگلیسی/فارسی، نیم‌فاصله‌های جاافتاده
 * و اعراب. اگر متن را نرمال نکنیم، هش دو خبرِ کاملاً یکسان از دو منبع فرق می‌کند
 * و تشخیص تکراری از کار می‌افتد.
 *
 * نکتهٔ مهم: `normalizeForCompare` فقط برای *مقایسه و هش* است، نه برای نمایش.
 * متنی که به خواننده نشان داده می‌شود هرگز از این تابع رد نمی‌شود.
 */
import crypto from 'node:crypto';

// نگاشت حروف عربی به معادل فارسی
const CHAR_MAP: Record<string, string> = {
  'ي': 'ی', // ي → ی
  'ى': 'ی', // ى → ی
  'ك': 'ک', // ك → ک
  'ة': 'ه', // ة → ه
  'أ': 'ا', // أ → ا
  'إ': 'ا', // إ → ا
  'آ': 'ا', // آ → ا  (فقط در حالت مقایسه)
  'ؤ': 'و', // ؤ → و
  'ئ': 'ی', // ئ → ی
};

// اعراب و علامت‌های تشکیل که در مقایسه بی‌اثرند
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

// نویسه‌های نامرئی: نیم‌فاصله، فاصلهٔ صفر، علامت جهت متن
const INVISIBLE = /[​‌‍‎‏﻿]/g;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** اعداد فارسی و عربی را به رقم انگلیسی تبدیل می‌کند. */
export function toEnglishDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const pi = PERSIAN_DIGITS.indexOf(d);
    if (pi >= 0) return String(pi);
    return String(ARABIC_DIGITS.indexOf(d));
  });
}

/** ارقام انگلیسی را به فارسی تبدیل می‌کند (برای نمایش و متن منتشرشده). */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/**
 * پاک‌سازی سبک برای *نمایش و انتشار*:
 * یکسان‌سازی حروف عربی، حذف اعراب، مرتب کردن فاصله‌ها و علائم نگارشی.
 * نیم‌فاصله و «آ» حفظ می‌شوند چون در متن درست فارسی معنا دارند.
 */
export function normalizeForDisplay(input: string): string {
  if (!input) return '';
  let out = input.normalize('NFC');
  out = out.replace(DIACRITICS, '');
  out = out.replace(/[يىكةؤئ]/g, (c) => CHAR_MAP[c] ?? c);
  // فاصلهٔ اضافه پیش از علائم و نبود فاصله پس از آن‌ها
  out = out.replace(/\s+([،؛:.!؟])/g, '$1');
  out = out.replace(/([،؛:؟!])(?=[^\s\d])/g, '$1 ');
  // چند فاصله یا چند خط خالی پشت‌سرهم
  out = out.replace(/[ \t ]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * نرمال‌سازی تهاجمی برای *مقایسه و هش*.
 * همه‌چیز به ساده‌ترین شکل ممکن می‌رود: بدون اعراب، بدون نیم‌فاصله،
 * بدون علائم نگارشی، ارقام انگلیسی، حروف کوچک.
 */
export function normalizeForCompare(input: string): string {
  if (!input) return '';
  let out = input.normalize('NFC').toLowerCase();
  out = out.replace(DIACRITICS, '');
  out = out.replace(INVISIBLE, ' ');
  out = out.replace(/[يىكةأإآؤئ]/g, (c) => CHAR_MAP[c] ?? c);
  out = toEnglishDigits(out);
  // هر چیزی که حرف یا رقم نیست به فاصله تبدیل می‌شود
  out = out.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/** هش SHA-256 از محتوای نرمال‌شده؛ پایهٔ تشخیص خبر تکراریِ کاملاً یکسان. */
export function contentHash(title: string, body?: string | null): string {
  const material = `${normalizeForCompare(title)}\n${normalizeForCompare(body ?? '')}`;
  return crypto.createHash('sha256').update(material).digest('hex');
}

/**
 * اثر انگشت عنوان: عنوان نرمال‌شده بدون کلمات پرتکرار بی‌معنا.
 * برای شباهت‌سنجی عنوان دو خبر از دو منبع استفاده می‌شود.
 */
export function titleFingerprint(title: string): string {
  return normalizeForCompare(title)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .join(' ');
}

/** واژه‌های پرتکرار فارسی که در شباهت‌سنجی وزنی ندارند. */
export const STOP_WORDS = new Set([
  'از', 'به', 'با', 'در', 'را', 'که', 'این', 'آن', 'برای', 'تا', 'هم', 'یا',
  'و', 'است', 'شد', 'شده', 'می', 'های', 'ها', 'یک', 'بر', 'بی', 'ای', 'کرد',
  'کند', 'شود', 'بود', 'دارد', 'داد', 'خبر', 'گزارش', 'اعلام',
]);

/** متن HTML را به متن ساده تبدیل می‌کند و ساختار پاراگراف را نگه می‌دارد. */
export function htmlToText(html: string): string {
  let out = html;
  out = out.replace(/<(script|style|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n\n');
  out = out.replace(/<[^>]+>/g, ' ');
  out = decodeHtmlEntities(out);
  out = out.replace(/[ \t ]+/g, ' ');
  out = out.replace(/ *\n */g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', zwnj: '‌',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** کوتاه کردن متن روی مرز کلمه، برای خلاصه و پیش‌نمایش. */
export function truncate(input: string, maxChars: number, ellipsis = '…'): string {
  const text = input.trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + ellipsis;
}

/** شمارش تقریبی کلمات، برای اعتبارسنجی طول متن. */
export function wordCount(input: string): number {
  const trimmed = normalizeForCompare(input);
  return trimmed ? trimmed.split(' ').length : 0;
}
