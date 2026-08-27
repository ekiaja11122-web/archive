/** مدیریت هاردها و حافظه‌ها */
import {
  api, state, fa, num, gb, size, refreshReference,
  DRIVE_TYPES, DRIVE_STATUS, HEALTH, COPY_HEALTH, MEDIA_KINDS,
} from '../core.js';
import {
  el, modal, toast, select, field, jalaliInput, confirmDialog, emptyState, loading,
} from '../components.js';
import { go } from '../app.js';

const DRIVE_COLORS = ['#0e6f5c', '#1d5fa8', '#b4863c', '#c0392f', '#6b3fa0', '#0f766e', '#475569', '#be185d'];

export async function renderDrives(root, params = {}) {
  root.innerHTML = '';
  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'هاردها و حافظه‌ها'),
      el('div', { class: 'page-subtitle' }, 'هر هارد یک شمارهٔ یکتا می‌گیرد تا محل هر فایل مشخص باشد')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn', onclick: () => printLabels() }, '🏷 چاپ برچسب هاردها'),
      el('button', { class: 'btn btn--primary', onclick: () => openDriveForm(null, () => renderDrives(root)) }, '＋ افزودن هارد'))));

  const host = el('div', {});
  root.append(host);
  host.append(loading());

  let drives;
  try { drives = await api.drives(); }
  catch (e) { host.innerHTML = ''; return toast(e.message, 'error'); }
  host.innerHTML = '';

  if (params.new) openDriveForm(null, () => renderDrives(root));

  if (!drives.length) {
    return host.append(emptyState({
      icon: '💾', title: 'هنوز هاردی ثبت نشده است',
      text: 'نخستین هارد خود را اضافه کنید تا بتوانید محل نگهداری فایل‌ها را مشخص کنید. هر هارد شماره‌ای مانند HD-001 می‌گیرد.',
      action: el('button', { class: 'btn btn--primary', onclick: () => openDriveForm(null, () => renderDrives(root)) }, '＋ افزودن نخستین هارد'),
    }));
  }

  // خلاصه
  const totalCap = drives.reduce((s, d) => s + (Number(d.capacity_gb) || 0), 0);
  const totalItems = drives.reduce((s, d) => s + d.item_count, 0);
  host.append(el('div', { class: 'grid grid--stats mb' },
    stat('تعداد حافظه‌ها', fa(drives.length)),
    stat('ظرفیت کل', gb(totalCap)),
    stat('مجموع رکوردها', num(totalItems)),
    stat('نسخه‌های مشکل‌دار', num(drives.reduce((s, d) => s + d.problem_count, 0)),
      drives.some((d) => d.problem_count) ? 'stat--danger' : 'stat--ok')));

  const grid = el('div', { class: 'grid grid--cards' });
  for (const d of drives) grid.append(driveCard(d, () => renderDrives(root)));
  host.append(grid);
}

function stat(label, value, cls = '') {
  return el('div', { class: `stat stat--plain ${cls}` },
    el('div', { class: 'stat__label' }, label), el('div', { class: 'stat__value' }, value));
}

