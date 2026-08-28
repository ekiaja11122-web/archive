/**
 * کلاینت WordPress REST API.
 *
 * احراز هویت با «رمز برنامه» (Application Password) انجام می‌شود، نه رمز
 * اصلی کاربر: پیشخوان وردپرس ← کاربران ← پروفایل ← Application Passwords.
 * رمز برنامه فاصله دارد و همان‌طور که هست در .env گذاشته می‌شود.
 *
 * نکته‌های عملی که در کد لحاظ شده‌اند:
 *   - جست‌وجوی دسته/تگ در وردپرس تطبیق *جزئی* برمی‌گرداند؛ پس نتیجه
 *     باید خودمان دقیق تطبیق داده شود وگرنه «ورزشی» به «ورزشی بانوان»
 *     وصل می‌شود.
 *   - ساخت دسته‌ای که از قبل هست خطای `term_exists` می‌دهد که در آن
 *     شناسهٔ موجود برمی‌گردد — این خطا در واقع موفقیت است.
 *   - آپلود رسانه به هدر Content-Disposition نیاز دارد.
 *   - خطاهای گذرا (۵xx و ۴۲۹) دوباره تلاش می‌شوند، خطای ۴۰۱ نه.
 */
import fs from 'node:fs';
import { AppError } from '../lib/errors.ts';
import { sleep } from '../lib/http.ts';
import type { Logger } from '../lib/logger.ts';

export type WordPressConfig = {
  baseUrl: string;
  username: string;
  appPassword: string;
  timeoutMs?: number;
  retries?: number;
  logger?: Logger;
};

export type WpTerm = { id: number; name: string };
export type WpMedia = { id: number; sourceUrl: string };
export type WpPost = { id: number; link: string; slug: string; status: string };

