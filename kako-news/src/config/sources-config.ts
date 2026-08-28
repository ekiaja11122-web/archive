/**
 * خواندن و اعتبارسنجی `config/sources.yaml`.
 *
 * این فایل *منبع حقیقت* برای فهرست منابع خبری است. سردبیر منابع را آنجا
 * اضافه/ویرایش می‌کند و با `npm run sources:sync` به دیتابیس همگام می‌شود.
 * هیچ منبعی در کد هاردکد نیست.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { configDir } from './paths.ts';

/** تنظیمات درخواست شبکه — هم به‌صورت پیش‌فرض کلی، هم برای هر منبع. */
const fetchOptionsSchema = z.object({
  timeout_ms: z.number().int().positive().default(15_000),
  user_agent: z.string().optional(),
  max_items_per_run: z.number().int().positive().default(20),
  request_delay_ms: z.number().int().min(0).default(1000),
  retries: z.number().int().min(0).max(5).default(2),
});

/** سلکتورهای صفحهٔ اختصاصی خبر (برای گرفتن متن کامل). */
const articleSelectorsSchema = z.object({
  body_selector: z.string().optional(),
  title_selector: z.string().optional(),
  image_selector: z.string().optional(),
  image_attribute: z.string().default('src'),
  date_selector: z.string().optional(),
  date_attribute: z.string().optional(),
  author_selector: z.string().optional(),
  /** المان‌هایی که پیش از استخراج متن باید حذف شوند: تبلیغات، اخبار مرتبط و… */
  remove_selectors: z.array(z.string()).default([]),
});

/** سلکتورهای صفحهٔ فهرست/آرشیو (فقط برای منابع نوع scrape). */
const listSelectorsSchema = z.object({
  item_selector: z.string().min(1, 'سلکتور آیتم فهرست الزامی است'),
  title_selector: z.string().optional(),
  link_selector: z.string().optional(),
  link_attribute: z.string().default('href'),
  summary_selector: z.string().optional(),
  date_selector: z.string().optional(),
  date_attribute: z.string().optional(),
  image_selector: z.string().optional(),
  image_attribute: z.string().default('src'),
});

const baseSourceSchema = z.object({
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'شناسه فقط حروف کوچک انگلیسی، عدد و خط تیره'),
  name: z.string().min(1),
  url: z.string().min(1),
  homepage: z.string().url().optional(),
  enabled: z.boolean().default(true),
  poll_interval_seconds: z.number().int().positive().optional(),
  /** بعد از گرفتن فهرست، برو صفحهٔ هر خبر و متن کامل را هم بردار. */
  fetch_full_content: z.boolean().default(true),
  fetch: fetchOptionsSchema.partial().optional(),
  article: articleSelectorsSchema.partial().optional(),
});

const sourceSchema = z.discriminatedUnion('type', [
  baseSourceSchema.extend({ type: z.literal('rss') }),
  baseSourceSchema.extend({ type: z.literal('scrape'), list: listSelectorsSchema }),
  baseSourceSchema.extend({ type: z.literal('mock') }),
]);

const sourcesFileSchema = z.object({
  defaults: z
    .object({
      poll_interval_seconds: z.number().int().positive().default(900),
      fetch: fetchOptionsSchema.default({}),
    })
    .default({}),
  sources: z.array(sourceSchema).default([]),
});

export type FetchSettings = z.infer<typeof fetchOptionsSchema>;
export type ArticleSelectors = z.infer<typeof articleSelectorsSchema>;
export type ListSelectors = z.infer<typeof listSelectorsSchema>;
export type SourceDefinition = z.infer<typeof sourceSchema>;
export type SourcesFile = z.infer<typeof sourcesFileSchema>;

/** تعریف منبع پس از ادغام با مقادیر پیش‌فرض — چیزی که آداپتورها می‌بینند. */
export type ResolvedSource = SourceDefinition & {
  pollIntervalSeconds: number;
  fetchSettings: FetchSettings;
};

export function loadSourcesConfig(
  filePath = path.join(configDir, 'sources.yaml'),
): ResolvedSource[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `فایل منابع پیدا نشد: ${filePath}\n` +
        `راهنما: config/sources.example.yaml را به config/sources.yaml کپی کنید.`,
    );
  }

  const raw = parseYaml(fs.readFileSync(filePath, 'utf8')) ?? {};
  const parsed = sourcesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - sources.yaml → ${i.path.join('.')}: ${i.message}`);
    throw new Error(`خطا در فایل منابع:\n${lines.join('\n')}`);
  }

  const { defaults, sources } = parsed.data;

  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.slug)) {
      throw new Error(`شناسهٔ تکراری در sources.yaml: «${source.slug}»`);
    }
    seen.add(source.slug);
  }

  return sources.map((source) => ({
    ...source,
    pollIntervalSeconds: source.poll_interval_seconds ?? defaults.poll_interval_seconds,
    fetchSettings: { ...defaults.fetch, ...(source.fetch ?? {}) },
  }));
}

/**
 * بخش‌هایی از تعریف منبع که باید در ستون jsonb دیتابیس ذخیره شوند.
 * (سلکتورها و تنظیمات اختصاصی؛ نه فیلدهایی که ستون جدا دارند)
 */
export function sourceConfigPayload(source: ResolvedSource): Record<string, unknown> {
  return {
    fetch_full_content: source.fetch_full_content,
    fetch: source.fetchSettings,
    article: source.article ?? {},
    ...(source.type === 'scrape' ? { list: source.list } : {}),
  };
}
