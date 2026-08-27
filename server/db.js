/**
 * لایهٔ پایگاه‌داده — SQLite داخلی Node (بدون هیچ وابستگی خارجی)
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_DIR = process.env.ARCHIVE_DATA_DIR || join(ROOT, 'data');
export const BACKUP_DIR = process.env.ARCHIVE_BACKUP_DIR || join(ROOT, 'backups');
export const DB_PATH = join(DATA_DIR, 'archive.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
`);

/* ---------------------------------------------------------------- schema */
db.exec(`
-- ================= هارد‌ها و رسانه‌های نگهداری =================
CREATE TABLE IF NOT EXISTS drives (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,          -- شمارهٔ هارد: HD-001
  name          TEXT    NOT NULL,                 -- نام/برچسب هارد
  media_type    TEXT    NOT NULL DEFAULT 'hdd',   -- hdd | ssd | flash | dvd | cd | tape | cloud | other
  brand         TEXT,
  model         TEXT,
  serial        TEXT,
  interface     TEXT,                             -- USB3 / SATA / ...
  capacity_gb   REAL,
  used_gb       REAL,
  location      TEXT,                             -- محل نگهداری فیزیکی (کمد/قفسه/اتاق)
  shelf_code    TEXT,                             -- کد قفسه/جعبه
  owner         TEXT,                             -- در اختیار چه کسی است
  status        TEXT    NOT NULL DEFAULT 'active',-- active | archived | damaged | lost | full | loaned
  health        TEXT    DEFAULT 'unknown',        -- ok | warning | failing | unknown
  is_backup     INTEGER NOT NULL DEFAULT 0,       -- آیا نسخهٔ پشتیبان است
  color         TEXT,                             -- رنگ برچسب برای شناسایی سریع
  purchase_date TEXT,                             -- تاریخ شمسی 1400/01/01
  last_check    TEXT,                             -- آخرین بازبینی سلامت (شمسی)
  next_check    TEXT,                             -- بازبینی بعدی (شمسی)
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- ================= دسته‌بندی درختی =================
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ================= اشخاص (سخنران/قاری/مداح ...) =================
CREATE TABLE IF NOT EXISTS speakers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  full_name  TEXT,
  role       TEXT DEFAULT 'سخنران',
  bio        TEXT,
  birth_date TEXT,
  death_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ================= برچسب‌ها =================
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TEXT NOT NULL
);

-- ================= آیتم‌های آرشیو (رکورد محتوایی) =================
CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE,                        -- کد آرشیو: AR-000123
  title          TEXT NOT NULL,
  alt_title      TEXT,                               -- عنوان دوم/فرعی
  media_kind     TEXT NOT NULL DEFAULT 'audio',      -- audio | video | image | document | other
  speaker_id     INTEGER REFERENCES speakers(id) ON DELETE SET NULL,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  series         TEXT,                               -- نام مجموعه/سلسله جلسات
  part_no        INTEGER,                            -- شمارهٔ جلسه در مجموعه
  part_total     INTEGER,                            -- تعداد کل جلسات
  topic          TEXT,                               -- موضوع
  occasion       TEXT,                               -- مناسبت (ماه رمضان، محرم، ...)
  event_place    TEXT,                               -- محل ایراد سخنرانی
  city           TEXT,
  speech_date    TEXT,                               -- تاریخ ایراد (شمسی)
  speech_date_iso TEXT,                              -- معادل میلادی برای مرتب‌سازی
  date_precision TEXT DEFAULT 'day',                 -- day | month | year | unknown
  hijri_date     TEXT,                               -- تاریخ قمری (اختیاری، متنی)
  duration_sec   INTEGER,                            -- مدت زمان به ثانیه
  language       TEXT DEFAULT 'فارسی',
  quality        TEXT DEFAULT 'unknown',             -- excellent | good | average | poor | unknown
  completeness   TEXT DEFAULT 'complete',            -- complete | partial | fragment | unknown
  defect_flags   TEXT,                               -- JSON: ["noise","cut_start",...]
  defects        TEXT,                               -- شرح نواقص
  needs_work     INTEGER NOT NULL DEFAULT 0,         -- نیازمند بازسازی/ویرایش
  source         TEXT,                               -- منبع تهیه
  contributor    TEXT,                               -- تحویل‌دهنده / اهداکننده
  registered_at  TEXT,                               -- تاریخ ثبت در آرشیو (شمسی)
  registered_by  TEXT,                               -- ثبت‌کننده
  verified       INTEGER NOT NULL DEFAULT 0,         -- بررسی و تأیید شده
  verified_at    TEXT,
  verified_by    TEXT,
  published      INTEGER NOT NULL DEFAULT 0,         -- منتشر شده
  publish_ref    TEXT,                               -- محل انتشار (سایت/کانال)
  priority       INTEGER NOT NULL DEFAULT 0,         -- 0 عادی، 1 مهم، 2 خیلی مهم
  rating         INTEGER NOT NULL DEFAULT 0,         -- 0..5
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  copyright      TEXT,
  keywords       TEXT,                               -- کلیدواژه‌ها (متنی)
  summary        TEXT,                               -- خلاصهٔ محتوا
  description    TEXT,                               -- توضیحات تکمیلی
  archived       INTEGER NOT NULL DEFAULT 0,         -- بایگانی نرم (حذف نشده)
  search_blob    TEXT,                               -- متن نرمال‌شده برای جست‌وجو
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- ================= نسخه‌های فیزیکی هر آیتم روی هاردها =================
CREATE TABLE IF NOT EXISTS copies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  drive_id      INTEGER REFERENCES drives(id) ON DELETE SET NULL,
  folder_path   TEXT,                               -- مسیر پوشه در هارد
  file_name     TEXT,                               -- نام فایل
  file_format   TEXT,                               -- mp3 | mp4 | wav | mkv ...
  size_mb       REAL,
  duration_sec  INTEGER,
  resolution    TEXT,                               -- 1080p / 720p ...
  bitrate       TEXT,
  checksum      TEXT,                               -- MD5/SHA برای تشخیص تکراری
  copy_role     TEXT DEFAULT 'master',              -- master | backup | converted | working
  health        TEXT DEFAULT 'unchecked',           -- ok | corrupt | missing | unchecked
  last_checked  TEXT,                               -- تاریخ شمسی آخرین بررسی
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

-- ================= گزارش رویدادها =================
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,      -- item | drive | category | speaker | tag | system
  entity_id   INTEGER,
  action      TEXT NOT NULL,      -- create | update | delete | import | export | backup
  summary     TEXT,
  actor       TEXT,
  at_jalali   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ================= تنظیمات =================
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_search   ON items(search_blob);
CREATE INDEX IF NOT EXISTS idx_items_cat      ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_speaker  ON items(speaker_id);
CREATE INDEX IF NOT EXISTS idx_items_kind     ON items(media_kind);
CREATE INDEX IF NOT EXISTS idx_items_series   ON items(series);
CREATE INDEX IF NOT EXISTS idx_items_date     ON items(speech_date_iso);
CREATE INDEX IF NOT EXISTS idx_items_created  ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_copies_item    ON copies(item_id);
CREATE INDEX IF NOT EXISTS idx_copies_drive   ON copies(drive_id);
CREATE INDEX IF NOT EXISTS idx_copies_check   ON copies(checksum);
CREATE INDEX IF NOT EXISTS idx_log_at         ON activity_log(created_at);
`);

