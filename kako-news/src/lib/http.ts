/**
 * لایهٔ درخواست HTTP برای جمع‌آوری خبر.
 *
 * چیزهایی که اینجا حل می‌شوند و در `fetch` خام نیستند:
 *  - مهلت زمانی (سایت‌های خبری ایرانی گاهی خیلی کند پاسخ می‌دهند)
 *  - تشخیص کدگذاری متن؛ بعضی سایت‌های فارسی هنوز windows-1256 می‌دهند
 *    و اگر UTF-8 فرض کنیم متن به هم می‌ریزد
 *  - تلاش مجدد فقط روی خطاهای گذرا (شبکه، ۵xx، ۴۲۹)
 *  - محدودیت حجم پاسخ، تا یک صفحهٔ خراب حافظه را پر نکند
 *  - معرفی شفاف ربات با User-Agent، به‌جای جعل هویت مرورگر
 */
import { AppError } from './errors.ts';
import type { Logger } from './logger.ts';

export type FetchOptions = {
  timeoutMs?: number;
  userAgent?: string;
  maxBytes?: number;
  retries?: number;
  headers?: Record<string, string>;
  logger?: Logger;
};

// هدرهای HTTP فقط بایت‌های ASCII را می‌پذیرند؛ متن فارسی اینجا مجاز نیست
// و باعث خطای «Cannot convert argument to a ByteString» می‌شود.
export const DEFAULT_USER_AGENT = 'KakoNewsBot/1.0 (+https://kakonews.ir)';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // ۵ مگابایت
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type HttpResponse = {
  url: string;          // نشانی نهایی پس از ریدایرکت‌ها
  status: number;
  body: string;
  contentType: string;
};

/** توقف کوتاه بین تلاش‌ها. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * دریافت یک صفحه به‌صورت متن، با مهلت و تلاش مجدد.
 * در صورت شکست نهایی `AppError` پرتاب می‌کند تا فراخوان بتواند
 * فقط همان منبع را skip کند.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<HttpResponse> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    userAgent = DEFAULT_USER_AGENT,
    maxBytes = DEFAULT_MAX_BYTES,
    retries = 2,
    headers = {},
    logger,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoffMs = 1000 * 2 ** (attempt - 1); // ۱ثانیه، ۲ثانیه، ۴ثانیه…
      logger?.debug('تلاش مجدد برای دریافت صفحه', { url, attempt, backoffMs });
      await sleep(backoffMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: asciiHeaders({
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.5',
          ...headers,
        }),
      });

      if (!response.ok) {
        const error = new AppError(
          'HTTP_ERROR',
          `پاسخ ${response.status} از ${url}`,
          { url, status: response.status },
        );
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = await readLimited(response, maxBytes, url);
      const body = decodeBody(buffer, contentType);

      return { url: response.url || url, status: response.status, body, contentType };
    } catch (err) {
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isNetwork = err instanceof TypeError; // خطای شبکه در fetch
      const retryable = isAbort || isNetwork || err instanceof AppError;
      if (!retryable || attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError('FETCH_FAILED', `دریافت ${url} پس از چند تلاش ناموفق ماند`, { url }, lastError);
}

/**
 * پاک‌سازی هدرها از نویسه‌های غیر ASCII.
 * اگر کسی در `sources.yaml` یک User-Agent فارسی بنویسد، `fetch` خطای مبهم
 * ByteString می‌دهد. به‌جای شکستن جمع‌آوری، نویسه‌های غیرمجاز حذف می‌شوند.
 */
function asciiHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    // eslint-disable-next-line no-control-regex
    const safe = value.replace(/[^\x20-\x7E]/g, '').trim();
    if (safe) clean[key] = safe;
  }
  return clean;
}

/** خواندن بدنهٔ پاسخ با سقف حجم، تا یک فایل بزرگ حافظه را نبلعد. */
async function readLimited(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new AppError('RESPONSE_TOO_LARGE', `حجم پاسخ ${url} بیش از حد مجاز است`, {
      url, bytes: declared, maxBytes,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('RESPONSE_TOO_LARGE', `حجم پاسخ ${url} بیش از حد مجاز است`, {
        url, bytes: total, maxBytes,
      });
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * تبدیل بایت‌ها به رشته با کدگذاری درست.
 * ترتیب تشخیص: هدر Content-Type ← تگ meta داخل خود HTML ← UTF-8.
 */
function decodeBody(buffer: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const charset = fromHeader ?? sniffCharset(buffer) ?? 'utf-8';

  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    // کدگذاری ناشناخته — به UTF-8 برمی‌گردیم تا کار متوقف نشود
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/** خواندن charset از ۱ کیلوبایت اول سند (تگ meta یا اعلان XML). */
function sniffCharset(buffer: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(buffer.subarray(0, 1024));
  return (
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /encoding=["']([\w-]+)["']/i.exec(head)?.[1]
  );
}

/** نشانی نسبی را با تکیه بر نشانی صفحه به نشانی مطلق تبدیل می‌کند. */
export function absoluteUrl(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}
