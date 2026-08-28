/**
 * ربات تلگرام ساختگی.
 *
 * محدودیت‌های واقعی Bot API را اعمال می‌کند — همان‌هایی که اگر رعایت
 * نشوند، پست در کانال یا اصلاً نمی‌رود یا بد می‌رود:
 *   - سقف ۴۰۹۶ نویسه برای پیام و ۱۰۲۴ نویسه برای کپشن عکس
 *   - خطای «can't parse entities» وقتی HTML نامعتبر باشد
 *     (مثلاً `<` فرار نکرده در متن خبر)
 *   - خطای ۴۲۹ همراه `retry_after` برای محدودیت نرخ
 *   - توکن نامعتبر → ۴۰۱
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const MOCK_BOT_TOKEN = '123456789:AAExampleTokenForTestsOnly-abcdef';
export const MOCK_CHANNEL = '@kakonews_test';

export type SentMessage = {
  method: 'sendMessage' | 'sendPhoto';
  message_id: number;
  chat_id: string;
  text: string;              // متن یا کپشن
  parse_mode: string | null;
  disable_web_page_preview: boolean;
  photo: { filename: string; bytes: number } | { url: string } | null;
};

export type MockTelegram = {
  url: string;
  close: () => Promise<void>;
  sent: SentMessage[];
  requests: string[];
  /** چند درخواست بعدی خطای ۴۲۹ بگیرند */
  rateLimitTimes: number;
  /** مقدار retry_after در پاسخ ۴۲۹ (ثانیه) */
  retryAfter: number;
  /** چند درخواست بعدی خطای ۵۰۰ بگیرند */
  failTimes: number;
};

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;

/** تگ‌هایی که تلگرام در حالت HTML می‌پذیرد. */
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'code', 'pre', 'blockquote'];

/**
 * شبیه‌سازی تحلیل HTML تلگرام.
 * تلگرام برای تگ ناشناخته یا `<` فرار نکرده خطای «can't parse entities»
 * می‌دهد — همان چیزی که اگر متن خبر را escape نکنیم اتفاق می‌افتد.
 */
function validateTelegramHtml(text: string): string | null {
  const stack: string[] = [];
  const tagPattern = /<\/?([a-zA-Z]+)(\s[^>]*)?>/g;
  let cleaned = text;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    if (!ALLOWED_TAGS.includes(tag)) {
      return `Bad Request: can't parse entities: Unsupported start tag "${tag}"`;
    }
    if (match[0].startsWith('</')) {
      if (stack.pop() !== tag) {
        return `Bad Request: can't parse entities: Unmatched end tag "${tag}"`;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    return `Bad Request: can't parse entities: Can't find end tag "${stack.at(-1)}"`;
  }

  // هر `<` یا `>` باقی‌مانده که بخشی از تگ مجاز نبوده
  cleaned = text.replace(tagPattern, '');
  if (/[<>]/.test(cleaned)) {
    return `Bad Request: can't parse entities: Unexpected character in the middle of the text`;
  }
  return null;
}

/** استخراج ساده از بدنهٔ multipart برای تشخیص فایل عکس. */
function parseMultipart(buffer: Buffer, boundary: string): Record<string, string | { filename: string; bytes: number }> {
  const fields: Record<string, string | { filename: string; bytes: number }> = {};
  const parts = buffer.toString('latin1').split(`--${boundary}`);

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (!name) continue;
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
    const filename = /filename="([^"]+)"/.exec(headers)?.[1];
    fields[name] = filename ? { filename, bytes: body.length } : Buffer.from(body, 'latin1').toString('utf8');
  }
  return fields;
}

export async function startMockTelegram(): Promise<MockTelegram> {
  const state: Omit<MockTelegram, 'url' | 'close'> = {
    sent: [], requests: [], rateLimitTimes: 0, retryAfter: 1, failTimes: 0,
  };
  let nextMessageId = 1000;

  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    state.requests.push(path);

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    const tokenMatch = /^\/bot([^/]+)\/(\w+)/.exec(path);
    if (!tokenMatch) {
      send(404, { ok: false, error_code: 404, description: 'Not Found' });
      return;
    }
    const [, token, method] = tokenMatch;
    if (token !== MOCK_BOT_TOKEN) {
      send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      if (method === 'getMe') {
        send(200, { ok: true, result: { id: 1, is_bot: true, username: 'kakonews_bot' } });
        return;
      }

      if (state.failTimes > 0) {
        state.failTimes--;
        send(500, { ok: false, error_code: 500, description: 'Internal Server Error' });
        return;
      }

      if (state.rateLimitTimes > 0) {
        state.rateLimitTimes--;
        send(429, {
          ok: false, error_code: 429,
          description: 'Too Many Requests: retry later',
          parameters: { retry_after: state.retryAfter },
        });
        return;
      }

      const contentType = String(req.headers['content-type'] ?? '');
      let fields: Record<string, unknown>;

      if (contentType.includes('multipart/form-data')) {
        const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? '';
        fields = parseMultipart(raw, boundary);
      } else {
        try {
          fields = JSON.parse(raw.toString('utf8') || '{}') as Record<string, unknown>;
        } catch {
          send(400, { ok: false, error_code: 400, description: 'Bad Request: invalid JSON' });
          return;
        }
      }

      const chatId = String(fields.chat_id ?? '');
      if (!chatId) {
        send(400, { ok: false, error_code: 400, description: 'Bad Request: chat_id is empty' });
        return;
      }

      if (method === 'sendMessage' || method === 'sendPhoto') {
        const isPhoto = method === 'sendPhoto';
        const body = String((isPhoto ? fields.caption : fields.text) ?? '');
        const limit = isPhoto ? MAX_CAPTION : MAX_TEXT;

        if (!isPhoto && !body) {
          send(400, { ok: false, error_code: 400, description: 'Bad Request: message text is empty' });
          return;
        }
        if ([...body].length > limit) {
          send(400, {
            ok: false, error_code: 400,
            description: isPhoto
              ? 'Bad Request: message caption is too long'
              : 'Bad Request: message is too long',
          });
          return;
        }

        if (String(fields.parse_mode ?? '') === 'HTML') {
          const error = validateTelegramHtml(body);
          if (error) {
            send(400, { ok: false, error_code: 400, description: error });
            return;
          }
        }

        const photoField = fields.photo;
        const photo = isPhoto
          ? typeof photoField === 'string'
            ? { url: photoField }
            : (photoField as { filename: string; bytes: number } | undefined) ?? null
          : null;

        if (isPhoto && !photo) {
          send(400, { ok: false, error_code: 400, description: 'Bad Request: photo is required' });
          return;
        }

        const messageId = nextMessageId++;
        state.sent.push({
          method,
          message_id: messageId,
          chat_id: chatId,
          text: body,
          parse_mode: (fields.parse_mode as string) ?? null,
          disable_web_page_preview:
            String(fields.disable_web_page_preview ?? 'false') === 'true',
          photo,
        });

        send(200, {
          ok: true,
          result: {
            message_id: messageId,
            chat: { id: -1001234567890, username: chatId.replace('@', ''), type: 'channel' },
            date: Math.floor(Date.now() / 1000),
          },
        });
        return;
      }

      send(400, { ok: false, error_code: 400, description: `Bad Request: method ${method} not found` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // همان شیء state برگردانده می‌شود، نه کپی — وگرنه تنظیم rateLimitTimes
  // در تست هرگز به سرور نمی‌رسد.
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
