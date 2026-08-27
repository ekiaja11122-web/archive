/**
 * صفحهٔ «امروز» — اولین چیزی که هر روز می‌بینید
 */
import {
  api, state, el, fa, money, moneyShort, DT, toast, emptyState,
} from '../core.js';
import { sectionTitle, statCard, btn, input, fab } from '../components.js';
import { taskRow, taskEditor, catIcon } from './tasks.js';

const KINDS = { birthday: '🎂', insurance: '🛡', check: '🧾', contract: '📑', other: '📌' };

function greeting() {
  const h = Number(DT.nowTehran().time.slice(0, 2));
  if (h < 5) return 'شب به خیر';
  if (h < 12) return 'صبح به خیر';
  if (h < 17) return 'ظهر به خیر';
  return 'عصر به خیر';
}

export async function renderToday({ refresh }) {
  const agenda = await api.agenda(state.today, 7);
  state.agenda = agenda;

  const wrap = el('div', { class: 'page today' });

  /* ---------------------------------------------- افزودن سریع */
  const quick = input({ placeholder: 'یک کار تازه بنویس و Enter بزن…', class: 'input quick' });
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    try {
      await api.create('tasks', { title: quick.value.trim(), due_date: state.today, priority: 1 });
      quick.value = '';
      toast('اضافه شد');
      refresh();
    } catch (err) { toast(err.message, 'err'); }
  });

  const pending = agenda.today.filter((t) => !t.done_today && t.status !== 'done');
  const dueMoney = agenda.money.filter((m) => m.date <= state.today);
  const totalOut = dueMoney.filter((m) => m.direction === 'out').reduce((s, m) => s + (m.amount || 0), 0);

  wrap.append(
    el('div', { class: 'hero' },
      el('div', { class: 'hero-greet', text: `${greeting()}${state.settings.display_name ? '، ' + state.settings.display_name : ''}` }),
      el('div', { class: 'hero-date', text: `${DT.J.WEEKDAY_NAMES[DT.dowISO(state.today)]} ${DT.formatISOLong(state.today)}` }),
    ),
    quick,
    el('div', { class: 'stats' },
      statCard('کار امروز', fa(pending.length), pending.length ? '' : 'همه انجام شد ✔', pending.length ? '' : 'ok'),
      statCard('عقب‌افتاده', fa(agenda.overdue.length), '', agenda.overdue.length ? 'warn' : ''),
      statCard('سررسید مالی', fa(dueMoney.length), totalOut ? moneyShort(totalOut) : '', dueMoney.length ? 'warn' : ''),
    ),
  );

  /* ---------------------------------------------- عقب‌افتاده‌ها */
  if (agenda.overdue.length) {
    wrap.append(sectionTitle('عقب‌افتاده', el('span', { class: 'badge warn', text: fa(agenda.overdue.length) })));
    const box = el('div', { class: 'list' });
    for (const t of agenda.overdue) box.append(taskRow(t, { onChange: refresh }));
    wrap.append(box);
  }

  /* ------------------------------------------------- کارهای امروز */
  wrap.append(sectionTitle('کارهای امروز'));
  if (!agenda.today.length) {
    wrap.append(emptyState('🌤', 'امروز کاری ثبت نشده', 'از کادر بالا یا دکمهٔ + اضافه کنید'));
  } else {
    const box = el('div', { class: 'list' });
    for (const t of agenda.today) box.append(taskRow(t, { onChange: refresh }));
    wrap.append(box);
  }

  /* --------------------------------------------------- سررسید مالی */
  if (agenda.money.length) {
    wrap.append(sectionTitle('سررسیدهای مالی'));
    const box = el('div', { class: 'list' });
    for (const m of agenda.money) {
      box.append(el('div', { class: 'row money-row' + (m.late ? ' late' : '') },
        el('div', { class: 'row-icon', text: m.direction === 'out' ? '↑' : '↓' }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, m.title,
            m.late ? el('span', { class: 'badge warn', text: 'گذشته' }) : null),
          el('div', { class: 'row-sub', text: [DT.relativeDay(m.date, state.today), m.extra].filter(Boolean).join(' · ') }),
        ),
        el('div', { class: 'row-meta ' + (m.direction === 'out' ? 'out' : 'in'), text: money(m.amount) }),
      ));
    }
    wrap.append(box, el('a', { class: 'more-link', href: '#/finance', text: 'رفتن به حساب و کتاب ‹' }));
  }

  /* ------------------------------------------------- مناسبت‌ها */
  if (agenda.events.length) {
    wrap.append(sectionTitle('تاریخ‌های نزدیک'));
    const box = el('div', { class: 'list' });
    for (const ev of agenda.events) {
      box.append(el('div', { class: 'row' },
        el('div', { class: 'row-icon', text: KINDS[ev.kind] || '📌' }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, ev.title),
          el('div', { class: 'row-sub', text: DT.formatISOLong(ev.occurrence) }),
        ),
        el('div', { class: 'row-meta', text: DT.relativeDay(ev.occurrence, state.today) }),
      ));
    }
    wrap.append(box);
  }

  /* --------------------------------------------------- هفتهٔ پیش‌رو */
  if (agenda.upcoming.length) {
    wrap.append(sectionTitle('هفتهٔ پیش‌رو'));
    const byDay = new Map();
    for (const t of agenda.upcoming) {
      if (!byDay.has(t.occurrence)) byDay.set(t.occurrence, []);
      byDay.get(t.occurrence).push(t);
    }
    const box = el('div', { class: 'week' });
    for (const [day, items] of Array.from(byDay.entries()).slice(0, 7)) {
      box.append(el('div', { class: 'week-day' },
        el('div', { class: 'week-head' },
          el('strong', { text: DT.J.WEEKDAY_NAMES[DT.dowISO(day)] }),
          el('span', { class: 'dim', text: DT.formatISOShort(day) }),
        ),
        ...items.map((t) => el('div', { class: 'week-item' },
          el('span', { class: 'tag', text: catIcon(t.category) }),
          el('span', { text: t.title }),
          t.due_time ? el('span', { class: 'dim', text: fa(t.due_time) }) : null,
        )),
      ));
    }
    wrap.append(box);
  }

  wrap.append(fab(() => taskEditor({ due_date: state.today }, refresh)));
  return wrap;
}
