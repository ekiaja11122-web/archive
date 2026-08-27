/** تنظیمات، پشتیبان‌گیری، خروجی و ورودی اطلاعات */
import { api, state, fa, ago, savePref, refreshReference } from '../core.js';
import { el, toast, field, confirmDialog, loading, emptyState } from '../components.js';
import { go, applyTheme } from '../app.js';

export async function renderSettings(root, params = {}) {
  const active = params.tab || 'general';
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'تنظیمات و نگهداری'),
      el('div', { class: 'page-subtitle' }, 'پیکربندی نرم‌افزار، پشتیبان‌گیری و بازیابی اطلاعات'))));

  const tabs = el('div', { class: 'tabs' });
  const TABS = [['general', 'عمومی'], ['backup', 'پشتیبان‌گیری'], ['transfer', 'خروجی و ورودی'],
    ['activity', 'گزارش رویدادها'], ['about', 'دربارهٔ نرم‌افزار']];
  for (const [key, label] of TABS) {
    const t = el('button', { class: `tab${key === active ? ' is-active' : ''}` }, label);
    t.addEventListener('click', () => go('settings', { tab: key }));
    tabs.append(t);
  }
  root.append(tabs);

  const host = el('div', {});
  root.append(host);

  if (active === 'general') renderGeneral(host);
  else if (active === 'backup') await renderBackup(host);
  else if (active === 'transfer') renderTransfer(host);
  else if (active === 'activity') await renderActivity(host);
  else renderAbout(host);
}

/* ================================================================== عمومی */

