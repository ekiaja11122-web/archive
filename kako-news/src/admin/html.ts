/**
 * ابزار ساخت HTML امن.
 *
 * ⚠️ چرا این ماژول مهم است: تمام محتوایی که در پنل نمایش داده می‌شود از
 * سایت‌های بیرونی آمده — تیتر، متن، نام نویسنده، حتی نشانی تصویر. اگر
 * سایتی در تیتر خبرش `<script>` بگذارد و ما مستقیم چاپش کنیم، کد آن سایت
 * در مرورگر سردبیر اجرا می‌شود.
 *
 * پس قاعده این است: **هیچ رشته‌ای بدون گذر از `escapeHtml` داخل صفحه
 * نمی‌رود.** تابع قالب `html` این کار را خودکار انجام می‌دهد؛ اگر جایی
 * واقعاً HTML خام لازم بود، باید صریحاً با `raw()` علامت‌گذاری شود تا در
 * بازبینی کد به چشم بیاید.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}

/** نشانهٔ «این رشته عمداً HTML خام است». */
export class SafeHtml {
  readonly value: string;

  // پارامتر-پراپرتی (`constructor(readonly value)`) اینجا استفاده نشده،
  // چون Node در حالت حذف تایپ آن را پشتیبانی نمی‌کند و پروژه بدون
  // مرحلهٔ build اجرا می‌شود.
  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/**
 * قالب رشته‌ای که مقادیر درج‌شده را خودکار escape می‌کند.
 *
 *   html`<h1>${title}</h1>`          ← title امن می‌شود
 *   html`<div>${raw(renderedRows)}</div>`  ← عمداً خام
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + (strings[i + 1] ?? '');
  }
  return new SafeHtml(out);
}

function renderValue(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

/** متن ساده را به پاراگراف‌های HTML تبدیل می‌کند (با escape کامل). */
export function paragraphs(text: string | null | undefined): SafeHtml {
  if (!text) return raw('');
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return raw(blocks);
}

/**
 * نشانی امن برای صفت href/src.
 * فقط http و https پذیرفته می‌شوند؛ `javascript:` و `data:` رد می‌شوند.
 */
export function safeUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
