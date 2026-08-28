/**
 * تبدیل خبر کاکو نیوز به قالب هر مقصد.
 *
 * از دیتابیس و شبکه جداست تا مستقیم قابل تست باشد.
 */
import { escapeHtml } from '../admin/html.ts';
import { toPersianDigits } from '../lib/text.ts';

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
