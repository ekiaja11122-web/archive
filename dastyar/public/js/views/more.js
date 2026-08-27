/**
 * صفحه‌های «بیشتر»: یادداشت، مخاطبین، تاریخ‌های مهم، گزارش مالی و تنظیمات
 */
import {
  api, state, el, fa, en, money, moneyShort, DT, toast, sheet, confirmBox,
  copyToClipboard, matches, emptyState, Crypto, mount,
} from '../core.js';
import {
  field, input, textarea, chips, dateField, moneyInput, searchBar, fab, btn, sectionTitle, statCard,
} from '../components.js';

/* ================================================================ بیشتر */

const LINKS = [
  { href: '#/notes', icon: '🗒', title: 'یادداشت‌ها', sub: 'هر چیزی که باید یادت بماند' },
  { href: '#/contacts', icon: '👥', title: 'مخاطبین', sub: 'شماره‌ها و آدرس‌ها' },
  { href: '#/dates', icon: '📅', title: 'تاریخ‌های مهم', sub: 'تولد، بیمه، چک، قرارداد' },
  { href: '#/reports', icon: '📊', title: 'گزارش مالی', sub: 'خلاصهٔ ماه و دسته‌بندی' },
  { href: '#/settings', icon: '⚙', title: 'تنظیمات', sub: 'یادآوری، رمز، پشتیبان‌گیری' },
];

export async function renderMore() {
  const wrap = el('div', { class: 'page' });
  wrap.append(el('div', { class: 'list' }, ...LINKS.map((l) => el('a', { class: 'row tappable', href: l.href },
    el('div', { class: 'row-icon', text: l.icon }),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, l.title),
      el('div', { class: 'row-sub', text: l.sub }),
    ),
    el('div', { class: 'row-meta', text: '‹' }),
  ))));
  wrap.append(el('div', { class: 'stats' },
    statCard('کارهای باز', fa(state.counts.tasks || 0)),
    statCard('مورد در گاوصندوق', fa(state.counts.vault || 0)),
    statCard('حساب‌های باز', fa(state.counts.debts || 0)),
  ));
  return wrap;
}

/* ============================================================ یادداشت‌ها */

const NOTE_COLORS = ['', 'yellow', 'green', 'blue', 'pink'];

