/** فرم ثبت و ویرایش رکورد آرشیو */
import {
  api, state, fa, parseDuration, refreshReference,
  MEDIA_KINDS, QUALITIES, COMPLETENESS, DEFECT_FLAGS, COPY_ROLES, COPY_HEALTH, PRIORITIES,
  categoryOptions,
} from '../core.js';
import {
  el, modal, toast, select, field, jalaliInput, tagInput, suggestInput, starInput,
} from '../components.js';

/**
 * باز کردن فرم رکورد
 * @param {number|null} id شناسه برای ویرایش، خالی برای ثبت تازه
 * @param {Function} onSaved پس از ذخیره فراخوانی می‌شود
 * @param {object} preset مقادیر پیش‌فرض برای ثبت تازه
 */
export async function openItemForm(id = null, onSaved = null, preset = {}) {
  let item = {
    media_kind: 'audio',
    speaker_id: state.settings.default_speaker_id ? Number(state.settings.default_speaker_id) : null,
    quality: 'unknown', completeness: 'complete', language: 'فارسی',
    registered_at: state.today, registered_by: state.settings.current_user || '',
    defect_list: [], tags: [], copies: [], rating: 0, priority: 0,
    ...preset,
  };

  if (id) {
    try { item = await api.item(id); }
    catch (e) { return toast(e.message, 'error'); }
  }

  const F = {};                                  // ارجاع به کنترل‌های فرم
  const body = el('div', {});

  /* ------------------------------------------------------------- زبانه‌ها */
  const tabs = el('div', { class: 'tabs' });
  const panes = {};
  const TABS = [
    ['main', 'اطلاعات اصلی'],
    ['detail', 'جزئیات و زمان'],
    ['files', 'فایل‌ها و هاردها'],
    ['status', 'وضعیت و نواقص'],
    ['notes', 'توضیحات'],
  ];
  let activeTab = 'main';
  const setTab = (key) => {
    activeTab = key;
    for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== key;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === key));
  };
  for (const [key, label] of TABS) {
    const t = el('button', { class: 'tab', dataset: { tab: key }, type: 'button' }, label);
    t.addEventListener('click', () => setTab(key));
    tabs.append(t);
    panes[key] = el('div', { class: 'form-grid' });
  }
  body.append(tabs, ...Object.values(panes));

  /* --------------------------------------------------- زبانهٔ اطلاعات اصلی */
  F.title = el('input', { class: 'input', placeholder: 'مثال: تفسیر سورهٔ بقره — جلسهٔ ۱' });
  F.title.value = item.title || '';
  panes.main.append(field('عنوان رکورد', F.title, { wide: true, required: true }));

  F.alt_title = el('input', { class: 'input', placeholder: 'عنوان دیگری که این فایل با آن شناخته می‌شود' });
  F.alt_title.value = item.alt_title || '';
  panes.main.append(field('عنوان فرعی', F.alt_title, { wide: true, hint: 'اختیاری — برای پیدا کردن آسان‌تر هنگام جست‌وجو' }));

  F.media_kind = select({ options: MEDIA_KINDS, value: item.media_kind });
  panes.main.append(field('نوع رسانه', F.media_kind, { required: true }));

  F.speaker_id = select({
    options: state.speakers.map((s) => ({ value: s.id, label: `${s.name}${s.role ? ' — ' + s.role : ''}` })),
    value: item.speaker_id, placeholder: 'انتخاب کنید',
  });
  const speakerRow = el('div', { class: 'row row--tight' }, F.speaker_id,
    el('button', { class: 'btn btn--sm', type: 'button', title: 'افزودن شخص تازه', onclick: () => quickAddSpeaker(F.speaker_id) }, '＋'));
  F.speaker_id.style.flex = '1';
  panes.main.append(field('سخنران / گوینده', speakerRow, { hint: 'این فایل مربوط به چه کسی است' }));

  F.category_id = select({
    options: categoryOptions().map((c) => ({ value: c.id, label: c.label })),
    value: item.category_id, placeholder: 'بدون دسته',
  });
  panes.main.append(field('دسته‌بندی', F.category_id));

  F.series = suggestInput({
    value: item.series || '', suggestions: state.facets.series || [],
    placeholder: 'مثال: تفسیر سورهٔ بقره',
  });
  panes.main.append(field('مجموعه / سلسله جلسات', F.series, { hint: 'اگر بخشی از یک مجموعه است' }));

  F.part_no = el('input', { class: 'input', type: 'number', min: '1', placeholder: 'مثال: ۳' });
  F.part_no.value = item.part_no ?? '';
  F.part_total = el('input', { class: 'input', type: 'number', min: '1', placeholder: 'مثال: ۴۰' });
  F.part_total.value = item.part_total ?? '';
  panes.main.append(field('شمارهٔ جلسه / از مجموع',
    el('div', { class: 'row row--tight' }, F.part_no, el('span', { class: 'muted' }, 'از'), F.part_total)));

  F.tags = tagInput({
    value: (item.tags || []).map((t) => t.name || t),
    suggestions: state.tags.map((t) => t.name),
  });
  panes.main.append(field('برچسب‌ها', F.tags, { wide: true, hint: 'برای گروه‌بندی آزاد — با Enter جدا کنید' }));

  /* ------------------------------------------------- زبانهٔ جزئیات و زمان */
  F.topic = suggestInput({ value: item.topic || '', suggestions: [], placeholder: 'موضوع اصلی سخنرانی' });
  panes.detail.append(field('موضوع', F.topic));

  F.occasion = suggestInput({
    value: item.occasion || '', suggestions: state.facets.occasions || [],
    placeholder: 'مثال: شب قدر، محرم، عید غدیر',
  });
  panes.detail.append(field('مناسبت', F.occasion));

  F.event_place = suggestInput({
    value: item.event_place || '', suggestions: state.facets.places || [],
    placeholder: 'مثال: مسجد جامع عتیق',
  });
  panes.detail.append(field('محل ایراد', F.event_place));

  F.city = suggestInput({ value: item.city || '', suggestions: state.facets.cities || [], placeholder: 'مثال: شیراز' });
  panes.detail.append(field('شهر', F.city));

  F.speech_date = jalaliInput({ value: item.speech_date || '' });
  panes.detail.append(field('تاریخ ایراد (شمسی)', F.speech_date,
    { hint: 'اگر تاریخ دقیق را نمی‌دانید خالی بگذارید یا فقط سال و ماه بنویسید' }));

  F.date_precision = select({
    options: { day: 'روز دقیق', month: 'فقط ماه مشخص است', year: 'فقط سال مشخص است', unknown: 'نامشخص' },
    value: item.date_precision || 'day',
  });
  panes.detail.append(field('دقت تاریخ', F.date_precision));

  F.hijri_date = el('input', { class: 'input', placeholder: 'مثال: ۲۱ رمضان ۱۳۹۹' });
  F.hijri_date.value = item.hijri_date || '';
  panes.detail.append(field('تاریخ قمری', F.hijri_date, { hint: 'اختیاری' }));

  F.duration = el('input', { class: 'input ltr', placeholder: '01:02:35 یا 62' });
  F.duration.value = item.duration_sec ? hmsPlain(item.duration_sec) : '';
  panes.detail.append(field('مدت زمان', F.duration, { hint: 'به شکل ساعت:دقیقه:ثانیه — یا فقط عدد دقیقه' }));

  F.language = suggestInput({ value: item.language || 'فارسی', suggestions: state.facets.languages || ['فارسی', 'عربی'] });
  panes.detail.append(field('زبان', F.language));

  F.source = suggestInput({ value: item.source || '', suggestions: state.facets.sources || [], placeholder: 'از کجا تهیه شده' });
  panes.detail.append(field('منبع تهیه', F.source));

  F.contributor = suggestInput({ value: item.contributor || '', suggestions: state.facets.contributors || [], placeholder: 'چه کسی تحویل داده' });
  panes.detail.append(field('تحویل‌دهنده / اهداکننده', F.contributor));

  /* -------------------------------------------- زبانهٔ فایل‌ها و هاردها */
  const copiesHost = el('div', { class: 'stack' });
  const copiesPane = el('div', { class: 'field field--wide stack' });
  copiesPane.append(
    el('div', { class: 'row' },
      el('div', { class: 'field__label' }, 'نسخه‌های ثبت‌شدهٔ این محتوا روی هاردها'),
      el('button', {
        class: 'btn btn--sm btn--primary', type: 'button',
        style: { marginInlineStart: 'auto' },
        onclick: () => addCopyRow(),
      }, '＋ افزودن نسخه')),
    el('div', { class: 'field__hint' },
      'فایل‌ها در نرم‌افزار ذخیره نمی‌شوند؛ تنها محل نگهداری آن‌ها ثبت می‌شود. یک محتوا می‌تواند روی چند هارد باشد.'),
    copiesHost);
  panes.files.append(copiesPane);

  const copyRows = [];
  function addCopyRow(data = {}) {
    const c = { copy_role: copyRows.length ? 'backup' : 'master', health: 'unchecked', ...data };
    const R = {};
    const row = el('div', { class: 'copy-row' });
    const bodyEl = el('div', { class: 'copy-row__body stack' });

    const grid = el('div', { class: 'form-grid' });
    R.drive_id = select({
      options: state.drives.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
      value: c.drive_id, placeholder: 'کدام هارد؟',
    });
    const driveRow = el('div', { class: 'row row--tight' }, R.drive_id,
      el('button', { class: 'btn btn--sm', type: 'button', title: 'افزودن هارد تازه', onclick: () => quickAddDrive(R.drive_id) }, '＋'));
    R.drive_id.style.flex = '1';
    grid.append(field('هارد / حافظه', driveRow, { required: true }));

    R.folder_path = el('input', { class: 'input ltr', placeholder: 'D:\\Archive\\Tafsir\\Baghareh' });
    R.folder_path.value = c.folder_path || '';
    grid.append(field('مسیر پوشه', R.folder_path));

    R.file_name = el('input', { class: 'input ltr', placeholder: '01-baghareh.mp3' });
    R.file_name.value = c.file_name || '';
    grid.append(field('نام فایل', R.file_name));

    R.file_format = el('input', { class: 'input ltr', placeholder: 'mp3 / mp4 / wav' });
    R.file_format.value = c.file_format || '';
    grid.append(field('قالب فایل', R.file_format));

    R.size_mb = el('input', { class: 'input', type: 'number', step: '0.1', placeholder: 'مگابایت' });
    R.size_mb.value = c.size_mb ?? '';
    grid.append(field('حجم (مگابایت)', R.size_mb));

    R.copy_role = select({ options: COPY_ROLES, value: c.copy_role });
    grid.append(field('نقش نسخه', R.copy_role));

    R.health = select({ options: COPY_HEALTH, value: c.health });
    grid.append(field('سلامت فایل', R.health));

    R.resolution = el('input', { class: 'input ltr', placeholder: '1080p' });
    R.resolution.value = c.resolution || '';
    grid.append(field('کیفیت تصویر', R.resolution));

    R.last_checked = jalaliInput({ value: c.last_checked || '' });
    grid.append(field('آخرین بررسی', R.last_checked));

    R.notes = el('input', { class: 'input', placeholder: 'یادداشت دربارهٔ این نسخه' });
    R.notes.value = c.notes || '';
    grid.append(field('یادداشت', R.notes, { wide: true }));

    bodyEl.append(grid);

    const remove = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'حذف این نسخه' }, '✕');
    remove.addEventListener('click', () => {
      const idx = copyRows.findIndex((x) => x.row === row);
      if (idx > -1) copyRows.splice(idx, 1);
      row.remove();
      if (!copyRows.length) copiesHost.append(noCopiesHint);
    });

    row.append(bodyEl, remove);
    noCopiesHint.remove();
    copiesHost.append(row);
    copyRows.push({ row, R, id: c.id });
  }

  const noCopiesHint = el('div', { class: 'muted small text-center', style: { padding: '18px' } },
    'هنوز نسخه‌ای ثبت نشده — با دکمهٔ «افزودن نسخه» مشخص کنید این فایل روی کدام هارد است.');
  copiesHost.append(noCopiesHint);
  for (const c of (item.copies || [])) addCopyRow(c);

  /* ------------------------------------------- زبانهٔ وضعیت و نواقص */
  F.quality = select({ options: QUALITIES, value: item.quality });
  panes.status.append(field('کیفیت فایل', F.quality));

  F.completeness = select({ options: COMPLETENESS, value: item.completeness });
  panes.status.append(field('کامل بودن محتوا', F.completeness));

  F.rating = starInput({ value: item.rating });
  panes.status.append(field('امتیاز', F.rating, { hint: 'ارزش محتوایی از دید شما' }));

  F.priority = select({ options: PRIORITIES, value: item.priority ?? 0 });
  panes.status.append(field('اولویت', F.priority));

  const defectsBox = el('div', { class: 'form-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '6px' } });
  const defectChecks = {};
  for (const [key, label] of Object.entries(DEFECT_FLAGS)) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = (item.defect_list || []).includes(key);
    defectChecks[key] = cb;
    defectsBox.append(el('label', { class: 'checkbox' }, cb, el('span', {}, label)));
  }
  panes.status.append(el('div', { class: 'field field--wide' },
    el('label', { class: 'field__label' }, 'نواقص شناخته‌شده'), defectsBox));

  F.defects = el('textarea', { class: 'textarea', placeholder: 'مثال: ۵ دقیقهٔ ابتدایی افتاده است و از دقیقهٔ ۲۰ صدا افت می‌کند.' });
  F.defects.value = item.defects || '';
  panes.status.append(field('شرح نواقص', F.defects, { wide: true }));

  F.needs_work = el('input', { type: 'checkbox' });
  F.needs_work.checked = !!item.needs_work;
  F.verified = el('input', { type: 'checkbox' });
  F.verified.checked = !!item.verified;
  F.published = el('input', { type: 'checkbox' });
  F.published.checked = !!item.published;
  F.is_favorite = el('input', { type: 'checkbox' });
  F.is_favorite.checked = !!item.is_favorite;

  panes.status.append(el('div', { class: 'field field--wide stack' },
    el('label', { class: 'checkbox' }, F.needs_work, el('span', {}, 'نیازمند بازسازی یا رسیدگی است')),
    el('label', { class: 'checkbox' }, F.verified, el('span', {}, 'بررسی و تأیید شده است')),
    el('label', { class: 'checkbox' }, F.published, el('span', {}, 'منتشر شده است')),
    el('label', { class: 'checkbox' }, F.is_favorite, el('span', {}, 'نشان‌دار (دسترسی سریع)'))));

  F.publish_ref = el('input', { class: 'input', placeholder: 'نشانی سایت یا نام کانال' });
  F.publish_ref.value = item.publish_ref || '';
  panes.status.append(field('محل انتشار', F.publish_ref, { wide: true }));

  /* ------------------------------------------------------ زبانهٔ توضیحات */
  F.summary = el('textarea', { class: 'textarea', placeholder: 'در چند خط بنویسید در این فایل چه چیزی گفته می‌شود.' });
  F.summary.value = item.summary || '';
  panes.notes.append(field('خلاصهٔ محتوا', F.summary, { wide: true }));

  F.keywords = el('input', { class: 'input', placeholder: 'واژه‌هایی که ممکن است با آن‌ها جست‌وجو کنید' });
  F.keywords.value = item.keywords || '';
  panes.notes.append(field('کلیدواژه‌ها', F.keywords, { wide: true, hint: 'با ویرگول جدا کنید — به جست‌وجو کمک می‌کند' }));

  F.description = el('textarea', { class: 'textarea', style: { minHeight: '120px' }, placeholder: 'هر توضیح دیگری که لازم می‌دانید' });
  F.description.value = item.description || '';
  panes.notes.append(field('توضیحات تکمیلی', F.description, { wide: true }));

  F.registered_at = jalaliInput({ value: item.registered_at || state.today });
  panes.notes.append(field('تاریخ ثبت در آرشیو', F.registered_at));

  F.registered_by = suggestInput({
    value: item.registered_by || state.settings.current_user || '',
    suggestions: state.facets.registrars || [], placeholder: 'نام ثبت‌کننده',
  });
  panes.notes.append(field('ثبت‌کننده', F.registered_by));

  F.copyright = el('input', { class: 'input', placeholder: 'مالکیت / حقوق نشر' });
  F.copyright.value = item.copyright || '';
  panes.notes.append(field('حقوق و مالکیت', F.copyright));

  F.code = el('input', { class: 'input ltr', placeholder: state.nextCodes.item });
  F.code.value = item.code || '';
  panes.notes.append(field('کد آرشیو', F.code,
    { hint: id ? 'تغییر ندهید مگر لازم باشد' : `اگر خالی بماند خودکار ${state.nextCodes.item} می‌شود` }));

  /* ------------------------------------------------------------ دکمه‌ها */
  const saveBtn = el('button', { class: 'btn btn--primary' }, id ? 'ذخیرهٔ تغییرات' : 'ثبت رکورد');
  const saveAddBtn = el('button', { class: 'btn' }, 'ذخیره و ثبت بعدی');
  const cancelBtn = el('button', { class: 'btn btn--ghost' }, 'انصراف');

  const m = modal({
    title: id ? `ویرایش رکورد ${fa(item.code || '')}` : 'ثبت رکورد تازه',
    body, size: 'modal--wide',
    footer: [
      el('span', { class: 'spacer muted small' }, id ? `آخرین ویرایش: ${item.updated_at ? '' : ''}` : ''),
      cancelBtn, saveAddBtn, saveBtn,
    ],
    closeOnBackdrop: false,
  });
  setTab('main');
  cancelBtn.addEventListener('click', () => m.close());

  function collect() {
    const defect_flags = Object.entries(defectChecks).filter(([, cb]) => cb.checked).map(([k]) => k);
    return {
      id: id || undefined,
      code: F.code.value.trim() || undefined,
      title: F.title.value.trim(),
      alt_title: F.alt_title.value.trim(),
      media_kind: F.media_kind.value,
      speaker_id: F.speaker_id.value || null,
      category_id: F.category_id.value || null,
      series: F.series.value,
      part_no: F.part_no.value || null,
      part_total: F.part_total.value || null,
      topic: F.topic.value,
      occasion: F.occasion.value,
      event_place: F.event_place.value,
      city: F.city.value,
      speech_date: F.speech_date.value,
      date_precision: F.date_precision.value,
      hijri_date: F.hijri_date.value.trim(),
      duration_sec: parseDuration(F.duration.value),
      language: F.language.value,
      quality: F.quality.value,
      completeness: F.completeness.value,
      defect_flags,
      defects: F.defects.value.trim(),
      needs_work: F.needs_work.checked,
      source: F.source.value,
      contributor: F.contributor.value,
      registered_at: F.registered_at.value,
      registered_by: F.registered_by.value,
      verified: F.verified.checked,
      published: F.published.checked,
      publish_ref: F.publish_ref.value.trim(),
      priority: Number(F.priority.value) || 0,
      rating: F.rating.value,
      is_favorite: F.is_favorite.checked,
      copyright: F.copyright.value.trim(),
      keywords: F.keywords.value.trim(),
      summary: F.summary.value.trim(),
      description: F.description.value.trim(),
      tags: F.tags.value,
      copies: copyRows.map(({ R, id: cid }) => ({
        id: cid,
        drive_id: R.drive_id.value || null,
        folder_path: R.folder_path.value.trim(),
        file_name: R.file_name.value.trim(),
        file_format: R.file_format.value.trim().replace(/^\./, ''),
        size_mb: R.size_mb.value || null,
        resolution: R.resolution.value.trim(),
        copy_role: R.copy_role.value,
        health: R.health.value,
        last_checked: R.last_checked.value,
        notes: R.notes.value.trim(),
      })),
    };
  }

  async function doSave(keepOpen) {
    const payload = collect();
    if (!payload.title) {
      setTab('main'); F.title.focus();
      return toast('عنوان رکورد را وارد کنید', 'warn');
    }
    if (F.duration.value.trim() && payload.duration_sec == null) {
      setTab('detail'); F.duration.focus();
      return toast('قالب مدت زمان درست نیست. نمونه: 01:02:35', 'warn');
    }
    saveBtn.disabled = saveAddBtn.disabled = true;
    try {
      const saved = id ? await api.updateItem(id, payload) : await api.createItem(payload);
      toast(id ? 'تغییرات ذخیره شد' : `رکورد ${fa(saved.code)} ثبت شد`);
      await refreshReference();
      if (keepOpen) {
        m.close();
        // ثبت بعدی با همان دسته و مجموعه، برای ورود سریع پشت سر هم
        openItemForm(null, onSaved, {
          category_id: payload.category_id, speaker_id: payload.speaker_id,
          series: payload.series, media_kind: payload.media_kind,
          occasion: payload.occasion, event_place: payload.event_place, city: payload.city,
          part_no: payload.part_no ? Number(payload.part_no) + 1 : null,
          part_total: payload.part_total, source: payload.source,
          registered_by: payload.registered_by,
        });
      } else {
        m.close();
      }
      onSaved?.(saved);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      saveBtn.disabled = saveAddBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', () => doSave(false));
  saveAddBtn.addEventListener('click', () => doSave(true));

  // Ctrl+S برای ذخیره
  body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(false); }
  });
}

