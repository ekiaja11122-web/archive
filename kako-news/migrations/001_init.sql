-- ============================================================
--  کاکو نیوز — اسکیمای اولیهٔ دیتابیس
--  مسیر یک خبر:
--    raw_articles (خام) → فیلتر شیراز → dedup → articles (بازنویسی‌شده)
--    → صف تأیید → publications (سایت / تلگرام)
-- ============================================================

-- تابع مشترک برای به‌روزرسانی خودکار ستون updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ------------------------------------------------------------
-- منابع خبری
-- منبع اصلی حقیقت، فایل config/sources.yaml است؛ این جدول آینهٔ آن است
-- به‌علاوهٔ وضعیت اجرایی (آخرین بررسی، آخرین خطا).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                     SERIAL PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,          -- شناسهٔ یکتا در فایل کانفیگ
  name                   TEXT NOT NULL,                 -- نام نمایشی، مثلاً «خبرگزاری فارس»
  url                    TEXT NOT NULL,                 -- نشانی فید یا صفحهٔ آرشیو
  homepage               TEXT,                          -- نشانی خانهٔ سایت (برای نمایش)
  type                   TEXT NOT NULL CHECK (type IN ('rss', 'scrape')),
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,
  poll_interval_seconds  INTEGER NOT NULL DEFAULT 900,
  config                 JSONB NOT NULL DEFAULT '{}'::jsonb,  -- سلکتورهای CSS و تنظیمات اختصاصی
  last_polled_at         TIMESTAMPTZ,
  last_success_at        TIMESTAMPTZ,
  last_status            TEXT CHECK (last_status IN ('ok', 'error', 'skipped')),
  last_error             TEXT,
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_enabled_idx ON sources (enabled) WHERE enabled;

DROP TRIGGER IF EXISTS sources_touch ON sources;
CREATE TRIGGER sources_touch BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ------------------------------------------------------------
-- خبرهای خام جمع‌آوری‌شده (پیش از هر پردازشی)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_articles (
  id                 BIGSERIAL PRIMARY KEY,
  source_id          INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  source_url         TEXT NOT NULL,                 -- لینک خبر در سایت منبع
  title              TEXT NOT NULL,
  summary            TEXT,
  body               TEXT,                          -- متن کامل، اگر گرفته شده باشد
  published_at       TIMESTAMPTZ,                   -- تاریخ انتشار در منبع
  author             TEXT,
  image_url          TEXT,

  -- هش‌ها برای تشخیص تکراری
  content_hash       TEXT NOT NULL,                 -- SHA-256 از عنوان+متنِ نرمال‌شده
  title_fingerprint  TEXT NOT NULL,                 -- عنوان نرمال‌شده، برای شباهت‌سنجی

  status             TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'irrelevant', 'duplicate', 'processing', 'processed', 'failed')),
  relevance_score    REAL,                          -- امتیاز فیلتر شیراز
  relevance_reason   TEXT,                          -- توضیح تصمیم (کلیدواژه‌ها یا پاسخ مدل)
  duplicate_of_id    BIGINT REFERENCES raw_articles (id) ON DELETE SET NULL,
  error              TEXT,
  raw                JSONB NOT NULL DEFAULT '{}'::jsonb,  -- پاسخ خام منبع، برای دیباگ

  collected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- یک خبر از یک منبع فقط یک بار ثبت می‌شود
  CONSTRAINT raw_articles_source_url_uniq UNIQUE (source_id, source_url)
);