function noteEditor(note, onSaved) {
  const isNew = !note?.id;
  const title = input({ value: note?.title || '', placeholder: 'عنوان' });
  const bodyIn = textarea({ value: note?.body || '', rows: 10, placeholder: 'متن یادداشت…' });
  const color = chips(NOTE_COLORS.map((c) => ({ value: c, label: c ? '⬤' : 'بی‌رنگ' })), note?.color || '');

  const save = async () => {
    const payload = { title: title.value.trim(), body: bodyIn.value, color: color.value };
    if (!payload.title && !payload.body) return toast('یادداشت خالی است', 'err');
    if (isNew) await api.create('notes', payload);
    else await api.update('notes', note.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };

  const s = sheet(isNew ? 'یادداشت تازه' : 'ویرایش یادداشت',
    el('div', { class: 'form' }, field('عنوان', title), field('متن', bodyIn), field('رنگ', color)), [
      !isNew ? btn('حذف', 'danger ghost', async () => {
        if (await confirmBox('حذف شود؟')) { await api.remove('notes', note.id); s.close(); onSaved?.(); }
      }) : null,
      btn('ذخیره', 'primary', save),
    ].filter(Boolean));
  setTimeout(() => (isNew ? title : bodyIn).focus(), 150);
}

export async function renderNotes({ refresh }) {
  const notes = await api.list('notes');
  const wrap = el('div', { class: 'page' });
  let query = '';
  const grid = el('div', { class: 'notes-grid' });

  const draw = () => {
    const items = notes.filter((n) => matches(`${n.title} ${n.body}`, query));
    grid.replaceChildren();
    if (!items.length) { grid.append(emptyState('🗒', 'یادداشتی نیست', 'با + اضافه کنید')); return; }
    for (const n of items) {
      grid.append(el('div', { class: 'note ' + (n.color || ''), onclick: () => noteEditor(n, refresh) },
        el('button', {
          class: 'pin' + (n.pinned ? ' on' : ''), text: '📌', title: 'سنجاق',
          onclick: async (e) => { e.stopPropagation(); await api.update('notes', n.id, { pinned: n.pinned ? 0 : 1 }); refresh(); },
        }),
        n.title ? el('h4', { text: n.title }) : null,
        el('p', { text: (n.body || '').slice(0, 240) }),
        el('span', { class: 'dim tiny', text: DT.formatISOShort(String(n.updated_at || '').slice(0, 10)) }),
      ));
    }
  };
  wrap.append(searchBar('جست‌وجو در یادداشت‌ها…', (v) => { query = v; draw(); }), grid, fab(() => noteEditor({}, refresh)));
  draw();
  return wrap;
}

/* ============================================================== مخاطبین */

function contactEditor(c, onSaved) {
  const isNew = !c?.id;
  const name = input({ value: c?.name || '', placeholder: 'نام و نام خانوادگی' });
  const phone = input({ value: c?.phone || '', placeholder: '۰۹۱۲…', inputmode: 'tel' });
  const phone2 = input({ value: c?.phone2 || '', placeholder: 'شمارهٔ دوم', inputmode: 'tel' });
  const email = input({ value: c?.email || '', placeholder: 'ایمیل', type: 'email' });
  const tags = input({ value: c?.tags || '', placeholder: 'برچسب‌ها: کاری، فامیل…' });
  const note = textarea({ value: c?.note || '' });

  const save = async () => {
    if (!name.value.trim()) return toast('نام را بنویسید', 'err');
    const payload = {
      name: name.value.trim(), phone: en(phone.value), phone2: en(phone2.value),
      email: email.value, tags: tags.value, note: note.value,
    };
    if (isNew) await api.create('contacts', payload);
    else await api.update('contacts', c.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };
  const s = sheet(isNew ? 'مخاطب تازه' : 'ویرایش مخاطب', el('div', { class: 'form' },
    field('نام', name), field('شمارهٔ تماس', phone), field('شمارهٔ دوم', phone2),
    field('ایمیل', email), field('برچسب', tags), field('یادداشت', note),
  ), [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('حذف شود؟')) { await api.remove('contacts', c.id); s.close(); onSaved?.(); }
    }) : null,
    btn('ذخیره', 'primary', save),
  ].filter(Boolean));
}

export async function renderContacts({ refresh }) {
  const contacts = await api.list('contacts');
  const wrap = el('div', { class: 'page' });
  let query = '';
  const list = el('div', { class: 'list' });

  const draw = () => {
    const items = contacts.filter((c) => matches(`${c.name} ${c.phone} ${c.phone2} ${c.tags} ${c.note}`, query));
    list.replaceChildren();
    if (!items.length) { list.append(emptyState('👥', 'مخاطبی نیست', 'با + اضافه کنید')); return; }
    for (const c of items) {
      list.append(el('div', { class: 'row' },
        el('div', { class: 'row-icon', text: (c.name || '?').trim()[0] }),
        el('div', { class: 'row-main', onclick: () => contactEditor(c, refresh) },
          el('div', { class: 'row-title' }, c.name, c.tags ? el('span', { class: 'badge', text: c.tags.split(/[,،]/)[0].trim() }) : null),
          el('div', { class: 'row-sub', text: fa(c.phone || c.email || '') }),
        ),
        el('div', { class: 'row-actions' },
          c.phone ? el('a', { class: 'icon-btn', href: 'tel:' + c.phone, title: 'تماس', text: '📞' }) : null,
          c.phone ? el('button', { class: 'icon-btn', title: 'کپی شماره', text: '⧉', onclick: () => copyToClipboard(c.phone, 'شماره کپی شد') }) : null,
        ),
      ));
    }
  };
  wrap.append(searchBar('جست‌وجوی مخاطب…', (v) => { query = v; draw(); }), list, fab(() => contactEditor({}, refresh)));
  draw();
  return wrap;
}