function driveCard(d, reload) {
  const status = DRIVE_STATUS[d.status] || {};
  const health = HEALTH[d.health] || {};
  const card = el('div', { class: 'drive-card' });
  card.style.borderTopColor = d.color || 'var(--brand)';

  const codeChip = el('span', { class: 'drive-card__code num' }, fa(d.code));
  if (d.color) codeChip.style.background = d.color;

  card.append(el('div', { class: 'drive-card__head' },
    codeChip,
    el('div', { class: 'drive-card__name truncate', title: d.name }, d.name),
    el('span', { class: `badge ${status.badge || ''}` }, status.label || d.status)));

  const meta = [
    DRIVE_TYPES[d.media_type] || d.media_type,
    d.capacity_gb ? gb(d.capacity_gb) : null,
    d.location ? `📍 ${d.location}` : null,
    d.shelf_code ? `قفسه ${fa(d.shelf_code)}` : null,
    d.owner ? `نزد ${d.owner}` : null,
    d.is_backup ? 'نسخهٔ پشتیبان' : null,
  ].filter(Boolean);
  card.append(el('div', { class: 'drive-card__meta' }, ...meta.map((m) => el('span', {}, m))));

  // نوار پرشدگی
  if (d.capacity_gb) {
    const usedGb = d.used_gb != null ? Number(d.used_gb) : (d.used_mb_calc || 0) / 1024;
    const pct = Math.min(100, (usedGb / Number(d.capacity_gb)) * 100);
    const fillCls = pct > 92 ? 'meter__fill--danger' : pct > 75 ? 'meter__fill--warn' : '';
    card.append(el('div', {},
      el('div', { class: 'row small muted', style: { justifyContent: 'space-between', marginBottom: '3px' } },
        el('span', {}, `${gb(usedGb.toFixed(1))} استفاده شده`),
        el('span', {}, `${fa(Math.round(pct))}٪`)),
      el('div', { class: 'meter' }, el('div', { class: `meter__fill ${fillCls}`, style: { width: pct + '%' } }))));
  }

  card.append(el('div', { class: 'drive-card__stats' },
    el('div', { class: 'drive-card__stat' }, el('b', {}, num(d.item_count)), el('span', { class: 'muted small' }, 'رکورد')),
    el('div', { class: 'drive-card__stat' }, el('b', {}, num(d.copy_count)), el('span', { class: 'muted small' }, 'فایل')),
    el('div', { class: 'drive-card__stat' },
      el('b', { style: { color: d.problem_count ? 'var(--danger)' : '' } }, num(d.problem_count)),
      el('span', { class: 'muted small' }, 'مشکل‌دار'))));

  if (d.last_check || d.health !== 'unknown') {
    card.append(el('div', { class: 'row row--tight small' },
      el('span', { class: `dot ${health.dot || 'dot--muted'}` }),
      el('span', { class: 'muted' }, health.label || ''),
      d.last_check ? el('span', { class: 'muted' }, `• آخرین بررسی ${fa(d.last_check)}`) : null));
  }

  card.append(el('div', { class: 'row row--tight', style: { marginTop: 'auto', paddingTop: '6px' } },
    el('button', { class: 'btn btn--sm', onclick: () => go('drive', { id: d.id }) }, 'محتویات'),
    el('button', { class: 'btn btn--sm', onclick: () => go('items', { drive_id: d.id }) }, 'رکوردها'),
    el('button', { class: 'btn btn--sm btn--ghost', onclick: () => openDriveForm(d, reload) }, '✎'),
    el('button', { class: 'btn btn--sm btn--ghost', onclick: () => removeDrive(d, reload) }, '🗑')));

  return card;
}

/* ------------------------------------------------------------ فرم هارد */

