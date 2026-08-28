/**
 * خواندن و اعتبارسنجی `config/shiraz-keywords.yaml`.
 *
 * واژه‌نامه در لحظهٔ بارگذاری به شکل «آمادهٔ تطبیق» درمی‌آید:
 * همهٔ عبارت‌ها با همان تابعی نرمال می‌شوند که متن خبر نرمال می‌شود،
 * وگرنه «شهرداري شيراز» نوشته‌شده در واژه‌نامه با «شهرداری شیراز» متن
 * تطبیق نمی‌کرد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { configDir } from './paths.ts';
import { normalizeForCompare } from '../lib/text.ts';

const groupSchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(0),
  allow_suffix: z.boolean().default(false),
  terms: z.array(z.string().min(1)).min(1),
});

const keywordsFileSchema = z.object({
  exclude_phrases: z.array(z.string().min(1)).default([]),
  groups: z.array(groupSchema).min(1),
  negative: z
    .object({
      weight: z.number().min(0).default(1),
      terms: z.array(z.string().min(1)).default([]),
    })
    .default({ weight: 1, terms: [] }),
});

/** یک عبارت آمادهٔ تطبیق. */
export type PreparedTerm = {
  /** متن اصلی، برای نمایش در توضیح تصمیم */
  display: string;
  /** متن نرمال‌شده، برای تطبیق */
  normalized: string;
  weight: number;
  group: string;
  allowSuffix: boolean;
};

export type PreparedKeywords = {
  excludePhrases: string[];       // نرمال‌شده
  positive: PreparedTerm[];
  negative: PreparedTerm[];
};

let cached: PreparedKeywords | null = null;

export function loadKeywords(
  filePath = path.join(configDir, 'shiraz-keywords.yaml'),
): PreparedKeywords {
  if (cached) return cached;

  if (!fs.existsSync(filePath)) {
    throw new Error(`فایل واژه‌نامه پیدا نشد: ${filePath}`);
  }

  const raw = parseYaml(fs.readFileSync(filePath, 'utf8'));
  const parsed = keywordsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`خطا در ${path.basename(filePath)}:\n${lines.join('\n')}`);
  }

  const positive: PreparedTerm[] = [];
  for (const group of parsed.data.groups) {
    for (const term of group.terms) {
      const normalized = normalizeForCompare(term);
      if (!normalized) continue;
      positive.push({
        display: term,
        normalized,
        weight: group.weight,
        group: group.name,
        allowSuffix: group.allow_suffix,
      });
    }
  }

  const negative: PreparedTerm[] = parsed.data.negative.terms
    .map((term) => ({
      display: term,
      normalized: normalizeForCompare(term),
      weight: parsed.data.negative.weight,
      group: 'نشانهٔ منفی',
      allowSuffix: false,
    }))
    .filter((t) => t.normalized);

  // عبارت‌های بلندتر اول بررسی می‌شوند تا «شهرداری شیراز» پیش از «شیراز»
  // تطبیق کند و امتیاز دقیق‌تری بدهد.
  positive.sort((a, b) => b.normalized.length - a.normalized.length);

  cached = {
    excludePhrases: parsed.data.exclude_phrases
      .map(normalizeForCompare)
      .filter(Boolean),
    positive,
    negative,
  };
  return cached;
}

/** فقط برای تست‌ها. */
export function resetKeywordsCache(): void {
  cached = null;
}
