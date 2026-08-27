/**
 * پوستهٔ برنامه: ورود، مسیریابی و نوار پایین
 */
import { api, state, el, $, clear, toast, fa, DT, Crypto, spinner, closeAllSheets } from './core.js';
import { input, btn } from './components.js';

import { renderToday } from './views/today.js';
import { renderTasks } from './views/tasks.js';
import { renderVault } from './views/vault.js';
import { renderFinance } from './views/finance.js';
import { renderMore, renderNotes, renderContacts, renderDates, renderSettings, renderReports } from './views/more.js';

const ROUTES = {
  today: { title: 'امروز', render: renderToday },
  tasks: { title: 'کارها', render: renderTasks },
  vault: { title: 'گاوصندوق', render: renderVault },
  finance: { title: 'حساب و کتاب', render: renderFinance },
  more: { title: 'بیشتر', render: renderMore },
  notes: { title: 'یادداشت‌ها', render: renderNotes },
  contacts: { title: 'مخاطبین', render: renderContacts },
  dates: { title: 'تاریخ‌های مهم', render: renderDates },
  reports: { title: 'گزارش مالی', render: renderReports },
  settings: { title: 'تنظیمات', render: renderSettings },
};

const NAV = [
  { key: 'today', label: 'امروز', icon: '☀' },
  { key: 'tasks', label: 'کارها', icon: '✔' },
  { key: 'vault', label: 'گاوصندوق', icon: '🔒' },
  { key: 'finance', label: 'مالی', icon: '₹' },
  { key: 'more', label: 'بیشتر', icon: '⋯' },
];

/* ==================================================================== ورود */

function authScreen(mode, config) {
  const app = $('#app');
  clear(app);
  const isSetup = mode === 'setup';

  const pw = input({ type: 'password', placeholder: 'رمز اصلی', autocomplete: 'current-password' });
  const pw2 = input({ type: 'password', placeholder: 'تکرار رمز اصلی', autocomplete: 'new-password' });
  const hint = input({ placeholder: 'یادآور رمز (اختیاری)' });
  const remember = el('input', { type: 'checkbox', checked: true });
  const status = el('div', { class: 'auth-status' });
  const strength = el('div', { class: 'strength' });

  if (isSetup) {
    pw.addEventListener('input', () => {
      const s = Crypto.passwordStrength(pw.value);
      strength.className = 'strength s' + s;
      strength.textContent = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'عالی'][s];
    });
  }

  const submit = async () => {
    const password = pw.value;
    if (!password) return toast('رمز را وارد کنید', 'err');
    if (isSetup) {
      if (password.length < 8) return toast('رمز باید دست‌کم ۸ نویسه باشد', 'err');
      if (password !== pw2.value) return toast('دو رمز یکسان نیستند', 'err');
    }
    status.textContent = 'در حال بررسی…';
    try {
      const salts = isSetup ? Crypto.freshSalts() : {
        auth_salt: config.auth_salt, enc_salt: config.enc_salt, kdf_iterations: config.kdf_iterations,
      };
      const { authKey, encKey } = await Crypto.deriveKeys(
        password, salts.auth_salt, salts.enc_salt, salts.kdf_iterations,
      );
      if (isSetup) {
        await api.setup({ auth_key: authKey, ...salts, hint: hint.value });
      } else {
        await api.login({ auth_key: authKey });
      }
      state.encKey = encKey;
      await Crypto.rememberKey(encKey, remember.checked);
      await startApp();
    } catch (e) {
      status.textContent = '';
      toast(e.message, 'err');
    }
  };

  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !isSetup) submit(); });

  app.append(el('div', { class: 'auth' },
    el('div', { class: 'auth-box' },
      el('div', { class: 'auth-logo', text: '🗝' }),
      el('h1', { text: isSetup ? 'خوش آمدید' : 'قفل برنامه' }),
      el('p', { class: 'auth-lead', text: isSetup
        ? 'یک «رمز اصلی» انتخاب کنید. این رمز هم برای ورود به برنامه است و هم کلید رمزگذاری اطلاعات حساس شما. روی سرور ذخیره نمی‌شود.'
        : 'رمز اصلی خود را وارد کنید.' }),
      !isSetup && config.hint ? el('p', { class: 'auth-hint', text: 'یادآور: ' + config.hint }) : null,
      pw,
      isSetup ? strength : null,
      isSetup ? pw2 : null,
      isSetup ? hint : null,
      el('label', { class: 'check' }, remember, el('span', { text: 'روی این دستگاه به خاطر بسپار' })),
      el('button', { class: 'btn primary big', onclick: submit, text: isSetup ? 'ساخت و ورود' : 'ورود' }),
      status,
      isSetup ? el('p', { class: 'auth-warn', text: '⚠ اگر این رمز را فراموش کنید، اطلاعات گاوصندوق قابل بازیابی نیست. جایی امن یادداشتش کنید.' }) : null,
    ),
  ));
  setTimeout(() => pw.focus(), 100);
}