export function openDriveForm(drive, onSaved) {
  const d = drive || { media_type: 'hdd', status: 'active', health: 'unknown' };
  const F = {};
  const grid = el('div', { class: 'form-grid' });

  F.name = el('input', { class: 'input', placeholder: 'مثال: هارد آبی سخنرانی‌ها' });
  F.name.value = d.name || '';
  grid.append(field('نام یا برچسب هارد', F.name, { required: true, wide: true }));

  F.code = el('input', { class: 'input ltr', placeholder: state.nextCodes.drive });
  F.code.value = d.code || '';
  grid.append(field('شمارهٔ هارد', F.code, { hint: d.id ? '' : `خالی بگذارید تا ${state.nextCodes.drive} شود` }));

  F.media_type = select({ options: DRIVE_TYPES, value: d.media_type });
  grid.append(field('نوع حافظه', F.media_type));

  F.capacity_gb = el('input', { class: 'input', type: 'number', step: '1', placeholder: 'مثال: ۲۰۰۰' });
  F.capacity_gb.value = d.capacity_gb ?? '';
  grid.append(field('ظرفیت (گیگابایت)', F.capacity_gb));

  F.used_gb = el('input', { class: 'input', type: 'number', step: '1', placeholder: 'اختیاری' });
  F.used_gb.value = d.used_gb ?? '';
  grid.append(field('فضای اشغال‌شده (گیگابایت)', F.used_gb, { hint: 'اگر خالی باشد از جمع حجم فایل‌ها حساب می‌شود' }));

  F.brand = el('input', { class: 'input', placeholder: 'Western Digital / Seagate …' });
  F.brand.value = d.brand || '';
  grid.append(field('سازنده', F.brand));

  F.model = el('input', { class: 'input ltr' });
  F.model.value = d.model || '';
  grid.append(field('مدل', F.model));

  F.serial = el('input', { class: 'input ltr' });
  F.serial.value = d.serial || '';
  grid.append(field('شمارهٔ سریال', F.serial));

  F.interface = el('input', { class: 'input ltr', placeholder: 'USB 3.0 / SATA' });
  F.interface.value = d.interface || '';
  grid.append(field('رابط اتصال', F.interface));

  F.location = el('input', { class: 'input', placeholder: 'مثال: کمد بایگانی، طبقهٔ دوم' });
  F.location.value = d.location || '';
  grid.append(field('محل نگهداری فیزیکی', F.location, { hint: 'خودِ هارد کجا نگهداری می‌شود' }));

  F.shelf_code = el('input', { class: 'input', placeholder: 'مثال: A-3' });
  F.shelf_code.value = d.shelf_code || '';
  grid.append(field('کد قفسه / جعبه', F.shelf_code));

  F.owner = el('input', { class: 'input', placeholder: 'نام نگهدارنده' });
  F.owner.value = d.owner || '';
  grid.append(field('در اختیار', F.owner));

  F.status = select({ options: DRIVE_STATUS, value: d.status });
  grid.append(field('وضعیت', F.status));

  F.health = select({ options: HEALTH, value: d.health });
  grid.append(field('سلامت حافظه', F.health));

  F.purchase_date = jalaliInput({ value: d.purchase_date || '' });
  grid.append(field('تاریخ تهیه', F.purchase_date));

  F.last_check = jalaliInput({ value: d.last_check || '' });
  grid.append(field('آخرین بررسی سلامت', F.last_check));

  F.next_check = jalaliInput({ value: d.next_check || '' });
  grid.append(field('بررسی بعدی', F.next_check, { hint: 'یادآوری برای بازبینی دوره‌ای' }));

  // رنگ برچسب
  const colorRow = el('div', { class: 'row row--tight' });
  let chosenColor = d.color || '';
  const paint = () => colorRow.querySelectorAll('button').forEach((b) => {
    b.style.outline = b.dataset.color === chosenColor ? '2px solid var(--text)' : 'none';
    b.style.outlineOffset = '2px';
  });
  for (const c of ['', ...DRIVE_COLORS]) {
    const b = el('button', {
      class: 'btn btn--sm', type: 'button', dataset: { color: c },
      style: { background: c || 'var(--bg-sunken)', width: '30px', height: '26px', padding: '0' },
      title: c || 'بدون رنگ',
    }, c ? '' : '✕');
    b.addEventListener('click', () => { chosenColor = c; paint(); });
    colorRow.append(b);
  }
  paint();
  grid.append(field('رنگ برچسب', colorRow, { hint: 'برای شناسایی سریع هارد' }));

  F.is_backup = el('input', { type: 'checkbox' });
  F.is_backup.checked = !!d.is_backup;
  grid.append(el('div', { class: 'field field--wide' },
    el('label', { class: 'checkbox' }, F.is_backup, el('span', {}, 'این هارد نسخهٔ پشتیبان است'))));

  F.notes = el('textarea', { class: 'textarea', placeholder: 'هر توضیحی دربارهٔ این هارد' });
  F.notes.value = d.notes || '';
  grid.append(field('یادداشت', F.notes, { wide: true }));

  const save = el('button', { class: 'btn btn--primary' }, d.id ? 'ذخیره' : 'افزودن هارد');
  const cancel = el('button', { class: 'btn' }, 'انصراف');
  const m = modal({
    title: d.id ? `ویرایش هارد ${fa(d.code)}` : 'افزودن هارد تازه',
    body: grid, size: 'modal--wide', footer: [cancel, save], closeOnBackdrop: false,
  });
  cancel.addEventListener('click', () => m.close());

  save.addEventListener('click', async () => {
    if (!F.name.value.trim()) { F.name.focus(); return toast('نام هارد را وارد کنید', 'warn'); }
    save.disabled = true;
    try {
      const payload = {
        id: d.id, name: F.name.value.trim(), code: F.code.value.trim() || undefined,
        media_type: F.media_type.value, capacity_gb: F.capacity_gb.value || null,
        used_gb: F.used_gb.value || null, brand: F.brand.value.trim(), model: F.model.value.trim(),
        serial: F.serial.value.trim(), interface: F.interface.value.trim(),
        location: F.location.value.trim(), shelf_code: F.shelf_code.value.trim(),
        owner: F.owner.value.trim(), status: F.status.value, health: F.health.value,
        purchase_date: F.purchase_date.value, last_check: F.last_check.value, next_check: F.next_check.value,
        color: chosenColor, is_backup: F.is_backup.checked, notes: F.notes.value.trim(),
      };
      const saved = await api.saveDrive(payload);
      await refreshReference();
      toast(d.id ? 'تغییرات ذخیره شد' : `هارد ${fa(saved.code)} افزوده شد`);
      m.close();
      onSaved?.(saved);
    } catch (e) { toast(e.message, 'error'); }
    finally { save.disabled = false; }
  });
}

