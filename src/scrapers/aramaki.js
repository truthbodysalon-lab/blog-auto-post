/**
 * あらまきじゃけ スクレイパー
 * キーワードの月間Google検索数推定値を取得
 * URL直接アクセス方式（フォーム送信より安定）
 */
import { chromium } from 'playwright';

const MAX_KEYWORDS = 25;
const BASE_URL = 'https://aramakijake.jp/keyword/index.php';

function parseVolume(text) {
  const match = text.replace(/,/g, '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export async function fetchAramakiVolumes(keywords) {
  const targets = keywords.slice(0, MAX_KEYWORDS);
  const results = {};

  const mode = process.env.MODE === 'headless' ? true : false;
  const launchOptions = { headless: mode };
  // GitHub Actions: apt経由Chromiumのパスを使用（CDNダウンロード不要・ハング防止）
  if (process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    for (const kw of targets) {
      try {
        console.log(`  📊 あらまきじゃけ: "${kw}"`);
        const url = `${BASE_URL}?keyword=${encodeURIComponent(kw)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // 結果エリアが表示されるまで待機（最大8秒）
        await page.waitForSelector('#retrievals, .result_area, #result-left', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const volume = await page.evaluate(() => {
          // 方法1: #retrievals 内のGoogle検索数
          const retrievals = document.querySelector('#retrievals');
          if (retrievals) {
            const text = retrievals.textContent || '';
            if (text.includes('見つかりません') || text.includes('データなし')) return 0;
            // sp_type内の数値（Google/Yahoo両方あるので最初のを使用）
            const spans = retrievals.querySelectorAll('.sp_type span, span');
            for (const span of spans) {
              const num = span.textContent.replace(/,/g, '').trim();
              if (/^\d+$/.test(num) && parseInt(num) > 0) return parseInt(num);
            }
          }

          // 方法2: result-left-table からGoogleの1位数値
          const table = document.querySelector('#result-left-table');
          if (table) {
            const googleCells = table.querySelectorAll('.result-google');
            if (googleCells.length > 0) {
              const num = googleCells[0].textContent.replace(/,/g, '').trim();
              if (/^\d+$/.test(num)) return parseInt(num);
            }
          }

          // 方法3: ページ全体から数値パターンを探す
          const body = document.body?.textContent || '';
          const match = body.match(/月間.*?(\d[\d,]+)/);
          if (match) return parseInt(match[1].replace(/,/g, ''), 10);

          return 0;
        });

        results[kw] = volume ?? 0;
        const label = volume > 0 ? `${volume.toLocaleString()} 件/月` : 'N/A';
        console.log(`    → ${label}`);
        await new Promise(r => setTimeout(r, 2500)); // サーバー負荷配慮
      } catch (e) {
        console.warn(`    ⚠️ あらまきエラー [${kw}]: ${e.message.slice(0, 80)}`);
        results[kw] = 0;
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}