function renderGeneral(host) {
  const s = state.settings;
  const card = el('div', { class: 'card mb' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'اطلاعات آرشیو')));
  const body = el('div', { class: 'card__body form-grid' });

  const F = {};
  F.archive_title = el('input', { class: 'input' });
  F.archive_title.value = s.archive_title || '';
  body.append(field('نام آرشیو', F.archive_title, { wide: true, hint: 'در بالای صفحه و گزارش‌ها نمایش داده می‌شود' }));

  F.item_prefix = el('input', { class: 'input ltr', maxlength: '6' });
  F.item_prefix.value = s.item_prefix || 'AR';
  body.append(field('پیشوند کد رکوردها', F.item_prefix, { hint: 'مثال: AR ⟵ AR-00001' }));

  F.item_code_width = el('input', { class: 'input', type: 'number', min: '2', max: '8' });
  F.item_code_width.value = s.item_code_width || 5;
  body.append(field('تعداد ارقام کد رکورد', F.item_code_width));

  F.drive_prefix = el('input', { class: 'input ltr', maxlength: '6' });
  F.drive_prefix.value = s.drive_prefix || 'HD';
  body.append(field('پیشوند شمارهٔ هاردها', F.drive_prefix, { hint: 'مثال: HD ⟵ HD-001' }));

  F.drive_code_width = el('input', { class: 'input', type: 'number', min: '2', max: '6' });
  F.drive_code_width.value = s.drive_code_width || 3;
  body.append(field('تعداد ارقام شمارهٔ هارد', F.drive_code_width));

  F.current_user = el('input', { class: 'input', placeholder: 'نام شما' });
  F.current_user.value = s.current_user || '';
  body.append(field('نام کاربر جاری', F.current_user,
    { hint: 'در «ثبت‌کننده» و گزارش رویدادها به کار می‌رود — روی همین رایانه ذخیره می‌شود' }));

  const save = el('button', { class: 'btn btn--primary' }, 'ذخیرهٔ تنظیمات');
  save.addEventListener('click', async () => {
    try {
      await api.saveSettings({
        archive_title: F.archive_title.value.trim(),
        item_prefix: F.item_prefix.value.trim().toUpperCase() || 'AR',
        item_code_width: F.item_code_width.value || 5,
        drive_prefix: F.drive_prefix.value.trim().toUpperCase() || 'HD',
        drive_code_width: F.drive_code_width.value || 3,
      });
      savePref('current_user', F.current_user.value.trim());
      await refreshReference();
      toast('تنظیمات ذخیره شد');
      document.getElementById('brand-title').textContent = state.settings.archive_title || 'آرشیو';
    } catch (e) { toast(e.message, 'error'); }
  });
  card.append(body, el('div', { class: 'card__foot' }, save));
  host.append(card);

  /* --------------------------------------------------------------- ظاهر */
  const look = el('div', { class: 'card mb' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'ظاهر برنامه')));
  const lookBody = el('div', { class: 'card__body' });

  const themeRow = el('div', { class: 'switch-row' },
    el('div', {}, el('div', {}, 'حالت نمایش'), el('div', { class: 'muted small' }, 'روشن یا تاریک')),
    el('div', { class: 'btn-group' }));
  const group = themeRow.querySelector('.btn-group');
  for (const [val, label] of [['light', '☀ روشن'], ['dark', '🌙 تاریک'], ['auto', 'خودکار']]) {
    const b = el('button', { class: `btn btn--sm${(state.settings.theme || 'light') === val ? ' is-active' : ''}` }, label);
    b.addEventListener('click', () => {
      savePref('theme', val); applyTheme();
      group.querySelectorAll('.btn').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
    });
    group.append(b);
  }
  lookBody.append(themeRow);

  const digitsRow = el('div', { class: 'switch-row' },
    el('div', {}, el('div', {}, 'اندازهٔ فهرست'), el('div', { class: 'muted small' }, 'تعداد رکورد در هر صفحه')),
    (() => {
      const sel = el('select', { class: 'select input--sm', style: { maxWidth: '120px' } });
      for (const n of [10, 25, 50, 100, 200]) sel.append(el('option', { value: n }, fa(n)));
      sel.value = String(state.settings.per_page || 25);
      sel.addEventListener('change', () => { savePref('per_page', Number(sel.value)); toast('ذخیره شد'); });
      return sel;
    })());
  lookBody.append(digitsRow);
  look.append(lookBody);
  host.append(look);

  /* ------------------------------------------------------------- نگهداری */
  const maint = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'نگهداری پایگاه داده')));
  const mBody = el('div', { class: 'card__body stack' });

  mBody.append(el('div', { class: 'switch-row' },
    el('div', {},
      el('div', {}, 'بازسازی نمایهٔ جست‌وجو'),
      el('div', { class: 'muted small' }, 'اگر نتایج جست‌وجو ناقص به نظر می‌رسد این را اجرا کنید')),
    el('button', {
      class: 'btn btn--sm',
      onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await api.rebuildSearch(); toast(`نمایهٔ ${fa(r.rebuilt)} رکورد بازسازی شد`); }
        catch (err) { toast(err.message, 'error'); }
        finally { e.target.disabled = false; }
      },
    }, 'اجرا')));

  mBody.append(el('div', { class: 'switch-row' },
    el('div', {},
      el('div', {}, 'فشرده‌سازی پایگاه داده'),
      el('div', { class: 'muted small' }, 'حجم فایل پایگاه داده را کم می‌کند')),
    el('button', {
      class: 'btn btn--sm',
      onclick: async (e) => {
        e.target.disabled = true;
        try { await api.vacuum(); toast('پایگاه داده فشرده شد'); }
        catch (err) { toast(err.message, 'error'); }
        finally { e.target.disabled = false; }
      },
    }, 'اجرا')));

  maint.append(mBody);
  host.append(maint);
}

/* =========================================================== پشتیبان‌گیری */

