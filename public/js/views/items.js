/** فهرست آرشیو — جست‌وجو، پالایه، مرتب‌سازی و عملیات گروهی */
import {
  api, state, num, fa, duration, hms, jdate, highlight, escapeHtml, debounce,
  MEDIA_KINDS, QUALITIES, categoryOptions, savePref,
} from '../core.js';
import { el, toast, confirmDialog, emptyState, loading, stars, select, modal, tagInput } from '../components.js';
import { go, currentQuery } from '../app.js';
import { openItemForm } from './item-form.js';
import { openBulkAdd } from './bulk-add.js';

let lastResult = null;

export async function renderItems(root, params = {}) {
  // آدرس صفحه تنها مرجع پالایه‌هاست؛ اگر پالایه‌های قبلی را با state ادغام کنیم،
  // پاک کردن کادر جست‌وجو نتیجه را پاک نمی‌کند و پالایه‌ها «چسبنده» می‌شوند.
  const f = { ...params };
  f.page = Number(params.page) || 1;
  f.per_page = Number(params.per_page) || Number(state.settings.per_page) || 25;
  f.sort = params.sort || 'newest';
  state.itemFilters = f;

  root.innerHTML = '';

  const head = el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, f.archived ? 'بایگانی (حذف‌شده‌ها)' : 'آرشیو'),
      el('div', { class: 'page-subtitle', id: 'items-summary' }, 'در حال شمارش…')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn', onclick: () => exportCsv(f) }, '⤓ خروجی اکسل'),
      el('button', { class: 'btn', onclick: () => window.print() }, '🖨 چاپ'),
      el('button', { class: 'btn', onclick: () => openBulkAdd(() => renderItems(root, params)) }, '⊞ افزودن گروهی'),
      el('button', { class: 'btn btn--primary', onclick: () => openItemForm(null, () => renderItems(root, params)) }, '＋ رکورد تازه')));
  root.append(head);

  root.append(buildFilterBar(f, root, params));

  const toolbar = el('div', { class: 'toolbar', id: 'items-toolbar' });
  root.append(toolbar);

  const listHost = el('div', { id: 'items-host' });
  root.append(listHost);
  listHost.append(loading());

  let data;
  try { data = await api.items(cleanFilters(f)); }
  catch (e) { listHost.innerHTML = ''; listHost.append(emptyState({ icon: '⚠️', title: 'خطا در دریافت اطلاعات', text: e.message })); return; }

  lastResult = data;
  document.getElementById('items-summary').textContent =
    data.total ? `${num(data.total)} رکورد یافت شد` : 'رکوردی یافت نشد';

  renderToolbar(toolbar, f, data, root, params);
  renderList(listHost, data, f, root, params);
}

/* ---------------------------------------------------------------- پالایه */

