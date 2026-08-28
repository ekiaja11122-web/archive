/**
 * آزمودن یک منبع خبری بدون ثبت چیزی در دیتابیس.
 *
 *   npm run kako -- sources:test <slug>
 *
 * دقیقاً همان کاری را می‌کند که جمع‌آوری واقعی می‌کند، ولی به‌جای ذخیره،
 * نشان می‌دهد **چه چیزی از هر خبر استخراج شده** — تیتر، لینک، تاریخ،
 * تصویر و متن. این تنها راه عملی تنظیم سلکتورهای CSS است: سلکتور را
 * عوض کنید، این دستور را بزنید، ببینید چه گرفت.
 *
 * ضمناً امتیاز فیلتر شیراز هر خبر را هم می‌دهد تا پیش از فعال کردن
 * منبع بدانید چقدر خبر محلی می‌آورد.
 */
import * as cheerio from 'cheerio';
import { loadSourcesConfig, type ResolvedSource } from '../config/sources-config.ts';
import { fetchText } from '../lib/http.ts';
import { getAdapter } from '../collectors/registry.ts';
import { scoreRelevance } from '../pipeline/relevance-score.ts';
import { createLogger } from '../lib/logger.ts';
import { errorMessage } from '../lib/errors.ts';
import { truncate, wordCount } from '../lib/text.ts';
import { formatTehran } from '../lib/date.ts';
import { loadAppConfig } from '../config/app-config.ts';

const logger = createLogger('collect');


/**
 * بررسی اینکه هر سلکتور تعریف‌شده واقعاً چیزی می‌گیرد یا نه.
 *
 * چرا لازم است: سیستم اگر سلکتور کانفیگ نتیجه ندهد، سراغ حدس‌های عمومی
 * می‌رود و خبر را نجات می‌دهد. این رفتار در عمل خوب است، ولی باعث می‌شود
 * سلکتور غلط **بی‌صدا** بماند. اینجا صریح گفته می‌شود کدام سلکتور کار
 * کرده و کدام نه.
 */
async function checkSelectors(
  source: ResolvedSource,
  articleUrl: string,
): Promise<{ name: string; selector: string; matched: boolean; sample?: string }[]> {
  const results: { name: string; selector: string; matched: boolean; sample?: string }[] = [];
  const article = source.article ?? {};

  const wanted: [string, string | undefined, string | undefined][] = [
    ['متن خبر', article.body_selector, undefined],
    ['تیتر صفحه', article.title_selector, undefined],
    ['تصویر', article.image_selector, article.image_attribute ?? 'src'],
    ['تاریخ', article.date_selector, article.date_attribute],
    ['نویسنده', article.author_selector, undefined],
  ];
  if (!wanted.some(([, selector]) => selector)) return results;

  const response = await fetchText(articleUrl, {
    timeoutMs: source.fetchSettings.timeout_ms,
    retries: 0,
    logger,
  });
  const $ = cheerio.load(response.body);

  for (const [name, selector, attribute] of wanted) {
    if (!selector) continue;
    let matched = false;
    let sample: string | undefined;
    try {
      const el = $(selector).first();
      matched = el.length > 0;
      if (matched) {
        const value = attribute ? el.attr(attribute) : el.text();
        sample = truncate((value ?? '').replace(/\s+/g, ' ').trim(), 60);
      }
    } catch {
      matched = false;
    }
    results.push({ name, selector, matched, ...(sample ? { sample } : {}) });
  }

  // سلکتورهای حذف هم بررسی می‌شوند
  for (const selector of article.remove_selectors ?? []) {
    try {
      results.push({
        name: 'حذف', selector, matched: $(selector).length > 0,
      });
    } catch {
      results.push({ name: 'حذف', selector, matched: false });
    }
  }

  return results;
}

