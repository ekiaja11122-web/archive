/**
 * صفحهٔ «گاوصندوق» — رمزها، کارت‌ها و اطلاعات حساس
 * محتوای هر آیتم پیش از ارسال به سرور، داخل همین مرورگر رمزگذاری می‌شود.
 */
import {
  api, state, el, fa, en, toast, sheet, confirmBox, copyToClipboard,
  matches, emptyState, spinner, Crypto, DT, mount,
} from '../core.js';
import { field, input, textarea, chips, searchBar, fab, btn, sectionTitle } from '../components.js';

export const VAULT_CATEGORIES = [
  { value: 'password', label: 'رمز و حساب', icon: '🔑' },
  { value: 'card', label: 'کارت بانکی', icon: '💳' },
  { value: 'bank', label: 'حساب بانکی', icon: '🏦' },
  { value: 'document', label: 'مدارک', icon: '🪪' },
  { value: 'wifi', label: 'وای‌فای', icon: '📶' },
  { value: 'note', label: 'یادداشت محرمانه', icon: '🗒' },
  { value: 'other', label: 'سایر', icon: '📦' },
];

const catOf = (v) => VAULT_CATEGORIES.find((c) => c.value === v) || VAULT_CATEGORIES[6];

/** قالب پیش‌فرض فیلدها برای هر دسته */
const TEMPLATES = {
  password: [
    { label: 'نام کاربری', secret: false },
    { label: 'رمز عبور', secret: true },
    { label: 'نشانی سایت', secret: false },
  ],
  card: [
    { label: 'نام بانک', secret: false },
    { label: 'شمارهٔ کارت', secret: true },
    { label: 'رمز دوم (اینترنتی)', secret: true },
    { label: 'رمز اول (خودپرداز)', secret: true },
    { label: 'تاریخ انقضا', secret: false },
    { label: 'CVV2', secret: true },
    { label: 'شمارهٔ شبا', secret: true },
  ],
  bank: [
    { label: 'نام بانک', secret: false },
    { label: 'شمارهٔ حساب', secret: true },
    { label: 'شمارهٔ شبا', secret: true },
    { label: 'رمز اینترنت‌بانک', secret: true },
  ],
  document: [
    { label: 'کد ملی', secret: true },
    { label: 'شمارهٔ شناسنامه', secret: true },
    { label: 'تاریخ تولد', secret: false },
  ],
  wifi: [
    { label: 'نام شبکه', secret: false },
    { label: 'رمز', secret: true },
  ],
  note: [],
  other: [{ label: 'مقدار', secret: true }],
};

/* ------------------------------------------------ باز کردن قفل گاوصندوق */