/* ======================================================= تاریخ‌های مهم */

const EVENT_KINDS = [
  { value: 'birthday', label: 'تولد', icon: '🎂' },
  { value: 'insurance', label: 'بیمه', icon: '🛡' },
  { value: 'check', label: 'چک', icon: '🧾' },
  { value: 'contract', label: 'قرارداد', icon: '📑' },
  { value: 'other', label: 'سایر', icon: '📌' },
];

function eventEditor(ev, onSaved) {
  const isNew = !ev?.id;
  const title = input({ value: ev?.title || '', placeholder: 'مثلاً: تولد مادر' });
  const kind = chips(EVENT_KINDS, ev?.kind || 'other');
  const date = dateField(ev?.date || state.today, { allowEmpty: false });
  const repeat = chips([{ value: 'yearly', label: 'هر سال' }, { value: 'none', label: 'یک‌بار' }], ev?.repeat_rule || 'yearly');
  const remind = chips([0, 1, 3, 7, 30].map((n) => ({ value: n, label: n ? `${fa(n)} روز قبل` : 'همان روز' })), ev?.remind_days ?? 1);
  const note = textarea({ value: ev?.note || '' });

  const save = async () => {
    if (!title.value.trim()) return toast('عنوان را بنویسید', 'err');
    const payload = {
      title: title.value.trim(), kind: kind.value, date: date.value,
      repeat_rule: repeat.value, remind_days: Number(remind.value) || 0, note: note.value,
    };
    if (isNew) await api.create('events', payload);
    else await api.update('events', ev.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };
  const s = sheet(isNew ? 'تاریخ تازه' : 'ویرایش', el('div', { class: 'form' },
    field('عنوان', title), field('نوع', kind), field('تاریخ', date),
    field('تکرار', repeat), field('یادآوری', remind), field('یادداشت', note),
  ), [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('حذف شود؟')) { await api.remove('events', ev.id); s.close(); onSaved?.(); }
    }) : null,
    btn('ذخیره', 'primary', save),
  ].filter(Boolean));
}

export async function renderDates({ refresh }) {
  const [events, agenda] = await Promise.all([api.list('events'), api.agenda(state.today, 400)]);
  const soonById = new Map(agenda.events.map((e) => [e.id, e]));
  const wrap = el('div', { class: 'page' });
  const list = el('div', { class: 'list' });

  const withNext = events.map((e) => ({ ...e, ...(soonById.get(e.id) || {}) }))
    .sort((a, b) => (a.days_away ?? 9999) - (b.days_away ?? 9999));

  if (!withNext.length) list.append(emptyState('📅', 'تاریخی ثبت نشده', 'تولدها، سررسید بیمه و چک‌ها را این‌جا بگذارید'));
  for (const ev of withNext) {
    const icon = (EVENT_KINDS.find((k) => k.value === ev.kind) || EVENT_KINDS[4]).icon;
    list.append(el('div', { class: 'row' },
      el('div', { class: 'row-icon', text: icon }),
      el('div', { class: 'row-main', onclick: () => eventEditor(ev, refresh) },
        el('div', { class: 'row-title' }, ev.title,
          ev.repeat_rule === 'yearly' ? el('span', { class: 'badge', text: 'سالانه' }) : null),
        el('div', { class: 'row-sub', text: DT.formatISOLong(ev.occurrence || ev.date) }),
      ),
      el('div', { class: 'row-meta', text: ev.occurrence ? DT.relativeDay(ev.occurrence, state.today) : '' }),
    ));
  }
  wrap.append(list, fab(() => eventEditor({}, refresh)));
  return wrap;
}

