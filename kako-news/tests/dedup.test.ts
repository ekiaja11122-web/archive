/**
 * تست‌های تشخیص خبر تکراری.
 *
 * دادهٔ آزمایش، همان فایل نمونهٔ پروژه است: دو گزارش از افتتاح مترو شیراز
 * با نگارش کاملاً متفاوت (باید تکراری تشخیص داده شوند) در کنار سه خبر
 * بی‌ربط (که نباید).
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { articleSimilarity, weightedOverlap, significantTokens } from '../src/lib/similarity.ts';
import { findBestMatch } from '../src/pipeline/dedup.ts';
import { loadAppConfig } from '../src/config/app-config.ts';
import { fromRoot } from '../src/config/paths.ts';

const app = loadAppConfig();
const THRESHOLD = app.deduplication.similarity_threshold;
const TITLE_WEIGHT = app.deduplication.title_weight;

type Fixture = { title: string; body: string; url: string };
const fixture: Fixture[] = JSON.parse(
  fs.readFileSync(fromRoot('fixtures/mock-source.json'), 'utf8'),
).items;

const metroA = fixture[0]!;   // «بهره‌برداری از فاز نخست خط دو قطار شهری شیراز…»
const persepolis = fixture[1]!;
const banking = fixture[2]!;
const metroB = fixture[3]!;   // همان رویداد، نگارش متفاوت
const sangSiah = fixture[4]!;

describe('ضریب هم‌پوشانی وزن‌دار', () => {
  test('دو مجموعهٔ یکسان، امتیاز کامل می‌گیرند', () => {
    const a = significantTokens('افتتاح مترو شیراز');
    assert.equal(weightedOverlap(a, a), 1);
  });

  test('مجموعه‌های بی‌اشتراک، امتیاز صفر می‌گیرند', () => {
    assert.equal(
      weightedOverlap(significantTokens('افتتاح مترو'), significantTokens('برداشت انار')),
      0,
    );
  });

  test('مجموعهٔ خالی کرش نمی‌کند', () => {
    assert.equal(weightedOverlap(new Set(), significantTokens('چیزی')), 0);
  });

  test('اختلاف طول متن، امتیاز را بی‌جهت پایین نمی‌آورد', () => {
    const short = significantTokens('افتتاح مترو شیراز');
    const long = significantTokens(
      'افتتاح مترو شیراز با حضور مسئولان استانی و شهری و جمعی از شهروندان و خبرنگاران محلی انجام شد',
    );
    // همهٔ واژه‌های متن کوتاه در متن بلند هستند، پس هم‌پوشانی باید کامل باشد
    assert.equal(weightedOverlap(short, long), 1);
  });
});

describe('شباهت دو خبر', () => {
  test('دو گزارش از یک رویداد، بالای آستانه امتیاز می‌گیرند', () => {
    const s = articleSimilarity(metroA, metroB, { titleWeight: TITLE_WEIGHT });
    assert.ok(s.score >= THRESHOLD, `امتیاز باید حداقل ${THRESHOLD} باشد، بود: ${s.score}`);
  });

  test('خبرهای بی‌ربط، زیر آستانه می‌مانند', () => {
    const pairs: [Fixture, Fixture][] = [
      [metroA, persepolis], [metroA, banking], [metroA, sangSiah],
      [persepolis, banking], [persepolis, sangSiah], [banking, sangSiah],
      [metroB, sangSiah], [metroB, persepolis],
    ];
    for (const [a, b] of pairs) {
      const s = articleSimilarity(a, b, { titleWeight: TITLE_WEIGHT });
      assert.ok(s.score < THRESHOLD, `«${a.title.slice(0, 25)}» و «${b.title.slice(0, 25)}» نباید تکراری باشند (${s.score})`);
    }
  });

  test('فاصلهٔ امتیاز تکراری و غیرتکراری قابل اتکاست', () => {
    const duplicate = articleSimilarity(metroA, metroB, { titleWeight: TITLE_WEIGHT }).score;
    const highestUnrelated = Math.max(
      ...[persepolis, banking, sangSiah].map(
        (other) => articleSimilarity(metroA, other, { titleWeight: TITLE_WEIGHT }).score,
      ),
    );
    assert.ok(
      duplicate - highestUnrelated > 0.3,
      `فاصله باید روشن باشد: تکراری ${duplicate} در برابر بیشترین غیرتکراری ${highestUnrelated}`,
    );
  });

  test('خبر بدون متن، فقط بر اساس تیتر سنجیده می‌شود', () => {
    const s = articleSimilarity(
      { title: metroA.title },
      { title: metroB.title, body: metroB.body },
      { titleWeight: TITLE_WEIGHT },
    );
    assert.equal(s.bodyScore, 0);
    assert.ok(s.score > 0);
  });

  test('واژه‌های مشترک برای توضیح تصمیم برگردانده می‌شوند', () => {
    const s = articleSimilarity(metroA, metroB, { titleWeight: TITLE_WEIGHT });
    assert.ok(s.sharedTerms.includes('شیراز'));
  });
});

describe('انتخاب خبر اصلی', () => {
  const options = { threshold: THRESHOLD, titleWeight: TITLE_WEIGHT };

  function candidate(id: number, item: Fixture, extra: Partial<{ source_id: number; duplicate_of_id: number | null }> = {}) {
    return {
      id, source_id: extra.source_id ?? 1, title: item.title, body: item.body,
      summary: null, duplicate_of_id: extra.duplicate_of_id ?? null,
    };
  }

  test('خبر تکراری به نامزد مشابه وصل می‌شود', () => {
    const match = findBestMatch(
      { ...metroB, id: 2, source_id: 1 },
      [candidate(1, metroA)],
      options,
    );
    assert.equal(match?.primaryId, 1);
  });

  test('خبر یکتا هیچ تطبیقی پیدا نمی‌کند', () => {
    const match = findBestMatch(
      { ...sangSiah, id: 2, source_id: 1 },
      [candidate(1, metroA), candidate(3, banking)],
      options,
    );
    assert.equal(match, null);
  });

  test('زنجیرهٔ تکراری دنبال می‌شود تا به خبر اصلی برسد', () => {
    // نامزد #5 خودش تکراریِ #1 است، پس خبر تازه باید به #1 وصل شود نه #5
    const match = findBestMatch(
      { ...metroB, id: 9, source_id: 2 },
      [candidate(5, metroA, { duplicate_of_id: 1 })],
      options,
    );
    assert.equal(match?.primaryId, 1);
  });

  test('خبر هرگز تکراریِ خودش اعلام نمی‌شود', () => {
    // حالت مرزی: نامزدی که زنجیره‌اش به خود همین خبر برمی‌گردد
    const match = findBestMatch(
      { ...metroA, id: 1, source_id: 1 },
      [candidate(4, metroB, { duplicate_of_id: 1 })],
      options,
    );
    assert.equal(match, null);
  });

  test('بهترین (نه اولین) تطبیق انتخاب می‌شود', () => {
    const match = findBestMatch(
      { ...metroA, id: 9, source_id: 1 },
      [candidate(3, metroB), candidate(7, metroA)],   // #7 تطبیق کامل‌تری است
      options,
    );
    assert.equal(match?.primaryId, 7);
  });

  test('تکراری بودن بین دو منبع مختلف علامت‌گذاری می‌شود', () => {
    const match = findBestMatch(
      { ...metroB, id: 9, source_id: 2 },
      [candidate(1, metroA, { source_id: 1 })],
      options,
    );
    assert.equal(match?.crossSource, true);
  });
});
