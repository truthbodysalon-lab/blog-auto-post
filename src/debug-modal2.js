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
await page.waitForTimeout(2500);

const beforeHidden = await page.locator('#upload_image_hidden').inputValue();
console.log('クリック前 hidden:', JSON.stringify(beforeHidden));

await page.locator('button[view-id="01"]').first().click();
await page.waitForTimeout(6000);
await page.screenshot({ path: 'debug-modal-state.png', fullPage: true });

const modalState = await page.evaluate(() => {
  const modal = document.querySelector('#imagesModal2');
  if (!modal) return { error: 'no-modal' };
  const visible = window.getComputedStyle(modal).display !== 'none';
  return {
    visible,
    classList: modal.className,
    hasImagesContainer: !!modal.querySelector('[class*="image"], .col-md-3, .img-thumbnail'),
    structure: modal.outerHTML.slice(0, 3000),
  };
});
console.log('\nモーダル状態:', JSON.stringify({
  visible: modalState.visible,
  classList: modalState.classList,
  hasImagesContainer: modalState.hasImagesContainer,
}, null, 2));

const allBodyImgs = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll('img'))
    .filter(i => i.src && i.src.includes('upload_data') && i.offsetParent !== null);
  return imgs.slice(0, 5).map(i => ({
    src: i.src.slice(-60),
    container: i.closest('[id]')?.id || 'no-id',
    containerClass: i.closest('[class]')?.className?.slice(0, 80),
    parentTag: i.parentElement?.tagName,
    parentDataAttrs: Array.from(i.parentElement?.attributes || []).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
    grandparent: i.parentElement?.parentElement?.tagName,
    grandparentClass: i.parentElement?.parentElement?.className,
  }));
});
console.log('\n表示中の整体院画像:', JSON.stringify(allBodyImgs, null, 2));

const iframes = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => ({ id: f.id, src: f.src, name: f.name, visible: f.offsetParent !== null })));
console.log('\niframe一覧:', JSON.stringify(iframes, null, 2));

const allModalImgs = await page.evaluate(() => {
  const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show, .modal[style*="display: block"]'));
  if (!modals.length) return { count: 0, error: 'no visible modal' };
  const m = modals[0];
  const imgs = m.querySelectorAll('img');
  return {
    modalId: m.id,
    modalClass: m.className,
    count: imgs.length,
    sample: Array.from(imgs).slice(0, 5).map(i => ({
      src: i.src.slice(-60),
      'data-id': i.getAttribute('data-id'),
      'data-image-id': i.getAttribute('data-image-id'),
      attrs: Array.from(i.attributes).map(a => `${a.name}=${(a.value || '').slice(0, 80)}`),
      parentClass: i.parentElement?.className,
      parentTag: i.parentElement?.tagName,
      parentDataAttrs: Array.from(i.parentElement?.attributes || []).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
    })),
  };
});
console.log('\nモーダル内画像（全て）:', JSON.stringify(allModalImgs, null, 2));

const visibleImgs = await page.evaluate(() => {
  const modal = document.querySelector('#imagesModal2');
  if (!modal) return [];
  return Array.from(modal.querySelectorAll('img'))
    .filter(img => img.offsetParent !== null && img.src)
    .slice(0, 5)
    .map(img => ({
      src: img.src.slice(-50),
      'data-id': img.getAttribute('data-id'),
      'data-image-id': img.getAttribute('data-image-id'),
      'data-name': img.getAttribute('data-name'),
      'data-filename': img.getAttribute('data-filename'),
      onclick: img.getAttribute('onclick'),
      parentTag: img.parentElement?.tagName,
      parentDataAttrs: Array.from(img.parentElement?.attributes || []).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
    }));
});
console.log('\n表示中の画像（最大5件）:');
console.log(JSON.stringify(visibleImgs, null, 2));

if (visibleImgs.length > 0) {
  await page.locator('#imagesModal2 img:visible').first().click({ force: true });
  await page.waitForTimeout(800);
  const afterClick = await page.evaluate(() => {
    const sel = document.querySelector('.select-button');
    return { selectBtnVisible: sel?.offsetParent !== null, selectClass: sel?.className };
  });
  console.log('\n画像クリック後:', JSON.stringify(afterClick));

  await page.locator('#imagesModal2 .select-button:visible').first().click({ force: true }).catch(e => console.log('selectクリック失敗:', e.message));
  await page.waitForTimeout(1500);

  const afterHidden = await page.locator('#upload_image_hidden').inputValue();
  console.log('\nクリック後 hidden値:', JSON.stringify(afterHidden));
}

await browser.close();
