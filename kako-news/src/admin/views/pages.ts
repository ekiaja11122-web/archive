/**
 * صفحه‌های پنل مدیریت.
 *
 * همهٔ محتوای بیرونی از تابع قالب `html` رد می‌شود و خودکار escape می‌گردد.
 */
import { html, raw, paragraphs, safeUrl, type SafeHtml } from '../html.ts';
import { formatTehran } from '../../lib/date.ts';
import { truncate } from '../../lib/text.ts';
import type { ArticleRow, SourceComparison } from '../../db/repositories/articles.ts';
import type { PublicationRow } from '../../db/repositories/publications.ts';
import type { SourceRow } from '../../db/repositories/sources.ts';

const TARGET_LABELS: Record<string, string> = {
  website: 'وب‌سایت',
  telegram: 'کانال تلگرام',
};

const PUBLICATION_LABELS: Record<string, string> = {
  pending: 'در صف ارسال',
  sent: 'ارسال شد',
  failed: 'ناموفق',
  skipped: 'صرف‌نظر شد',
};

const PUBLICATION_BADGE: Record<string, string> = {
  pending: 'warn',
  sent: '',
  failed: 'danger',
  skipped: 'plain',
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: 'در انتظار تأیید',
  approved: 'تأیید شده',
  publishing: 'در حال ارسال',
  published: 'منتشر شده',
  rejected: 'رد شده',
  failed: 'ناموفق',
};

function notice(message: string | undefined, kind: 'ok' | 'err' | 'warn' = 'ok'): SafeHtml {
  return message ? html`<div class="notice ${kind}">${message}</div>` : raw('');
}

// ---------------------------------------------------------------
// ورود
// ---------------------------------------------------------------

export function loginPage(options: { error?: string; brandName: string }): SafeHtml {
  return html`
    <div class="login-wrap">
      <h1>${options.brandName}</h1>
      <div class="card">
        ${notice(options.error, 'err')}
        <form method="post" action="/login">
          <label for="username">نام کاربری</label>
          <input type="text" id="username" name="username" autocomplete="username" autofocus required>
          <label for="password">رمز عبور</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required
                 style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font:inherit">
          <div class="actions">
            <button type="submit" class="btn primary" style="width:100%">ورود به پنل</button>
          </div>
        </form>
      </div>
      <p class="muted small" style="text-align:center">
        پنل مدیریت — دسترسی فقط برای سردبیران
      </p>
    </div>
  `;
}

// ---------------------------------------------------------------
// داشبورد و صف تأیید
// ---------------------------------------------------------------

export type DashboardStats = {
  collectedToday: number;
  pendingReview: number;
  approvedToday: number;
  rejectedToday: number;
  publishedToday: number;
  irrelevantToday: number;
  duplicatesToday: number;
  failedSources: number;
};

export type QueueEntry = {
  article: ArticleRow;
  sourceNames: string[];
  supplementaryCount: number;
};

export function dashboardPage(options: {
  stats: DashboardStats;
  queue: QueueEntry[];
  message?: string;
  messageKind?: 'ok' | 'err' | 'warn';
}): SafeHtml {
  const { stats, queue } = options;

  return html`
    ${notice(options.message, options.messageKind ?? 'ok')}

    <h1>صف تأیید</h1>

    <div class="stats">
      <div class="stat accent">
        <div class="n">${stats.pendingReview}</div>
        <div class="l">در انتظار تأیید</div>
      </div>
      <div class="stat">
        <div class="n">${stats.collectedToday}</div>
        <div class="l">جمع‌آوری امروز</div>
      </div>
      <div class="stat">
        <div class="n">${stats.approvedToday}</div>
        <div class="l">تأییدشده امروز</div>
      </div>
      <div class="stat">
        <div class="n">${stats.rejectedToday}</div>
        <div class="l">ردشده امروز</div>
      </div>
      <div class="stat">
        <div class="n">${stats.publishedToday}</div>
        <div class="l">منتشرشده امروز</div>
      </div>
      <div class="stat">
        <div class="n">${stats.irrelevantToday}</div>
        <div class="l">نامرتبط با شیراز</div>
      </div>
      <div class="stat">
        <div class="n">${stats.duplicatesToday}</div>
        <div class="l">تکراری</div>
      </div>
      <div class="stat">
        <div class="n">${stats.failedSources}</div>
        <div class="l">منبع دارای خطا</div>
      </div>
    </div>

    <div class="card">
      ${queue.length === 0
        ? html`<div class="empty">
            صف تأیید خالی است.<br>
            <span class="small">خبر تازه پس از جمع‌آوری و بازنویسی اینجا ظاهر می‌شود.</span>
          </div>`
        : queue.map(
            (entry) => html`
              <div class="queue-item">
                <div class="t">
                  <a href="/articles/${entry.article.id}">${entry.article.title}</a>
                </div>
                <div class="m">
                  <span class="badge">${entry.article.category}</span>
                  &nbsp;
                  ${entry.sourceNames.join('، ')}
                  ${entry.supplementaryCount > 0
                    ? html`<span class="badge plain">+${entry.supplementaryCount} منبع تکمیلی</span>`
                    : ''}
                  &nbsp;·&nbsp; ${formatTehran(entry.article.created_at)}
                  ${entry.article.edited_by_human ? html`<span class="badge warn">ویرایش‌شده</span>` : ''}
                </div>
                <div class="m">${truncate(entry.article.lead, 160)}</div>
              </div>
            `,
          )}
    </div>
  `;
}

