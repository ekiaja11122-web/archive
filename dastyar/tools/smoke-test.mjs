/**
 * آزمون سلامت برنامه (روی نسخهٔ محلی)
 *
 *   ۱. در یک پنجره:  npm run db:init:local && npm run dev
 *   ۲. در پنجرهٔ دیگر:  node tools/smoke-test.mjs
 *
 * توجه: این آزمون روی پایگاه دادهٔ محلیِ خالی اجرا می‌شود و در آن داده می‌سازد.
 */
const B = process.env.TEST_URL || 'http://127.0.0.1:8787';
let cookie = '';
async function call(method, path, body) {
  const res = await fetch(B + '/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, d };
}
const b64 = (b) => Buffer.from(b).toString('base64');
const enc = new TextEncoder();
async function derive(pw, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(salt, 'base64'), iterations: 310000, hash: 'SHA-256' }, base, 256);
  return b64(bits);
}
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(salt, 'base64'), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return b64(Buffer.concat([Buffer.from(iv), Buffer.from(ct)]));
}
async function decJSON(key, payload) {
  const raw = Buffer.from(payload, 'base64');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
const ok = (label, cond, extra='') => console.log((cond ? '✅' : '❌') + ' ' + label + (extra ? ' — ' + extra : ''));

const authSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
const encSalt = b64(crypto.getRandomValues(new Uint8Array(16)));

let r = await call('GET', '/config');
ok('config', r.status === 200, JSON.stringify(r.d));

r = await call('GET', '/tasks');
ok('بدون راه‌اندازی مسدود است', r.status === 428, r.status);

const authKey = await derive('MySecret123', authSalt);
r = await call('POST', '/auth/setup', { auth_key: authKey, auth_salt: authSalt, enc_salt: encSalt, kdf_iterations: 310000, hint: 'یادآور' });
ok('راه‌اندازی', r.status === 200, JSON.stringify(r.d));

r = await call('GET', '/bootstrap');
ok('bootstrap', r.status === 200, r.d?.today);

// کارها
const today = r.d.today;
r = await call('POST', '/tasks', { title: 'تماس با آقای رضایی', category: 'تماس', priority: 2, due_date: today, due_time: '10:30', remind_before: 15 });
const t1 = r.d; ok('ساخت کار', r.status === 201, t1.title);
r = await call('POST', '/tasks', { title: 'ورزش روزانه', repeat_rule: 'daily', due_date: today });
const t2 = r.d; ok('کار تکرارشونده', r.status === 201);
r = await call('POST', '/tasks', { title: 'کار عقب‌افتاده', due_date: '2026-01-01' });
ok('کار قدیمی', r.status === 201);

r = await call('GET', '/agenda?date=' + today);
ok('agenda: کارهای امروز', r.d.today.length === 2, 'today=' + r.d.today.length + ' overdue=' + r.d.overdue.length);
ok('agenda: عقب‌افتاده', r.d.overdue.length === 1);

r = await call('POST', `/tasks/${t2.id}/toggle`, { date: today, done: true });
ok('انجام‌شدن کار تکرارشونده', r.status === 200);
r = await call('GET', '/agenda?date=' + today);
ok('ثبت انجام در همان روز', r.d.today.find(x => x.id === t2.id)?.done_today === 1);

// گاوصندوق
const key = await deriveKey('MySecret123', encSalt);
const payload = { title: 'کارت ملت', note: 'حساب اصلی', fields: [{ label: 'شمارهٔ کارت', value: '6104337812345678', secret: true }, { label: 'رمز دوم', value: '99887766', secret: true }] };
r = await call('POST', '/vault', { category: 'card', data_enc: await encJSON(key, payload) });
ok('ذخیرهٔ گاوصندوق', r.status === 201);
r = await call('GET', '/vault');
const back = await decJSON(key, r.d[0].data_enc);
ok('بازگشایی گاوصندوق', back.fields[1].value === '99887766', back.title);
ok('سرور محتوا را نمی‌بیند', !JSON.stringify(r.d).includes('99887766'));

// مالی
r = await call('POST', '/debts', { kind: 'payable', person: 'حسن', amount: 5000000, due_date: today });
const debt = r.d; ok('ثبت بدهی', r.status === 201);
r = await call('POST', `/debts/${debt.id}/pay`, { amount: 2000000, date: today });
ok('پرداخت جزئی', r.d.paid === 2000000 && r.d.settled === false, JSON.stringify(r.d));

r = await call('POST', '/installments', { title: 'وام مسکن', entity: 'بانک ملی', amount: 3200000, total_count: 24, paid_count: 3, next_due: today });
const inst = r.d; ok('ثبت قسط', r.status === 201);
r = await call('POST', `/installments/${inst.id}/pay`, { date: today });
ok('پرداخت قسط', r.d.paid_count === 4 && !!r.d.next_due, 'سررسید بعدی: ' + r.d.next_due);

r = await call('POST', '/payments', { title: 'اجارهٔ خانه', amount: 12000000, direction: 'out', due_date: today, repeat_rule: 'monthly' });
const pay = r.d;
r = await call('POST', `/payments/${pay.id}/pay`, { date: today });
ok('پرداخت واریز دوره‌ای', r.status === 200);
r = await call('GET', '/payments');
ok('سررسید بعدی واریز جلو رفت', r.d[0].due_date !== today, r.d[0].due_date);

r = await call('GET', '/finance/summary?date=' + today);
ok('گزارش مالی', r.status === 200, JSON.stringify(r.d.totals));

// مناسبت‌ها
// مناسبت سالانه: همان روزِ شمسیِ ۴ روز بعد، ولی در سال‌های قبل
const { isoToJalali, jalaliToISO, addDaysISO } = await import('../public/lib/dt.js');
const soon = addDaysISO(today, 4);
const js = isoToJalali(soon);
const birthday = jalaliToISO(js.jy - 30, js.jm, js.jd);
r = await call('POST', '/events', { title: 'تولد مادر', date: birthday, kind: 'birthday', repeat_rule: 'yearly', remind_days: 3 });
ok('ثبت مناسبت', r.status === 201);
r = await call('GET', '/agenda?date=' + today + '&horizon=7');
const ev = r.d.events.find((e) => e.title === 'تولد مادر');
ok('محاسبهٔ سالگرد شمسی', ev?.occurrence === soon && ev?.days_away === 4, JSON.stringify(ev?.occurrence));

// یادداشت و مخاطب
r = await call('POST', '/notes', { title: 'ایده', body: 'طراحی سایت جدید' });
ok('یادداشت', r.status === 201);
r = await call('POST', '/contacts', { name: 'رضا محمدی', phone: '09121234567' });
ok('مخاطب', r.status === 201);

// پشتیبان
r = await call('GET', '/backup');
ok('پشتیبان‌گیری', r.status === 200 && Object.keys(r.d.tables).length > 5, Object.keys(r.d.tables).join(','));
const backup = r.d;

// نوتیفیکیشن
r = await call('GET', '/push/key');
ok('کلید VAPID', r.status === 200 && r.d.key.length > 80, r.d.key?.slice(0, 20) + '…');
r = await call('POST', '/reminders/run', {});
ok('اجرای یادآوری‌ها', r.status === 200, JSON.stringify(r.d));

// امنیت
const saved = cookie; cookie = '';
r = await call('GET', '/tasks');
ok('بدون کوکی مسدود', r.status === 401);
cookie = saved;
r = await call('POST', '/auth/login', { auth_key: 'wrong' });
ok('رمز اشتباه رد می‌شود', r.status === 401);
r = await call('POST', '/auth/login', { auth_key: authKey });
ok('ورود دوباره', r.status === 200);

// بازیابی
r = await call('POST', '/restore', { ...backup, mode: 'merge' });
ok('بازیابی', r.status === 200, JSON.stringify(r.d));
