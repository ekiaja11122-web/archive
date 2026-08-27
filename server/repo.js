/**
 * لایهٔ داده و منطق کاری آرشیو
 */
import { db, tx, getSetting, setSetting } from './db.js';
import { buildSearchBlob, buildSearchClause, normalize, similarity } from './text.js';
import { todayJalali, nowJalaliDateTime, jalaliStringToISO, parseJalali } from '../public/lib/jalali.js';

const now = () => new Date().toISOString();

/* ================================================================ کمکی‌ها */

export function log(entity, entity_id, action, summary, actor = null) {
  db.prepare(`INSERT INTO activity_log (entity, entity_id, action, summary, actor, at_jalali, created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(entity, entity_id ?? null, action, summary ?? null, actor, nowJalaliDateTime(), now());
}

/** تولید کد بعدی با پیشوند و طول ثابت، بر پایهٔ بیشترین کد موجود */
function nextCode(table, prefix, width) {
  const rows = db.prepare(`SELECT code FROM ${table} WHERE code LIKE ?`).all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const m = String(r.code).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

export const nextItemCode  = () => nextCode('items',  getSetting('item_prefix', 'AR'), +getSetting('item_code_width', 5));
export const nextDriveCode = () => nextCode('drives', getSetting('drive_prefix', 'HD'), +getSetting('drive_code_width', 3));

const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
const num  = (v) => (v === '' || v == null || Number.isNaN(Number(v))) ? null : Number(v);
const str  = (v) => (v == null || v === '') ? null : String(v).trim();

/* ================================================================ هارد‌ها */

export function listDrives({ q = '', status = '', media_type = '' } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (media_type) { where.push('d.media_type = ?'); params.push(media_type); }
  if (q) {
    const n = normalize(q);
    where.push(`(LOWER(d.code) LIKE ? OR LOWER(d.name) LIKE ? OR LOWER(IFNULL(d.location,'')) LIKE ?
                 OR LOWER(IFNULL(d.serial,'')) LIKE ? OR LOWER(IFNULL(d.owner,'')) LIKE ?)`);
    params.push(...Array(5).fill(`%${n}%`));
  }
  return db.prepare(`
    SELECT d.*,
           (SELECT COUNT(*) FROM copies c WHERE c.drive_id = d.id)                    AS copy_count,
           (SELECT COUNT(DISTINCT c.item_id) FROM copies c WHERE c.drive_id = d.id)   AS item_count,
           (SELECT IFNULL(SUM(c.size_mb),0) FROM copies c WHERE c.drive_id = d.id)    AS used_mb_calc,
           (SELECT COUNT(*) FROM copies c WHERE c.drive_id = d.id AND c.health IN ('corrupt','missing')) AS problem_count
    FROM drives d
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.code
  `).all(...params);
}

export function getDrive(id) {
  const d = db.prepare('SELECT * FROM drives WHERE id = ?').get(id);
  if (!d) return null;
  d.copies = db.prepare(`
    SELECT c.*, i.title AS item_title, i.code AS item_code, i.media_kind
    FROM copies c LEFT JOIN items i ON i.id = c.item_id
    WHERE c.drive_id = ? ORDER BY c.folder_path, c.file_name`).all(id);
  return d;
}

export function saveDrive(input, actor) {
  const isNew = !input.id;
  const t = now();
  const data = {
    code: str(input.code) || nextDriveCode(),
    name: str(input.name) || 'بدون نام',
    media_type: str(input.media_type) || 'hdd',
    brand: str(input.brand), model: str(input.model), serial: str(input.serial),
    interface: str(input.interface),
    capacity_gb: num(input.capacity_gb), used_gb: num(input.used_gb),
    location: str(input.location), shelf_code: str(input.shelf_code), owner: str(input.owner),
    status: str(input.status) || 'active', health: str(input.health) || 'unknown',
    is_backup: bool(input.is_backup), color: str(input.color),
    purchase_date: str(input.purchase_date), last_check: str(input.last_check), next_check: str(input.next_check),
    notes: str(input.notes),
  };
  if (isNew) {
    const info = db.prepare(`INSERT INTO drives
      (code,name,media_type,brand,model,serial,interface,capacity_gb,used_gb,location,shelf_code,owner,
       status,health,is_backup,color,purchase_date,last_check,next_check,notes,created_at,updated_at)
      VALUES (@code,@name,@media_type,@brand,@model,@serial,@interface,@capacity_gb,@used_gb,@location,
              @shelf_code,@owner,@status,@health,@is_backup,@color,@purchase_date,@last_check,@next_check,
              @notes,@created_at,@updated_at)`)
      .run({ ...data, created_at: t, updated_at: t });
    const id = Number(info.lastInsertRowid);
    log('drive', id, 'create', `هارد «${data.name}» با کد ${data.code} ثبت شد`, actor);
    return getDrive(id);
  }
  db.prepare(`UPDATE drives SET code=@code,name=@name,media_type=@media_type,brand=@brand,model=@model,
      serial=@serial,interface=@interface,capacity_gb=@capacity_gb,used_gb=@used_gb,location=@location,
      shelf_code=@shelf_code,owner=@owner,status=@status,health=@health,is_backup=@is_backup,color=@color,
      purchase_date=@purchase_date,last_check=@last_check,next_check=@next_check,notes=@notes,
      updated_at=@updated_at WHERE id=@id`)
    .run({ ...data, id: Number(input.id), updated_at: t });
  log('drive', Number(input.id), 'update', `هارد «${data.name}» ویرایش شد`, actor);
  return getDrive(Number(input.id));
}

export function deleteDrive(id, actor) {
  const d = db.prepare('SELECT * FROM drives WHERE id = ?').get(id);
  if (!d) return false;
  const used = db.prepare('SELECT COUNT(*) c FROM copies WHERE drive_id = ?').get(id).c;
  db.prepare('DELETE FROM drives WHERE id = ?').run(id);
  log('drive', id, 'delete', `هارد «${d.name}» حذف شد (${used} نسخه بدون هارد شد)`, actor);
  return true;
}

/* ============================================================ دسته‌بندی‌ها */

export function listCategories() {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id AND i.archived = 0) AS item_count
    FROM categories c ORDER BY c.sort_order, c.name`).all();
}

