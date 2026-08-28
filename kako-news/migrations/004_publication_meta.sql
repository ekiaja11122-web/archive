-- جزئیات اختصاصی هر مقصد انتشار.
-- مثلاً برای وردپرس: شناسهٔ رسانهٔ آپلودشده، شناسهٔ دسته و تگ‌ها؛
-- برای تلگرام: شناسهٔ پیام و اینکه به‌صورت عکس رفته یا متن.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
