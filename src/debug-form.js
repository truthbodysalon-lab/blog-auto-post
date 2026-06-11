import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
await page.goto('https://body-salon-truth.com/admin/newpages/simple-add/blog/');
await page.waitForTimeout(3000);

const formInfo = await page.evaluate(() => {
  const fields = Array.from(document.querySelectorAll('input, textarea, select'));
  return fields.map(f => ({
    tag: f.tagName,
    type: f.type,
    name: f.name,
    id: f.id,
    required: f.required || f.hasAttribute('required') || f.classList.contains('required'),
    placeholder: f.placeholder,
    label: (f.closest('label')?.textContent || document.querySelector(`label[for="${f.id}"]`)?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    visible: f.offsetParent !== null,
  })).filter(f => f.name || f.id);
});

console.log('=== フォームフィールド一覧 ===');
formInfo.forEach(f => console.log(JSON.stringify(f)));

const forms = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('form')).map(f => ({
    id: f.id,
    name: f.name,
    action: f.action,
    method: f.method,
    fieldCount: f.querySelectorAll('input,textarea,select').length,
  }));
});
console.log('\n=== フォーム ===');
forms.forEach(f => console.log(JSON.stringify(f)));

await page.waitForTimeout(2000);
await browser.close();
