/**
 * وردپرس ساختگی.
 *
 * زیرمجموعه‌ای از WordPress REST API را واقعاً پیاده می‌کند تا ماژول
 * انتشار بدون سایت واقعی و بدون اینترنت آزمایش شود — از جمله رفتارهای
 * دردسرسازی که فقط در عمل معلوم می‌شوند:
 *   - احراز هویت Basic با «رمز برنامه» که فاصله دارد
 *   - جست‌وجوی دسته/تگ که تطبیق *جزئی* برمی‌گرداند، نه دقیق
 *   - آپلود رسانه با هدر Content-Disposition
 *   - خطای ۴۰۹ برای اسلاگ تکراری، و ۵۰۳ گذرا برای آزمودن تلاش مجدد
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockPost = {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  status: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  link: string;
};

export type MockMedia = { id: number; filename: string; bytes: number; mime: string };
export type MockTerm = { id: number; name: string; slug: string };

export type MockWordPress = {
  url: string;
  close: () => Promise<void>;
  posts: MockPost[];
  media: MockMedia[];
  categories: MockTerm[];
  tags: MockTerm[];
  requests: { method: string; path: string; auth: string | null }[];
  /** تعداد دفعاتی که مسیر ساخت پست باید ۵۰۳ بدهد (برای آزمودن تلاش مجدد) */
  failPostTimes: number;
  /** اگر true، ساخت پست خطای اسلاگ تکراری می‌دهد */
  rejectDuplicateSlug: boolean;
};

const USERNAME = 'kako-bot';
const APP_PASSWORD = 'abcd efgh ijkl mnop qrst uvwx';

export const MOCK_CREDENTIALS = { username: USERNAME, appPassword: APP_PASSWORD };

function slugify(name: string): string {
  return name.trim().replace(/\s+/g, '-').toLowerCase();
}

export async function startMockWordPress(): Promise<MockWordPress> {
  const state: Omit<MockWordPress, 'url' | 'close'> = {
    posts: [],
    media: [],
    categories: [{ id: 1, name: 'دسته‌بندی نشده', slug: 'uncategorized' }],
    tags: [],
    requests: [],
    failPostTimes: 0,
    rejectDuplicateSlug: false,
  };

  let nextId = 100;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const auth = req.headers.authorization ?? null;
    state.requests.push({ method: req.method ?? 'GET', path, auth });

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    // --- احراز هویت ---
    const expected = 'Basic ' + Buffer.from(`${USERNAME}:${APP_PASSWORD}`).toString('base64');
    if (auth !== expected) {
      send(401, { code: 'rest_not_logged_in', message: 'شما وارد نشده‌اید.' });
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      // --- بررسی اتصال ---
      if (path === '/wp-json/wp/v2/users/me') {
        send(200, { id: 3, name: 'ربات کاکو نیوز', slug: USERNAME });
        return;
      }

      // --- دسته‌بندی‌ها و برچسب‌ها ---
      for (const [segment, list] of [['categories', state.categories], ['tags', state.tags]] as const) {
        if (path !== `/wp-json/wp/v2/${segment}`) continue;

        if (req.method === 'GET') {
          const search = url.searchParams.get('search');
          // وردپرس تطبیق جزئی برمی‌گرداند — نه دقیق. کد باید خودش
          // تطبیق دقیق را از میان نتایج پیدا کند.
          const found = search
            ? list.filter((t) => t.name.includes(search) || search.includes(t.name))
            : list;
          send(200, found);
          return;
        }

        if (req.method === 'POST') {
          const body = JSON.parse(raw.toString('utf8') || '{}') as { name?: string };
          const name = String(body.name ?? '').trim();
          const existing = list.find((t) => t.name === name);
          if (existing) {
            send(400, {
              code: `term_exists`,
              message: 'این نام از قبل وجود دارد.',
              data: { status: 400, term_id: existing.id },
            });
            return;
          }
          const term = { id: nextId++, name, slug: slugify(name) };
          list.push(term);
          send(201, term);
          return;
        }
      }

      // --- آپلود رسانه ---
      if (path === '/wp-json/wp/v2/media' && req.method === 'POST') {
        const disposition = String(req.headers['content-disposition'] ?? '');
        const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1];
        if (!filename) {
          send(400, { code: 'rest_upload_no_content_disposition', message: 'نام فایل مشخص نیست.' });
          return;
        }
        const media: MockMedia = {
          id: nextId++,
          filename,
          bytes: raw.length,
          mime: String(req.headers['content-type'] ?? ''),
        };
        state.media.push(media);
        send(201, {
          id: media.id,
          source_url: `http://localhost/wp-content/uploads/${filename}`,
          media_type: 'image',
        });
        return;
      }

      // --- ساخت پست ---
      if (path === '/wp-json/wp/v2/posts' && req.method === 'POST') {
        if (state.failPostTimes > 0) {
          state.failPostTimes--;
          send(503, { code: 'service_unavailable', message: 'سرویس موقتاً در دسترس نیست.' });
          return;
        }

        const body = JSON.parse(raw.toString('utf8') || '{}') as Record<string, unknown>;
        const slug = String(body.slug ?? '');

        if (state.rejectDuplicateSlug && state.posts.some((p) => p.slug === slug)) {
          send(409, { code: 'rest_post_exists', message: 'پستی با این اسلاگ وجود دارد.' });
          return;
        }

        const post: MockPost = {
          id: nextId++,
          title: String(body.title ?? ''),
          content: String(body.content ?? ''),
          excerpt: String(body.excerpt ?? ''),
          slug,
          status: String(body.status ?? 'draft'),
          categories: (body.categories as number[]) ?? [],
          tags: (body.tags as number[]) ?? [],
          featured_media: Number(body.featured_media ?? 0),
          link: `http://localhost/${slug}/`,
        };
        state.posts.push(post);
        send(201, { id: post.id, link: post.link, slug: post.slug, status: post.status });
        return;
      }

      send(404, { code: 'rest_no_route', message: 'مسیر پیدا نشد.' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // ⚠️ همان شیء `state` برگردانده می‌شود، نه یک کپی با spread.
  // با spread، فیلدهای *ساده* مثل failPostTimes کپی می‌شدند و تغییرشان
  // در تست هرگز به سرور نمی‌رسید — یعنی تستِ «تلاش مجدد» بدون اینکه
  // سروری خطا بدهد سبز می‌شد. آرایه‌ها چون با ارجاع مشترک‌اند این
  // مشکل را نشان نمی‌دادند.
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