/** مسیر کامل دسته: «سخنرانی‌ها › تفسیر قرآن» */
export function categoryPath(id, cache = null) {
  if (!id) return '';
  const all = cache || db.prepare('SELECT id, name, parent_id FROM categories').all();
  const byId = new Map(all.map((c) => [c.id, c]));
  const parts = [];
  let cur = byId.get(Number(id));
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.join(' › ');
}

export function saveCategory(input, actor) {
  const t = now();
  const data = {
    name: str(input.name) || 'بدون نام',
    parent_id: num(input.parent_id),
    description: str(input.description),
    color: str(input.color),
    sort_order: num(input.sort_order) ?? 0,
  };
  if (!input.id) {
    const info = db.prepare(`INSERT INTO categories (name,parent_id,description,color,sort_order,created_at,updated_at)
      VALUES (@name,@parent_id,@description,@color,@sort_order,@created_at,@updated_at)`)
      .run({ ...data, created_at: t, updated_at: t });
    log('category', Number(info.lastInsertRowid), 'create', `دستهٔ «${data.name}» ایجاد شد`, actor);
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  const id = Number(input.id);
  // جلوگیری از حلقه: دسته نمی‌تواند زیرمجموعهٔ فرزند خودش شود
  if (data.parent_id && isDescendant(data.parent_id, id)) data.parent_id = null;
  if (data.parent_id === id) data.parent_id = null;
  db.prepare(`UPDATE categories SET name=@name,parent_id=@parent_id,description=@description,
      color=@color,sort_order=@sort_order,updated_at=@updated_at WHERE id=@id`)
    .run({ ...data, id, updated_at: t });
  log('category', id, 'update', `دستهٔ «${data.name}» ویرایش شد`, actor);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function isDescendant(candidateId, ancestorId) {
  const all = db.prepare('SELECT id, parent_id FROM categories').all();
  const byId = new Map(all.map((c) => [c.id, c]));
  let cur = byId.get(Number(candidateId));
  const seen = new Set();
  while (cur && cur.parent_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parent_id === Number(ancestorId)) return true;
    cur = byId.get(cur.parent_id);
  }
  return false;
}

export function deleteCategory(id, actor) {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!c) return false;
  db.prepare('UPDATE categories SET parent_id = NULL WHERE parent_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  log('category', id, 'delete', `دستهٔ «${c.name}» حذف شد`, actor);
  return true;
}

/* ================================================================ اشخاص */

export function listSpeakers() {
  return db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM items i WHERE i.speaker_id = s.id AND i.archived = 0) AS item_count
    FROM speakers s ORDER BY s.name`).all();
}

export function saveSpeaker(input, actor) {
  const t = now();
  const data = {
    name: str(input.name) || 'بدون نام',
    full_name: str(input.full_name), role: str(input.role) || 'سخنران',
    bio: str(input.bio), birth_date: str(input.birth_date), death_date: str(input.death_date),
  };
  if (!input.id) {
    const exists = db.prepare('SELECT id FROM speakers WHERE name = ?').get(data.name);
    if (exists) return db.prepare('SELECT * FROM speakers WHERE id = ?').get(exists.id);
    const info = db.prepare(`INSERT INTO speakers (name,full_name,role,bio,birth_date,death_date,created_at,updated_at)
      VALUES (@name,@full_name,@role,@bio,@birth_date,@death_date,@created_at,@updated_at)`)
      .run({ ...data, created_at: t, updated_at: t });
    log('speaker', Number(info.lastInsertRowid), 'create', `شخص «${data.name}» افزوده شد`, actor);
    return db.prepare('SELECT * FROM speakers WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  db.prepare(`UPDATE speakers SET name=@name,full_name=@full_name,role=@role,bio=@bio,
      birth_date=@birth_date,death_date=@death_date,updated_at=@updated_at WHERE id=@id`)
    .run({ ...data, id: Number(input.id), updated_at: t });
  log('speaker', Number(input.id), 'update', `شخص «${data.name}» ویرایش شد`, actor);
  return db.prepare('SELECT * FROM speakers WHERE id = ?').get(Number(input.id));
}

export function deleteSpeaker(id, actor) {
  const s = db.prepare('SELECT * FROM speakers WHERE id = ?').get(id);
  if (!s) return false;
  db.prepare('DELETE FROM speakers WHERE id = ?').run(id);
  log('speaker', id, 'delete', `شخص «${s.name}» حذف شد`, actor);
  return true;
}

/* ============================================================== برچسب‌ها */

export function listTags() {
  return db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM item_tags it WHERE it.tag_id = t.id) AS item_count
    FROM tags t ORDER BY item_count DESC, t.name`).all();
}

export function ensureTag(name, color = null) {
  const clean = String(name).trim();
  if (!clean) return null;
  const found = db.prepare('SELECT * FROM tags WHERE name = ?').get(clean);
  if (found) return found;
  const info = db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?,?,?)')
    .run(clean, color, now());
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function deleteTag(id, actor) {
  const t = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!t) return false;
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  log('tag', id, 'delete', `برچسب «${t.name}» حذف شد`, actor);
  return true;
}

/* ========================================================= آیتم‌های آرشیو */

