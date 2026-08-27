/**
 * هستهٔ برنامه در مرورگر: ارتباط با سرور، وضعیت مشترک، قالب‌بندی و ابزارهای رابط کاربری
 */
import * as J from '../lib/jalali.js';
import * as DT from '../lib/dt.js';
import * as Crypto from './crypto.js';

export { J, DT, Crypto };

/* ============================================================ ارتباط با سرور */

async function request(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `خطای سرور (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  config: () => request('GET', '/config'),
  setup: (d) => request('POST', '/auth/setup', d),
  login: (d) => request('POST', '/auth/login', d),
  logout: () => request('POST', '/auth/logout', {}),
  changePassword: (d) => request('POST', '/auth/change-password', d),

  bootstrap: () => request('GET', '/bootstrap'),
  agenda: (date, horizon = 7) => request('GET', `/agenda?date=${date}&horizon=${horizon}`),

  list: (table, params = '') => request('GET', `/${table}${params}`),
  create: (table, d) => request('POST', `/${table}`, d),
  update: (table, id, d) => request('PUT', `/${table}/${id}`, d),
  remove: (table, id) => request('DELETE', `/${table}/${id}`),

  toggleTask: (id, d) => request('POST', `/tasks/${id}/toggle`, d),
  payDebt: (id, d) => request('POST', `/debts/${id}/pay`, d),
  payInstallment: (id, d) => request('POST', `/installments/${id}/pay`, d),
  payPayment: (id, d) => request('POST', `/payments/${id}/pay`, d),
  debtPayments: (id) => request('GET', `/debt_payments?debt_id=${id}`),
  financeSummary: (date) => request('GET', `/finance/summary?date=${date}`),

  settings: (d) => request('PUT', '/settings', d),
  pushKey: () => request('GET', '/push/key'),
  pushSubscribe: (d) => request('POST', '/push/subscribe', d),
  pushUnsubscribe: (d) => request('POST', '/push/unsubscribe', d),
  pushDevices: () => request('GET', '/push/devices'),
  pushDeviceRemove: (id) => request('DELETE', `/push/devices/${id}`),
  pushTest: () => request('POST', '/push/test', {}),
  runReminders: () => request('POST', '/reminders/run', {}),

  backup: () => request('GET', '/backup'),
  restore: (d) => request('POST', '/restore', d),
};

/* ==================================================================== وضعیت */

export const state = {
  settings: {},
  today: DT.todayISO(),
  agenda: null,
  counts: {},
  encKey: null,      // کلید رمزگذاری گاوصندوق (فقط در حافظه)
  vault: [],         // آیتم‌های بازگشایی‌شدهٔ گاوصندوق
  cache: {},
};

/* ============================================================== قالب‌بندی */

export const fa = (v) => J.toPersianDigits(v);
export const en = (v) => J.toEnglishDigits(v);

/** عدد با جداکنندهٔ هزارگان و ارقام فارسی */
export function money(n, withUnit = true) {
  const v = Number(n || 0);
  const s = fa(Math.abs(Math.round(v)).toLocaleString('en-US'));
  return (v < 0 ? '−' : '') + s + (withUnit ? ' تومان' : '');
}

/** خواندن عدد از ورودی کاربر (با ارقام فارسی و جداکننده) */
export function parseMoney(text) {
  const clean = en(String(text || '')).replace(/[^\d-]/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

/** خلاصهٔ مبلغ: ۱٫۲ میلیون */
export function moneyShort(n) {
  const raw = Number(n || 0);
  const v = Math.abs(raw);
  const sign = raw < 0 ? '−' : '';
  const dec = (x) => fa(x.toFixed(1).replace(/\.0$/, '')).replace('.', '٫');
  if (v >= 1e9) return sign + dec(v / 1e9) + ' میلیارد';
  if (v >= 1e6) return sign + dec(v / 1e6) + ' میلیون';
  if (v >= 1e3) return sign + fa((v / 1e3).toFixed(0)) + ' هزار';
  return sign + money(v, false);
}

export const dateLong = DT.formatISOLong;
export const dateShort = DT.formatISOShort;
export const relative = DT.relativeDay;

/** «شنبه ۱۲ مرداد» */
export function dayTitle(iso) {
  const j = DT.isoToJalali(iso);
  if (!j) return '';
  const dow = DT.dowISO(iso);
  return `${J.WEEKDAY_NAMES[dow]} ${fa(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}`;
}

export const timeFa = (hhmm) => (hhmm ? fa(hhmm) : '');

/* ============================================================== ابزار DOM */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** افزودن فرزندان با نادیده‌گرفتن مقادیر خالی (null/false) */
export function mount(parent, ...children) {
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

/* ------------------------------------------------------------- پیام کوتاه */

let toastTimer = null;
export function toast(message, kind = 'ok') {
  let box = $('#toast');
  if (!box) {
    box = el('div', { id: 'toast' });
    document.body.append(box);
  }
  box.textContent = message;
  box.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = ''; }, 3200);
}

/* ------------------------------------------------------------ پنجرهٔ پایین */

/** پنجره‌های بازِ فعلی — برای بستن خودکار هنگام رفتن به صفحهٔ دیگر */
const openSheets = new Set();

export function closeAllSheets() {
  for (const close of Array.from(openSheets)) close();
}

export function sheet(title, contentNode, actions = []) {
  const overlay = el('div', { class: 'sheet-overlay' });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    openSheets.delete(close);
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
  };
  openSheets.add(close);
  document.addEventListener('keydown', onKey);

  const box = el('div', { class: 'sheet' },
    el('div', { class: 'sheet-grip' }),
    el('div', { class: 'sheet-head' },
      el('h3', { text: title }),
      el('button', { class: 'icon-btn', onclick: close, 'aria-label': 'بستن', html: '&#10005;' }),
    ),
    el('div', { class: 'sheet-body' }, contentNode),
    actions.length ? el('div', { class: 'sheet-actions' }, actions) : null,
  );
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { overlay, box, close };
}

/** پرسش تأیید */
export function confirmBox(message, { danger = true, okText = 'بله' } = {}) {
  return new Promise((resolve) => {
    const s = sheet('تأیید', el('p', { class: 'confirm-text', text: message }), [
      el('button', { class: 'btn ghost', onclick: () => { s.close(); resolve(false); }, text: 'انصراف' }),
      el('button', {
        class: 'btn ' + (danger ? 'danger' : 'primary'),
        onclick: () => { s.close(); resolve(true); }, text: okText,
      }),
    ]);
  });
}

/** کپی در حافظه، با پاک‌کردن خودکار پس از ۴۵ ثانیه */
export async function copyToClipboard(text, label = 'کپی شد') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    setTimeout(() => {
      navigator.clipboard.readText().then((cur) => {
        if (cur === text) navigator.clipboard.writeText('');
      }).catch(() => {});
    }, 45000);
  } catch {
    toast('مرورگر اجازهٔ کپی نداد', 'err');
  }
}

/** جست‌وجوی ساده و مقاوم به تفاوت‌های نگارشی فارسی */
export function normalize(text) {
  return en(String(text || ''))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[ً-ْ‌]/g, '')
    .toLowerCase().trim();
}

export function matches(haystack, needle) {
  const n = normalize(needle);
  if (!n) return true;
  const h = normalize(haystack);
  return n.split(/\s+/).every((w) => h.includes(w));
}

/* ------------------------------------------------------------- بارگذاری */

export function spinner(text = 'در حال بارگذاری…') {
  return el('div', { class: 'loading' }, el('div', { class: 'spin' }), el('span', { text }));
}

export function emptyState(icon, title, hint) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon', text: icon }),
    el('h3', { text: title }),
    hint ? el('p', { text: hint }) : null,
  );
}
