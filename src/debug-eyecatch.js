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

const eyecatchInfo = await page.evaluate(() => {
  const hidden = document.querySelector('#upload_image_hidden');
  const wrapper = hidden?.closest('div, td, section');
  const buttons = wrapper ? Array.from(wrapper.querySelectorAll('button, a, input[type="button"]')).map(b => ({
    tag: b.tagName,
    text: (b.textContent || b.value || '').trim(),
    onclick: b.getAttribute('onclick'),
    class: b.className,
    id: b.id,
  })) : [];
  return {
    hiddenName: hidden?.name,
    hiddenId: hidden?.id,
    hiddenValue: hidden?.value,
    wrapperHTML: wrapper?.outerHTML.slice(0, 1500),
    buttons,
  };
});

console.log('=== アイキャッチ画像周りの構造 ===');
console.log(JSON.stringify(eyecatchInfo, null, 2));

const allMediaButtons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, a, input'))
    .filter(b => (b.textContent || b.value || '').includes('メディア'))
    .map(b => ({
      text: (b.textContent || b.value || '').trim(),
      id: b.id,
      class: b.className,
      onclick: b.getAttribute('onclick'),
      'data-target': b.getAttribute('data-target'),
    }));
});
console.log('\n=== メディアボタン一覧 ===');
console.log(JSON.stringify(allMediaButtons, null, 2));

await browser.close();