/* ============================================================== اجرای برنامه */

let currentRoute = '';

async function startApp() {
  const app = $('#app');
  clear(app);
  app.append(spinner());

  const data = await api.bootstrap();
  Object.assign(state, {
    settings: data.settings, today: data.today, agenda: data.agenda, counts: data.counts,
  });
  if (!state.encKey) state.encKey = await Crypto.recallKey();

  clear(app);
  app.append(
    el('header', { class: 'top' },
      el('div', { class: 'top-main' },
        el('div', { class: 'top-title', id: 'page-title' }),
        el('div', { class: 'top-date', text: DT.formatISOLong(state.today) + ' — ' + weekdayName(state.today) }),
      ),
      el('div', { class: 'top-actions', id: 'top-actions' }),
    ),
    el('main', { id: 'view' }),
    el('nav', { class: 'tabbar', id: 'tabbar' }),
  );
  drawNav();
  window.addEventListener('hashchange', route);
  route();
  registerServiceWorker();
}

function weekdayName(iso) {
  return DT.J.WEEKDAY_NAMES[DT.dowISO(iso)];
}

function drawNav() {
  const bar = $('#tabbar');
  clear(bar);
  const active = (location.hash.replace('#/', '') || 'today').split('?')[0];
  for (const item of NAV) {
    bar.append(el('a', {
      class: 'tab' + (item.key === active || (active in ROUTES && subTabOf(active) === item.key) ? ' on' : ''),
      href: '#/' + item.key,
      onclick: () => { closeAllSheets(); if (item.key === active) route(); },
    }, el('span', { class: 'tab-icon', text: item.icon }), el('span', { class: 'tab-label', text: item.label })));
  }
}

const SUB = { notes: 'more', contacts: 'more', dates: 'more', settings: 'more', reports: 'more' };
const subTabOf = (key) => SUB[key] || key;

async function route() {
  closeAllSheets();
  const key = (location.hash.replace('#/', '') || 'today').split('?')[0];
  const def = ROUTES[key] || ROUTES.today;
  currentRoute = key;
  $('#page-title').textContent = def.title;
  clear($('#top-actions'));
  const view = $('#view');
  clear(view);
  view.append(spinner());
  drawNav();
  try {
    const node = await def.render({ actions: $('#top-actions'), refresh: route });
    clear(view);
    view.append(node);
    view.scrollTo({ top: 0 });
  } catch (e) {
    if (e.status === 401) return boot();
    clear(view);
    view.append(el('div', { class: 'error-box', text: e.message }));
  }
}

/** بازخوانی صفحهٔ جاری */
export function refresh() { route(); }

/* ---------------------------------------------------------- Service Worker */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch { /* بی‌اهمیت */ }
}

/* ------------------------------------------------------------------- شروع */

export async function boot() {
  try {
    const config = await api.config();
    state.settings.app_name = config.app_name;
    if (!config.configured) return authScreen('setup', config);
    try {
      await startApp();
    } catch (e) {
      if (e.status === 401 || e.status === 428) authScreen('login', config);
      else throw e;
    }
  } catch (e) {
    $('#app').replaceChildren(el('div', { class: 'error-box' },
      el('p', { text: 'ارتباط با سرور برقرار نشد.' }),
      el('p', { class: 'dim', text: e.message }),
      btn('تلاش دوباره', 'primary', () => location.reload()),
    ));
  }
}

boot();
