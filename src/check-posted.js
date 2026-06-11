import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
});
const page = await ctx.newPage();
await page.goto('https://body-salon-truth.com/admin/blogs/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const posts = await page.evaluate(() => {
  const main = document.querySelector('main, #main, .main, [role="main"], .content-area, .contents') || document.body;
  const rows = main.querySelectorAll('table tbody tr, .list-item, [class*="article"], [class*="post-list"] li');
  return Array.from(rows).slice(0, 10).map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
});

console.log('=== ブログ投稿一覧（最新10件） ===');
posts.forEach((p, i) => console.log(`${i + 1}. ${p}`));

await page.screenshot({ path: 'debug-bloglist.png', fullPage: true });
console.log('スクショ保存: debug-bloglist.png');
await browser.close();
