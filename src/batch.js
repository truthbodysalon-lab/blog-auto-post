import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getBrowserContext, ensureLoggedIn } from './login.js';
import { postBlog } from './post.js';
import { generateArticleForTopic } from './generate.js';
import { generateDailyTopics, appendHistory, recordTopicPosted } from './topics.js';
import { notify, notifySuccess, notifyError, notifyWarn, writeLog } from './notify.js';

const MAX_POST_RETRIES = 3;
const MAX_GEN_RETRIES = 2;

function formatPublishAt(hour, minute) {
  const pad = n => String(n).padStart(2, '0');
  const JST = 9 * 60 * 60 * 1000;
  const fmtJst = d => {
    // CMS expects JST; use getUTC* on a JST-shifted Date to avoid local-tz bugs
    const j = new Date(d.getTime() + JST);
    return `${j.getUTCFullYear()}/${pad(j.getUTCMonth()+1)}/${pad(j.getUTCDate())} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
  };
  // PUBLISH_NOW=true の場合は現在JST時刻の3分後を指定して即時公開
  if (process.env.PUBLISH_NOW === 'true') {
    return fmtJst(new Date(Date.now() + 3 * 60 * 1000));
  }
  // hour/minute はJST時刻 → UTC換算してDateオブジェクトを作る
  const nowUtc = Date.now();
  const todayJst = new Date(nowUtc + JST);
  const targetUtc = Date.UTC(
    todayJst.getUTCFullYear(), todayJst.getUTCMonth(), todayJst.getUTCDate(),
    hour - 9, minute, 0, 0
  );
  const target = new Date(targetUtc < nowUtc ? targetUtc + 86400000 : targetUtc);
  return fmtJst(target);
}

async function generateWithRetry(topic) {
  for (let attempt = 1; attempt <= MAX_GEN_RETRIES; attempt++) {
    try {
      return await generateArticleForTopic(topic);
    } catch (e) {
      writeLog('WARN', `記事生成失敗 (試行${attempt}/${MAX_GEN_RETRIES})`, { slot: topic.slot, error: e.message });
      if (attempt === MAX_GEN_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 6000 * attempt));
    }
  }
}

async function postWithRetry(page, article) {
  for (let attempt = 1; attempt <= MAX_POST_RETRIES; attempt++) {
    try {
      const result = await postBlog(page, article);
      if (result.urlChanged) return result;

      writeLog('WARN', `投稿後URLが変わらず (試行${attempt}/${MAX_POST_RETRIES})`, { title: article.title });
      if (attempt === MAX_POST_RETRIES) return { ...result, retryFailed: true };
      await new Promise(r => setTimeout(r, 12000)); // CMSの負荷回復待ち

      const retryUrl = new URL('newpages/simple-add/blog/', process.env.ADMIN_URL).href;
      await page.goto(retryUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
    } catch (e) {
      writeLog('WARN', `投稿例外 (試行${attempt}/${MAX_POST_RETRIES})`, { title: article.title, error: e.message });
      if (attempt === MAX_POST_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 12000)); // CMSの負荷回復待ち
      try {
        await page.goto(process.env.ADMIN_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
      } catch {}
    }
  }
}

const LOCK_FILE = path.resolve('logs', 'batch.lock');

function acquireLock() {
  const dir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 既存ロックがあれば生きているプロセスか確認
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      // プロセスが生きていれば実行中と判断
      process.kill(pid, 0);
      return false; // 実行中
    } catch {
      // プロセスが死んでいれば古いロックを削除
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  return true;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function checkAlreadyRan() {
  if (process.env.FORCE === 'true') return false;
  const d = new Date().toISOString().slice(0, 10);
  const logPath = path.resolve('logs', `${d}.jsonl`);
  if (!fs.existsSync(logPath)) return false;
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  // 「終了:」まで書かれていれば完了済み
  return lines.some(l => {
    try { return JSON.parse(l).message?.includes('=== 終了:'); } catch { return false; }
  });
}

async function main() {
  const startTime = Date.now();

  // ロック取得（他プロセスが実行中なら即終了）
  if (!acquireLock()) {
    console.log('⏭️  [SKIP] 他のバッチプロセスが実行中です。');
    process.exit(0);
  }
  process.on('exit', releaseLock);
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

  // 完了済みチェック
  if (checkAlreadyRan()) {
    console.log('⏭️  [SKIP] 本日はすでに完了済みです。（強制実行: FORCE=true）');
    process.exit(0);
  }

  writeLog('INFO', '=== ブログ自動投稿 開始 ===');

  const required = ['ADMIN_URL', 'ADMIN_LOGIN_ID', 'ADMIN_PASSWORD', 'GEMINI_API_KEY'];
  for (const v of required) {
    if (!process.env[v]) {
      await notifyError(`.env に ${v} が未設定`);
      process.exit(1);
    }
  }

  const count = parseInt(process.env.POST_COUNT || '10', 10);
  const startSlot = parseInt(process.env.START_SLOT || '1', 10);
  const topics = generateDailyTopics(count);
  const targetTopics = topics.slice(startSlot - 1);

  writeLog('INFO', `本日の投稿計画: ${targetTopics.length}件`);
  targetTopics.forEach(t => {
    t.publishAt = formatPublishAt(t.publishHour, t.publishMinute);
    writeLog('INFO', `  Slot${t.slot}: ${t.publishAt} | ${t.symptom} × ${t.angle}`);
  });

  const articles = [];
  const genFailed = [];

  for (const topic of targetTopics) {
    try {
      const article = await generateWithRetry(topic);
      // topic情報を保持（クラスターカバレッジ記録用）
      article._topic = { coreSymptom: topic.coreSymptom, subtopicId: topic.subtopicId };
      articles.push(article);
      const dir = path.resolve('posts');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(dir, `slot${topic.slot}-${stamp}.json`), JSON.stringify(article, null, 2));
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      genFailed.push(topic.slot);
      await notifyError(`slot${topic.slot} 記事生成失敗`, { error: e.message });
    }
  }

  if (!articles.length) {
    await notifyError('記事生成が全件失敗。投稿を中止します。');
    process.exit(1);
  }

  if (genFailed.length > 0) {
    await notifyWarn(`${genFailed.length}件の記事生成失敗 (slot: ${genFailed.join(', ')})。残り${articles.length}件で続行。`);
  }

  const { browser, context } = await getBrowserContext();
  const page = await context.newPage();
  let success = 0;
  let failed = 0;
  const failedTitles = [];

  try {
    await ensureLoggedIn(page);
    writeLog('INFO', 'ログイン成功 → 投稿開始');

    for (const article of articles) {
      try {
        const result = await postWithRetry(page, article);
        if (result?.urlChanged && !result?.retryFailed) {
          success++;
          appendHistory({ title: article.title, category: article.category, publishAt: article.publishAt });
          recordTopicPosted(article._topic || {});
          writeLog('INFO', `投稿成功: ${article.title}`, { publishAt: article.publishAt });
        } else {
          failed++;
          failedTitles.push(article.title);
          writeLog('ERROR', `投稿失敗（リトライ上限）: ${article.title}`);
        }
        await new Promise(r => setTimeout(r, 4000)); // 投稿間隔: CMS負荷分散
      } catch (e) {
        failed++;
        failedTitles.push(article.title);
        writeLog('ERROR', `投稿例外: ${article.title}`, { error: e.message });
        const shot = `debug-error-${Date.now()}.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        writeLog('WARN', `エラースクショ保存: ${shot}`);
      }
    }
  } catch (e) {
    await notifyError(`ブラウザ操作で致命的エラー: ${e.message}`);
  } finally {
    if (process.env.MODE === 'debug') await page.waitForTimeout(10000).catch(() => {});
    await browser.close().catch(() => {});
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const summary = `投稿完了 ✅${success}件 / ❌${failed}件 (${elapsed}秒)`;
  writeLog('INFO', `=== 終了: ${summary} ===`);

  if (failed === 0) {
    await notifySuccess(`ブログ自動投稿 ${summary}`);
  } else if (success > 0) {
    await notifyWarn(`ブログ自動投稿 ${summary}\n失敗: ${failedTitles.join(' / ')}`);
  } else {
    await notifyError(`ブログ自動投稿 全件失敗 (${failed}件)`);
  }
}

main().catch(async err => {
  writeLog('ERROR', `致命的エラー: ${err.message}`, { stack: err.stack?.slice(0, 500) });
  await notifyError(`致命的エラー: ${err.message}`).catch(() => {});
  process.exit(1);
});
