import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
await page.goto('https://body-salon-truth.com/admin/newpages/simple-add/blog/');
await page.waitForTimeout(3000);

await page.locator('button[view-id="01"]').first().click();
await page.waitForTimeout(2500);

const modalInfo = await page.evaluate(() => {
  const modal = document.querySelector('#imagesModal2');
  if (!modal) return { error: 'モーダル未検出' };
  return {
    visible: modal.offsetParent !== null,
    imgCount: modal.querySelectorAll('img').length,
    imgs: Array.from(modal.querySelectorAll('img')).slice(0, 8).map(img => ({
      src: img.src.slice(0, 200),
      'data-src': img.getAttribute('data-src'),
      'data-image-id': img.getAttribute('data-image-id'),
      'data-id': img.getAttribute('data-id'),
      onclick: img.getAttribute('onclick'),
      parentTag: img.parentElement?.tagName,
      parentClass: img.parentElement?.className,
      parentOnclick: img.parentElement?.getAttribute('onclick'),
    })),
    buttons: Array.from(modal.querySelectorAll('button')).slice(0, 8).map(b => ({
      text: b.textContent.trim().slice(0, 20),
      class: b.className,
    })),
  };
});

console.log('=== 画像選択モーダル ===');
console.log(JSON.stringify(modalInfo, null, 2));

await page.screenshot({ path: 'debug-modal.png', fullPage: false });
await browser.close();
