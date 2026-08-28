/**
 * API خواندنی خبرهای منتشرشده.
 *
 * چرا وجود دارد در حالی که سایت وردپرسی است: تا مسیر جدا شدن از وردپرس
 * باز بماند. اگر روزی خواستید فرانت‌اند اختصاصی (مثلاً Next.js) بسازید،
 * همین API آماده است و لازم نیست چیزی در پایپ‌لاین عوض شود.
 *
 * فقط خبرهای **منتشرشده** را می‌دهد — خبرِ در انتظار تأیید یا ردشده
 * هرگز از این مسیر بیرون نمی‌رود.
 */
import type { FastifyInstance } from 'fastify';
import { loadAppConfig } from '../config/app-config.ts';
import { query, queryOne } from '../db/pool.ts';
import { buildSourceLine } from '../pipeline/rewrite-validate.ts';
import { articleSources } from '../db/repositories/articles.ts';

type PublicArticle = {
  slug: string;
  title: string;
  lead: string;
  body: string;
  category: string;
  tags: string[];
  image_url: string | null;
  image_credit: string | null;
  published_at: Date | null;
};

const MAX_PER_PAGE = 50;

export function registerPublicApi(server: FastifyInstance): void {
  const app = loadAppConfig();

  // محتوای منتشرشده عمومی است؛ فرانت‌اند جدا باید بتواند بخواند
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=60');
    }
    return payload;
  });

  /** فهرست خبرهای منتشرشده، با صفحه‌بندی و فیلتر دسته. */
  server.get('/api/articles', async (request) => {
    const q = request.query as { category?: string; page?: string; per_page?: string };
    const perPage = Math.min(Math.max(Number(q.per_page ?? 20) || 20, 1), MAX_PER_PAGE);
    const page = Math.max(Number(q.page ?? 1) || 1, 1);
    const offset = (page - 1) * perPage;

    const filterCategory = q.category && app.categories.includes(q.category) ? q.category : null;

    const rows = await query<PublicArticle>(
      `SELECT slug, title, lead, category, tags, image_url, image_credit, published_at
       FROM articles
       WHERE status = 'published' ${filterCategory ? 'AND category = $3' : ''}
       ORDER BY published_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      filterCategory ? [perPage, offset, filterCategory] : [perPage, offset],
    );

    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM articles
       WHERE status = 'published' ${filterCategory ? 'AND category = $1' : ''}`,
      filterCategory ? [filterCategory] : [],
    );

    return {
      articles: rows,
      page,
      per_page: perPage,
      total: total?.count ?? 0,
      category: filterCategory,
    };
  });

  /** یک خبر بر اساس اسلاگ فارسی. */
  server.get('/api/articles/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const article = await queryOne<PublicArticle & { id: number }>(
      `SELECT id, slug, title, lead, body, category, tags, image_url, image_credit, published_at
       FROM articles WHERE slug = $1 AND status = 'published'`,
      [decodeURIComponent(slug)],
    );

    if (!article) {
      return reply.status(404).send({ error: 'not_found', message: 'خبری با این نشانی پیدا نشد' });
    }

    const sources = await articleSources(article.id);
    const { id, ...rest } = article;
    void id;

    return {
      ...rest,
      source_line: buildSourceLine(sources, app.rewrite.source_line_template),
      sources: sources.map((s) => ({ name: s.source_name, url: s.source_url, role: s.role })),
    };
  });

  /** دسته‌بندی‌ها با شمار خبر منتشرشده. */
  server.get('/api/categories', async () => {
    const counts = await query<{ category: string; count: number }>(
      `SELECT category, COUNT(*)::int AS count FROM articles
       WHERE status = 'published' GROUP BY category`,
    );
    const byName = new Map(counts.map((c) => [c.category, c.count]));
    return {
      categories: app.categories.map((name) => ({ name, count: byName.get(name) ?? 0 })),
    };
  });
}
