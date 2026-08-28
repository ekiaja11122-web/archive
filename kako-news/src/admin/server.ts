/**
 * سرور پنل مدیریت.
 *
 * تصمیم‌های امنیتی که در همهٔ مسیرها اعمال می‌شوند:
 *   - هر مسیر جز /login نیازمند نشست معتبر است.
 *   - هر درخواست POST نیازمند توکن CSRF وابسته به نشست است، پس سایت
 *     دیگری نمی‌تواند مرورگر سردبیر را وادار به تأیید خبری کند.
 *   - کوکی نشست httpOnly و sameSite=strict است.
 *   - تلاش‌های ناموفق ورود شمرده و کند می‌شوند.
 *   - هدرهای امنیتی روی همهٔ پاسخ‌ها، از جمله CSP که اجرای اسکریپت
 *     بیرونی را ممنوع می‌کند.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';

import { env } from '../config/env.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { createLogger } from '../lib/logger.ts';
import { errorMessage } from '../lib/errors.ts';
import { normalizeForDisplay } from '../lib/text.ts';
import {
  authenticate, findAdminUser, createSessionToken, readSessionToken,
  csrfToken, verifyCsrf, adminUserCount, createAdminUser, SESSION_TTL_MS,
  type AdminUser,
} from './auth.ts';
import { layout, type NavKey } from './views/layout.ts';
import {
  loginPage, dashboardPage, reviewPage, articleListPage, sourcesPage,
  type DashboardStats, type QueueEntry,
} from './views/pages.ts';
import {
  articlesByStatus, findArticle, articleSources, comparisonSources,
  updateArticleContent, approveArticle, rejectArticle, countArticlesByStatus,
} from '../db/repositories/articles.ts';
import {
  requestPublication, publicationsFor, type PublishTarget,
} from '../db/repositories/publications.ts';
import { countByStatus } from '../db/repositories/raw-articles.ts';
import { listSources } from '../db/repositories/sources.ts';
import { recordEvent } from '../db/repositories/job-runs.ts';
import { buildSourceLine } from '../pipeline/rewrite-validate.ts';
import { registerPublicApi } from './api.ts';

const logger = createLogger('admin');

const SESSION_COOKIE = 'kako_session';
const VALID_TARGETS: PublishTarget[] = ['website', 'telegram'];

/** شمارندهٔ سادهٔ تلاش ناموفق ورود، برای کند کردن حملهٔ حدس رمز. */
const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(ip: string): boolean {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function noteFailedAttempt(ip: string): void {
  const record = loginAttempts.get(ip);
  if (!record || Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count++;
}

type Session = { user: AdminUser; token: string };

/**
 * هدایت به صفحهٔ دیگر همراه با پیام فارسی.
 *
 * ⚠️ هدر HTTP فقط بایت ASCII می‌پذیرد. اگر متن فارسی مستقیم در هدر
 * `Location` بنشیند، Node خطای «Invalid character in header content»
 * می‌دهد — و بدتر اینکه کارِ انجام‌شده (مثلاً تأیید خبر) موفق بوده ولی
 * سردبیر صفحهٔ خطای ۵۰۰ می‌بیند. پس پیام همیشه encode می‌شود.
 */
function redirectWithMessage(
  reply: FastifyReply,
  path: string,
  message?: string,
  kind: 'ok' | 'err' | 'warn' = 'ok',
): FastifyReply {
  if (!message) return reply.redirect(path);
  const params = new URLSearchParams({ msg: message, kind });
  return reply.redirect(`${path}?${params.toString()}`);
}



export async function buildAdminServer(): Promise<FastifyInstance> {
  const app = loadAppConfig();
  const e = env();

  const server = Fastify({ logger: false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await server.register(cookie);
  await server.register(formbody);

  // ---------------- هدرهای امنیتی ----------------
  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    // پنل هیچ اسکریپت یا استایل بیرونی بار نمی‌کند؛ تصویر منابع خبری مجاز است
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; form-action 'self'; frame-ancestors 'none'",
    );
    return payload;
  });

  // ---------------- کمکی‌ها ----------------
  function currentSession(request: FastifyRequest): Session | null {
    const token = request.cookies[SESSION_COOKIE];
    const userId = readSessionToken(token);
    if (!userId || !token) return null;
    const user = (request as FastifyRequest & { adminUser?: AdminUser }).adminUser;
    return user ? { user, token } : null;
  }

  function render(
    reply: FastifyReply,
    options: { title: string; nav?: NavKey; user?: AdminUser; bare?: boolean },
    body: ReturnType<typeof loginPage>,
  ): FastifyReply {
    return reply
      .type('text/html; charset=utf-8')
      .send(layout({ ...options, brandName: app.brand.name }, body));
  }

  /** نشست را می‌خواند و کاربر را روی درخواست می‌گذارد. */
  server.addHook('preHandler', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    // API خواندنی عمومی است: فقط خبرهای منتشرشده را می‌دهد و
    // فرانت‌اند جدا باید بتواند بدون نشست بخواند.
    const isPublic = url === '/login' || url === '/healthz' || url.startsWith('/api/');

    const token = request.cookies[SESSION_COOKIE];
    const userId = readSessionToken(token);
    const user = userId ? await findAdminUser(userId) : null;

    if (user) {
      (request as FastifyRequest & { adminUser?: AdminUser }).adminUser = user;
    }

    if (isPublic) return;

    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.redirect('/login');
    }

    // محافظ CSRF روی همهٔ نوشتن‌ها
    if (request.method === 'POST') {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (!verifyCsrf(token ?? '', String(body._csrf ?? ''))) {
        logger.warn('درخواست بدون توکن CSRF معتبر رد شد', { url, ip: request.ip });
        return reply.status(403).type('text/html; charset=utf-8').send(
          layout(
            { title: 'درخواست نامعتبر', brandName: app.brand.name, bare: true },
            loginPage({ error: 'درخواست نامعتبر بود. لطفاً صفحه را تازه کنید و دوباره تلاش کنید.', brandName: app.brand.name }),
          ),
        );
      }
    }
  });

  // ---------------- سلامت و API عمومی ----------------
  server.get('/healthz', async () => ({ ok: true }));
  registerPublicApi(server);

  // ---------------- ورود و خروج ----------------
  server.get('/login', async (request, reply) => {
    if (currentSession(request)) return reply.redirect('/');
    const error = typeof (request.query as { error?: string }).error === 'string'
      ? (request.query as { error: string }).error
      : undefined;
    return render(reply, { title: 'ورود', bare: true }, loginPage({ error, brandName: app.brand.name }));
  });

  server.post('/login', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: string; password?: string };

    if (tooManyAttempts(request.ip)) {
      logger.warn('تلاش‌های مکرر ناموفق ورود', { ip: request.ip });
      return render(reply, { title: 'ورود', bare: true }, loginPage({
        error: 'تعداد تلاش‌های ناموفق زیاد بود. چند دقیقه صبر کنید.',
        brandName: app.brand.name,
      }));
    }

    const user = await authenticate(String(body.username ?? ''), String(body.password ?? ''));
    if (!user) {
      noteFailedAttempt(request.ip);
      logger.warn('ورود ناموفق', { ip: request.ip, username: String(body.username ?? '').slice(0, 40) });
      return render(reply, { title: 'ورود', bare: true }, loginPage({
        error: 'نام کاربری یا رمز عبور نادرست است.',
        brandName: app.brand.name,
      }));
    }

    loginAttempts.delete(request.ip);
    logger.info('ورود موفق به پنل', { user: user.username });

    return reply
      .setCookie(SESSION_COOKIE, createSessionToken(user.id), {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: e.NODE_ENV === 'production',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      })
      .redirect('/');
  });

  server.post('/logout', async (_request, reply) =>
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).redirect('/login'),
  );

  // ---------------- داشبورد ----------------
  server.get('/', async (request, reply) => {
    const session = currentSession(request)!;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [rawCounts, rawToday, articleCounts, articlesToday, sources, pending] =
      await Promise.all([
        countByStatus(),
        countByStatus(startOfDay),
        countArticlesByStatus(),
        countArticlesByStatus(startOfDay),
        listSources(),
        articlesByStatus('pending_review', 50),
      ]);

    const queue: QueueEntry[] = [];
    for (const article of pending) {
      const srcs = await articleSources(article.id);
      queue.push({
        article,
        sourceNames: [...new Set(srcs.map((s) => s.source_name))],
        supplementaryCount: srcs.filter((s) => s.role === 'supplementary').length,
      });
    }

    const stats: DashboardStats = {
      pendingReview: articleCounts.pending_review ?? 0,
      collectedToday: Object.values(rawToday).reduce((a, b) => a + b, 0),
      approvedToday: (articlesToday.approved ?? 0) + (articlesToday.published ?? 0),
      rejectedToday: articlesToday.rejected ?? 0,
      publishedToday: articlesToday.published ?? 0,
      irrelevantToday: rawToday.irrelevant ?? 0,
      duplicatesToday: rawToday.duplicate ?? 0,
      failedSources: sources.filter((s) => s.enabled && s.last_status === 'error').length,
    };
    void rawCounts;

    const query = request.query as { msg?: string; kind?: string };
    return render(
      reply,
      { title: 'صف تأیید', nav: 'queue', user: session.user },
      dashboardPage({
        stats,
        queue,
        message: query.msg,
        messageKind: query.kind === 'err' ? 'err' : query.kind === 'warn' ? 'warn' : 'ok',
      }),
    );
  });

  // ---------------- فهرست‌ها ----------------
  server.get('/published', async (request, reply) => {
    const session = currentSession(request)!;
    const articles = [
      ...(await articlesByStatus('published', 50)),
      ...(await articlesByStatus('approved', 50)),
    ];
    return render(
      reply,
      { title: 'منتشرشده', nav: 'published', user: session.user },
      articleListPage({
        heading: 'خبرهای تأییدشده و منتشرشده',
        articles,
        emptyText: 'هنوز خبری تأیید نشده است.',
      }),
    );
  });

  server.get('/rejected', async (request, reply) => {
    const session = currentSession(request)!;
    return render(
      reply,
      { title: 'ردشده', nav: 'rejected', user: session.user },
      articleListPage({
        heading: 'خبرهای ردشده',
        articles: await articlesByStatus('rejected', 100),
        emptyText: 'خبر ردشده‌ای وجود ندارد.',
      }),
    );
  });

  server.get('/sources', async (request, reply) => {
    const session = currentSession(request)!;
    return render(
      reply,
      { title: 'سلامت منابع', nav: 'sources', user: session.user },
      sourcesPage({ sources: await listSources() }),
    );
  });

  // ---------------- بازبینی یک خبر ----------------
  server.get('/articles/:id', async (request, reply) => {
    const session = currentSession(request)!;
    const id = Number((request.params as { id: string }).id);
    const article = await findArticle(id);
    if (!article) return redirectWithMessage(reply.status(404), '/', 'خبر پیدا نشد', 'err');

    const [sources, publications, srcInfo] = await Promise.all([
      comparisonSources(id),
      publicationsFor(id),
      articleSources(id),
    ]);

    const query = request.query as { msg?: string; kind?: string };
    return render(
      reply,
      { title: 'بازبینی خبر', nav: 'queue', user: session.user },
      reviewPage({
        article,
        sources,
        publications,
        categories: app.categories,
        defaultTargets: app.publishing.default_targets,
        sourceLine: buildSourceLine(srcInfo, app.rewrite.source_line_template),
        csrf: csrfToken(session.token),
        message: query.msg,
        messageKind: query.kind === 'err' ? 'err' : query.kind === 'warn' ? 'warn' : 'ok',
      }),
    );
  });

  // ---------------- ذخیرهٔ ویرایش ----------------
  server.post('/articles/:id', async (request, reply) => {
    const session = currentSession(request)!;
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Record<string, string>;

    const article = await findArticle(id);
    if (!article) return redirectWithMessage(reply, '/', 'خبر پیدا نشد', 'err');
    if (article.status === 'published') {
      return redirectWithMessage(reply, `/articles/${id}`, 'خبر منتشرشده قابل ویرایش نیست', 'err');
    }

    const title = normalizeForDisplay(body.title ?? '');
    const lead = normalizeForDisplay(body.lead ?? '');
    const articleBody = normalizeForDisplay(body.body ?? '');
    if (!title || !lead || !articleBody) {
      return redirectWithMessage(reply, `/articles/${id}`, 'تیتر، لید و متن نمی‌توانند خالی باشند', 'err');
    }

    const category = app.categories.includes(body.category ?? '')
      ? (body.category as string)
      : article.category;

    const tags = (body.tags ?? '')
      .split(/[,،]/)
      .map((t) => normalizeForDisplay(t))
      .filter(Boolean)
      .slice(0, 10);

    await updateArticleContent(id, {
      title, lead, body: articleBody, category, tags,
      imageUrl: (body.image_url ?? '').trim() || null,
      editorNotes: (body.editor_notes ?? '').trim() || null,
    });

    await recordEvent({
      stage: 'review',
      message: `سردبیر «${session.user.username}» خبر را ویرایش کرد`,
      articleId: id,
      rawArticleId: article.raw_article_id,
    });

    logger.info('ویرایش خبر ذخیره شد', { article_id: id, user: session.user.username });
    return redirectWithMessage(reply, `/articles/${id}`, 'ویرایش‌ها ذخیره شد');
  });

  // ---------------- تأیید و انتشار ----------------
  server.post('/articles/:id/approve', async (request, reply) => {
    const session = currentSession(request)!;
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Record<string, unknown>;

    // چک‌باکس‌ها ممکن است یک رشته یا آرایه باشند
    const submitted = Array.isArray(body.targets)
      ? body.targets.map(String)
      : body.targets
        ? [String(body.targets)]
        : [];
    const targets = VALID_TARGETS.filter((t) => submitted.includes(t));

    if (targets.length === 0) {
      return redirectWithMessage(reply, `/articles/${id}`, 'حداقل یک مقصد انتشار را انتخاب کنید', 'err');
    }

    const approved = await approveArticle(id, session.user.username);
    if (!approved) {
      return redirectWithMessage(reply, `/articles/${id}`, 'این خبر قابل تأیید نیست (شاید قبلاً منتشر شده)', 'err');
    }

    await requestPublication(id, targets);

    const labels = targets.map((t) => (t === 'website' ? 'وب‌سایت' : 'تلگرام')).join(' و ');
    await recordEvent({
      stage: 'review',
      message: `سردبیر «${session.user.username}» خبر را تأیید کرد — مقصد: ${labels}`,
      articleId: id,
      meta: { targets },
    });

    logger.info('خبر تأیید شد', { article_id: id, targets, user: session.user.username });
    return redirectWithMessage(reply, '/', `خبر تأیید شد و برای انتشار در ${labels} در صف قرار گرفت`);
  });

  // ---------------- رد کردن ----------------
  server.post('/articles/:id/reject', async (request, reply) => {
    const session = currentSession(request)!;
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Record<string, string>;
    const reason = normalizeForDisplay(body.reason ?? '') || 'بدون توضیح';

    const rejected = await rejectArticle(id, reason, session.user.username);
    if (!rejected) {
      return redirectWithMessage(reply, `/articles/${id}`, 'خبر منتشرشده را نمی‌توان رد کرد', 'err');
    }

    await recordEvent({
      stage: 'review',
      message: `سردبیر «${session.user.username}» خبر را رد کرد: ${reason}`,
      articleId: id,
    });

    logger.info('خبر رد شد', { article_id: id, user: session.user.username });
    return redirectWithMessage(reply, '/', 'خبر رد شد و در بخش «ردشده» بایگانی شد');
  });

  // ---------------- خطاها ----------------
  server.setNotFoundHandler(async (request, reply) => {
    if (!currentSession(request)) return reply.redirect('/login');
    return redirectWithMessage(reply.status(404), '/', 'صفحه پیدا نشد', 'err');
  });

  server.setErrorHandler(async (error, request, reply) => {
    logger.error('خطای پردازش درخواست در پنل', { url: request.url }, error);
    const session = currentSession(request);
    if (!session) return reply.status(500).redirect('/login');
    return redirectWithMessage(reply.status(500), '/', `خطای داخلی: ${errorMessage(error).slice(0, 80)}`, 'err');
  });

  return server;
}

