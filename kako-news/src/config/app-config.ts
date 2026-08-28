/**
 * خواندن و اعتبارسنجی `config/app.yaml`.
 *
 * هدف: هر چیزی که سردبیر ممکن است بخواهد تغییر دهد (دسته‌بندی‌ها، آستانه‌ها،
 * متن‌های برند) در YAML باشد، نه در کد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { configDir } from './paths.ts';

const appConfigSchema = z.object({
  brand: z.object({
    name: z.string().min(1),
    site_url: z.string().url(),
    telegram_footer: z.string().default(''),
  }),
  categories: z.array(z.string().min(1)).min(1),
  relevance: z.object({
    min_keyword_score: z.number().min(0).default(1),
    use_llm_for_uncertain: z.boolean().default(true),
    keep_irrelevant: z.boolean().default(true),
  }),
  deduplication: z.object({
    lookback_hours: z.number().positive().default(48),
    title_similarity_threshold: z.number().min(0).max(1).default(0.82),
    on_duplicate: z.enum(['ignore', 'link']).default('link'),
  }),
  rewrite: z.object({
    model: z.string().default(''),
    temperature: z.number().min(0).max(2).default(0.3),
    max_output_tokens: z.number().positive().default(2000),
    system_prompt_file: z.string().default('config/prompts/rewrite.system.md'),
    style_guide_file: z.string().default('config/style-guide.md'),
    max_retries: z.number().int().min(0).default(2),
  }),
  images: z.object({
    download_enabled: z.boolean().default(true),
    max_bytes: z.number().positive().default(5 * 1024 * 1024),
    allowed_types: z.array(z.string()).default(['image/jpeg', 'image/png', 'image/webp']),
    storage_dir: z.string().default('data/images'),
  }),
  publishing: z.object({
    default_targets: z.array(z.enum(['website', 'telegram'])).default(['website', 'telegram']),
    wordpress: z.object({
      post_status: z.enum(['publish', 'draft', 'pending']).default('publish'),
      category_map: z.record(z.string(), z.number()).default({}),
    }),
    telegram: z.object({
      prefer_photo: z.boolean().default(true),
      disable_web_page_preview: z.boolean().default(false),
    }),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    min_poll_interval_seconds: z.number().int().positive().default(300),
    concurrency: z.number().int().positive().default(3),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

let cached: AppConfig | null = null;

export function loadAppConfig(filePath = path.join(configDir, 'app.yaml')): AppConfig {
  if (cached) return cached;
  if (!fs.existsSync(filePath)) {
    throw new Error(`فایل تنظیمات پیدا نشد: ${filePath}`);
  }
  const raw = parseYaml(fs.readFileSync(filePath, 'utf8'));
  const parsed = appConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`خطا در ${path.basename(filePath)}:\n${lines.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

/** فقط برای تست‌ها: کش را پاک می‌کند. */
export function resetAppConfigCache(): void {
  cached = null;
}
