/**
 * ساخت «برنامهٔ روز» — کارها و سررسیدهای مالیِ یک تاریخ مشخص
 * هم صفحهٔ «امروز» و هم یادآوری‌های خودکار از همین‌جا تغذیه می‌شوند.
 */
import { isDueOn } from '../public/lib/recur.js';
import { addDaysISO, diffDaysISO, isoToJalali, jalaliToISO } from '../public/lib/dt.js';
import { J } from '../public/lib/dt.js';

const fa = (v) => J.toPersianDigits(v);

/** سررسید بعدیِ یک مناسبت تکرارشوندهٔ سالانه */
export function nextEventDate(ev, today) {
  if ((ev.repeat_rule || 'yearly') !== 'yearly') return ev.date;
  const base = isoToJalali(ev.date);
  const cur = isoToJalali(today);
  if (!base || !cur) return ev.date;
  for (const jy of [cur.jy, cur.jy + 1]) {
    const len = J.jalaliMonthLength(jy, base.jm);
    const iso = jalaliToISO(jy, base.jm, Math.min(base.jd, len));
    if (iso >= today) return iso;
  }
  return ev.date;
}

/**
 * @param {object} env
 * @param {string} today تاریخ ISO مبنا
 * @param {number} horizon چند روز جلوتر هم آورده شود
 */
export async function getAgenda(env, today, horizon = 7) {
  const limit = addDaysISO(today, horizon);

  const [tasksRes, logRes, instRes, payRes, debtRes, evRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM tasks WHERE status != 'archived'"),
    env.DB.prepare('SELECT task_id, date FROM task_log WHERE date >= ?').bind(addDaysISO(today, -1)),
    env.DB.prepare("SELECT * FROM installments WHERE status = 'open'"),
    env.DB.prepare("SELECT * FROM payments WHERE status = 'open'"),
    env.DB.prepare("SELECT * FROM debts WHERE status = 'open'"),
    env.DB.prepare('SELECT * FROM events'),
  ]);

  const doneToday = new Set((logRes.results || []).filter((r) => r.date === today).map((r) => r.task_id));

  const todayTasks = [];
  const overdue = [];
  const upcoming = [];

  for (const t of tasksRes.results || []) {
    const repeating = (t.repeat_rule || 'none') !== 'none';

    if (repeating) {
      if (isDueOn(t, today)) {
        todayTasks.push({ ...t, repeating: 1, done_today: doneToday.has(t.id) ? 1 : 0 });
      } else {
        for (let i = 1; i <= horizon; i += 1) {
          const d = addDaysISO(today, i);
          if (isDueOn(t, d)) { upcoming.push({ ...t, repeating: 1, occurrence: d }); break; }
        }
      }
      continue;
    }

    if (t.status === 'done') continue;
    if (!t.due_date) { todayTasks.push({ ...t, repeating: 0, no_date: 1, done_today: 0 }); continue; }
    if (t.due_date === today) todayTasks.push({ ...t, repeating: 0, done_today: 0 });
    else if (t.due_date < today) overdue.push({ ...t, repeating: 0, late_days: -diffDaysISO(today, t.due_date) });
    else if (t.due_date <= limit) upcoming.push({ ...t, repeating: 0, occurrence: t.due_date });
  }

  const sortKey = (a, b) => (b.priority - a.priority) || String(a.due_time || '99:99').localeCompare(b.due_time || '99:99');
  todayTasks.sort(sortKey);
  overdue.sort((a, b) => String(a.due_date).localeCompare(b.due_date));
  upcoming.sort((a, b) => String(a.occurrence).localeCompare(b.occurrence));

  /* --------------------------------------------------------- بخش مالی */
  const money = [];
  for (const it of instRes.results || []) {
    if (it.next_due && it.next_due <= limit) {
      money.push({
        type: 'installment', id: it.id, title: it.title, entity: it.entity,
        amount: it.amount, date: it.next_due, direction: 'out',
        late: it.next_due < today ? 1 : 0,
        extra: `قسط ${fa(it.paid_count + 1)} از ${fa(it.total_count)}`,
      });
    }
  }
  for (const p of payRes.results || []) {
    if (p.due_date && p.due_date <= limit) {
      money.push({
        type: 'payment', id: p.id, title: p.title, amount: p.amount,
        date: p.due_date, direction: p.direction, late: p.due_date < today ? 1 : 0,
      });
    }
  }
  for (const d of debtRes.results || []) {
    if (d.due_date && d.due_date <= limit) {
      money.push({
        type: 'debt', id: d.id, title: d.kind === 'payable' ? `بدهی به ${d.person}` : `طلب از ${d.person}`,
        amount: Math.max(0, (d.amount || 0) - (d.paid || 0)), date: d.due_date,
        direction: d.kind === 'payable' ? 'out' : 'in', late: d.due_date < today ? 1 : 0,
      });
    }
  }
  money.sort((a, b) => String(a.date).localeCompare(b.date));

  /* --------------------------------------------------- مناسبت‌های مهم */
  const events = [];
  for (const ev of evRes.results || []) {
    const date = nextEventDate(ev, today);
    const away = diffDaysISO(today, date);
    if (away === null) continue;
    if (away <= Math.max(horizon, ev.remind_days || 0)) {
      events.push({ ...ev, occurrence: date, days_away: away });
    }
  }
  events.sort((a, b) => a.days_away - b.days_away);

  return { date: today, today: todayTasks, overdue, upcoming, money, events };
}
