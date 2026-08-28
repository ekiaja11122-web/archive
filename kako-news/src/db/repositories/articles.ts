/**
 * دسترسی به جدول `articles` — خبرهای بازنویسی‌شدهٔ کاکو نیوز.
 *
 * هر خبر اینجا با وضعیت `pending_review` ساخته می‌شود. **هیچ مسیری در کد
 * وجود ندارد که خبری را بدون عبور از صف تأیید منتشر کند.**
 */
import { query, queryOne, transaction } from '../pool.ts';
import { slugify } from '../../lib/text.ts';

export type ArticleStatus =
  | 'pending_review' | 'approved' | 'publishing' | 'published' | 'rejected' | 'failed';

export type ArticleRow = {
  id: number;
  raw_article_id: number | null;
  title: string;
  lead: string;
  body: string;
  category: string;
  tags: string[];
  slug: string;
  image_url: string | null;
  image_path: string | null;
  image_credit: string | null;
  status: ArticleStatus;
  reject_reason: string | null;
  editor_notes: string | null;
  rewrite_model: string | null;
  rewrite_meta: Record<string, unknown>;
  edited_by_human: boolean;
  approved_at: Date | null;
  approved_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type NewArticle = {
  rawArticleId: number;
  title: string;
  lead: string;
  body: string;
  category: string;
  tags: string[];
  imageUrl?: string | null;
  imageCredit?: string | null;
  rewriteModel?: string | null;
  rewriteMeta?: Record<string, unknown>;
  /** خبرهای خامی که به‌عنوان منبع تکمیلی به این خبر وصل می‌شوند */
  supplementaryRawIds?: number[];
};

/**
 * اسلاگ یکتا. اگر خبری با همان اسلاگ باشد، پسوند عددی می‌گیرد تا
 * نشانی خبر قدیمی نشکند.
 */
export async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  const taken = await query<{ slug: string }>(
    'SELECT slug FROM articles WHERE slug = $1 OR slug LIKE $2',
    [base, `${base}-%`],
  );
  if (!taken.some((row) => row.slug === base)) return base;

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.some((row) => row.slug === candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * ثبت خبر بازنویسی‌شده به‌همراه پیوند منابعش، در یک تراکنش.
 * اگر ثبت منابع شکست بخورد، خبر بی‌منبع باقی نمی‌ماند.
 */
export async function insertArticle(article: NewArticle): Promise<number> {
  const slug = await uniqueSlug(article.title);

  return transaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO articles
         (raw_article_id, title, lead, body, category, tags, slug,
          image_url, image_credit, rewrite_model, rewrite_meta, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
       RETURNING id`,
      [
        article.rawArticleId,
        article.title,
        article.lead,
        article.body,
        article.category,
        article.tags,
        slug,
        article.imageUrl ?? null,
        article.imageCredit ?? null,
        article.rewriteModel ?? null,
        JSON.stringify(article.rewriteMeta ?? {}),
      ],
    );

    const articleId = inserted.rows[0]?.id;
    if (!articleId) throw new Error('ثبت خبر بازنویسی‌شده نتیجه‌ای برنگرداند');

    await client.query(
      `INSERT INTO article_sources (article_id, raw_article_id, role)
       VALUES ($1, $2, 'primary') ON CONFLICT DO NOTHING`,
      [articleId, article.rawArticleId],
    );

    for (const rawId of article.supplementaryRawIds ?? []) {
      if (rawId === article.rawArticleId) continue;
      await client.query(
        `INSERT INTO article_sources (article_id, raw_article_id, role)
         VALUES ($1, $2, 'supplementary') ON CONFLICT DO NOTHING`,
        [articleId, rawId],
      );
    }

    return articleId;
  });
}

export async function findArticle(id: number): Promise<ArticleRow | null> {
  return queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [id]);
}

export async function articlesByStatus(
  status: ArticleStatus,
  limit = 50,
): Promise<ArticleRow[]> {
  return query<ArticleRow>(
    'SELECT * FROM articles WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
    [status, limit],
  );
}

/** آیا برای این خبر خام قبلاً خبر بازنویسی‌شده‌ای ساخته شده؟ */
export async function articleExistsForRaw(rawArticleId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM articles WHERE raw_article_id = $1 LIMIT 1',
    [rawArticleId],
  );
  return row !== null;
}

export type ArticleSourceInfo = {
  raw_article_id: number;
  role: 'primary' | 'supplementary';
  source_name: string;
  source_url: string;
  homepage: string | null;
};

/** منابع یک خبر، برای ساختن خط «منبع: …» و نمایش در پنل. */
export async function articleSources(articleId: number): Promise<ArticleSourceInfo[]> {
  return query<ArticleSourceInfo>(
    `SELECT asrc.raw_article_id, asrc.role,
            s.name AS source_name, r.source_url, s.homepage
     FROM article_sources asrc
     JOIN raw_articles r ON r.id = asrc.raw_article_id
     JOIN sources s      ON s.id = r.source_id
     WHERE asrc.article_id = $1
     ORDER BY (asrc.role = 'primary') DESC, asrc.raw_article_id`,
    [articleId],
  );
}

/**
 * ذخیرهٔ ویرایش‌های سردبیر.
 * `edited_by_human` علامت می‌خورد تا بعداً بشود دید مدل چقدر نیاز به
 * دست‌کاری داشته و راهنمای سبک را بر همان اساس بهبود داد.
 */
export async function updateArticleContent(
  id: number,
  fields: {
    title: string;
    lead: string;
    body: string;
    category: string;
    tags: string[];
    imageUrl?: string | null;
    editorNotes?: string | null;
  },
): Promise<void> {
  await query(
    `UPDATE articles SET
       title = $2, lead = $3, body = $4, category = $5, tags = $6,
       image_url = $7, editor_notes = $8, edited_by_human = TRUE
     WHERE id = $1`,
    [
      id, fields.title, fields.lead, fields.body, fields.category, fields.tags,
      fields.imageUrl ?? null, fields.editorNotes ?? null,
    ],
  );
}

/**
 * تأیید خبر برای انتشار.
 * فقط خبری که در وضعیت `pending_review` است تأیید می‌شود — این شرط در
 * خودِ کوئری است تا دو تأیید هم‌زمان، خبر را دو بار به صف انتشار نفرستد.
 */
export async function approveArticle(id: number, approvedBy: string): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE articles
     SET status = 'approved', approved_at = now(), approved_by = $2, reject_reason = NULL
     WHERE id = $1 AND status IN ('pending_review', 'rejected')
     RETURNING id`,
    [id, approvedBy],
  );
  return row !== null;
}

export async function rejectArticle(id: number, reason: string, by: string): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE articles
     SET status = 'rejected', reject_reason = $2, approved_by = $3
     WHERE id = $1 AND status <> 'published'
     RETURNING id`,
    [id, reason.slice(0, 500) || 'بدون توضیح', by],
  );
  return row !== null;
}

export async function setArticleStatus(id: number, status: ArticleStatus): Promise<void> {
  await query('UPDATE articles SET status = $2 WHERE id = $1', [id, status]);
}

/** متن خام منبع اصلی، برای نمای مقایسه‌ای در پنل. */
export type SourceComparison = {
  raw_id: number;
  source_name: string;
  source_url: string;
  raw_title: string;
  raw_body: string | null;
  raw_summary: string | null;
  published_at: Date | null;
  role: 'primary' | 'supplementary';
};

export async function comparisonSources(articleId: number): Promise<SourceComparison[]> {
  return query<SourceComparison>(
    `SELECT r.id AS raw_id, s.name AS source_name, r.source_url,
            r.title AS raw_title, r.body AS raw_body, r.summary AS raw_summary,
            r.published_at, asrc.role
     FROM article_sources asrc
     JOIN raw_articles r ON r.id = asrc.raw_article_id
     JOIN sources s      ON s.id = r.source_id
     WHERE asrc.article_id = $1
     ORDER BY (asrc.role = 'primary') DESC, r.id`,
    [articleId],
  );
}

/** شمار خبرهای بازنویسی‌شده به تفکیک وضعیت — برای آمار پنل. */
export async function countArticlesByStatus(since?: Date): Promise<Record<string, number>> {
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count FROM articles
     ${since ? 'WHERE created_at >= $1' : ''}
     GROUP BY status`,
    since ? [since] : [],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}
