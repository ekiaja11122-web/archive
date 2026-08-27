/**
 * صفحهٔ «حساب و کتاب» — بدهی و طلب، اقساط، واریزهای برنامه‌ریزی‌شده
 */
import {
  api, state, el, fa, money, moneyShort, parseMoney, DT, toast, sheet,
  confirmBox, emptyState, matches,
} from '../core.js';
import {
  field, input, textarea, chips, moneyInput, dateField, searchBar, fab, btn, sectionTitle, statCard,
} from '../components.js';

const TABS = [
  { value: 'debts', label: 'بدهی و طلب' },
  { value: 'installments', label: 'اقساط' },
  { value: 'payments', label: 'واریزها' },
];

/* ---------------------------------------------------- بدهی و طلب */

export function debtEditor(item, onSaved) {
  const isNew = !item?.id;
  const d = { kind: 'payable', ...item };
  const kind = chips([
    { value: 'payable', label: 'من بدهکارم', icon: '↑' },
    { value: 'receivable', label: 'من طلبکارم', icon: '↓' },
  ], d.kind);
  const person = input({ value: d.person || '', placeholder: 'نام طرف حساب' });
  const amount = moneyInput(d.amount || 0);
  const due = dateField(d.due_date || '');
  const note = textarea({ value: d.note || '', placeholder: 'بابت چه چیزی؟' });

  const save = async () => {
    if (!person.value.trim()) return toast('نام طرف حساب را بنویسید', 'err');
    const payload = {
      kind: kind.value, person: person.value.trim(), amount: amount.amount,
      due_date: due.value || null, note: note.value,
    };
    if (isNew) await api.create('debts', payload);
    else await api.update('debts', d.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };

  const s = sheet(isNew ? 'بدهی یا طلب تازه' : 'ویرایش', el('div', { class: 'form' },
    field('نوع', kind), field('طرف حساب', person), field('مبلغ (تومان)', amount),
    field('سررسید', due), field('بابت', note),
  ), [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('حذف شود؟')) { await api.remove('debts', d.id); s.close(); onSaved?.(); }
    }) : null,
    btn(isNew ? 'افزودن' : 'ذخیره', 'primary', save),
  ].filter(Boolean));
}

function payDebtSheet(debt, onSaved) {
  const remaining = (debt.amount || 0) - (debt.paid || 0);
  const amount = moneyInput(remaining);
  const date = dateField(state.today, { allowEmpty: false });
  const note = input({ placeholder: 'توضیح (اختیاری)' });
  const s = sheet(debt.kind === 'payable' ? 'ثبت پرداخت' : 'ثبت دریافت', el('div', { class: 'form' },
    el('p', { class: 'dim', text: `مانده: ${money(remaining)}` }),
    field('مبلغ', amount), field('تاریخ', date), field('توضیح', note),
  ), [btn('ثبت', 'primary', async () => {
    await api.payDebt(debt.id, { amount: amount.amount, date: date.value, note: note.value });
    s.close(); toast('ثبت شد'); onSaved?.();
  })]);
}

/* ------------------------------------------------------------ اقساط */

export function installmentEditor(item, onSaved) {
  const isNew = !item?.id;
  const d = { total_count: 12, paid_count: 0, ...item };
  const title = input({ value: d.title || '', placeholder: 'مثلاً: وام مسکن' });
  const entity = input({ value: d.entity || '', placeholder: 'بانک یا طرف حساب' });
  const amount = moneyInput(d.amount || 0);
  const total = input({ type: 'number', min: 1, value: d.total_count || 12, class: 'input small' });
  const paid = input({ type: 'number', min: 0, value: d.paid_count || 0, class: 'input small' });
  const next = dateField(d.next_due || '', { allowEmpty: false });
  const note = textarea({ value: d.note || '' });

  const save = async () => {
    if (!title.value.trim()) return toast('عنوان را بنویسید', 'err');
    const payload = {
      title: title.value.trim(), entity: entity.value, amount: amount.amount,
      total_count: Math.max(1, Number(DT.J.toEnglishDigits(total.value)) || 1),
      paid_count: Math.max(0, Number(DT.J.toEnglishDigits(paid.value)) || 0),
      next_due: next.value || state.today, note: note.value,
    };
    if (isNew) await api.create('installments', payload);
    else await api.update('installments', d.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };

  const s = sheet(isNew ? 'قسط تازه' : 'ویرایش قسط', el('div', { class: 'form' },
    field('عنوان', title), field('بانک / طرف حساب', entity), field('مبلغ هر قسط', amount),
    el('div', { class: 'two' }, field('تعداد کل', total), field('پرداخت‌شده', paid)),
    field('سررسید قسط بعدی', next), field('یادداشت', note),
    el('p', { class: 'field-hint', text: 'با ثبت هر پرداخت، سررسید بعدی خودکار یک ماه شمسی جلو می‌رود.' }),
  ), [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('حذف شود؟')) { await api.remove('installments', d.id); s.close(); onSaved?.(); }
    }) : null,
    btn(isNew ? 'افزودن' : 'ذخیره', 'primary', save),
  ].filter(Boolean));
}

