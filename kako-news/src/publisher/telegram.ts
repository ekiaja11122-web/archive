/**
 * کلاینت Telegram Bot API.
 *
 * توکن ربات را از @BotFather می‌گیرید و ربات باید در کانال **ادمین**
 * باشد، وگرنه تلگرام خطای «bot is not a member» می‌دهد.
 *
 * محدودیت‌هایی که اینجا رعایت می‌شوند:
 *   - ۴۰۹۶ نویسه برای پیام متنی، ۱۰۲۴ نویسه برای کپشن عکس
 *   - خطای ۴۲۹ همراه `retry_after` می‌آید و باید **دقیقاً همان‌قدر**
 *     صبر کرد؛ تلاش زودتر فقط محدودیت را طولانی‌تر می‌کند
 *   - در حالت HTML فقط چند تگ مجاز است و هر `<` فرار نکرده در متن،
 *     کل پیام را با خطای «can't parse entities» رد می‌کند
 */
import fs from 'node:fs';
import { AppError } from '../lib/errors.ts';
import { sleep } from '../lib/http.ts';
import type { Logger } from '../lib/logger.ts';

export const TELEGRAM_MAX_TEXT = 4096;
export const TELEGRAM_MAX_CAPTION = 1024;

export type TelegramConfig = {
  botToken: string;
  /** برای تست: نشانی جایگزین API */
  apiBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  logger?: Logger;
};

export type SendResult = { messageId: number; chatId: number | string };

export type SendMessageInput = {
  chatId: string;
  text: string;
  disableWebPagePreview?: boolean;
};

export type SendPhotoInput = {
  chatId: string;
  caption: string;
  /** فایل محلی برای آپلود */
  filePath?: string | undefined;
  filename?: string | undefined;
  /** یا نشانی تصویر تا خود تلگرام آن را بردارد */
  photoUrl?: string | undefined;
};

type TelegramResponse = {
  ok: boolean;
  result?: { message_id: number; chat?: { id: number | string } };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export class TelegramClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #logger: Logger | undefined;

  constructor(config: TelegramConfig) {
    const api = (config.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.#baseUrl = `${api}/bot${config.botToken}`;
    this.#timeoutMs = config.timeoutMs ?? 30_000;
    this.#retries = config.retries ?? 2;
    this.#logger = config.logger;
  }

  async #call(
    method: string,
    body: string | FormData,
    headers: Record<string, string> = {},
  ): Promise<SendResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

      try {
        const response = await fetch(`${this.#baseUrl}/${method}`, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body,
        });

        const payload = (await response.json().catch(() => ({}))) as TelegramResponse;

        if (payload.ok && payload.result) {
          return {
            messageId: payload.result.message_id,
            chatId: payload.result.chat?.id ?? '',
          };
        }

        const description = payload.description ?? `پاسخ ${response.status}`;

        // محدودیت نرخ: تلگرام خودش می‌گوید چقدر صبر کنیم
        if (response.status === 429) {
          const waitSeconds = payload.parameters?.retry_after ?? 5;
          if (attempt < this.#retries) {
            this.#logger?.warn('محدودیت نرخ تلگرام؛ به‌اندازهٔ خواستهٔ تلگرام صبر می‌کنیم', {
              retry_after: waitSeconds, attempt,
            });
            await sleep(waitSeconds * 1000);
            continue;
          }
        }

        if (response.status === 401) {
          throw new AppError(
            'TELEGRAM_AUTH',
            'توکن ربات تلگرام معتبر نیست. مقدار TELEGRAM_BOT_TOKEN را در .env بررسی کنید.',
            { status: 401 },
          );
        }

        // خطای ساختار پیام: با تلاش مجدد درست نمی‌شود
        if (response.status === 400) {
          throw new AppError('TELEGRAM_BAD_REQUEST', `تلگرام پیام را نپذیرفت: ${description}`, {
            status: 400, description, method,
          });
        }

        const error = new AppError('TELEGRAM_ERROR', `خطای تلگرام: ${description}`, {
          status: response.status, description, method,
        });
        if (response.status >= 500 && attempt < this.#retries) {
          lastError = error;
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        throw error;
      } catch (err) {
        lastError = err;
        if (err instanceof AppError && err.code !== 'TELEGRAM_ERROR') throw err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const retryable = isAbort || err instanceof TypeError || err instanceof AppError;
        if (!retryable || attempt >= this.#retries) break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (lastError instanceof AppError) throw lastError;
    throw new AppError('TELEGRAM_UNREACHABLE', 'تماس با تلگرام پس از چند تلاش ناموفق ماند',
      { method }, lastError);
  }

  /** بررسی اینکه توکن ربات کار می‌کند. */
  async checkConnection(): Promise<{ username: string }> {
    const response = await fetch(`${this.#baseUrl}/getMe`);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean; result?: { username?: string }; description?: string;
    };
    if (!payload.ok) {
      throw new AppError(
        'TELEGRAM_AUTH',
        `اتصال به ربات تلگرام برقرار نشد: ${payload.description ?? 'بدون توضیح'}`,
        {},
      );
    }
    return { username: payload.result?.username ?? '' };
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    return this.#call(
      'sendMessage',
      JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        parse_mode: 'HTML',
        disable_web_page_preview: input.disableWebPagePreview ?? false,
      }),
      { 'Content-Type': 'application/json' },
    );
  }

  /**
   * ارسال عکس با کپشن.
   * اگر فایل محلی داشته باشیم آپلود می‌شود (قابل اتکاتر)، وگرنه نشانی
   * تصویر به تلگرام داده می‌شود تا خودش بردارد.
   */
  async sendPhoto(input: SendPhotoInput): Promise<SendResult> {
    if (input.filePath) {
      const form = new FormData();
      form.append('chat_id', input.chatId);
      form.append('caption', input.caption);
      form.append('parse_mode', 'HTML');
      form.append(
        'photo',
        new Blob([fs.readFileSync(input.filePath)]),
        input.filename ?? 'photo.jpg',
      );
      return this.#call('sendPhoto', form);
    }

    if (!input.photoUrl) {
      throw new AppError('TELEGRAM_NO_PHOTO', 'برای ارسال عکس، فایل یا نشانی لازم است', {});
    }

    return this.#call(
      'sendPhoto',
      JSON.stringify({
        chat_id: input.chatId,
        photo: input.photoUrl,
        caption: input.caption,
        parse_mode: 'HTML',
      }),
      { 'Content-Type': 'application/json' },
    );
  }
}

/**
 * فرار دادن نویسه‌های خاص برای حالت HTML تلگرام.
 * تلگرام فقط این سه را می‌خواهد — اگر `<` متن خبر فرار نکند، کل پیام
 * با خطای «can't parse entities» رد می‌شود.
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
