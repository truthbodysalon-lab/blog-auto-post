import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const HISTORY_FILE = path.resolve('posts/history.json');
const STRATEGY_FILE = path.resolve('content-strategy.json');

const ALL_ANGLES = [
  '原因解説', 'セルフケア', '失敗談・落とし穴', '比較',
  'Q&A形式', '事例ストーリー', '季節・天候の影響',
  'ライフスタイル別', '解剖学解説', '来店誘導',
];

const SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正'];

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; }
}

function analyzeHistory(history) {
  const recent = history.slice(-90);

  // タイトルパターン頻度を計測
  const titlePatterns = {};
  const genericPatterns = [
    '肩こり整体・頭痛整体',
    '長岡市の肩こり・頭痛整体',
    '長岡市の頭痛整体',
    '長岡市の肩こり整体',
  ];
  for (const h of recent) {
    for (const pat of genericPatterns) {
      if ((h.title || '').includes(pat)) {
        titlePatterns[pat] = (titlePatterns[pat] || 0) + 1;
      }
    }
  }

  // 角度別使用回数（historyにangle記録がある分だけ）
  const angleCounts = Object.fromEntries(ALL_ANGLES.map(a => [a, 0]));
  for (const h of recent) {
    if (h.angle && angleCounts[h.angle] !== undefined) angleCounts[h.angle]++;
  }

  // 症状別使用回数
  const symptomCounts = Object.fromEntries(SYMPTOMS.map(s => [s, 0]));
  for (const h of recent) {
    for (const s of SYMPTOMS) {
      if ((h.title || '').includes(s) || (h.category || '').includes(s)) {
        symptomCounts[s]++;
        break;
      }
    }
  }

  const underusedAngles = ALL_ANGLES.filter(a => angleCounts[a] < 3);
  const overusedPatterns = Object.entries(titlePatterns)
    .filter(([, c]) => c >= 5)
    .map(([p]) => p);

  return { angleCounts, underusedAngles, overusedPatterns, symptomCounts };
}

async function callGemini(prompt, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await resp.json();
    if (data.error?.code === 429) {
      const wait = attempt * 20000;
      console.log(`  Rate limit, ${wait/1000}s待機中...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`JSON not found in response: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
  throw new Error('Rate limit exceeded after retries');
}

async function researchTrends() {
  if (!process.env.GEMINI_API_KEY) return {};

  const month = new Date().getMonth() + 1;
  const seasonMap = {
    1:'厳冬', 2:'寒さのピーク', 3:'春', 4:'新生活', 5:'GW',
    6:'梅雨', 7:'夏', 8:'猛暑', 9:'秋', 10:'秋冬', 11:'初冬', 12:'師走',
  };
  const season = seasonMap[month] || '季節の変わり目';
  const trends = {};

  for (const symptom of SYMPTOMS) {
    try {
      const result = await callGemini(
        `整体院ブログSEO向け。${month}月（${season}）に「${symptom}」で長岡市の患者が検索しやすいロングテールキーワードを6つ。` +
        `短く具体的に（例: "梅雨の頭痛が毎朝ひどい", "エアコンで肩こり悪化"）。` +
        `JSON: {"keywords": ["...", ...]}`
      );
      trends[symptom] = result.keywords || [];
      console.log(`✅ ${symptom} トレンド:`, trends[symptom]);
    } catch (e) {
      console.error(`❌ ${symptom} トレンド取得失敗:`, e.message);
      trends[symptom] = [];
    }
    await new Promise(r => setTimeout(r, 2500));
  }

  return trends;
}

async function generateTitleTemplates(underusedAngles) {
  if (!process.env.GEMINI_API_KEY || underusedAngles.length === 0) return [];
  try {
    const result = await callGemini(
      `整体院ブログのSEOタイトルテンプレートを5つ作ってください。` +
      `特に以下の視点が最近少ないので重点的に: ${underusedAngles.join('、')}。` +
      `長岡市の40〜50代女性向け。「肩こり整体・頭痛整体」という汎用タイトルは避ける。` +
      `JSON: {"templates": ["テンプレ1（[症状]などプレースホルダOK）", ...]}`
    );
    return result.templates || [];
  } catch (e) {
    console.error('タイトルテンプレート生成失敗:', e.message);
    return [];
  }
}

async function main() {
  console.log('📊 コンテンツ分析開始...');

  const history = loadHistory();
  console.log(`投稿履歴: ${history.length}件`);

  const { angleCounts, underusedAngles, overusedPatterns, symptomCounts } = analyzeHistory(history);
  console.log('不足角度:', underusedAngles);
  console.log('過多パターン:', overusedPatterns);
  console.log('症状分布:', symptomCounts);

  console.log('\n🔍 トレンドリサーチ中...');
  const trendingTopics = await researchTrends();

  console.log('\n📝 タイトルテンプレート生成中...');
  const titleTemplates = await generateTitleTemplates(underusedAngles);

  const strategy = {
    updatedAt: new Date().toISOString(),
    trendingTopics,
    angleCounts,
    underusedAngles,
    overusedPatterns,
    symptomCounts,
    titleTemplates,
  };

  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(strategy, null, 2));
  console.log('\n✅ content-strategy.json 更新完了');
  console.log(`  トレンドキーワード: ${Object.values(trendingTopics).flat().length}件`);
  console.log(`  不足角度: ${underusedAngles.length}件`);
  console.log(`  過多パターン: ${overusedPatterns.length}件`);
  console.log(`  タイトルテンプレート: ${titleTemplates.length}件`);
}

main().catch(err => { console.error(err); process.exit(1); });