/* ============================================================ گزارش مالی */

export async function renderReports() {
  const wrap = el('div', { class: 'page' });
  let date = state.today;

  const body = el('div', {});
  const draw = async () => {
    body.replaceChildren(el('div', { class: 'loading' }, 'در حال محاسبه…'));
    const [summary, ledger] = await Promise.all([api.financeSummary(date), api.list('ledger', '?limit=300')]);
    const r = summary.range;
    const rows = ledger.filter((l) => l.date >= r.from && l.date <= r.to);
    const out = summary.month.find((m) => m.direction === 'out')?.total || 0;
    const inc = summary.month.find((m) => m.direction === 'in')?.total || 0;

    const byCat = {};
    for (const l of rows) {
      if (l.direction !== 'out') continue;
      byCat[l.category || 'بدون دسته'] = (byCat[l.category || 'بدون دسته'] || 0) + l.amount;
    }
    const max = Math.max(1, ...Object.values(byCat));

    body.replaceChildren();
    mount(body,
      el('div', { class: 'month-nav' },
        btn('ماه قبل', 'ghost small', () => { date = DT.addJalaliMonths(date, -1); draw(); }),
        el('strong', { text: `${DT.J.MONTH_NAMES[r.jm - 1]} ${fa(r.jy)}` }),
        btn('ماه بعد', 'ghost small', () => { date = DT.addJalaliMonths(date, 1); draw(); }),
      ),
      el('div', { class: 'stats' },
        statCard('پرداختی این ماه', moneyShort(out), 'تومان', 'warn'),
        statCard('دریافتی این ماه', moneyShort(inc), 'تومان', 'ok'),
        statCard('تراز', moneyShort(inc - out), 'تومان', inc - out >= 0 ? 'ok' : 'warn'),
      ),
      Object.keys(byCat).length ? sectionTitle('پرداخت‌ها بر اساس دسته') : null,
      ...Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => el('div', { class: 'bar-row' },
        el('div', { class: 'bar-label' }, el('span', { text: cat }), el('span', { class: 'dim', text: money(amount) })),
        el('div', { class: 'bar' }, el('span', { style: `width:${(amount / max) * 100}%` })),
      )),
      sectionTitle('تراکنش‌های ثبت‌شده'),
      rows.length ? el('div', { class: 'list' }, ...rows.map((l) => el('div', { class: 'row' },
        el('div', { class: 'row-icon', text: l.direction === 'out' ? '↑' : '↓' }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, l.title),
          el('div', { class: 'row-sub', text: [DT.formatISOShort(l.date), l.category, l.note].filter(Boolean).join(' · ') }),
        ),
        el('div', { class: 'row-meta ' + l.direction, text: money(l.amount) }),
      ))) : emptyState('📊', 'در این ماه تراکنشی ثبت نشده', 'با ثبت پرداخت‌ها این گزارش پر می‌شود'),
    );
  };
  wrap.append(body);
  await draw();
  return wrap;
}

/* ============================================================== تنظیمات */

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return toast('این مرورگر نوتیفیکیشن را پشتیبانی نمی‌کند', 'err');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return toast('اجازهٔ نوتیفیکیشن داده نشد', 'err');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });
  }
  await api.pushSubscribe({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 50) });
  toast('نوتیفیکیشن فعال شد ✔');
}