function hmsPlain(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/* --------------------------------------------------- افزودن سریع اشخاص/هارد */

async function quickAddSpeaker(selectEl) {
  const name = await import('../components.js').then((C) => C.promptDialog({
    title: 'افزودن شخص تازه', label: 'نام (سخنران، قاری، مداح …)',
    placeholder: 'مثال: آیت‌الله دستغیب',
  }));
  if (!name) return;
  try {
    const sp = await api.saveSpeaker({ name });
    await refreshReference();
    selectEl.append(el('option', { value: sp.id }, sp.name));
    selectEl.value = String(sp.id);
    toast('شخص افزوده شد');
  } catch (e) { toast(e.message, 'error'); }
}

async function quickAddDrive(selectEl) {
  const name = await import('../components.js').then((C) => C.promptDialog({
    title: 'افزودن هارد تازه', label: 'نام یا برچسب هارد',
    placeholder: 'مثال: هارد آبی ۲ ترابایت',
  }));
  if (!name) return;
  try {
    const d = await api.saveDrive({ name });
    await refreshReference();
    selectEl.append(el('option', { value: d.id }, `${d.code} — ${d.name}`));
    selectEl.value = String(d.id);
    toast(`هارد ${fa(d.code)} افزوده شد — جزئیات آن را بعداً کامل کنید`);
  } catch (e) { toast(e.message, 'error'); }
}
