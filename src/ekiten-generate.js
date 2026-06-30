/**
 * エキテン用 記事生成
 * HPブログより短め・プレーンテキスト中心（エキテンのエディタに合わせる）
 * 600〜900字、読みやすい構成
 */
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getNextSubtopic } from './content-clusters.js';

const CORE_SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正', '猫背', '反り腰'];

const SALON_PROFILE = `
整体院トゥルース（ボディコーディネートサロン Truth）
所在地: 新潟県長岡市
専門: 肩こり・頭痛・姿勢・骨盤矯正の根本改善整体
強み: 背骨のゆがみ改善専門、Google口コミ130件以上
初回限定: 通常12,000円→4,680円（税込・施術40分・1日3名限定）
`;

function pickSymptom(dayOfYear) {
  return CORE_SYMPTOMS[dayOfYear % CORE_SYMPTOMS.length];
}

async function callGemini(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // 無料枠はモデルごとに別々の1日上限。429時に別モデルへ自動フォールバックして枯渇を回避
  // （generate.js と同じ戦略。2.0-flashが limit:0 で枯渇するため2.5-flash優先）
  const modelCandidates = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
  ].filter((m, i, a) => a.indexOf(m) === i);
  const makeModel = (name) => genAI.getGenerativeModel({
    model: name,
    generationConfig: { temperature: 0.85 },
  });

  let modelIdx = 0;
  let model = makeModel(modelCandidates[modelIdx]);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (e) {
      const isQuota = e.message?.includes('429') || e.message?.toLowerCase().includes('quota');
      const isRetryable = isQuota || e.message?.includes('503') || e.message?.includes('overloaded');
      // 1日上限(429)に当たったら、別のモデルへ切替（モデルごとに無料枠が別）
      if (isQuota && modelIdx < modelCandidates.length - 1) {
        const prev = modelCandidates[modelIdx];
        modelIdx++;
        model = makeModel(modelCandidates[modelIdx]);
        console.log(`⚠️ ${prev} が枠上限(429) → ${modelCandidates[modelIdx]} に切替えて再試行`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (isRetryable && attempt < 6) {
        const wait = [8000, 15000, 25000, 60000, 90000][attempt - 1] || 90000;
        console.log(`⏳ Gemini待機 (${attempt}/6) ${wait / 1000}秒...`);
        await new Promise(r => setTimeout(r, wait));
      } else throw e;
    }
  }
}

export async function generateEkitenArticle() {
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const coreSymptom = pickSymptom(dayOfYear);
  const month = today.getMonth() + 1;

  // クラスターから未カバーキーワードを取得（姿勢系は 姿勢 クラスターで）
  const clusterKey = ['猫背', '反り腰'].includes(coreSymptom) ? '姿勢' : coreSymptom;
  const subtopic = getNextSubtopic(clusterKey);
  const targetKw = subtopic?.keyword || `長岡市 ${coreSymptom} 整体`;
  const theme = subtopic?.theme || `${coreSymptom}の原因と改善`;

  const dateStr = `${today.getFullYear()}年${month}月${today.getDate()}日`;

  console.log(`🤖 エキテン記事生成: ${coreSymptom} / KW: ${targetKw}`);

  const prompt = `
あなたはプロのWebライターです。
整体院のエキテンブログ用の記事を書いてください。

${SALON_PROFILE}

## 記事条件
- テーマ: ${theme}
- 狙うSEOキーワード: 「${targetKw}」
- 作成日: ${dateStr}（${month}月の季節感を自然に入れる）

## 構成ルール（必ず守る）
1. **タイトル**（25〜35字）: 「${targetKw}」を含む、読者が思わずクリックするタイトル
2. **本文**（600〜900字）:
   - 冒頭：読者の悩みに共感（2〜3文）
   - 原因：${coreSymptom}が起きる仕組みを簡単に（3〜4文）
   - セルフケアか改善のヒント（2〜3文）
   - 整体院トゥルースの紹介（2〜3文・「長岡市」を自然に含める）
   - 締め：来院を促す一言 + 初回料金 4,680円（税込）を明記
3. **禁止語**: 「治る」「治療」「100%」「最高」「No.1」
4. **文体**: 柔らかく親しみやすい・専門的すぎない
5. **段落**: 改行を多用して読みやすく（1段落3〜4文まで）

## 出力フォーマット（このまま出力。マークダウン記号なし）
【タイトル】
（タイトルをここに）

【本文】
（本文をここに。段落間は空行を入れる）
`;

  const raw = await callGemini(prompt);

  // パース
  const titleMatch = raw.match(/【タイトル】\s*\n?([\s\S]*?)(?=【本文】)/);
  const bodyMatch = raw.match(/【本文】\s*\n?([\s\S]*)/);

  const title = titleMatch ? titleMatch[1].trim() : `${targetKw}について`;
  const bodyText = bodyMatch ? bodyMatch[1].trim() : raw;

  return {
    title,
    bodyText,
    bodyHtml: bodyText,
    coreSymptom,
    targetKw,
    subtopicId: subtopic?.id || null,
    clusterKey,
    date: dateStr,
  };
}
