/**
 * あらまきじゃけ スクレイパー
 * キーワードの月間検索数推定値を取得
 */
import { chromium } from 'playwright';

// ボリューム確認するキーワードの最大件数（サーバー負荷配慮）
const MAX_KEYWORDS = 25;

// 数値文字列を整数に変換（"1,200" → 1200）
function parseVolume(text) {
  const match = text.replace(/,/g, '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export async function fetchAramakiVolumes(keywords) {
  const targets = keywords.slice(0, MAX_KEYWORDS);
  const results = {};

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    for (const kw of targets) {
      try {
        console.log(`  📊 あらまきじゃけ: "${kw}"`);
        await page.goto('https://aramakijake.jp/', { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(800);

        await page.fill('input[name="keyword"]', kw);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3500); // AJAX完了待ち

        const volume = await page.evaluate(() => {
          // 結果エリアから数値を取得
          const resultWrap = document.querySelector('.result_wrap, .result, #result');
          if (!resultWrap) return null;

          const text = resultWrap.textContent;
          if (text.includes('データが見つかりませんでした') || text.includes('見つかりません')) return 0;

          // "月間推定検索数" に続く数値を探す
          const numMatch = text.match(/(\d[\d,]+)/);
          return numMatch ? parseInt(numMatch[1].replace(/,/g, ''), 10) : null;
        });

        results[kw] = volume ?? 0;
        console.log(`    → ${volume !== null ? volume.toLocaleString() + ' 件/月' : 'N/A'}`);
        await new Promise(r => setTimeout(r, 2000)); // サーバー負荷配慮
      } catch (e) {
        console.warn(`    ⚠️ あらまきエラー [${kw}]: ${e.message.slice(0, 60)}`);
        results[kw] = 0;
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
