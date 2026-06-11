import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.resolve('auth.json');

export async function getBrowserContext() {
  const browser = await chromium.launch({
    headless: process.env.MODE !== 'debug',
    slowMo: process.env.MODE === 'debug' ? 200 : 0,
  });

  const contextOptions = {
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
  };

  if (fs.existsSync(AUTH_FILE)) {
    contextOptions.storageState = AUTH_FILE;
  }

  const context = await browser.newContext(contextOptions);
  return { browser, context };
}

export async function ensureLoggedIn(page) {
  const adminUrl = process.env.ADMIN_URL;
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const visiblePw = await page.locator('input[type="password"]:visible').count();

  if (visiblePw === 0) {
    console.log('✅ 既にログイン済み');
    await page.context().storageState({ path: AUTH_FILE }).catch(() => {});
    return;
  }

  console.log('🔑 ログイン処理開始');

  const idCandidates = [
    'input[name="login_id"]',
    'input[name="id"]',
    'input[name="user_id"]',
    'input[name="email"]',
    'input[name="mail"]',
    'input[type="email"]:visible',
    'input[type="text"]:visible',
  ];
  let idInput = null;
  for (const sel of idCandidates) {
    const el = page.locator(sel).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      idInput = el;
      break;
    }
  }
  if (!idInput) throw new Error('ID入力欄が見つかりません');

  const pwInput = page.locator('input[type="password"]:visible').first();

  await idInput.fill(process.env.ADMIN_LOGIN_ID);
  await pwInput.fill(process.env.ADMIN_PASSWORD);

  const submitBtn = page.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:has-text("ログイン"):visible, a:has-text("ログイン"):visible').first();
  await submitBtn.click();

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2500);

  if ((await page.locator('input[type="password"]:visible').count()) > 0) {
    throw new Error('ログイン失敗：パスワード入力欄が残っています。ID/PWを確認してください。');
  }

  await page.context().storageState({ path: AUTH_FILE });
  console.log('✅ ログイン成功 → auth.json 保存');
}
