/**
 * تست‌های ایمنی خروجی HTML پنل.
 *
 * محتوای پنل از سایت‌های بیرونی می‌آید؛ اگر منبعی در تیتر خبرش کد
 * جاوااسکریپت بگذارد، نباید در مرورگر سردبیر اجرا شود.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { html, escapeHtml, raw, paragraphs, safeUrl } from '../src/admin/html.ts';

describe('پاک‌سازی محتوای بیرونی', () => {
  test('تگ اسکریپت در تیتر خنثی می‌شود', () => {
    const evil = '<script>alert(1)</script>';
    const out = html`<h1>${evil}</h1>`.toString();
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });

  test('فرار از صفت با گیومه ممکن نیست', () => {
    const evil = '" onerror="alert(1)';
    const out = html`<img alt="${evil}">`.toString();
    assert.ok(!out.includes('onerror="alert'));
    assert.ok(out.includes('&quot;'));
  });

  test('متن فارسی سالم می‌ماند', () => {
    assert.equal(escapeHtml('خبر «مهم» شیراز'), 'خبر «مهم» شیراز');
  });

  test('مقدار خالی و null چیزی چاپ نمی‌کند', () => {
    assert.equal(html`<p>${null}${undefined}${false}</p>`.toString(), '<p></p>');
  });

  test('آرایه بدون کاما به هم می‌چسبد', () => {
    assert.equal(html`${['الف', 'ب']}`.toString(), 'الفب');
  });

  test('raw عمداً خام می‌ماند', () => {
    assert.equal(html`${raw('<b>پررنگ</b>')}`.toString(), '<b>پررنگ</b>');
  });
});

describe('تبدیل متن خبر به پاراگراف', () => {
  test('پاراگراف‌ها جدا می‌شوند و محتوا escape می‌شود', () => {
    const out = paragraphs('یک <b>تگ</b>\n\nپاراگراف دوم').toString();
    assert.equal(out, '<p>یک &lt;b&gt;تگ&lt;/b&gt;</p><p>پاراگراف دوم</p>');
  });

  test('متن خالی چیزی تولید نمی‌کند', () => {
    assert.equal(paragraphs('').toString(), '');
    assert.equal(paragraphs(null).toString(), '');
  });
});

describe('نشانی امن', () => {
  test('نشانی http و https پذیرفته می‌شود', () => {
    assert.equal(safeUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  });

  test('javascript: و data: رد می‌شوند', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '');
    assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), '');
  });

  test('نشانی نامعتبر رد می‌شود', () => {
    assert.equal(safeUrl('نامعتبر'), '');
    assert.equal(safeUrl(null), '');
  });
});
