/**
 * اجزای رابط کاربری: پنجره، پیام، تقویم شمسی، ورودی برچسب، خودکامل‌کننده
 */
import * as J from '../lib/jalali.js';
import { fa } from './core.js';

/* ============================================================== ابزار DOM */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ================================================================ اعلان‌ها */

let toastHost;
export function toast(message, type = 'ok', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const icons = { ok: '✓', error: '✕', warn: '!', info: 'i' };
  const node = el('div', { class: `toast toast--${type}` },
    el('span', { class: 'strong' }, icons[type] || ''),
    el('span', {}, message));
  toastHost.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, ms);
}

/* ================================================================= پنجره */

const modalStack = [];

/**
 * باز کردن پنجره
 * @returns {{close: Function, root: HTMLElement, body: HTMLElement}}
 */
export function modal({ title, body, footer, size = '', onClose, closeOnBackdrop = true }) {
  const bodyNode = el('div', { class: 'modal__body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.append(body);

  const closeBtn = el('button', { class: 'btn btn--ghost btn--icon', title: 'بستن (Esc)' }, '✕');
  const head = el('div', { class: 'modal__head' },
    el('h2', { class: 'modal__title' }, title || ''), closeBtn);

  const dialog = el('div', { class: `modal ${size}` }, head, bodyNode);
  if (footer) {
    const foot = el('div', { class: 'modal__foot' });
    if (typeof footer === 'string') foot.innerHTML = footer;
    else foot.append(...[].concat(footer));
    dialog.append(foot);
  }

  const overlay = el('div', { class: 'overlay' }, dialog);

  const close = (result) => {
    const idx = modalStack.indexOf(handle);
    if (idx > -1) modalStack.splice(idx, 1);
    overlay.remove();
    if (!modalStack.length) document.body.style.overflow = '';
    onClose?.(result);
  };

  const handle = { close, root: overlay, body: bodyNode, dialog };
  closeBtn.addEventListener('click', () => close());
  if (closeOnBackdrop) {
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  }
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  modalStack.push(handle);
  setTimeout(() => {
    const focusable = dialog.querySelector('input:not([type=hidden]), textarea, select, button.btn--primary');
    focusable?.focus();
  }, 40);
  return handle;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    const top = modalStack[modalStack.length - 1];
    if (!top.root.querySelector('.datepicker')) top.close();
    else top.root.querySelectorAll('.datepicker').forEach((d) => d.remove());
  }
});

