/**
 * دانلود و آماده‌سازی تصویر شاخص.
 *
 * ⚠️ **هشدار حق نشر — این را بخوانید پیش از فعال کردن.**
 *
 * تصاویر خبرگزاری‌ها تقریباً همیشه دارای حق نشر هستند و ذکر منبع
 * به‌تنهایی مجوز استفاده نیست. بعضی خبرگزاری‌ها تصاویرشان را با
 * شرایط مشخصی اجازه می‌دهند، بعضی اصلاً نه، و بعضی فقط با اجازهٔ کتبی.
 *
 * سامانه این را نمی‌تواند تشخیص بدهد. مسئولیت بررسی مجوز هر تصویر بر
 * عهدهٔ سردبیر است. به همین دلیل:
 *   - کل این بخش با `images.download_enabled: false` در app.yaml
 *     قابل خاموش کردن است.
 *   - در پنل تأیید، کنار هر تصویر هشدار نمایش داده می‌شود.
 *   - نام منبع همیشه به‌صورت «عکس: نام منبع» همراه تصویر ذخیره می‌شود.
 *
 * اگر مطمئن نیستید، این قابلیت را خاموش بگذارید و تصویر را دستی
 * انتخاب کنید.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadAppConfig } from '../config/app-config.ts';
import { fromRoot } from '../config/paths.ts';
import { AppError } from '../lib/errors.ts';
import { DEFAULT_USER_AGENT } from '../lib/http.ts';
import type { Logger } from '../lib/logger.ts';

export type DownloadedImage = {
  path: string;
  filename: string;
  mimeType: string;
  bytes: number;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * دانلود تصویر با رعایت سقف حجم و نوع مجاز.
 * اگر دانلود تصویر در کانفیگ خاموش باشد `null` برمی‌گرداند.
 */
export async function downloadImage(
  imageUrl: string,
  options: { logger?: Logger; timeoutMs?: number } = {},
): Promise<DownloadedImage | null> {
  const app = loadAppConfig();
  const { logger, timeoutMs = 20_000 } = options;

  if (!app.images.download_enabled) {
    logger?.debug('دانلود تصویر در کانفیگ خاموش است؛ خبر بدون تصویر منتشر می‌شود');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'image/*' },
    });

    if (!response.ok) {
      throw new AppError('IMAGE_FETCH_FAILED', `دریافت تصویر ناموفق بود (${response.status})`, {
        url: imageUrl, status: response.status,
      });
    }

    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!app.images.allowed_types.includes(mimeType)) {
      throw new AppError('IMAGE_TYPE_NOT_ALLOWED', `نوع تصویر مجاز نیست: ${mimeType || 'نامشخص'}`, {
        url: imageUrl, mimeType, allowed: app.images.allowed_types,
      });
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > app.images.max_bytes) {
      throw new AppError('IMAGE_TOO_LARGE', 'حجم تصویر بیش از حد مجاز است', {
        url: imageUrl, bytes: declared, max: app.images.max_bytes,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > app.images.max_bytes) {
      throw new AppError('IMAGE_TOO_LARGE', 'حجم تصویر بیش از حد مجاز است', {
        url: imageUrl, bytes: buffer.length, max: app.images.max_bytes,
      });
    }
    if (buffer.length === 0) {
      throw new AppError('IMAGE_EMPTY', 'فایل تصویر خالی بود', { url: imageUrl });
    }

    const storageDir = fromRoot(app.images.storage_dir);
    fs.mkdirSync(storageDir, { recursive: true });

    // نام فایل از هش نشانی ساخته می‌شود: هم یکتاست، هم دانلود دوبارهٔ
    // همان تصویر فایل تازه‌ای نمی‌سازد، هم نام‌های عجیب منبع وارد سرور نمی‌شوند.
    const hash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 16);
    const filename = `kako-${hash}${EXTENSION_BY_MIME[mimeType] ?? '.jpg'}`;
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, buffer);

    logger?.debug('تصویر شاخص دانلود شد', { url: imageUrl, bytes: buffer.length, file: filename });

    return { path: filePath, filename, mimeType, bytes: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}