async function removeDrive(d, reload) {
  const ok = await confirmDialog({
    title: 'حذف هارد',
    message: `هارد «${d.name}» (${fa(d.code)}) حذف شود؟<br>
      <span class="muted small">${d.copy_count ? `${fa(d.copy_count)} نسخهٔ ثبت‌شده روی این هارد بدون هارد می‌شوند و رکوردهایشان باقی می‌ماند.` : 'هیچ فایلی روی این هارد ثبت نشده است.'}</span>`,
    confirmText: 'حذف هارد', danger: true,
  });
  if (!ok) return;
  await api.deleteDrive(d.id);
  await refreshReference();
  toast('هارد حذف شد');
  reload();
}

/* -------------------------------------------------------- محتویات یک هارد */

export async function renderDriveDetail(root, params) {
  root.innerHTML = '';
  root.append(loading());
  let d;
  try { d = await api.drive(params.id); }
  catch (e) {
    root.innerHTML = '';
    return root.append(emptyState({ icon: '❓', title: 'هارد پیدا نشد', text: e.message }));
  }
  root.innerHTML = '';

  const status = DRIVE_STATUS[d.status] || {};
  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('div', { class: 'row row--tight' },
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => go('drives') }, '› همهٔ هاردها'),
        el('span', { class: 'badge badge--brand num' }, fa(d.code)),
        el('span', { class: `badge ${status.badge || ''}` }, status.label || d.status)),
      el('h1', { class: 'page-title' }, d.name),
      el('div', { class: 'page-subtitle' }, [
        DRIVE_TYPES[d.media_type], d.capacity_gb ? gb(d.capacity_gb) : null,
        d.location ? `📍 ${d.location}` : null, d.serial ? `سریال: ${d.serial}` : null,
      ].filter(Boolean).join(' • '))),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn', onclick: () => go('items', { drive_id: d.id }) }, 'نمایش در آرشیو'),
      el('button', { class: 'btn', onclick: () => window.print() }, '🖨 چاپ فهرست'),
      el('button', { class: 'btn btn--primary', onclick: () => openDriveForm(d, () => renderDriveDetail(root, params)) }, '✎ ویرایش'))));

  if (d.notes) {
    root.append(el('div', { class: 'card mb' }, el('div', { class: 'card__body' },
      el('div', { class: 'detail-item__label' }, 'یادداشت'), el('div', { style: { whiteSpace: 'pre-wrap' } }, d.notes))));
  }

  const card = el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title' }, `فایل‌های ثبت‌شده روی این هارد (${fa(d.copies.length)})`)));

  if (!d.copies.length) {
    card.append(el('div', { class: 'card__body' },
      el('div', { class: 'muted text-center', style: { padding: '20px' } },
        'هنوز فایلی روی این هارد ثبت نشده است.')));
  } else {
    const table = el('table', { class: 'data' });
    table.innerHTML = `<thead><tr>
      <th>عنوان رکورد</th><th>مسیر و نام فایل</th><th>قالب</th><th>حجم</th><th>نقش</th><th>سلامت</th>
    </tr></thead>`;
    const tbody = el('tbody');
    for (const c of d.copies) {
      const tr = el('tr', { style: { cursor: 'pointer' } });
      tr.append(el('td', {},
        el('div', { class: 'cell-main' }, `${MEDIA_KINDS[c.media_kind]?.icon || ''} ${c.item_title || '(رکورد حذف‌شده)'}`),
        el('div', { class: 'cell-sub num' }, fa(c.item_code || ''))));
      tr.append(el('td', { class: 'ltr small', style: { maxWidth: '340px', wordBreak: 'break-all' } },
        [c.folder_path, c.file_name].filter(Boolean).join('/') || '—'));
      tr.append(el('td', { class: 'small' }, (c.file_format || '—').toUpperCase()));
      tr.append(el('td', { class: 'small num' }, c.size_mb ? size(c.size_mb) : '—'));
      tr.append(el('td', {}, el('span', { class: 'badge' }, ({ master: 'اصلی', backup: 'پشتیبان', converted: 'تبدیل‌شده', working: 'کاری' })[c.copy_role] || c.copy_role)));
      const h = COPY_HEALTH[c.health] || {};
      tr.append(el('td', {}, el('span', { class: `badge ${h.badge || ''}` }, h.label || c.health)));
      if (c.item_id) tr.addEventListener('click', () => go('item', { id: c.item_id }));
      tbody.append(tr);
    }
    table.append(tbody);
    card.append(el('div', { class: 'table-wrap' }, table));
  }
  root.append(card);
}

