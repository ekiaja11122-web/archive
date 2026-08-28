/**
 * پاک‌سازی دادهٔ قدیمی.
 *
 * سامانه عمداً چیزی را خودکار پاک نمی‌کند — خبر نامرتبط و تکراری
 * بایگانی می‌شوند تا بشود دید فیلتر کجا اشتباه کرده. اما پس از چند ماه
 * این داده‌ها فقط جا اشغال می‌کنند و دیگر ارزش بازبینی ندارند.
 *
 * این دستور محافظه‌کارانه است:
 *   - خبرِ **منتشرشده** و خبرهای متصل به آن هرگز پاک نمی‌شوند.
 *   - خبر در انتظار تأیید هرگز پاک نمی‌شود، هرچقدر هم قدیمی باشد.
 *   - فقط خبر خامِ نامرتبط یا تکراری، رویدادهای قدیمی، و تصاویر بی‌استفاده.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAppConfig } from '../config/app-config.ts';
import { fromRoot } from '../config/paths.ts';
import { query } from '../db/pool.ts';
import { createLogger } from '../lib/logger.ts';

const logger = createLogger('system');

export type CleanupResult = {
  rawArticles: number;
  events: number;
  jobRuns: number;
  images: number;
};

export async function runCleanup(
  options: { days?: number; dryRun?: boolean } = {},
): Promise<CleanupResult> {
  const { days = 90, dryRun = false } = options;
  const result: CleanupResult = { rawArticles: 0, events: 0, jobRuns: 0, images: 0 };

  logger.info('شروع پاک‌سازی دادهٔ قدیمی', { older_than_days: days, dry_run: dryRun });

  // --- خبرهای خام نامرتبط و تکراری ---
  // خبری که به یک خبر منتشرشده وصل است (حتی به‌عنوان منبع تکمیلی) نگه داشته می‌شود
  const rawCondition = `
    status IN ('irrelevant', 'duplicate', 'failed')
    AND collected_at < now() - ($1 || ' days')::interval
    AND id NOT IN (SELECT raw_article_id FROM article_sources)
    AND id NOT IN (SELECT duplicate_of_id FROM raw_articles WHERE duplicate_of_id IS NOT NULL)
  `;

  if (dryRun) {
    const rows = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM raw_articles WHERE ${rawCondition}`,
      [days],
    );
    result.rawArticles = rows[0]?.count ?? 0;
  } else {
    const deleted = await query<{ id: number }>(
      `DELETE FROM raw_articles WHERE ${rawCondition} RETURNING id`,
      [days],
    );
    result.rawArticles = deleted.length;
  }

  // --- رویدادهای پایپ‌لاین ---
  const eventCondition = `created_at < now() - ($1 || ' days')::interval`;
  if (dryRun) {
    const rows = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM pipeline_events WHERE ${eventCondition}`, [days],
    );
    result.events = rows[0]?.count ?? 0;
  } else {
    const deleted = await query<{ id: number }>(
      `DELETE FROM pipeline_events WHERE ${eventCondition} RETURNING id`, [days],
    );
    result.events = deleted.length;
  }

  // --- تاریخچهٔ اجرا ---
  if (dryRun) {
    const rows = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM job_runs WHERE started_at < now() - ($1 || ' days')::interval`,
      [days],
    );
    result.jobRuns = rows[0]?.count ?? 0;
  } else {
    const deleted = await query<{ id: number }>(
      `DELETE FROM job_runs WHERE started_at < now() - ($1 || ' days')::interval RETURNING id`,
      [days],
    );
    result.jobRuns = deleted.length;
  }

  // --- تصاویری که دیگر هیچ خبری به آن‌ها ارجاع ندارد ---
  const app = loadAppConfig();
  const imagesDir = fromRoot(app.images.storage_dir);
  if (fs.existsSync(imagesDir)) {
    const referenced = new Set(
      (await query<{ image_path: string }>(
        'SELECT image_path FROM articles WHERE image_path IS NOT NULL',
      )).map((row) => path.basename(row.image_path)),
    );

    for (const filename of fs.readdirSync(imagesDir)) {
      if (filename.startsWith('.') || referenced.has(filename)) continue;

      const filePath = path.join(imagesDir, filename);
      const stat = fs.statSync(filePath);
      const ageDays = (Date.now() - stat.mtimeMs) / 86_400_000;
      if (ageDays < days) continue;

      result.images++;
      if (!dryRun) fs.unlinkSync(filePath);
    }
  }

  logger.info('پاک‌سازی تمام شد', { ...result, dry_run: dryRun });
  return result;
}