async function unlock() {
  return new Promise((resolve) => {
    const pw = input({ type: 'password', placeholder: 'رمز اصلی', autocomplete: 'current-password' });
    const remember = el('input', { type: 'checkbox', checked: true });
    const go = async () => {
      try {
        const cfg = await api.config();
        const { encKey } = await Crypto.deriveKeys(pw.value, cfg.auth_salt, cfg.enc_salt, cfg.kdf_iterations);
        state.encKey = encKey;
        await Crypto.rememberKey(encKey, remember.checked);
        s.close();
        resolve(true);
      } catch (e) { toast('رمز درست نیست', 'err'); }
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const s = sheet('باز کردن گاوصندوق',
      el('div', { class: 'form' },
        el('p', { class: 'dim', text: 'برای دیدن اطلاعات حساس، رمز اصلی را وارد کنید.' }),
        pw,
        el('label', { class: 'check' }, remember, el('span', { text: 'روی این دستگاه به خاطر بسپار' })),
      ),
      [btn('باز کن', 'primary', go)]);
    setTimeout(() => pw.focus(), 150);
  });
}

/* ---------------------------------------------------------- ویرایشگر */

function fieldsEditor(initial = []) {
  const wrap = el('div', { class: 'kv-editor' });
  const rows = [];

  const addRow = (f = { label: '', value: '', secret: false }) => {
    const label = input({ value: f.label, placeholder: 'نام فیلد', class: 'input kv-label' });
    const value = input({ value: f.value, placeholder: 'مقدار', class: 'input kv-value', type: 'text' });
    const secret = el('button', {
      type: 'button', class: 'icon-btn' + (f.secret ? ' on' : ''), title: 'محرمانه',
      text: f.secret ? '👁' : '👁',
    });
    secret.dataset.on = f.secret ? '1' : '';
    secret.onclick = () => {
      secret.dataset.on = secret.dataset.on ? '' : '1';
      secret.classList.toggle('on');
    };
    const gen = el('button', {
      type: 'button', class: 'icon-btn', title: 'ساخت رمز قوی', text: '⚡',
      onclick: () => { value.value = Crypto.generatePassword(16); toast('رمز تازه ساخته شد'); },
    });
    const del = el('button', {
      type: 'button', class: 'icon-btn danger', title: 'حذف', html: '&#10005;',
      onclick: () => { row.remove(); rows.splice(rows.indexOf(entry), 1); },
    });
    const row = el('div', { class: 'kv-row' }, label, value, el('div', { class: 'kv-tools' }, secret, gen, del));
    const entry = { get label() { return label.value; }, get value() { return value.value; }, get secret() { return !!secret.dataset.on; } };
    rows.push(entry);
    wrap.append(row);
  };

  initial.forEach(addRow);
  const addBtn = btn('+ فیلد تازه', 'ghost small', () => addRow());
  return { node: el('div', {}, wrap, addBtn), rows, addRow };
}

export function vaultEditor(item, onSaved) {
  const isNew = !item?.id;
  const data = item?.data || {};
  const title = input({ value: data.title || '', placeholder: 'مثلاً: کارت ملت — حساب اصلی' });
  const note = textarea({ value: data.note || '', placeholder: 'یادداشت (اختیاری)' });

  let editor = fieldsEditor(data.fields?.length ? data.fields : TEMPLATES[item?.category || 'password'].map((f) => ({ ...f, value: '' })));
  const holder = el('div', {}, editor.node);

  const cat = chips(VAULT_CATEGORIES, item?.category || 'password', (v) => {
    if (editor.rows.every((r) => !r.value)) {
      editor = fieldsEditor(TEMPLATES[v].map((f) => ({ ...f, value: '' })));
      holder.replaceChildren(editor.node);
    }
  });

  const body = el('div', { class: 'form' },
    field('عنوان', title),
    field('دسته', cat),
    field('اطلاعات', holder),
    field('یادداشت', note),
    el('p', { class: 'field-hint', text: '🔒 همهٔ این اطلاعات پیش از ارسال، داخل گوشی شما رمزگذاری می‌شود.' }),
  );

  const save = async () => {
    if (!title.value.trim()) return toast('عنوان را بنویسید', 'err');
    const payload = {
      title: title.value.trim(),
      note: note.value,
      fields: editor.rows
        .filter((r) => r.label || r.value)
        .map((r) => ({ label: r.label || 'بدون نام', value: r.value, secret: r.secret })),
    };
    try {
      const data_enc = await Crypto.encryptJSON(state.encKey, payload);
      if (isNew) await api.create('vault', { category: cat.value, data_enc });
      else await api.update('vault', item.id, { category: cat.value, data_enc });
      s.close();
      toast('ذخیره شد');
      onSaved?.();
    } catch (e) { toast(e.message, 'err'); }
  };

  const actions = [
    !isNew ? btn('حذف', 'danger ghost', async () => {
      if (await confirmBox('این مورد برای همیشه حذف شود؟')) {
        await api.remove('vault', item.id);
        s.close(); toast('حذف شد'); onSaved?.();
      }
    }) : null,
    btn(isNew ? 'افزودن' : 'ذخیره', 'primary', save),
  ].filter(Boolean);

  const s = sheet(isNew ? 'مورد تازه' : 'ویرایش', body, actions);
  setTimeout(() => title.focus(), 150);
}

/* --------------------------------------------------------- نمایش آیتم */

const formatCard = (v) => en(v).replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

function showItem(item, onChange) {
  const body = el('div', { class: 'detail' });
  for (const f of item.data.fields || []) {
    if (!f.value) continue;
    const isCard = /کارت|شبا|حساب/.test(f.label) && en(f.value).replace(/\D/g, '').length >= 10;
    const shown = el('span', { class: 'kv-shown', text: f.secret ? '••••••••' : (isCard ? fa(formatCard(f.value)) : f.value) });
    let visible = !f.secret;
    body.append(el('div', { class: 'kv-view' },
      el('div', { class: 'kv-k', text: f.label }),
      el('div', { class: 'kv-v' }, shown),
      el('div', { class: 'kv-tools' },
        f.secret ? el('button', {
          class: 'icon-btn', title: 'نمایش', text: '👁',
          onclick: () => {
            visible = !visible;
            shown.textContent = visible ? (isCard ? fa(formatCard(f.value)) : f.value) : '••••••••';
          },
        }) : null,
        el('button', { class: 'icon-btn', title: 'کپی', text: '⧉', onclick: () => copyToClipboard(f.value, f.label + ' کپی شد') }),
      ),
    ));
  }
  if (item.data.note) body.append(el('div', { class: 'note-box', text: item.data.note }));
  body.append(el('div', { class: 'dim small', text: 'آخرین تغییر: ' + DT.formatISOShort(String(item.updated_at || '').slice(0, 10)) }));

  sheet(item.data.title, body, [
    btn('ویرایش', 'ghost', () => vaultEditor(item, onChange)),
  ]);
}

/* ------------------------------------------------------------- صفحه */

export async function renderVault({ refresh }) {
  const wrap = el('div', { class: 'page' });

  if (!state.encKey) state.encKey = await Crypto.recallKey();
  if (!state.encKey) {
    wrap.append(el('div', { class: 'locked' },
      el('div', { class: 'lock-icon', text: '🔒' }),
      el('h2', { text: 'گاوصندوق قفل است' }),
      el('p', { class: 'dim', text: 'اطلاعات این بخش رمزگذاری شده‌اند و بدون رمز اصلی قابل خواندن نیستند.' }),
      btn('باز کردن', 'primary big', async () => { if (await unlock()) refresh(); }),
    ));
    return wrap;
  }

  const raw = await api.list('vault');
  const items = [];
  let broken = 0;
  for (const r of raw) {
    try { items.push({ ...r, data: await Crypto.decryptJSON(state.encKey, r.data_enc) }); }
    catch { broken += 1; }
  }
  state.vault = items;

  let query = '';
  let cat = '';
  const list = el('div', { class: 'list' });
  const count = el('span', { class: 'dim small' });

  const draw = () => {
    let out = items;
    if (cat) out = out.filter((i) => i.category === cat);
    if (query) {
      out = out.filter((i) => matches(
        [i.data.title, i.data.note, ...(i.data.fields || []).map((f) => f.label + ' ' + (f.secret ? '' : f.value))].join(' '),
        query,
      ));
    }
    out.sort((a, b) => (b.favorite - a.favorite) || a.data.title.localeCompare(b.data.title, 'fa'));
    count.textContent = fa(out.length) + ' مورد';
    list.replaceChildren();
    if (!out.length) { list.append(emptyState('🔐', 'موردی نیست', 'با + یک رمز یا کارت اضافه کنید')); return; }
    for (const item of out) {
      const quick = (item.data.fields || []).find((f) => f.secret && f.value);
      list.append(el('div', { class: 'row tappable' },
        el('div', { class: 'row-icon', text: catOf(item.category).icon, onclick: () => showItem(item, refresh) }),
        el('div', { class: 'row-main', onclick: () => showItem(item, refresh) },
          el('div', { class: 'row-title' }, item.data.title),
          el('div', { class: 'row-sub', text: (item.data.fields || []).filter((f) => !f.secret && f.value).map((f) => f.value).slice(0, 2).join(' · ') || catOf(item.category).label }),
        ),
        el('div', { class: 'row-actions' },
          el('button', {
            class: 'icon-btn', title: 'کپی', text: '⧉',
            onclick: (e) => { e.stopPropagation(); if (quick) copyToClipboard(quick.value, quick.label + ' کپی شد'); },
          }),
          el('button', {
            class: 'icon-btn' + (item.favorite ? ' on' : ''), title: 'نشان‌کردن', text: '★',
            onclick: async (e) => {
              e.stopPropagation();
              await api.update('vault', item.id, { favorite: item.favorite ? 0 : 1 });
              item.favorite = item.favorite ? 0 : 1;
              draw();
            },
          }),
        ),
      ));
    }
  };

  mount(wrap,
    searchBar('جست‌وجوی سریع…', (v) => { query = v; draw(); }),
    el('div', { class: 'scroll-x' }, chips(
      [{ value: '', label: 'همه' }, ...VAULT_CATEGORIES], cat, (v) => { cat = v; draw(); },
    )),
    sectionTitle('', count),
    broken ? el('div', { class: 'error-box', text: `${fa(broken)} مورد با این رمز باز نشد (شاید با رمز قبلی ساخته شده).` }) : null,
    list,
    el('div', { class: 'lock-bar' },
      btn('قفل کردن گاوصندوق', 'ghost', () => {
        Crypto.forgetKey(); state.encKey = null; refresh(); toast('قفل شد');
      })),
    fab(() => vaultEditor({}, refresh)),
  );
  draw();
  return wrap;
}
