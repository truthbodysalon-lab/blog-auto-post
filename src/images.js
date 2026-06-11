import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const CACHE_FILE = path.resolve('posts/images-cache.json');

export async function refreshImageCache() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    storageState: fs.existsSync('auth.json') ? 'auth.json' : undefined,
  });
  const page = await ctx.newPage();
  await page.goto('https://body-salon-truth.com/admin/images/');
  await page.waitForTimeout(2500);

  const images = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .map(img => img.src)
      .filter(src => src && src.includes('/upload_data/') && src.includes('/image/'))
      .map(src => {
        const match = src.match(/\/image\/([^/?#]+)/);
        return { url: src, filename: match ? match[1] : null };
      })
      .filter(i => i.filename);
  });

  await browser.close();

  const unique = [...new Map(images.map(i => [i.filename, i])).values()];
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ updated: new Date().toISOString(), images: unique }, null, 2));
  console.log(`📸 画像キャッシュ更新: ${unique.length}枚`);
  return unique;
}

export function getCachedImages() {
  if (!fs.existsSync(CACHE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return data.images || [];
  } catch {
    return [];
  }
}

export function pickRandomImage() {
  const images = getCachedImages();
  if (!images.length) return null;
  return images[Math.floor(Math.random() * images.length)];
}

if (process.argv[1]?.endsWith('images.js')) {
  refreshImageCache().then(imgs => {
    console.log('サンプル:', imgs.slice(0, 3));
  });
}
