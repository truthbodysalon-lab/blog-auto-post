import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
await page.goto('https://body-salon-truth.com/admin/images/');
await page.waitForTimeout(3000);

const url = page.url();
const title = await page.title();
console.log(`URL: ${url}`);
console.log(`Title: ${title}`);

const imgInfo = await page.evaluate(() => {
  const images = Array.from(document.querySelectorAll('img'));
  return {
    totalImg: images.length,
    samples: images.slice(0, 20).map(img => ({
      src: img.src.slice(0, 200),
      alt: img.alt,
      title: img.title,
      class: img.className,
    })),
  };
});
console.log('\n=== 画像情報 ===');
console.log(JSON.stringify(imgInfo, null, 2));

const linkInfo = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a[href*="image"], a[href*="upload"]'))
    .slice(0, 10).map(a => ({ text: a.textContent.trim().slice(0, 30), href: a.href }));
});
console.log('\n=== 画像系リンク ===');
console.log(JSON.stringify(linkInfo, null, 2));

await page.screenshot({ path: 'debug-images.png', fullPage: true });
await browser.close();
