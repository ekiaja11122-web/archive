-- ============================================================
--  تلاش مجدد خودکار برای انتشارهای ناموفق
--
--  باگی که این مهاجرت رفع می‌کند: هر خطای انتشار — حتی یک قطعی
--  چنددقیقه‌ای سایت — وضعیت را «failed» می‌کرد و چون صف انتشار فقط
--  ردیف‌های «pending» را برمی‌دارد، آن خبر دیگر هرگز فرستاده نمی‌شد.
--  حالا خطای گذرا ردیف را در «pending» نگه می‌دارد و زمان تلاش بعدی
--  را ثبت می‌کند؛ فقط پس از چند تلاش ناموفق یا خطای دائمی، «failed»
--  می‌شود تا سردبیر در پنل ببیند.
-- ============================================================

ALTER TABLE publications ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- صف انتشار: ردیف‌هایی که وقت تلاششان رسیده
CREATE INDEX IF NOT EXISTS publications_due_idx
  ON publications (next_attempt_at NULLS FIRST, requested_at)
  WHERE status = 'pending';

-- ردیف‌های ناموفقِ قدیمی که پیش از این وصله در بن‌بست مانده‌اند،
-- یک فرصت دوباره می‌گیرند.
UPDATE publications
SET status = 'pending', next_attempt_at = now()
WHERE status = 'failed' AND attempts < 5;
