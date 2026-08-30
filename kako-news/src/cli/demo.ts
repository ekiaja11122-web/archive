/**
 * اجرای نمایشی — دیدن کل سامانه بدون نیاز به هیچ کلید API.
 *
 *     npm run demo
 *
 * چرا لازم است: اجرای اول باید *کامل* دیده شود. بدون کلید OpenAI،
 * پایپ‌لاین تا مرحلهٔ «آمادهٔ بازنویسی» جلو می‌رود و صف تأیید خالی
 * می‌ماند — یعنی پنل چیزی برای نشان دادن ندارد و کاربر نمی‌فهمد
 * سامانه کار می‌کند یا نه.
 *
 * این دستور همان مسیر واقعی را اجرا می‌کند (جمع‌آوری از منبع تستی،
 * فیلتر شیراز، تشخیص تکراری) و فقط **مرحلهٔ بازنویسی** را با یک
 * بازنویس ساختگیِ آفلاین جایگزین می‌کند تا صف تأیید پر شود و بشود
 * پنل را دید.
 *
 * ⚠️ متن‌های تولیدشده در این حالت **نمونه‌اند، نه بازنویسی واقعی**.
 *    هر خبری که این دستور می‌سازد با مدل «demo-offline» علامت می‌خورد
 *    و در پنل قابل تشخیص است. هرگز آن‌ها را منتشر نکنید.
 */
import { loadAppConfig } from '../config/app-config.ts';
import { loadSourcesConfig } from '../config/sources-config.ts';
import { createLogger } from '../lib/logger.ts';
import { truncate } from '../lib/text.ts';
import { runMigrations } from '../db/migrate.ts';
import { syncSources } from '../db/repositories/sources.ts';
import { runCollection } from '../pipeline/collect.ts';
import { runFilter } from '../pipeline/relevance.ts';
import { runDedup } from '../pipeline/dedup.ts';
import { rewriteOne, type SourceMaterial } from '../pipeline/rewrite.ts';
import {
  rawArticlesByStatus, updateRawArticleStatus, duplicatesOf,
} from '../db/repositories/raw-articles.ts';
import {
  insertArticle, articleExistsForRaw, countArticlesByStatus,
} from '../db/repositories/articles.ts';
import { listSources } from '../db/repositories/sources.ts';
import { countByStatus } from '../db/repositories/raw-articles.ts';
import { env } from '../config/env.ts';

const logger = createLogger('system');

const DEMO_MODEL = 'demo-offline';

/**
 * بازنویس ساختگی.
 *
 * نکتهٔ مهم: نسخهٔ اول این تابع جمله‌های خبر منبع را برمی‌داشت و
 * **محافظ کپی عینی جلویش را گرفت** — همان محافظی که برای خروجی مدل
 * زبانی ساخته شده بود. این رفتار درست است و نباید دور زده شود، پس
 * متن نمایشی کاملاً از نو نوشته می‌شود و هیچ جمله‌ای از منبع در آن
 * نیست. (ضمناً نشان می‌دهد محافظ واقعاً کار می‌کند.)
 */
function demoRewriter(title: string, category: string) {
  return {
    title: truncate(title, 110, ''),
    lead:
      'این لید نمونه در حالت نمایشی ساخته شده تا ساختار صفحهٔ بازبینی دیده شود؛ ' +
      'در اجرای واقعی، مدل زبانی مهم‌ترین اطلاعات خبر را بر پایهٔ هرم وارونه اینجا می‌آورد.',
    body: [
      'متن پیش رو نمونه است و بازنویسی هوش مصنوعی نیست. هدفش این است که ' +
        'ببینید صف تأیید، صفحهٔ مقایسه و دکمه‌های انتشار چطور کار می‌کنند.',
      'در ستون سمت راست همین صفحه، متن اصلی خبر منبع را می‌بینید. در اجرای ' +
        'واقعی، همان متن با رعایت راهنمای سبک نگارشی از نو نوشته می‌شود و ' +
        'نتیجه‌اش اینجا می‌نشیند تا شما پیش از انتشار بازبینی‌اش کنید.',
      'برای دیدن بازنویسی واقعی، کلید OpenAI را در فایل .env بگذارید و ' +
        'دستور «npm run rewrite» را اجرا کنید.',
    ].join('\n\n'),
    category,
    tags: ['شیراز', 'نمونه', 'حالت نمایشی'],
  };
}

