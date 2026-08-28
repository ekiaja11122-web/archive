/**
 * تحلیل تاریخ خبر.
 *
 * سایت‌های خبری ایرانی تاریخ را به چند شکل می‌دهند:
 *   - استاندارد: 2026-08-27T09:30:00+03:30  (معمولاً در فیدهای RSS و متاتگ‌ها)
 *   - شمسی عددی: ۱۴۰۵/۰۶/۰۵ یا 1405-06-05
 *   - شمسی حروفی: ۵ شهریور ۱۴۰۵
 * این ماژول هر سه را می‌فهمد و در نهایت یک `Date` میلادی برمی‌گرداند.
 */
import { toEnglishDigits } from './text.ts';

const TEHRAN_OFFSET_MINUTES = 210; // +03:30

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/**
 * تبدیل تاریخ شمسی به میلادی.
 * پیاده‌سازی الگوریتم استاندارد تبدیل تقویم جلالی.
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = jy > 979 ? 1600 : 621;
  const jyAdjusted = jy > 979 ? jy - 979 : jy;

  let days =
    365 * jyAdjusted +
    Math.floor(jyAdjusted / 33) * 8 +
    Math.floor(((jyAdjusted % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  gy += 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthLengths = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  let gm = 0;
  for (gm = 1; gm <= 12; gm++) {
    const len = monthLengths[gm] ?? 0;
    if (gd <= len) break;
    gd -= len;
  }

  return [gy, gm, gd];
}

/** آیا این عدد می‌تواند سال شمسی باشد؟ */
function looksJalali(year: number): boolean {
  return year >= 1200 && year <= 1600;
}

function fromParts(y: number, m: number, d: number, hh = 0, mm = 0): Date | undefined {
  const [gy, gm, gd] = looksJalali(y) ? jalaliToGregorian(y, m, d) : [y, m, d];
  // زمان محلی تهران را به UTC تبدیل می‌کنیم
  const utc = Date.UTC(gy, gm - 1, gd, hh, mm) - TEHRAN_OFFSET_MINUTES * 60_000;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * تلاش برای فهمیدن تاریخ از یک رشتهٔ دلخواه.
 * اگر نشد `undefined` برمی‌گرداند — تاریخ نامعلوم بهتر از تاریخ غلط است.
 */
export function parseDate(input: string | null | undefined): Date | undefined {
  if (!input) return undefined;
  const text = toEnglishDigits(String(input).trim());
  if (!text) return undefined;

  // ۱) قالب‌های استاندارد که خود جاوااسکریپت می‌فهمد
  const native = new Date(text);
  if (!Number.isNaN(native.getTime())) {
    const year = native.getUTCFullYear();
    // اگر سال در محدودهٔ منطقی بود قبولش می‌کنیم
    if (year >= 1990 && year <= 2100) return native;
  }

  // ۲) قالب عددی: 1405/06/05 یا 1405-06-05 (شمسی یا میلادی)
  const numeric = /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text);
  if (numeric) {
    const [, y, m, d, hh, mm] = numeric;
    return fromParts(Number(y), Number(m), Number(d), Number(hh ?? 0), Number(mm ?? 0));
  }

  // ۳) قالب حروفی شمسی: ۵ شهریور ۱۴۰۵  (ساعت اختیاری)
  const named = new RegExp(`(\\d{1,2})\\s+(${JALALI_MONTHS.join('|')})\\s+(\\d{4})`).exec(text);
  if (named) {
    const [, d, monthName, y] = named;
    const monthIndex = JALALI_MONTHS.indexOf(monthName ?? '') + 1;
    const time = /(\d{1,2}):(\d{2})/.exec(text);
    return fromParts(Number(y), monthIndex, Number(d), Number(time?.[1] ?? 0), Number(time?.[2] ?? 0));
  }

  return undefined;
}

/** نمایش تاریخ به شمسی برای پنل مدیریت. */
export function formatTehran(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}