/**
 * راه‌اندازی پنل.
 * اگر هیچ کاربری وجود نداشته باشد، از روی ADMIN_USERNAME و ADMIN_PASSWORD
 * در .env کاربر اول ساخته می‌شود تا سردبیر بتواند همان بار اول وارد شود.
 */
export async function startAdminServer(): Promise<FastifyInstance> {
  const e = env();

  if ((await adminUserCount()) === 0) {
    if (!e.ADMIN_PASSWORD) {
      throw new Error(
        'هیچ کاربری در پنل وجود ندارد و ADMIN_PASSWORD در .env تنظیم نشده است.\n' +
          'یا آن را تنظیم کنید، یا با «npm run kako -- admin:create» کاربر بسازید.',
      );
    }
    await createAdminUser(e.ADMIN_USERNAME, e.ADMIN_PASSWORD, 'سردبیر');
    logger.info('کاربر اول پنل از روی .env ساخته شد', { username: e.ADMIN_USERNAME });
  }

  const server = await buildAdminServer();
  await server.listen({ port: e.ADMIN_PORT, host: e.ADMIN_HOST });

  logger.info('پنل مدیریت آمادهٔ کار است', {
    address: `http://${e.ADMIN_HOST}:${e.ADMIN_PORT}`,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.info('در حال بستن پنل مدیریت…', { signal });
      void server.close().then(() => process.exit(0));
    });
  }

  return server;
}
