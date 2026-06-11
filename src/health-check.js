import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { writeLog } from './notify.js';

const LOCK_FILE = path.resolve('logs', 'batch.lock');

function readTodayLog() {
  const d = new Date().toISOString().slice(0, 10);
  const logPath = path.resolve('logs', `${d}.jsonl`);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function isBatchRunning() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    process.kill(pid, 0); // 存在確認（シグナル送信なし）
    return true;
  } catch {
    fs.unlinkSync(LOCK_FILE); // 死んでいれば掃除
    return false;
  }
}

function runBatch(force = false) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (force) env.FORCE = 'true';

    const child = spawn(process.execPath, [path.resolve('src/batch.js')], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      writeLog(code === 0 ? 'INFO' : 'ERROR', `【リカバリー】バッチ終了 exit=${code}`);
      resolve(code);
    });

    child.on('error', (err) => {
      writeLog('ERROR', `【リカバリー】起動失敗: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  writeLog('INFO', '=== ヘルスチェック 開始 ===');

  // バッチが現在実行中なら何もしない
  if (isBatchRunning()) {
    writeLog('INFO', '=== バッチ実行中のためスキップ ===');
    return;
  }

  const logs = readTodayLog();
  const hasCompleted = logs.some(l => l.message?.includes('=== 終了:'));
  const hasStarted = logs.some(l => l.message?.includes('ブログ自動投稿 開始'));
  const successes = logs.filter(l => l.level === 'INFO' && l.message?.includes('投稿成功')).length;

  if (!hasStarted) {
    // 未実行 → 実行
    writeLog('WARN', '【リカバリー】本日未実行 → バッチ起動');
    await runBatch(false);
  } else if (hasCompleted && successes === 0) {
    // 完了したが投稿ゼロ → 強制再実行
    writeLog('WARN', `【リカバリー】完了済みだが投稿0件 → 強制再実行`);
    await runBatch(true);
  } else if (!hasCompleted) {
    // 開始はされたが完了していない（途中でクラッシュ） → 強制再実行
    writeLog('WARN', '【リカバリー】バッチが途中で停止 → 強制再実行');
    await runBatch(true);
  } else {
    writeLog('INFO', `=== ヘルスチェック 正常: ${successes}件投稿済み ===`);
  }
}

main().catch(err => {
  writeLog('ERROR', `ヘルスチェック例外: ${err.message}`);
  process.exit(1);
});
