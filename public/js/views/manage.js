/** مدیریت دسته‌بندی‌ها، اشخاص و برچسب‌ها */
import { api, state, fa, num, refreshReference, categoryOptions } from '../core.js';
import {
  el, modal, toast, select, field, jalaliInput, confirmDialog, emptyState, promptDialog,
} from '../components.js';
import { go } from '../app.js';

const PALETTE = ['#0e6f5c', '#1d5fa8', '#b4863c', '#c0392f', '#6b3fa0', '#0f766e', '#be185d', '#475569'];

/* ========================================================== دسته‌بندی‌ها */

export async function renderCategories(root) {
  root.innerHTML = '';
  const reload = () => renderCategories(root);

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'دسته‌بندی‌ها'),
      el('div', { class: 'page-subtitle' }, 'ساختار درختی برای مرتب کردن رکوردها — هر دسته می‌تواند زیرشاخه داشته باشد')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn btn--primary', onclick: () => openCategoryForm(null, reload) }, '＋ دستهٔ تازه'))));

  await refreshReference();
  const cats = state.categories;
  if (!cats.length) {
    return root.append(emptyState({
      icon: '🗂', title: 'هنوز دسته‌بندی‌ای ندارید',
      text: 'دسته‌بندی به شما کمک می‌کند رکوردها را موضوعی مرتب کنید.',
      action: el('button', { class: 'btn btn--primary', onclick: () => openCategoryForm(null, reload) }, '＋ ساخت نخستین دسته'),
    }));
  }

  const card = el('div', { class: 'card' });
  const list = el('div', { class: 'card__body stack' });

  const byParent = new Map();
  for (const c of cats) {
    const k = c.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }

  const renderNode = (c, depth) => {
    const row = el('div', {
      class: 'row',
      style: { paddingInlineStart: `${depth * 22}px`, paddingBlock: '5px', borderBottom: '1px solid var(--surface-line)' },
    });
    row.append(el('span', { class: 'chip__dot', style: { background: c.color || 'var(--text-faint)' } }));
    row.append(el('span', { class: 'strong', style: { cursor: 'pointer' }, onclick: () => go('items', { category_id: c.id }) }, c.name));
    if (c.description) row.append(el('span', { class: 'muted small truncate', style: { maxWidth: '260px' } }, c.description));
    row.append(el('span', { class: 'badge', style: { marginInlineStart: 'auto' } }, `${num(c.item_count)} رکورد`));
    row.append(el('button', { class: 'btn btn--ghost btn--sm', title: 'زیرشاخهٔ تازه', onclick: () => openCategoryForm({ parent_id: c.id }, reload) }, '＋'));
    row.append(el('button', { class: 'btn btn--ghost btn--sm', title: 'ویرایش', onclick: () => openCategoryForm(c, reload) }, '✎'));
    row.append(el('button', { class: 'btn btn--ghost btn--sm', title: 'حذف', onclick: () => removeCategory(c, reload) }, '🗑'));
    list.append(row);
    for (const child of (byParent.get(c.id) || [])) renderNode(child, depth + 1);
  };
  for (const c of (byParent.get(0) || [])) renderNode(c, 0);

  card.append(list);
  root.append(card);
}

