/**
 * 週次SEO監査
 * - クラスターカバレッジ分析
 * - 未カバーキーワードの優先度付け
 * - Geminiによるトレンド調査
 * - content-strategy.json の更新
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CONTENT_CLUSTERS, getClusterProgress, loadClusterCoverage } from './content-clusters.js';

const STRATEGY_FILE = path.resolve('content-strategy.json');
const RANKINGS_DIR = path.resolve('rankings');
const HISTORY_FILE = path.resolve('posts/history.json');

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch { return []; }
}

function loadCurrentStrategy() {
  try {
    if (!fs.existsSync(STRATEGY_FILE)) return {};
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'));
  } catch { return {}; }
}

async function callGemini(prompt, retries = 3) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  });

  for (let i = 1; i <= retries; i++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text()
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      return JSON.parse(text);
    } catch (e) {
      const isRetryable = e.message?.includes('429') || e.message?.includes('503');
      if (isRetryable && i < retries) {
        const wait = [20000, 40000, 60000][i - 1];
        console.log(`⏳ Gemini待機 (${i}/${retries}) ${wait / 1000}秒...`);
        await new Promise(r => setTimeout(r, wait));
      } else throw e;
    }
  }
}

// 過去投稿のパターン分析
function analyzeHistory(history) {
  const angleCounts = {};
  const symptomCounts = {};
  const titlePatterns = [];

  for (const h of history.slice(-100)) {
    const title = h.title || '';
    // タイトルパターン抽出
    if (title.includes('原因')) angleCounts['原因解説'] = (angleCounts['原因解説'] || 0) + 1;
    if (title.includes('セルフケア') || title.includes('ストレッチ')) angleCounts['セルフケア'] = (angleCounts['セルフケア'] || 0) + 1;
    if (title.includes('Q&A') || title.includes('よくある')) angleCounts['Q&A形式'] = (angleCounts['Q&A形式'] || 0) + 1;
    if (title.includes('事例') || title.includes('体験')) angleCounts['事例ストーリー'] = (angleCounts['事例ストーリー'] || 0) + 1;

    if (title.includes('肩こり')) symptomCounts['肩こり'] = (symptomCounts['肩こり'] || 0) + 1;
    if (title.includes('頭痛')) symptomCounts['頭痛'] = (symptomCounts['頭痛'] || 0) + 1;
    if (title.includes('姿勢') || title.includes('猫背')) symptomCounts['姿勢'] = (symptomCounts['姿勢'] || 0) + 1;
    if (title.includes('骨盤')) symptomCounts['骨盤矯正'] = (symptomCounts['骨盤矯正'] || 0) + 1;
  }

  // 過使用パターン（5回以上で「過使用」判定）
  const overusedAngles = Object.entries(angleCounts)
    .filter(([, n]) => n >= 5)
    .map(([name]) => name);

  const underusedAngles = [
    '原因解説', 'セルフケア', '失敗談・落とし穴', '比較', 'Q&A形式',
    '事例ストーリー', '季節・天候の影響', 'ライフスタイル別', '解剖学解説', '来店誘導',
  ].filter(a => (angleCounts[a] || 0) < 3);

  return { angleCounts, symptomCounts, overusedAngles, underusedAngles };
}

// クラスターギャップ分析
function analyzeClusterGaps() {
  const progress = getClusterProgress();
  const priorityTargets = [];

  for (const [symptom, data] of Object.entries(progress)) {
    // カバレッジが低いクラスターほど優先度が高い
    const priority = 100 - data.pct;
    if (data.nextTarget) {
      priorityTargets.push({
        symptom,
        keyword: data.nextTarget.keyword,
        theme: data.nextTarget.theme,
        id: data.nextTarget.id,
        priority,
        coveragePct: data.pct,
        totalPosts: data.totalPosts,
      });
    }
  }

  return priorityTargets.sort((a, b) => b.priority - a.priority);
}

// Geminiでトレンドと競合調査
async function researchTrends(gaps) {
  const month = new Date().getMonth() + 1;
  const topGaps = gaps.slice(0, 8).map(g => g.keyword).join('、');

  console.log('🤖 Geminiでトレンド調査中...');

  const prompt = `
あなたはSEOコンサルタントです。長岡市（新潟県・人口26万人）の整体院「整体院トゥルース」のブログSEO戦略を分析してください。

## 分析対象のターゲットキーワード
${topGaps}

## 月: ${month}月

## 質問
以下をJSON形式で回答してください:
1. 各症状（肩こり/頭痛/姿勢/骨盤矯正）で、${month}月に検索数が増えるトレンドキーワード（各3個）
2. Googleの「People Also Ask」によく出る関連質問（各症状2個ずつ）
3. 「長岡市 整体」で1位を狙うために、今月優先すべき記事テーマ上位5個

{
  "trendingTopics": {
    "肩こり": ["キーワード1", "キーワード2", "キーワード3"],
    "頭痛": ["キーワード1", "キーワード2", "キーワード3"],
    "姿勢": ["キーワード1", "キーワード2", "キーワード3"],
    "骨盤矯正": ["キーワード1", "キーワード2", "キーワード3"]
  },
  "peopleAlsoAsk": {
    "肩こり": ["質問1？", "質問2？"],
    "頭痛": ["質問1？", "質問2？"],
    "姿勢": ["質問1？", "質問2？"],
    "骨盤矯正": ["質問1？", "質問2？"]
  },
  "priorityThemes": [
    {"keyword": "長岡市 〇〇 整体", "reason": "理由", "priority": 1},
    {"keyword": "...", "reason": "...", "priority": 2},
    {"keyword": "...", "reason": "...", "priority": 3},
    {"keyword": "...", "reason": "...", "priority": 4},
    {"keyword": "...", "reason": "...", "priority": 5}
  ],
  "titleTemplates": [
    "【長岡市】{symptom}が改善しない3つの原因と整体院の解決策",
    "{symptom}に悩む長岡市の方へ｜薬に頼らない根本改善とは",
    "長岡市の整体院が解説｜{symptom}の正しい改善法"
  ]
}
`;

  try {
    return await callGemini(prompt);
  } catch (e) {
    console.warn(`⚠️ Geminiトレンド調査失敗: ${e.message}`);
    return {
      trendingTopics: { 肩こり: [], 頭痛: [], 姿勢: [], 骨盤矯正: [] },
      peopleAlsoAsk: {},
      priorityThemes: [],
      titleTemplates: [],
    };
  }
}

async function main() {
  console.log('🔍 週次SEO監査を開始...\n');

  if (!fs.existsSync(RANKINGS_DIR)) fs.mkdirSync(RANKINGS_DIR, { recursive: true });

  // 1. 過去投稿分析
  const history = loadHistory();
  console.log(`📚 投稿履歴: ${history.length}件`);
  const { angleCounts, symptomCounts, overusedAngles, underusedAngles } = analyzeHistory(history);

  // 2. クラスターギャップ分析
  const gaps = analyzeClusterGaps();
  console.log('\n🎯 クラスターギャップ（未カバー優先順）:');
  gaps.slice(0, 5).forEach(g => {
    console.log(`  [${g.coveragePct}%] ${g.keyword}`);
  });

  // 3. Geminiトレンド調査
  const trends = await researchTrends(gaps);

  // 4. content-strategy.json を更新
  const currentStrategy = loadCurrentStrategy();
  const newStrategy = {
    ...currentStrategy,
    updatedAt: new Date().toISOString(),
    trendingTopics: trends.trendingTopics || currentStrategy.trendingTopics || {},
    peopleAlsoAsk: trends.peopleAlsoAsk || {},
    priorityThemes: trends.priorityThemes || [],
    angleCounts,
    symptomCounts,
    underusedAngles,
    overusedPatterns: overusedAngles,
    titleTemplates: trends.titleTemplates || currentStrategy.titleTemplates || [],
    clusterGaps: gaps.slice(0, 10).map(g => ({
      keyword: g.keyword,
      theme: g.theme,
      symptom: g.symptom,
      id: g.id,
      coveragePct: g.coveragePct,
    })),
  };

  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(newStrategy, null, 2));
  console.log('\n✅ content-strategy.json を更新しました');

  // 5. SEO監査レポートを出力
  const progress = getClusterProgress();
  const report = {
    date: new Date().toISOString().slice(0, 10),
    totalPosts: history.length,
    clusterProgress: progress,
    top5Gaps: gaps.slice(0, 5),
    trendingTopics: trends.trendingTopics,
    priorityThemes: trends.priorityThemes,
    underusedAngles,
    overusedAngles,
  };

  const reportFile = path.join(RANKINGS_DIR, `seo-audit-${report.date}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log('\n📊 SEO監査サマリー:');
  console.log(`  総投稿数: ${history.length}件`);
  for (const [symptom, p] of Object.entries(progress)) {
    const bar = '█'.repeat(Math.round(p.pct / 10)) + '░'.repeat(10 - Math.round(p.pct / 10));
    console.log(`  ${symptom}: [${bar}] ${p.pct}% (${p.covered}/${p.total}サブトピック)`);
  }
  console.log(`\n  今週の最優先キーワード:`);
  gaps.slice(0, 3).forEach((g, i) => {
    console.log(`  ${i + 1}. ${g.keyword} (${g.symptom}クラスター)`);
  });

  console.log('\n🎉 週次SEO監査完了');
}

main().catch(e => {
  console.error('❌ SEO監査エラー:', e.message);
  process.exit(1);
});