async function changePasswordSheet() {
  const cur = input({ type: 'password', placeholder: 'رمز فعلی' });
  const nw = input({ type: 'password', placeholder: 'رمز تازه' });
  const nw2 = input({ type: 'password', placeholder: 'تکرار رمز تازه' });
  const hint = input({ placeholder: 'یادآور رمز (اختیاری)', value: state.settings.hint || '' });
  const status = el('p', { class: 'dim' });

  const go = async () => {
    if (nw.value.length < 8) return toast('رمز تازه باید دست‌کم ۸ نویسه باشد', 'err');
    if (nw.value !== nw2.value) return toast('دو رمز تازه یکسان نیستند', 'err');
    status.textContent = 'در حال رمزگذاری دوبارهٔ گاوصندوق…';
    try {
      const cfg = await api.config();
      const old = await Crypto.deriveKeys(cur.value, cfg.auth_salt, cfg.enc_salt, cfg.kdf_iterations);
      const raw = await api.list('vault');
      const salts = Crypto.freshSalts();
      const fresh = await Crypto.deriveKeys(nw.value, salts.auth_salt, salts.enc_salt, salts.kdf_iterations);
      const items = [];
      for (const r of raw) {
        const data = await Crypto.decryptJSON(old.encKey, r.data_enc); // با رمز اشتباه خطا می‌دهد
        items.push({ id: r.id, data_enc: await Crypto.encryptJSON(fresh.encKey, data) });
      }
      await api.changePassword({ auth_key: fresh.authKey, ...salts, items, hint: hint.value });
      state.encKey = fresh.encKey;
      await Crypto.rememberKey(fresh.encKey, true);
      s.close();
      toast('رمز اصلی عوض شد');
    } catch (e) {
      status.textContent = '';
      toast(e.name === 'OperationError' ? 'رمز فعلی درست نیست' : e.message, 'err');
    }
  };

  const s = sheet('تغییر رمز اصلی', el('div', { class: 'form' },
    el('p', { class: 'dim', text: 'همهٔ اطلاعات گاوصندوق با رمز تازه دوباره رمزگذاری می‌شود و از همهٔ دستگاه‌ها خارج می‌شوید.' }),
    field('رمز فعلی', cur), field('رمز تازه', nw), field('تکرار', nw2), field('یادآور', hint), status,
  ), [btn('تغییر رمز', 'primary', go)]);
}

async function restoreSheet() {
  const file = el('input', { type: 'file', accept: 'application/json', class: 'input' });
  const mode = chips([
    { value: 'merge', label: 'ادغام با اطلاعات فعلی' },
    { value: 'replace', label: 'جایگزینی کامل' },
  ], 'merge');
  const s = sheet('بازیابی از فایل پشتیبان', el('div', { class: 'form' },
    el('p', { class: 'dim', text: 'فایل پشتیبان (JSON) را انتخاب کنید.' }), file, field('روش', mode),
  ), [btn('بازیابی', 'primary', async () => {
    const f = file.files?.[0];
    if (!f) return toast('فایلی انتخاب نشده', 'err');
    try {
      const data = JSON.parse(await f.text());
      const res = await api.restore({ ...data, mode: mode.value });
      s.close();
      toast(`بازیابی شد (${fa(res.rows)} ردیف)`);
      location.reload();
    } catch (e) { toast('فایل معتبر نیست: ' + e.message, 'err'); }
  })]);
}

