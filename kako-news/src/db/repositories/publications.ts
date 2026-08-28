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
  next_attempt_at: Date | null;
  meta: Record<string, unknown>;
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
             error = NULL,
             attempts = 0,
             next_attempt_at = NULL
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

/**
 * درخواست‌های آمادهٔ ارسال — ورودی ماژول‌های انتشار.
 *
 * ردیفی که تلاش ناموفق داشته، تا رسیدن `next_attempt_at` برداشته
 * نمی‌شود؛ این‌طور یک سایت پایین باعث کوبیدن پیاپی به آن نمی‌شود.
 */
export async function pendingPublications(
  target?: PublishTarget,
  limit = 20,
): Promise<PublicationRow[]> {
  return query<PublicationRow>(
    `SELECT * FROM publications
     WHERE status = 'pending'
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ${target ? 'AND target = $2' : ''}
     ORDER BY requested_at
     LIMIT $1`,
    target ? [limit, target] : [limit],
  );
}

/** ردیف‌هایی که منتظر رسیدن زمان تلاش بعدی‌اند — برای نمایش در پنل. */
export async function scheduledRetries(): Promise<PublicationRow[]> {
  return query<PublicationRow>(
    `SELECT * FROM publications
     WHERE status = 'pending' AND next_attempt_at > now()
     ORDER BY next_attempt_at`,
  );
}

export async function markPublicationSent(
  id: number,
  result: { externalId?: string | null; externalUrl?: string | null },
): Promise<void> {
  await query(
    `UPDATE publications
     SET status = 'sent', external_id = $2, external_url = $3,
         published_at = now(), attempts = attempts + 1,
         error = NULL, next_attempt_at = NULL
     WHERE id = $1`,
    [id, result.externalId ?? null, result.externalUrl ?? null],
  );
}

export type FailureOptions = {
  /** خطای تنظیمات یا محتوا که با تلاش دوباره درست نمی‌شود */
  permanent?: boolean;
  maxAttempts?: number;
  /** پایهٔ فاصلهٔ تلاش بعدی (ثانیه)؛ با هر شکست دو برابر می‌شود */
  backoffSeconds?: number;
};

export type FailureOutcome = {
  status: PublicationStatus;
  attempts: number;
  nextAttemptAt: Date | null;
};

/**
 * ثبت شکست یک انتشار.
 *
 * خطای گذرا ردیف را در وضعیت `pending` نگه می‌دارد و فقط زمان تلاش
 * بعدی را عقب می‌برد — وگرنه یک قطعی کوتاه سایت، خبر را برای همیشه
 * زمین می‌گذاشت. پس از چند تلاش ناموفق (یا خطای دائمی) وضعیت `failed`
 * می‌شود تا در پنل به چشم سردبیر بیاید.
 */
export async function markPublicationFailed(
  id: number,
  error: string,
  options: FailureOptions = {},
): Promise<FailureOutcome> {
  const { permanent = false, maxAttempts = 5, backoffSeconds = 300 } = options;

  const row = await queryOne<{ attempts: number }>(
    'SELECT attempts FROM publications WHERE id = $1',
    [id],
  );
  const attempts = (row?.attempts ?? 0) + 1;
  const giveUp = permanent || attempts >= maxAttempts;

  // فاصلهٔ فزاینده: ۵ دقیقه، ۱۰، ۲۰، ۴۰…
  const delaySeconds = backoffSeconds * 2 ** (attempts - 1);
  const nextAttemptAt = giveUp ? null : new Date(Date.now() + delaySeconds * 1000);

  await query(
    `UPDATE publications
     SET status = $2, attempts = $3, error = $4, next_attempt_at = $5
     WHERE id = $1`,
    [id, giveUp ? 'failed' : 'pending', attempts, error.slice(0, 2000), nextAttemptAt],
  );

  return { status: giveUp ? 'failed' : 'pending', attempts, nextAttemptAt };
}

/** برگرداندن یک انتشار ناموفق به صف، به درخواست سردبیر. */
export async function retryPublication(id: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE publications
     SET status = 'pending', next_attempt_at = now(), attempts = 0, error = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING id`,
    [id],
  );
  return row !== null;
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