function buildFilterBar(f, root, params) {
  const panel = el('div', { class: 'filter-panel' });
  const isOpen = state.settings.filters_open !== false;

  const quickRow = el('div', { class: 'row' });

  const searchInput = el('input', {
    class: 'input', placeholder: 'جست‌وجو در همهٔ اطلاعات… (نام، موضوع، مسیر فایل، هارد، برچسب)',
    value: f.q || '', style: { flex: '1', minWidth: '220px' },
  });
  searchInput.addEventListener('input', debounce(() => {
    apply(root, params, { q: searchInput.value, page: 1 });
  }, 350));
  quickRow.append(searchInput);

  const sortSel = select({
    options: [
      { value: 'newest', label: 'تازه‌ترین ثبت' },
      { value: 'oldest', label: 'قدیمی‌ترین ثبت' },
      { value: 'updated', label: 'آخرین ویرایش' },
      { value: 'title', label: 'عنوان (الفبا)' },
      { value: 'code', label: 'کد آرشیو' },
      { value: 'date_desc', label: 'تاریخ ایراد (جدید به قدیم)' },
      { value: 'date_asc', label: 'تاریخ ایراد (قدیم به جدید)' },
      { value: 'series', label: 'مجموعه و شمارهٔ جلسه' },
      { value: 'duration', label: 'بلندترین' },
      { value: 'rating', label: 'بیشترین امتیاز' },
    ],
    value: f.sort,
    onChange: (v) => apply(root, params, { sort: v, page: 1 }),
  });
  sortSel.style.maxWidth = '210px';
  quickRow.append(sortSel);

  const toggleBtn = el('button', { class: 'btn' }, isOpen ? 'پالایهٔ پیشرفته ▲' : 'پالایهٔ پیشرفته ▼');
  quickRow.append(toggleBtn);

  const activeCount = countActiveFilters(f);
  if (activeCount) {
    const clear = el('button', { class: 'btn btn--ghost' }, `پاک کردن پالایه‌ها (${fa(activeCount)})`);
    clear.addEventListener('click', () => {
      go('items', { sort: f.sort });
    });
    quickRow.append(clear);
  }

  panel.append(quickRow);

  const advanced = el('div', { class: 'form-grid', style: { marginTop: '14px' } });
  advanced.hidden = !isOpen;
  toggleBtn.addEventListener('click', () => {
    advanced.hidden = !advanced.hidden;
    toggleBtn.textContent = advanced.hidden ? 'پالایهٔ پیشرفته ▼' : 'پالایهٔ پیشرفته ▲';
    savePref('filters_open', !advanced.hidden);
  });

  const addField = (label, control) => advanced.append(
    el('div', { class: 'field' }, el('label', { class: 'field__label' }, label), control));

  addField('نوع رسانه', select({
    options: MEDIA_KINDS, value: f.media_kind, placeholder: 'همه',
    onChange: (v) => apply(root, params, { media_kind: v, page: 1 }),
  }));

  addField('دسته‌بندی', select({
    options: categoryOptions().map((c) => ({ value: c.id, label: c.label })),
    value: f.category_id, placeholder: 'همهٔ دسته‌ها',
    onChange: (v) => apply(root, params, { category_id: v, page: 1 }),
  }));

  addField('حافظه / هارد', select({
    options: state.drives.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
    value: f.drive_id, placeholder: 'همهٔ هاردها',
    onChange: (v) => apply(root, params, { drive_id: v, page: 1 }),
  }));

  addField('سخنران / گوینده', select({
    options: state.speakers.map((s) => ({ value: s.id, label: s.name })),
    value: f.speaker_id, placeholder: 'همه',
    onChange: (v) => apply(root, params, { speaker_id: v, page: 1 }),
  }));

  addField('برچسب', select({
    options: state.tags.map((t) => ({ value: t.id, label: `${t.name} (${t.item_count})` })),
    value: f.tag_id, placeholder: 'همه',
    onChange: (v) => apply(root, params, { tag_id: v, page: 1 }),
  }));

  addField('مجموعه / سلسله جلسات', select({
    options: (state.facets.series || []).map((s) => ({ value: s, label: s })),
    value: f.series, placeholder: 'همه',
    onChange: (v) => apply(root, params, { series: v, page: 1 }),
  }));

  addField('مناسبت', select({
    options: (state.facets.occasions || []).map((s) => ({ value: s, label: s })),
    value: f.occasion, placeholder: 'همه',
    onChange: (v) => apply(root, params, { occasion: v, page: 1 }),
  }));

  addField('کیفیت', select({
    options: QUALITIES, value: f.quality, placeholder: 'همه',
    onChange: (v) => apply(root, params, { quality: v, page: 1 }),
  }));

  addField('سال ایراد (شمسی)', select({
    options: (state.facets.years || []).map((y) => ({ value: y, label: fa(y) })),
    value: f.year, placeholder: 'همه',
    onChange: (v) => apply(root, params, { year: v, page: 1 }),
  }));

  // بازهٔ تاریخ
  const from = el('input', { class: 'input input--sm', placeholder: 'از ۱۳۵۰/۰۱/۰۱', value: f.date_from ? fa(f.date_from) : '' });
  const to = el('input', { class: 'input input--sm', placeholder: 'تا ۱۳۶۰/۱۲/۲۹', value: f.date_to ? fa(f.date_to) : '' });
  const applyRange = debounce(() => apply(root, params, {
    date_from: from.value.trim(), date_to: to.value.trim(), page: 1,
  }), 600);
  from.addEventListener('input', applyRange);
  to.addEventListener('input', applyRange);
  addField('بازهٔ تاریخ ایراد', el('div', { class: 'row row--tight' }, from, to));

  addField('وضعیت', select({
    options: [
      { value: '', label: 'همه' },
      { value: 'verified', label: 'تأیید شده' },
      { value: 'unverified', label: 'تأیید نشده' },
      { value: 'defect', label: 'دارای نقص' },
      { value: 'no_copies', label: 'بدون فایل ثبت‌شده' },
      { value: 'single_copy', label: 'فقط یک نسخه (بدون پشتیبان)' },
      { value: 'bad_copies', label: 'دارای نسخهٔ خراب/مفقود' },
      { value: 'favorite', label: 'نشان‌شده‌ها' },
      { value: 'published', label: 'منتشر شده' },
    ],
    value: statusValue(f), placeholder: undefined,
    onChange: (v) => apply(root, params, { ...clearStatus(), ...statusPatch(v), page: 1 }),
  }));

  panel.append(advanced);
  return panel;
}