export async function runDemo(): Promise<number> {
  const app = loadAppConfig();

  process.stdout.write(
    '\n  اجرای نمایشی کاکو نیوز\n' +
    `  ${'─'.repeat(50)}\n` +
    '  کل مسیر خبر با دادهٔ نمونه اجرا می‌شود، بدون نیاز به کلید API.\n' +
    '  متن‌های بازنویسی‌شده در این حالت نمونه‌اند، نه خروجی واقعی مدل.\n',
  );

  // --- آماده‌سازی ---
  process.stdout.write('\n  ۱/۵ آماده‌سازی دیتابیس…\n');
  const applied = await runMigrations();
  process.stdout.write(`      ${applied > 0 ? `${applied} مهاجرت اعمال شد` : 'دیتابیس به‌روز بود'}\n`);

  const definitions = loadSourcesConfig();
  const summary = await syncSources(definitions);
  process.stdout.write(`      ${summary.created + summary.updated} منبع همگام شد\n`);

  const mock = definitions.find((s) => s.type === 'mock' && s.enabled);
  if (!mock) {
    process.stdout.write(
      '\n  ✗ منبع تستی «mock-local» در sources.yaml فعال نیست.\n' +
      '    مقدار enabled آن را true کنید و دوباره امتحان کنید.\n\n',
    );
    return 1;
  }

  // --- جمع‌آوری ---
  process.stdout.write('\n  ۲/۵ جمع‌آوری از منبع تستی…\n');
  const collected = await runCollection({ only: mock.slug, force: true });
  const found = collected.reduce((n, s) => n + s.found, 0);
  const fresh = collected.reduce((n, s) => n + s.inserted, 0);
  process.stdout.write(`      ${found} خبر خوانده شد، ${fresh} تای آن تازه بود\n`);

  // --- فیلتر ---
  process.stdout.write('\n  ۳/۵ فیلتر مرتبط‌بودن با شیراز…\n');
  const filtered = await runFilter({});
  process.stdout.write(
    `      ${filtered.relevant} خبر مرتبط، ${filtered.irrelevant} خبر نامرتبط کنار گذاشته شد\n`,
  );

  // --- تشخیص تکراری ---
  process.stdout.write('\n  ۴/۵ تشخیص خبر تکراری…\n');
  const deduped = await runDedup({});
  process.stdout.write(
    `      ${deduped.unique} خبر یکتا، ${deduped.duplicates} خبر تکراری به خبر اصلی وصل شد\n`,
  );

  // --- بازنویسی نمایشی ---
  process.stdout.write('\n  ۵/۵ بازنویسی (حالت نمایشی، بدون مدل زبانی)…\n');
  const sourceNames = new Map((await listSources()).map((s) => [s.id, s.name]));
  const ready = await rawArticlesByStatus('ready', 20);
  let created = 0;

  for (const row of ready) {
    if (await articleExistsForRaw(row.id)) continue;

    const duplicates = await duplicatesOf(row.id);
    const material: SourceMaterial = {
      primary: {
        title: row.title,
        body: row.body ?? row.summary ?? '',
        sourceName: sourceNames.get(row.source_id) ?? 'نامشخص',
        publishedAt: row.published_at,
      },
      supplementary: duplicates.map((d) => ({
        title: d.title,
        body: d.body ?? d.summary ?? '',
        sourceName: sourceNames.get(d.source_id) ?? 'نامشخص',
      })),
    };

    // از همان مسیر واقعی بازنویسی رد می‌شویم — با همان اعتبارسنجی و
    // همان محافظ کپی — و فقط تماس با مدل زبانی جایگزین شده است.
    let result;
    try {
      result = await rewriteOne(material, {
      app,
        chat: async () => ({
          data: demoRewriter(row.title, app.categories[5] ?? app.categories[0]!),
          model: DEMO_MODEL,
          usage: {},
          durationMs: 0,
        }),
      });
    } catch (err) {
      // یک خبر مشکل‌دار نباید کل اجرای نمایشی را بخواباند
      logger.warn('خبر نمایشی ساخته نشد؛ از آن عبور شد', { raw_id: row.id }, err);
      continue;
    }

    const articleId = await insertArticle({
      rawArticleId: row.id,
      title: result.article.title,
      lead: result.article.lead,
      body: result.article.body,
      category: result.article.category,
      tags: result.article.tags,
      imageUrl: row.image_url,
      imageCredit: row.image_url ? `عکس: ${sourceNames.get(row.source_id) ?? 'منبع'}` : null,
      rewriteModel: DEMO_MODEL,
      rewriteMeta: { demo: true, note: 'متن نمونهٔ حالت نمایشی، نه بازنویسی واقعی' },
      supplementaryRawIds: duplicates.map((d) => d.id),
    });

    await updateRawArticleStatus(row.id, 'processed');
    created++;
    logger.debug('خبر نمایشی ساخته شد', { article_id: articleId });
  }

  process.stdout.write(`      ${created} خبر ساخته شد و در صف تأیید نشست\n`);

  // --- خلاصه ---
  const rawCounts = await countByStatus();
  const articleCounts = await countArticlesByStatus();
  const e = env();

  process.stdout.write(
    `\n  ${'─'.repeat(50)}\n` +
    `  خبرهای خام      : ${JSON.stringify(rawCounts)}\n` +
    `  خبرهای بازنویسی : ${JSON.stringify(articleCounts)}\n` +
    `\n  گام بعدی — پنل تأیید را باز کنید:\n\n` +
    `      npm run serve\n\n` +
    `  سپس در مرورگر:  http://${e.ADMIN_HOST}:${e.ADMIN_PORT}\n` +
    `  نام کاربری: ${e.ADMIN_USERNAME}    رمز: همان که در .env گذاشته‌اید\n\n` +
    `  ⚠️ متن خبرهای این حالت نمونه‌اند. برای بازنویسی واقعی، کلید\n` +
    `     OpenAI را در .env بگذارید و «npm run rewrite» را اجرا کنید.\n\n`,
  );

  return 0;
}