export type CreatePostInput = {
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  status: 'publish' | 'draft' | 'pending';
  categoryIds: number[];
  tagIds: number[];
  featuredMediaId?: number | undefined;
  /** تاریخ انتشار؛ اگر ندهیم وردپرس زمان حال را می‌گذارد */
  date?: Date | undefined;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class WordPressClient {
  readonly #baseUrl: string;
  readonly #authHeader: string;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #logger: Logger | undefined;

  constructor(config: WordPressConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, '');
    // رمز برنامهٔ وردپرس فاصله دارد و همان‌طور که هست استفاده می‌شود
    this.#authHeader =
      'Basic ' + Buffer.from(`${config.username}:${config.appPassword}`).toString('base64');
    this.#timeoutMs = config.timeoutMs ?? 30_000;
    this.#retries = config.retries ?? 2;
    this.#logger = config.logger;
  }

  #url(endpoint: string, params?: Record<string, string>): string {
    const url = new URL(`${this.#baseUrl}/wp-json/wp/v2${endpoint}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    return url.toString();
  }

  async #request<T>(
    endpoint: string,
    options: {
      method?: string;
      json?: unknown;
      body?: Buffer;
      headers?: Record<string, string>;
      params?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', json, body, headers = {}, params } = options;
    const url = this.#url(endpoint, params);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        this.#logger?.debug('تلاش مجدد برای تماس با وردپرس', { endpoint, attempt, backoffMs });
        await sleep(backoffMs);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: this.#authHeader,
            Accept: 'application/json',
            ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: json !== undefined ? JSON.stringify(json) : body,
        });

        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text.slice(0, 300) };
        }

        if (!response.ok) {
          const detail = payload as { code?: string; message?: string; data?: unknown };
          const error = new AppError(
            'WORDPRESS_ERROR',
            `وردپرس پاسخ ${response.status} داد: ${detail?.message ?? 'بدون توضیح'}`,
            { status: response.status, code: detail?.code, endpoint, data: detail?.data },
          );

          if (response.status === 401 || response.status === 403) {
            throw new AppError(
              'WORDPRESS_AUTH',
              'احراز هویت وردپرس ناموفق بود. نام کاربری و «رمز برنامه» را در .env بررسی کنید.',
              { status: response.status, endpoint },
            );
          }
          if (RETRYABLE_STATUS.has(response.status) && attempt < this.#retries) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return payload as T;
      } catch (err) {
        lastError = err;
        if (err instanceof AppError && err.code === 'WORDPRESS_AUTH') throw err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const retryable = isAbort || err instanceof TypeError || err instanceof AppError;
        if (!retryable || attempt >= this.#retries) break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (lastError instanceof AppError) throw lastError;
    throw new AppError('WORDPRESS_UNREACHABLE', 'تماس با وردپرس پس از چند تلاش ناموفق ماند',
      { endpoint }, lastError);
  }

  /** بررسی اینکه اتصال و رمز برنامه درست کار می‌کنند. */
  async checkConnection(): Promise<{ id: number; name: string }> {
    return this.#request<{ id: number; name: string }>('/users/me');
  }

  /**
   * پیدا کردن یا ساختن یک دسته/برچسب بر اساس نام.
   *
   * جست‌وجوی وردپرس تطبیق جزئی می‌دهد، پس نتیجه اینجا دقیق فیلتر می‌شود
   * تا «ورزشی» به «ورزشی بانوان» وصل نشود.
   */
  async ensureTerm(kind: 'categories' | 'tags', name: string): Promise<number> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('WORDPRESS_EMPTY_TERM', 'نام دسته یا برچسب خالی است', { kind });

    const found = await this.#request<WpTerm[]>(`/${kind}`, {
      params: { search: trimmed, per_page: '100' },
    });
    const exact = found.find((term) => term.name.trim() === trimmed);
    if (exact) return exact.id;

    try {
      const created = await this.#request<WpTerm>(`/${kind}`, {
        method: 'POST',
        json: { name: trimmed },
      });
      return created.id;
    } catch (err) {
      // وردپرس برای نام تکراری خطا می‌دهد ولی شناسهٔ موجود را داخل خطا
      // برمی‌گرداند — یعنی این خطا در واقع موفقیت است.
      if (err instanceof AppError && String(err.details.code ?? '').includes('exists')) {
        const data = err.details.data as { term_id?: number } | undefined;
        if (data?.term_id) return data.term_id;
      }
      throw err;
    }
  }

  /** شناسهٔ چند برچسب، با عبور از برچسب‌های خطادار به‌جای شکست کامل. */
  async ensureTags(names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of names) {
      try {
        ids.push(await this.ensureTerm('tags', name));
      } catch (err) {
        // برچسب مهم‌تر از خود خبر نیست
        this.#logger?.warn('ساخت برچسب ناموفق بود؛ بدون آن ادامه می‌دهیم', { tag: name }, err);
      }
    }
    return ids;
  }

  /** آپلود تصویر شاخص به کتابخانهٔ رسانهٔ وردپرس. */
  async uploadMedia(filePath: string, filename: string, mimeType: string): Promise<WpMedia> {
    const body = fs.readFileSync(filePath);
    const response = await this.#request<{ id: number; source_url: string }>('/media', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': mimeType,
        // وردپرس بدون این هدر آپلود را رد می‌کند
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
    return { id: response.id, sourceUrl: response.source_url };
  }

  async createPost(input: CreatePostInput): Promise<WpPost> {
    const payload: Record<string, unknown> = {
      title: input.title,
      content: input.content,
      excerpt: input.excerpt,
      slug: input.slug,
      status: input.status,
      categories: input.categoryIds,
      tags: input.tagIds,
    };
    if (input.featuredMediaId) payload.featured_media = input.featuredMediaId;
    if (input.date) payload.date_gmt = input.date.toISOString().replace(/\.\d+Z$/, '');

    const post = await this.#request<{ id: number; link: string; slug: string; status: string }>(
      '/posts',
      { method: 'POST', json: payload },
    );
    return { id: post.id, link: post.link, slug: post.slug, status: post.status };
  }
}
