/**
 * هستهٔ برنامه: ارتباط با سرور، وضعیت مشترک و ابزارهای قالب‌بندی
 */
import * as J from '../lib/jalali.js';

export { J };

/* ============================================================ ارتباط با سرور */

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const user = state.settings.current_user;
  if (user) headers['x-archive-user'] = encodeURIComponent(user);

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `خطای سرور (${res.status})`);
  return data;
}

const qs = (params = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k + '[]', x));
    else sp.append(k, v);
  }
  const s = sp.toString();
  return s ? '?' + s : '';
};

export const api = {
  bootstrap: () => request('GET', '/bootstrap'),
  stats: () => request('GET', '/stats'),

  items: (filters) => request('GET', '/items' + qs(filters)),
  item: (id) => request('GET', `/items/${id}`),
  createItem: (data) => request('POST', '/items', data),
  updateItem: (id, data) => request('PUT', `/items/${id}`, data),
  deleteItem: (id, soft = true) => request('DELETE', `/items/${id}${soft ? '?soft=1' : ''}`),
  restoreItem: (id) => request('POST', `/restore/${id}`, {}),
  bulk: (payload) => request('POST', '/items/bulk', payload),

  createCopy: (data) => request('POST', '/copies', data),
  updateCopy: (id, data) => request('PUT', `/copies/${id}`, data),
  deleteCopy: (id) => request('DELETE', `/copies/${id}`),

  drives: (filters) => request('GET', '/drives' + qs(filters)),
  drive: (id) => request('GET', `/drives/${id}`),
  saveDrive: (d) => d.id ? request('PUT', `/drives/${d.id}`, d) : request('POST', '/drives', d),
  deleteDrive: (id) => request('DELETE', `/drives/${id}`),

  categories: () => request('GET', '/categories'),
  saveCategory: (c) => c.id ? request('PUT', `/categories/${c.id}`, c) : request('POST', '/categories', c),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  speakers: () => request('GET', '/speakers'),
  saveSpeaker: (s) => s.id ? request('PUT', `/speakers/${s.id}`, s) : request('POST', '/speakers', s),
  deleteSpeaker: (id) => request('DELETE', `/speakers/${id}`),

  tags: () => request('GET', '/tags'),
  createTag: (name, color) => request('POST', '/tags', { name, color }),
  deleteTag: (id) => request('DELETE', `/tags/${id}`),

  report: (name) => request('GET', `/reports/${name}`),
  activity: (limit = 100) => request('GET', `/activity?limit=${limit}`),

  settings: () => request('GET', '/settings'),
  saveSettings: (obj) => request('PUT', '/settings', obj),

  backups: () => request('GET', '/backup'),
  makeBackup: () => request('POST', '/backup', {}),
  deleteBackup: (name) => request('DELETE', `/backup/${encodeURIComponent(name)}`),

  importAll: (payload) => request('POST', '/import', payload),
  rebuildSearch: () => request('POST', '/maintenance/rebuild-search', {}),
  vacuum: () => request('POST', '/maintenance/vacuum', {}),
  info: () => request('GET', '/maintenance/info'),
};

/* ================================================================== وضعیت */

export const state = {
  drives: [], categories: [], speakers: [], tags: [],
  settings: {}, facets: {}, today: '',
  nextCodes: {},
  route: { view: 'dashboard', params: {} },
  itemFilters: { page: 1, per_page: 25, sort: 'newest' },
  selection: new Set(),
};

export async function refreshReference() {
  const b = await api.bootstrap();
  state.drives = b.drives;
  state.categories = b.categories;
  state.speakers = b.speakers;
  state.tags = b.tags;
  state.facets = b.facets;
  state.today = b.today;
  state.nextCodes = b.next_codes;
  state.settings = { ...b.settings, ...localPrefs() };
  return b;
}

function localPrefs() {
  try {
    return JSON.parse(localStorage.getItem('archive_prefs') || '{}');
  } catch { return {}; }
}

