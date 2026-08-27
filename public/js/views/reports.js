/** گزارش‌های سلامت و کیفیت آرشیو */
import { api, fa, num, size, MEDIA_KINDS, COPY_HEALTH } from '../core.js';
import { el, toast, loading, emptyState } from '../components.js';
import { go } from '../app.js';

const REPORTS = {
  noCopies: {
    title: 'رکوردهای بدون فایل',
    desc: 'برای این رکوردها هیچ نسخه‌ای روی هیچ هاردی ثبت نشده است. یا فایلشان گم شده یا هنوز محل نگهداری‌شان وارد نشده.',
    icon: '📭', tone: 'danger',
  },
  singleCopy: {
    title: 'بدون نسخهٔ پشتیبان',
    desc: 'این رکوردها فقط روی یک هارد هستند. اگر آن هارد آسیب ببیند، محتوا برای همیشه از دست می‌رود.',
    icon: '⚠️', tone: 'warn',
  },
  badCopies: {
    title: 'فایل‌های خراب یا مفقود',
    desc: 'نسخه‌هایی که هنگام بررسی، خراب یا ناموجود گزارش شده‌اند.',
    icon: '💔', tone: 'danger',
  },
  defective: {
    title: 'دارای نقص محتوایی',
    desc: 'رکوردهایی که نقصی برایشان ثبت شده یا نیازمند بازسازی هستند.',
    icon: '🔧', tone: 'warn',
  },
  unverified: {
    title: 'بررسی‌نشده‌ها',
    desc: 'رکوردهایی که هنوز کسی صحت اطلاعاتشان را تأیید نکرده است.',
    icon: '👀', tone: 'info',
  },
  undated: {
    title: 'بدون تاریخ',
    desc: 'رکوردهایی که تاریخ ایراد برایشان ثبت نشده است.',
    icon: '📅', tone: 'info',
  },
  duplicates: {
    title: 'موارد احتمالاً تکراری',
    desc: 'رکوردهایی با عنوان بسیار شبیه یا فایل‌هایی با اثر انگشت (checksum) یکسان.',
    icon: '⧉', tone: 'warn',
  },
  drivesDueCheck: {
    title: 'هاردهای نیازمند بازبینی',
    desc: 'هاردهایی که تاریخ بررسی بعدی‌شان رسیده است.',
    icon: '🔍', tone: 'warn',
  },
};

export async function renderReports(root, params = {}) {
  const active = params.tab && REPORTS[params.tab] ? params.tab : 'noCopies';
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'گزارش‌ها و سلامت آرشیو'),
      el('div', { class: 'page-subtitle' }, 'این گزارش‌ها کمک می‌کنند کاستی‌های آرشیو را پیدا و برطرف کنید')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn', onclick: () => window.print() }, '🖨 چاپ گزارش'))));

  const tabs = el('div', { class: 'tabs' });
  for (const [key, r] of Object.entries(REPORTS)) {
    const t = el('button', { class: `tab${key === active ? ' is-active' : ''}` }, `${r.icon} ${r.title}`);
    t.addEventListener('click', () => go('reports', { tab: key }));
    tabs.append(t);
  }
  root.append(tabs);

  const meta = REPORTS[active];
  root.append(el('div', { class: 'card mb' }, el('div', { class: 'card__body' },
    el('div', { class: 'row' },
      el('span', { style: { fontSize: '22px' } }, meta.icon),
      el('div', {},
        el('div', { class: 'strong' }, meta.title),
        el('div', { class: 'muted small' }, meta.desc))))));

  const host = el('div', {});
  root.append(host);
  host.append(loading('در حال بررسی…'));

  let rows;
  try { rows = await api.report(active); }
  catch (e) { host.innerHTML = ''; return toast(e.message, 'error'); }
  host.innerHTML = '';

  if (!rows.length) {
    return host.append(emptyState({
      icon: '✅', title: 'هیچ موردی یافت نشد',
      text: 'در این بخش مشکلی وجود ندارد. آرشیو شما از این نظر سالم است.',
    }));
  }

  host.append(el('div', { class: 'row mb' },
    el('span', { class: `badge badge--${meta.tone}` }, `${num(rows.length)} مورد`)));

  if (active === 'duplicates') host.append(duplicatesView(rows));
  else if (active === 'badCopies') host.append(badCopiesView(rows));
  else if (active === 'drivesDueCheck') host.append(drivesView(rows));
  else host.append(itemsView(rows, active));
}

