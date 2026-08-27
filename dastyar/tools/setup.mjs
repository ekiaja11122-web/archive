/**
 * راه‌اندازی خودکار روی Cloudflare
 *   node tools/setup.mjs
 *
 * این اسکریپت به ترتیب:
 *   ۱. بررسی می‌کند که وارد حساب کلادفلر شده باشید
 *   ۲. پایگاه دادهٔ D1 را می‌سازد (اگر ساخته نشده باشد)
 *   ۳. شناسهٔ آن را داخل wrangler.toml می‌نویسد
 *   ۴. جدول‌ها را می‌سازد
 *   ۵. برنامه را منتشر می‌کند و نشانی نهایی را نشان می‌دهد
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'wrangler.toml');
const DB_NAME = 'dastyar-db';

const say = (msg) => console.log('\n▸ ' + msg);

/**
 * اجرای یک فرمان و برگرداندن خروجی آن.
 * از execSync استفاده می‌کنیم چون روی ویندوز هم `npx` را درست پیدا می‌کند
 * (spawnSync در ویندوز فایل‌های .cmd را بدون shell اجرا نمی‌کند).
 */
function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], ...opts });
}

/** اجرای فرمان بدون پرتاب خطا؛ خروجی و وضعیت را برمی‌گرداند */
function tryRun(cmd) {
  try {
    return { ok: true, out: run(cmd) || '' };
  } catch (e) {
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    return { ok: false, out: out || 'اجرای فرمان ناموفق بود: ' + cmd };
  }
}

function die(message, hint) {
  console.error('\n✖ ' + message);
  if (hint) console.error('  ' + hint);
  process.exit(1);
}

/* ------------------------------------------------------ ۱) بررسی ورود */
say('بررسی حساب کلادفلر…');
const who = tryRun('npx wrangler whoami');
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) {
  die('هنوز وارد حساب کلادفلر نشده‌اید.', 'اول این دستور را اجرا کنید:  npx wrangler login');
}
const email = (who.out.match(/[\w.+-]+@[\w.-]+/) || [])[0];
console.log('  وارد شده‌اید' + (email ? ` با حساب ${email}` : ''));

/* --------------------------------------------- ۲) ساخت پایگاه داده D1 */
let config = readFileSync(CONFIG, 'utf8');
let dbId = (config.match(/database_id\s*=\s*"([^"]+)"/) || [])[1];

if (!dbId || dbId.startsWith('PUT-YOUR')) {
  say('ساخت پایگاه دادهٔ D1…');
  let created = tryRun(`npx wrangler d1 create ${DB_NAME}`);
  if (!created.ok) {
    if (!/already exists/i.test(created.out)) die('ساخت پایگاه داده ناموفق بود:\n' + created.out);
    say('پایگاه داده از قبل وجود دارد؛ شناسه‌اش را می‌گیریم…');
    created = tryRun('npx wrangler d1 list --json');
    if (!created.ok) die('گرفتن فهرست پایگاه‌های داده ناموفق بود:\n' + created.out);
  }
  const out = created.out;
  let id = null;
  // اگر خروجی JSON فهرست پایگاه‌ها بود، دقیقاً همان پایگاه دادهٔ خودمان را پیدا کن
  const jsonStart = out.indexOf('[');
  if (jsonStart >= 0) {
    try {
      const list = JSON.parse(out.slice(jsonStart, out.lastIndexOf(']') + 1));
      id = (list.find((d) => d.name === DB_NAME) || {}).uuid || null;
    } catch { /* خروجی JSON نبود */ }
  }
  if (!id) id = (out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
  if (!id) die('شناسهٔ پایگاه داده پیدا نشد.', 'خروجی:\n' + out);
  dbId = id;
  config = config.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${dbId}"`);
  writeFileSync(CONFIG, config);
  console.log('  شناسه ثبت شد: ' + dbId);
} else {
  console.log('  پایگاه داده از قبل تنظیم شده است: ' + dbId);
}

/* ------------------------------------------------------ ۳) ساخت جدول‌ها */
say('ساخت جدول‌ها…');
const schema = tryRun(`npx wrangler d1 execute ${DB_NAME} --remote --file=./schema.sql -y`);
if (!schema.ok) die('ساخت جدول‌ها ناموفق بود:\n' + schema.out);
console.log('  جدول‌ها آماده‌اند');

/* ------------------------------------------------------------ ۴) انتشار */
say('انتشار برنامه روی کلادفلر… (کمی طول می‌کشد)');
const deploy = tryRun('npx wrangler deploy');
const output = deploy.out;
if (!deploy.ok) die('انتشار ناموفق بود:\n' + output);
console.log(output.trim());

const url = (output.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
console.log('\n══════════════════════════════════════════════');
console.log('  ✔ برنامه منتشر شد!');
if (url) {
  console.log('\n  نشانی برنامه:\n  ' + url);
  console.log('\n  این نشانی را روی گوشی باز کنید، رمز اصلی بسازید،');
  console.log('  و از منوی مرورگر گزینهٔ «افزودن به صفحهٔ اصلی» را بزنید.');
} else {
  console.log('\n  نشانی را در خروجی بالا ببینید.');
}
console.log('══════════════════════════════════════════════\n');
