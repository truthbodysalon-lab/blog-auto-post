/**
 * エキテン 日次自動投稿バッチ
 * 1日1本をクラウド（GitHub Actions）で自動投稿
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { generateEkitenArticle } from './ekiten-generate.js';
import { postToEkiten } from './ekiten-post.js';
import { recordSubtopicCovered } from './content-clusters.js';

const LOG_DIR  = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, `ekiten-${new Date().toISOString().slice(0, 10)}.jsonl`);

function writeLog(level, message, extra = {}) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const entry = { ts: new Date().toISOString(), level, message, ...extra };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  console.log(`[${level}] ${message}`);
}

async function main() {
  writeLog('INFO', '=== エキテン自動投稿 開始 ===');

  const required = ['EKITEN_EMAIL', 'EKITEN_PASSWORD', 'GEMINI_API_KEY'];
  for (const v of required) {
    if (!process.env[v]) {
      writeLog('ERROR', `環境変数 ${v} が未設定`);
      process.exit(1);
    }
  }

  // 記事生成
  let article;
  try {
    article = await generateEkitenArticle();
    writeLog('INFO', `記事生成完了: ${article.title}`, { kw: article.targetKw });
  } catch (e) {
    writeLog('ERROR', `記事生成失敗: ${e.message}`);
    process.exit(1);
  }

  // 投稿
  let result;
  try {
    result = await postToEkiten(article);
    if (result.success) {
      writeLog('INFO', `✅ 投稿成功: ${article.title}`);
      // クラスターカバレッジ記録
      if (article.subtopicId) {
        recordSubtopicCovered(article.clusterKey, article.subtopicId);
        writeLog('INFO', `クラスター記録: ${article.clusterKey}/${article.subtopicId}`);
      }
    } else if (result.dryRun) {
      writeLog('INFO', `🟡 DRY-RUN完了(お知らせ未公開): ${article.title}。公開するには EKITEN_LIVE=1 を設定`);
    } else {
      // 結果不明=非公開のまま終了した可能性が高い実質的な失敗。WARNログだけでexit 0
      // にすると「ジョブsuccess」表示に紛れて見落とされる(run 35821621616/35822178813)ため、
      // DRY-RUN(意図的な無投稿)とは区別してここだけ非ゼロ終了にする。
      writeLog('WARN', `⚠️ 投稿結果不明: ${result.url}`);
      writeLog('ERROR', '投稿結果が確認できなかったため異常終了します(DRY-RUNではない)');
      process.exit(1);
    }
  } catch (e) {
    writeLog('ERROR', `投稿失敗: ${e.message}`, { stack: e.stack?.slice(0, 300) });
    process.exit(1);
  }

  writeLog('INFO', '=== エキテン自動投稿 完了 ===');
}

main().catch(e => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});