/* ---------------------------------------------------------- واریزها */

export function paymentEditor(item, onSaved) {
  const isNew = !item?.id;
  const d = { direction: 'out', repeat_rule: 'none', ...item };
  const title = input({ value: d.title || '', placeholder: 'مثلاً: اجارهٔ خانه' });
  const amount = moneyInput(d.amount || 0);
  const direction = chips([
    { value: 'out', label: 'باید بپردازم', icon: '↑' },
    { value: 'in', label: 'باید بگیرم', icon: '↓' },
  ], d.direction);
  const due = dateField(d.due_date || '', { allowEmpty: false });
  const repeat = chips([
    { value: 'none', label: 'یک‌بار' },
    { value: 'monthly', label: 'هر ماه' },
    { value: 'yearly', label: 'هر سال' },
  ], d.repeat_rule);
  const category = input({ value: d.category || '', placeholder: 'دسته (قبض، اجاره، بیمه…)' });
  const note = textarea({ value: d.note || '' });

  const save = async () => {
    if (!title.value.trim()) return toast('عنوان را بنویسید', 'err');
    const payload = {
      title: title.value.trim(), amount: amount.amount, direction: direction.value,
      due_date: due.value || state.today, repeat_rule: repeat.value,
      category: category.value, note: note.value,
    };
    if (isNew) await api.create('payments', payload);
    else await api.update('payments', d.id, payload);
    s.close(); toast('ذخیره شد'); onSaved?.();
  };

  const s = sheet(isNew ? 'واریز تازه' : 'ویرایش', el('div', { class: 'form' },
    field('عنوان', title), field('نوع', direction), field('مبلغ', amount),
    field('سررسید', due), field('تکرار', repeat), field('دسته', category), field('یادداشت', note),
  ), [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('حذف شود؟')) { await api.remove('payments', d.id); s.close(); onSaved?.(); }
    }) : null,
    btn(isNew ? 'افزودن' : 'ذخیره', 'primary', save),
  ].filter(Boolean));
}

/* -------------------------------------------------------------- صفحه */

