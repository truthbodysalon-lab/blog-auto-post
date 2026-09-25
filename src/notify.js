import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve('logs');
const DISCORD_TIMEOUT_MS = 10000;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function todayLogPath() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.jsonl`);
}

export function writeLog(level, message, data = {}) {
  ensureLogDir();
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  fs.appendFileSync(todayLogPath(), JSON.stringify(entry) + '\n', 'utf8');
  const prefix = { INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || 'ℹ️';
  console.log(`${prefix} [${level}] ${message}`, Object.keys(data).length ? data : '');
}

// Discord Webhookへ通知を送る。
// - DISCORD_WEBHOOK_URL 未設定なら何もせず正常に戻る（例外を投げない）
// - 送信は必ずタイムアウト付き（ハングして投稿処理全体が止まる事故を防ぐ）
// - 送信失敗は握りつぶしログのみ。通知失敗で投稿処理そのものを壊さない
// - Webhook URLはログ・コンソールに一切出力しない（Publicリポジトリのため）
async function sendDiscord(content) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1900) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      writeLog('WARN', `Discord通知失敗 (HTTP ${res.status})`);
    }
  } catch (e) {
    writeLog('WARN', `Discord通知失敗: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function notifySuccess(message, data = {}) {
  writeLog('INFO', message, data);
}

export async function notifyError(message, data = {}) {
  writeLog('ERROR', message, data);
  await sendDiscord(`❌ ${message}`);
}

export async function notifyWarn(message, data = {}) {
  writeLog('WARN', message, data);
  await sendDiscord(`⚠️ ${message}`);
}

export async function notifyLineSummary(_message) {
  // 通知なし（ログのみ）
}

// 後方互換
export async function notify(message) {
  const isError = message.startsWith('❌') || message.startsWith('💥');
  writeLog(isError ? 'ERROR' : 'INFO', message);
  if (isError) await sendDiscord(message);
}
