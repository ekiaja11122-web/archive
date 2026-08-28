/**
 * سنجش شباهت دو خبر.
 *
 * مسئله: دو خبرگزاری یک رویداد را با نگارش کاملاً متفاوت پوشش می‌دهند.
 *   «بهره‌برداری از فاز نخست خط دو قطار شهری شیراز تا پایان سال»
 *   «فاز اول خط ۲ مترو شیراز تا پایان سال افتتاح می‌شود»
 * این دو باید یک خبر شمرده شوند، ولی هیچ هش یا تطبیق دقیقی آن‌ها را
 * یکی نمی‌بیند.
 *
 * چرا ضریب Jaccard استفاده نشده: Jaccard اختلاف طول را جریمه می‌کند و
 * وقتی یک منبع خبر مفصل و دیگری خبر کوتاه می‌نویسد، امتیاز را بی‌دلیل
 * پایین می‌آورد. به‌جایش «ضریب هم‌پوشانی» (تقسیم بر اندازهٔ کوچک‌تر)
 * استفاده می‌شود که دقیقاً برای همین حالت ساخته شده است.
 *
 * وزن‌دهی: عدد و تاریخ در خبر نشانهٔ قوی‌تری از هم‌رویداد بودن است
 * («۸۵ درصد»، «۴۰ هزار نفر»)، پس وزن بیشتری می‌گیرد.
 */
import { normalizeForCompare, STOP_WORDS } from './text.ts';

const NUMERIC_WEIGHT = 2;
const WORD_WEIGHT = 1;
const MIN_TOKEN_LENGTH = 2;

/** تبدیل متن به مجموعهٔ واژه‌های معنادار. */
export function significantTokens(text: string): Set<string> {
  const tokens = normalizeForCompare(text)
    .split(' ')
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(t));
  return new Set(tokens);
}

function weightOf(token: string): number {
  return /^\d+$/.test(token) ? NUMERIC_WEIGHT : WORD_WEIGHT;
}

function totalWeight(tokens: Iterable<string>): number {
  let sum = 0;
  for (const token of tokens) sum += weightOf(token);
  return sum;
}

/**
 * ضریب هم‌پوشانی وزن‌دار: وزن واژه‌های مشترک تقسیم بر وزن مجموعهٔ کوچک‌تر.
 * نتیجه بین ۰ و ۱.
 */
export function weightedOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let sharedWeight = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) sharedWeight += weightOf(token);
  }

  const denominator = Math.min(totalWeight(a), totalWeight(b));
  return denominator === 0 ? 0 : sharedWeight / denominator;
}

export type SimilarityBreakdown = {
  /** امتیاز نهایی، ۰ تا ۱ */
  score: number;
  titleScore: number;
  bodyScore: number;
  /** واژه‌های مشترک شاخص، برای توضیح تصمیم در پنل */
  sharedTerms: string[];
};

export type SimilarityOptions = {
  /** سهم تیتر در امتیاز نهایی (بقیه سهم متن است) */
  titleWeight?: number;
};

/**
 * شباهت دو خبر بر اساس تیتر و متن.
 * اگر یکی از دو خبر متن نداشته باشد، فقط تیتر ملاک است.
 */
export function articleSimilarity(
  a: { title: string; body?: string | null },
  b: { title: string; body?: string | null },
  options: SimilarityOptions = {},
): SimilarityBreakdown {
  const { titleWeight = 0.5 } = options;

  const titleA = significantTokens(a.title);
  const titleB = significantTokens(b.title);
  const titleScore = weightedOverlap(titleA, titleB);

  const hasBodies = Boolean(a.body?.trim()) && Boolean(b.body?.trim());
  const bodyA = hasBodies ? significantTokens(a.body ?? '') : new Set<string>();
  const bodyB = hasBodies ? significantTokens(b.body ?? '') : new Set<string>();
  const bodyScore = hasBodies ? weightedOverlap(bodyA, bodyB) : 0;

  const score = hasBodies
    ? titleWeight * titleScore + (1 - titleWeight) * bodyScore
    : titleScore;

  // واژه‌های مشترکی که بیشترین ارزش توضیحی را دارند
  const shared = [...titleA]
    .filter((t) => titleB.has(t))
    .sort((x, y) => weightOf(y) - weightOf(x) || y.length - x.length)
    .slice(0, 6);

  return {
    score: Math.round(score * 1000) / 1000,
    titleScore: Math.round(titleScore * 1000) / 1000,
    bodyScore: Math.round(bodyScore * 1000) / 1000,
    sharedTerms: shared,
  };
}
