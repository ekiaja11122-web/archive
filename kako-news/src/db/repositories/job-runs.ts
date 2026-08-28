/**
 * تاریخچهٔ اجرای کارها و ردپای خبرها.
 *
 * `job_runs` می‌گوید هر اجرا چقدر طول کشید و چند خبر آورد؛
 * `pipeline_events` می‌گوید یک خبرِ مشخص در هر مرحله چه سرنوشتی داشت.
 * هر دو در پنل مدیریت (مایل‌استون ۵) نمایش داده می‌شوند.
 */
import { query, queryOne } from '../pool.ts';

export type JobStatus = 'running' | 'success' | 'error';
export type PipelineStage = 'collect' | 'filter' | 'dedup' | 'rewrite' | 'review' | 'publish';

export async function startJobRun(jobName: string, sourceId?: number | null): Promise<number> {
  const row = await queryOne<{ id: number }>(
    'INSERT INTO job_runs (job_name, source_id) VALUES ($1, $2) RETURNING id',
    [jobName, sourceId ?? null],
  );
  return row?.id ?? 0;
}

export async function finishJobRun(
  id: number,
  result: {
    status: JobStatus;
    itemsFound?: number;
    itemsNew?: number;
    itemsFailed?: number;
    error?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  if (!id) return;
  await query(
    `UPDATE job_runs SET
       status = $2, items_found = $3, items_new = $4, items_failed = $5,
       error = $6, meta = $7, finished_at = now()
     WHERE id = $1`,
    [
      id,
      result.status,
      result.itemsFound ?? 0,
      result.itemsNew ?? 0,
      result.itemsFailed ?? 0,
      result.error?.slice(0, 2000) ?? null,
      JSON.stringify(result.meta ?? {}),
    ],
  );
}

export async function recordEvent(event: {
  stage: PipelineStage;
  message: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  rawArticleId?: number | null;
  articleId?: number | null;
  sourceId?: number | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO pipeline_events (stage, level, message, raw_article_id, article_id, source_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.stage,
      event.level ?? 'info',
      event.message.slice(0, 1000),
      event.rawArticleId ?? null,
      event.articleId ?? null,
      event.sourceId ?? null,
      JSON.stringify(event.meta ?? {}),
    ],
  );
}

export type JobRunRow = {
  id: number;
  job_name: string;
  source_id: number | null;
  status: JobStatus;
  items_found: number;
  items_new: number;
  items_failed: number;
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
};

export async function recentJobRuns(limit = 20): Promise<JobRunRow[]> {
  return query<JobRunRow>(
    'SELECT * FROM job_runs ORDER BY started_at DESC LIMIT $1',
    [limit],
  );
}
