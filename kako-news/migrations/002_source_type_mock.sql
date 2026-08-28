-- افزودن نوع منبع «mock» برای تست پایپ‌لاین بدون زدن به سایت واقعی.
-- منبع mock داده‌اش را از یک فایل JSON محلی می‌خواند.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('rss', 'scrape', 'mock'));