// ---------------------------------------------------------------
// صفحهٔ بازبینی: منبع کنار بازنویسی
// ---------------------------------------------------------------

export function reviewPage(options: {
  article: ArticleRow;
  sources: SourceComparison[];
  publications: PublicationRow[];
  categories: string[];
  defaultTargets: string[];
  sourceLine: string;
  csrf: string;
  message?: string;
  messageKind?: 'ok' | 'err' | 'warn';
}): SafeHtml {
  const { article, sources, publications, categories, defaultTargets, csrf } = options;
  const primary = sources.find((s) => s.role === 'primary') ?? sources[0];
  const supplementary = sources.filter((s) => s.role === 'supplementary');
  const editable = article.status !== 'published';

  return html`
    ${notice(options.message, options.messageKind ?? 'ok')}

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <a href="/" class="small">← بازگشت به صف</a>
      <span class="badge ${article.status === 'published' ? '' : article.status === 'rejected' ? 'danger' : 'warn'}">
        ${STATUS_LABELS[article.status] ?? article.status}
      </span>
      ${article.edited_by_human ? html`<span class="badge plain">ویرایش سردبیر</span>` : ''}
    </div>

    ${publications.length > 0
      ? html`<div class="card">
          <h2>وضعیت انتشار</h2>
          <table>
            <tr><th>مقصد</th><th>وضعیت</th><th>نشانی</th><th>زمان</th></tr>
            ${publications.map(
              (pub) => html`<tr>
                <td>${TARGET_LABELS[pub.target] ?? pub.target}</td>
                <td>
                  <span class="badge ${PUBLICATION_BADGE[pub.status] ?? 'warn'}">
                    ${PUBLICATION_LABELS[pub.status] ?? pub.status}
                  </span>
                  ${pub.status === 'pending' && pub.attempts > 0
                    ? html`<div class="small muted">
                        تلاش ${pub.attempts} ناموفق بود — تلاش بعدی
                        ${formatTehran(pub.next_attempt_at)}
                      </div>`
                    : ''}
                  ${pub.status === 'failed' && pub.attempts > 0
                    ? html`<div class="small muted">پس از ${pub.attempts} تلاش کنار گذاشته شد</div>`
                    : ''}
                  ${pub.error ? html`<div class="small muted">${truncate(pub.error, 120)}</div>` : ''}
                </td>
                <td>${pub.external_url
                  ? html`<a href="${safeUrl(pub.external_url)}" target="_blank" rel="noopener">مشاهده</a>`
                  : html`<span class="muted">—</span>`}</td>
                <td class="small muted">${formatTehran(pub.published_at)}</td>
              </tr>`,
            )}
          </table>
          ${publications.some((p) => p.status === 'failed')
            ? html`<form method="post" action="/articles/${article.id}/retry" style="margin-top:12px">
                <input type="hidden" name="_csrf" value="${csrf}">
                <button type="submit" class="btn">تلاش مجدد برای انتشارهای ناموفق</button>
              </form>`
            : ''}
        </div>`
      : ''}

    <div class="compare">
      <!-- ستون منبع -->
      <div class="col">
        <div class="card">
          <h2>
            متن منبع
            ${primary ? html`<span class="badge plain">${primary.source_name}</span>` : ''}
          </h2>
          ${primary
            ? html`
                <div class="small muted" style="margin-bottom:10px">
                  <a href="${safeUrl(primary.source_url)}" target="_blank" rel="noopener noreferrer">
                    مشاهدهٔ خبر در سایت منبع ↗
                  </a>
                  &nbsp;·&nbsp; ${formatTehran(primary.published_at)}
                </div>
                <div style="font-weight:600;margin-bottom:10px">${primary.raw_title}</div>
                <div class="source-text">
                  ${paragraphs(primary.raw_body ?? primary.raw_summary ?? 'متنی ثبت نشده است.')}
                </div>
              `
            : html`<div class="muted">منبعی برای این خبر ثبت نشده است.</div>`}

          ${supplementary.length > 0
            ? html`
                <h2 style="margin-top:18px">منابع تکمیلی</h2>
                ${supplementary.map(
                  (extra) => html`
                    <div style="margin-bottom:12px">
                      <div class="small">
                        <span class="badge plain">${extra.source_name}</span>
                        <a href="${safeUrl(extra.source_url)}" target="_blank" rel="noopener noreferrer">↗</a>
                      </div>
                      <div style="font-weight:600;font-size:14px;margin:5px 0">${extra.raw_title}</div>
                      <div class="source-text" style="max-height:220px">
                        ${paragraphs(extra.raw_body ?? extra.raw_summary ?? '')}
                      </div>
                    </div>
                  `,
                )}
              `
            : ''}
        </div>
      </div>

      <!-- ستون بازنویسی، قابل ویرایش -->
      <div class="col">
        <form method="post" action="/articles/${article.id}">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div class="card">
            <h2>متن کاکو نیوز ${editable ? html`<span class="small muted">(قابل ویرایش)</span>` : ''}</h2>

            <label for="title">تیتر</label>
            <input type="text" id="title" name="title" value="${article.title}"
                   ${editable ? raw('') : raw('readonly')} required>

            <label for="lead">لید</label>
            <textarea id="lead" name="lead" rows="3" ${editable ? raw('') : raw('readonly')} required>${article.lead}</textarea>

            <label for="body">متن خبر</label>
            <textarea id="body" name="body" rows="16" ${editable ? raw('') : raw('readonly')} required>${article.body}</textarea>

            <label for="category">دسته‌بندی</label>
            <select id="category" name="category" ${editable ? raw('') : raw('disabled')}>
              ${categories.map(
                (category) => html`<option value="${category}"
                  ${category === article.category ? raw('selected') : raw('')}>${category}</option>`,
              )}
            </select>

            <label for="tags">برچسب‌ها (با ویرگول جدا کنید)</label>
            <input type="text" id="tags" name="tags" value="${article.tags.join('، ')}"
                   ${editable ? raw('') : raw('readonly')}>

            <label for="image_url">نشانی تصویر شاخص</label>
            <input type="text" id="image_url" name="image_url" value="${article.image_url ?? ''}"
                   ${editable ? raw('') : raw('readonly')} dir="ltr">
            ${article.image_url
              ? html`<div style="margin-top:8px">
                  <img src="${safeUrl(article.image_url)}" alt="تصویر شاخص خبر"
                       style="max-width:100%;border-radius:8px;border:1px solid var(--line)">
                  ${article.image_credit ? html`<div class="small muted">${article.image_credit}</div>` : ''}
                  <div class="notice warn small" style="margin-top:8px">
                    ⚠️ تصاویر منابع خبری معمولاً حق نشر دارند. پیش از انتشار از مجاز بودن استفاده مطمئن شوید.
                  </div>
                </div>`
              : ''}

            <label for="editor_notes">یادداشت سردبیر (منتشر نمی‌شود)</label>
            <input type="text" id="editor_notes" name="editor_notes" value="${article.editor_notes ?? ''}">

            <div class="small muted" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
              ${options.sourceLine}
              <br>نشانی خبر: <span class="mono">/${article.slug}</span>
              ${article.rewrite_model ? html`<br>مدل بازنویسی: <span class="mono">${article.rewrite_model}</span>` : ''}
            </div>

            ${editable
              ? html`<div class="actions">
                  <button type="submit" name="action" value="save" class="btn">ذخیرهٔ ویرایش</button>
                </div>`
              : ''}
          </div>
        </form>

        ${editable
          ? html`
              <form method="post" action="/articles/${article.id}/approve">
                <input type="hidden" name="_csrf" value="${csrf}">
                <div class="card">
                  <h2>تأیید و انتشار</h2>
                  <p class="small muted" style="margin:0">
                    ابتدا ویرایش‌ها را ذخیره کنید، سپس مقصد انتشار را انتخاب کنید.
                  </p>
                  <div class="targets">
                    <label>
                      <input type="checkbox" name="targets" value="website"
                             ${defaultTargets.includes('website') ? raw('checked') : raw('')}>
                      انتشار در وب‌سایت
                    </label>
                    <label>
                      <input type="checkbox" name="targets" value="telegram"
                             ${defaultTargets.includes('telegram') ? raw('checked') : raw('')}>
                      انتشار در کانال تلگرام
                    </label>
                  </div>
                  <div class="actions">
                    <button type="submit" class="btn primary">تأیید و انتشار</button>
                  </div>
                </div>
              </form>

              <form method="post" action="/articles/${article.id}/reject">
                <input type="hidden" name="_csrf" value="${csrf}">
                <div class="card">
                  <h2>رد کردن خبر</h2>
                  <label for="reason">دلیل رد (برای بازبینی بعدی ثبت می‌شود)</label>
                  <input type="text" id="reason" name="reason" placeholder="مثلاً: خبر قدیمی است">
                  <div class="actions">
                    <button type="submit" class="btn danger">رد کردن</button>
                  </div>
                </div>
              </form>
            `
          : ''}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// فهرست‌های ساده
// ---------------------------------------------------------------

export function articleListPage(options: {
  heading: string;
  articles: ArticleRow[];
  emptyText: string;
}): SafeHtml {
  return html`
    <h1>${options.heading}</h1>
    <div class="card">
      ${options.articles.length === 0
        ? html`<div class="empty">${options.emptyText}</div>`
        : html`<table>
            <tr><th>تیتر</th><th>دسته</th><th>وضعیت</th><th>زمان</th></tr>
            ${options.articles.map(
              (article) => html`<tr>
                <td><a href="/articles/${article.id}">${truncate(article.title, 70)}</a></td>
                <td class="small">${article.category}</td>
                <td class="small">
                  ${STATUS_LABELS[article.status] ?? article.status}
                  ${article.reject_reason
                    ? html`<div class="muted">${truncate(article.reject_reason, 60)}</div>`
                    : ''}
                </td>
                <td class="small muted">${formatTehran(article.published_at ?? article.created_at)}</td>
              </tr>`,
            )}
          </table>`}
    </div>
  `;
}

// ---------------------------------------------------------------
// سلامت منابع
// ---------------------------------------------------------------

export function sourcesPage(options: { sources: SourceRow[] }): SafeHtml {
  return html`
    <h1>سلامت منابع</h1>
    <div class="card">
      <p class="small muted" style="margin-top:0">
        منابع در فایل <span class="mono">config/sources.yaml</span> تعریف می‌شوند.
        پس از ویرایش، دستور <span class="mono">npm run sources:sync</span> را اجرا کنید.
      </p>
      ${options.sources.length === 0
        ? html`<div class="empty">هنوز منبعی ثبت نشده است.</div>`
        : html`<table>
            <tr>
              <th>منبع</th><th>نوع</th><th>بازه</th>
              <th>وضعیت</th><th>آخرین بررسی</th>
            </tr>
            ${options.sources.map(
              (source) => html`<tr>
                <td>
                  ${source.name}
                  <div class="small muted mono">${source.slug}</div>
                </td>
                <td class="small">${source.type}</td>
                <td class="small num">هر ${Math.round(source.poll_interval_seconds / 60)} دقیقه</td>
                <td>
                  ${!source.enabled
                    ? html`<span class="badge plain">غیرفعال</span>`
                    : source.last_status === 'error'
                      ? html`<span class="badge danger">خطا</span>
                          ${source.consecutive_failures > 1
                            ? html`<span class="small muted"> ${source.consecutive_failures} بار پیاپی</span>`
                            : ''}
                          <div class="small muted">${truncate(source.last_error ?? '', 110)}</div>`
                      : source.last_status === 'ok'
                        ? html`<span class="badge">سالم</span>`
                        : html`<span class="badge plain">بررسی‌نشده</span>`}
                </td>
                <td class="small muted">${formatTehran(source.last_polled_at)}</td>
              </tr>`,
            )}
          </table>`}
    </div>
  `;
}
