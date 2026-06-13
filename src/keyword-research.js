/**
 * キーワードリサーチ オーケストレーター
 *
 * 1. ラッコキーワード相当（Google Autocomplete）でサジェスト収集
 *    ターゲット: 「長岡市」「整体」「肩こり」「頭痛」で上位表示
 * 2. あらまきじゃけ で検索ボリューム確認
 * 3. スコアリングして keywords/cache.json に保存
 * 4. topics.js が毎日この cache を読んで高需要キーワードを優先使用
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fetchAutoCompleteKeywords, detectCoreSymptom } from './scrapers/autocomplete.js';
import { fetchAramakiVolumes } from './scrapers/aramaki.js';
import { writeLog } from './notify.js';

const CACHE_PATH = path.resolve('keywords/cache.json');
const CORE_SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正'];

const ANCHOR_KEYWORDS = [
  '長岡市 整体',
  '長岡市 肩こり 整体',
  '長岡市 頭痛 整体',
  '長岡市 肩こり',
  '長岡市 頭痛',
  '新潟 肩こり 整体',
  '新潟 頭痛 整体',
  '肩こり 整体',
  '頭痛 整体',
  '緊張型頭痛',
  '片頭痛 整体',
  '猫背 矯正 整体',
  '骨盤矯正 整体',
  '産後 骨盤矯正',
];

function selectVolumeCandidates(autocompleteResults) {
  const candidates = new Set();
  ANCHOR_KEYWORDS.forEach(k => candidates.add(k));
  for (const core of CORE_SYMPTOMS) {
    autocompleteResults.filter(k => k.coreSymptom === core && k.isLocal).slice(0, 5).forEach(k => candidates.add(k.term));
    autocompleteResults.filter(k => k.coreSymptom === core && k.isTarget && !k.isLocal).slice(0, 3).forEach(k => candidates.add(k.term));
  }
  return [...candidates];
}

function calcScore({ volume = 0, isLocal = false, isTarget = false, priority = 1 }) {
  let score = 0;
  score += Math.min(volume / 10, 50);
  if (isLocal) score += 25;
  if (isTarget) score += 15;
  score += priority * 2;
  return Math.round(score);
}

function buildCache(autocompleteResults, volumeMap) {
  const allKeywords = [];

  for (const kw of autocompleteResults) {
    const volume = volumeMap[kw.term] ?? 0;
    const score = calcScore({ volume, isLocal: kw.isLocal, isTarget: kw.isTarget, priority: kw.priority || 1 });
    allKeywords.push({ term: kw.term, coreSymptom: kw.coreSymptom, sources: [kw.source, ...(volume > 0 ? ['aramaki'] : [])], volume, isLocal: kw.isLocal || false, isTarget: kw.isTarget || false, score });
  }

  for (const anchor of ANCHOR_KEYWORDS) {
    if (allKeywords.some(k => k.term === anchor)) continue;
    const volume = volumeMap[anchor] ?? 0;
    const core = detectCoreSymptom(anchor) || '肩こり';
    const isLocal = anchor.includes('長岡') || anchor.includes('新潟');
    const isTarget = ['整体', '肩こり', '頭痛'].some(t => anchor.includes(t));
    allKeywords.push({ term: anchor, coreSymptom: core, sources: ['anchor', ...(volume > 0 ? ['aramaki'] : [])], volume, isLocal, isTarget, score: calcScore({ volume, isLocal, isTarget, priority: 8 }) });
  }

  const bySymptom = {};
  for (const core of CORE_SYMPTOMS) {
    bySymptom[core] = allKeywords.filter(k => k.coreSymptom === core).sort((a, b) => b.score - a.score).slice(0, 20);
  }

  return { updatedAt: new Date().toISOString(), totalKeywords: allKeywords.length, bySymptom };
}

async function main() {
  const start = Date.now();
  writeLog('INFO', '=== キーワードリサーチ 開始 ===');

  console.log('\n【Step 1】ラッコキーワード相当 — Google Autocomplete 取得中...');
  let autocompleteResults = [];
  try {
    autocompleteResults = await fetchAutoCompleteKeywords();
    const localCount = autocompleteResults.filter(k => k.isLocal).length;
    console.log(`✅ ${autocompleteResults.length}件取得 (地域キーワード: ${localCount}件)`);
    writeLog('INFO', `オートコンプリート完了: ${autocompleteResults.length}件`);
  } catch (e) {
    console.error('❌ オートコンプリートエラー:', e.message);
    writeLog('WARN', `オートコンプリートエラー: ${e.message}`);
  }

  console.log('\n【Step 2】あらまきじゃけ — 検索ボリューム確認中...');
  const volumeCandidates = selectVolumeCandidates(autocompleteResults);
  console.log(`  → ${volumeCandidates.length}件を確認`);
  let volumeMap = {};
  try {
    volumeMap = await fetchAramakiVolumes(volumeCandidates);
    const found = Object.values(volumeMap).filter(v => v > 0).length;
    console.log(`✅ ボリューム確認完了 (データあり: ${found}件)`);
    writeLog('INFO', `あらまき完了: ${found}件にデータあり`);
  } catch (e) {
    console.error('❌ あらまきエラー:', e.message);
    writeLog('WARN', `あらまきエラー: ${e.message}`);
  }

  console.log('\n【Step 3】スコアリング・キャッシュ保存...');
  const cache = buildCache(autocompleteResults, volumeMap);

  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  console.log('\n=== 症状別 TOP キーワード（長岡市・整体・肩こり・頭痛 優先） ===');
  for (const [symptom, kws] of Object.entries(cache.bySymptom)) {
    console.log(`\n【${symptom}】`);
    kws.slice(0, 6).forEach((k, i) => {
      const vol = k.volume > 0 ? `${k.volume.toLocaleString()}検索/月` : '-';
      const local = k.isLocal ? '📍' : '  ';
      console.log(`  ${i + 1}. ${local}${k.term} (スコア:${k.score} / ${vol})`);
    });
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  writeLog('INFO', `=== キーワードリサーチ 完了 (${elapsed}秒) ===`);
  console.log(`\n✅ keywords/cache.json 保存完了 (${elapsed}秒)`);
}

main().catch(e => { writeLog('ERROR', `キーワードリサーチ 例外: ${e.message}`); console.error(e); process.exit(1); });