const ITEM_FIELDS = `i.*,
  s.name AS speaker_name,
  c.name AS category_name,
  (SELECT COUNT(*) FROM copies cp WHERE cp.item_id = i.id) AS copy_count,
  (SELECT COUNT(DISTINCT cp.drive_id) FROM copies cp WHERE cp.item_id = i.id AND cp.drive_id IS NOT NULL) AS drive_count,
  (SELECT GROUP_CONCAT(DISTINCT d.code) FROM copies cp JOIN drives d ON d.id = cp.drive_id WHERE cp.item_id = i.id) AS drive_codes,
  (SELECT COUNT(*) FROM copies cp WHERE cp.item_id = i.id AND cp.health IN ('corrupt','missing')) AS bad_copy_count`;

const ITEM_JOINS = `
  FROM items i
  LEFT JOIN speakers   s ON s.id = i.speaker_id
  LEFT JOIN categories c ON c.id = i.category_id`;

/** ساخت متن جست‌وجوی یک آیتم از تمام فیلدهای مرتبط (شامل هارد و نام فایل) */
function computeSearchBlob(itemId) {
  const i = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!i) return '';
  const speaker = i.speaker_id ? db.prepare('SELECT name, full_name FROM speakers WHERE id = ?').get(i.speaker_id) : null;
  const catPath = categoryPath(i.category_id);
  const tags = db.prepare(`SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ?`)
    .all(itemId).map((r) => r.name);
  const copies = db.prepare(`
    SELECT cp.folder_path, cp.file_name, cp.file_format, cp.notes, d.code AS drive_code, d.name AS drive_name, d.location
    FROM copies cp LEFT JOIN drives d ON d.id = cp.drive_id WHERE cp.item_id = ?`).all(itemId);

  let defectFlags = [];
  try { defectFlags = JSON.parse(i.defect_flags || '[]'); } catch { /* نادیده */ }

  return buildSearchBlob([
    i.code, i.title, i.alt_title, i.series, i.topic, i.occasion, i.event_place, i.city,
    i.speech_date, i.hijri_date, i.registered_at, i.registered_by, i.source, i.contributor,
    i.keywords, i.summary, i.description, i.defects, i.publish_ref, i.language,
    i.part_no != null ? `جلسه ${i.part_no}` : null,
    speaker?.name, speaker?.full_name, catPath, tags.join(' '), defectFlags.join(' '),
    ...copies.flatMap((cp) => [cp.folder_path, cp.file_name, cp.file_format, cp.notes, cp.drive_code, cp.drive_name, cp.location]),
  ]);
}

export function refreshSearchBlob(itemId) {
  db.prepare('UPDATE items SET search_blob = ? WHERE id = ?').run(computeSearchBlob(itemId), itemId);
}

export function rebuildAllSearchBlobs() {
  const ids = db.prepare('SELECT id FROM items').all().map((r) => r.id);
  tx(() => { for (const id of ids) refreshSearchBlob(id); });
  return ids.length;
}

