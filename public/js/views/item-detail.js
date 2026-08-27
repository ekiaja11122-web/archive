/** نمای جزئیات یک رکورد */
import {
  api, fa, num, duration, hms, jdate, size, stampToJalali, escapeHtml,
  MEDIA_KINDS, QUALITIES, COMPLETENESS, DEFECT_FLAGS, COPY_ROLES, COPY_HEALTH, PRIORITIES,
} from '../core.js';
import { el, toast, loading, confirmDialog, emptyState, stars } from '../components.js';
import { go } from '../app.js';
import { openItemForm } from './item-form.js';

export async function renderItemDetail(root, params) {
  root.innerHTML = '';
  root.append(loading());
  let item;
  try { item = await api.item(params.id); }
  catch (e) {
    root.innerHTML = '';
    return root.append(emptyState({ icon: '❓', title: 'رکورد پیدا نشد', text: e.message,
      action: el('button', { class: 'btn btn--primary', onclick: () => go('items') }, 'بازگشت به آرشیو') }));
  }
  root.innerHTML = '';

  const reload = () => renderItemDetail(root, params);
  const kind = MEDIA_KINDS[item.media_kind] || {};

  /* ------------------------------------------------------------ سرصفحه */
  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('div', { class: 'row row--tight', style: { marginBottom: '4px' } },
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => history.back() }, '› بازگشت'),
        el('span', { class: `badge ${kind.badge || ''}` }, `${kind.icon || ''} ${kind.label || ''}`),
        el('span', { class: 'badge num' }, fa(item.code || '—')),
        item.verified ? el('span', { class: 'badge badge--ok' }, '✓ تأیید شده') : el('span', { class: 'badge badge--warn' }, 'تأیید نشده'),
        item.needs_work ? el('span', { class: 'badge badge--danger' }, 'نیازمند رسیدگی') : null,
        item.is_favorite ? el('span', { class: 'badge badge--accent' }, '★ نشان‌شده') : null,
        item.archived ? el('span', { class: 'badge badge--danger' }, 'در بایگانی') : null),
      el('h1', { class: 'page-title' }, item.title),
      el('div', { class: 'page-subtitle' }, [
        item.alt_title, item.speaker_name,
        item.series ? `${item.series}${item.part_no ? ` — جلسهٔ ${fa(item.part_no)}${item.part_total ? ` از ${fa(item.part_total)}` : ''}` : ''}` : null,
      ].filter(Boolean).join(' • ') || '—')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn btn--primary', onclick: () => openItemForm(item.id, reload) }, '✎ ویرایش'),
      el('button', { class: 'btn', onclick: () => copyInfo(item) }, '⧉ رونوشت اطلاعات'),
      el('button', { class: 'btn', onclick: () => window.print() }, '🖨 چاپ'),
      item.archived
        ? el('button', { class: 'btn', onclick: async () => { await api.restoreItem(item.id); toast('بازگردانی شد'); reload(); } }, '↺ بازگردانی')
        : el('button', { class: 'btn btn--danger', onclick: () => removeItem(item, reload) }, '🗑 بایگانی'))));

  /* ---------------------------------------------------------- اطلاعات کلی */
  const info = (label, value, empty = '—') =>
    el('div', { class: 'detail-item' },
      el('div', { class: 'detail-item__label' }, label),
      el('div', { class: `detail-item__value${value ? '' : ' detail-item__value--empty'}` }, value || empty));

  const dateText = item.speech_date
    ? `${jdate(item.speech_date, true)} (${fa(item.speech_date)})`
    : null;

  root.append(el('div', { class: 'card mb' },
    el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'اطلاعات رکورد')),
    el('div', { class: 'card__body' },
      el('div', { class: 'detail-grid' },
        info('دسته‌بندی', item.category_path),
        info('سخنران / گوینده', item.speaker_name),
        info('موضوع', item.topic),
        info('مناسبت', item.occasion),
        info('تاریخ ایراد', dateText, 'ثبت نشده'),
        info('تاریخ قمری', item.hijri_date),
        info('محل ایراد', [item.event_place, item.city].filter(Boolean).join('، ')),
        info('مدت زمان', item.duration_sec ? `${duration(item.duration_sec)} (${hms(item.duration_sec)})` : null),
        info('کیفیت', QUALITIES[item.quality]?.label),
        info('کامل بودن', COMPLETENESS[item.completeness]?.label),
        info('زبان', item.language),
        info('اولویت', PRIORITIES[item.priority]),
        info('امتیاز', el('span', { html: stars(item.rating) })),
        info('منبع تهیه', item.source),
        info('تحویل‌دهنده', item.contributor),
        info('تاریخ ثبت', item.registered_at ? fa(item.registered_at) : null),
        info('ثبت‌کننده', item.registered_by),
        info('حقوق و مالکیت', item.copyright),
        info('محل انتشار', item.published ? (item.publish_ref || 'منتشر شده') : 'منتشر نشده'),
        info('آخرین ویرایش', stampToJalali(item.updated_at))))));

  if (item.tags?.length) {
    root.append(el('div', { class: 'card mb' },
      el('div', { class: 'card__body row row--tight' },
        el('span', { class: 'field__label' }, 'برچسب‌ها:'),
        ...item.tags.map((t) => {
          const chip = el('span', { class: 'chip', style: { cursor: 'pointer' } },
            t.color ? el('span', { class: 'chip__dot', style: { background: t.color } }) : null, t.name);
          chip.addEventListener('click', () => go('items', { tag_id: t.id }));
          return chip;
        }))));
  }

  /* -------------------------------------------------------- نسخه‌ها/هاردها */
  const copiesCard = el('div', { class: 'card mb' },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title' }, `محل نگهداری فایل‌ها (${fa(item.copies.length)} نسخه)`),
      el('button', {
        class: 'btn btn--sm', style: { marginInlineStart: 'auto' },
        onclick: () => openItemForm(item.id, reload),
      }, '＋ افزودن نسخه')));
  const copiesBody = el('div', { class: 'card__body stack' });

  if (!item.copies.length) {
    copiesBody.append(el('div', { class: 'row', style: { color: 'var(--danger)' } },
      el('span', {}, '⚠️'),
      el('span', {}, 'برای این رکورد هیچ فایلی روی هیچ هاردی ثبت نشده است.')));
  }
  for (const c of item.copies) {
    const health = COPY_HEALTH[c.health] || {};
    const box = el('div', { class: 'copy-row' });
    const b = el('div', { class: 'copy-row__body' });
    b.append(el('div', { class: 'row row--tight' },
      c.drive_code
        ? el('button', {
            class: 'badge badge--brand num', style: { cursor: 'pointer', border: 'none' },
            onclick: () => go('drive', { id: c.drive_id }),
          }, fa(c.drive_code))
        : el('span', { class: 'badge badge--danger' }, 'هارد نامشخص'),
      el('span', { class: 'strong' }, c.drive_name || ''),
      el('span', { class: 'badge' }, COPY_ROLES[c.copy_role] || c.copy_role),
      el('span', { class: `badge ${health.badge || ''}` }, health.label || c.health),
      c.drive_location ? el('span', { class: 'muted small' }, `📍 ${c.drive_location}`) : null));

    const fullPath = [c.folder_path, c.file_name].filter(Boolean).join('/') || '(مسیر ثبت نشده)';
    const pathEl = el('div', { class: 'copy-row__path', title: 'برای رونوشت کلیک کنید' }, fullPath);
    pathEl.style.cursor = 'pointer';
    pathEl.addEventListener('click', () => {
      navigator.clipboard?.writeText(fullPath).then(
        () => toast('مسیر رونوشت شد'),
        () => toast('رونوشت انجام نشد', 'warn'));
    });
    b.append(pathEl);

    const meta = [
      c.file_format ? c.file_format.toUpperCase() : null,
      c.size_mb ? size(c.size_mb) : null,
      c.resolution || null,
      c.duration_sec ? hms(c.duration_sec) : null,
      c.last_checked ? `آخرین بررسی: ${fa(c.last_checked)}` : null,
      c.notes || null,
    ].filter(Boolean);
    if (meta.length) b.append(el('div', { class: 'small muted', style: { marginTop: '5px' } }, meta.join(' • ')));

    const del = el('button', { class: 'btn btn--ghost btn--sm', title: 'حذف این نسخه' }, '✕');
    del.addEventListener('click', async () => {
      if (!await confirmDialog({
        title: 'حذف نسخه',
        message: 'این نسخه از فهرست حذف شود؟ فایل روی هارد دست‌نخورده می‌ماند.',
        danger: true, confirmText: 'حذف',
      })) return;
      await api.deleteCopy(c.id);
      toast('نسخه حذف شد');
      reload();
    });
    box.append(b, del);
    copiesBody.append(box);
  }
  copiesCard.append(copiesBody);
  root.append(copiesCard);

  /* --------------------------------------------------------------- نواقص */
  if (item.defect_list?.length || item.defects) {
    const box = el('div', { class: 'card mb' },
      el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, '⚠️ نواقص و مشکلات')));
    const b = el('div', { class: 'card__body stack' });
    if (item.defect_list?.length) {
      b.append(el('div', { class: 'row row--tight' },
        ...item.defect_list.map((d) => el('span', { class: 'badge badge--warn' }, DEFECT_FLAGS[d] || d))));
    }
    if (item.defects) b.append(el('div', { style: { whiteSpace: 'pre-wrap' } }, item.defects));
    box.append(b);
    root.append(box);
  }

  /* ------------------------------------------------------------ توضیحات */
  if (item.summary || item.description || item.keywords) {
    const box = el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('h3', { class: 'card__title' }, 'توضیحات')));
    const b = el('div', { class: 'card__body stack' });
    if (item.summary) b.append(el('div', {}, el('div', { class: 'detail-item__label' }, 'خلاصهٔ محتوا'),
      el('div', { style: { whiteSpace: 'pre-wrap' } }, item.summary)));
    if (item.description) b.append(el('div', {}, el('div', { class: 'detail-item__label' }, 'توضیحات تکمیلی'),
      el('div', { style: { whiteSpace: 'pre-wrap' } }, item.description)));
    if (item.keywords) b.append(el('div', {}, el('div', { class: 'detail-item__label' }, 'کلیدواژه‌ها'),
      el('div', { class: 'muted' }, item.keywords)));
    box.append(b);
    root.append(box);
  }
}