function itemsView(rows, reportKey) {
  const card = el('div', { class: 'card' });
  const table = el('table', { class: 'data' });
  table.innerHTML = `<thead><tr>
    <th>کد</th><th>عنوان</th><th>دسته‌بندی</th><th>تاریخ ایراد</th><th>هاردها</th><th>وضعیت</th>
  </tr></thead>`;
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { style: { cursor: 'pointer' } });
    tr.append(el('td', { class: 'muted small num' }, fa(r.code || '—')));
    tr.append(el('td', {},
      el('div', { class: 'cell-main' }, `${MEDIA_KINDS[r.media_kind]?.icon || ''} ${r.title}`),
      r.series ? el('div', { class: 'cell-sub' }, `${r.series}${r.part_no ? ' — جلسهٔ ' + fa(r.part_no) : ''}`) : null));
    tr.append(el('td', { class: 'small soft' }, r.category_path || '—'));
    tr.append(el('td', { class: 'small num' }, r.speech_date ? fa(r.speech_date) : '—'));
    const drives = el('td', { class: 'row row--tight' });
    if (r.drive_codes) String(r.drive_codes).split(',').forEach((c) => drives.append(el('span', { class: 'badge badge--brand num' }, fa(c))));
    else drives.append(el('span', { class: 'badge badge--danger' }, 'هیچ'));
    tr.append(drives);
    const st = el('td', { class: 'small' });
    if (reportKey === 'defective') st.append(el('span', { class: 'truncate', style: { maxWidth: '220px', display: 'inline-block' }, title: r.defects || '' }, r.defects || 'نیازمند رسیدگی'));
    else if (reportKey === 'unverified') st.append(el('span', { class: 'badge badge--warn' }, 'تأیید نشده'));
    else st.append(el('span', { class: 'muted' }, '—'));
    tr.append(st);
    tr.addEventListener('click', () => go('item', { id: r.id }));
    tbody.append(tr);
  }
  table.append(tbody);
  card.append(el('div', { class: 'table-wrap' }, table));
  return card;
}

function badCopiesView(rows) {
  const card = el('div', { class: 'card' });
  const table = el('table', { class: 'data' });
  table.innerHTML = `<thead><tr>
    <th>رکورد</th><th>هارد</th><th>مسیر فایل</th><th>حجم</th><th>وضعیت</th>
  </tr></thead>`;
  const tbody = el('tbody');
  for (const c of rows) {
    const tr = el('tr', { style: { cursor: 'pointer' } });
    tr.append(el('td', {},
      el('div', { class: 'cell-main' }, c.item_title || '(بدون رکورد)'),
      el('div', { class: 'cell-sub num' }, fa(c.item_code || ''))));
    tr.append(el('td', {}, c.drive_code
      ? el('span', { class: 'badge badge--brand num' }, fa(c.drive_code))
      : el('span', { class: 'badge badge--danger' }, 'نامشخص')));
    tr.append(el('td', { class: 'ltr small', style: { maxWidth: '320px', wordBreak: 'break-all' } },
      [c.folder_path, c.file_name].filter(Boolean).join('/') || '—'));
    tr.append(el('td', { class: 'small num' }, c.size_mb ? size(c.size_mb) : '—'));
    const h = COPY_HEALTH[c.health] || {};
    tr.append(el('td', {}, el('span', { class: `badge ${h.badge || ''}` }, h.label || c.health)));
    if (c.item_id) tr.addEventListener('click', () => go('item', { id: c.item_id }));
    tbody.append(tr);
  }
  table.append(tbody);
  card.append(el('div', { class: 'table-wrap' }, table));
  return card;
}

function drivesView(rows) {
  const wrap = el('div', { class: 'grid grid--cards' });
  for (const d of rows) {
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'card__body stack' },
      el('div', { class: 'row' },
        el('span', { class: 'badge badge--brand num' }, fa(d.code)),
        el('span', { class: 'strong' }, d.name)),
      el('div', { class: 'small muted' }, `بررسی بعدی: ${fa(d.next_check || '')}`),
      d.last_check ? el('div', { class: 'small muted' }, `آخرین بررسی: ${fa(d.last_check)}`) : null,
      el('button', { class: 'btn btn--sm', onclick: () => go('drive', { id: d.id }) }, 'مشاهدهٔ هارد')));
    wrap.append(card);
  }
  return wrap;
}

function duplicatesView(groups) {
  const wrap = el('div', { class: 'stack' });
  for (const g of groups) {
    const card = el('div', { class: 'card' });
    const body = el('div', { class: 'card__body stack' });
    body.append(el('div', { class: 'row' },
      el('span', { class: 'badge badge--warn' }, g.reason),
      el('span', { class: 'muted small truncate' }, g.key || '')));
    for (const it of g.items) {
      if (!it) continue;
      const row = el('div', { class: 'row', style: { cursor: 'pointer', paddingBlock: '4px' } },
        el('span', { class: 'badge num' }, fa(it.code || '—')),
        el('span', { class: 'truncate', style: { flex: '1' } }, it.title),
        it.speech_date ? el('span', { class: 'muted small num' }, fa(it.speech_date)) : null,
        el('span', { class: 'muted small' }, it.drive_codes ? fa(it.drive_codes) : 'بدون هارد'));
      row.addEventListener('click', () => go('item', { id: it.id }));
      body.append(row);
    }
    card.append(body);
    wrap.append(card);
  }
  return wrap;
}