/* ------------------------------------------------------- چاپ برچسب هاردها */

async function printLabels() {
  const drives = await api.drives();
  const win = window.open('', '_blank');
  if (!win) return toast('پنجرهٔ چاپ باز نشد؛ مسدودکنندهٔ پنجره را غیرفعال کنید', 'warn');
  const cards = drives.map((d) => `
    <div class="label" style="border-top:5px solid ${d.color || '#0e6f5c'}">
      <div class="code">${fa(d.code)}</div>
      <div class="name">${d.name}</div>
      <div class="meta">${[DRIVE_TYPES[d.media_type] || '', d.capacity_gb ? gb(d.capacity_gb) : '', d.location || ''].filter(Boolean).join(' • ')}</div>
      <div class="meta">${fa(d.item_count)} رکورد • ${fa(d.copy_count)} فایل</div>
    </div>`).join('');
  win.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
    <title>برچسب هاردها</title><style>
      body{font-family:Tahoma,sans-serif;padding:12mm;display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
      .label{border:1px solid #999;border-radius:6px;padding:6mm;page-break-inside:avoid}
      .code{font-size:22pt;font-weight:bold;letter-spacing:1px}
      .name{font-size:13pt;margin:2mm 0}
      .meta{font-size:9pt;color:#555}
      @page{margin:10mm}
    </style></head><body>${cards}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 350);
}