export function savePref(key, value) {
  state.settings[key] = value;
  const prefs = localPrefs();
  prefs[key] = value;
  try { localStorage.setItem('archive_prefs', JSON.stringify(prefs)); } catch { /* نادیده */ }
}

/* ============================================================ واژه‌نامه‌ها */

export const MEDIA_KINDS = {
  audio: { label: 'صوتی', icon: '🎧', badge: 'badge--audio' },
  video: { label: 'تصویری', icon: '🎬', badge: 'badge--video' },
  image: { label: 'تصویر/عکس', icon: '🖼️', badge: 'badge--info' },
  document: { label: 'سند/متن', icon: '📄', badge: '' },
  other: { label: 'سایر', icon: '📦', badge: '' },
};

export const QUALITIES = {
  excellent: { label: 'عالی', badge: 'badge--ok' },
  good: { label: 'خوب', badge: 'badge--brand' },
  average: { label: 'متوسط', badge: 'badge--warn' },
  poor: { label: 'ضعیف', badge: 'badge--danger' },
  unknown: { label: 'نامشخص', badge: '' },
};

export const COMPLETENESS = {
  complete: { label: 'کامل', badge: 'badge--ok' },
  partial: { label: 'ناقص', badge: 'badge--warn' },
  fragment: { label: 'بخشی از فایل', badge: 'badge--danger' },
  unknown: { label: 'نامشخص', badge: '' },
};

export const DEFECT_FLAGS = {
  noise: 'نویز و خش',
  low_volume: 'صدای کم',
  cut_start: 'ابتدای فایل قطع شده',
  cut_end: 'انتهای فایل قطع شده',
  missing_part: 'بخشی از میان فایل افتاده',
  echo: 'پژواک زیاد',
  distortion: 'اعوجاج صدا',
  sync_issue: 'ناهماهنگی صدا و تصویر',
  low_resolution: 'کیفیت تصویر پایین',
  unstable_image: 'تصویر لرزان',
  corrupt_file: 'فایل آسیب‌دیده',
  wrong_metadata: 'اطلاعات فایل نادرست',
  duplicate: 'تکراری',
  needs_split: 'نیاز به تفکیک جلسات',
  unknown_date: 'تاریخ نامشخص',
  unknown_speaker: 'گوینده نامشخص',
};

export const DRIVE_TYPES = {
  hdd: 'هارد اکسترنال', ssd: 'حافظهٔ SSD', flash: 'فلش‌مموری',
  dvd: 'دی‌وی‌دی', cd: 'سی‌دی', tape: 'نوار کاست/ویدئو', cloud: 'فضای ابری', other: 'سایر',
};

export const DRIVE_STATUS = {
  active: { label: 'فعال', badge: 'badge--ok' },
  full: { label: 'پر شده', badge: 'badge--warn' },
  archived: { label: 'بایگانی', badge: '' },
  loaned: { label: 'امانت داده شده', badge: 'badge--info' },
  damaged: { label: 'آسیب‌دیده', badge: 'badge--danger' },
  lost: { label: 'مفقود', badge: 'badge--danger' },
};

export const HEALTH = {
  ok: { label: 'سالم', badge: 'badge--ok', dot: 'dot--ok' },
  warning: { label: 'هشدار', badge: 'badge--warn', dot: 'dot--warn' },
  failing: { label: 'در حال خرابی', badge: 'badge--danger', dot: 'dot--danger' },
  unknown: { label: 'بررسی نشده', badge: '', dot: 'dot--muted' },
};

export const COPY_HEALTH = {
  ok: { label: 'سالم', badge: 'badge--ok' },
  unchecked: { label: 'بررسی نشده', badge: '' },
  corrupt: { label: 'خراب', badge: 'badge--danger' },
  missing: { label: 'مفقود', badge: 'badge--danger' },
};

export const COPY_ROLES = {
  master: 'نسخهٔ اصلی', backup: 'نسخهٔ پشتیبان',
  converted: 'نسخهٔ تبدیل‌شده', working: 'نسخهٔ کاری',
};

