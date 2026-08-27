/**
 * ابزار کار با تاریخ و ساعت — مشترک بین سرور (Worker) و مرورگر
 *
 * قاعدهٔ کلی برنامه:
 *   همهٔ تاریخ‌ها به صورت رشتهٔ «YYYY-MM-DD» میلادی ذخیره می‌شوند
 *   ولی همیشه معادل «روز تقویمی تهران» هستند.
 */
import * as J from './jalali.js';

export const TZ = 'Asia/Tehran';
const FALLBACK_OFFSET_MIN = 210; // +۳:۳۰ (ایران از ۱۴۰۱ ساعت تابستانی ندارد)

const pad = (n) => String(n).padStart(2, '0');

/** «الان» به وقت تهران */
export function nowTehran(now = new Date()) {
  let y, m, d, hh, mm;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});
    y = +parts.year; m = +parts.month; d = +parts.day;
    hh = +parts.hour % 24; mm = +parts.minute;
  } catch {
    const t = new Date(now.getTime() + FALLBACK_OFFSET_MIN * 60000);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    hh = t.getUTCHours(); mm = t.getUTCMinutes();
  }
  return {
    date: `${y}-${pad(m)}-${pad(d)}`,
    time: `${pad(hh)}:${pad(mm)}`,
    minutes: hh * 60 + mm,
  };
}

/** تاریخ امروز به وقت تهران */
export const todayISO = (now = new Date()) => nowTehran(now).date;

/** برچسب زمانی کامل برای ثبت در پایگاه داده */
export const stamp = () => new Date().toISOString();

/** تجزیهٔ رشتهٔ ISO */
export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** شمارهٔ روز مطلق (برای مقایسه و جمع و تفریق) */
export function isoToDayNumber(iso) {
  const p = parseISO(iso);
  if (!p) return null;
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}

export function dayNumberToISO(n) {
  const t = new Date(n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** افزودن روز به یک تاریخ ISO */
export function addDaysISO(iso, days) {
  const n = isoToDayNumber(iso);
  return n === null ? null : dayNumberToISO(n + days);
}

/** فاصلهٔ روز بین دو تاریخ ISO (b منهای a) */
export function diffDaysISO(a, b) {
  const na = isoToDayNumber(a), nb = isoToDayNumber(b);
  return na === null || nb === null ? null : nb - na;
}

/** روز هفته؛ شنبه = ۰ ... جمعه = ۶ */
export function dowISO(iso) {
  const p = parseISO(iso);
  if (!p) return null;
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 1) % 7;
}

/** تاریخ ISO -> شمسی به صورت شیء */
export function isoToJalali(iso) {
  const p = parseISO(iso);
  return p ? J.toJalali(p.y, p.m, p.d) : null;
}

/** شمسی -> ISO */
export function jalaliToISO(jy, jm, jd) {
  const g = J.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** افزودن ماه شمسی (برای اقساط ماهانه) — اگر روز در ماه مقصد نبود، آخرین روز ماه */
export function addJalaliMonths(iso, months) {
  const j = isoToJalali(iso);
  if (!j) return null;
  let jy = j.jy, jm = j.jm + months;
  jy += Math.floor((jm - 1) / 12);
  jm = ((jm - 1) % 12 + 12) % 12 + 1;
  const len = J.jalaliMonthLength(jy, jm);
  return jalaliToISO(jy, jm, Math.min(j.jd, len));
}

/** افزودن سال شمسی */
export function addJalaliYears(iso, years) {
  const j = isoToJalali(iso);
  if (!j) return null;
  const jy = j.jy + years;
  const len = J.jalaliMonthLength(jy, j.jm);
  return jalaliToISO(jy, j.jm, Math.min(j.jd, len));
}

/** اول و آخر ماه شمسیِ یک تاریخ */
export function jalaliMonthRange(iso) {
  const j = isoToJalali(iso);
  if (!j) return null;
  return {
    jy: j.jy, jm: j.jm,
    from: jalaliToISO(j.jy, j.jm, 1),
    to: jalaliToISO(j.jy, j.jm, J.jalaliMonthLength(j.jy, j.jm)),
  };
}

/** نمایش خوانا: «۱۲ مرداد ۱۴۰۳» */
export function formatISOLong(iso) {
  const j = isoToJalali(iso);
  if (!j) return '';
  return `${J.toPersianDigits(j.jd)} ${J.MONTH_NAMES[j.jm - 1]} ${J.toPersianDigits(j.jy)}`;
}

/** نمایش کوتاه: «۱۴۰۳/۰۵/۱۲» */
export function formatISOShort(iso) {
  const j = isoToJalali(iso);
  return j ? J.toPersianDigits(J.formatJalali(j.jy, j.jm, j.jd)) : '';
}

/** نمایش نسبی: امروز / فردا / دیروز / ۳ روز دیگر / ۲ روز پیش */
export function relativeDay(iso, today = todayISO()) {
  const d = diffDaysISO(today, iso);
  if (d === null) return '';
  if (d === 0) return 'امروز';
  if (d === 1) return 'فردا';
  if (d === 2) return 'پس‌فردا';
  if (d === -1) return 'دیروز';
  if (d > 0) return `${J.toPersianDigits(d)} روز دیگر`;
  return `${J.toPersianDigits(-d)} روز پیش`;
}

export { J, pad };