function openCategoryForm(cat, onSaved) {
  const c = cat || {};
  const F = {};
  const grid = el('div', { class: 'form-grid' });

  F.name = el('input', { class: 'input', placeholder: 'مثال: تفسیر قرآن' });
  F.name.value = c.name || '';
  grid.append(field('نام دسته', F.name, { required: true, wide: true }));

  F.parent_id = select({
    options: categoryOptions().filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.label })),
    value: c.parent_id, placeholder: 'دستهٔ اصلی (بدون والد)',
  });
  grid.append(field('زیرمجموعهٔ', F.parent_id));

  F.sort_order = el('input', { class: 'input', type: 'number', placeholder: '0' });
  F.sort_order.value = c.sort_order ?? 0;
  grid.append(field('ترتیب نمایش', F.sort_order, { hint: 'عدد کوچک‌تر بالاتر' }));

  let color = c.color || '';
  const colorRow = el('div', { class: 'row row--tight' });
  const paint = () => colorRow.querySelectorAll('button').forEach((b) => {
    b.style.outline = b.dataset.c === color ? '2px solid var(--text)' : 'none'; b.style.outlineOffset = '2px';
  });
  for (const p of ['', ...PALETTE]) {
    const b = el('button', {
      class: 'btn btn--sm', type: 'button', dataset: { c: p },
      style: { background: p || 'var(--bg-sunken)', width: '30px', height: '26px', padding: '0' },
    }, p ? '' : '✕');
    b.addEventListener('click', () => { color = p; paint(); });
    colorRow.append(b);
  }
  paint();
  grid.append(field('رنگ', colorRow));

  F.description = el('textarea', { class: 'textarea', placeholder: 'توضیح کوتاه دربارهٔ این دسته' });
  F.description.value = c.description || '';
  grid.append(field('توضیح', F.description, { wide: true }));

  const save = el('button', { class: 'btn btn--primary' }, c.id ? 'ذخیره' : 'ساخت دسته');
  const cancel = el('button', { class: 'btn' }, 'انصراف');
  const m = modal({ title: c.id ? 'ویرایش دسته' : 'دستهٔ تازه', body: grid, footer: [cancel, save] });
  cancel.addEventListener('click', () => m.close());
  save.addEventListener('click', async () => {
    if (!F.name.value.trim()) { F.name.focus(); return toast('نام دسته را وارد کنید', 'warn'); }
    try {
      await api.saveCategory({
        id: c.id, name: F.name.value.trim(), parent_id: F.parent_id.value || null,
        sort_order: F.sort_order.value || 0, color, description: F.description.value.trim(),
      });
      await refreshReference();
      toast(c.id ? 'ذخیره شد' : 'دسته ساخته شد');
      m.close(); onSaved?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function removeCategory(c, reload) {
  const ok = await confirmDialog({
    title: 'حذف دسته',
    message: `دستهٔ «${c.name}» حذف شود؟<br><span class="muted small">${c.item_count ? `${fa(c.item_count)} رکورد بدون دسته می‌شوند (حذف نمی‌شوند).` : ''} زیرشاخه‌ها به سطح اصلی منتقل می‌شوند.</span>`,
    confirmText: 'حذف', danger: true,
  });
  if (!ok) return;
  await api.deleteCategory(c.id);
  await refreshReference();
  toast('دسته حذف شد');
  reload();
}

/* ================================================================ اشخاص */

export async function renderSpeakers(root) {
  root.innerHTML = '';
  const reload = () => renderSpeakers(root);

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'اشخاص'),
      el('div', { class: 'page-subtitle' }, 'سخنران، قاری، مداح و هر کسی که محتوا به او نسبت داده می‌شود')),
    el('div', { class: 'page-head__actions' },
      el('button', { class: 'btn btn--primary', onclick: () => openSpeakerForm(null, reload) }, '＋ افزودن شخص'))));

  await refreshReference();
  if (!state.speakers.length) {
    return root.append(emptyState({ icon: '👤', title: 'هنوز شخصی ثبت نشده', text: 'برای اینکه بدانید هر فایل برای کیست، اشخاص را اینجا تعریف کنید.',
      action: el('button', { class: 'btn btn--primary', onclick: () => openSpeakerForm(null, reload) }, '＋ افزودن شخص') }));
  }

  const grid = el('div', { class: 'grid grid--cards' });
  for (const s of state.speakers) {
    const card = el('div', { class: 'card' });
    const b = el('div', { class: 'card__body stack' });
    b.append(el('div', { class: 'row' },
      el('span', { class: 'strong', style: { fontSize: '15px' } }, s.name),
      el('span', { class: 'badge badge--brand', style: { marginInlineStart: 'auto' } }, `${num(s.item_count)} رکورد`)));
    if (s.full_name) b.append(el('div', { class: 'muted small' }, s.full_name));
    if (s.role) b.append(el('div', {}, el('span', { class: 'badge' }, s.role)));
    const dates = [s.birth_date ? `تولد ${fa(s.birth_date)}` : null, s.death_date ? `وفات ${fa(s.death_date)}` : null].filter(Boolean);
    if (dates.length) b.append(el('div', { class: 'small muted' }, dates.join(' • ')));
    if (s.bio) b.append(el('div', { class: 'small', style: { color: 'var(--text-soft)' } }, s.bio));
    b.append(el('div', { class: 'row row--tight', style: { marginTop: '6px' } },
      el('button', { class: 'btn btn--sm', onclick: () => go('items', { speaker_id: s.id }) }, 'رکوردها'),
      el('button', { class: 'btn btn--sm btn--ghost', onclick: () => openSpeakerForm(s, reload) }, '✎'),
      el('button', { class: 'btn btn--sm btn--ghost', onclick: () => removeSpeaker(s, reload) }, '🗑')));
    card.append(b);
    grid.append(card);
  }
  root.append(grid);
}

