/**
 * آداپتور منبع تستی.
 *
 * داده را از یک فایل JSON داخل پروژه می‌خواند تا بتوان کل پایپ‌لاین را
 * بدون اینترنت و بدون فشار آوردن به سایت‌های واقعی اجرا و تست کرد.
 * ساختار فایل نمونه: `fixtures/mock-source.json`
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { projectRoot } from '../config/paths.ts';
import { SourceError } from '../lib/errors.ts';
import { normalizeForDisplay } from '../lib/text.ts';
import { parseDate } from '../lib/date.ts';
import type { CollectContext, CollectResult, CollectedItem, SourceAdapter } from './types.ts';

const mockItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  body: z.string().optional(),
  url: z.string().min(1),
  published_at: z.string().optional().nullable(),
  image_url: z.string().optional().nullable(),
  author: z.string().optional().nullable(),
});

const mockFileSchema = z.object({
  items: z.array(mockItemSchema),
});

export const mockAdapter: SourceAdapter = {
  type: 'mock',

  async collect({ source, logger, limit }: CollectContext): Promise<CollectResult> {
    const filePath = path.resolve(projectRoot, source.url);

    if (!fs.existsSync(filePath)) {
      throw new SourceError(source.slug, `فایل دادهٔ تستی پیدا نشد: ${filePath}`, { path: filePath });
    }

    let parsed: z.infer<typeof mockFileSchema>;
    try {
      parsed = mockFileSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (err) {
      throw new SourceError(source.slug, `فایل دادهٔ تستی معتبر نیست: ${filePath}`, {}, err);
    }

    logger.debug('دادهٔ تستی خوانده شد', { file: filePath, items: parsed.items.length });

    const items: CollectedItem[] = parsed.items.slice(0, limit).map((raw) => ({
      sourceUrl: raw.url,
      title: normalizeForDisplay(raw.title),
      summary: raw.summary ? normalizeForDisplay(raw.summary) : undefined,
      body: raw.body ? normalizeForDisplay(raw.body) : undefined,
      publishedAt: parseDate(raw.published_at),
      author: raw.author ? normalizeForDisplay(raw.author) : undefined,
      imageUrl: raw.image_url ?? undefined,
      raw: { mock_id: raw.id },
    }));

    return { items, warnings: [] };
  },
};
