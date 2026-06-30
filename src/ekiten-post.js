/**
 * エキテン ブログ自動投稿
 * - ログイン → ブログ新規投稿 → 公開
 * - EKITEN_EMAIL / EKITEN_PASSWORD 環境変数が必要
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const LOGIN_URL  = 'https://www.ekiten.jp/login/';
const MYPAGE_URL = 'https://www.ekiten.jp/mypage/';

// デバッグスクショ保存
async function shot(page, label) {
  const p = `debug-ekiten-${label}-${Date.now()}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  console.log(`📸 ${p}`);
}

export async function ekitenLogin(page) {
  console.log('🔑 エキテン ログイン開始...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot(page, '01-login-page');

  // メールアドレス/パスワードのフォームを探す
  // エキテンはSPAなのでボタンをクリックして展開する可能性がある

  // 「メールアドレスでログイン」ボタンを探す
  const emailTabSelectors = [
    'button:has-text("メールアドレス")',
    'a:has-text("メールアドレス")',
    '[data-testid="email-login"]',
    'button:has-text("メール")',
  ];
  for (const sel of emailTabSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1500);
      console.log(`✅ メールログインタブをクリック: ${sel}`);
      break;
    }
  }
  await shot(page, '02-after-tab-click');

  // メールアドレス入力欄を探す
  // 実際のエキテンログイン欄は <input type="text" name="mailaddress">（type=emailでもidでもない）
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="mailaddress"]',
    'input[name*="mail"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="メール"]',
    'input[id*="email"]',
    'input[id*="mail"]',
  ];
  let emailInput = null;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      emailInput = el;
      console.log(`✅ メール入力欄: ${sel}`);
      break;
    }
  }
  // フォールバック: 上記で見つからなければ「password以外の最初の可視テキスト入力」を採用
  // （サイトの属性変更に強くするための保険）
  if (!emailInput) {
    const candidate = page.locator(
      'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])'
    ).first();
    if (await candidate.count() > 0 && await candidate.isVisible().catch(() => false)) {
      emailInput = candidate;
      console.log('✅ メール入力欄: フォールバック(password以外の最初の可視input)');
    }
  }
  if (!emailInput) {
    await shot(page, 'ERROR-no-email-input');
    throw new Error('メールアドレス入力欄が見つかりません');
  }

  // パスワード入力欄
  const pwInput = page.locator('input[type="password"]').first();
  if (!(await pwInput.count())) {
    await shot(page, 'ERROR-no-password-input');
    throw new Error('パスワード入力欄が見つかりません');
  }

  await emailInput.fill(process.env.EKITEN_EMAIL);
  await pwInput.fill(process.env.EKITEN_PASSWORD);
  await shot(page, '03-filled');

  // ログインボタンをクリック
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("ログイン")',
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      await el.click();
      submitted = true;
      console.log(`✅ ログインボタンクリック: ${sel}`);
      break;
    }
  }
  if (!submitted) throw new Error('ログインボタンが見つかりません');

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '04-after-login');

  // ログイン確認
  const currentUrl = page.url();
  console.log(`ログイン後URL: ${currentUrl}`);
  if (currentUrl.includes('/login')) {
    await shot(page, 'ERROR-login-failed');
    throw new Error(`ログイン失敗: ${currentUrl}`);
  }
  // URLが遷移しても 403/404/エラーページが返る場合があるため本文も確認
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/40[34]\s*(Forbidden|Not Found)|アクセスできない|見つかりませんでした/.test(bodyText)) {
    await shot(page, 'ERROR-login-blocked');
    throw new Error(`ログイン後にブロックページ検出 (${currentUrl}): ${bodyText.slice(0, 80)}`);
  }
  console.log('✅ ログイン成功');
}

export async function findBlogPostUrl(page) {
  console.log('🔍 お知らせ投稿URLを探索中...');
  // エキテンに「ブログ」機能は存在しない。オーナーが記事を公開できるのは
  // 「お知らせ配信」= https://www.ekiten.jp/shop_<id>/info/ （= 実質のブログ）。
  // ログイン後URLからショップIDを抽出して info ページを導出する。
  const m = page.url().match(/shop_(\d+)/);
  const shopId = m ? m[1] : null;
  if (!shopId) {
    await shot(page, 'ERROR-no-shopid');
    throw new Error(`ショップIDが特定できません: ${page.url()}`);
  }
  const infoUrl = `https://www.ekiten.jp/shop_${shopId}/info/`;
  console.log(`📰 お知らせ配信ページ: ${infoUrl}`);

  // 読み取り専用の診断: お知らせページのフォーム/入力欄/ボタンをダンプ（送信はしない）
  if (process.env.EKITEN_DISCOVER === '1') {
    await page.goto(infoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, '05-info-page');
    const inputs = await page.locator('input, textarea, [contenteditable="true"]').evaluateAll(
      els => els.map(e => ({
        tag: e.tagName.toLowerCase(), type: e.getAttribute('type'),
        name: e.getAttribute('name'), id: e.id,
        ph: e.getAttribute('placeholder'), cls: (e.className || '').slice(0, 30),
        visible: !!(e.offsetParent),
      }))
    );
    console.log('診断[info] 入力欄:', JSON.stringify(inputs));
    const btns = await page.locator('button, input[type="submit"], a[role="button"], [role="button"]').evaluateAll(
      els => els.map(e => ({ t: (e.innerText || e.value || '').trim().slice(0, 24), h: e.getAttribute('href') }))
        .filter(b => b.t)
    );
    console.log('診断[info] ボタン:', JSON.stringify(btns.slice(0, 40)));
    throw new Error('DISCOVERモード: お知らせフォーム診断のみ実行（投稿はしていません）');
  }

  return infoUrl;
}

export async function postToEkiten(article) {
  const launchOptions = {
    headless: process.env.MODE !== 'debug',
    slowMo: process.env.MODE === 'debug' ? 200 : 0,
  };
  if (process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
    // 既定の HeadlessChrome UA はWAFに403で弾かれるため、実ブラウザ相当のUAを明示
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
  });
  const page = await context.newPage();

  try {
    await ekitenLogin(page);
    const blogUrl = await findBlogPostUrl(page);
    console.log(`📝 ブログ投稿URL: ${blogUrl}`);

    await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await shot(page, '06-blog-form');

    // タイトル入力
    const titleSelectors = [
      'input[name="title"]',
      'input[placeholder*="タイトル"]',
      'input[id*="title"]',
      '#blog_title',
      'input[type="text"]',
    ];
    let titleInput = null;
    for (const sel of titleSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        titleInput = el;
        console.log(`✅ タイトル入力欄: ${sel}`);
        break;
      }
    }
    if (!titleInput) throw new Error('タイトル入力欄が見つかりません');
    await titleInput.fill(article.title);

    // 本文入力
    const bodySelectors = [
      'textarea[name="body"]',
      'textarea[name="content"]',
      'textarea[id*="body"]',
      'textarea[id*="content"]',
      '#blog_body',
      '.ql-editor',        // Quill editor
      '[contenteditable="true"]',
      'textarea',
    ];
    let bodyInput = null;
    for (const sel of bodySelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        bodyInput = el;
        console.log(`✅ 本文入力欄: ${sel}`);
        break;
      }
    }
    if (!bodyInput) throw new Error('本文入力欄が見つかりません');

    // プレーンテキストで投稿（HTMLタグを除去）
    const plainBody = article.bodyText || article.bodyHtml
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim();

    await bodyInput.fill(plainBody);
    await shot(page, '07-filled-form');

    // 投稿ボタン
    const submitSelectors = [
      'button:has-text("投稿")',
      'button:has-text("公開")',
      'button:has-text("保存")',
      'input[value="投稿"]',
      'input[value="公開"]',
      'button[type="submit"]',
    ];
    let postBtn = null;
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        postBtn = el;
        console.log(`✅ 投稿ボタン: ${sel}`);
        break;
      }
    }
    if (!postBtn) throw new Error('投稿ボタンが見つかりません');

    const beforeUrl = page.url();
    await postBtn.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, '08-after-post');

    const afterUrl = page.url();
    const success = afterUrl !== beforeUrl || (await page.locator(':has-text("投稿しました"), :has-text("公開しました"), :has-text("保存しました")').count() > 0);

    if (success) {
      console.log(`✅ エキテン投稿完了: ${article.title}`);
      return { success: true, url: afterUrl };
    } else {
      await shot(page, 'ERROR-post-uncertain');
      console.warn(`⚠️ 投稿結果不明 (URL変化なし): ${afterUrl}`);
      return { success: false, url: afterUrl };
    }

  } finally {
    if (process.env.MODE === 'debug') await page.waitForTimeout(10000).catch(() => {});
    await browser.close().catch(() => {});
  }
}
