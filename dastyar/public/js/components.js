/**
 * اجزای رابط کاربری: فیلدهای فرم، تقویم شمسی، انتخابگرها
 */
import { el, fa, en, sheet, J, DT, parseMoney, money } from './core.js';

/* ------------------------------------------------------------ فیلد ساده */

/**
 * یک فیلد فرم با برچسب.
 * توجه: برای ورودی‌های متنی از <label> استفاده می‌شود تا کلیک روی برچسب،
 * ورودی را فعال کند؛ ولی برای دکمه‌های انتخابی (chips) از <div> استفاده می‌کنیم،
 * چون مرورگر کلیک داخل <label> را به «اولین دکمهٔ» آن هم می‌فرستد و
 * این باعث می‌شد انتخاب کاربر به گزینهٔ اول برگردد.
 */
const FORM_CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function field(label, control, hint) {
  const isSimple = FORM_CONTROLS.has(control?.tagName);
  return el(isSimple ? 'label' : 'div', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    control,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  );
}

export function input(attrs = {}) {
  return el('input', { class: 'input', type: 'text', ...attrs });
}

export function textarea(attrs = {}) {
  return el('textarea', { class: 'input area', rows: 3, ...attrs });
}

export function select(options, value, attrs = {}) {
  const node = el('select', { class: 'input', ...attrs });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    node.append(opt);
  }
  return node;
}

/** ورودی مبلغ با جداکنندهٔ خودکار و ارقام فارسی */
export function moneyInput(value = 0, attrs = {}) {
  const node = el('input', {
    class: 'input money', type: 'text', inputmode: 'numeric',
    value: value ? fa(Number(value).toLocaleString('en-US')) : '',
    placeholder: '۰', ...attrs,
  });
  node.addEventListener('input', () => {
    const n = parseMoney(node.value);
    node.value = n ? fa(n.toLocaleString('en-US')) : '';
  });
  Object.defineProperty(node, 'amount', { get: () => parseMoney(node.value) });
  return node;
}

/** دکمه‌های انتخاب یکی از چند گزینه */
export function chips(options, value, onChange) {
  const wrap = el('div', { class: 'chips' });
  const render = (v) => {
    wrap.replaceChildren(...options.map((o) => el('button', {
      type: 'button',
      class: 'chip' + (String(o.value) === String(v) ? ' on' : ''),
      onclick: (e) => {
        e.preventDefault(); e.stopPropagation();
        wrap.value = o.value; render(o.value); onChange?.(o.value);
      },
    }, o.icon ? el('span', { class: 'chip-icon', text: o.icon }) : null, o.label)));
  };
  wrap.value = value;
  render(value);
  return wrap;
}

/** انتخاب چند روز هفته */
export function weekdayPicker(valueCsv = '') {
  const chosen = new Set(String(valueCsv || '').split(',').filter((s) => s !== '').map(Number));
  const wrap = el('div', { class: 'chips weekdays' });
  J.WEEKDAY_SHORT.forEach((name, i) => {
    const b = el('button', {
      type: 'button', class: 'chip small' + (chosen.has(i) ? ' on' : ''), text: name,
      onclick: (e) => {
        e.preventDefault(); e.stopPropagation();
        if (chosen.has(i)) chosen.delete(i); else chosen.add(i);
        b.classList.toggle('on');
        wrap.value = Array.from(chosen).sort().join(',');
      },
    });
    wrap.append(b);
  });
  wrap.value = Array.from(chosen).sort().join(',');
  return wrap;
}

/* --------------------------------------------------------- تقویم شمسی */

/** تقویم ماهانهٔ شمسی؛ روی انتخاب روز، تابع onPick با تاریخ ISO صدا زده می‌شود */
export function calendar(selectedISO, onPick) {
  const today = DT.todayISO();
  const start = DT.isoToJalali(selectedISO || today) || DT.isoToJalali(today);
  let jy = start.jy, jm = start.jm;

  const wrap = el('div', { class: 'cal' });

  const draw = () => {
    const len = J.jalaliMonthLength(jy, jm);
    const firstISO = DT.jalaliToISO(jy, jm, 1);
    const firstDow = DT.dowISO(firstISO);

    const head = el('div', { class: 'cal-head' },
      el('button', { class: 'btn ghost small', type: 'button', text: 'ماه قبل',
        onclick: () => { jm -= 1; if (jm < 1) { jm = 12; jy -= 1; } draw(); } }),
      el('div', { class: 'cal-title', text: `${J.MONTH_NAMES[jm - 1]} ${fa(jy)}` }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'ماه بعد',
        onclick: () => { jm += 1; if (jm > 12) { jm = 1; jy += 1; } draw(); } }),
    );

    const grid = el('div', { class: 'cal-grid' });
    for (const w of J.WEEKDAY_SHORT) grid.append(el('div', { class: 'cal-dow', text: w }));
    for (let i = 0; i < firstDow; i += 1) grid.append(el('div', {}));
    for (let d = 1; d <= len; d += 1) {
      const iso = DT.jalaliToISO(jy, jm, d);
      const cls = ['cal-day'];
      if (iso === today) cls.push('today');
      if (iso === selectedISO) cls.push('sel');
      if (DT.dowISO(iso) === 6) cls.push('holiday');
      grid.append(el('button', {
        type: 'button', class: cls.join(' '), text: fa(d),
        onclick: () => onPick(iso),
      }));
    }
    wrap.replaceChildren(head, grid);
  };
  draw();
  return wrap;
}