function openSpeakerForm(sp, onSaved) {
  const s = sp || {};
  const F = {};
  const grid = el('div', { class: 'form-grid' });

  F.name = el('input', { class: 'input', placeholder: 'نامی که در فهرست‌ها دیده می‌شود' });
  F.name.value = s.name || '';
  grid.append(field('نام کوتاه', F.name, { required: true }));

  F.full_name = el('input', { class: 'input', placeholder: 'نام و عنوان کامل' });
  F.full_name.value = s.full_name || '';
  grid.append(field('نام کامل', F.full_name));

  F.role = el('input', { class: 'input', placeholder: 'سخنران / قاری / مداح' });
  F.role.value = s.role || 'سخنران';
  grid.append(field('نقش', F.role));

  F.birth_date = jalaliInput({ value: s.birth_date || '' });
  grid.append(field('تاریخ تولد', F.birth_date));

  F.death_date = jalaliInput({ value: s.death_date || '' });
  grid.append(field('تاریخ وفات', F.death_date));

  F.bio = el('textarea', { class: 'textarea', placeholder: 'شرح حال کوتاه' });
  F.bio.value = s.bio || '';
  grid.append(field('معرفی', F.bio, { wide: true }));

  const save = el('button', { class: 'btn btn--primary' }, s.id ? 'ذخیره' : 'افزودن');
  const cancel = el('button', { class: 'btn' }, 'انصراف');
  const m = modal({ title: s.id ? 'ویرایش شخص' : 'افزودن شخص', body: grid, footer: [cancel, save] });
  cancel.addEventListener('click', () => m.close());
  save.addEventListener('click', async () => {
    if (!F.name.value.trim()) { F.name.focus(); return toast('نام را وارد کنید', 'warn'); }
    try {
      await api.saveSpeaker({
        id: s.id, name: F.name.value.trim(), full_name: F.full_name.value.trim(),
        role: F.role.value.trim(), bio: F.bio.value.trim(),
        birth_date: F.birth_date.value, death_date: F.death_date.value,
      });
      await refreshReference();
      toast('ذخیره شد'); m.close(); onSaved?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function removeSpeaker(s, reload) {
  const ok = await confirmDialog({
    title: 'حذف شخص',
    message: `«${s.name}» حذف شود؟<br><span class="muted small">${s.item_count ? `${fa(s.item_count)} رکورد بدون سخنران می‌شوند (حذف نمی‌شوند).` : ''}</span>`,
    confirmText: 'حذف', danger: true,
  });
  if (!ok) return;
  await api.deleteSpeaker(s.id);
  await refreshReference();
  toast('حذف شد'); reload();
}

/* ============================================================== برچسب‌ها */

export async function renderTags(root) {
  root.innerHTML = '';
  const reload = () => renderTags(root);

  root.append(el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title' }, 'برچسب‌ها'),
      el('div', { class: 'page-subtitle' }, 'برچسب‌ها برای گروه‌بندی آزاد و پیدا کردن سریع رکوردها هستند')),
    el('div', { class: 'page-head__actions' },
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const name = await promptDialog({ title: 'برچسب تازه', label: 'نام برچسب' });
          if (!name) return;
          await api.createTag(name, PALETTE[Math.floor(Math.random() * PALETTE.length)]);
          await refreshReference(); toast('برچسب ساخته شد'); reload();
        },
      }, '＋ برچسب تازه'))));

  await refreshReference();
  if (!state.tags.length) {
    return root.append(emptyState({ icon: '🏷', title: 'برچسبی وجود ندارد', text: 'هنگام ثبت رکورد هم می‌توانید برچسب تازه بسازید.' }));
  }

  const card = el('div', { class: 'card' });
  const body = el('div', { class: 'card__body row', style: { gap: '9px' } });
  for (const t of state.tags) {
    const chip = el('span', { class: 'chip', style: { fontSize: '13px', padding: '5px 11px' } },
      el('span', { class: 'chip__dot', style: { background: t.color || 'var(--text-faint)' } }),
      el('span', { style: { cursor: 'pointer' }, onclick: () => go('items', { tag_id: t.id }) }, t.name),
      el('span', { class: 'muted small' }, `(${num(t.item_count)})`),
      el('button', {
        class: 'chip__x', title: 'حذف برچسب',
        onclick: async () => {
          if (!await confirmDialog({
            title: 'حذف برچسب',
            message: `برچسب «${t.name}» حذف شود؟ از ${fa(t.item_count)} رکورد برداشته می‌شود.`,
            danger: true, confirmText: 'حذف',
          })) return;
          await api.deleteTag(t.id); await refreshReference(); toast('حذف شد'); reload();
        },
      }, '×'));
    body.append(chip);
  }
  card.append(body);
  root.append(card);
}
