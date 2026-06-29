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
  // 無料枠はモデルごとに別々の1日上限。429時に別モデルへ自動フォールバックして枯渇を回避
  const modelCandidates = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
  ].filter((m, i, a) => a.indexOf(m) === i);
  const makeModel = (name) => genAI.getGenerativeModel({
    model: name,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
  });

  // クラスター情報をプロンプトに注入
  const clusterCtx = topic.subtopicKeyword
    ? `- 狙うSEOキーワード（クラスター）: 【${topic.subtopicKeyword}】\n- このキーワードで検索1位を目指す。タイトル・H1・本文冒頭100字に必ず含める`
    : `- 主軸SEOキーワード: 「${topic.coreSymptom || topic.symptom}　長岡市」`;

  const prompt = `
あなたはプロのWebライター兼SEO専門家です。
整体院トゥルース（新潟県長岡市）のブログ記事を、以下の【SEO特化7ステップ方式】で作成してください。
目標: Googleで「${topic.subtopicKeyword || (topic.coreSymptom + ' 長岡市')}」検索 **1位獲得**。

${SALON_PROFILE}

---

## 【今日の記事指定】
${clusterCtx}
- 具体テーマ: ${topic.subtopicTheme || topic.symptom}
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

## 【SEO特化 7ステップ記事制作ルール】

### ステップ1: タイトル戦略（検索1位を狙うタイトル）
- 狙いキーワード「${topic.subtopicKeyword || topic.symptom}」を**タイトル先頭または前半**に配置
- タイトルは32字以内。数字・疑問形・ベネフィット（〜が改善/〜の原因）を含める
- 例: 「長岡市の肩こりの原因｜整体院トゥルースが解説」「長岡市で気圧頭痛に悩む方へ」
- 内部で5候補を考えてクリック率・SEO最強の1本を選ぶ

### ステップ2: アウトライン（6ブロック構成）
必ず以下の6ブロック構成で本文を組み立てること：
- **ブロック1**: 冒頭フック（100字以内・狙いキーワードを最初の1文に含める）
- **ブロック2**: 原因解説（背骨の歪み・自律神経・季節の影響など。<h2>で見出し）
- **ブロック3**: やってはいけないNG行動 or セルフケア方法（番号付きリスト必須）
- **ブロック4**: 整体院トゥルースの根本改善アプローチ（院の強みを自然に紹介）
- **ブロック5**: まとめ + 来院CTA + NAP情報
- **ブロック6**: よくある質問（FAQ）4問 ← ★必須★ People Also Ask対策

### ステップ3〜5: 各ブロックの執筆ルール
- 各ブロックに<h2>タグ（全体で4〜5個。ブロック6のFAQも<h2>「よくある質問」で始める）
- 必要に応じて<h3>で小見出しを設ける
- 「長岡市」を本文中**4回以上**自然に含める（冒頭必須・中盤必須・末尾NAP）
- 「${topic.coreSymptom || topic.symptom}」を**5回以上**自然に含める
- 主軸4テーマ（肩こり・頭痛・姿勢・骨盤矯正）のうち関連テーマを1〜2個クロス言及
- <strong>で重要語句を適度に強調（多用しない・3〜6箇所）
- <ul>か<ol>でリスト化して読みやすく（ブロック3は<ol>必須）
- 1段落は180字以内に収める

### ステップ6: FAQ ブロック（featured snippet + PAA対策）
以下のルールで「よくある質問」を本文末尾に追加する:
- <h2>よくある質問</h2> で始める
- 各Q&Aを <details><summary>Q. 〜〜？</summary><p>A. 〜〜</p></details> 形式で4問書く
- 質問は「${topic.coreSymptom || topic.symptom} [悩み]」「長岡市 整体 [疑問]」形式
- 回答は50〜100字で簡潔に。最後に「詳しくは当院にご相談ください」を添える
- 例: Q.「肩こりは整体で何回で改善しますか？」A.「個人差はありますが、初回〜3回でほぐれを実感する方が多いです。当院では1日3名限定で丁寧に対応しています。」

### ステップ7: まとめ文
- 全ブロックの要点を1〜2段落でまとめる
- 「繰り返す不調から卒業する」「根本改善」のメッセージで締める
- 末尾に院名・住所・電話番号（NAP）を明記する

---

## 【SEO/MEOルール（絶対遵守）】
1. **禁止語**: 「治る」「治療」「絶対」「100%」「最高」「No.1」「医学的に証明」
2. **推奨語**: 「改善」「整える」「サポート」「根本から」「繰り返さない体に」
3. **NAP情報（末尾CTAに必須）**:
   「■ 整体院トゥルース（ボディコーディネートサロン Truth）／■ 所在地: 新潟県長岡市／■ 専門: 肩こり・頭痛・姿勢・骨盤矯正の根本改善整体／■ 初回限定: 通常12,000円→4,680円（税込・施術40分・1日3名限定）」
4. **過去投稿との類似タイトル禁止（以下と80%以上類似しないこと）**:
${recentTitles.length ? recentTitles.map(t => `   - ${t}`).join('\n') : '   (履歴なし)'}
5. **本文文字数**: 2000〜2800字（FAQ込み。SEOは長文有利）
6. **医療広告ガイドライン**: 施術効果の断定表現は禁止。体験例・可能性として表現する
7. **E-E-A-T強化**: 「Google口コミ130件以上」「医療関係者・プロスポーツ選手対応実績」を自然に言及する

---

## 【出力フォーマット】
JSON形式のみで出力。JSON以外の文字（説明文・コードブロック記号等）は一切出力しない。

{
  "title": "32文字以内のSEOタイトル（狙いKW先頭・長岡市・ベネフィット含む）",
  "naviName": "20文字以内のナビ表示名（短く端的に）",
  "slug": "${slug}",
  "h1Text": "40文字以内のh1テキスト（タイトルとは違う表現で・狙いKWを含む）",
  "description": "120〜160文字のメタディスクリプション（狙いKW・長岡市・院名・ベネフィット・行動喚起を明記）",
  "keywords": "カンマ区切り6〜10個（狙いKWを先頭に・例: 長岡市 肩こり 整体,長岡市 肩こり 原因,整体院トゥルース）",
  "tags": ["既存タグから3〜5個。候補: ${SAMPLE_TAGS.join('、')}"],
  "bodyHtml": "6ブロック構成の本文HTML。2000〜2800文字。FAQ<details>タグ4問を末尾に必ず含める。<h2><h3><p><ul><ol><strong><details><summary>を適切に使用"
}
`;

  console.log(`🤖 [${topic.slot}/10] 生成中: ${topic.symptom} × ${topic.angle} (${topic.seasonal})`);

  let result;
  let modelIdx = 0;
  let model = makeModel(modelCandidates[modelIdx]);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
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
        const wait = [8000, 15000, 25000, 25000, 25000][attempt - 1] || 25000;
        console.log(`⏳ API一時エラー (試行${attempt}/6)、${wait/1000}秒後にリトライ...`);
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