/** دکمهٔ انتخاب تاریخ؛ مقدار در خصوصیت value به صورت ISO نگه داشته می‌شود */
export function dateField(valueISO = '', { allowEmpty = true, quick = true } = {}) {
  const btn = el('button', { type: 'button', class: 'input picker' });
  const holder = { value: valueISO || '' };

  const label = () => {
    btn.textContent = holder.value ? DT.formatISOLong(holder.value) : 'انتخاب تاریخ';
    btn.classList.toggle('empty', !holder.value);
  };

  btn.onclick = () => {
    const today = DT.todayISO();
    const body = el('div', {});
    const s = sheet('انتخاب تاریخ', body, []);
    const pick = (iso) => { holder.value = iso; label(); s.close(); };

    const quickRow = el('div', { class: 'chips wrap' },
      quick ? [
        el('button', { type: 'button', class: 'chip', text: 'امروز', onclick: () => pick(today) }),
        el('button', { type: 'button', class: 'chip', text: 'فردا', onclick: () => pick(DT.addDaysISO(today, 1)) }),
        el('button', { type: 'button', class: 'chip', text: 'هفتهٔ دیگر', onclick: () => pick(DT.addDaysISO(today, 7)) }),
        el('button', { type: 'button', class: 'chip', text: 'ماه دیگر', onclick: () => pick(DT.addJalaliMonths(today, 1)) }),
        allowEmpty ? el('button', { type: 'button', class: 'chip ghost', text: 'بدون تاریخ', onclick: () => pick('') }) : null,
      ] : null,
    );
    body.append(quickRow, calendar(holder.value || today, pick));
  };

  label();
  Object.defineProperty(btn, 'value', {
    get: () => holder.value,
    set: (v) => { holder.value = v || ''; label(); },
  });
  return btn;
}

/** انتخاب ساعت */
export function timeField(value = '') {
  const node = el('input', { class: 'input', type: 'time', value: value || '' });
  return node;
}

/* ---------------------------------------------------------- کارت و ردیف */

export function row(opts) {
  const { icon, title, subtitle, meta, badge, onClick, actions, className = '' } = opts;
  return el('div', { class: 'row ' + className, onclick: onClick },
    icon ? el('div', { class: 'row-icon', text: icon }) : null,
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, title, badge ? el('span', { class: 'badge ' + (badge.kind || ''), text: badge.text }) : null),
      subtitle ? el('div', { class: 'row-sub', text: subtitle }) : null,
    ),
    meta ? el('div', { class: 'row-meta' }, meta) : null,
    actions ? el('div', { class: 'row-actions' }, actions) : null,
  );
}

export function sectionTitle(text, extra) {
  return el('div', { class: 'section-title' }, el('h2', { text }), extra || null);
}

export function statCard(label, value, sub, kind = '') {
  return el('div', { class: 'stat ' + kind },
    el('div', { class: 'stat-value', text: value }),
    el('div', { class: 'stat-label', text: label }),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null,
  );
}

export function fab(onClick, label = 'افزودن') {
  return el('button', { class: 'fab', onclick: onClick, 'aria-label': label }, '+');
}

export const btn = (text, kind = '', onclick) =>
  el('button', { type: 'button', class: 'btn ' + kind, onclick }, text);

/** نوار جست‌وجو */
export function searchBar(placeholder, onInput) {
  const node = input({ placeholder, type: 'search', class: 'input search' });
  let t = null;
  node.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onInput(node.value), 120);
  });
  return el('div', { class: 'search-wrap' }, el('span', { class: 'search-icon', text: '⌕' }), node);
}