export async function renderSettings({ refresh }) {
  const wrap = el('div', { class: 'page' });
  const s = state.settings;
  const devices = await api.pushDevices().catch(() => []);

  const name = input({ value: s.display_name || '', placeholder: 'نام شما (برای سلام گفتن)' });
  name.addEventListener('change', async () => {
    await api.settings({ display_name: name.value });
    state.settings.display_name = name.value;
    toast('ذخیره شد');
  });

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({ value: i, label: fa(String(i).padStart(2, '0')) + ':۰۰' }));
  const hour = el('select', { class: 'input' });
  for (const o of hourOptions) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(s.notify_hour || 8)) opt.selected = true;
    hour.append(opt);
  }
  hour.addEventListener('change', async () => {
    await api.settings({ notify_hour: hour.value });
    toast('ساعت یادآوری ذخیره شد');
  });

  const enabled = el('input', { type: 'checkbox', checked: s.notify_enabled !== '0' });
  enabled.addEventListener('change', async () => {
    await api.settings({ notify_enabled: enabled.checked ? '1' : '0' });
    toast(enabled.checked ? 'یادآوری‌ها روشن شد' : 'یادآوری‌ها خاموش شد');
  });

  wrap.append(
    sectionTitle('شخصی‌سازی'),
    el('div', { class: 'form card-form' }, field('نام شما', name)),

    sectionTitle('یادآوری'),
    el('div', { class: 'form card-form' },
      el('label', { class: 'check' }, enabled, el('span', { text: 'یادآوری‌های خودکار روشن باشد' })),
      field('ساعت خلاصهٔ روزانه', hour, 'هر روز در این ساعت، فهرست کارها و سررسیدها برایتان فرستاده می‌شود.'),
      el('div', { class: 'btn-row' },
        btn('فعال‌سازی روی این دستگاه', 'primary', () => enablePush().catch((e) => toast(e.message, 'err'))),
        btn('ارسال آزمایشی', 'ghost', async () => {
          const r = await api.pushTest();
          toast(r.sent ? `به ${fa(r.sent)} دستگاه فرستاده شد` : 'هیچ دستگاهی ثبت نشده', r.sent ? 'ok' : 'err');
        }),
      ),
      devices.length ? el('div', { class: 'list small-list' }, ...devices.map((d) => el('div', { class: 'row' },
        el('div', { class: 'row-icon', text: '📱' }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, d.label || 'دستگاه'),
          el('div', { class: 'row-sub', text: DT.formatISOShort(String(d.created_at).slice(0, 10)) }),
        ),
        el('button', { class: 'icon-btn danger', html: '&#10005;', onclick: async () => { await api.pushDeviceRemove(d.id); refresh(); } }),
      ))) : el('p', { class: 'field-hint', text: 'هنوز دستگاهی برای نوتیفیکیشن ثبت نشده است.' }),
      el('p', { class: 'field-hint', text: 'روی آیفون، اول باید برنامه را از دکمهٔ اشتراک‌گذاری سافاری به «صفحهٔ اصلی» اضافه کنید تا نوتیفیکیشن کار کند.' }),
    ),

    sectionTitle('امنیت'),
    el('div', { class: 'form card-form' },
      el('div', { class: 'btn-row' },
        btn('تغییر رمز اصلی', 'ghost', changePasswordSheet),
        btn('قفل کردن گاوصندوق', 'ghost', () => { Crypto.forgetKey(); state.encKey = null; toast('قفل شد'); }),
      ),
      el('p', { class: 'field-hint', text: 'رمز اصلی روی سرور ذخیره نمی‌شود؛ فقط اثر انگشت آن نگه‌داری می‌شود. اطلاعات گاوصندوق با همین رمز داخل مرورگر رمزگذاری می‌شوند.' }),
    ),

    sectionTitle('پشتیبان‌گیری'),
    el('div', { class: 'form card-form' },
      el('div', { class: 'btn-row' },
        btn('دریافت فایل پشتیبان', 'primary', async () => {
          const data = await api.backup();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: `dastyar-backup-${state.today}.json` });
          document.body.append(a); a.click(); a.remove();
          toast('فایل دانلود شد');
        }),
        btn('بازیابی از فایل', 'ghost', restoreSheet),
      ),
      el('p', { class: 'field-hint', text: 'اطلاعات گاوصندوق در فایل پشتیبان هم به صورت رمزشده ذخیره می‌شوند؛ برای بازخوانی‌شان همان رمز اصلی لازم است.' }),
    ),

    sectionTitle('حساب'),
    el('div', { class: 'form card-form' },
      btn('خروج از حساب', 'danger ghost', async () => {
        if (await confirmBox('از برنامه خارج می‌شوید؟')) {
          Crypto.forgetKey();
          await api.logout();
          location.reload();
        }
      }),
    ),
    el('p', { class: 'dim small center', text: 'دستیار شخصی — نسخهٔ ۱٫۰' }),
  );
  return wrap;
}
