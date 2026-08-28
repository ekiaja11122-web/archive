/**
 * کلاینت OpenAI.
 *
 * چرا SDK رسمی نصب نشده: تنها چیزی که لازم داریم یک فراخوانی
 * chat/completions با خروجی JSON است. یک ماژول کوچک، وابستگی کمتر و
 * کنترل کامل روی مهلت زمانی و تلاش مجدد می‌دهد — و با هر سرویس سازگار
 * با OpenAI (از طریق OPENAI_BASE_URL) هم کار می‌کند.
 *
 * کلید API فقط از `.env` خوانده می‌شود و هرگز لاگ نمی‌شود.
 */
import { env, requireEnv } from '../config/env.ts';
import { AppError } from './errors.ts';
import { sleep } from './http.ts';
import type { Logger } from './logger.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** خروجی باید JSON معتبر باشد */
  jsonMode?: boolean;
  timeoutMs?: number;
  retries?: number;
  logger?: Logger;
};

export type ChatResult = {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
  durationMs: number;
};

/** آیا امکان استفاده از مدل زبانی هست؟ (بدون پرتاب خطا) */
export function isOpenAiConfigured(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const e = env();
  requireEnv(['OPENAI_API_KEY'], 'ارتباط با OpenAI');

  const {
    model = e.OPENAI_MODEL,
    temperature = 0.3,
    maxOutputTokens = 2000,
    jsonMode = false,
    timeoutMs = 60_000,
    retries = 2,
    logger,
  } = options;

  const url = `${e.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const started = performance.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoffMs = 2000 * 2 ** (attempt - 1);
      logger?.debug('تلاش مجدد برای تماس با مدل زبانی', { attempt, backoffMs });
      await sleep(backoffMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${e.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxOutputTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new AppError(
          'OPENAI_ERROR',
          `پاسخ ${response.status} از OpenAI`,
          // پیام خطا ممکن است حاوی جزئیات باشد ولی هرگز کلید در آن نیست
          { status: response.status, detail: detail.slice(0, 300) },
        );
        // ۴۲۹ و ۵xx گذرا هستند؛ ۴۰۱ و ۴۰۰ نه
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new AppError('OPENAI_EMPTY', 'پاسخ خالی از OpenAI دریافت شد', {});
      }

      return {
        content,
        model: payload.model ?? model,
        usage: {
          prompt: payload.usage?.prompt_tokens ?? 0,
          completion: payload.usage?.completion_tokens ?? 0,
          total: payload.usage?.total_tokens ?? 0,
        },
        durationMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const retryable = isAbort || err instanceof TypeError;
      if (!retryable || attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError('OPENAI_FAILED', 'تماس با OpenAI پس از چند تلاش ناموفق ماند', {}, lastError);
}

/**
 * مثل `chat` ولی خروجی را به‌صورت JSON برمی‌گرداند.
 * مدل‌ها گاهی JSON را داخل بلوک ```json می‌پیچند؛ اینجا پاک می‌شود.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<{ data: T; result: ChatResult }> {
  const result = await chat(messages, { ...options, jsonMode: true });

  const cleaned = result.content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return { data: JSON.parse(cleaned) as T, result };
  } catch (err) {
    throw new AppError(
      'OPENAI_BAD_JSON',
      'خروجی مدل زبانی JSON معتبر نبود',
      { preview: cleaned.slice(0, 200) },
      err,
    );
  }
}