export async function runSourceTest(slug: string, limit = 5): Promise<number> {
  if (!slug) {
    process.stdout.write(
      '\n  استفاده: npm run kako -- sources:test <slug> [--limit=<n>]\n' +
      '  فهرست منابع: npm run sources:list\n\n',
    );
    return 1;
  }

  const sources = loadSourcesConfig();
  const source = sources.find((s) => s.slug === slug);

  if (!source) {
    process.stdout.write(`\n  ✗ منبعی با شناسهٔ «${slug}» در sources.yaml نیست.\n`);
    process.stdout.write(`    شناسه‌های موجود: ${sources.map((s) => s.slug).join('، ')}\n\n`);
    return 1;
  }

  process.stdout.write(
    `\n  آزمایش منبع «${source.name}»\n` +
    `  ${'─'.repeat(52)}\n` +
    `  نوع  : ${source.type}\n` +
    `  نشانی: ${source.url}\n` +
    (source.type === 'scrape'
      ? `  سلکتور فهرست: ${source.list.item_selector}\n`
      : '') +
    `  متن کامل از صفحهٔ خبر: ${source.fetch_full_content ? 'بله' : 'خیر'}\n`,
  );

  let items;
  try {
    const adapter = getAdapter(source.type);
    const result = await adapter.collect({ source, logger, limit });
    items = result.items;

    if (result.warnings.length > 0) {
      process.stdout.write(`\n  هشدارها (${result.warnings.length}):\n`);
      for (const warning of result.warnings.slice(0, 5)) {
        process.stdout.write(`    ! ${truncate(warning, 100)}\n`);
      }
    }
  } catch (err) {
    process.stdout.write(`\n  ✗ جمع‌آوری شکست خورد:\n    ${errorMessage(err)}\n\n`);
    printTroubleshooting(source);
    return 1;
  }

  if (items.length === 0) {
    process.stdout.write('\n  ✗ هیچ خبری استخراج نشد.\n\n');
    printTroubleshooting(source);
    return 1;
  }

  const app = loadAppConfig();
  let relevant = 0;
  let missingBody = 0;
  let missingDate = 0;
  let missingImage = 0;

  process.stdout.write(`\n  ${items.length} خبر استخراج شد:\n`);

  for (const [index, item] of items.entries()) {
    const score = scoreRelevance(item.title, item.body ?? item.summary).score;
    const isRelevant = score >= app.relevance.irrelevant_threshold;
    if (isRelevant) relevant++;
    if (!item.body || wordCount(item.body) < 30) missingBody++;
    if (!item.publishedAt) missingDate++;
    if (!item.imageUrl) missingImage++;

    const mark = score >= app.relevance.certain_threshold ? '✓' : isRelevant ? '~' : '·';
    process.stdout.write(
      `\n  ${mark} ${index + 1}. ${item.title}\n` +
      `        امتیاز شیراز: ${score}\n` +
      `        لینک : ${truncate(item.sourceUrl, 78)}\n` +
      `        تاریخ: ${item.publishedAt ? formatTehran(item.publishedAt) : '⚠️ استخراج نشد'}\n` +
      `        تصویر: ${item.imageUrl ? truncate(item.imageUrl, 66) : '— ندارد'}\n` +
      `        متن  : ${
        item.body
          ? `${wordCount(item.body)} کلمه — «${truncate(item.body.replace(/\n+/g, ' '), 70)}»`
          : '⚠️ استخراج نشد'
      }\n`,
    );
  }

  // --- بررسی سلکتورها روی یک صفحهٔ واقعی ---
  const firstUrl = items[0]?.sourceUrl;
  let selectorProblems = 0;
  if (firstUrl && source.article && Object.keys(source.article).length > 0) {
    try {
      const checks = await checkSelectors(source, firstUrl);
      if (checks.length > 0) {
        process.stdout.write(`\n  ${'─'.repeat(52)}\n  بررسی سلکتورها روی «${truncate(firstUrl, 40)}»:\n`);
        for (const check of checks) {
          const mark = check.matched ? '✓' : '✗';
          if (!check.matched && check.name !== 'حذف') selectorProblems++;
          process.stdout.write(`    ${mark} ${check.name.padEnd(10)} ${check.selector}\n`);
          if (check.sample) process.stdout.write(`                 → «${check.sample}»\n`);
        }
        if (selectorProblems > 0) {
          process.stdout.write(
            `\n    ⚠️ ${selectorProblems} سلکتور چیزی نگرفت. خبرها با حدس‌های عمومی\n` +
            `       استخراج شدند — کار می‌کند، ولی با تغییر قالب سایت شکننده است.\n` +
            `       سلکتور درست را از Inspect مرورگر بردارید.\n`,
          );
        }
      }
    } catch (err) {
      process.stdout.write(`\n  (بررسی سلکتورها انجام نشد: ${errorMessage(err)})\n`);
    }
  }

  // --- خلاصه و تشخیص مشکل ---
  process.stdout.write(`\n  ${'─'.repeat(52)}\n  خلاصه:\n`);
  process.stdout.write(`    مرتبط با شیراز : ${relevant} از ${items.length}\n`);
  process.stdout.write(`    بدون متن کامل  : ${missingBody}\n`);
  process.stdout.write(`    بدون تاریخ     : ${missingDate}\n`);
  process.stdout.write(`    بدون تصویر     : ${missingImage}\n\n`);

  const problems: string[] = [];
  if (missingBody === items.length) {
    problems.push(
      source.fetch_full_content
        ? 'هیچ خبری متن کامل ندارد → سلکتور article.body_selector درست نیست'
        : 'متن کامل گرفته نمی‌شود → fetch_full_content را true کنید',
    );
  }
  if (missingDate === items.length) {
    problems.push('هیچ خبری تاریخ ندارد → article.date_selector را تنظیم کنید');
  }
  if (missingImage === items.length) {
    problems.push('هیچ خبری تصویر ندارد → article.image_selector را بررسی کنید');
  }
  if (relevant === 0) {
    problems.push(
      'هیچ خبری مرتبط با شیراز نبود → احتمالاً این نشانی، فید سراسری است.\n' +
      '      دنبال بخش/فید *استان فارس* همان سایت بگردید.',
    );
  }

  if (problems.length > 0) {
    process.stdout.write('  مشکلات:\n');
    for (const problem of problems) process.stdout.write(`    ! ${problem}\n`);
    process.stdout.write('\n  پس از اصلاح sources.yaml، همین دستور را دوباره بزنید.\n\n');
    return 1;
  }

  if (selectorProblems > 0) {
    process.stdout.write(
      '  ~ این منبع کار می‌کند، ولی سلکتورهایش دقیق نیستند.\n' +
      '    خبرها با حدس عمومی استخراج شدند؛ بهتر است اصلاحشان کنید.\n\n',
    );
    return 0;
  }

  process.stdout.write(
    '  ✓ این منبع سالم است.\n\n' +
    `  برای فعال کردنش:\n` +
    `    ۱. در sources.yaml مقدار enabled را true کنید\n` +
    `    ۲. npm run sources:sync\n` +
    `    ۳. npm run collect -- --source=${slug} --force\n\n`,
  );
  return 0;
}

function printTroubleshooting(source: ResolvedSource): void {
  process.stdout.write('  راهنمای رفع مشکل:\n');
  if (source.type === 'rss') {
    process.stdout.write(
      '    · نشانی فید را در مرورگر باز کنید؛ اگر XML نشان نداد، فید نیست.\n' +
      '    · برای پیدا کردن فید درست: npm run kako -- sources:discover <نشانی سایت>\n',
    );
  } else {
    process.stdout.write(
      '    · صفحهٔ آرشیو را در مرورگر باز کنید ← راست‌کلیک روی عنوان خبر ← Inspect\n' +
      '    · سلکتور item_selector باید *هر آیتم خبر* را در فهرست بگیرد\n' +
      '    · سلکتورها را ساده نگه دارید؛ کلاس‌های تصادفی با تغییر قالب می‌شکنند\n',
    );
  }
  process.stdout.write('    · شاید سایت ربات‌ها را بلاک می‌کند؛ لاگ خطا را بالاتر ببینید.\n\n');
}