async function renderBackup(host) {
  host.append(el('div', { class: 'card mb' },
    el('div', { class: 'card__body stack' },
      el('div', { class: 'strong' }, '🛡 چرا پشتیبان‌گیری مهم است؟'),
      el('div', { class: 'muted small' },
        'همهٔ اطلاعاتی که وارد کرده‌اید در یک فایل روی همین رایانه نگهداری می‌شود. اگر آن فایل آسیب ببیند، اطلاعات از دست می‌رود. ' +
        'پشتیبان بگیرید و فایل پشتیبان را روی یکی از هاردهای خودتان هم کپی کنید.'),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn btn--primary',
          onclick: async (e) => {
            e.target.disabled = true;
            try { const r = await api.makeBackup(); toast(`پشتیبان ساخته شد (${fa(r.size_kb)} کیلوبایت)`); renderSettings(document.getElementById('view-root'), { tab: 'backup' }); }
            catch (err) { toast(err.message, 'error'); }
            finally { e.target.disabled = false; }
          },
        }, '＋ ساخت پشتیبان همین حالا'),
        el('button', {
          class: 'btn',
          onclick: () => { window.location.href = '/api/export/json'; toast('فایل پشتیبان در حال دانلود است…', 'info'); },
        }, '⤓ دانلود پشتیبان روی رایانه')))));

  const listCard = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'پشتیبان‌های ذخیره‌شده')));
  const body = el('div', {});
  listCard.append(body);
  host.append(listCard);
  body.append(loading());

  let backups;
  try { backups = await api.backups(); }
  catch (e) { body.innerHTML = ''; return toast(e.message, 'error'); }
  body.innerHTML = '';

  if (!backups.length) {
    body.append(el('div', { class: 'card__body' },
      el('div', { class: 'muted text-center', style: { padding: '18px' } }, 'هنوز پشتیبانی ساخته نشده است')));
    return;
  }

  const table = el('table', { class: 'data' });
  table.innerHTML = '<thead><tr><th>نام فایل</th><th>حجم</th><th>زمان ساخت</th><th class="col-actions"></th></tr></thead>';
  const tbody = el('tbody');
  for (const b of backups) {
    const tr = el('tr');
    tr.append(el('td', { class: 'ltr small' }, b.name));
    tr.append(el('td', { class: 'small num' }, `${fa(b.size_kb)} کیلوبایت`));
    tr.append(el('td', { class: 'small muted' }, ago(new Date(b.mtime).toISOString())));
    tr.append(el('td', { class: 'col-actions row row--tight', style: { justifyContent: 'flex-end' } },
      el('button', {
        class: 'btn btn--ghost btn--sm', title: 'حذف',
        onclick: async () => {
          if (!await confirmDialog({ title: 'حذف پشتیبان', message: `فایل «${b.name}» حذف شود؟`, danger: true, confirmText: 'حذف' })) return;
          await api.deleteBackup(b.name);
          toast('حذف شد');
          renderSettings(document.getElementById('view-root'), { tab: 'backup' });
        },
      }, '🗑')));
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(el('div', { class: 'table-wrap' }, table));
}

/* ========================================================== خروجی و ورودی */