export async function renderFinance({ refresh }) {
  const [debts, installments, payments, summary] = await Promise.all([
    api.list('debts'), api.list('installments'), api.list('payments'), api.financeSummary(state.today),
  ]);

  const t = summary.totals || {};
  const wrap = el('div', { class: 'page' });
  let tab = sessionStorage.getItem('dastyar.financeTab') || 'debts';
  let query = '';

  const body = el('div', {});

  const drawDebts = () => {
    const open = debts.filter((d) => d.status === 'open' && matches(`${d.person} ${d.note}`, query));
    const settled = debts.filter((d) => d.status !== 'open' && matches(`${d.person} ${d.note}`, query));
    const list = el('div', { class: 'list' });
    if (!open.length && !settled.length) list.append(emptyState('🤝', 'موردی ثبت نشده', 'بدهی‌ها و طلب‌هایتان را این‌جا نگه دارید'));

    for (const d of open) {
      const remaining = (d.amount || 0) - (d.paid || 0);
      list.append(el('div', { class: 'card' },
        el('div', { class: 'card-head' },
          el('div', {},
            el('div', { class: 'card-title' }, d.person,
              el('span', { class: 'badge ' + (d.kind === 'payable' ? 'out' : 'in'), text: d.kind === 'payable' ? 'بدهکارم' : 'طلبکارم' })),
            d.note ? el('div', { class: 'row-sub', text: d.note }) : null,
          ),
          el('div', { class: 'card-amount ' + (d.kind === 'payable' ? 'out' : 'in'), text: money(remaining) }),
        ),
        d.paid ? el('div', { class: 'progress' }, el('span', { style: `width:${Math.min(100, (d.paid / (d.amount || 1)) * 100)}%` })) : null,
        el('div', { class: 'card-foot' },
          el('span', { class: 'dim small', text: d.due_date ? 'سررسید: ' + DT.formatISOShort(d.due_date) + ' (' + DT.relativeDay(d.due_date, state.today) + ')' : 'بدون سررسید' }),
          el('div', { class: 'row-actions' },
            btn(d.kind === 'payable' ? 'پرداخت' : 'دریافت', 'small primary', () => payDebtSheet(d, refresh)),
            btn('ویرایش', 'small ghost', () => debtEditor(d, refresh)),
          ),
        ),
      ));
    }
    if (settled.length) {
      list.append(sectionTitle('تسویه‌شده'));
      for (const d of settled) {
        list.append(el('div', { class: 'row done' },
          el('div', { class: 'row-icon', text: '✔' }),
          el('div', { class: 'row-main', onclick: () => debtEditor(d, refresh) },
            el('div', { class: 'row-title' }, d.person),
            el('div', { class: 'row-sub', text: money(d.amount) }),
          ),
        ));
      }
    }
    body.replaceChildren(list);
  };

  const drawInstallments = () => {
    const list = el('div', { class: 'list' });
    const items = installments.filter((i) => matches(`${i.title} ${i.entity}`, query));
    if (!items.length) list.append(emptyState('🏦', 'قسطی ثبت نشده', 'وام و اقساطتان را این‌جا پیگیری کنید'));
    for (const i of items.sort((a, b) => String(a.next_due || '9999').localeCompare(b.next_due || '9999'))) {
      const left = (i.total_count || 0) - (i.paid_count || 0);
      const late = i.next_due && i.next_due < state.today && i.status === 'open';
      list.append(el('div', { class: 'card' + (late ? ' late' : '') },
        el('div', { class: 'card-head' },
          el('div', {},
            el('div', { class: 'card-title' }, i.title,
              i.status !== 'open' ? el('span', { class: 'badge ok', text: 'تمام شد' }) : null,
              late ? el('span', { class: 'badge warn', text: 'عقب‌افتاده' }) : null),
            el('div', { class: 'row-sub', text: [i.entity, `قسط ${fa(i.paid_count + (i.status === 'open' ? 1 : 0))} از ${fa(i.total_count)}`].filter(Boolean).join(' · ') }),
          ),
          el('div', { class: 'card-amount out', text: money(i.amount) }),
        ),
        el('div', { class: 'progress' }, el('span', { style: `width:${((i.paid_count || 0) / (i.total_count || 1)) * 100}%` })),
        el('div', { class: 'card-foot' },
          el('span', { class: 'dim small', text: i.status === 'open'
            ? `سررسید بعدی: ${DT.formatISOShort(i.next_due)} (${DT.relativeDay(i.next_due, state.today)}) — مانده: ${money(i.amount * left, false)} تومان`
            : 'همهٔ اقساط پرداخت شد' }),
          el('div', { class: 'row-actions' },
            i.status === 'open' ? btn('پرداخت شد', 'small primary', async () => {
              if (await confirmBox(`قسط ${fa(i.paid_count + 1)} از ${fa(i.total_count)} پرداخت شد؟`, { danger: false, okText: 'بله، ثبت کن' })) {
                await api.payInstallment(i.id, { date: state.today });
                toast('ثبت شد'); refresh();
              }
            }) : null,
            btn('ویرایش', 'small ghost', () => installmentEditor(i, refresh)),
          ),
        ),
      ));
    }
    body.replaceChildren(list);
  };

  const drawPayments = () => {
    const list = el('div', { class: 'list' });
    const items = payments.filter((p) => matches(`${p.title} ${p.category}`, query));
    if (!items.length) list.append(emptyState('📮', 'واریزی ثبت نشده', 'قبض‌ها، اجاره و واریزهای دوره‌ای'));
    for (const p of items) {
      const late = p.status === 'open' && p.due_date && p.due_date < state.today;
      list.append(el('div', { class: 'row' + (p.status === 'paid' ? ' done' : '') + (late ? ' late' : '') },
        el('div', { class: 'row-icon', text: p.direction === 'out' ? '↑' : '↓' }),
        el('div', { class: 'row-main', onclick: () => paymentEditor(p, refresh) },
          el('div', { class: 'row-title' }, p.title,
            p.repeat_rule !== 'none' ? el('span', { class: 'badge', text: p.repeat_rule === 'monthly' ? 'ماهانه' : 'سالانه' }) : null,
            late ? el('span', { class: 'badge warn', text: 'گذشته' }) : null),
          el('div', { class: 'row-sub', text: [p.category, p.due_date ? DT.formatISOShort(p.due_date) + ' · ' + DT.relativeDay(p.due_date, state.today) : ''].filter(Boolean).join(' — ') }),
        ),
        el('div', { class: 'row-meta ' + (p.direction === 'out' ? 'out' : 'in'), text: money(p.amount) }),
        p.status === 'open' ? el('div', { class: 'row-actions' },
          btn('انجام شد', 'small primary', async () => {
            await api.payPayment(p.id, { date: state.today });
            toast('ثبت شد'); refresh();
          })) : null,
      ));
    }
    body.replaceChildren(list);
  };

  const draw = () => {
    sessionStorage.setItem('dastyar.financeTab', tab);
    if (tab === 'debts') drawDebts();
    else if (tab === 'installments') drawInstallments();
    else drawPayments();
  };

  wrap.append(
    el('div', { class: 'stats three' },
      statCard('بدهی من', moneyShort(t.payable || 0), 'تومان', (t.payable || 0) ? 'warn' : ''),
      statCard('طلب من', moneyShort(t.receivable || 0), 'تومان', 'ok'),
      statCard('اقساط باقی‌مانده', moneyShort(t.installments_left || 0), 'تومان'),
    ),
    el('a', { class: 'more-link', href: '#/reports', text: 'گزارش ماهانه ‹' }),
    searchBar('جست‌وجو…', (v) => { query = v; draw(); }),
    el('div', { class: 'scroll-x' }, chips(TABS, tab, (v) => { tab = v; draw(); })),
    body,
    fab(() => {
      if (tab === 'debts') debtEditor({}, refresh);
      else if (tab === 'installments') installmentEditor({}, refresh);
      else paymentEditor({}, refresh);
    }),
  );
  draw();
  return wrap;
}
