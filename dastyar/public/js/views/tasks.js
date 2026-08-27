/**
 * صفحهٔ «کارها» — فهرست کامل، جست‌وجو، افزودن و ویرایش
 */
import {
  api, state, el, fa, DT, toast, sheet, confirmBox, matches, emptyState,
} from '../core.js';
import {
  field, input, textarea, chips, weekdayPicker, dateField, timeField, searchBar, fab, btn, sectionTitle,
} from '../components.js';
import { describeRepeat, REPEAT_LABELS } from '../../lib/recur.js';

export const CATEGORIES = [
  { value: '', label: 'بدون دسته', icon: '•' },
  { value: 'کاری', label: 'کاری', icon: '💼' },
  { value: 'شخصی', label: 'شخصی', icon: '🏠' },
  { value: 'تماس', label: 'تماس', icon: '📞' },
  { value: 'خرید', label: 'خرید', icon: '🛒' },
  { value: 'مالی', label: 'مالی', icon: '💳' },
  { value: 'سلامت', label: 'سلامت', icon: '💊' },
  { value: 'اداری', label: 'اداری', icon: '📄' },
];

export const catIcon = (c) => (CATEGORIES.find((x) => x.value === c) || CATEGORIES[0]).icon;

const PRIORITIES = [
  { value: 0, label: 'عادی' },
  { value: 1, label: 'مهم' },
  { value: 2, label: 'فوری' },
];

/* -------------------------------------------------------- ویرایشگر کار */

export function taskEditor(task, onSaved) {
  const isNew = !task?.id;
  const t = { priority: 1, repeat_rule: 'none', category: '', ...task };

  const title = input({ value: t.title || '', placeholder: 'مثلاً: تماس با آقای رضایی' });
  const notes = textarea({ value: t.notes || '', placeholder: 'توضیح بیشتر (اختیاری)' });
  const cat = chips(CATEGORIES, t.category || '');
  const pri = chips(PRIORITIES, t.priority ?? 1);
  const date = dateField(t.due_date || '');
  const time = timeField(t.due_time || '');
  const remind = chips([
    { value: 0, label: 'سر وقت' }, { value: 15, label: '۱۵ دقیقه قبل' },
    { value: 60, label: '۱ ساعت قبل' }, { value: 180, label: '۳ ساعت قبل' },
  ], t.remind_before ?? 0);

  const repeatExtra = el('div', { class: 'sub-field' });
  const days = weekdayPicker(t.repeat_days || '');
  const everyN = input({ type: 'number', min: 1, value: t.repeat_every || 2, class: 'input small' });

  const drawExtra = (rule) => {
    repeatExtra.replaceChildren();
    if (rule === 'weekly') repeatExtra.append(field('کدام روزها؟', days));
    if (rule === 'every') repeatExtra.append(field('هر چند روز یک‌بار؟', everyN));
    if (rule === 'monthly' || rule === 'yearly') {
      repeatExtra.append(el('p', { class: 'field-hint',
        text: 'بر اساس همان روز از تاریخ انتخاب‌شده در تقویم شمسی تکرار می‌شود.' }));
    }
  };
  const repeat = chips(
    Object.entries(REPEAT_LABELS).map(([value, label]) => ({ value, label })),
    t.repeat_rule || 'none', drawExtra,
  );
  drawExtra(t.repeat_rule || 'none');

  const body = el('div', { class: 'form' },
    field('عنوان کار', title),
    field('دسته', cat),
    field('اهمیت', pri),
    field('تاریخ سررسید', date),
    field('ساعت (اختیاری)', time),
    field('یادآوری', remind),
    field('تکرار', repeat),
    repeatExtra,
    field('یادداشت', notes),
  );

  const save = async () => {
    if (!title.value.trim()) return toast('عنوان کار را بنویسید', 'err');
    const payload = {
      title: title.value.trim(),
      notes: notes.value.trim(),
      category: cat.value,
      priority: Number(pri.value),
      due_date: date.value || null,
      due_time: time.value || null,
      remind_before: Number(remind.value) || 0,
      repeat_rule: repeat.value,
      repeat_days: repeat.value === 'weekly' ? days.value : '',
      repeat_every: repeat.value === 'every' ? Math.max(1, Number(DT.J.toEnglishDigits(everyN.value)) || 1) : 0,
    };
    if (payload.repeat_rule !== 'none' && !payload.due_date) payload.due_date = state.today;
    try {
      if (isNew) await api.create('tasks', payload);
      else await api.update('tasks', t.id, payload);
      s.close();
      toast(isNew ? 'کار اضافه شد' : 'ذخیره شد');
      onSaved?.();
    } catch (e) { toast(e.message, 'err'); }
  };

  const actions = [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('این کار حذف شود؟')) {
        await api.remove('tasks', t.id);
        s.close(); toast('حذف شد'); onSaved?.();
      }
    }) : null,
    btn(isNew ? 'افزودن' : 'ذخیره', 'primary', save),
  ].filter(Boolean);

  const s = sheet(isNew ? 'کار تازه' : 'ویرایش کار', body, actions);
  setTimeout(() => title.focus(), 150);
  return s;
}