const STATUS_KEYS = ['verified', 'has_defect', 'no_copies', 'single_copy', 'bad_copies', 'is_favorite', 'published'];
const clearStatus = () => Object.fromEntries(STATUS_KEYS.map((k) => [k, '']));

function statusPatch(v) {
  switch (v) {
    case 'verified': return { verified: '1' };
    case 'unverified': return { verified: '0' };
    case 'defect': return { has_defect: '1' };
    case 'no_copies': return { no_copies: '1' };
    case 'single_copy': return { single_copy: '1' };
    case 'bad_copies': return { bad_copies: '1' };
    case 'favorite': return { is_favorite: '1' };
    case 'published': return { published: '1' };
    default: return {};
  }
}

function statusValue(f) {
  if (f.verified === '1') return 'verified';
  if (f.verified === '0') return 'unverified';
  if (f.has_defect === '1') return 'defect';
  if (f.no_copies === '1') return 'no_copies';
  if (f.single_copy === '1') return 'single_copy';
  if (f.bad_copies === '1') return 'bad_copies';
  if (f.is_favorite === '1') return 'favorite';
  if (f.published === '1') return 'published';
  return '';
}

function countActiveFilters(f) {
  const keys = ['q', 'media_kind', 'category_id', 'drive_id', 'speaker_id', 'tag_id', 'series',
    'occasion', 'quality', 'year', 'date_from', 'date_to', ...STATUS_KEYS];
  return keys.filter((k) => f[k] !== undefined && f[k] !== '' && f[k] !== null).length;
}

