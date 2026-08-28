/**
 * لاگر ساختاریافتهٔ سبک.
 *
 * چرا کتابخانه‌ای نیست: تنها چیزی که لازم داریم لاگ JSON با «مرحلهٔ پایپ‌لاین»
 * است تا بتوان مسیر یک خبر را از collect تا publish دنبال کرد. یک ماژول
 * ۸۰ خطی این کار را بدون وابستگی انجام می‌دهد.
 *
 * در محیط توسعه خروجی خوانا و رنگی است، در production خط‌های JSON
 * (سازگار با journald / Loki / Datadog).
 */
import { env } from '../config/env.ts';

export const STAGES = [
  'collect',
  'filter',
  'dedup',
  'rewrite',
  'review',
  'publish',
  'scheduler',
  'admin',
  'db',
  'system',
] as const;

export type Stage = (typeof STAGES)[number];
export type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

export type LogFields = Record<string, unknown>;

function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      error: err.message,
      error_type: err.name,
      ...(err.stack ? { stack: err.stack.split('\n').slice(1, 4).join(' | ') } : {}),
      ...(err.cause instanceof Error ? { cause: err.cause.message } : {}),
    };
  }
  if (err === undefined) return {};
  return { error: String(err) };
}

export class Logger {
  readonly #stage: Stage;
  readonly #base: LogFields;

  constructor(stage: Stage, base: LogFields = {}) {
    this.#stage = stage;
    this.#base = base;
  }

  /** لاگر فرزند با فیلدهای ثابت اضافه (مثلاً شناسهٔ منبع یا خبر). */
  child(fields: LogFields): Logger {
    return new Logger(this.#stage, { ...this.#base, ...fields });
  }

  /** همان مرحله را عوض می‌کند و فیلدهای ثابت را نگه می‌دارد. */
  forStage(stage: Stage): Logger {
    return new Logger(stage, this.#base);
  }

  debug(msg: string, fields?: LogFields): void {
    this.#write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.#write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields, err?: unknown): void {
    this.#write('warn', msg, { ...fields, ...serializeError(err) });
  }
  error(msg: string, fields?: LogFields, err?: unknown): void {
    this.#write('error', msg, { ...fields, ...serializeError(err) });
  }

  #write(level: Level, msg: string, fields?: LogFields): void {
    const configured = safeLevel();
    if (LEVEL_ORDER[level] < LEVEL_ORDER[configured]) return;

    const record = {
      time: new Date().toISOString(),
      level,
      stage: this.#stage,
      msg,
      ...this.#base,
      ...fields,
    };

    if (isPretty()) {
      const { time, ...rest } = record;
      const extras = Object.entries(rest)
        .filter(([k]) => !['level', 'stage', 'msg'].includes(k))
        .map(([k, v]) => `${k}=${format(v)}`)
        .join(' ');
      const clock = time.slice(11, 19);
      const line =
        `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET} ` +
        `\x1b[90m${clock}\x1b[0m [${this.#stage}] ${msg}` +
        (extras ? ` \x1b[90m${extras}${RESET}` : '');
      process.stdout.write(line + '\n');
      return;
    }
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}

function format(v: unknown): string {
  if (typeof v === 'string') return v.includes(' ') ? JSON.stringify(v) : v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

function safeLevel(): Level {
  try {
    return env().LOG_LEVEL;
  } catch {
    return 'info';
  }
}

function isPretty(): boolean {
  if (process.env.LOG_FORMAT === 'json') return false;
  if (process.env.LOG_FORMAT === 'pretty') return true;
  try {
    return env().NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

/** لاگر ریشه برای یک مرحلهٔ مشخص از پایپ‌لاین. */
export function createLogger(stage: Stage, fields: LogFields = {}): Logger {
  return new Logger(stage, fields);
}

export const log = createLogger('system');
