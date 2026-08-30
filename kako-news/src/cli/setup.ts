/**
 * راه‌اندازی اولیه — یک‌بار، برای همیشه.
 *
 *     npm run setup
 *
 * کارهایی که کاربر باید دستی می‌کرد و روی ویندوز و مک فرق داشتند
 * (کپی کردن فایل تنظیمات، ساختن کلید تصادفی، اعمال مهاجرت‌ها) اینجا
 * یک‌جا و **یکسان روی هر سیستم‌عاملی** انجام می‌شوند.
 *
 * اگر چیزی از قبل انجام شده باشد، دست نمی‌خورد — این دستور را
 * می‌شود چند بار بی‌خطر اجرا کرد.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fromRoot } from '../config/paths.ts';
import { errorMessage } from '../lib/errors.ts';

const ENV_PATH = fromRoot('.env');
const ENV_EXAMPLE_PATH = fromRoot('.env.example');

function line(text = ''): void {
  stdout.write(text + '\n');
}

/** جایگزینی مقدار یک متغیر در متن فایل .env، بدون خراب کردن بقیه. */
function setEnvValue(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content)
    ? content.replace(pattern, `${key}=${value}`)
    : `${content.trimEnd()}\n${key}=${value}\n`;
}

function randomSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}


/**
 * خواندن فایل .env و گذاشتن مقادیرش در محیط پروسهٔ جاری.
 *
 * چرا لازم است: Node فایل .env را در لحظهٔ **شروع** پروسه می‌خواند. اگر
 * همین دستور تازه آن را ساخته باشد، پروسهٔ در حال اجرا هنوز خبر ندارد و
 * گام بعدی (اتصال دیتابیس) با خطای «DATABASE_URL تنظیم نشده» می‌افتد.
 */
function applyEnvFile(path: string): void {
  if (!fs.existsSync(path)) return;

  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    // مقدار ممکن است داخل گیومه باشد
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // متغیری که از قبل در محیط هست اولویت دارد
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}


/**
 * انتخاب رمز پنل.
 *
 * وقتی برنامه با دوبار کلیک روی فایل راه‌انداز اجرا می‌شود، ورودی یک
 * ترمینال واقعی است و می‌شود از کاربر پرسید. اما وقتی از اسکریپت یا
 * لولهٔ (pipe) دیگری اجرا شود، `readline` منتظر ورودی می‌ماند و چون
 * جریان ورودی بسته می‌شود، پروسه بی‌صدا هنگ می‌کند. پس اول بررسی
 * می‌کنیم ترمینال تعاملی هست یا نه.
 */
