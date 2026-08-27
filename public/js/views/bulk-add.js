/**
 * افزودن گروهی — ثبت یک مجموعهٔ کامل (مثلاً ۴۰ جلسهٔ تفسیر) در یک مرحله
 *
 * سه راه برای ساختن فهرست:
 *   ۱) پویش پوشهٔ هارد — نرم‌افزار خودش فایل‌ها را می‌خواند (بدون تایپ)
 *   ۲) چسباندن فهرست نام‌ها — وقتی هارد وصل نیست
 *   ۳) تولید خودکار جلسات — «جلسهٔ ۱ تا ۴۰» ساخته می‌شود
 */
import {
  api, state, fa, size, parseDuration, refreshReference,
  MEDIA_KINDS, QUALITIES, categoryOptions, J,
} from '../core.js';
import {
  el, modal, toast, select, field, jalaliInput, tagInput, suggestInput, confirmDialog,
} from '../components.js';

const TOKEN_SERIES = '{مجموعه}';
const TOKEN_NUMBER = '{شماره}';
const TOKEN_FILE = '{نام فایل}';
const DEFAULT_PATTERN = `${TOKEN_SERIES} — جلسهٔ ${TOKEN_NUMBER}`;

export function openBulkAdd(onSaved) {
  let rows = [];
  const body = el('div', { class: 'stack' });

  /* ================================================== بخش ۱: منبع فهرست */
  const sourceTabs = el('div', { class: 'tabs' });
  const panes = {};
  const SOURCES = [
    ['scan', '📁 پویش پوشهٔ هارد'],
    ['paste', '📋 چسباندن فهرست'],
    ['generate', '🔢 تولید خودکار جلسات'],
  ];
  for (const [key, label] of SOURCES) {
    const t = el('button', { class: `tab${key === 'scan' ? ' is-active' : ''}`, type: 'button' }, label);
    t.addEventListener('click', () => {
      sourceTabs.querySelectorAll('.tab').forEach((x, i) => x.classList.toggle('is-active', SOURCES[i][0] === key));
      for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== key;
    });
    sourceTabs.append(t);
    panes[key] = el('div', { class: 'stack' });
    panes[key].hidden = key !== 'scan';
  }

  /* ------------------------------------------------------ ۱) پویش پوشه */
  const pathInput = el('input', {
    class: 'input ltr', placeholder: 'D:\\Archive\\Tafsir\\Baghareh',
    style: { flex: '1', minWidth: '250px' },
  });
  const recursiveBox = el('input', { type: 'checkbox' });
  const durationBox = el('input', { type: 'checkbox' });
  const durationLabel = el('label', { class: 'checkbox' }, durationBox, el('span', {}, 'مدت زمان فایل‌ها هم خوانده شود'));

  const kindBoxes = {};
  const kindRow = el('div', { class: 'row row--tight' });
  for (const [key, meta] of Object.entries(MEDIA_KINDS)) {
    if (key === 'other') continue;
    const cb = el('input', { type: 'checkbox' });
    cb.checked = key === 'audio' || key === 'video';
    kindBoxes[key] = cb;
    kindRow.append(el('label', { class: 'checkbox' }, cb, el('span', {}, `${meta.icon} ${meta.label}`)));
  }

  const scanBtn = el('button', { class: 'btn btn--primary', type: 'button' }, '🔍 خواندن فایل‌ها');
  const scanStatus = el('div', { class: 'small muted' });

  panes.scan.append(
    el('div', { class: 'field' },
      el('label', { class: 'field__label' }, 'مسیر پوشه روی هارد'),
      el('div', { class: 'row row--tight' }, pathInput, scanBtn),
      el('div', { class: 'field__hint' },
        'در ویندوز پوشه را باز کنید، روی نوار نشانی بالای پنجره کلیک کنید، مسیر را کپی کرده و اینجا بچسبانید.')),
    el('div', { class: 'row' },
      el('label', { class: 'checkbox' }, recursiveBox, el('span', {}, 'زیرپوشه‌ها هم خوانده شود')),
      durationLabel),
    el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'کدام نوع فایل‌ها؟'), kindRow),
    scanStatus);

  api.scanTools().then((t) => {
    if (!t.ffprobe) {
      durationBox.disabled = true;
      durationLabel.append(el('span', { class: 'muted small' }, ' — نیازمند نصب ffmpeg روی رایانه'));
    }
  }).catch(() => { durationBox.disabled = true; });

  /* --------------------------------------------------- ۲) چسباندن فهرست */
  const pasteArea = el('textarea', {
    class: 'textarea ltr', style: { minHeight: '140px' },
    placeholder: '01-jalase-01.mp3\n02-jalase-02.mp3\n03-jalase-03.mp3',
  });
  const pasteBtn = el('button', { class: 'btn btn--primary', type: 'button' }, 'ساخت فهرست');
  panes.paste.append(
    el('div', { class: 'field' },
      el('label', { class: 'field__label' }, 'هر خط، یک رکورد'),
      pasteArea,
      el('div', { class: 'field__hint' },
        'نام فایل‌ها یا عنوان جلسات را بچسبانید. اگر در متن شماره‌ای باشد، خودکار شمارهٔ جلسه شناخته می‌شود.')),
    el('div', { class: 'row' }, pasteBtn));

  /* ------------------------------------------------ ۳) تولید خودکار جلسات */
  const fromNo = el('input', { class: 'input', type: 'number', min: '1', value: '1', style: { maxWidth: '100px' } });
  const toNo = el('input', { class: 'input', type: 'number', min: '1', value: '40', style: { maxWidth: '100px' } });
  const genBtn = el('button', { class: 'btn btn--primary', type: 'button' }, 'ساخت فهرست');
  panes.generate.append(
    el('div', { class: 'field' },
      el('label', { class: 'field__label' }, 'از جلسهٔ … تا جلسهٔ …'),
      el('div', { class: 'row row--tight' }, fromNo, el('span', { class: 'muted' }, 'تا'), toNo, genBtn),
      el('div', { class: 'field__hint' },
        'برای وقتی که هارد در دسترس نیست. بعداً می‌توانید مسیر فایل هر جلسه را کامل کنید.')));

  body.append(el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, '۱ — فهرست از کجا ساخته شود؟')),
    el('div', { class: 'card__body' }, sourceTabs, ...Object.values(panes))));

  /* ============================================== بخش ۲: اطلاعات مشترک */
  const S = {};
  const sharedGrid = el('div', { class: 'form-grid' });

  S.series = suggestInput({ suggestions: state.facets.series || [], placeholder: 'مثال: تفسیر سورهٔ بقره' });
  sharedGrid.append(field('نام مجموعه', S.series, { hint: 'روی همهٔ رکوردها ثبت می‌شود' }));

  S.pattern = el('input', { class: 'input', value: DEFAULT_PATTERN });
  sharedGrid.append(field('الگوی عنوان', S.pattern,
    { hint: `${TOKEN_SERIES} ، ${TOKEN_NUMBER} و ${TOKEN_FILE} جایگزین می‌شوند` }));

  S.media_kind = select({ options: MEDIA_KINDS, value: 'audio' });
  sharedGrid.append(field('نوع رسانه', S.media_kind, { hint: 'در پویش پوشه از روی پسوند فایل تشخیص داده می‌شود' }));

  S.speaker_id = select({
    options: state.speakers.map((s) => ({ value: s.id, label: s.name })),
    value: state.settings.default_speaker_id || '', placeholder: 'انتخاب کنید',
  });
  sharedGrid.append(field('سخنران / گوینده', S.speaker_id));

  S.category_id = select({
    options: categoryOptions().map((c) => ({ value: c.id, label: c.label })), placeholder: 'بدون دسته',
  });
  sharedGrid.append(field('دسته‌بندی', S.category_id));

  S.drive_id = select({
    options: state.drives.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
    placeholder: 'کدام هارد؟',
  });
  sharedGrid.append(field('هارد نگهدارندهٔ فایل‌ها', S.drive_id, { hint: 'برای همهٔ نسخه‌ها یکسان است' }));

  S.folder_path = el('input', { class: 'input ltr', placeholder: 'در پویش پوشه خودکار پر می‌شود' });
  sharedGrid.append(field('مسیر پوشه', S.folder_path));

  S.occasion = suggestInput({ suggestions: state.facets.occasions || [], placeholder: 'مثال: ماه رمضان' });
  sharedGrid.append(field('مناسبت', S.occasion));

  S.event_place = suggestInput({ suggestions: state.facets.places || [], placeholder: 'مثال: مسجد جامع عتیق' });
  sharedGrid.append(field('محل ایراد', S.event_place));

  S.city = suggestInput({ suggestions: state.facets.cities || [], placeholder: 'مثال: شیراز' });
  sharedGrid.append(field('شهر', S.city));

  S.topic = el('input', { class: 'input', placeholder: 'موضوع مشترک همهٔ جلسات' });
  sharedGrid.append(field('موضوع', S.topic));

  S.quality = select({ options: QUALITIES, value: 'unknown' });
  sharedGrid.append(field('کیفیت', S.quality));

  S.source = suggestInput({ suggestions: state.facets.sources || [], placeholder: 'از کجا تهیه شده' });
  sharedGrid.append(field('منبع تهیه', S.source));

  S.contributor = suggestInput({ suggestions: state.facets.contributors || [], placeholder: 'چه کسی تحویل داده' });
  sharedGrid.append(field('تحویل‌دهنده', S.contributor));

  S.registered_by = suggestInput({
    value: state.settings.current_user || '', suggestions: state.facets.registrars || [],
  });
  sharedGrid.append(field('ثبت‌کننده', S.registered_by));

  S.registered_at = jalaliInput({ value: state.today });
  sharedGrid.append(field('تاریخ ثبت', S.registered_at));

  S.tags = tagInput({ suggestions: state.tags.map((t) => t.name) });
  sharedGrid.append(field('برچسب‌ها', S.tags, { wide: true }));

  S.pattern.addEventListener('input', () => { retitle(); renderPreview(); });
  S.series.querySelector('input').addEventListener('input', () => { retitle(); renderPreview(); });

  body.append(el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title' }, '۲ — اطلاعات مشترک همهٔ رکوردها'),
      el('span', { class: 'muted small', style: { marginInlineStart: 'auto' } },
        'یک‌بار پر می‌شوند و روی همهٔ ردیف‌ها می‌نشینند')),
    el('div', { class: 'card__body' }, sharedGrid)));

  /* =============================================== بخش ۳: پیش‌نمایش ردیف‌ها */
  const previewHost = el('div', {});
  const countLabel = el('span', { class: 'muted small', style: { marginInlineStart: 'auto' } });
  body.append(el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title' }, '۳ — پیش‌نمایش و ویرایش'), countLabel),
    previewHost));

  /* -------------------------------------------------------------- پنجره */
  const saveBtn = el('button', { class: 'btn btn--primary' }, 'ثبت رکوردها');
  const cancelBtn = el('button', { class: 'btn' }, 'انصراف');
  const m = modal({
    title: 'افزودن گروهی — ثبت یک مجموعهٔ کامل',
    body, size: 'modal--wide', closeOnBackdrop: false,
    footer: [el('span', { class: 'spacer' }), cancelBtn, saveBtn],
  });
  cancelBtn.addEventListener('click', () => m.close());
  renderPreview();

  /* ============================================================== رفتارها */

  scanBtn.addEventListener('click', async () => {
    const path = pathInput.value.trim();
    if (!path) { pathInput.focus(); return toast('مسیر پوشه را وارد کنید', 'warn'); }
    scanBtn.disabled = true;
    scanStatus.textContent = 'در حال خواندن پوشه…';
    try {
      const kinds = Object.entries(kindBoxes).filter(([, cb]) => cb.checked).map(([k]) => k);
      const result = await api.scan({
        path, recursive: recursiveBox.checked, kinds,
        drive_id: S.drive_id.value || null,
        with_duration: durationBox.checked && !durationBox.disabled,
      });

      if (!result.files.length) {
        rows = []; renderPreview();
        scanStatus.textContent = 'در این پوشه فایلی از نوع انتخاب‌شده پیدا نشد.';
        return;
      }
      if (!S.folder_path.value) S.folder_path.value = result.root;
      if (!S.series.value) {
        const folderName = result.root.split(/[\\/]/).filter(Boolean).pop();
        if (folderName) S.series.value = folderName;
      }

      rows = result.files.map((f) => ({
        checked: !f.registered,
        number: f.number,
        title: '', titleEdited: false,
        file_name: f.file_name,
        folder_path: f.folder_path,
        file_format: f.file_format,
        media_kind: f.media_kind,
        size_mb: f.size_mb,
        duration_sec: f.duration_sec ?? null,
        speech_date: '',
        registered: f.registered,
      }));
      retitle();
      renderPreview();

      const notes = [`${fa(result.files.length)} فایل پیدا شد`];
      if (result.registered_count) notes.push(`${fa(result.registered_count)} مورد از پیش ثبت شده و تیک نخورده است`);
      if (result.truncated) notes.push('فهرست به ۳۰۰۰ فایل محدود شد');
      if (durationBox.checked && !result.duration_read) notes.push('مدت زمان خوانده نشد');
      scanStatus.textContent = notes.join(' — ');
      toast(`${fa(result.files.length)} فایل خوانده شد`);
    } catch (e) {
      scanStatus.textContent = '';
      toast(e.message, 'error');
    } finally { scanBtn.disabled = false; }
  });

  pasteBtn.addEventListener('click', () => {
    const lines = pasteArea.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return toast('چیزی برای ساختن فهرست وارد نشده است', 'warn');
    rows = lines.map((line) => {
      const isFile = /\.[a-z0-9]{2,5}$/i.test(line);
      return {
        checked: true,
        number: guessNumber(line),
        title: isFile ? '' : line,
        titleEdited: !isFile,
        file_name: isFile ? line : '',
        folder_path: S.folder_path.value || '',
        file_format: isFile ? line.split('.').pop().toLowerCase() : '',
        media_kind: S.media_kind.value,
        size_mb: null, duration_sec: null, speech_date: '', registered: null,
      };
    });
    retitle();
    renderPreview();
    toast(`${fa(rows.length)} ردیف ساخته شد`);
  });

  genBtn.addEventListener('click', () => {
    const a = Number(fromNo.value) || 1;
    const b = Number(toNo.value) || 1;
    if (b < a) return toast('شمارهٔ پایان باید بزرگ‌تر از شمارهٔ آغاز باشد', 'warn');
    if (b - a + 1 > 500) return toast('در هر بار حداکثر ۵۰۰ جلسه می‌توان ساخت', 'warn');
    rows = [];
    for (let i = a; i <= b; i++) {
      rows.push({
        checked: true, number: i, title: '', titleEdited: false,
        file_name: '', folder_path: S.folder_path.value || '', file_format: '',
        media_kind: S.media_kind.value, size_mb: null, duration_sec: null,
        speech_date: '', registered: null,
      });
    }
    retitle();
    renderPreview();
    toast(`${fa(rows.length)} جلسه ساخته شد`);
  });

  /** عنوان‌ها را از روی الگو می‌سازد؛ عنوان‌هایی که دستی ویرایش شده‌اند دست‌نخورده می‌مانند */
  function retitle() {
    const pattern = S.pattern.value || DEFAULT_PATTERN;
    const series = S.series.value || '';
    for (const r of rows) {
      if (r.titleEdited) continue;
      r.title = pattern
        .split(TOKEN_SERIES).join(series)
        .split(TOKEN_NUMBER).join(r.number != null ? String(r.number) : '')
        .split(TOKEN_FILE).join(stripExt(r.file_name))
        .replace(/\s{2,}/g, ' ')
        .replace(/[—–-]\s*$/, '')
        .trim();
      if (!r.title) r.title = stripExt(r.file_name) || 'بدون عنوان';
    }
  }

  function renderPreview() {
    previewHost.innerHTML = '';
    const checked = rows.filter((r) => r.checked).length;
    countLabel.textContent = rows.length ? `${fa(checked)} از ${fa(rows.length)} ردیف انتخاب شده` : '';
    saveBtn.textContent = checked ? `ثبت ${fa(checked)} رکورد` : 'ثبت رکوردها';
    saveBtn.disabled = !checked;

    if (!rows.length) {
      previewHost.append(el('div', { class: 'card__body' },
        el('div', { class: 'muted text-center', style: { padding: '26px' } },
          'هنوز فهرستی ساخته نشده است. از بخش ۱ بالا یکی از سه روش را انتخاب کنید.')));
      return;
    }

    /* نوار ابزار بالای جدول */
    const bar = el('div', { class: 'card__body row', style: { paddingBottom: '0' } });
    const allBox = el('input', { type: 'checkbox' });
    allBox.checked = rows.every((r) => r.checked);
    allBox.addEventListener('change', () => {
      for (const r of rows) r.checked = allBox.checked;
      renderPreview();
    });
    bar.append(el('label', { class: 'checkbox' }, allBox, el('span', { class: 'small' }, 'انتخاب همه')));

    if (rows.some((r) => r.registered)) {
      bar.append(el('button', {
        class: 'btn btn--sm', type: 'button',
        onclick: () => { rows = rows.filter((r) => !r.registered); renderPreview(); },
      }, 'حذف ردیف‌های از پیش ثبت‌شده'));
    }

    const bulkDate = jalaliInput({ value: '' });
    bulkDate.querySelector('input').classList.add('input--sm');
    bulkDate.style.width = '150px';
    bar.append(el('div', { class: 'row row--tight', style: { marginInlineStart: 'auto' } },
      el('span', { class: 'small muted' }, 'تاریخ ایراد یکسان:'), bulkDate,
      el('button', {
        class: 'btn btn--sm', type: 'button',
        onclick: () => {
          const v = bulkDate.value;
          if (!v) return toast('ابتدا تاریخ را وارد کنید', 'warn');
          for (const r of rows) if (r.checked) r.speech_date = v;
          renderPreview();
          toast('تاریخ روی ردیف‌های انتخاب‌شده ثبت شد');
        },
      }, 'اعمال')));
    previewHost.append(bar);

    /* جدول ردیف‌ها */
    const table = el('table', { class: 'data' });
    table.innerHTML = `<thead><tr>
      <th style="width:1%"></th><th style="width:1%">جلسه</th><th>عنوان</th><th>نام فایل</th>
      <th style="width:1%">حجم</th><th style="width:1%">مدت</th><th style="width:1%">تاریخ ایراد</th>
      <th style="width:1%"></th></tr></thead>`;
    const tbody = el('tbody');

    rows.forEach((r) => {
      const tr = el('tr');
      if (r.registered) tr.style.opacity = '.55';

      const cb = el('input', { type: 'checkbox' });
      cb.checked = r.checked;
      cb.addEventListener('change', () => {
        r.checked = cb.checked;
        const n = rows.filter((x) => x.checked).length;
        countLabel.textContent = `${fa(n)} از ${fa(rows.length)} ردیف انتخاب شده`;
        saveBtn.textContent = n ? `ثبت ${fa(n)} رکورد` : 'ثبت رکوردها';
        saveBtn.disabled = !n;
      });
      tr.append(el('td', {}, cb));

      const numIn = el('input', { class: 'input input--sm', type: 'number', style: { width: '66px' } });
      numIn.value = r.number ?? '';
      const titleIn = el('input', { class: 'input input--sm' });
      titleIn.value = r.title;

      numIn.addEventListener('input', () => {
        r.number = numIn.value === '' ? null : Number(numIn.value);
        if (!r.titleEdited) { retitle(); titleIn.value = r.title; }
      });
      titleIn.addEventListener('input', () => { r.title = titleIn.value; r.titleEdited = true; });

      tr.append(el('td', {}, numIn));
      tr.append(el('td', {}, titleIn));
      tr.append(el('td', { class: 'ltr small truncate', style: { maxWidth: '220px' }, title: r.file_name || '' },
        r.file_name || el('span', { class: 'muted' }, '—')));
      tr.append(el('td', { class: 'small num muted' }, r.size_mb ? size(r.size_mb) : '—'));

      const durIn = el('input', { class: 'input input--sm ltr', style: { width: '80px' }, placeholder: '00:00:00' });
      durIn.value = r.duration_sec ? plainHms(r.duration_sec) : '';
      durIn.addEventListener('input', () => { r.duration_sec = parseDuration(durIn.value); });
      tr.append(el('td', {}, durIn));

      const dateWrap = jalaliInput({ value: r.speech_date });
      dateWrap.querySelector('input').classList.add('input--sm');
      dateWrap.style.width = '130px';
      dateWrap.querySelector('input').addEventListener('change', () => { r.speech_date = dateWrap.value; });
      tr.append(el('td', {}, dateWrap));

      const actions = el('td', { class: 'row row--tight' });
      if (r.registered) {
        actions.append(el('span', {
          class: 'badge badge--warn', title: `از پیش ثبت شده با کد ${r.registered.code}`,
        }, 'ثبت شده'));
      }
      actions.append(el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', title: 'حذف این ردیف',
        onclick: () => { rows = rows.filter((x) => x !== r); renderPreview(); },
      }, '✕'));
      tr.append(actions);

      tbody.append(tr);
    });

    table.append(tbody);
    previewHost.append(el('div', { class: 'table-wrap', style: { maxHeight: '440px', overflowY: 'auto' } }, table));
  }

  /* -------------------------------------------------------------- ذخیره */
  saveBtn.addEventListener('click', async () => {
    const selected = rows.filter((r) => r.checked);
    if (!selected.length) return toast('هیچ ردیفی انتخاب نشده است', 'warn');

    const untitled = selected.filter((r) => !r.title.trim());
    if (untitled.length) return toast(`${fa(untitled.length)} ردیف عنوان ندارد`, 'warn');

    const driveId = S.drive_id.value || null;
    if (selected.some((r) => r.file_name) && !driveId) {
      const ok = await confirmDialog({
        title: 'هارد انتخاب نشده',
        message: 'هاردی انتخاب نکرده‌اید، پس مشخص نمی‌شود این فایل‌ها کجا نگهداری می‌شوند.<br>' +
          '<span class="muted small">می‌توانید بعداً برای هر رکورد نسخه اضافه کنید.</span>',
        confirmText: 'بدون هارد ثبت کن',
      });
      if (!ok) return;
    }

    const dup = selected.filter((r) => r.registered);
    if (dup.length) {
      const ok = await confirmDialog({
        title: 'رکوردهای تکراری',
        message: `${fa(dup.length)} ردیف از پیش در آرشیو ثبت شده‌اند. اگر ادامه دهید، رکورد تکراری ساخته می‌شود.`,
        confirmText: 'با این حال ثبت کن', danger: true,
      });
      if (!ok) return;
    }

    const shared = {
      series: S.series.value || null,
      speaker_id: S.speaker_id.value || null,
      category_id: S.category_id.value || null,
      occasion: S.occasion.value || null,
      event_place: S.event_place.value || null,
      city: S.city.value || null,
      topic: S.topic.value.trim() || null,
      quality: S.quality.value,
      source: S.source.value || null,
      contributor: S.contributor.value || null,
      registered_by: S.registered_by.value || null,
      registered_at: S.registered_at.value || state.today,
      part_total: selected.length,
      tags: S.tags.value,
    };

    const payloadRows = selected.map((r) => {
      const row = {
        title: r.title.trim(),
        part_no: r.number ?? null,
        media_kind: r.media_kind || S.media_kind.value,
        speech_date: r.speech_date || null,
        duration_sec: r.duration_sec ?? null,
      };
      if (driveId) {
        row.copies = [{
          drive_id: driveId,
          folder_path: r.folder_path || S.folder_path.value || null,
          file_name: r.file_name || null,
          file_format: r.file_format || null,
          size_mb: r.size_mb ?? null,
          duration_sec: r.duration_sec ?? null,
          copy_role: 'master',
          health: r.file_name ? 'ok' : 'unchecked',
        }];
      }
      return row;
    });

    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = 'در حال ثبت…';
    try {
      const res = await api.batchItems({ shared, rows: payloadRows });
      await refreshReference();
      toast(`${fa(res.created)} رکورد ثبت شد`);
      m.close();
      onSaved?.(res);
    } catch (e) {
      toast(e.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });
}

/* ---------------------------------------------------------------- کمکی‌ها */

function stripExt(name) {
  return String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
}

function plainHms(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** همان منطق سرور، برای فهرستی که کاربر می‌چسباند */
function guessNumber(text) {
  const normalized = J.toEnglishDigits(stripExt(text));
  const labelled = normalized.match(/(?:جلسه|جلسهٔ|قسمت|شماره|شمارهٔ|part|no|ep)\s*[.\-_]?\s*(\d{1,4})/i);
  if (labelled) return Number(labelled[1]);
  const numbers = [...normalized.matchAll(/\d+/g)].map((mm) => ({ value: Number(mm[0]), raw: mm[0] }));
  if (!numbers.length) return null;
  const plausible = numbers.filter((n) => {
    if (n.raw.length >= 4 && ((n.value >= 1300 && n.value <= 1500) || (n.value >= 1900 && n.value <= 2100))) return false;
    if (/^(?:1080|720|480|360|240|128|192|256|320)$/.test(n.raw)) return false;
    return true;
  });
  return (plausible.length ? plausible : numbers)[0].value;
}