function renderTransfer(host) {
  host.append(el('div', { class: 'card mb' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, '⤓ گرفتن خروجی')),
    el('div', { class: 'card__body stack' },
      el('div', { class: 'switch-row' },
        el('div', {},
          el('div', {}, 'فایل اکسل (CSV) از فهرست رکوردها'),
          el('div', { class: 'muted small' }, 'برای مشاهده در اکسل یا اشتراک‌گذاری با دیگران')),
        el('button', {
          class: 'btn btn--sm',
          onclick: () => { window.location.href = '/api/export/csv'; toast('در حال دانلود…', 'info'); },
        }, 'دانلود')),
      el('div', { class: 'switch-row' },
        el('div', {},
          el('div', {}, 'پشتیبان کامل (JSON)'),
          el('div', { class: 'muted small' }, 'همهٔ اطلاعات؛ برای انتقال به رایانهٔ دیگر یا بازیابی')),
        el('button', {
          class: 'btn btn--sm',
          onclick: () => { window.location.href = '/api/export/json'; toast('در حال دانلود…', 'info'); },
        }, 'دانلود')))));

  const importCard = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, '⤒ بازیابی از فایل پشتیبان')));
  const fileInput = el('input', { type: 'file', accept: '.json', class: 'input' });
  importCard.append(el('div', { class: 'card__body stack' },
    el('div', { style: { color: 'var(--danger)' } },
      '⚠️ هشدار: با بازیابی، همهٔ اطلاعات فعلی پاک و با محتوای فایل پشتیبان جایگزین می‌شود.'),
    el('div', { class: 'muted small' }, 'پیش از بازیابی، یک پشتیبان از وضعیت فعلی بگیرید.'),
    fileInput,
    el('button', {
      class: 'btn btn--danger',
      onclick: async () => {
        const file = fileInput.files?.[0];
        if (!file) return toast('ابتدا فایل پشتیبان را انتخاب کنید', 'warn');
        let payload;
        try { payload = JSON.parse(await file.text()); }
        catch { return toast('فایل انتخاب‌شده یک پشتیبان معتبر نیست', 'error'); }
        const counts = payload?.meta?.counts;
        const ok = await confirmDialog({
          title: 'بازیابی اطلاعات',
          message: `همهٔ اطلاعات فعلی پاک می‌شود و این پشتیبان جایگزین آن می‌گردد.<br>` +
            (counts ? `<span class="muted small">محتوای فایل: ${fa(counts.items)} رکورد، ${fa(counts.drives)} هارد، ${fa(counts.copies)} نسخه</span>` : ''),
          confirmText: 'بله، بازیابی کن', danger: true,
        });
        if (!ok) return;
        try {
          const r = await api.importAll(payload);
          await refreshReference();
          toast(`${fa(r.items)} رکورد بازیابی شد`);
          go('dashboard');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'بازیابی از این فایل')));
  host.append(importCard);
}

/* ============================================================== رویدادها */

async function renderActivity(host) {
  host.append(loading());
  let rows;
  try { rows = await api.activity(200); }
  catch (e) { host.innerHTML = ''; return toast(e.message, 'error'); }
  host.innerHTML = '';

  if (!rows.length) return host.append(emptyState({ icon: '📜', title: 'رویدادی ثبت نشده است' }));

  const ACTIONS = {
    create: ['ثبت', 'badge--ok'], update: ['ویرایش', 'badge--info'],
    delete: ['حذف', 'badge--danger'], import: ['بازیابی', 'badge--warn'],
    export: ['خروجی', ''], backup: ['پشتیبان', 'badge--brand'],
  };

  const card = el('div', { class: 'card' });
  const table = el('table', { class: 'data' });
  table.innerHTML = '<thead><tr><th>زمان</th><th>عملیات</th><th>شرح</th><th>کاربر</th></tr></thead>';
  const tbody = el('tbody');
  for (const a of rows) {
    const [label, cls] = ACTIONS[a.action] || [a.action, ''];
    tbody.append(el('tr', {},
      el('td', { class: 'small num muted' }, fa(a.at_jalali || '')),
      el('td', {}, el('span', { class: `badge ${cls}` }, label)),
      el('td', { class: 'small' }, a.summary || '—'),
      el('td', { class: 'small muted' }, a.actor || '—')));
  }
  table.append(tbody);
  card.append(el('div', { class: 'table-wrap' }, table));
  host.append(card);
}

/* ================================================================ درباره */

async function renderAbout(host) {
  const card = el('div', { class: 'card mb' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'دربارهٔ این نرم‌افزار')));
  const body = el('div', { class: 'card__body stack' });
  body.append(
    el('div', {}, 'نرم‌افزار مدیریت آرشیو صوتی و تصویری — برای فهرست‌برداری و پیدا کردن آسان فایل‌هایی که روی هاردهای مختلف پراکنده‌اند.'),
    el('div', { class: 'muted small' },
      'فایل‌های صوتی و تصویری در این برنامه نگهداری نمی‌شوند؛ تنها اطلاعات آن‌ها (عنوان، تاریخ، محل نگهداری، نواقص و …) ثبت می‌شود.'));

  let info;
  try { info = await api.info(); } catch { info = null; }
  if (info) {
    body.append(el('hr', { class: 'divider' }));
    const grid = el('div', { class: 'detail-grid' });
    const row = (l, v) => grid.append(el('div', { class: 'detail-item' },
      el('div', { class: 'detail-item__label' }, l),
      el('div', { class: 'detail-item__value ltr small' }, v)));
    row('محل پایگاه داده', info.db_path);
    row('حجم پایگاه داده', `${fa(info.db_size_mb)} مگابایت`);
    row('پوشهٔ پشتیبان‌ها', info.backup_dir);
    row('نگارش Node.js', info.node);
    grid.append(el('div', { class: 'detail-item' },
      el('div', { class: 'detail-item__label' }, 'تاریخ امروز'),
      el('div', { class: 'detail-item__value' }, fa(info.today))));
    body.append(grid);
  }
  card.append(body);
  host.append(card);

  const help = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'میان‌برهای صفحه‌کلید')));
  const hb = el('div', { class: 'card__body stack' });
  for (const [k, d] of [
    ['Ctrl + K', 'رفتن به جست‌وجو'],
    ['N', 'ثبت رکورد تازه'],
    ['G سپس D', 'رفتن به داشبورد'],
    ['G سپس A', 'رفتن به آرشیو'],
    ['G سپس H', 'رفتن به هاردها'],
    ['Ctrl + S', 'ذخیره در فرم باز'],
    ['Esc', 'بستن پنجره'],
  ]) {
    hb.append(el('div', { class: 'switch-row' },
      el('span', {}, d), el('kbd', {}, k)));
  }
  help.append(hb);
  host.append(help);
}