export function getItem(id) {
  const item = db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS} WHERE i.id = ?`).get(id);
  if (!item) return null;
  item.category_path = categoryPath(item.category_id);
  item.tags = db.prepare(`SELECT t.* FROM tags t JOIN item_tags it ON it.tag_id = t.id
                          WHERE it.item_id = ? ORDER BY t.name`).all(id);
  item.copies = db.prepare(`
    SELECT cp.*, d.code AS drive_code, d.name AS drive_name, d.location AS drive_location,
           d.status AS drive_status, d.color AS drive_color
    FROM copies cp LEFT JOIN drives d ON d.id = cp.drive_id
    WHERE cp.item_id = ? ORDER BY cp.copy_role DESC, cp.id`).all(id);
  try { item.defect_list = JSON.parse(item.defect_flags || '[]'); } catch { item.defect_list = []; }
  return item;
}

const SORTS = {
  newest:    'i.created_at DESC',
  oldest:    'i.created_at ASC',
  updated:   'i.updated_at DESC',
  title:     'i.title COLLATE NOCASE ASC',
  code:      'i.code ASC',
  date_desc: 'i.speech_date_iso DESC NULLS LAST, i.created_at DESC',
  date_asc:  'i.speech_date_iso ASC NULLS LAST, i.created_at ASC',
  duration:  'i.duration_sec DESC NULLS LAST',
  rating:    'i.rating DESC, i.created_at DESC',
  series:    'i.series COLLATE NOCASE ASC, i.part_no ASC NULLS LAST',
};

/** فهرست آیتم‌ها با جست‌وجو، پالایه‌ها، مرتب‌سازی و صفحه‌بندی */
export function listItems(f = {}) {
  const where = [];
  const params = [];

  where.push('i.archived = ?');
  params.push(bool(f.archived));

  const search = buildSearchClause(f.q, 'i.search_blob');
  if (search.sql) { where.push(search.sql); params.push(...search.params); }

  const eq = (field, val) => { if (val !== undefined && val !== null && val !== '') { where.push(`${field} = ?`); params.push(val); } };
  eq('i.media_kind', f.media_kind);
  eq('i.speaker_id', num(f.speaker_id));
  eq('i.quality', f.quality);
  eq('i.completeness', f.completeness);
  eq('i.language', f.language);
  eq('i.occasion', f.occasion);
  eq('i.series', f.series);
  eq('i.city', f.city);
  eq('i.source', f.source);
  eq('i.registered_by', f.registered_by);

  if (f.category_id) {
    // شامل همهٔ زیرشاخه‌ها
    const ids = categoryWithDescendants(Number(f.category_id));
    where.push(`i.category_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (f.drive_id) {
    where.push('EXISTS (SELECT 1 FROM copies cp WHERE cp.item_id = i.id AND cp.drive_id = ?)');
    params.push(Number(f.drive_id));
  }
  if (f.tag_id) {
    where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)');
    params.push(Number(f.tag_id));
  }
  if (f.tag_ids && Array.isArray(f.tag_ids) && f.tag_ids.length) {
    for (const tid of f.tag_ids) {
      where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)');
      params.push(Number(tid));
    }
  }
  if (f.verified !== undefined && f.verified !== '') { where.push('i.verified = ?'); params.push(bool(f.verified)); }
  if (f.published !== undefined && f.published !== '') { where.push('i.published = ?'); params.push(bool(f.published)); }
  if (f.needs_work !== undefined && f.needs_work !== '') { where.push('i.needs_work = ?'); params.push(bool(f.needs_work)); }
  if (f.is_favorite !== undefined && f.is_favorite !== '') { where.push('i.is_favorite = ?'); params.push(bool(f.is_favorite)); }
  if (f.has_defect === '1') where.push(`(i.needs_work = 1 OR (IFNULL(i.defects,'') <> '') OR (IFNULL(i.defect_flags,'[]') NOT IN ('[]','')))`);
  if (f.no_copies === '1') where.push('NOT EXISTS (SELECT 1 FROM copies cp WHERE cp.item_id = i.id)');
  if (f.single_copy === '1') where.push('(SELECT COUNT(DISTINCT cp.drive_id) FROM copies cp WHERE cp.item_id = i.id) < 2');
  if (f.bad_copies === '1') where.push(`EXISTS (SELECT 1 FROM copies cp WHERE cp.item_id = i.id AND cp.health IN ('corrupt','missing'))`);
  if (f.min_rating) { where.push('i.rating >= ?'); params.push(Number(f.min_rating)); }
  if (f.priority) { where.push('i.priority >= ?'); params.push(Number(f.priority)); }

  // بازهٔ تاریخ ایراد (ورودی شمسی، مقایسه روی معادل میلادی)
  const fromIso = f.date_from ? jalaliStringToISO(f.date_from) : null;
  const toIso   = f.date_to   ? jalaliStringToISO(f.date_to)   : null;
  if (fromIso) { where.push('i.speech_date_iso >= ?'); params.push(fromIso); }
  if (toIso)   { where.push('i.speech_date_iso <= ?'); params.push(toIso); }
  if (f.year)  { where.push('i.speech_date LIKE ?'); params.push(`${f.year}/%`); }

  if (f.min_duration) { where.push('i.duration_sec >= ?'); params.push(Number(f.min_duration)); }
  if (f.max_duration) { where.push('i.duration_sec <= ?'); params.push(Number(f.max_duration)); }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c ${ITEM_JOINS} ${whereSql}`).get(...params).c;

  const orderBy = SORTS[f.sort] || SORTS.newest;
  const perPage = Math.min(Math.max(Number(f.per_page) || 25, 1), 500);
  const page = Math.max(Number(f.page) || 1, 1);
  const offset = (page - 1) * perPage;

  const rows = db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS} ${whereSql}
                           ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, perPage, offset);
  const catCache = db.prepare('SELECT id, name, parent_id FROM categories').all();
  for (const r of rows) {
    r.category_path = categoryPath(r.category_id, catCache);
    r.tags = db.prepare(`SELECT t.id, t.name, t.color FROM tags t JOIN item_tags it ON it.tag_id = t.id
                         WHERE it.item_id = ?`).all(r.id);
  }
  return { rows, total, page, per_page: perPage, pages: Math.max(Math.ceil(total / perPage), 1) };
}

function categoryWithDescendants(rootId) {
  const all = db.prepare('SELECT id, parent_id FROM categories').all();
  const children = new Map();
  for (const c of all) {
    if (!children.has(c.parent_id)) children.set(c.parent_id, []);
    children.get(c.parent_id).push(c.id);
  }
  const out = [];
  const stack = [rootId];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const ch of (children.get(id) || [])) stack.push(ch);
  }
  return out;
}

/** ذخیرهٔ آیتم به همراه برچسب‌ها و نسخه‌ها (در یک تراکنش) */
export function saveItem(input, actor) {
  return tx(() => {
    const t = now();
    const isNew = !input.id;
    const speechDate = str(input.speech_date);
    const parsed = speechDate ? parseJalali(speechDate) : null;

    const data = {
      code: str(input.code) || (isNew ? nextItemCode() : null),
      title: str(input.title) || 'بدون عنوان',
      alt_title: str(input.alt_title),
      media_kind: str(input.media_kind) || 'audio',
      speaker_id: num(input.speaker_id),
      category_id: num(input.category_id),
      series: str(input.series),
      part_no: num(input.part_no),
      part_total: num(input.part_total),
      topic: str(input.topic),
      occasion: str(input.occasion),
      event_place: str(input.event_place),
      city: str(input.city),
      speech_date: parsed ? speechDate : null,
      speech_date_iso: speechDate ? jalaliStringToISO(speechDate) : null,
      date_precision: str(input.date_precision) || (parsed ? parsed.precision : 'unknown'),
      hijri_date: str(input.hijri_date),
      duration_sec: num(input.duration_sec),
      language: str(input.language) || 'فارسی',
      quality: str(input.quality) || 'unknown',
      completeness: str(input.completeness) || 'complete',
      defect_flags: JSON.stringify(Array.isArray(input.defect_flags) ? input.defect_flags : []),
      defects: str(input.defects),
      needs_work: bool(input.needs_work),
      source: str(input.source),
      contributor: str(input.contributor),
      registered_at: str(input.registered_at) || todayJalali(),
      registered_by: str(input.registered_by) || actor || null,
      verified: bool(input.verified),
      verified_at: bool(input.verified) ? (str(input.verified_at) || todayJalali()) : null,
      verified_by: bool(input.verified) ? (str(input.verified_by) || actor || null) : null,
      published: bool(input.published),
      publish_ref: str(input.publish_ref),
      priority: num(input.priority) ?? 0,
      rating: Math.min(Math.max(num(input.rating) ?? 0, 0), 5),
      is_favorite: bool(input.is_favorite),
      copyright: str(input.copyright),
      keywords: str(input.keywords),
      summary: str(input.summary),
      description: str(input.description),
      archived: bool(input.archived),
    };

    let id;
    if (isNew) {
      const cols = Object.keys(data);
      const info = db.prepare(`INSERT INTO items (${cols.join(',')},created_at,updated_at)
        VALUES (${cols.map((c) => '@' + c).join(',')},@created_at,@updated_at)`)
        .run({ ...data, created_at: t, updated_at: t });
      id = Number(info.lastInsertRowid);
    } else {
      id = Number(input.id);
      if (!data.code) delete data.code;
      const cols = Object.keys(data);
      db.prepare(`UPDATE items SET ${cols.map((c) => `${c}=@${c}`).join(',')}, updated_at=@updated_at WHERE id=@id`)
        .run({ ...data, id, updated_at: t });
    }

    // برچسب‌ها: فهرست نام‌ها جایگزین کامل می‌شود
    if (input.tags !== undefined) {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
      const names = Array.isArray(input.tags) ? input.tags
        : String(input.tags).split(/[،,]/).map((x) => x.trim());
      for (const nm of names.filter(Boolean)) {
        const tag = ensureTag(nm);
        if (tag) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?,?)').run(id, tag.id);
      }
    }

    // نسخه‌ها: در صورت ارسال، کل مجموعه جایگزین می‌شود
    if (Array.isArray(input.copies)) {
      const keepIds = input.copies.map((c) => num(c.id)).filter(Boolean);
      const existing = db.prepare('SELECT id FROM copies WHERE item_id = ?').all(id).map((r) => r.id);
      for (const exId of existing) {
        if (!keepIds.includes(exId)) db.prepare('DELETE FROM copies WHERE id = ?').run(exId);
      }
      for (const c of input.copies) saveCopy({ ...c, item_id: id }, actor, true);
    }

    refreshSearchBlob(id);
    log('item', id, isNew ? 'create' : 'update',
      `${isNew ? 'ثبت' : 'ویرایش'} «${data.title}»${data.code ? ' (' + data.code + ')' : ''}`, actor);
    return getItem(id);
  });
}

export function deleteItem(id, actor, { soft = false } = {}) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) return false;
  if (soft) {
    db.prepare('UPDATE items SET archived = 1, updated_at = ? WHERE id = ?').run(now(), id);
    log('item', id, 'update', `«${item.title}» به بایگانی منتقل شد`, actor);
    return true;
  }
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  log('item', id, 'delete', `«${item.title}» برای همیشه حذف شد`, actor);
  return true;
}

export function restoreItem(id, actor) {
  db.prepare('UPDATE items SET archived = 0, updated_at = ? WHERE id = ?').run(now(), id);
  log('item', id, 'update', 'بازگردانی از بایگانی', actor);
  return getItem(id);
}

/* ================================================================ نسخه‌ها */

export function saveCopy(input, actor, inTransaction = false) {
  const t = now();
  const data = {
    item_id: num(input.item_id),
    drive_id: num(input.drive_id),
    folder_path: str(input.folder_path),
    file_name: str(input.file_name),
    file_format: str(input.file_format),
    size_mb: num(input.size_mb),
    duration_sec: num(input.duration_sec),
    resolution: str(input.resolution),
    bitrate: str(input.bitrate),
    checksum: str(input.checksum),
    copy_role: str(input.copy_role) || 'master',
    health: str(input.health) || 'unchecked',
    last_checked: str(input.last_checked),
    notes: str(input.notes),
  };
  let id;
  if (!input.id) {
    const cols = Object.keys(data);
    const info = db.prepare(`INSERT INTO copies (${cols.join(',')},created_at,updated_at)
      VALUES (${cols.map((c) => '@' + c).join(',')},@created_at,@updated_at)`)
      .run({ ...data, created_at: t, updated_at: t });
    id = Number(info.lastInsertRowid);
  } else {
    id = Number(input.id);
    const cols = Object.keys(data);
    db.prepare(`UPDATE copies SET ${cols.map((c) => `${c}=@${c}`).join(',')}, updated_at=@updated_at WHERE id=@id`)
      .run({ ...data, id, updated_at: t });
  }
  if (!inTransaction && data.item_id) refreshSearchBlob(data.item_id);
  return db.prepare('SELECT * FROM copies WHERE id = ?').get(id);
}

export function deleteCopy(id, actor) {
  const c = db.prepare('SELECT * FROM copies WHERE id = ?').get(id);
  if (!c) return false;
  db.prepare('DELETE FROM copies WHERE id = ?').run(id);
  if (c.item_id) refreshSearchBlob(c.item_id);
  log('item', c.item_id, 'update', 'یک نسخه حذف شد', actor);
  return true;
}

/* ================================================================== آمار */

export function stats() {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  // IFNULL لازم است چون SUM روی جدول خالی NULL برمی‌گرداند و در نمایش «—» می‌شود
  const totals = one(`SELECT
      COUNT(*) AS items,
      IFNULL(SUM(CASE WHEN media_kind='audio' THEN 1 ELSE 0 END),0) AS audio,
      IFNULL(SUM(CASE WHEN media_kind='video' THEN 1 ELSE 0 END),0) AS video,
      IFNULL(SUM(CASE WHEN media_kind NOT IN ('audio','video') THEN 1 ELSE 0 END),0) AS other,
      IFNULL(SUM(CASE WHEN verified=1 THEN 1 ELSE 0 END),0) AS verified,
      IFNULL(SUM(CASE WHEN published=1 THEN 1 ELSE 0 END),0) AS published,
      IFNULL(SUM(CASE WHEN needs_work=1 THEN 1 ELSE 0 END),0) AS needs_work,
      IFNULL(SUM(CASE WHEN is_favorite=1 THEN 1 ELSE 0 END),0) AS favorites,
      IFNULL(SUM(duration_sec),0) AS duration_sec
    FROM items WHERE archived = 0`);

  const drives = one(`SELECT COUNT(*) AS count,
      IFNULL(SUM(capacity_gb),0) AS capacity_gb,
      IFNULL(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) AS active,
      IFNULL(SUM(CASE WHEN status IN ('damaged','lost') THEN 1 ELSE 0 END),0) AS problem
    FROM drives`);

  const copies = one(`SELECT COUNT(*) AS count, IFNULL(SUM(size_mb),0) AS size_mb,
      IFNULL(SUM(CASE WHEN health='corrupt' THEN 1 ELSE 0 END),0) AS corrupt,
      IFNULL(SUM(CASE WHEN health='missing' THEN 1 ELSE 0 END),0) AS missing
    FROM copies`);

  return {
    totals,
    drives,
    copies,
    archived: one('SELECT COUNT(*) AS c FROM items WHERE archived = 1').c,
    no_copy: one('SELECT COUNT(*) AS c FROM items i WHERE i.archived = 0 AND NOT EXISTS (SELECT 1 FROM copies cp WHERE cp.item_id = i.id)').c,
    single_copy: one(`SELECT COUNT(*) AS c FROM items i WHERE i.archived = 0
        AND (SELECT COUNT(DISTINCT cp.drive_id) FROM copies cp WHERE cp.item_id = i.id) = 1`).c,
    categories: one('SELECT COUNT(*) AS c FROM categories').c,
    speakers: one('SELECT COUNT(*) AS c FROM speakers').c,
    tags: one('SELECT COUNT(*) AS c FROM tags').c,
    by_kind: all(`SELECT media_kind AS key, COUNT(*) AS count FROM items WHERE archived=0 GROUP BY media_kind ORDER BY count DESC`),
    by_quality: all(`SELECT quality AS key, COUNT(*) AS count FROM items WHERE archived=0 GROUP BY quality ORDER BY count DESC`),
    by_category: all(`SELECT IFNULL(c.name,'بدون دسته') AS key, COUNT(*) AS count
        FROM items i LEFT JOIN categories c ON c.id=i.category_id
        WHERE i.archived=0 GROUP BY i.category_id ORDER BY count DESC LIMIT 12`),
    by_drive: all(`SELECT d.code || ' — ' || d.name AS key, COUNT(DISTINCT cp.item_id) AS count
        FROM drives d LEFT JOIN copies cp ON cp.drive_id = d.id
        GROUP BY d.id ORDER BY count DESC LIMIT 12`),
    by_decade: all(`SELECT SUBSTR(speech_date,1,3) || '0' AS key, COUNT(*) AS count
        FROM items WHERE archived=0 AND speech_date IS NOT NULL
        GROUP BY SUBSTR(speech_date,1,3) ORDER BY key`),
    by_year: all(`SELECT SUBSTR(speech_date,1,4) AS key, COUNT(*) AS count
        FROM items WHERE archived=0 AND speech_date IS NOT NULL
        GROUP BY SUBSTR(speech_date,1,4) ORDER BY key`),
    by_occasion: all(`SELECT occasion AS key, COUNT(*) AS count FROM items
        WHERE archived=0 AND IFNULL(occasion,'') <> '' GROUP BY occasion ORDER BY count DESC LIMIT 12`),
    recent: all(`SELECT id, code, title, media_kind, created_at, registered_at FROM items
        WHERE archived=0 ORDER BY created_at DESC LIMIT 8`),
    recent_activity: all(`SELECT * FROM activity_log ORDER BY id DESC LIMIT 15`),
  };
}

/* =============================================================== گزارش‌ها */

export const reports = {
  /** آیتم‌هایی که هیچ نسخه‌ای روی هیچ هاردی ندارند */
  noCopies: () => db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS}
      WHERE i.archived=0 AND NOT EXISTS (SELECT 1 FROM copies cp WHERE cp.item_id=i.id)
      ORDER BY i.created_at DESC`).all(),

  /** آیتم‌هایی که فقط روی یک هارد هستند — در خطر از دست رفتن */
  singleCopy: () => db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS}
      WHERE i.archived=0 AND (SELECT COUNT(DISTINCT cp.drive_id) FROM copies cp WHERE cp.item_id=i.id)=1
      ORDER BY i.title`).all(),

  /** نسخه‌های خراب یا مفقود */
  badCopies: () => db.prepare(`
      SELECT cp.*, i.title AS item_title, i.code AS item_code, d.code AS drive_code, d.name AS drive_name
      FROM copies cp LEFT JOIN items i ON i.id=cp.item_id LEFT JOIN drives d ON d.id=cp.drive_id
      WHERE cp.health IN ('corrupt','missing') ORDER BY d.code, cp.file_name`).all(),

  /** آیتم‌های دارای نقص */
  defective: () => db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS}
      WHERE i.archived=0 AND (i.needs_work=1 OR IFNULL(i.defects,'')<>'' OR IFNULL(i.defect_flags,'[]') NOT IN ('[]',''))
      ORDER BY i.priority DESC, i.title`).all(),

  /** آیتم‌های تأیید نشده */
  unverified: () => db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS}
      WHERE i.archived=0 AND i.verified=0 ORDER BY i.created_at DESC`).all(),

  /** آیتم‌های بدون تاریخ */
  undated: () => db.prepare(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS}
      WHERE i.archived=0 AND (i.speech_date IS NULL OR i.speech_date='') ORDER BY i.title`).all(),

  /** هاردهایی که باید بازبینی سلامت شوند */
  drivesDueCheck: () => {
    const today = todayJalali();
    return db.prepare(`SELECT * FROM drives WHERE status='active'
        AND (next_check IS NOT NULL AND next_check <= ?) ORDER BY next_check`).all(today);
  },

  /**
   * رکوردهای احتمالاً تکراری.
   * نکتهٔ مهم: «جلسهٔ ۱» و «جلسهٔ ۲» تکراری نیستند هرچند عنوانشان ۹۵٪ شبیه است.
   * بنابراین اگر دو عنوان فقط در بخش عددی تفاوت داشته باشند، تکراری شمرده نمی‌شوند.
   */
  duplicates: () => {
    const out = [];
    const seenPairs = new Set();

    const addGroup = (reason, key, ids) => {
      const unique = [...new Set(ids)];
      if (unique.length < 2) return;
      const pairKey = reason + '|' + unique.slice().sort((a, b) => a - b).join('-');
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      out.push({ reason, key, items: unique.map(getItemBrief).filter(Boolean) });
    };

    // ۱) فایل‌هایی با اثر انگشت (checksum) یکسان — قطعی‌ترین نشانه
    for (const r of db.prepare(`
        SELECT cp.checksum, COUNT(DISTINCT cp.item_id) AS n, GROUP_CONCAT(DISTINCT cp.item_id) AS ids
        FROM copies cp WHERE IFNULL(cp.checksum,'') <> ''
        GROUP BY cp.checksum HAVING n > 1`).all()) {
      addGroup('اثر انگشت فایل (checksum) یکسان', r.checksum, String(r.ids).split(',').map(Number));
    }

    // ۲) یک مجموعه با دو رکورد برای یک شمارهٔ جلسه
    for (const r of db.prepare(`
        SELECT series, part_no, COUNT(*) AS n, GROUP_CONCAT(id) AS ids
        FROM items WHERE archived = 0 AND IFNULL(series,'') <> '' AND part_no IS NOT NULL
        GROUP BY series, part_no HAVING n > 1`).all()) {
      addGroup('شمارهٔ جلسهٔ تکراری در یک مجموعه', `${r.series} — جلسهٔ ${r.part_no}`,
        String(r.ids).split(',').map(Number));
    }

    // ۳) عنوان‌های یکسان (پس از نرمال‌سازی) یا بسیار نزدیک
    const items = db.prepare('SELECT id, title FROM items WHERE archived = 0').all();
    const buckets = new Map();          // کلید: عنوان بدون رقم — برای مقایسهٔ محدود و سریع
    for (const it of items) {
      const norm = normalize(it.title);
      const digits = (norm.match(/\d+/g) || []).join(',');
      const skeleton = norm.replace(/\d+/g, '#');
      const key = skeleton.slice(0, 40);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ ...it, norm, digits });
    }

    for (const [, group] of buckets) {
      if (group.length < 2) continue;
      // فقط رکوردهایی با بخش عددی یکسان می‌توانند تکراری باشند
      const byDigits = new Map();
      for (const g of group) {
        if (!byDigits.has(g.digits)) byDigits.set(g.digits, []);
        byDigits.get(g.digits).push(g);
      }
      for (const [, sameNumber] of byDigits) {
        if (sameNumber.length < 2) continue;
        // مقایسه فقط درون همین دستهٔ کوچک انجام می‌شود
        for (let a = 0; a < sameNumber.length; a++) {
          for (let b = a + 1; b < sameNumber.length; b++) {
            const x = sameNumber[a], y = sameNumber[b];
            if (x.norm === y.norm) {
              addGroup('عنوان کاملاً یکسان', x.title, [x.id, y.id]);
            } else {
              const sim = similarity(x.norm, y.norm);
              if (sim >= 0.9) addGroup(`عنوان بسیار شبیه (${Math.round(sim * 100)}٪)`, x.title, [x.id, y.id]);
            }
          }
        }
      }
    }

    return out;
  },
};

