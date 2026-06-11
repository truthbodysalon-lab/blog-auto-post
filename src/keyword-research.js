/**
 * キーワードリサーチ オーケストレーター
 * 毎週日曜 18:30 に実行
 *
 * 1. Google オートコンプリート（ラッコキーワード相当）でサジェスト収集
 * 2. あらまきじゃけ で検索ボリューム確認
 * 3. Google Search Console で実際の流入クエリ取得
 * 4. スコアリングして keywords/cache.json に保存
 * 5. topics.js が毎日この cache を読んで高需要キーワードを優先使用
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fetchAutoCompleteKeywords, detectCoreSymptom } from './scrapers/autocomplete.js';
import { fetchAramakiVolumes } from './scrapers/aramaki.js';
import { fetchGSCQueries } from './scrapers/gsc.js';
import { writeLog } from './notify.js';

const CACHE_PATH = path.resolve('keywords/cache.json');
const CORE_SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正'];

// 必ずチェックするアンカーキーワード（市場規模の把握 + ボリューム基準値）
const ANCHOR_KEYWORDS = [
  // 肩こり
  '肩こり 整体', '肩こり 原因', '肩こり 解消',
  // 頭痛
  '頭痛 整体', '緊張型頭痛', '片頭痛 整体',
  // 姿勢
  '猫背 矯正 整体', '巻き肩 整体', '姿勢 改善',
  // 骨盤矯正
  '骨盤矯正 整体', '産後 骨盤矯正',
  // 地域
  '長岡市 整体', '新潟 整体 おすすめ',
];

// ボリューム確認する候補キーワードの選定
function selectVolumeCandidates(autocompleteResults, gscQueries) {
  const candidates = new Set();

  // ① 必ずチェックするアンカーキーワード（市場規模把握）
  ANCHOR_KEYWORDS.forEach(k => candidates.add(k));

  // ② オートコンプリートから「長岡市」「新潟」を含むローカルキーワードを症状ごと3件
  for (const core of CORE_SYMPTOMS) {
    autocompleteResults
      .filter(k => k.coreSymptom === core && (k.term.includes('長岡') || k.term.includes('新潟')))
      .slice(0, 3)
      .forEach(k => candidates.add(k.term));
  }

  // ③ GSCクエリのうち整体・症状関連（上位10件）
  gscQueries
    .filter(q => CORE_SYMPTOMS.some(s => q.query.includes(s)) || q.query.includes('整体') || q.query.includes('長岡'))
    .slice(0, 10)
    .forEach(q => candidates.add(q.query));

  return [...candidates];
}

// スコア計算（高いほど優先的に記事にする）
function calcScore({ volume = 0, gscImpressions = 0, gscClicks = 0, gscPosition = 99 }) {
  let score = 0;
  // 検索ボリュームが高い（あらまき）
  score += Math.min(volume / 10, 50);
  // GSCでインプレッションあり（実際に表示されている）
  score += Math.min(gscImpressions * 0.5, 30);
  // GSCでクリックあり（実際に来てる）
  score += gscClicks * 3;
  // 検索順位が低い（改善余地あり: 5〜20位は伸ばしやすい）
  if (gscPosition >= 5 && gscPosition <= 20) score += 20;
  if (gscPosition > 20 && gscPosition <= 50) score += 10;
  return Math.round(score);
}

// アンカーキーワードのボリュームから「症状ごとの市場規模スコア」を計算
function buildAnchorScores(volumeMap) {
  const anchorBySymptom = {
    '肩こり': ['肩こり 整体', '肩こり 原因', '肩こり 解消'],
    '頭痛': ['頭痛 整体', '緊張型頭痛', '片頭痛 整体'],
    '姿勢': ['猫背 矯正 整体', '巻き肩 整体', '姿勢 改善'],
    '骨盤矯正': ['骨盤矯正 整体', '産後 骨盤矯正'],
  };
  const scores = {};
  for (const [sym, anchors] of Object.entries(anchorBySymptom)) {
    const vols = anchors.map(a => volumeMap[a] || 0);
    const maxVol = Math.max(...vols);
    // 市場規模ボーナス: アンカーボリュームが大きい症状ほど+スコア（最大15点）
    scores[sym] = Math.min(Math.log10(maxVol + 1) * 3, 15);
  }
  return scores;
}

function buildCache(autocompleteResults, volumeMap, gscQueries) {
  const gscByQuery = Object.fromEntries(gscQueries.map(q => [q.query, q]));
  const anchorScores = buildAnchorScores(volumeMap);

  const allKeywords = [];

  // オートコンプリート結果をベースに統合
  for (const kw of autocompleteResults) {
    const volume = volumeMap[kw.term] ?? null;
    const gsc = gscByQuery[kw.term] || null;
    const marketBonus = anchorScores[kw.coreSymptom] || 0; // 市場規模ボーナス
    const score = Math.round(calcScore({
      volume: volume || 0,
      gscImpressions: gsc?.impressions || 0,
      gscClicks: gsc?.clicks || 0,
      gscPosition: gsc?.position || 99,
    }) + marketBonus);
    allKeywords.push({
      term: kw.term,
      coreSymptom: kw.coreSymptom,
      sources: [kw.source, ...(volume != null ? ['aramaki'] : []), ...(gsc ? ['gsc'] : [])],
      volume: volume ?? 0,
      gscClicks: gsc?.clicks || 0,
      gscImpressions: gsc?.impressions || 0,
      gscPosition: gsc?.position || null,
      score,
    });
  }

  // GSCのみのクエリ（オートコンプリートにない実流入クエリ）も追加
  for (const gsc of gscQueries) {
    if (allKeywords.some(k => k.term === gsc.query)) continue;
    const core = detectCoreSymptom(gsc.query);
    if (!core) continue;
    const score = calcScore({
      gscImpressions: gsc.impressions,
      gscClicks: gsc.clicks,
      gscPosition: gsc.position,
    });
    allKeywords.push({
      term: gsc.query,
      coreSymptom: core,
      sources: ['gsc'],
      volume: 0,
      gscClicks: gsc.clicks,
      gscImpressions: gsc.impressions,
      gscPosition: gsc.position,
      score,
    });
  }

  // 症状ごとにスコア降順で整理
  const bySymptom = {};
  for (const core of CORE_SYMPTOMS) {
    bySymptom[core] = allKeywords
      .filter(k => k.coreSymptom === core)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // 症状ごと上位20件
  }

  return {
    updatedAt: new Date().toISOString(),
    totalKeywords: allKeywords.length,
    bySymptom,
    gscQueries: gscQueries.slice(0, 50),
  };
}

async function main() {
  const start = Date.now();
  writeLog('INFO', '=== キーワードリサーチ 開始 ===');

  // ① Googleオートコンプリート（ラッコキーワード相当）
  console.log('\n【Step 1】Google オートコンプリート取得中...');
  let autocompleteResults = [];
  try {
    autocompleteResults = await fetchAutoCompleteKeywords();
    console.log(`✅ ${autocompleteResults.length}件のキーワード候補取得`);
    writeLog('INFO', `オートコンプリート完了: ${autocompleteResults.length}件`);
  } catch (e) {
    console.error('❌ オートコンプリートエラー:', e.message);
    writeLog('WARN', `オートコンプリートエラー: ${e.message}`);
  }

  // ② GSC（先に取得してボリューム確認候補の選定に使う）
  console.log('\n【Step 2】Google Search Console データ取得中...');
  let gscQueries = [];
  try {
    gscQueries = await fetchGSCQueries(90);
    console.log(`✅ ${gscQueries.length}件のGSCクエリ取得`);
    writeLog('INFO', `GSC完了: ${gscQueries.length}件`);
  } catch (e) {
    console.error('❌ GSCエラー:', e.message);
    writeLog('WARN', `GSCエラー: ${e.message}`);
  }

  // ③ あらまきじゃけ（ボリューム確認）
  console.log('\n【Step 3】あらまきじゃけ 検索ボリューム取得中...');
  const volumeCandidates = selectVolumeCandidates(autocompleteResults, gscQueries);
  console.log(`  → ${volumeCandidates.length}件のキーワードのボリュームを確認`);
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

  // ④ 統合・スコアリング・保存
  console.log('\n【Step 4】スコアリング・キャッシュ保存...');
  const cache = buildCache(autocompleteResults, volumeMap, gscQueries);

  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  // サマリー表示
  console.log('\n=== 症状別 TOP5 キーワード ===');
  for (const [symptom, kws] of Object.entries(cache.bySymptom)) {
    console.log(`\n【${symptom}】`);
    kws.slice(0, 5).forEach((k, i) => {
      const vol = k.volume ? `${k.volume.toLocaleString()}検索/月` : 'ボリュームデータなし';
      const gsc = k.gscImpressions ? ` / GSC ${k.gscImpressions}表示 ${k.gscClicks}クリック` : '';
      console.log(`  ${i + 1}. ${k.term} (スコア:${k.score} / ${vol}${gsc})`);
    });
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  writeLog('INFO', `=== キーワードリサーチ 完了 (${elapsed}秒) ===`);
  console.log(`\n✅ keywords/cache.json に保存完了 (${elapsed}秒)`);
}

main().catch(e => {
  writeLog('ERROR', `キーワードリサーチ 例外: ${e.message}`);
  console.error(e);
  process.exit(1);
});
