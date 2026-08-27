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
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'wrangler.toml');
const DB_NAME = 'dastyar-db';

const say = (msg) => console.log('\n▸ ' + msg);
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], ...opts });

function die(message, hint) {
  console.error('\n✖ ' + message);
  if (hint) console.error('  ' + hint);
  process.exit(1);
}

/* ------------------------------------------------------ ۱) بررسی ورود */
say('بررسی حساب کلادفلر…');
try {
  const who = run('npx wrangler whoami');
  const email = (who.match(/[\w.+-]+@[\w.-]+/) || [])[0];
  console.log('  وارد شده‌اید' + (email ? ` با حساب ${email}` : ''));
} catch {
  die('هنوز وارد حساب کلادفلر نشده‌اید.', 'اول این دستور را اجرا کنید:  npx wrangler login');
}

/* --------------------------------------------- ۲) ساخت پایگاه داده D1 */
let config = readFileSync(CONFIG, 'utf8');
let dbId = (config.match(/database_id\s*=\s*"([^"]+)"/) || [])[1];

if (!dbId || dbId.startsWith('PUT-YOUR')) {
  say('ساخت پایگاه دادهٔ D1…');
  let out = '';
  try {
    out = run(`npx wrangler d1 create ${DB_NAME}`);
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    if (!/already exists/i.test(out)) die('ساخت پایگاه داده ناموفق بود:\n' + out);
    say('پایگاه داده از قبل وجود دارد؛ شناسه‌اش را می‌گیریم…');
    out = run('npx wrangler d1 list --json');
  }
  const id = (out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
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
const schema = spawnSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file=./schema.sql', '-y'],
  { cwd: ROOT, encoding: 'utf8' });
if (schema.status !== 0) die('ساخت جدول‌ها ناموفق بود:\n' + (schema.stderr || schema.stdout));
console.log('  جدول‌ها آماده‌اند');

/* ------------------------------------------------------------ ۴) انتشار */
say('انتشار برنامه روی کلادفلر…');
const deploy = spawnSync('npx', ['wrangler', 'deploy'], { cwd: ROOT, encoding: 'utf8' });
const output = (deploy.stdout || '') + (deploy.stderr || '');
if (deploy.status !== 0) die('انتشار ناموفق بود:\n' + output);

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
