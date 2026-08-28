/**
 * تبدیل خبر کاکو نیوز به قالب هر مقصد.
 *
 * از دیتابیس و شبکه جداست تا مستقیم قابل تست باشد.
 */
import { escapeHtml } from '../admin/html.ts';
import { toPersianDigits } from '../lib/text.ts';
import { escapeTelegramHtml, TELEGRAM_MAX_TEXT, TELEGRAM_MAX_CAPTION } from './telegram.ts';

export type RenderableArticle = {
  title: string;
  lead: string;
  body: string;
  slug: string;
  imageCredit?: string | null;
};

export type RenderOptions = {
  /** خط «منبع: …» که سامانه ساخته است */
  sourceLine?: string;
  /** ارقام انگلیسی متن به فارسی تبدیل شود */
  persianDigits?: boolean;
};

function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * بدنهٔ HTML پست وردپرس.
 *
 * لید به‌صورت پاراگراف پررنگ می‌آید (رسم رایج خبرنویسی فارسی)، بعد
 * پاراگراف‌های متن، و در پایان خط منبع داخل یک `<p>` با کلاس مشخص تا
 * در قالب سایت قابل استایل‌دهی باشد.
 */
export function renderWordPressContent(
  article: RenderableArticle,
  options: RenderOptions = {},
): string {
  const { sourceLine, persianDigits = true } = options;
  const shape = (text: string): string =>
    escapeHtml(persianDigits ? toPersianDigits(text) : text);

  const parts: string[] = [];

  if (article.lead.trim()) {
    parts.push(`<p class="kako-lead"><strong>${shape(article.lead.trim())}</strong></p>`);
  }

  for (const paragraph of toParagraphs(article.body)) {
    parts.push(`<p>${shape(paragraph).replace(/\n/g, '<br />')}</p>`);
  }

  if (article.imageCredit) {
    parts.push(`<p class="kako-image-credit"><small>${shape(article.imageCredit)}</small></p>`);
  }

  if (sourceLine) {
    parts.push(`<p class="kako-source"><small>${shape(sourceLine)}</small></p>`);
  }

  return parts.join('\n');
}

/** خلاصهٔ پست (excerpt) — همان لید، بدون تگ. */
export function renderExcerpt(article: RenderableArticle, persianDigits = true): string {
  const lead = article.lead.trim();
  return persianDigits ? toPersianDigits(lead) : lead;
}

// ---------------------------------------------------------------
// تلگرام
// ---------------------------------------------------------------

export type TelegramRenderOptions = {
  /** نشانی خبر در سایت */
  link: string;
  /** متن لینک پایانی، مثلاً «ادامه در سایت کاکو نیوز» */
  readMoreLabel: string;
  /** خط «منبع: …» */
  sourceLine?: string | undefined;
  /** امضای پایانی کانال */
  footer?: string | undefined;
  /** سقف نویسه: ۴۰۹۶ برای پیام، ۱۰۲۴ برای کپشن عکس */
  maxLength?: number;
  persianDigits?: boolean;
};

export type TelegramMessage = {
  text: string;
  /** آیا متن خبر برای جا شدن در محدودیت کوتاه شد؟ */
  truncated: boolean;
  length: number;
};

/**
 * ساخت پیام تلگرام.
 *
 * مسئلهٔ اصلی: کپشن عکس در تلگرام حداکثر **۱۰۲۴ نویسه** است و یک خبر
 * معمولی راحت از آن رد می‌شود. اگر کورکورانه ببریم، ممکن است لینک
 * «ادامه در سایت» قربانی شود — یعنی دقیقاً همان چیزی که پست تلگرام
 * برای آن فرستاده می‌شود.
 *
 * پس ترتیب اولویت از آخر به اول است: تیتر، لینک و امضا همیشه می‌مانند
 * و فقط **متن خبر** به‌اندازهٔ لازم کوتاه می‌شود. اگر حتی لید هم جا
 * نشود، فقط تیتر و لینک می‌رود.
 */
export function renderTelegramMessage(
  article: RenderableArticle,
  options: TelegramRenderOptions,
): TelegramMessage {
  const {
    link, readMoreLabel, sourceLine, footer,
    maxLength = TELEGRAM_MAX_TEXT, persianDigits = true,
  } = options;

  const shape = (text: string): string =>
    escapeTelegramHtml(persianDigits ? toPersianDigits(text) : text);

  // بخش‌های ثابت که هرگز حذف نمی‌شوند
  const head = `<b>${shape(article.title.trim())}</b>`;
  const tailParts: string[] = [];
  if (sourceLine) tailParts.push(shape(sourceLine));
  tailParts.push(`<a href="${escapeTelegramHtml(link)}">${shape(readMoreLabel)}</a>`);
  if (footer) tailParts.push(shape(footer));
  const tail = tailParts.join('\n');

  const fixedLength = [...head].length + [...tail].length + 4; // ۴ برای خط‌های خالی
  const budget = maxLength - fixedLength;

  const lead = article.lead.trim();
  const bodyParagraphs = toParagraphs(article.body);

  // متن را پاراگراف‌به‌پاراگراف تا جایی که بودجه اجازه می‌دهد اضافه می‌کنیم
  const chosen: string[] = [];
  let used = 0;
  let truncated = false;

  for (const paragraph of [lead, ...bodyParagraphs]) {
    if (!paragraph) continue;
    const shaped = shape(paragraph);
    const cost = [...shaped].length + 2;
    if (used + cost > budget) {
      truncated = true;
      // اگر حتی یک پاراگراف هم جا نشده، لید را بریده اضافه می‌کنیم
      if (chosen.length === 0 && budget > 60) {
        const room = budget - 2;
        chosen.push(cutOnWord(shaped, room));
      }
      break;
    }
    chosen.push(shaped);
    used += cost;
  }

  const text = [head, chosen.join('\n\n'), tail].filter(Boolean).join('\n\n');
  return { text, truncated, length: [...text].length };
}

/** همان پیام، با سقف کپشن عکس. */
export function renderTelegramCaption(
  article: RenderableArticle,
  options: Omit<TelegramRenderOptions, 'maxLength'>,
): TelegramMessage {
  return renderTelegramMessage(article, { ...options, maxLength: TELEGRAM_MAX_CAPTION });
}

/**
 * بریدن متن روی مرز کلمه، بدون شکستن موجودیت‌های HTML.
 * اگر وسط یک `&amp;` ببریم، تلگرام کل پیام را رد می‌کند.
 */
function cutOnWord(text: string, maxChars: number): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;

  let cut = chars.slice(0, maxChars).join('');
  // اگر انتهای بریده‌شده وسط یک موجودیت HTML افتاده، تا پیش از آن برمی‌گردیم
  const danglingEntity = /&[a-z]{0,6}$/i.exec(cut);
  if (danglingEntity) cut = cut.slice(0, danglingEntity.index);

  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.5) cut = cut.slice(0, lastSpace);

  return cut.trimEnd() + '…';
}
