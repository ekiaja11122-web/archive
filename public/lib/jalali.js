/**
 * تبدیل تاریخ هجری شمسی (جلالی) و میلادی
 * پیاده‌سازی الگوریتم استاندارد جلالی (بر پایه الگوریتم jalaali-js - مجوز MIT)
 * این فایل هم در سرور (Node) و هم در مرورگر استفاده می‌شود.
 */

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

export const MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export const WEEKDAY_NAMES = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
export const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.trunc(a / b) * b;

function jalCal(jy, withoutLeap) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm, jump = 0, leap, leapG, march, n, i;

  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال جلالی نامعتبر: ' + jy);

  for (i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  march = 20 + leapJ - leapG;

  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let jd, jm, k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/** آیا سال جلالی کبیسه است؟ */
export function isLeapJalali(jy) {
  return jalCal(jy, false).leap === 0;
}

/** تعداد روزهای یک ماه جلالی */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

/** اعتبارسنجی تاریخ جلالی */
export function isValidJalali(jy, jm, jd) {
  return jy >= 1 && jy <= 3177 && jm >= 1 && jm <= 12
    && jd >= 1 && jd <= jalaliMonthLength(jy, jm);
}

/** میلادی -> جلالی */
export function toJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

/** جلالی -> میلادی */
export function toGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

/** شماره روز مطلق (برای مقایسه و محاسبات) */
export function jalaliToDayNumber(jy, jm, jd) {
  return j2d(jy, jm, jd);
}

/** شیء Date جاوااسکریپت -> جلالی */
export function dateToJalali(date = new Date()) {
  return toJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

const pad = (n) => String(n).padStart(2, '0');

/** رشتهٔ استاندارد تاریخ جلالی: 1403/05/12 */
export function formatJalali(jy, jm, jd) {
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/** تاریخ امروز به صورت رشتهٔ جلالی */
export function todayJalali() {
  const j = dateToJalali(new Date());
  return formatJalali(j.jy, j.jm, j.jd);
}

/** «الان» به صورت رشتهٔ تاریخ و ساعت جلالی: 1403/05/12 14:03 */
export function nowJalaliDateTime() {
  const d = new Date();
  const j = dateToJalali(d);
  return `${formatJalali(j.jy, j.jm, j.jd)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** تجزیهٔ رشتهٔ تاریخ جلالی با جداکنندهٔ / یا - یا . ؛ اعداد فارسی هم پذیرفته می‌شوند */
export function parseJalali(str) {
  if (!str) return null;
  const s = toEnglishDigits(String(str)).trim().replace(/[.\-‐-―]/g, '/');
  const m = s.match(/^(\d{2,4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  let jy = parseInt(m[1], 10);
  const jm = parseInt(m[2], 10);
  const jd = m[3] ? parseInt(m[3], 10) : 1;
  if (jy < 100) jy += jy > 50 ? 1300 : 1400; // 78 -> 1378 ، 03 -> 1403
  if (!isValidJalali(jy, jm, jd)) return null;
  return { jy, jm, jd, precision: m[3] ? 'day' : 'month' };
}

/** رشتهٔ جلالی -> رشتهٔ میلادی ISO (برای مرتب‌سازی و مقایسه) */
export function jalaliStringToISO(str) {
  const p = parseJalali(str);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** رشتهٔ میلادی ISO -> رشتهٔ جلالی */
export function isoToJalaliString(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const j = toJalali(+m[1], +m[2], +m[3]);
  return formatJalali(j.jy, j.jm, j.jd);
}

/** نام روز هفته برای یک تاریخ جلالی */
export function jalaliWeekday(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  const dow = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); // 0=یکشنبه
  return WEEKDAY_NAMES[(dow + 1) % 7];
}

/** ایندکس روز هفته (0=شنبه) */
export function jalaliWeekdayIndex(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  const dow = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay();
  return (dow + 1) % 7;
}

/** نمایش خوانا: ۱۲ مرداد ۱۴۰۳ */
export function formatJalaliLong(str) {
  const p = parseJalali(str);
  if (!p) return str || '';
  return `${toPersianDigits(p.jd)} ${MONTH_NAMES[p.jm - 1]} ${toPersianDigits(p.jy)}`;
}

/** ارقام انگلیسی -> فارسی */
export function toPersianDigits(v) {
  return String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** ارقام فارسی/عربی -> انگلیسی */
export function toEnglishDigits(v) {
  return String(v ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** اختلاف روز بین دو تاریخ جلالی */
export function daysBetween(a, b) {
  const pa = parseJalali(a), pb = parseJalali(b);
  if (!pa || !pb) return null;
  return jalaliToDayNumber(pb.jy, pb.jm, pb.jd) - jalaliToDayNumber(pa.jy, pa.jm, pa.jd);
}

/** افزودن روز به تاریخ جلالی */
export function addDays(str, days) {
  const p = parseJalali(str);
  if (!p) return null;
  const j = d2j(jalaliToDayNumber(p.jy, p.jm, p.jd) + days);
  return formatJalali(j.jy, j.jm, j.jd);
}

/** دههٔ تاریخ برای گروه‌بندی آماری: 1370 */
export function jalaliDecade(str) {
  const p = parseJalali(str);
  return p ? Math.floor(p.jy / 10) * 10 : null;
}