function getItemBrief(id) {
  return db.prepare(`SELECT i.id, i.code, i.title, i.speech_date, i.media_kind,
      (SELECT GROUP_CONCAT(DISTINCT d.code) FROM copies cp JOIN drives d ON d.id=cp.drive_id WHERE cp.item_id=i.id) AS drive_codes
      FROM items i WHERE i.id = ?`).get(id);
}

/* ========================================================= خروجی و ورودی */

export function exportAll() {
  return {
    meta: {
      app: 'آرشیو',
      version: 1,
      exported_at: nowJalaliDateTime(),
      exported_at_iso: now(),
      counts: {
        items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
        drives: db.prepare('SELECT COUNT(*) c FROM drives').get().c,
        copies: db.prepare('SELECT COUNT(*) c FROM copies').get().c,
      },
    },
    drives: db.prepare('SELECT * FROM drives ORDER BY id').all(),
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    speakers: db.prepare('SELECT * FROM speakers ORDER BY id').all(),
    tags: db.prepare('SELECT * FROM tags ORDER BY id').all(),
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    copies: db.prepare('SELECT * FROM copies ORDER BY id').all(),
    item_tags: db.prepare('SELECT * FROM item_tags').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
  };
}

/** بازیابی کامل از فایل پشتیبان (جایگزینی کل داده‌ها) */
export function importAll(payload, actor) {
  if (!payload || typeof payload !== 'object') throw new Error('فایل پشتیبان معتبر نیست');
  return tx(() => {
    db.exec(`DELETE FROM item_tags; DELETE FROM copies; DELETE FROM items;
             DELETE FROM tags; DELETE FROM speakers; DELETE FROM categories; DELETE FROM drives;`);
    const insertAll = (table, rows) => {
      if (!Array.isArray(rows) || !rows.length) return 0;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')})
                               VALUES (${cols.map((c) => '@' + c).join(',')})`);
      let n = 0;
      for (const r of rows) {
        const clean = {};
        for (const c of cols) clean[c] = r[c] === undefined ? null : r[c];
        stmt.run(clean); n++;
      }
      return n;
    };
    insertAll('drives', payload.drives);
    insertAll('categories', payload.categories);
    insertAll('speakers', payload.speakers);
    insertAll('tags', payload.tags);
    insertAll('items', payload.items);
    insertAll('copies', payload.copies);
    insertAll('item_tags', payload.item_tags);
    if (Array.isArray(payload.settings)) insertAll('settings', payload.settings);
    const ids = db.prepare('SELECT id FROM items').all().map((r) => r.id);
    for (const id of ids) refreshSearchBlob(id);
    log('system', null, 'import', `بازیابی از پشتیبان: ${ids.length} رکورد`, actor);
    return { items: ids.length };
  });
}

const CSV_COLUMNS = [
  ['code', 'کد آرشیو'], ['title', 'عنوان'], ['media_kind', 'نوع'], ['speaker_name', 'سخنران'],
  ['category_path', 'دسته‌بندی'], ['series', 'مجموعه'], ['part_no', 'شمارهٔ جلسه'],
  ['topic', 'موضوع'], ['occasion', 'مناسبت'], ['event_place', 'محل ایراد'], ['city', 'شهر'],
  ['speech_date', 'تاریخ ایراد'], ['hijri_date', 'تاریخ قمری'], ['duration_hms', 'مدت'],
  ['quality', 'کیفیت'], ['completeness', 'کامل بودن'], ['defects', 'نواقص'],
  ['drive_codes', 'هاردها'], ['paths', 'مسیرها'], ['source', 'منبع'], ['contributor', 'تحویل‌دهنده'],
  ['registered_at', 'تاریخ ثبت'], ['registered_by', 'ثبت‌کننده'], ['verified', 'تأیید شده'],
  ['published', 'منتشر شده'], ['rating', 'امتیاز'], ['tag_names', 'برچسب‌ها'],
  ['keywords', 'کلیدواژه'], ['summary', 'خلاصه'], ['description', 'توضیحات'],
];

const hms = (s) => {
  if (!s && s !== 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, '0')).join(':');
};

export function exportItemsCsv(filters = {}) {
  const { rows } = listItems({ ...filters, page: 1, per_page: 100000 });
  const catCache = db.prepare('SELECT id, name, parent_id FROM categories').all();
  const lines = [CSV_COLUMNS.map((c) => c[1]).join(',')];
  for (const r of rows) {
    const copies = db.prepare(`SELECT cp.folder_path, cp.file_name, d.code FROM copies cp
        LEFT JOIN drives d ON d.id=cp.drive_id WHERE cp.item_id=?`).all(r.id);
    const enriched = {
      ...r,
      category_path: categoryPath(r.category_id, catCache),
      duration_hms: hms(r.duration_sec),
      paths: copies.map((c) => `[${c.code || '?'}] ${[c.folder_path, c.file_name].filter(Boolean).join('/')}`).join(' | '),
      tag_names: (r.tags || []).map((t) => t.name).join('، '),
      verified: r.verified ? 'بله' : 'خیر',
      published: r.published ? 'بله' : 'خیر',
    };
    lines.push(CSV_COLUMNS.map(([k]) => csvCell(enriched[k])).join(','));
  }
  // BOM برای نمایش درست فارسی در Excel
  return '﻿' + lines.join('\r\n');
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ============================================== داده‌های اولیهٔ پیشنهادی */

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) c FROM categories').get().c
    + db.prepare('SELECT COUNT(*) c FROM speakers').get().c;
  if (count > 0) return false;
  const t = now();

  const speaker = db.prepare(`INSERT INTO speakers (name, full_name, role, bio, created_at, updated_at)
      VALUES (?,?,?,?,?,?)`)
    .run('آیت‌الله دستغیب', 'آیت‌الله سید عبدالحسین دستغیب شیرازی', 'سخنران',
         'عالم و مفسر قرآن، امام جمعهٔ شیراز', t, t);
  setSetting('default_speaker_id', String(Number(speaker.lastInsertRowid)));

  const addCat = (name, parent = null, order = 0, desc = null) => Number(
    db.prepare('INSERT INTO categories (name,parent_id,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(name, parent, desc, order, t, t).lastInsertRowid);

  const speeches = addCat('سخنرانی‌ها', null, 1);
  addCat('تفسیر قرآن', speeches, 1);
  addCat('اخلاق و معارف', speeches, 2);
  addCat('مناسبت‌های مذهبی', speeches, 3);
  addCat('نهج‌البلاغه', speeches, 4);
  const majales = addCat('مجالس و مراسم', null, 2);
  addCat('محرم و صفر', majales, 1);
  addCat('ماه رمضان', majales, 2);
  addCat('اعیاد', majales, 3);
  addCat('درس‌های حوزوی', null, 3);
  addCat('مصاحبه و گفت‌وگو', null, 4);
  addCat('اسناد و تصاویر', null, 5);
  addCat('متفرقه', null, 9);

  for (const [name, color] of [['مهم', '#dc2626'], ['نیازمند بازسازی', '#f59e0b'],
    ['نسخهٔ اصلی', '#059669'], ['کیفیت پایین', '#6b7280'], ['منتشر شده', '#2563eb']]) {
    db.prepare('INSERT OR IGNORE INTO tags (name,color,created_at) VALUES (?,?,?)').run(name, color, t);
  }

  setSetting('archive_title', 'آرشیو صوتی و تصویری آیت‌الله دستغیب');
  setSetting('item_prefix', 'AR');
  setSetting('drive_prefix', 'HD');
  setSetting('item_code_width', '5');
  setSetting('drive_code_width', '3');
  log('system', null, 'create', 'راه‌اندازی اولیهٔ آرشیو');
  return true;
}
