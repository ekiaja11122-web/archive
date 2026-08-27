/** داشبورد — نمای کلی آرشیو */
import { api, state, num, fa, duration, size, gb, ago, MEDIA_KINDS } from '../core.js';
import { el, loading, barChart, toast } from '../components.js';
import { go } from '../app.js';
import { openBulkAdd } from './bulk-add.js';
import { openItemForm } from './item-form.js';

export async function renderDashboard(root) {
  root.innerHTML = '';
  root.append(loading('در حال آماده‌سازی گزارش…'));

  let s;
  try { s = await api.stats(); }
  catch (e) { root.innerHTML = ''; return toast(e.message, 'error'); }

  root.innerHTML = '';
  const title = state.settings.archive_title || 'آرشیو';

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, title),
      el('div', { class: 'page-subtitle' },
        `امروز ${fa(state.today)} — مجموع ${num(s.totals.items)} رکورد روی ${num(s.drives.count)} حافظه`)),
    el('div', { class: 'page-head__actions' },
      btn('⊞ افزودن گروهی مجموعه', 'btn--primary', () => openBulkAdd(() => renderDashboard(root))),
      btn('＋ ثبت یک رکورد', '', () => openItemForm(null, () => renderDashboard(root))),
      btn('＋ افزودن هارد', '', () => go('drives', { new: 1 })))));

  /* ---------------------------------------------------------- کارت‌های آمار */
  const stat = (label, value, hint, cls = '', onClick) => {
    const node = el('div', { class: `stat ${cls}${onClick ? '' : ' stat--plain'}` },
      el('div', { class: 'stat__label' }, label),
      el('div', { class: 'stat__value' }, value),
      hint ? el('div', { class: 'stat__hint' }, hint) : null);
    if (onClick) node.addEventListener('click', onClick);
    return node;
  };

  const t = s.totals;
  root.append(el('div', { class: 'grid grid--stats mb' },
    stat('کل رکوردها', num(t.items), `${num(t.audio)} صوتی، ${num(t.video)} تصویری`, '', () => go('items')),
    stat('مدت زمان کل', duration(t.duration_sec) || '—', 'مجموع مدت آرشیو'),
    stat('حافظه‌ها', num(s.drives.count), `${gb(s.drives.capacity_gb)} ظرفیت`, '', () => go('drives')),
    stat('حجم ثبت‌شده', size(s.copies.size_mb), `${num(s.copies.count)} نسخهٔ فایل`),
    stat('تأیید شده', num(t.verified), `${num(t.items - t.verified)} در انتظار بررسی`,
      t.verified === t.items ? 'stat--ok' : '', () => go('items', { verified: '0' })),
    stat('نیازمند رسیدگی', num(t.needs_work), 'دارای نقص یا ناقص',
      t.needs_work ? 'stat--warn' : '', () => go('items', { has_defect: '1' })),
    stat('بدون نسخهٔ پشتیبان', num(s.single_copy), 'فقط روی یک هارد',
      s.single_copy ? 'stat--warn' : 'stat--ok', () => go('items', { single_copy: '1' })),
    stat('بدون فایل ثبت‌شده', num(s.no_copy), 'هیچ نسخه‌ای ثبت نشده',
      s.no_copy ? 'stat--danger' : 'stat--ok', () => go('items', { no_copies: '1' }))));

  /* ------------------------------------------------------------- هشدارها */
  const alerts = [];
  if (s.copies.corrupt) alerts.push(['danger', `${num(s.copies.corrupt)} نسخهٔ خراب ثبت شده است`, () => go('reports', { tab: 'badCopies' })]);
  if (s.copies.missing) alerts.push(['danger', `${num(s.copies.missing)} نسخه مفقود شده است`, () => go('reports', { tab: 'badCopies' })]);
  if (s.drives.problem) alerts.push(['danger', `${num(s.drives.problem)} حافظه آسیب‌دیده یا مفقود است`, () => go('drives')]);
  if (s.no_copy) alerts.push(['warn', `${num(s.no_copy)} رکورد هیچ فایلی روی هیچ هاردی ندارد`, () => go('reports', { tab: 'noCopies' })]);
  if (s.single_copy) alerts.push(['warn', `${num(s.single_copy)} رکورد فقط یک نسخه دارد — در خطر از دست رفتن`, () => go('reports', { tab: 'singleCopy' })]);

  if (alerts.length) {
    const box = el('div', { class: 'card mb' },
      el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, '⚠️ نکات نیازمند توجه')));
    const body = el('div', { class: 'card__body stack' });
    for (const [kind, text, action] of alerts) {
      const row = el('div', { class: 'row', style: { cursor: 'pointer' } },
        el('span', { class: `dot dot--${kind}` }), el('span', {}, text),
        el('span', { class: 'muted small', style: { marginInlineStart: 'auto' } }, 'مشاهده ›'));
      row.addEventListener('click', action);
      body.append(row);
    }
    box.append(body);
    root.append(box);
  }

  /* -------------------------------------------------------------- نمودارها */
  const chartCard = (titleText, rows, emptyText) => {
    const card = el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, titleText)));
    const body = el('div', { class: 'card__body' });
    if (!rows?.length) body.append(el('div', { class: 'muted text-center small', style: { padding: '18px' } }, emptyText || 'داده‌ای موجود نیست'));
    else body.append(barChart(rows.map((r) => ({ ...r, key: labelize(r.key) }))));
    card.append(body);
    return card;
  };

  root.append(el('div', { class: 'grid grid--2 mb' },
    chartCard('پراکندگی بر پایهٔ دسته‌بندی', s.by_category),
    chartCard('پراکندگی بر پایهٔ حافظه', s.by_drive, 'هنوز هاردی ثبت نشده است'),
    chartCard('پراکندگی بر پایهٔ دهه (تاریخ ایراد)', s.by_decade, 'هنوز تاریخی ثبت نشده است'),
    chartCard('پراکندگی بر پایهٔ مناسبت', s.by_occasion)));

  /* ---------------------------------------------------- تازه‌ها و رویدادها */
  const recentCard = el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title' }, 'تازه‌ترین ثبت‌ها'),
      el('button', { class: 'btn btn--ghost btn--sm', style: { marginInlineStart: 'auto' },
        onclick: () => go('items') }, 'همه ›')));
  const recentBody = el('div', { class: 'card__body stack' });
  if (!s.recent.length) recentBody.append(el('div', { class: 'muted small text-center' }, 'هنوز رکوردی ثبت نشده است'));
  for (const r of s.recent) {
    const row = el('div', { class: 'row', style: { cursor: 'pointer' } },
      el('span', {}, MEDIA_KINDS[r.media_kind]?.icon || '📦'),
      el('span', { class: 'truncate', style: { flex: '1' } }, r.title),
      el('span', { class: 'muted small' }, ago(r.created_at)));
    row.addEventListener('click', () => go('item', { id: r.id }));
    recentBody.append(row);
  }
  recentCard.append(recentBody);

  const logCard = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'آخرین رویدادها')));
  const logBody = el('div', { class: 'card__body stack' });
  if (!s.recent_activity.length) logBody.append(el('div', { class: 'muted small text-center' }, 'رویدادی ثبت نشده'));
  for (const a of s.recent_activity.slice(0, 8)) {
    logBody.append(el('div', { class: 'row small' },
      el('span', { class: `dot dot--${a.action === 'delete' ? 'danger' : a.action === 'create' ? 'ok' : 'muted'}` }),
      el('span', { class: 'truncate', style: { flex: '1' } }, a.summary || a.action),
      el('span', { class: 'muted' }, fa(a.at_jalali || ''))));
  }
  logCard.append(logBody);

  root.append(el('div', { class: 'grid grid--2' }, recentCard, logCard));
}

function labelize(key) {
  return MEDIA_KINDS[key]?.label || key || 'نامشخص';
}

function btn(text, cls, onClick) {
  return el('button', { class: `btn ${cls}`, onclick: onClick }, text);
}