/** پرسش تأیید */
export function confirmDialog({ title = 'تأیید', message, confirmText = 'تأیید', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const ok = el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}` }, confirmText);
    const cancel = el('button', { class: 'btn' }, 'انصراف');
    const m = modal({
      title, size: 'modal--narrow',
      body: el('div', { class: 'stack' }, el('div', { html: message })),
      footer: [cancel, ok],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
    ok.addEventListener('click', () => { done = true; m.close(); resolve(true); });
    cancel.addEventListener('click', () => { done = true; m.close(); resolve(false); });
    setTimeout(() => ok.focus(), 50);
  });
}

/** پرسش یک مقدار متنی */
export function promptDialog({ title, label, value = '', placeholder = '', multiline = false }) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline
      ? el('textarea', { class: 'textarea', placeholder })
      : el('input', { class: 'input', placeholder });
    input.value = value;
    const ok = el('button', { class: 'btn btn--primary' }, 'ثبت');
    const cancel = el('button', { class: 'btn' }, 'انصراف');
    const m = modal({
      title, size: 'modal--narrow',
      body: el('div', { class: 'field' }, el('label', { class: 'field__label' }, label || ''), input),
      footer: [cancel, ok],
      onClose: () => { if (!done) { done = true; resolve(null); } },
    });
    const submit = () => { done = true; m.close(); resolve(input.value.trim() || null); };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => { done = true; m.close(); resolve(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) submit(); });
  });
}

/* =========================================================== تقویم شمسی */

/**
 * ورودی تاریخ شمسی با تقویم بازشو
 * @returns {HTMLElement} عنصری که مقدارش با .value خوانده/نوشته می‌شود
 */
export function jalaliInput({ value = '', placeholder = 'مثال: ۱۳۵۸/۰۳/۱۲', name = '', onChange } = {}) {
  const input = el('input', {
    class: 'input', placeholder, name,
    autocomplete: 'off', inputmode: 'numeric',
  });
  input.value = value ? fa(value) : '';

  const wrap = el('div', { class: 'datepicker-wrap' }, input);
  let picker = null;

  Object.defineProperty(wrap, 'value', {
    get() {
      const parsed = J.parseJalali(input.value);
      return parsed ? J.formatJalali(parsed.jy, parsed.jm, parsed.jd) : '';
    },
    set(v) { input.value = v ? fa(v) : ''; },
  });

  const closePicker = () => { picker?.remove(); picker = null; };

  const openPicker = () => {
    if (picker) return;
    const parsed = J.parseJalali(input.value) || J.dateToJalali(new Date());
    picker = buildCalendar(parsed, (chosen) => {
      input.value = fa(chosen);
      closePicker();
      onChange?.(chosen);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, closePicker);
    wrap.append(picker);
  };

  input.addEventListener('focus', openPicker);
  input.addEventListener('click', openPicker);
  input.addEventListener('input', () => {
    // اجازهٔ تایپ آزاد؛ اعتبارسنجی هنگام خروج
    input.classList.remove('is-invalid');
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (picker && picker.contains(document.activeElement)) return;
      const raw = input.value.trim();
      if (!raw) return;
      const parsed = J.parseJalali(raw);
      if (parsed) {
        input.value = fa(J.formatJalali(parsed.jy, parsed.jm, parsed.jd));
        input.style.borderColor = '';
        onChange?.(wrap.value);
      } else {
        input.style.borderColor = 'var(--danger)';
        toast('تاریخ وارد شده معتبر نیست. نمونهٔ درست: ۱۳۵۸/۰۳/۱۲', 'warn');
      }
    }, 150);
  });

  document.addEventListener('mousedown', (e) => {
    if (picker && !wrap.contains(e.target)) closePicker();
  });

  return wrap;
}

function buildCalendar(initial, onPick, onClose) {
  const root = el('div', { class: 'datepicker' });
  let view = { jy: initial.jy, jm: initial.jm };
  let mode = 'days';
  const today = J.dateToJalali(new Date());
  const selected = initial;

  const render = () => {
    root.innerHTML = '';
    const prev = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '›');
    const next = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '‹');
    const label = el('div', { class: 'datepicker__label' },
      mode === 'days' ? `${J.MONTH_NAMES[view.jm - 1]} ${fa(view.jy)}`
        : mode === 'months' ? fa(view.jy) : 'انتخاب سال');

    label.addEventListener('click', () => {
      mode = mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days';
      render();
    });
    prev.addEventListener('click', () => { step(-1); });
    next.addEventListener('click', () => { step(1); });
    root.append(el('div', { class: 'datepicker__head' }, next, label, prev));

    if (mode === 'days') renderDays();
    else if (mode === 'months') renderMonths();
    else renderYears();

    const todayBtn = el('button', { class: 'btn btn--sm btn--block', type: 'button' }, 'امروز');
    todayBtn.addEventListener('click', () => onPick(J.formatJalali(today.jy, today.jm, today.jd)));
    const clearBtn = el('button', { class: 'btn btn--sm btn--block', type: 'button' }, 'خالی');
    clearBtn.addEventListener('click', () => onPick(''));
    root.append(el('div', { class: 'datepicker__foot' }, todayBtn, clearBtn));
  };

  const step = (dir) => {
    if (mode === 'days') {
      view.jm += dir;
      if (view.jm > 12) { view.jm = 1; view.jy++; }
      if (view.jm < 1) { view.jm = 12; view.jy--; }
    } else if (mode === 'months') view.jy += dir;
    else view.jy += dir * 12;
    render();
  };

  const renderDays = () => {
    const grid = el('div', { class: 'datepicker__grid' });
    for (const d of J.WEEKDAY_SHORT) grid.append(el('div', { class: 'datepicker__dow' }, d));
    const firstDow = J.jalaliWeekdayIndex(view.jy, view.jm, 1);
    for (let i = 0; i < firstDow; i++) grid.append(el('div', { class: 'datepicker__day is-empty' }));
    const len = J.jalaliMonthLength(view.jy, view.jm);
    for (let d = 1; d <= len; d++) {
      const isToday = today.jy === view.jy && today.jm === view.jm && today.jd === d;
      const isSel = selected.jy === view.jy && selected.jm === view.jm && selected.jd === d;
      const isFri = (firstDow + d - 1) % 7 === 6;
      const btn = el('button', {
        class: `datepicker__day${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}${isFri ? ' is-friday' : ''}`,
        type: 'button',
      }, fa(d));
      btn.addEventListener('click', () => onPick(J.formatJalali(view.jy, view.jm, d)));
      grid.append(btn);
    }
    root.append(grid);
  };

  const renderMonths = () => {
    const grid = el('div', { class: 'datepicker__months' });
    J.MONTH_NAMES.forEach((nm, i) => {
      const b = el('button', { class: 'datepicker__month', type: 'button' }, nm);
      b.addEventListener('click', () => { view.jm = i + 1; mode = 'days'; render(); });
      grid.append(b);
    });
    root.append(grid);
  };

  const renderYears = () => {
    const grid = el('div', { class: 'datepicker__years' });
    const start = view.jy - 60;
    for (let y = start; y <= view.jy + 12; y++) {
      const b = el('button', { class: 'datepicker__year', type: 'button' }, fa(y));
      b.addEventListener('click', () => { view.jy = y; mode = 'months'; render(); });
      grid.append(b);
    }
    root.append(grid);
    setTimeout(() => grid.querySelectorAll('.datepicker__year')[60]?.scrollIntoView({ block: 'center' }), 10);
  };

  render();
  return root;
}

/* ============================================================ ورودی برچسب */

/** ورودی چند-برچسبی با پیشنهاد خودکار */
export function tagInput({ value = [], suggestions = [], placeholder = 'برچسب را بنویسید و Enter بزنید' } = {}) {
  let tags = [...new Set(value.filter(Boolean))];
  const chips = el('div', { class: 'row row--tight' });
  const input = el('input', { class: 'input input--sm', placeholder, style: { flex: '1', minWidth: '150px' } });
  const listBox = el('div', { class: 'autocomplete__list hidden' });

  const wrap = el('div', { class: 'autocomplete' },
    el('div', { class: 'row row--tight', style: { alignItems: 'center' } }, chips, input), listBox);

  Object.defineProperty(wrap, 'value', {
    get: () => [...tags],
    set: (v) => { tags = [...new Set((v || []).filter(Boolean))]; renderChips(); },
  });

  function renderChips() {
    chips.innerHTML = '';
    for (const t of tags) {
      const x = el('button', { class: 'chip__x', type: 'button', title: 'حذف' }, '×');
      x.addEventListener('click', () => { tags = tags.filter((v) => v !== t); renderChips(); });
      chips.append(el('span', { class: 'chip chip--removable' }, t, x));
    }
  }

  function addTag(name) {
    const clean = String(name || '').trim().replace(/[،,]+$/, '');
    if (!clean || tags.includes(clean)) { input.value = ''; return; }
    tags.push(clean); renderChips(); input.value = ''; hideList();
  }

  const hideList = () => listBox.classList.add('hidden');

  function showSuggestions() {
    const q = input.value.trim().toLowerCase();
    const matches = suggestions
      .filter((s) => !tags.includes(s))
      .filter((s) => !q || s.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) return hideList();
    listBox.innerHTML = '';
    for (const s of matches) {
      const item = el('div', { class: 'autocomplete__item' }, s);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); addTag(s); });
      listBox.append(item);
    }
    listBox.classList.remove('hidden');
  }

  input.addEventListener('input', showSuggestions);
  input.addEventListener('focus', showSuggestions);
  input.addEventListener('blur', () => setTimeout(hideList, 160));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '،') { e.preventDefault(); addTag(input.value); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); renderChips(); }
  });

  renderChips();
  return wrap;
}

/* ======================================================== خودکامل‌کننده متنی */

/** ورودی متنی با پیشنهاد از مقادیر موجود (مانند نام مجموعه، مناسبت، شهر) */
export function suggestInput({ value = '', suggestions = [], placeholder = '', name = '' } = {}) {
  const input = el('input', { class: 'input', placeholder, name, autocomplete: 'off' });
  input.value = value || '';
  const listBox = el('div', { class: 'autocomplete__list hidden' });
  const wrap = el('div', { class: 'autocomplete' }, input, listBox);

  Object.defineProperty(wrap, 'value', {
    get: () => input.value.trim(),
    set: (v) => { input.value = v || ''; },
  });

  const hide = () => listBox.classList.add('hidden');
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const matches = suggestions.filter((s) => s && (!q || String(s).toLowerCase().includes(q))).slice(0, 10);
    if (!matches.length) return hide();
    listBox.innerHTML = '';
    for (const s of matches) {
      const item = el('div', { class: 'autocomplete__item' }, s);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = s; hide(); });
      listBox.append(item);
    }
    listBox.classList.remove('hidden');
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(hide, 160));
  return wrap;
}

/* ============================================================ امتیاز ستاره */

export function starInput({ value = 0 } = {}) {
  let rating = Number(value) || 0;
  const wrap = el('div', { class: 'stars stars--input' });
  Object.defineProperty(wrap, 'value', {
    get: () => rating,
    set: (v) => { rating = Number(v) || 0; render(); },
  });
  function render() {
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const s = el('span', { class: 'star', title: `${i} از ۵` }, i <= rating ? '★' : '☆');
      s.addEventListener('click', () => { rating = (rating === i ? 0 : i); render(); });
      wrap.append(s);
    }
  }
  render();
  return wrap;
}

export function stars(n) {
  const v = Number(n) || 0;
  return v ? `<span class="stars" title="${v} از ۵">${'★'.repeat(v)}${'☆'.repeat(5 - v)}</span>` : '<span class="muted">—</span>';
}

/* ================================================================ سایر */

export function emptyState({ icon = '📁', title, text, action }) {
  const node = el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon),
    el('div', { class: 'empty__title' }, title || ''),
    text ? el('div', { class: 'empty__text' }, text) : null);
  if (action) node.append(action);
  return node;
}

export function loading(text = 'در حال بارگذاری…') {
  return el('div', { class: 'loading' }, el('div', { class: 'spinner' }), el('span', {}, text));
}

/** نوار نمودار افقی */
export function barChart(rows, { labelKey = 'key', valueKey = 'count', max = null } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  const wrap = el('div', { class: 'bars' });
  for (const r of rows) {
    const v = Number(r[valueKey]) || 0;
    wrap.append(el('div', { class: 'bar-row' },
      el('div', { class: 'bar-row__label', title: r[labelKey] }, r[labelKey] || '—'),
      el('div', { class: 'bar-row__track' },
        el('div', { class: 'bar-row__fill', style: { width: `${(v / top) * 100}%` } })),
      el('div', { class: 'bar-row__value' }, fa(v))));
  }
  return wrap;
}

/** فیلد فرم آماده */
export function field(label, control, { hint, wide = false, required = false } = {}) {
  return el('div', { class: `field${wide ? ' field--wide' : ''}` },
    el('label', { class: 'field__label' }, label, required ? el('span', { class: 'req' }, '*') : null),
    control,
    hint ? el('div', { class: 'field__hint' }, hint) : null);
}

/** ساخت <select> از یک شیء یا آرایه */
export function select({ options, value, placeholder, name, onChange }) {
  const s = el('select', { class: 'select', name });
  if (placeholder !== undefined) s.append(el('option', { value: '' }, placeholder));
  const list = Array.isArray(options)
    ? options
    : Object.entries(options).map(([k, v]) => ({ value: k, label: typeof v === 'string' ? v : v.label }));
  for (const o of list) {
    const opt = el('option', { value: o.value ?? o.id }, o.label ?? o.name);
    s.append(opt);
  }
  s.value = value == null ? '' : String(value);
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}