CREATE INDEX IF NOT EXISTS raw_articles_status_idx        ON raw_articles (status, collected_at DESC);
CREATE INDEX IF NOT EXISTS raw_articles_content_hash_idx  ON raw_articles (content_hash);
CREATE INDEX IF NOT EXISTS raw_articles_published_idx     ON raw_articles (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS raw_articles_source_idx        ON raw_articles (source_id, collected_at DESC);

DROP TRIGGER IF EXISTS raw_articles_touch ON raw_articles;
CREATE TRIGGER raw_articles_touch BEFORE UPDATE ON raw_articles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ------------------------------------------------------------
-- خبرهای بازنویسی‌شدهٔ کاکو نیوز (خروجی موتور بازنویسی)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id               BIGSERIAL PRIMARY KEY,
  raw_article_id   BIGINT REFERENCES raw_articles (id) ON DELETE SET NULL,  -- منبع اصلی

  title            TEXT NOT NULL,
  lead             TEXT NOT NULL,
  body             TEXT NOT NULL,
  category         TEXT NOT NULL,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  slug             TEXT NOT NULL UNIQUE,          -- اسلاگ سئوفرندلی فارسی
  image_url        TEXT,                          -- نشانی اصلی تصویر در منبع
  image_path       TEXT,                          -- مسیر فایل دانلودشده روی دیسک
  image_credit     TEXT,                          -- «عکس: نام منبع»

  status           TEXT NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'approved', 'publishing', 'published', 'rejected', 'failed')),
  reject_reason    TEXT,
  editor_notes     TEXT,

  -- ردپای مدل زبانی، برای بازبینی کیفیت و هزینه
  rewrite_model    TEXT,
  rewrite_meta     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- توکن‌ها، مدت زمان، شمارهٔ تلاش
  edited_by_human  BOOLEAN NOT NULL DEFAULT FALSE,

  approved_at      TIMESTAMPTZ,
  approved_by      TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_status_idx    ON articles (status, created_at DESC);
CREATE INDEX IF NOT EXISTS articles_category_idx  ON articles (category, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS articles_touch ON articles;
CREATE TRIGGER articles_touch BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ------------------------------------------------------------
-- پیوند خبر بازنویسی‌شده به منابعش
-- وقتی چند منبع یک رویداد را پوشش می‌دهند، منبع دوم به‌عنوان
-- «منبع تکمیلی» به همان خبر وصل می‌شود.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_sources (
  article_id      BIGINT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  raw_article_id  BIGINT NOT NULL REFERENCES raw_articles (id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'supplementary')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, raw_article_id)
);

CREATE INDEX IF NOT EXISTS article_sources_raw_idx ON article_sources (raw_article_id);


-- ------------------------------------------------------------
-- انتشار در هر مقصد (سایت وردپرسی / کانال تلگرام)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publications (
  id            BIGSERIAL PRIMARY KEY,
  article_id    BIGINT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  target        TEXT NOT NULL CHECK (target IN ('website', 'telegram')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  external_id   TEXT,        -- شناسهٔ پست وردپرس یا message_id تلگرام
  external_url  TEXT,        -- نشانی نهایی خبر منتشرشده
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- هر خبر در هر مقصد فقط یک رکورد انتشار دارد
  CONSTRAINT publications_article_target_uniq UNIQUE (article_id, target)
);

CREATE INDEX IF NOT EXISTS publications_status_idx ON publications (status, requested_at);

DROP TRIGGER IF EXISTS publications_touch ON publications;
CREATE TRIGGER publications_touch BEFORE UPDATE ON publications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ------------------------------------------------------------
-- تاریخچهٔ اجرای کارها (برای دیدن سلامت سیستم و آمار پنل)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_runs (
  id           BIGSERIAL PRIMARY KEY,
  job_name     TEXT NOT NULL,                    -- collect | filter | dedup | rewrite | publish
  source_id    INTEGER REFERENCES sources (id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'success', 'error')),
  items_found  INTEGER NOT NULL DEFAULT 0,
  items_new    INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS job_runs_job_idx ON job_runs (job_name, started_at DESC);


-- ------------------------------------------------------------
-- رویدادهای پایپ‌لاین برای یک خبر مشخص
-- به این وسیله می‌توان در پنل دید یک خبر دقیقاً از کجا رد شده یا کجا افتاده.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_events (
  id              BIGSERIAL PRIMARY KEY,
  stage           TEXT NOT NULL CHECK (stage IN ('collect', 'filter', 'dedup', 'rewrite', 'review', 'publish')),
  level           TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message         TEXT NOT NULL,
  raw_article_id  BIGINT REFERENCES raw_articles (id) ON DELETE CASCADE,
  article_id      BIGINT REFERENCES articles (id) ON DELETE CASCADE,
  source_id       INTEGER REFERENCES sources (id) ON DELETE SET NULL,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_events_raw_idx     ON pipeline_events (raw_article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_events_article_idx ON pipeline_events (article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_events_stage_idx   ON pipeline_events (stage, created_at DESC);


-- ------------------------------------------------------------
-- کاربران پنل تأیید
-- رمزها با scrypt هش می‌شوند؛ هیچ رمزی به‌صورت متن ساده ذخیره نمی‌شود.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS admin_users_touch ON admin_users;
CREATE TRIGGER admin_users_touch BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