/* ------------------------------------------------------------- migrations */
/** افزودن ستون در صورت نبود (برای ارتقای نسخه‌های بعدی) */
export function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/* ------------------------------------------------------------- نگهداری WAL */

/**
 * نوشته‌های معلق در فایل WAL را داخل خود پایگاه داده می‌نویسد.
 *
 * چرا لازم است: در حالت WAL، تغییرات تازه در فایل archive.db-wal می‌مانند و
 * هنوز به archive.db منتقل نشده‌اند. اگر کاربر فقط archive.db را روی رایانهٔ
 * دیگری ببرد، آخرین تغییرهایش را از دست می‌دهد. پیش از هر پشتیبان‌گیری و
 * هنگام بستن برنامه این تابع صدا زده می‌شود.
 */
export function checkpoint() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- helpers */
export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value == null ? null : String(value));
}

/**
 * اجرای یک عملیات درون تراکنش.
 * تودرتوپذیر است: اگر تابعی که خودش tx دارد (مانند saveItem) درون یک tx دیگر
 * صدا زده شود، تراکنش تازه‌ای باز نمی‌شود و همه با هم تأیید یا لغو می‌شوند.
 * این برای ثبت گروهی لازم است، چون SQLite تراکنش تودرتو را نمی‌پذیرد.
 */
let txDepth = 0;

export function tx(fn) {
  if (txDepth > 0) {
    txDepth += 1;
    try { return fn(); } finally { txDepth -= 1; }
  }
  db.exec('BEGIN');
  txDepth = 1;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* تراکنش از پیش بسته شده */ }
    throw e;
  } finally {
    txDepth = 0;
  }
}
