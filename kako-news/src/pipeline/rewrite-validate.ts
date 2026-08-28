/**
 * اعتبارسنجی و پاک‌سازی خروجی مدل زبانی.
 *
 * مدل زبانی قابل اعتماد نیست که همیشه دقیقاً قالب خواسته‌شده را بدهد:
 * گاهی دسته‌بندی خارج از فهرست می‌سازد، گاهی لید را در ابتدای متن تکرار
 * می‌کند، گاهی خط «منبع: …» را خودش اضافه می‌کند، گاهی تگ‌ها را به‌صورت
 * یک رشتهٔ جدا شده با ویرگول برمی‌گرداند.
 *
 * این ماژول همهٔ این‌ها را سر جای خودش می‌گذارد و اگر خروجی واقعاً
 * غیرقابل استفاده بود، خطای گویا می‌دهد. عمداً از شبکه و دیتابیس جداست
 * تا مستقیم قابل تست باشد.
 */
import { AppError } from '../lib/errors.ts';
import { normalizeForDisplay, normalizeForCompare, wordCount, truncate } from '../lib/text.ts';

/** خروجی خام مدل، پیش از هر اعتبارسنجی. */
export type RawRewriteOutput = {
  title?: unknown;
  lead?: unknown;
  body?: unknown;
  category?: unknown;
  tags?: unknown;
};

export type ValidatedRewrite = {
  title: string;
  lead: string;
  body: string;
  category: string;
  tags: string[];
  /** اصلاح‌هایی که روی خروجی مدل انجام شد — برای بازبینی کیفیت */
  corrections: string[];
};

