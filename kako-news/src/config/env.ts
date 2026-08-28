/**
 * بارگذاری و اعتبارسنجی متغیرهای محیطی.
 *
 * قاعده: هیچ کلید API یا رمزی نباید در کد هاردکد شود — همه از `.env` می‌آیند.
 * مقادیر اینجا یک‌بار خوانده و اعتبارسنجی می‌شوند تا خطای تنظیمات در همان
 * لحظهٔ بالا آمدن برنامه معلوم شود، نه وسط کار پایپ‌لاین.
 */
import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TZ: z.string().default('Asia/Tehran'),

  DATABASE_URL: z.string().url('DATABASE_URL باید یک نشانی معتبر postgres باشد'),
  DATABASE_SSL: booleanish.default('false'),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHANNEL_ID: z.string().min(1).optional(),

  WORDPRESS_URL: z.string().url().optional(),
  WORDPRESS_USERNAME: z.string().min(1).optional(),
  WORDPRESS_APP_PASSWORD: z.string().min(1).optional(),

  ADMIN_PORT: z.coerce.number().int().positive().default(7799),
  ADMIN_HOST: z.string().default('127.0.0.1'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** متغیرهای محیطی اعتبارسنجی‌شده. اولین فراخوانی، بقیه از کش می‌خوانند. */
export function env(): Env {
  if (cached) return cached;

  // مقدار خالی در .env («OPENAI_API_KEY=») یعنی «تنظیم نشده»، نه «رشتهٔ خالی».
  // بدون این، یک خط خالی در .env همهٔ فرمان‌ها را با خطای اعتبارسنجی می‌خواباند.
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `تنظیمات محیطی ناقص یا نادرست است:\n${lines.join('\n')}\n` +
        `راهنما: فایل .env.example را به .env کپی کنید و مقادیر را پر کنید.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * بررسی اینکه سرویس‌های اختیاری تنظیم شده‌اند یا نه.
 * پایپ‌لاین باید بتواند بدون کلید OpenAI هم اجرا شود (حالت mock/dry-run)،
 * پس این‌ها اجباری نیستند و فقط در لحظهٔ استفاده چک می‌شوند.
 */
export function requireEnv<K extends keyof Env>(keys: K[], feature: string): Pick<Env, K> {
  const e = env();
  const missing = keys.filter((k) => e[k] === undefined || e[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `برای استفاده از «${feature}» این متغیرها باید در .env تنظیم شوند: ${missing.join(', ')}`,
    );
  }
  return Object.fromEntries(keys.map((k) => [k, e[k]])) as Pick<Env, K>;
}
