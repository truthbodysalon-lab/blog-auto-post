import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve('logs');

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

export async function notifySuccess(message, data = {}) {
  writeLog('INFO', message, data);
}

export async function notifyError(message, data = {}) {
  writeLog('ERROR', message, data);
}

export async function notifyWarn(message, data = {}) {
  writeLog('WARN', message, data);
}

export async function notifyLineSummary(_message) {
  // 通知なし（ログのみ）
}

// 後方互換
export async function notify(message) {
  const isError = message.startsWith('❌') || message.startsWith('💥');
  writeLog(isError ? 'ERROR' : 'INFO', message);
}
