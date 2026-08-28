/**
 * امتیازدهی کلیدواژه‌ای برای مرتبط‌بودن خبر با شیراز/فارس.
 *
 * منطق در سه گام:
 *   ۱. حذف عبارت‌های گمراه‌کننده («خبرگزاری فارس»، «خلیج فارس»)؛ بدون این
 *      گام هر خبر سراسریِ فارس‌نیوز «مرتبط با فارس» شمرده می‌شد.
 *   ۲. امتیاز مثبت: هر عبارت پیداشده به وزن گروهش. تطبیق در تیتر
 *      ضریب می‌گیرد، چون تیتر معرف موضوع اصلی خبر است.
 *   ۳. امتیاز منفی: نشانه‌های خبر سراسری یا شهر دیگر، با جریمهٔ سقف‌دار
 *      تا خبری که هم شیراز و هم تهران را نام برده قربانی نشود.
 *
 * این ماژول عمداً از دیتابیس و شبکه جداست تا مستقیم قابل تست باشد.
 */
import { loadKeywords, type PreparedTerm } from '../config/keywords-config.ts';
import { normalizeForCompare } from '../lib/text.ts';

export type KeywordMatch = {
  term: string;
  group: string;
  weight: number;
  /** در تیتر پیدا شد یا فقط در متن */
  inTitle: boolean;
};

export type KeywordScore = {
  score: number;
  matches: KeywordMatch[];
  negativeMatches: string[];
  /** توضیح خوانا برای ثبت در دیتابیس و نمایش در پنل */
  reason: string;
};

export type ScoreOptions = {
  /** تطبیق در تیتر چند برابر متن ارزش دارد */
  titleMultiplier?: number;
  /** سقف جریمهٔ نشانه‌های منفی */
  maxNegativePenalty?: number;
};

/**
 * تطبیق یک عبارت در متن نرمال‌شده.
 * متن با فاصله در دو طرف پد می‌شود تا تطبیق روی مرز کلمه انجام شود:
 * این‌طور «فارس» داخل «فارسی» به اشتباه پیدا نمی‌شود.
 */
function matches(paddedText: string, term: PreparedTerm): boolean {
  if (paddedText.includes(` ${term.normalized} `)) return true;

  if (term.allowSuffix) {
    // پسوندهای رایج فارسی: شیرازی، شیرازها، شیرازی‌ها
    for (const suffix of ['ی', 'ها', 'های', 'هایی', 'یها', 'یهای']) {
      if (paddedText.includes(` ${term.normalized}${suffix} `)) return true;
    }
  }
  return false;
}

/** حذف عبارت‌های گمراه‌کننده پیش از امتیازدهی. */
function maskExclusions(paddedText: string, excludePhrases: string[]): string {
  let out = paddedText;
  for (const phrase of excludePhrases) {
    out = out.replaceAll(` ${phrase} `, '  ');
  }
  return out;
}

export function scoreRelevance(
  title: string,
  body: string | null | undefined,
  options: ScoreOptions = {},
): KeywordScore {
  const { titleMultiplier = 2, maxNegativePenalty = 3 } = options;
  const keywords = loadKeywords();

  const paddedTitle = maskExclusions(` ${normalizeForCompare(title)} `, keywords.excludePhrases);
  const paddedBody = maskExclusions(` ${normalizeForCompare(body ?? '')} `, keywords.excludePhrases);

  const matched: KeywordMatch[] = [];
  const seenGroups = new Set<string>();
  let score = 0;

  for (const term of keywords.positive) {
    const inTitle = matches(paddedTitle, term);
    const inBody = matches(paddedBody, term);
    if (!inTitle && !inBody) continue;

    matched.push({ term: term.display, group: term.group, weight: term.weight, inTitle });

    // هر گروه فقط یک بار امتیاز کامل می‌گیرد؛ تکرار ده‌بارهٔ «شیراز» در متن
    // نباید امتیاز را بی‌جهت باد کند. عبارت‌های بعدیِ همان گروه امتیاز
    // نصف می‌گیرند تا تنوع نشانه‌ها هنوز ارزش داشته باشد.
    const firstOfGroup = !seenGroups.has(term.group);
    seenGroups.add(term.group);
    const base = firstOfGroup ? term.weight : term.weight / 2;

    score += inTitle ? base * titleMultiplier : base;
  }

  const negativeMatches: string[] = [];
  let penalty = 0;
  for (const term of keywords.negative) {
    if (matches(paddedTitle, term) || matches(paddedBody, term)) {
      negativeMatches.push(term.display);
      penalty += term.weight;
    }
  }
  score -= Math.min(penalty, maxNegativePenalty);

  return {
    score: Math.round(score * 100) / 100,
    matches: matched,
    negativeMatches,
    reason: buildReason(matched, negativeMatches, score),
  };
}

function buildReason(
  matched: KeywordMatch[],
  negativeMatches: string[],
  score: number,
): string {
  if (matched.length === 0) {
    return negativeMatches.length > 0
      ? `هیچ نشانهٔ محلی پیدا نشد؛ نشانه‌های سراسری: ${negativeMatches.slice(0, 4).join('، ')}`
      : 'هیچ نشانه‌ای از شیراز یا فارس در خبر پیدا نشد';
  }

  const inTitle = matched.filter((m) => m.inTitle).map((m) => m.term);
  const inBody = matched.filter((m) => !m.inTitle).map((m) => m.term);

  const parts: string[] = [];
  if (inTitle.length > 0) parts.push(`در تیتر: ${inTitle.slice(0, 4).join('، ')}`);
  if (inBody.length > 0) parts.push(`در متن: ${inBody.slice(0, 5).join('، ')}`);
  if (negativeMatches.length > 0) parts.push(`نشانهٔ سراسری: ${negativeMatches.slice(0, 3).join('، ')}`);

  return `امتیاز ${score} — ${parts.join(' | ')}`;
}
