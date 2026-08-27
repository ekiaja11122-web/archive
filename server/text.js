/**
 * نرمال‌سازی متن فارسی برای جست‌وجوی دقیق و بدون حساسیت به شکل نگارش
 *
 * مشکلی که این ماژول حل می‌کند:
 *   «آيت‌الله دستغيب» (با ی و ک عربی و نیم‌فاصله) و «ایت الله دستغیب»
 *   و «آیت‌الله دستغیب» باید همگی یکدیگر را پیدا کنند.
 *
 * راهکار: برای هر متن دو گونه ذخیره می‌شود ـ گونهٔ «بافاصله» و گونهٔ «بی‌فاصله» ـ
 * و هنگام جست‌وجو هر دو گونه بررسی می‌شوند. این‌گونه هم «می روم» و هم «میروم»
 * رکورد «می‌روم» را پیدا می‌کنند.
 */

const ARABIC_TO_PERSIAN = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',   // ي ى ئ
  'ك': 'ک',                                   // ك
  'ة': 'ه', 'ۀ': 'ه',                    // ة ۀ
  'ؤ': 'و',                                   // ؤ
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', // أ إ آ ٱ
};
const ARABIC_CHARS = /[يىئكةۀؤأإآٱ]/g;

/** اعراب، تشدید، تنوین، کشیدگی (ـ) و نشانه‌های جهت‌دهی — حذف می‌شوند */
const DIACRITICS = /[ً-ٰٕـ‎‏‪-‮﻿]/g;

/** نیم‌فاصله و اتصال‌دهنده‌ها — به فاصله تبدیل می‌شوند */
const ZERO_WIDTH_JOINERS = /[‌‍]/g;

/** علائم نگارشی و جداکننده‌ها — به فاصله تبدیل می‌شوند */
const PUNCTUATION = /[\/\\_\-–—.,;:!?()\[\]{}«»"'`~*#+=|@٬،؛؟۔]/g;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی -> انگلیسی */
export function normalizeDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** نرمال‌سازی پایه: حروف عربی، اعراب، ارقام، علائم و فاصله‌ها */
export function normalize(s) {
  if (s == null) return '';
  let t = String(s).toLowerCase();
  t = t.replace(DIACRITICS, '');
  t = t.replace(ZERO_WIDTH_JOINERS, ' ');
  t = t.replace(ARABIC_CHARS, (ch) => ARABIC_TO_PERSIAN[ch] || ch);
  t = normalizeDigits(t);
  t = t.replace(PUNCTUATION, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/** گونهٔ بی‌فاصله: «آیت الله» -> «ایتالله» */
export function normalizeJoined(s) {
  return normalize(s).replace(/\s+/g, '');
}

/** ساخت متن جست‌وجوی یک رکورد از همهٔ فیلدهای مرتبط (هر دو گونه) */
export function buildSearchBlob(parts) {
  const text = parts.filter((p) => p != null && p !== '').join(' \n ');
  const spaced = normalize(text);
  const joined = spaced.replace(/ /g, '');
  return spaced + '\n' + joined;
}

/**
 * تبدیل عبارت کاربر به شرط SQL.
 * پشتیبانی: چند کلمه (همه باید باشند)، "عبارت دقیق"، و حذف با -کلمه
 */
export function buildSearchClause(query, column = 'search_blob') {
  const raw = String(query ?? '').trim();
  if (!raw) return { sql: '', params: [] };

  // تکه‌تکه کردن روی عبارت خام تا گیومه و علامت منفی از بین نروند
  const tokens = [];
  const re = /(-?)"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[2] !== undefined) {
      tokens.push({ neg: m[1] === '-', text: m[2] });
    } else {
      const t = m[3];
      const neg = t.startsWith('-') && t.length > 1;
      tokens.push({ neg, text: neg ? t.slice(1) : t });
    }
  }

  const clauses = [];
  const params = [];
  for (const tok of tokens) {
    const spaced = normalize(tok.text);
    if (!spaced) continue;
    const joined = spaced.replace(/ /g, '');
    if (tok.neg) {
      // هیچ‌کدام از دو گونه نباید موجود باشد
      clauses.push(`(${column} NOT LIKE ? AND ${column} NOT LIKE ?)`);
    } else {
      // هر کدام از دو گونه کافی است
      clauses.push(`(${column} LIKE ? OR ${column} LIKE ?)`);
    }
    params.push(`%${spaced}%`, `%${joined}%`);
  }
  if (!clauses.length) return { sql: '', params: [] };
  return { sql: '(' + clauses.join(' AND ') + ')', params };
}

/** درصد شباهت دو رشته (برای تشخیص رکوردهای تکراری و پیشنهاد اصلاح) */
export function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}
