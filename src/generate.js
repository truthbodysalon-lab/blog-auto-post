import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRecentTitles, isDuplicateTitle } from './topics.js';

const MYFILES = '/Users/mt112/Desktop/my files/myfiles';

const SALON_PROFILE = `
【整体院プロフィール】
- 店名: 整体院トゥルース（ボディコーディネートサロン Truth）
- 院長: まぁ
- 所在地: 新潟県長岡市（雪国・豪雪地帯の地域特性）
- 専門: 肩こり・頭痛・姿勢・骨盤矯正の根本改善整体
- 強み: 背骨のゆがみ改善専門、骨格調整・筋膜リリース
- ターゲット: 慢性的な肩こり・頭痛に悩む30〜50代女性
- 実績: Google口コミ130件以上、医療関係者・プロスポーツ選手対応
- 初回オファー: 通常12,000円 → 4,680円（税込・施術40分・1日3名限定）
- 哲学: どこに行っても改善しない不調の根本原因を特定し解決する
- 競合との差別化: マッサージ・湿布・薬では取れない「背骨の歪み」にアプローチ
`;

const SAMPLE_TAGS = [
  '骨格調整', '筋膜リリース', '緊張性頭痛', '片頭痛', '首の歪み',
  '筋膜', '寒暖差', '側頭部', '頭皮', 'エアコン',
  '寝不足', '夏バテ', 'いびき', '早起き', '五月病',
  '連休明け', '気圧', 'スマホ', '寝返り', '頭痛薬',
  '花粉症', '自律神経', 'デスクワーク', '猫背', '巻き肩',
  '骨盤', '更年期', '産後', '姿勢', '背骨',
];

function safeRead(filePath, maxChars = 3000) {
  try { return fs.readFileSync(filePath, 'utf8').slice(0, maxChars); } catch { return ''; }
}

function listFilesByPattern(dir, pattern) {
  try { return fs.readdirSync(dir).filter(f => pattern.test(f)).sort().reverse(); } catch { return []; }
}

function loadReferenceMaterials() {
  const materials = {};
  materials.painPoints = safeRead(path.join(MYFILES, '整体/患者リサーチ/お悩みまとめ.md'), 3000);
  const threadsDir = path.join(MYFILES, 'truth_body_salon');
  const threadsFiles = listFilesByPattern(threadsDir, /^投稿_.*\.md$/);
  materials.recentPosts = threadsFiles.slice(0, 2)
    .map(f => `--- ${f} ---\n${safeRead(path.join(threadsDir, f), 900)}`)
    .join('\n\n');
  materials.lpStructure = safeRead(path.join(MYFILES, 'LP構成案_トゥルース.md'), 1200);
  return materials;
}

function toSlug(coreSymptom, angle) {
  const symptomMap = {
    '肩こり': 'katakori', '頭痛': 'zutsu', '姿勢': 'shisei', '骨盤矯正': 'kotsuban',
  };
  const angleMap = {
    '原因解説': 'genin', 'セルフケア': 'selfcare', '失敗談・落とし穴': 'failnotes',
    '比較': 'hikaku', 'Q&A形式': 'qa', '事例ストーリー': 'case',
    '季節・天候の影響': 'season', 'ライフスタイル別': 'lifestyle',
    '解剖学解説': 'anatomy', '来店誘導': 'cta',
  };
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  const s = symptomMap[coreSymptom] || 'seitai';
  const a = angleMap[angle] || 'info';
  return `nagaoka-${s}-${a}-${ym}`;
}

