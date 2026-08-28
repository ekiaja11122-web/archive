/**
 * دسترسی به جدول `publications` — سرنوشت هر خبر در هر مقصد.
 *
 * وقتی سردبیر خبری را تأیید می‌کند، برای هر مقصد انتخاب‌شده یک ردیف با
 * وضعیت `pending` ساخته می‌شود. ماژول‌های انتشار (مایل‌استون ۶ و ۷) همین
 * ردیف‌ها را برمی‌دارند و می‌فرستند.
 *
 * کلید یکتای (خبر، مقصد) تضمین می‌کند یک خبر دو بار در یک کانال پست نشود،
 * حتی اگر سردبیر دو بار روی «تأیید» بزند.
 */
import { query, queryOne } from '../pool.ts';

export type PublishTarget = 'website' | 'telegram';
export type PublicationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export type PublicationRow = {
  id: number;
  article_id: number;
  target: PublishTarget;
  status: PublicationStatus;
  external_id: string | null;
  external_url: string | null;
  attempts: number;
  error: string | null;
  requested_at: Date;
  published_at: Date | null;
};

/** ثبت درخواست انتشار برای مقصدهای انتخاب‌شده. */
export async function requestPublication(
  articleId: number,
  targets: PublishTarget[],
): Promise<void> {
  for (const target of targets) {
    await query(
      `INSERT INTO publications (article_id, target, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (article_id, target) DO UPDATE
         SET status = CASE
               -- خبری که قبلاً با موفقیت رفته دوباره فرستاده نمی‌شود
               WHEN publications.status = 'sent' THEN 'sent'
               ELSE 'pending'
             END,
             error = NULL
       WHERE publications.status <> 'sent'`,
      [articleId, target],
    );
  }
}

export async function publicationsFor(articleId: number): Promise<PublicationRow[]> {
  return query<PublicationRow>(
    'SELECT * FROM publications WHERE article_id = $1 ORDER BY target',
    [articleId],
  );
}

/** درخواست‌های در انتظار ارسال — ورودی ماژول‌های انتشار. */
export async function pendingPublications(
  target?: PublishTarget,
  limit = 20,
): Promise<PublicationRow[]> {
  return query<PublicationRow>(
    `SELECT * FROM publications
     WHERE status = 'pending' ${target ? 'AND target = $2' : ''}
     ORDER BY requested_at
     LIMIT $1`,
    target ? [limit, target] : [limit],
  );
}

export async function markPublicationSent(
  id: number,
  result: { externalId?: string | null; externalUrl?: string | null },
): Promise<void> {
  await query(
    `UPDATE publications
     SET status = 'sent', external_id = $2, external_url = $3,
         published_at = now(), attempts = attempts + 1, error = NULL
     WHERE id = $1`,
    [id, result.externalId ?? null, result.externalUrl ?? null],
  );
}

export async function markPublicationFailed(id: number, error: string): Promise<void> {
  await query(
    `UPDATE publications
     SET status = 'failed', attempts = attempts + 1, error = $2
     WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/** شمار انتشارها به تفکیک مقصد و وضعیت — برای آمار پنل. */
export async function publicationStats(since?: Date): Promise<
  { target: string; status: string; count: number }[]
> {
  return query(
    `SELECT target, status, COUNT(*)::int AS count FROM publications
     ${since ? 'WHERE requested_at >= $1' : ''}
     GROUP BY target, status`,
    since ? [since] : [],
  );
}

export async function findPublication(id: number): Promise<PublicationRow | null> {
  return queryOne<PublicationRow>('SELECT * FROM publications WHERE id = $1', [id]);
}
