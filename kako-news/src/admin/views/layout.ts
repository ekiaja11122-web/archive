/**
 * پوستهٔ مشترک صفحه‌های پنل.
 *
 * راست‌چین، فارسی، و **کاملاً خودبسنده**: هیچ فونت یا استایلی از اینترنت
 * بارگذاری نمی‌شود. پنل ممکن است روی سروری اجرا شود که دسترسی بیرونی
 * محدودی دارد، و هر وابستگی بیرونی یعنی یک صفحهٔ خراب در بدترین لحظه.
 */
import { html, raw, type SafeHtml } from '../html.ts';

const STYLES = `
:root {
  --bg: #f4f5f7;
  --panel: #ffffff;
  --ink: #1c2530;
  --muted: #6b7684;
  --line: #dfe3e8;
  --brand: #0f6e5c;
  --brand-soft: #e6f2ef;
  --danger: #b02a37;
  --danger-soft: #fbeaec;
  --warn: #9a6700;
  --warn-soft: #fff6df;
  --radius: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Vazirmatn, "IRANSans", "Segoe UI", Tahoma, "DejaVu Sans", sans-serif;
  font-size: 15px;
  line-height: 1.85;
}
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }

header.top {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  padding: 0 24px;
  display: flex; align-items: center; gap: 24px;
  position: sticky; top: 0; z-index: 10;
}
header.top .brand { font-weight: 700; font-size: 17px; color: var(--brand); padding: 14px 0; }
header.top nav { display: flex; gap: 4px; flex: 1; }
header.top nav a {
  padding: 16px 14px; color: var(--muted); border-bottom: 2px solid transparent;
}
header.top nav a.active { color: var(--ink); border-bottom-color: var(--brand); font-weight: 600; }
header.top .who { color: var(--muted); font-size: 13px; }
header.top .linkbtn {
  background: none; border: 0; padding: 0 0 0 4px; margin-right: 8px;
  color: var(--brand); font: inherit; font-size: 13px; cursor: pointer;
}
header.top .linkbtn:hover { text-decoration: underline; }

main { max-width: 1180px; margin: 0 auto; padding: 24px; }
h1 { font-size: 20px; margin: 0 0 18px; }
h2 { font-size: 16px; margin: 0 0 12px; }

.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 18px; margin-bottom: 16px;
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.stat .n { font-size: 26px; font-weight: 700; line-height: 1.3; }
.stat .l { color: var(--muted); font-size: 13px; }
.stat.accent .n { color: var(--brand); }

.queue-item { border-bottom: 1px solid var(--line); padding: 14px 0; }
.queue-item:last-child { border-bottom: 0; }
.queue-item .t { font-size: 16px; font-weight: 600; }
.queue-item .m { color: var(--muted); font-size: 13px; margin-top: 4px; }

.badge {
  display: inline-block; padding: 2px 9px; border-radius: 20px;
  font-size: 12px; background: var(--brand-soft); color: var(--brand);
}
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.badge.danger { background: var(--danger-soft); color: var(--danger); }
.badge.plain { background: #eef0f3; color: var(--muted); }

.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .compare { grid-template-columns: 1fr; } }
.compare .col h2 { display: flex; align-items: center; gap: 8px; }
.source-text {
  max-height: 560px; overflow-y: auto; background: #fafbfc;
  border: 1px solid var(--line); border-radius: 8px; padding: 14px;
  font-size: 14px; color: #37424f;
}
.source-text p { margin: 0 0 10px; }

label { display: block; font-size: 13px; color: var(--muted); margin: 14px 0 5px; }
input[type=text], textarea, select {
  width: 100%; padding: 9px 11px; border: 1px solid var(--line);
  border-radius: 8px; font: inherit; background: #fff; color: var(--ink);
}
textarea { resize: vertical; line-height: 1.9; }
input:focus, textarea:focus, select:focus { outline: 2px solid var(--brand-soft); border-color: var(--brand); }

.btn {
  display: inline-block; padding: 9px 18px; border-radius: 8px; border: 1px solid var(--line);
  background: #fff; color: var(--ink); font: inherit; cursor: pointer;
}
.btn:hover { background: #f7f8f9; }
.btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn.primary:hover { background: #0c5b4c; }
.btn.danger { background: #fff; border-color: var(--danger); color: var(--danger); }
.btn.danger:hover { background: var(--danger-soft); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 16px; }

.targets { display: flex; gap: 16px; flex-wrap: wrap; margin: 10px 0 4px; }
.targets label { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--ink); font-size: 14px; cursor: pointer; }
.targets input { width: auto; }

.notice { padding: 11px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
.notice.ok { background: var(--brand-soft); color: var(--brand); }
.notice.err { background: var(--danger-soft); color: var(--danger); }
.notice.warn { background: var(--warn-soft); color: var(--warn); }

table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: right; padding: 9px 10px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
td.num { font-variant-numeric: tabular-nums; }

.empty { text-align: center; color: var(--muted); padding: 48px 20px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.mono { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 12px; direction: ltr; display: inline-block; }

.login-wrap { max-width: 380px; margin: 12vh auto; }
.login-wrap .card { padding: 26px; }
.login-wrap h1 { text-align: center; color: var(--brand); }
`;

export type NavKey = 'queue' | 'published' | 'rejected' | 'sources' | 'none';

export type LayoutOptions = {
  title: string;
  nav?: NavKey;
  user?: { display_name: string | null; username: string } | undefined;
  brandName: string;
  bare?: boolean;
};

const NAV_ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: 'queue', href: '/', label: 'صف تأیید' },
  { key: 'published', href: '/published', label: 'منتشرشده' },
  { key: 'rejected', href: '/rejected', label: 'ردشده' },
  { key: 'sources', href: '/sources', label: 'سلامت منابع' },
];

export function layout(options: LayoutOptions, body: SafeHtml): string {
  const { title, nav = 'none', user, brandName, bare = false } = options;

  const header = bare
    ? raw('')
    : html`
        <header class="top">
          <div class="brand">${brandName}</div>
          <nav>
            ${NAV_ITEMS.map(
              (item) => html`<a href="${item.href}"
                class="${item.key === nav ? 'active' : ''}">${item.label}</a>`,
            )}
          </nav>
          ${user
            ? html`<span class="who">${user.display_name || user.username}</span>
              <form method="post" action="/logout" style="margin:0">
                <button type="submit" class="linkbtn">خروج</button>
              </form>`
            : ''}
        </header>
      `;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeTitle(title)} — ${escapeTitle(brandName)}</title>
<style>${STYLES}</style>
</head>
<body>
${header}
<main>${body}</main>
</body>
</html>`;
}

function escapeTitle(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