export type ValidateOptions = {
  categories: string[];
  minBodyWords?: number;
  maxTitleWords?: number;
  maxLeadWords?: number;
  minTags?: number;
  maxTags?: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** خط «منبع: …» را سامانه خودش می‌سازد؛ اگر مدل نوشته بود حذف می‌شود. */
function stripSourceLine(text: string): { text: string; removed: boolean } {
  const cleaned = text
    .split('\n')
    .filter((line) => !/^\s*(منبع|منابع)\s*[:：]/.test(line))
    .join('\n')
    .trim();
  return { text: cleaned, removed: cleaned !== text.trim() };
}

/** نشانه‌گذاری مارک‌داون که در متن خبر جایی ندارد. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?\S)\*(\s|$)/g, '$1$2$3')
    .replace(/^\s*[-*]\s+/gm, '');
}

/**
 * اگر مدل لید را در ابتدای متن تکرار کرده باشد، حذفش می‌کند.
 * مقایسه روی متن نرمال‌شده انجام می‌شود تا تفاوت نگارشی جزئی مانع نشود.
 */
function dropRepeatedLead(body: string, lead: string): { body: string; removed: boolean } {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const first = paragraphs[0];
  if (!first) return { body, removed: false };

  const normalizedLead = normalizeForCompare(lead);
  const normalizedFirst = normalizeForCompare(first);
  if (!normalizedLead || !normalizedFirst) return { body, removed: false };

  const isRepeat =
    normalizedFirst === normalizedLead ||
    (normalizedFirst.length > 40 && normalizedLead.startsWith(normalizedFirst)) ||
    (normalizedLead.length > 40 && normalizedFirst.startsWith(normalizedLead));

  if (!isRepeat) return { body, removed: false };
  return { body: paragraphs.slice(1).join('\n\n'), removed: true };
}

/** تگ‌ها ممکن است آرایه، رشتهٔ جدا شده با ویرگول، یا چیز دیگری باشند. */
function normalizeTags(value: unknown, min: number, max: number): { tags: string[]; note?: string } {
  let list: string[] = [];

  if (Array.isArray(value)) {
    list = value.filter((t): t is string => typeof t === 'string');
  } else if (typeof value === 'string') {
    list = value.split(/[,،]/);
  }

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const tag of list) {
    const normalized = normalizeForDisplay(tag).replace(/^#/, '').trim();
    if (!normalized || normalized.length > 40) continue;
    const key = normalizeForCompare(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
    if (cleaned.length >= max) break;
  }

  if (cleaned.length < min) {
    return { tags: cleaned, note: `تعداد برچسب‌ها کمتر از ${min} بود (${cleaned.length})` };
  }
  return { tags: cleaned };
}

/**
 * تطبیق دسته‌بندی با فهرست مجاز.
 * مدل گاهی «شهری» یا «عمرانی» می‌نویسد در حالی که دستهٔ مجاز
 * «شهری و عمرانی» است؛ تطبیق جزئی این را حل می‌کند.
 */
export function matchCategory(value: unknown, categories: string[]): string | null {
  const raw = normalizeForCompare(asString(value));
  if (!raw) return null;

  const exact = categories.find((c) => normalizeForCompare(c) === raw);
  if (exact) return exact;

  // دستهٔ مجازی که نام مدل بخشی از آن است، یا برعکس
  const partial = categories.find((c) => {
    const normalized = normalizeForCompare(c);
    return normalized.includes(raw) || raw.includes(normalized);
  });
  if (partial) return partial;

  // اشتراک کلمه‌ای
  const rawWords = new Set(raw.split(' '));
  for (const category of categories) {
    const words = normalizeForCompare(category).split(' ');
    if (words.some((w) => w.length > 2 && rawWords.has(w))) return category;
  }
  return null;
}

export function validateRewrite(
  output: RawRewriteOutput,
  options: ValidateOptions,
): ValidatedRewrite {
  const {
    categories,
    minBodyWords = 40,
    maxTitleWords = 16,
    maxLeadWords = 60,
    minTags = 2,
    maxTags = 6,
  } = options;

  const corrections: string[] = [];

  // --- تیتر ---
  let title = normalizeForDisplay(stripMarkdown(asString(output.title)))
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
  if (!title) {
    throw new AppError('REWRITE_NO_TITLE', 'مدل زبانی تیتری تولید نکرد', {});
  }
  if (wordCount(title) > maxTitleWords) {
    corrections.push(`تیتر بیش از ${maxTitleWords} کلمه بود و کوتاه شد`);
    title = truncate(title, 110, '');
  }

  // --- لید ---
  let lead = normalizeForDisplay(stripMarkdown(asString(output.lead)));
  if (!lead) {
    throw new AppError('REWRITE_NO_LEAD', 'مدل زبانی لید تولید نکرد', {});
  }
  if (wordCount(lead) > maxLeadWords) {
    corrections.push(`لید بیش از ${maxLeadWords} کلمه بود`);
  }

  // --- بدنه ---
  const bodyStripped = stripSourceLine(stripMarkdown(asString(output.body)));
  if (bodyStripped.removed) {
    corrections.push('خط «منبع: …» که مدل نوشته بود حذف شد (سامانه خودش اضافه می‌کند)');
  }

  const leadDropped = dropRepeatedLead(bodyStripped.text, lead);
  if (leadDropped.removed) {
    corrections.push('لید در ابتدای متن تکرار شده بود و حذف شد');
  }

  const body = normalizeForDisplay(leadDropped.body);
  if (!body) {
    throw new AppError('REWRITE_NO_BODY', 'مدل زبانی متنی تولید نکرد', {});
  }
  if (wordCount(body) < minBodyWords) {
    throw new AppError(
      'REWRITE_BODY_TOO_SHORT',
      `متن بازنویسی‌شده بیش از حد کوتاه است (${wordCount(body)} کلمه، حداقل ${minBodyWords})`,
      { words: wordCount(body) },
    );
  }

  // --- دسته‌بندی ---
  const matched = matchCategory(output.category, categories);
  const category = matched ?? categories[0] ?? '';
  if (!matched) {
    corrections.push(
      `دستهٔ «${truncate(asString(output.category), 30)}» در فهرست مجاز نبود؛ «${category}» گذاشته شد`,
    );
  }

  // --- برچسب‌ها ---
  const tagResult = normalizeTags(output.tags, minTags, maxTags);
  if (tagResult.note) corrections.push(tagResult.note);

  return { title, lead, body, category, tags: tagResult.tags, corrections };
}

/** ساخت خط «منبع: …» از روی منابع واقعی خبر در دیتابیس. */
export function buildSourceLine(
  sources: { source_name: string; role: 'primary' | 'supplementary' }[],
  template = 'منبع: {{SOURCES}}',
): string {
  const names: string[] = [];
  for (const source of sources) {
    if (!names.includes(source.source_name)) names.push(source.source_name);
  }
  if (names.length === 0) return '';
  return template.replace('{{SOURCES}}', names.join('، '));
}