async function chooseAdminPassword(provided?: string): Promise<string> {
  if (provided && provided.length >= 8) return provided;

  if (!stdin.isTTY) {
    // اجرای غیرتعاملی: رمز تصادفی می‌سازیم و صریح نشانش می‌دهیم
    const generated = randomSecret().slice(0, 16);
    line('\n       (اجرای غیرتعاملی) رمز تصادفی پنل ساخته شد:');
    line(`           ${generated}`);
    line('       آن را یادداشت کنید؛ در فایل .env هم هست.');
    return generated;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let closed = false;
  rl.once('close', () => {
    closed = true;
  });

  try {
    line('\n       برای ورود به پنل مدیریت یک رمز عبور انتخاب کنید.');
    line('       (حداقل ۸ نویسه — بعداً هم می‌توانید عوضش کنید)');

    for (let attempt = 0; attempt < 3 && !closed; attempt++) {
      const answer = (await rl.question('\n       رمز عبور پنل: ')).trim();
      if (answer.length >= 8) return answer;
      line('       ✗ رمز باید حداقل ۸ نویسه باشد.');
    }
  } catch {
    // ورودی بسته شد؛ پایین‌تر رمز تصادفی ساخته می‌شود
  } finally {
    rl.close();
  }

  const generated = randomSecret().slice(0, 16);
  line(`\n       رمز معتبری وارد نشد؛ این رمز تصادفی ساخته شد: ${generated}`);
  line('       آن را یادداشت کنید یا بعداً در فایل .env عوضش کنید.');
  return generated;
}

export async function runSetup(options: { password?: string } = {}): Promise<number> {
  line();
  line('  راه‌اندازی اولیهٔ کاکو نیوز');
  line('  ' + '─'.repeat(48));

  // ---------- گام ۱: فایل تنظیمات ----------
  let createdEnv = false;

  if (fs.existsSync(ENV_PATH)) {
    line('\n  ۱/۴  فایل تنظیمات (.env) از قبل هست — دست نخورد.');
  } else {
    if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
      line('\n  ✗ فایل .env.example پیدا نشد. کد پروژه ناقص است.');
      return 1;
    }

    line('\n  ۱/۴  ساخت فایل تنظیمات…');
    let content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');

    // کلید امضای نشست پنل — باید تصادفی باشد
    content = setEnvValue(content, 'SESSION_SECRET', randomSecret());

    const password = await chooseAdminPassword(options.password);
    content = setEnvValue(content, 'ADMIN_PASSWORD', password);

    fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    createdEnv = true;
    line('\n       ✓ فایل .env ساخته شد.');
  }

  // فایل تازه‌ساخته‌شده را در همین پروسه هم اعمال می‌کنیم
  applyEnvFile(ENV_PATH);

  if (!process.env.DATABASE_URL) {
    line('\n  ✗ مقدار DATABASE_URL در فایل .env خالی است.');
    line('    فایل .env را باز کنید و نشانی دیتابیس را بگذارید، مثلاً:');
    line('        DATABASE_URL=postgres://kako:kako@localhost:5432/kako_news');
    line();
    return 1;
  }

  // ---------- گام ۲: اتصال دیتابیس ----------
  line('\n  ۲/۴  بررسی اتصال دیتابیس…');

  // بارگذاری با تأخیر: تا پیش از ساخته شدن .env نباید env() خوانده شود
  const { ping } = await import('../db/pool.ts');
  const { env } = await import('../config/env.ts');

  let alive = false;
  try {
    alive = await ping();
  } catch (err) {
    line(`       ✗ ${errorMessage(err)}`);
  }

  if (!alive) {
    let target = '(نامشخص)';
    try {
      const url = new URL(env().DATABASE_URL);
      target = `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch { /* نشانی نامعتبر؛ پایین‌تر راهنمایی می‌شود */ }

    line(`       ✗ اتصال به دیتابیس برقرار نشد (${target}).`);
    line();
    line('       دیتابیس PostgreSQL باید در دسترس باشد. دو راه دارید:');
    line();
    line('       الف) با Docker (ساده‌تر):');
    line('            docker compose up -d');
    line();
    line('       ب) نصب مستقیم PostgreSQL و سپس ساخت دیتابیس:');
    line('            createdb kako_news');
    line();
    line('       سپس همین راه‌اندازی را دوباره اجرا کنید.');
    line();
    return 1;
  }
  line('       ✓ اتصال برقرار است.');

  // ---------- گام ۳: ساخت جدول‌ها ----------
  line('\n  ۳/۴  ساخت جدول‌های دیتابیس…');
  const { runMigrations } = await import('../db/migrate.ts');
  const applied = await runMigrations();
  line(`       ✓ ${applied > 0 ? `${applied} مهاجرت اعمال شد` : 'جدول‌ها از قبل ساخته شده بودند'}`);

  // ---------- گام ۴: ثبت منابع ----------
  line('\n  ۴/۴  ثبت منابع خبری…');
  const { loadSourcesConfig } = await import('../config/sources-config.ts');
  const { syncSources } = await import('../db/repositories/sources.ts');
  const summary = await syncSources(loadSourcesConfig());
  line(`       ✓ ${summary.created + summary.updated} منبع ثبت شد`);

  // ---------- پایان ----------
  line();
  line('  ' + '─'.repeat(48));
  line('  راه‌اندازی تمام شد.');
  line();
  line('  گام بعدی — اجرای نمایشی، برای دیدن کل سامانه:');
  line();
  line('      npm run demo');
  line('      npm run serve');
  line();
  line('  سپس در مرورگر:  http://127.0.0.1:7799');

  if (createdEnv) {
    line();
    line('  کلیدهای OpenAI، تلگرام و وردپرس فعلاً لازم نیستند.');
    line('  هر وقت خواستید، در فایل .env پرشان کنید.');
  }
  line();

  return 0;
}
