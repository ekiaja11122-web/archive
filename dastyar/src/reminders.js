/**
 * یادآوری‌های خودکار — هر نیم‌ساعت یک‌بار توسط Cloudflare اجرا می‌شود
 */
import { nowTehran, formatISOShort } from '../public/lib/dt.js';
import { toPersianDigits } from '../public/lib/jalali.js';
import { allSettings } from './auth.js';
import { getAgenda } from './agenda.js';
import { sendToAll } from './push.js';
import { now } from './util.js';

/** آیا این یادآوری قبلاً فرستاده شده؟ (جلوگیری از تکرار) */
async function once(env, key) {
  const res = await env.DB.prepare('INSERT OR IGNORE INTO notify_log (key, sent_at) VALUES (?, ?)')
    .bind(key, now()).run();
  return (res.meta?.changes || 0) > 0;
}

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? +m[1] * 60 + +m[2] : null;
};

const money = (n) => toPersianDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان';

export async function runReminders(env) {
  const settings = await allSettings(env);
  if (settings.notify_enabled === '0') return { skipped: true };

  const t = nowTehran();
  const today = t.date;
  const agenda = await getAgenda(env, today, 3);
  const sent = [];

  /* ---------------------------------------------- ۱) خلاصهٔ صبحگاهی */
  const hour = Math.min(23, Math.max(0, parseInt(settings.notify_hour || '8', 10)));
  if (t.minutes >= hour * 60 && t.minutes < hour * 60 + 60) {
    if (await once(env, `digest:${today}`)) {
      const pending = agenda.today.filter((x) => !x.done_today && x.status !== 'done');
      const dueMoney = agenda.money.filter((m) => m.date <= today);
      const lines = [];
      if (pending.length) lines.push(`${toPersianDigits(pending.length)} کار برای امروز`);
      if (agenda.overdue.length) lines.push(`${toPersianDigits(agenda.overdue.length)} کار عقب‌افتاده`);
      if (dueMoney.length) lines.push(`${toPersianDigits(dueMoney.length)} سررسید مالی`);
      if (agenda.events.length) lines.push(agenda.events[0].title);

      if (lines.length) {
        const titles = pending.slice(0, 4).map((x) => '• ' + x.title).join('\n');
        await sendToAll(env, {
          title: `برنامهٔ امروز — ${formatISOShort(today)}`,
          body: lines.join(' · ') + (titles ? '\n' + titles : ''),
          tag: 'digest',
          url: '/#/today',
        });
        sent.push('digest');
      }
    }
  }

  /* ------------------------------------- ۲) کارهای ساعت‌دار (سر وقت) */
  for (const task of agenda.today) {
    if (task.done_today || task.status === 'done') continue;
    const at = toMinutes(task.due_time);
    if (at === null) continue;
    const target = at - (task.remind_before || 0);
    if (t.minutes >= target && t.minutes < target + 30) {
      if (await once(env, `task:${task.id}:${today}:${target}`)) {
        await sendToAll(env, {
          title: task.title,
          body: (task.remind_before ? `تا ${toPersianDigits(task.remind_before)} دقیقهٔ دیگر — ` : 'همین حالا — ')
            + `ساعت ${toPersianDigits(task.due_time)}` + (task.notes ? `\n${task.notes}` : ''),
          tag: 'task-' + task.id,
          url: '/#/today',
        });
        sent.push('task:' + task.id);
      }
    }
  }

  /* ------------------------------------------ ۳) سررسیدهای مالی امروز */
  if (t.minutes >= hour * 60 && t.minutes < hour * 60 + 60) {
    for (const m of agenda.money) {
      if (m.date !== today) continue;
      if (await once(env, `money:${m.type}:${m.id}:${today}`)) {
        await sendToAll(env, {
          title: m.direction === 'out' ? 'سررسید پرداخت' : 'سررسید دریافت',
          body: `${m.title} — ${money(m.amount)}${m.extra ? ' (' + m.extra + ')' : ''}`,
          tag: 'money-' + m.id,
          url: '/#/finance',
        });
        sent.push('money:' + m.id);
      }
    }
  }

  /* --------------------------------------------- ۴) مناسبت‌های نزدیک */
  if (t.minutes >= hour * 60 && t.minutes < hour * 60 + 60) {
    for (const ev of agenda.events) {
      if (ev.days_away > (ev.remind_days || 0) && ev.days_away !== 0) continue;
      if (await once(env, `event:${ev.id}:${ev.occurrence}:${ev.days_away}`)) {
        await sendToAll(env, {
          title: ev.title,
          body: ev.days_away === 0 ? 'امروز است' : `${toPersianDigits(ev.days_away)} روز مانده — ${formatISOShort(ev.occurrence)}`,
          tag: 'event-' + ev.id,
          url: '/#/dates',
        });
        sent.push('event:' + ev.id);
      }
    }
  }

  // نظافت: پاک‌کردن سابقهٔ قدیمی
  await env.DB.prepare('DELETE FROM notify_log WHERE sent_at < ?')
    .bind(new Date(Date.now() - 45 * 86400000).toISOString()).run();

  return { at: `${today} ${t.time}`, sent };
}