/* --------------------------------------------------------- ردیف یک کار */

export function taskRow(task, { date = state.today, onChange } = {}) {
  const repeating = (task.repeat_rule || 'none') !== 'none';
  const done = repeating ? !!task.done_today : task.status === 'done';

  const box = el('button', {
    class: 'check-box' + (done ? ' on' : ''),
    'aria-label': 'انجام شد',
    onclick: async (e) => {
      e.stopPropagation();
      try {
        await api.toggleTask(task.id, { date, done: !done });
        onChange?.();
      } catch (err) { toast(err.message, 'err'); }
    },
  }, done ? '✔' : '');

  const meta = [];
  if (task.due_time) meta.push(fa(task.due_time));
  if (repeating) meta.push(describeRepeat(task));
  if (task.late_days) meta.push(`${fa(task.late_days)} روز عقب‌افتاده`);
  else if (!repeating && task.due_date && task.due_date !== date) meta.push(DT.relativeDay(task.due_date, state.today));

  return el('div', { class: 'task-row' + (done ? ' done' : '') + (task.priority === 2 ? ' urgent' : ''), },
    box,
    el('div', { class: 'task-main', onclick: () => taskEditor(task, onChange) },
      el('div', { class: 'task-title' },
        task.priority === 2 ? el('span', { class: 'dot urgent' }) : (task.priority === 1 ? el('span', { class: 'dot' }) : null),
        task.title,
      ),
      meta.length || task.category
        ? el('div', { class: 'task-meta' },
          task.category ? el('span', { class: 'tag' }, catIcon(task.category), ' ', task.category) : null,
          ...meta.map((m) => el('span', { class: 'meta-item', text: m })),
        ) : null,
      task.notes ? el('div', { class: 'task-notes', text: task.notes }) : null,
    ),
  );
}

/* ---------------------------------------------------------------- صفحه */

const FILTERS = [
  { value: 'open', label: 'در جریان' },
  { value: 'today', label: 'امروز' },
  { value: 'week', label: 'این هفته' },
  { value: 'repeat', label: 'تکرارشونده' },
  { value: 'nodate', label: 'بدون تاریخ' },
  { value: 'done', label: 'انجام‌شده' },
];

export async function renderTasks({ actions, refresh }) {
  const [tasks, agenda] = await Promise.all([api.list('tasks'), api.agenda(state.today, 7)]);
  const doneToday = new Set(agenda.today.filter((t) => t.done_today).map((t) => t.id));

  let filter = 'open';
  let query = '';

  const list = el('div', { class: 'list' });
  const wrap = el('div', { class: 'page' });

  const draw = () => {
    const today = state.today;
    const week = DT.addDaysISO(today, 7);
    let items = tasks.filter((t) => t.status !== 'archived');

    items = items.filter((t) => {
      const rep = (t.repeat_rule || 'none') !== 'none';
      switch (filter) {
        case 'open': return rep || t.status === 'open';
        case 'today': return rep ? true : t.due_date === today;
        case 'week': return t.due_date && t.due_date >= today && t.due_date <= week;
        case 'repeat': return rep;
        case 'nodate': return !t.due_date && t.status === 'open';
        case 'done': return t.status === 'done';
        default: return true;
      }
    });
    if (query) items = items.filter((t) => matches(`${t.title} ${t.notes} ${t.category}`, query));

    items.sort((a, b) => (b.priority - a.priority)
      || String(a.due_date || '9999').localeCompare(b.due_date || '9999'));

    list.replaceChildren();
    if (!items.length) {
      list.append(emptyState('📝', 'چیزی این‌جا نیست', 'با دکمهٔ + کار تازه اضافه کنید'));
      return;
    }
    for (const t of items) {
      list.append(taskRow({ ...t, done_today: doneToday.has(t.id) ? 1 : 0 }, { onChange: refresh }));
    }
    count.textContent = fa(items.length) + ' مورد';
  };

  const count = el('span', { class: 'dim small' });
  const filterChips = chips(FILTERS, filter, (v) => { filter = v; draw(); });

  wrap.append(
    searchBar('جست‌وجو در کارها…', (v) => { query = v; draw(); }),
    el('div', { class: 'scroll-x' }, filterChips),
    sectionTitle('', count),
    list,
    fab(() => taskEditor({}, refresh)),
  );
  draw();
  return wrap;
}
