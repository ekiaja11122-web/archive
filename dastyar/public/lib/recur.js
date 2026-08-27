/**
 * منطق تکرار کارها — مشترک بین سرور و مرورگر
 *
 * قاعدهٔ تکرار روی خود کار ذخیره می‌شود و «تاریخ سررسید» نقش تاریخ شروع را دارد.
 * برای هر روز مشخص می‌کنیم که آیا کار در آن روز سررسید دارد یا نه.
 */
import { diffDaysISO, dowISO, isoToJalali, addDaysISO } from './dt.js';
import { jalaliMonthLength, toPersianDigits } from './jalali.js';

export const REPEAT_LABELS = {
  none: 'بدون تکرار',
  daily: 'هر روز',
  weekdays: 'شنبه تا چهارشنبه',
  weekly: 'هفتگی',
  monthly: 'ماهانه',
  yearly: 'سالانه',
  every: 'هر چند روز یک‌بار',
};

/** آیا این کار در تاریخ داده‌شده سررسید دارد؟ */
export function isDueOn(task, iso) {
  const rule = task.repeat_rule || 'none';
  const start = task.due_date;

  if (rule === 'none') return !!start && start === iso;
  if (!start) return false;
  if (iso < start) return false;                       // هنوز شروع نشده

  switch (rule) {
    case 'daily':
      return true;
    case 'weekdays': {
      const d = dowISO(iso);
      return d !== null && d <= 4;                     // شنبه(۰) تا چهارشنبه(۴)
    }
    case 'weekly': {
      const days = String(task.repeat_days || '')
        .split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
      const d = dowISO(iso);
      if (days.length) return days.includes(d);
      return d === dowISO(start);
    }
    case 'monthly': {
      const a = isoToJalali(start), b = isoToJalali(iso);
      if (!a || !b) return false;
      if (a.jd === b.jd) return true;
      // اگر روز موردنظر در آن ماه وجود ندارد (مثلاً ۳۱ در ماه ۳۰ روزه)،
      // آخرین روز ماه به‌جای آن حساب می‌شود
      const len = jalaliMonthLength(b.jy, b.jm);
      return a.jd > len && b.jd === len;
    }
    case 'yearly': {
      const a = isoToJalali(start), b = isoToJalali(iso);
      return !!a && !!b && a.jm === b.jm && a.jd === b.jd;
    }
    case 'every': {
      const n = Math.max(1, parseInt(task.repeat_every, 10) || 1);
      const diff = diffDaysISO(start, iso);
      return diff !== null && diff >= 0 && diff % n === 0;
    }
    default:
      return false;
  }
}

/** نخستین سررسید از تاریخ داده‌شده به بعد (حداکثر تا یک سال جلو) */
export function nextDueOnOrAfter(task, iso, limitDays = 400) {
  let cur = iso;
  for (let i = 0; i <= limitDays; i += 1) {
    if (isDueOn(task, cur)) return cur;
    cur = addDaysISO(cur, 1);
  }
  return null;
}

export const isRepeating = (task) => !!task && (task.repeat_rule || 'none') !== 'none';

/** توضیح فارسی قاعدهٔ تکرار */
export function describeRepeat(task) {
  const rule = task.repeat_rule || 'none';
  if (rule === 'none') return '';
  if (rule === 'weekly') {
    const names = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
    const days = String(task.repeat_days || '').split(',').filter(Boolean).map((n) => names[+n]);
    return days.length ? `هر ${days.join(' و ')}` : 'هفتگی';
  }
  if (rule === 'every') {
    const n = Math.max(1, parseInt(task.repeat_every, 10) || 1);
    return `هر ${n === 1 ? 'روز' : toPersianDigits(n) + ' روز یک‌بار'}`;
  }
  return REPEAT_LABELS[rule] || '';
}
