import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getBrowserContext, ensureLoggedIn } from './login.js';
import { postBlog } from './post.js';
import { generateArticle } from './generate.js';
import { notify } from './notify.js';

async function main() {
  const requiredVars = ['ADMIN_URL', 'ADMIN_LOGIN_ID', 'ADMIN_PASSWORD', 'GEMINI_API_KEY'];
  for (const v of requiredVars) {
    if (!process.env[v]) {
      console.error(`❌ .env に ${v} が設定されていません`);
      process.exit(1);
    }
  }

  let article;
  try {
    article = await generateArticle();

    const dir = path.resolve('posts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(article, null, 2));
  } catch (e) {
    await notify(`❌ 記事生成失敗: ${e.message}`);
    throw e;
  }

  const { browser, context } = await getBrowserContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);
    const result = await postBlog(page, article);
    await notify(`✅ ブログ投稿完了: ${article.title}\nカテゴリ: ${article.category}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const shotPath = `debug-error-${Date.now()}.png`;
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    await notify(`❌ 投稿失敗: ${e.message}\nスクショ: ${shotPath}`);
    throw e;
  } finally {
    if (process.env.MODE === 'debug') {
      console.log('🟡 デバッグモード: ブラウザを10秒後に閉じます');
      await page.waitForTimeout(10000);
    }
    await browser.close();
  }
}

main().catch(err => {
  console.error('💥 エラー:', err);
  process.exit(1);
});
