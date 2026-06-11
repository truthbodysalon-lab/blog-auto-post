import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
await page.goto(process.env.ADMIN_URL);
await page.waitForTimeout(2500);

const links = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a'))
    .map(a => ({ text: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), href: a.href }))
    .filter(l => l.text && l.href && (
      l.text.includes('ブログ') ||
      l.text.includes('新規') ||
      l.text.includes('かんたん') ||
      l.text.includes('テンプレート') ||
      l.href.includes('blog') ||
      l.href.includes('newpage')
    ));
});
console.log('=== ブログ関連リンク ===');
console.log(JSON.stringify(links, null, 2));

await page.waitForTimeout(3000);
await browser.close();