export async function generateArticleForTopic(topic, retryCount = 0) {
  const refs = loadReferenceMaterials();
  const recentTitles = getRecentTitles(20);
  const slug = toSlug(topic.coreSymptom || topic.symptom, topic.angle);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
  });

  const prompt = `
あなたはプロのWebライター兼SEO専門家です。
整体院トゥルース（新潟県長岡市）のブログ記事を、以下の【6ステップ方式】で作成してください。

${SALON_PROFILE}

---

## 【今日の記事指定】
- 主軸キーワード: ${topic.coreSymptom || topic.symptom}
- 具体テーマ: ${topic.symptom}
- 切り口: ${topic.angle}（${topic.angleDesc}）
- 想定読者: ${topic.lifestyle}
- 季節・トレンド: ${topic.seasonal}（現在 ${dateStr}）

---

## 【参考: 患者の実際の悩み】
${refs.painPoints}

## 【参考: 院長の文体サンプル（SNS投稿）】
${refs.recentPosts}

## 【参考: サイトLP構成】
${refs.lpStructure}

---

## 【6ステップ記事制作ルール】

### ステップ1: タイトル戦略
- 「${topic.coreSymptom || topic.symptom}」「長岡市」「整体」を含む候補を内部で5本考える
- SEO上位狙い・クリック率最大化の観点から最優秀1本を選定してtitleフィールドに出力
- タイトルは35字以内。疑問形・数字・ベネフィット訴求を活用
- 季節キーワード「${topic.seasonal}」を自然に含めると加点

### ステップ2: アウトライン（5ブロック構成）
必ず以下の5ブロック構成で本文を組み立てること：
- ブロック1: 冒頭フック（読者の悩みに共感・問いかけ）
- ブロック2: 原因解説（背骨の歪み・自律神経・季節の影響など）
- ブロック3: やってはいけないNG行動 or セルフケア方法
- ブロック4: 整体院トゥルースの根本改善アプローチ（院の強みを自然に紹介）
- ブロック5: まとめ + 来院CTAとNAP情報

### ステップ3〜5: 各ブロックの執筆ルール
- 各ブロックに<h2>タグ（全体で3〜4個）
- 必要に応じて<h3>で小見出しを設ける（各ブロックに1〜2個）
- 「長岡市」を本文中3回以上自然に含める
- 「${topic.coreSymptom || topic.symptom}」を5回以上自然に含める
- 主軸4テーマ（肩こり・頭痛・姿勢・骨盤矯正）のうち関連テーマを1〜2個クロス言及
- <strong>で重要語句を適度に強調
- <ul>でリスト化して読みやすく
- 1段落は200字以内に収める

### ステップ6: まとめ文
- 全ブロックの要点を1〜2段落でまとめる
- 「繰り返す不調から卒業する」「根本改善」のメッセージで締める

---

## 【SEO/MEOルール（絶対遵守）】
1. **禁止語**: 「治る」「治療」「絶対」「100%」「最高」「No.1」「医学的に証明」
2. **推奨語**: 「改善」「整える」「サポート」「根本から」「繰り返さない体に」
3. **NAP情報（末尾CTAに必須）**:
   「■ 整体院トゥルース（ボディコーディネートサロン Truth）／■ 所在地: 新潟県長岡市／■ 専門: 肩こり・頭痛・姿勢・骨盤矯正の根本改善整体／■ 初回限定: 通常12,000円→4,680円（税込・施術40分・1日3名限定）」
4. **過去投稿との類似タイトル禁止（以下と80%以上類似しないこと）**:
${recentTitles.length ? recentTitles.map(t => `   - ${t}`).join('\n') : '   (履歴なし)'}
5. **本文文字数**: 1800〜2500字（2000字前後が理想）
6. **医療広告ガイドライン**: 施術効果の断定表現は禁止。体験例・可能性として表現する

---

## 【出力フォーマット】
JSON形式のみで出力。JSON以外の文字（説明文・コードブロック記号等）は一切出力しない。

{
  "title": "35文字以内のSEOタイトル（長岡市・主軸キーワード・ベネフィット含む）",
  "naviName": "20文字以内のナビ表示名（短く端的に）",
  "slug": "${slug}",
  "h1Text": "40文字以内のh1テキスト（タイトルとは違う表現で）",
  "description": "120〜180文字のメタディスクリプション（検索意図に答え、長岡市・院名・ベネフィット明記）",
  "keywords": "カンマ区切り5〜8個（例: 長岡市,整体,肩こり,頭痛,歪み,根本改善）",
  "tags": ["既存タグから3〜5個。候補: ${SAMPLE_TAGS.join('、')}"],
  "bodyHtml": "5ブロック構成の本文HTML。1800〜2500文字。<h2><h3><p><ul><strong>を適切に使用"
}
`;

  console.log(`🤖 [${topic.slot}/10] 生成中: ${topic.symptom} × ${topic.angle} (${topic.seasonal})`);

  let result;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (e) {
      const isRetryable = e.message?.includes('503') || e.message?.includes('429') || e.message?.includes('overloaded');
      if (isRetryable && attempt < 4) {
        const wait = attempt * 15000;
        console.log(`⏳ API一時エラー (試行${attempt}/4)、${wait/1000}秒後にリトライ...`);
        await new Promise(r => setTimeout(r, wait));
      } else throw e;
    }
  }

  const text = result.response.text();
  let article;
  try {
    article = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSONパース失敗:\n' + text.slice(0, 500));
    article = JSON.parse(match[0]);
  }

  if (isDuplicateTitle(article.title) && retryCount < 2) {
    console.log(`⚠️ タイトル類似検出 → 再生成 (${retryCount + 1})`);
    await new Promise(r => setTimeout(r, 1500));
    return generateArticleForTopic(topic, retryCount + 1);
  }

  article.slug = article.slug || slug;
  article.category = topic.category;
  article.publishAt = topic.publishAt;
  console.log(`✅ [${topic.slot}/10] ${article.title}`);
  return article;
}
