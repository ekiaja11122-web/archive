-- ============================================================
--  مایل‌استون ۳ — فیلتر مرتبط‌بودن با شیراز و تشخیص تکراری
-- ============================================================

-- وضعیت تازه: «ready» یعنی خبر هم از فیلتر شیراز رد شده و هم تکراری نبوده،
-- و حالا منتظر بازنویسی است. چرخهٔ کامل وضعیت خبر خام:
--   new → (فیلتر) → irrelevant | new
--       → (تشخیص تکراری) → duplicate | ready
--       → (بازنویسی) → processing → processed | failed
ALTER TABLE raw_articles DROP CONSTRAINT IF EXISTS raw_articles_status_check;
ALTER TABLE raw_articles ADD CONSTRAINT raw_articles_status_check
  CHECK (status IN ('new', 'irrelevant', 'duplicate', 'ready', 'processing', 'processed', 'failed'));

-- امتیاز شباهت با خبری که تکراری‌اش تشخیص داده شده (۰ تا ۱)،
-- تا در پنل بشود دید تصمیم بر چه اساسی گرفته شده است.
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS duplicate_similarity REAL;

-- جزئیات ساختاریافتهٔ تصمیم فیلتر: کدام کلیدواژه‌ها پیدا شدند، با چه وزنی،
-- و آیا مدل زبانی دخالت کرده است. برای بازبینی و بهبود واژه‌نامه.
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS relevance_details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- روش تصمیم‌گیری: keyword (فقط کلیدواژه) یا llm (با کمک مدل زبانی)
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS relevance_method TEXT
  CHECK (relevance_method IN ('keyword', 'llm', 'llm_failed'));

-- ایندکس برای پیدا کردن نامزدهای تکراری در بازهٔ زمانی اخیر
CREATE INDEX IF NOT EXISTS raw_articles_dedup_window_idx
  ON raw_articles (collected_at DESC)
  WHERE status IN ('new', 'ready', 'processed');