function cleanFilters(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function apply(root, params, patch) {
  const next = { ...currentQuery(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === '' || next[k] == null) delete next[k];
  go('items', next, { replace: true });
}

/* ---------------------------------------------------------------- نوار ابزار */

function renderToolbar(toolbar, f, data, root, params) {
  toolbar.innerHTML = '';
  const selected = state.selection;

  const allBox = el('input', { type: 'checkbox', title: 'انتخاب همهٔ این صفحه' });
  allBox.checked = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  allBox.addEventListener('change', () => {
    for (const r of data.rows) allBox.checked ? selected.add(r.id) : selected.delete(r.id);
    renderItems(root, params);
  });
  toolbar.append(el('label', { class: 'checkbox' }, allBox, el('span', { class: 'small' }, 'انتخاب صفحه')));

  if (selected.size) {
    toolbar.append(el('span', { class: 'badge badge--brand' }, `${fa(selected.size)} انتخاب شده`));
    toolbar.append(el('button', { class: 'btn btn--sm', onclick: () => openBulkEdit(root, params) }, '✎ ویرایش گروهی'));
    toolbar.append(el('button', {
      class: 'btn btn--sm btn--danger',
      onclick: () => bulkDelete(root, params, f.archived),
    }, f.archived ? '✕ حذف کامل' : '🗑 انتقال به بایگانی'));
    if (f.archived) {
      toolbar.append(el('button', { class: 'btn btn--sm', onclick: () => bulkAction('restore', root, params) }, '↺ بازگردانی'));
    }
    toolbar.append(el('button', {
      class: 'btn btn--sm btn--ghost',
      onclick: () => { selected.clear(); renderItems(root, params); },
    }, 'لغو انتخاب'));
  }

  const spacer = el('div', { class: 'toolbar__spacer' });
  toolbar.append(spacer);

  const viewMode = state.settings.items_view || 'table';
  const group = el('div', { class: 'btn-group' });
  for (const [mode, label] of [['table', '☰ جدول'], ['cards', '▦ کارت']]) {
    const b = el('button', { class: `btn btn--sm${viewMode === mode ? ' is-active' : ''}` }, label);
    b.addEventListener('click', () => { savePref('items_view', mode); renderItems(root, params); });
    group.append(b);
  }
  toolbar.append(group);

  const perPage = select({
    options: [10, 25, 50, 100, 200].map((n) => ({ value: n, label: `${fa(n)} در صفحه` })),
    value: f.per_page,
    onChange: (v) => { savePref('per_page', v); apply(root, params, { per_page: v, page: 1 }); },
  });
  perPage.classList.add('input--sm');
  perPage.style.maxWidth = '130px';
  toolbar.append(perPage);
}

/* ------------------------------------------------------------------ فهرست */

function renderList(host, data, f, root, params) {
  host.innerHTML = '';
  if (!data.rows.length) {
    host.append(emptyState({
      icon: '🔍',
      title: countActiveFilters(f) ? 'با این پالایه‌ها چیزی پیدا نشد' : 'هنوز رکوردی ثبت نشده است',
      text: countActiveFilters(f)
        ? 'می‌توانید پالایه‌ها را پاک کنید یا عبارت دیگری بجویید.'
        : 'برای شروع، نخستین سخنرانی یا فایل خود را ثبت کنید.',
      action: el('button', {
        class: 'btn btn--primary',
        onclick: () => countActiveFilters(f) ? go('items') : openItemForm(null, () => renderItems(root, params)),
      }, countActiveFilters(f) ? 'پاک کردن پالایه‌ها' : '＋ ثبت نخستین رکورد'),
    }));
    return;
  }

  if ((state.settings.items_view || 'table') === 'cards') host.append(cardsView(data, f, root, params));
  else host.append(tableView(data, f, root, params));

  host.append(pagination(data, root, params));
}

function tableView(data, f, root, params) {
  const wrap = el('div', { class: 'card' });
  const table = el('table', { class: 'data' });
  table.innerHTML = `
    <thead><tr>
      <th style="width:1%"></th>
      <th style="width:1%">کد</th>
      <th>عنوان</th>
      <th>دسته‌بندی</th>
      <th>تاریخ ایراد</th>
      <th>مدت</th>
      <th>هاردها</th>
      <th>وضعیت</th>
      <th class="col-actions"></th>
    </tr></thead>`;
  const tbody = el('tbody');

  for (const r of data.rows) {
    const tr = el('tr', { class: state.selection.has(r.id) ? 'is-selected' : '' });

    const cb = el('input', { type: 'checkbox' });
    cb.checked = state.selection.has(r.id);
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      cb.checked ? state.selection.add(r.id) : state.selection.delete(r.id);
      tr.classList.toggle('is-selected', cb.checked);
      renderToolbar(document.getElementById('items-toolbar'), f, data, root, params);
    });
    tr.append(el('td', {}, cb));

    tr.append(el('td', { class: 'muted small num' }, fa(r.code || '—')));

    const titleCell = el('td', {},
      el('div', { class: 'cell-main', html: `${MEDIA_KINDS[r.media_kind]?.icon || ''} ${highlight(r.title, f.q)}` }));
    const subParts = [];
    if (r.series) subParts.push(`${escapeHtml(r.series)}${r.part_no ? ' — جلسهٔ ' + fa(r.part_no) : ''}`);
    if (r.speaker_name) subParts.push(escapeHtml(r.speaker_name));
    if (r.occasion) subParts.push(escapeHtml(r.occasion));
    if (subParts.length) titleCell.append(el('div', { class: 'cell-sub', html: subParts.join(' • ') }));
    if (r.tags?.length) {
      titleCell.append(el('div', { class: 'row row--tight', style: { marginTop: '3px' } },
        ...r.tags.slice(0, 4).map((t) => el('span', { class: 'chip small' },
          t.color ? el('span', { class: 'chip__dot', style: { background: t.color } }) : null, t.name))));
    }
    tr.append(titleCell);

    tr.append(el('td', { class: 'small soft truncate', style: { maxWidth: '170px' }, title: r.category_path || '' },
      r.category_path || '—'));

    tr.append(el('td', { class: 'small num' }, r.speech_date ? fa(r.speech_date) : el('span', { class: 'muted' }, '—')));
    tr.append(el('td', { class: 'small num' }, r.duration_sec ? hms(r.duration_sec) : '—'));

    const drivesCell = el('td', { class: 'row row--tight' });
    if (r.drive_codes) {
      for (const code of String(r.drive_codes).split(',').slice(0, 3)) {
        drivesCell.append(el('span', { class: 'badge badge--brand num' }, fa(code)));
      }
    } else drivesCell.append(el('span', { class: 'badge badge--danger' }, 'بدون فایل'));
    tr.append(drivesCell);

    const statusCell = el('td', { class: 'row row--tight' });
    if (r.verified) statusCell.append(el('span', { class: 'badge badge--ok', title: 'تأیید شده' }, '✓'));
    if (r.needs_work) statusCell.append(el('span', { class: 'badge badge--warn', title: 'نیازمند رسیدگی' }, 'نقص'));
    if (r.bad_copy_count) statusCell.append(el('span', { class: 'badge badge--danger', title: 'نسخهٔ خراب/مفقود' }, '⚠'));
    if (r.is_favorite) statusCell.append(el('span', { class: 'badge badge--accent', title: 'نشان‌شده' }, '★'));
    if (r.quality && r.quality !== 'unknown') {
      statusCell.append(el('span', { class: `badge ${QUALITIES[r.quality]?.badge || ''}` }, QUALITIES[r.quality]?.label));
    }
    tr.append(statusCell);

    const actions = el('td', { class: 'col-actions row row--tight', style: { justifyContent: 'flex-end' } },
      iconBtn('✎', 'ویرایش', (e) => { e.stopPropagation(); openItemForm(r.id, () => renderItems(root, params)); }),
      iconBtn(f.archived ? '↺' : '🗑', f.archived ? 'بازگردانی' : 'انتقال به بایگانی', async (e) => {
        e.stopPropagation();
        if (f.archived) { await api.restoreItem(r.id); toast('بازگردانی شد'); }
        else {
          if (!await confirmDialog({
            title: 'انتقال به بایگانی',
            message: `«${escapeHtml(r.title)}» به بایگانی منتقل شود؟<br>
              <span class="muted small">فایل روی هارد حذف نمی‌شود و بعداً می‌توانید این رکورد را بازگردانید.</span>`,
            confirmText: 'انتقال به بایگانی', danger: true,
          })) return;
          await api.deleteItem(r.id, true);
          toast('به بایگانی منتقل شد');
        }
        renderItems(root, params);
      }));
    tr.append(actions);

    tr.addEventListener('click', () => go('item', { id: r.id }));
    tr.style.cursor = 'pointer';
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(el('div', { class: 'table-wrap' }, table));
  return wrap;
}

function cardsView(data, f, root, params) {
  const grid = el('div', { class: 'grid grid--cards' });
  for (const r of data.rows) {
    const card = el('div', { class: 'card', style: { cursor: 'pointer' } });
    const body = el('div', { class: 'card__body stack' });

    body.append(el('div', { class: 'row' },
      el('span', { class: `badge ${MEDIA_KINDS[r.media_kind]?.badge || ''}` },
        `${MEDIA_KINDS[r.media_kind]?.icon || ''} ${MEDIA_KINDS[r.media_kind]?.label || ''}`),
      el('span', { class: 'muted small num', style: { marginInlineStart: 'auto' } }, fa(r.code || ''))));

    body.append(el('div', { class: 'strong', html: highlight(r.title, f.q) }));

    const meta = [];
    if (r.series) meta.push(`${r.series}${r.part_no ? ' — جلسهٔ ' + fa(r.part_no) : ''}`);
    if (r.speech_date) meta.push(jdate(r.speech_date, true));
    if (r.duration_sec) meta.push(duration(r.duration_sec));
    if (r.category_path) meta.push(r.category_path);
    body.append(el('div', { class: 'small muted' }, meta.join(' • ') || '—'));

    const badges = el('div', { class: 'row row--tight' });
    if (r.drive_codes) String(r.drive_codes).split(',').forEach((c) =>
      badges.append(el('span', { class: 'badge badge--brand num' }, fa(c))));
    else badges.append(el('span', { class: 'badge badge--danger' }, 'بدون فایل'));
    if (r.needs_work) badges.append(el('span', { class: 'badge badge--warn' }, 'دارای نقص'));
    if (r.verified) badges.append(el('span', { class: 'badge badge--ok' }, 'تأیید شده'));
    body.append(badges);

    if (r.rating) body.append(el('div', { html: stars(r.rating) }));

    card.append(body);
    card.addEventListener('click', () => go('item', { id: r.id }));
    grid.append(card);
  }
  return grid;
}

function iconBtn(icon, title, onClick) {
  return el('button', { class: 'btn btn--ghost btn--sm', title, onclick: onClick }, icon);
}

/* -------------------------------------------------------------- صفحه‌بندی */

function pagination(data, root, params) {
  const wrap = el('div', { class: 'pagination' });
  const from = (data.page - 1) * data.per_page + 1;
  const to = Math.min(data.page * data.per_page, data.total);
  wrap.append(el('div', { class: 'pagination__info' },
    `نمایش ${fa(from)} تا ${fa(to)} از ${num(data.total)} رکورد`));

  const goPage = (p) => apply(root, params, { page: p });
  const pageBtn = (label, page, disabled, active) => {
    const b = el('button', { class: `page-btn${active ? ' is-active' : ''}`, disabled }, label);
    if (!disabled && !active) b.addEventListener('click', () => goPage(page));
    return b;
  };

  wrap.append(pageBtn('نخست', 1, data.page === 1));
  wrap.append(pageBtn('‹ قبلی', data.page - 1, data.page === 1));

  const around = 2;
  const pages = new Set([1, data.pages]);
  for (let p = data.page - around; p <= data.page + around; p++) if (p >= 1 && p <= data.pages) pages.add(p);
  let prev = 0;
  for (const p of [...pages].sort((a, b) => a - b)) {
    if (prev && p - prev > 1) wrap.append(el('span', { class: 'muted' }, '…'));
    wrap.append(pageBtn(fa(p), p, false, p === data.page));
    prev = p;
  }

  wrap.append(pageBtn('بعدی ›', data.page + 1, data.page >= data.pages));
  wrap.append(pageBtn('آخر', data.pages, data.page >= data.pages));
  return wrap;
}

/* ---------------------------------------------------------- عملیات گروهی */

async function bulkAction(action, root, params, patch = {}) {
  const ids = [...state.selection];
  if (!ids.length) return toast('هیچ رکوردی انتخاب نشده است', 'warn');
  try {
    const res = await api.bulk({ ids, action, patch });
    toast(`${fa(res.affected)} رکورد به‌روزرسانی شد`);
    state.selection.clear();
    renderItems(root, params);
  } catch (e) { toast(e.message, 'error'); }
}

async function bulkDelete(root, params, isArchived) {
  const ids = [...state.selection];
  const ok = await confirmDialog({
    title: isArchived ? 'حذف همیشگی' : 'انتقال به بایگانی',
    message: isArchived
      ? `<b>${fa(ids.length)}</b> رکورد برای همیشه حذف می‌شوند. این کار برگشت‌پذیر نیست.<br><span class="muted small">فایل‌های اصلی روی هاردها دست‌نخورده می‌مانند؛ تنها اطلاعات ثبت‌شده حذف می‌شود.</span>`
      : `<b>${fa(ids.length)}</b> رکورد به بایگانی منتقل شوند؟ بعداً قابل بازگردانی هستند.`,
    confirmText: isArchived ? 'حذف همیشگی' : 'انتقال به بایگانی',
    danger: true,
  });
  if (!ok) return;
  await bulkAction(isArchived ? 'purge' : 'delete', root, params);
}

function openBulkEdit(root, params) {
  const ids = [...state.selection];
  const form = el('div', { class: 'stack' });
  form.append(el('div', { class: 'badge badge--brand' }, `${fa(ids.length)} رکورد انتخاب شده`));
  form.append(el('div', { class: 'muted small' }, 'تنها فیلدهایی که مقدار می‌دهید تغییر می‌کنند؛ بقیه دست‌نخورده می‌مانند.'));

  const grid = el('div', { class: 'form-grid' });
  const catSel = select({ options: categoryOptions().map((c) => ({ value: c.id, label: c.label })), placeholder: 'بدون تغییر' });
  const spkSel = select({ options: state.speakers.map((s) => ({ value: s.id, label: s.name })), placeholder: 'بدون تغییر' });
  const kindSel = select({ options: MEDIA_KINDS, placeholder: 'بدون تغییر' });
  const qualSel = select({ options: QUALITIES, placeholder: 'بدون تغییر' });
  const verifySel = select({ options: [{ value: '1', label: 'تأیید شده' }, { value: '0', label: 'تأیید نشده' }], placeholder: 'بدون تغییر' });
  const workSel = select({ options: [{ value: '1', label: 'دارد' }, { value: '0', label: 'ندارد' }], placeholder: 'بدون تغییر' });
  const tags = tagInput({ suggestions: state.tags.map((t) => t.name), placeholder: 'برچسب برای افزودن' });

  const add = (label, ctrl) => grid.append(el('div', { class: 'field' },
    el('label', { class: 'field__label' }, label), ctrl));
  add('دسته‌بندی', catSel);
  add('سخنران', spkSel);
  add('نوع رسانه', kindSel);
  add('کیفیت', qualSel);
  add('وضعیت تأیید', verifySel);
  add('نیازمند رسیدگی', workSel);
  grid.append(el('div', { class: 'field field--wide' },
    el('label', { class: 'field__label' }, 'افزودن برچسب (به رکوردهای موجود اضافه می‌شود)'), tags));
  form.append(grid);

  const save = el('button', { class: 'btn btn--primary' }, 'اعمال روی همه');
  const m = modal({ title: 'ویرایش گروهی', body: form, footer: [el('button', { class: 'btn', onclick: () => m.close() }, 'انصراف'), save], size: 'modal--wide' });

  save.addEventListener('click', async () => {
    const patch = {};
    if (catSel.value) patch.category_id = Number(catSel.value);
    if (spkSel.value) patch.speaker_id = Number(spkSel.value);
    if (kindSel.value) patch.media_kind = kindSel.value;
    if (qualSel.value) patch.quality = qualSel.value;
    if (verifySel.value) patch.verified = verifySel.value === '1';
    if (workSel.value) patch.needs_work = workSel.value === '1';
    if (tags.value.length) patch.add_tags = tags.value;
    if (!Object.keys(patch).length) return toast('هیچ تغییری وارد نشده است', 'warn');
    m.close();
    await bulkAction('update', root, params, patch);
  });
}

/* --------------------------------------------------------------- خروجی */

async function exportCsv(f) {
  const sp = new URLSearchParams(cleanFilters({ ...f, page: undefined, per_page: undefined }));
  window.location.href = '/api/export/csv?' + sp.toString();
  toast('فایل اکسل در حال دانلود است…', 'info');
}
