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


/**
 * تشخیص کپی عینی.
 *
 * چرا لازم است: مدل زبانی گاهی به‌جای بازنویسی، جمله‌های منبع را با
 * جابه‌جایی چند کلمه برمی‌گرداند. این هم نقض حق نشر منبع است و هم
 * محتوای کاکو نیوز را غیراصیل می‌کند — یعنی دقیقاً همان دو چیزی که
 * بازنویسی برای جلوگیری از آن‌ها انجام می‌شود.
 *
 * روش: دنباله‌های n کلمه‌ای (n-gram) متن منبع ساخته می‌شود و می‌سنجیم چند
 * درصدشان عیناً در متن بازنویسی‌شده آمده است. دنبالهٔ ۸ کلمه‌ای مشترک
 * تصادفی نیست؛ یعنی جمله کپی شده است.
 *
 * نقل قول مستقیم داخل گیومه از سنجش کنار گذاشته می‌شود، چون حرف کسی را
 * نباید عوض کرد و تکرار عینی‌اش کپی به حساب نمی‌آید.
 */
const VERBATIM_GRAM_SIZE = 8;

/** حذف نقل قول‌های مستقیم، که تکرار عینی‌شان مجاز است. */
function stripQuotes(text: string): string {
  return text
    .replace(/«[^»]*»/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\u201c[^\u201d]*\u201d/g, ' ');
}

function ngrams(tokens: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i++) {
    grams.add(tokens.slice(i, i + size).join(' '));
  }
  return grams;
}

export type VerbatimReport = {
  /** نسبت دنباله‌های منبع که عیناً در بازنویسی آمده‌اند (۰ تا ۱) */
  ratio: number;
  /** طولانی‌ترین دنبالهٔ کلمات مشترک */
  longestRun: number;
  /** نمونه‌ای از عبارت کپی‌شده، برای نمایش به سردبیر */
  sample: string | null;
  /** تعداد دنباله‌های سنجیده‌شده؛ اگر خیلی کم باشد نتیجه معنادار نیست */
  comparedGrams: number;
};

/**
 * سنجش میزان کپی عینی متن بازنویسی‌شده از متن منبع.
 * هرچه `ratio` بالاتر باشد، بازنویسی ضعیف‌تر است.
 */
export function verbatimOverlap(sourceText: string, rewrittenText: string): VerbatimReport {
  const sourceTokens = normalizeForCompare(stripQuotes(sourceText)).split(' ').filter(Boolean);
  const rewriteTokens = normalizeForCompare(stripQuotes(rewrittenText)).split(' ').filter(Boolean);

  const sourceGrams = ngrams(sourceTokens, VERBATIM_GRAM_SIZE);
  const rewriteGrams = ngrams(rewriteTokens, VERBATIM_GRAM_SIZE);

  if (sourceGrams.size === 0 || rewriteGrams.size === 0) {
    return { ratio: 0, longestRun: 0, sample: null, comparedGrams: sourceGrams.size };
  }

  let shared = 0;
  let sample: string | null = null;
  for (const gram of sourceGrams) {
    if (rewriteGrams.has(gram)) {
      shared++;
      sample ??= gram;
    }
  }

  return {
    ratio: Math.round((shared / sourceGrams.size) * 1000) / 1000,
    longestRun: longestCommonRun(sourceTokens, rewriteTokens),
    sample,
    comparedGrams: sourceGrams.size,
  };
}

/**
 * طولانی‌ترین دنبالهٔ کلمات مشترک بین دو متن.
 * یک جملهٔ کامل کپی‌شده حتی اگر نسبت کلی پایین باشد، اینجا دیده می‌شود.
 */
function longestCommonRun(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  // فقط یک سطر از جدول را نگه می‌داریم؛ متن خبر می‌تواند طولانی باشد
  let previous = new Array<number>(b.length + 1).fill(0);
  let best = 0;

  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) best = current[j] ?? 0;
      }
    }
    previous = current;
  }
  return best;
}
