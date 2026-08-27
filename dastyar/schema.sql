-- ==================================================================
--  ساختار پایگاه دادهٔ «دستیار»  (Cloudflare D1 / SQLite)
--  تاریخ‌ها همه به صورت میلادی «YYYY-MM-DD» ذخیره می‌شوند
--  ولی معادل «روز تقویمی تهران» هستند و در برنامه شمسی نمایش داده می‌شوند.
--  مبالغ به «تومان» و به صورت عدد صحیح ذخیره می‌شوند.
-- ==================================================================

-- ------------------------------------------------ تنظیمات و ورود
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  agent      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  ip TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_login_at ON login_attempts(at);

-- ------------------------------------------------ کارها و یادآوری‌ها
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  notes         TEXT DEFAULT '',
  category      TEXT DEFAULT '',        -- کاری / شخصی / خرید / تماس ...
  priority      INTEGER DEFAULT 1,      -- ۰ عادی، ۱ مهم، ۲ فوری
  due_date      TEXT,                   -- YYYY-MM-DD (سررسید یا تاریخ شروع تکرار)
  due_time      TEXT,                   -- HH:MM
  repeat_rule   TEXT DEFAULT 'none',    -- none|daily|weekdays|weekly|monthly|yearly|every
  repeat_every  INTEGER DEFAULT 0,      -- برای every: هر چند روز
  repeat_days   TEXT DEFAULT '',        -- برای weekly: شماره روزها؛ شنبه=۰
  remind_before INTEGER DEFAULT 0,      -- چند دقیقه قبل یادآوری شود
  status        TEXT DEFAULT 'open',    -- open|done|archived
  done_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, due_date);

-- انجام‌شدن کارهای تکرارشونده، به تفکیک روز
CREATE TABLE IF NOT EXISTS task_log (
  id      TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  date    TEXT NOT NULL,
  done_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasklog_uniq ON task_log(task_id, date);

-- ------------------------------------------------ گاوصندوق اطلاعات
-- محتوای هر آیتم پیش از ارسال، داخل مرورگر رمزگذاری می‌شود.
-- سرور فقط یک متن نامفهوم می‌بیند.
CREATE TABLE IF NOT EXISTS vault (
  id         TEXT PRIMARY KEY,
  category   TEXT DEFAULT 'password',   -- password|card|bank|document|note|wifi|other
  data_enc   TEXT NOT NULL,             -- محتوای رمزشده (عنوان، نام‌کاربری، رمز، فیلدهای دلخواه)
  favorite   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------ حساب و کتاب
-- بدهکاری‌ها و طلبکاری‌ها
CREATE TABLE IF NOT EXISTS debts (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,             -- payable = من بدهکارم | receivable = من طلبکارم
  person     TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  paid       INTEGER NOT NULL DEFAULT 0,
  due_date   TEXT,
  note       TEXT DEFAULT '',
  status     TEXT DEFAULT 'open',       -- open|settled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- پرداخت‌های جزئی روی یک بدهی/طلب
CREATE TABLE IF NOT EXISTS debt_payments (
  id         TEXT PRIMARY KEY,
  debt_id    TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  date       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

-- اقساط
CREATE TABLE IF NOT EXISTS installments (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  entity      TEXT DEFAULT '',          -- بانک یا طرف حساب
  amount      INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 1,
  paid_count  INTEGER NOT NULL DEFAULT 0,
  next_due    TEXT,                     -- YYYY-MM-DD
  note        TEXT DEFAULT '',
  status      TEXT DEFAULT 'open',      -- open|done
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- واریزها و پرداخت‌های برنامه‌ریزی‌شده
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  direction   TEXT DEFAULT 'out',       -- out = باید بپردازم | in = باید بگیرم
  due_date    TEXT,
  repeat_rule TEXT DEFAULT 'none',      -- none|monthly|yearly
  category    TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  status      TEXT DEFAULT 'open',      -- open|paid
  paid_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- دفتر ثبت پرداخت‌های انجام‌شده (برای گزارش ماهانه)
CREATE TABLE IF NOT EXISTS ledger (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  direction  TEXT NOT NULL,             -- out|in
  amount     INTEGER NOT NULL,
  title      TEXT DEFAULT '',
  category   TEXT DEFAULT '',
  ref        TEXT DEFAULT '',           -- منبع: debt:xx / installment:xx / payment:xx
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date);

-- ------------------------------------------------ یادداشت، مخاطب، تاریخ مهم
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT DEFAULT '',
  body       TEXT DEFAULT '',
  color      TEXT DEFAULT '',
  pinned     INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  phone2     TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  tags       TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  date         TEXT NOT NULL,           -- YYYY-MM-DD
  kind         TEXT DEFAULT 'other',    -- birthday|insurance|check|contract|other
  repeat_rule  TEXT DEFAULT 'yearly',   -- yearly|none
  remind_days  INTEGER DEFAULT 1,       -- چند روز قبل یادآوری شود
  note         TEXT DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ------------------------------------------------ نوتیفیکیشن
CREATE TABLE IF NOT EXISTS push_subs (
  id         TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  label      TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

-- جلوگیری از ارسال تکراری یک یادآوری
CREATE TABLE IF NOT EXISTS notify_log (
  key     TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
