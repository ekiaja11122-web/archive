/** پوستهٔ برنامه: مسیریابی، منو، میان‌برها و راه‌اندازی */
import { api, state, fa, num, refreshReference, savePref, debounce } from './core.js';
import { el } from './components.js';

import { renderDashboard } from './views/dashboard.js';
import { renderItems } from './views/items.js';
import { renderItemDetail } from './views/item-detail.js';
import { openItemForm } from './views/item-form.js';
import { renderDrives, renderDriveDetail } from './views/drives.js';
import { renderCategories, renderSpeakers, renderTags } from './views/manage.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';

/* ============================================================== مسیریابی */

const ROUTES = {
  dashboard: { render: renderDashboard, title: 'داشبورد' },
  items: { render: renderItems, title: 'آرشیو' },
  item: { render: renderItemDetail, title: 'جزئیات رکورد' },
  drives: { render: renderDrives, title: 'هاردها' },
  drive: { render: renderDriveDetail, title: 'محتویات هارد' },
  categories: { render: renderCategories, title: 'دسته‌بندی‌ها' },
  speakers: { render: renderSpeakers, title: 'اشخاص' },
  tags: { render: renderTags, title: 'برچسب‌ها' },
  reports: { render: renderReports, title: 'گزارش‌ها' },
  settings: { render: renderSettings, title: 'تنظیمات' },
};

/** پارامترهای کنونی آدرس */
export function currentQuery() {
  const hash = location.hash.slice(1);
  const [, query = ''] = hash.split('?');
  return Object.fromEntries(new URLSearchParams(query));
}

function currentRoute() {
  const hash = location.hash.slice(1) || 'dashboard';
  const [path, query = ''] = hash.split('?');
  const view = ROUTES[path] ? path : 'dashboard';
  return { view, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** رفتن به یک صفحه */
export function go(view, params = {}, { replace = false } = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, v);
  }
  const q = sp.toString();
  const hash = '#' + view + (q ? '?' + q : '');
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const { view, params } = currentRoute();
  state.route = { view, params };

  // انتخاب‌های گروهی هنگام تغییر صفحه پاک می‌شوند
  if (view !== 'items') state.selection.clear();

  document.title = `${ROUTES[view].title} — ${state.settings.archive_title || 'آرشیو'}`;
  updateNav(view);
  closeSidebar();

  const root = document.getElementById('view-root');
  try {
    await ROUTES[view].render(root, params);
  } catch (e) {
    if (token !== renderToken) return;                 // صفحه عوض شده
    console.error(e);
    root.innerHTML = '';
    root.append(el('div', { class: 'empty' },
      el('div', { class: 'empty__icon' }, '⚠️'),
      el('div', { class: 'empty__title' }, 'خطا در نمایش این صفحه'),
      el('div', { class: 'empty__text' }, e.message || String(e)),
      el('button', { class: 'btn', onclick: () => render() }, 'تلاش دوباره')));
  }
  if (token === renderToken) window.scrollTo({ top: 0 });
}

/* ================================================================== منو */

const NAV = [
  { group: 'مرور', items: [
    { view: 'dashboard', icon: '▤', label: 'داشبورد' },
    { view: 'items', icon: '☰', label: 'آرشیو', count: () => state.counts?.items },
    { view: 'drives', icon: '▣', label: 'هاردها', count: () => state.drives.length },
  ] },
  { group: 'سازماندهی', items: [
    { view: 'categories', icon: '🗂', label: 'دسته‌بندی‌ها', count: () => state.categories.length },
    { view: 'speakers', icon: '👤', label: 'اشخاص', count: () => state.speakers.length },
    { view: 'tags', icon: '🏷', label: 'برچسب‌ها', count: () => state.tags.length },
  ] },
  { group: 'نگهداری', items: [
    { view: 'reports', icon: '⚑', label: 'گزارش‌ها' },
    { view: 'settings', icon: '⚙', label: 'تنظیمات' },
  ] },
];

function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  for (const group of NAV) {
    nav.append(el('div', { class: 'nav-group__label' }, group.group));
    for (const item of group.items) {
      const count = item.count?.();
      const btn = el('button', { class: 'nav-item', dataset: { view: item.view } },
        el('span', { class: 'nav-item__icon' }, item.icon),
        el('span', {}, item.label),
        count ? el('span', { class: 'nav-item__count num' }, fa(count)) : null);
      btn.addEventListener('click', () => go(item.view));
      nav.append(btn);
    }
  }
  // بایگانی
  const archived = el('button', { class: 'nav-item', dataset: { view: '__archived' } },
    el('span', { class: 'nav-item__icon' }, '🗑'), el('span', {}, 'بایگانی حذف‌شده‌ها'));
  archived.addEventListener('click', () => go('items', { archived: '1' }));
  nav.append(archived);
}

function updateNav(view) {
  const isArchived = view === 'items' && currentQuery().archived === '1';
  document.querySelectorAll('.nav-item').forEach((n) => {
    const target = n.dataset.view;
    const active = target === '__archived' ? isArchived : (target === view && !isArchived);
    n.classList.toggle('is-active', active);
  });
}

/* ================================================================ پوسته */

export function applyTheme() {
  const pref = state.settings.theme || 'light';
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = dark ? '☀' : '🌙';
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('is-open');
}

/* ========================================================== میان‌برها */

function setupShortcuts() {
  let gPending = false;
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      go('items');
      setTimeout(() => document.querySelector('.filter-panel input')?.focus(), 120);
      return;
    }
    if (typing) return;

    if (gPending) {
      gPending = false;
      const map = { d: 'dashboard', a: 'items', h: 'drives', c: 'categories', s: 'settings', r: 'reports' };
      if (map[e.key.toLowerCase()]) { e.preventDefault(); go(map[e.key.toLowerCase()]); }
      return;
    }
    if (e.key.toLowerCase() === 'g') { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openItemForm(null, () => render());
    }
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('global-search')?.focus();
    }
  });
}

/* ============================================================ راه‌اندازی */

async function boot() {
  try {
    await refreshReference();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:Tahoma;text-align:center">
      <h2>ارتباط با سرور برقرار نشد</h2>
      <p style="color:#666">${e.message}</p>
      <p style="color:#666">مطمئن شوید برنامه در حال اجراست و سپس صفحه را تازه کنید.</p></div>`;
    return;
  }

  applyTheme();
  document.getElementById('brand-title').textContent = state.settings.archive_title || 'آرشیو';

  // شمارش کل رکوردها برای منو
  try {
    const s = await api.stats();
    state.counts = { items: s.totals.items };
  } catch { /* مهم نیست */ }

  buildNav();
  setupShortcuts();

  // جست‌وجوی سراسری
  const search = document.getElementById('global-search');
  search.addEventListener('input', debounce(() => {
    const q = search.value.trim();
    go('items', q ? { q } : {}, { replace: state.route.view === 'items' });
  }, 380));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go('items', search.value.trim() ? { q: search.value.trim() } : {});
    if (e.key === 'Escape') { search.value = ''; search.blur(); }
  });

  document.getElementById('theme-btn').addEventListener('click', () => {
    const cur = state.settings.theme || 'light';
    savePref('theme', cur === 'dark' ? 'light' : 'dark');
    applyTheme();
  });

  document.getElementById('new-item-btn').addEventListener('click', () => openItemForm(null, () => render()));

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('is-open');
  });

  window.addEventListener('hashchange', render);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((state.settings.theme || 'light') === 'auto') applyTheme();
  });

  document.getElementById('today-label').textContent = fa(state.today);

  if (!location.hash) location.hash = '#dashboard';
  await render();
}

boot();