async function removeItem(item, reload) {
  const ok = await confirmDialog({
    title: 'انتقال به بایگانی',
    message: `«${escapeHtml(item.title)}» به بایگانی منتقل شود؟<br><span class="muted small">فایل اصلی روی هارد حذف نمی‌شود؛ فقط این رکورد از فهرست اصلی کنار می‌رود و بعداً قابل بازگردانی است.</span>`,
    confirmText: 'انتقال به بایگانی', danger: true,
  });
  if (!ok) return;
  await api.deleteItem(item.id, true);
  toast('به بایگانی منتقل شد');
  go('items');
}

function copyInfo(item) {
  const lines = [
    `عنوان: ${item.title}`,
    item.code ? `کد آرشیو: ${item.code}` : null,
    item.speaker_name ? `سخنران: ${item.speaker_name}` : null,
    item.category_path ? `دسته‌بندی: ${item.category_path}` : null,
    item.speech_date ? `تاریخ ایراد: ${item.speech_date}` : null,
    item.duration_sec ? `مدت: ${hms(item.duration_sec)}` : null,
    item.occasion ? `مناسبت: ${item.occasion}` : null,
    item.event_place ? `محل: ${item.event_place}` : null,
    '',
    'محل نگهداری:',
    ...item.copies.map((c) => `  [${c.drive_code || '?'}] ${[c.folder_path, c.file_name].filter(Boolean).join('/')}`),
    item.defects ? `\nنواقص: ${item.defects}` : null,
  ].filter((l) => l !== null);
  navigator.clipboard?.writeText(lines.join('\n')).then(
    () => toast('اطلاعات رونوشت شد'),
    () => toast('رونوشت انجام نشد', 'warn'));
}