export const PRIORITIES = { 0: 'عادی', 1: 'مهم', 2: 'خیلی مهم' };

/* ============================================================= قالب‌بندی */

export const fa = (v) => J.toPersianDigits(v ?? '');

/** عدد با جداکنندهٔ هزارگان و ارقام فارسی */
export function num(v) {
  if (v == null || v === '') return '—';
  return fa(Number(v).toLocaleString('en-US'));
}

/** ثانیه -> «۱ ساعت و ۲ دقیقه» */
export function duration(sec) {
  if (!sec && sec !== 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const parts = [];
  if (h) parts.push(`${fa(h)} ساعت`);
  if (m) parts.push(`${fa(m)} دقیقه`);
  if (!h && !m) parts.push(`${fa(s)} ثانیه`);
  return parts.join(' و ');
}

/** ثانیه -> 01:02:35 */
export function hms(sec) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return fa([h, m, s].map((v) => String(v).padStart(2, '0')).join(':'));
}

/** «01:02:35» یا «62» (دقیقه) -> ثانیه */
export function parseDuration(input) {
  const t = J.toEnglishDigits(String(input || '')).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 60;           // فقط عدد = دقیقه
  const parts = t.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** مگابایت -> «۱٫۲ گیگابایت» */
export function size(mb) {
  if (mb == null || mb === '') return '—';
  const n = Number(mb);
  if (n >= 1048576) return fa((n / 1048576).toFixed(2)) + ' ترابایت';
  if (n >= 1024) return fa((n / 1024).toFixed(1)) + ' گیگابایت';
  return fa(n.toFixed(n < 10 ? 1 : 0)) + ' مگابایت';
}

export function gb(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (n >= 1024) return fa((n / 1024).toFixed(2)) + ' ترابایت';
  return fa(n) + ' گیگابایت';
}

/** تاریخ شمسی خوانا */
export function jdate(str, long = false) {
  if (!str) return '';
  return long ? J.formatJalaliLong(str) : fa(str);
}

/** ISO سرور -> تاریخ و ساعت شمسی */
export function stampToJalali(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const j = J.dateToJalali(d);
  const p = (n) => String(n).padStart(2, '0');
  return fa(`${J.formatJalali(j.jy, j.jm, j.jd)} ${p(d.getHours())}:${p(d.getMinutes())}`);
}

/** «۳ روز پیش» */
export function ago(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'همین حالا';
  if (diff < 3600) return `${fa(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${fa(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 2592000) return `${fa(Math.floor(diff / 86400))} روز پیش`;
  return stampToJalali(iso);
}

/** مسیر کامل دسته‌بندی از روی شناسه */
export function categoryPath(id) {
  if (!id) return '';
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const parts = [];
  let cur = byId.get(Number(id));
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.join(' › ');
}

/** دسته‌ها به صورت فهرست تودرتو برای <select> */
export function categoryOptions() {
  const byParent = new Map();
  for (const c of state.categories) {
    const k = c.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const c of (byParent.get(parent) || [])) {
      out.push({ ...c, depth, label: '  '.repeat(depth) + (depth ? '└ ' : '') + c.name });
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

export const driveById = (id) => state.drives.find((d) => d.id === Number(id));
export const speakerById = (id) => state.speakers.find((s) => s.id === Number(id));

/** پررنگ کردن واژه‌های جست‌وجو در متن */
export function highlight(text, query) {
  const t = String(text ?? '');
  if (!query) return escapeHtml(t);
  const terms = String(query).split(/\s+/).map((x) => x.replace(/^-/, '').replace(/"/g, '')).filter((x) => x.length > 1);
  if (!terms.length) return escapeHtml(t);
  let html = escapeHtml(t);
  for (const term of terms) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(safe, 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return html;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** دانلود یک فایل از سمت مرورگر */
export function downloadFile(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

export function debounce(fn, ms = 280) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
