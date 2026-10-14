import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isAnthropicAvailable, generateWithClaude } from './anthropic-fallback.js';
import { getRecentTitles, isDuplicateTitle } from './topics.js';
import { ZUTSU_PILLAR, ZUTSU_PERIPHERAL_FALLBACKS, isPillarKeyword, isHeadacheArticle } from './seo-config.js';
import { ensurePillarLink, hasPillarLink } from './internal-links.js';
import { sanitizeArticle } from './health-claims.js';

/**
 * JSON文字列リテラル内に混入した生の制御文字（改行・タブ等）だけをエスケープする。
 * 文字列の外側（オブジェクトの整形用改行など）は合法なJSON空白なので変更しない。
 * 2026-09-14: gemini-3.6-flash応答で発生した
 * 「Bad control character in string literal in JSON」対策。
 */
function sanitizeJsonControlChars(text) {
  let inString = false;
  let escaped = false;
  let out = '';
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch.charCodeAt(0) < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += ' ';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

const MYFILES = '/Users/mt112/Desktop/my files/myfiles';

const SALON_PROFILE = `
【整体院プロフィール】
- 店名: 整体院トゥルース（ボディコーディネートサロン Truth）
- 院長: まぁ
- 所在地: 新潟県長岡市（雪国・豪雪地帯の地域特性）
- 専門: 肩こり・頭痛・姿勢・骨盤矯正の整体
- 強み: 背骨・骨格のバランスや姿勢に目を向けた施術、骨格調整・筋膜リリース
- ターゲット: 慢性的な肩こり・頭痛に悩む30〜50代女性
- 実績: Google口コミ130件以上、医療関係者・プロスポーツ選手対応
- 初回オファー: 通常12,000円 → 4,680円（税込・施術40分・1日3名限定）
- 哲学: お体の状態を丁寧に確認し、姿勢や体の使い方の面から整えていく（診断や治療は行わない）
- 競合との差別化: マッサージ・湿布・薬とは違う、背骨・骨格・姿勢の面からのアプローチ
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

// 狙うキーワードの決定。「長岡市 整体 頭痛」系は頭痛の専用ページが狙う語なので、
// ブログ記事では周辺語（頭痛の種類・原因・セルフケア・季節）に置き換える。
function resolveTarget(topic) {
  let kw = topic.subtopicKeyword || null;
  let theme = topic.subtopicTheme || null;
  if (kw && isPillarKeyword(kw)) { kw = null; theme = null; }
  if (!kw && (topic.coreSymptom || '') === '頭痛') {
    const f = ZUTSU_PERIPHERAL_FALLBACKS[(topic.slot || 1) % ZUTSU_PERIPHERAL_FALLBACKS.length];
    kw = f.keyword;
    theme = f.theme;
  }
  return { kw, theme };
}

export async function generateArticleForTopic(topic, retryCount = 0, guardRetry = 0, guardNote = '') {
  const refs = loadReferenceMaterials();
  const recentTitles = getRecentTitles(20);
  const slug = toSlug(topic.coreSymptom || topic.symptom, topic.angle);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // 無料枠はモデルごとに別々の1日上限。429時に別モデルへ自動フォールバックして枯渇を回避
  const modelCandidates = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-2.5-flash',   // 2026-09-20: 廃止済みの 2.5-flash-lite(404) を外し、実在モデルだけで5段にした
  ].filter((m, i, a) => a.indexOf(m) === i);
  const makeModel = (name) => genAI.getGenerativeModel({
    model: name,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
  });

  // クラスター情報をプロンプトに注入
  const { kw: targetKw, theme: targetTheme } = resolveTarget(topic);
  const clusterCtx = targetKw
    ? `- 狙うSEOキーワード（クラスター）: 【${targetKw}】\n- このキーワードで検索1位を目指す。タイトル・H1・本文冒頭100字に必ず含める`
    : `- 主軸SEOキーワード: 「${topic.coreSymptom || topic.symptom}　長岡市」`;

  // 頭痛の記事は、頭痛の専用ページへ内部リンクを必ず1本入れる（生成後にも機械的に補う）
  const headacheTopic = (topic.coreSymptom || '') === '頭痛' || /頭痛/.test(`${targetKw || ''}${targetTheme || ''}`);
  const pillarCtx = `
## 【頭痛の専用ページとの役割分担（重要）】
- 「長岡市 整体 頭痛」「長岡市 頭痛 整体」そのものを狙う検索は、頭痛の専用ページが担当する。この記事は上の「狙うSEOキーワード」の周辺テーマ（頭痛の種類・原因・セルフケア・季節など）に集中し、専用ページと同じ語を競わない
- タイトル・H1に「長岡市 頭痛 整体」「長岡市 整体 頭痛」の語順をそのまま使わない（狙いKWの固有の語を必ず入れる）
${headacheTopic || /頭痛/.test(`${topic.symptom || ''}`) ? `- ★必須★ 本文の自然な位置（原因解説の後〜まとめの前）に、頭痛の専用ページへの内部リンクを**ちょうど1本**入れる。HTMLは次のとおり:
  <a href="${ZUTSU_PILLAR.url}">${ZUTSU_PILLAR.anchors[0]}</a>
  例: 「頭痛全般についての詳しい情報は、<a href="${ZUTSU_PILLAR.url}">${ZUTSU_PILLAR.anchors[0]}</a>もあわせてご覧ください。」（href は上のURLを一字一句そのまま使う）` : `- この記事で頭痛に触れる場合は、本文の自然な位置に頭痛の専用ページへのリンクを1本入れる: <a href="${ZUTSU_PILLAR.url}">${ZUTSU_PILLAR.anchors[0]}</a>`}
`;

  const prompt = `
あなたはプロのWebライター兼SEO専門家です。
整体院トゥルース（新潟県長岡市）のブログ記事を、以下の【SEO特化7ステップ方式】で作成してください。
目標: Googleで「${targetKw || (topic.coreSymptom + ' 長岡市')}」検索 **1位獲得**。

${SALON_PROFILE}

---

## 【今日の記事指定】
${clusterCtx}
- 具体テーマ: ${targetTheme || topic.symptom}
- 切り口: ${topic.angle}（${topic.angleDesc}）
- 想定読者: ${topic.lifestyle}
- 季節・トレンド: ${topic.seasonal}（現在 ${dateStr}）
${pillarCtx}${guardNote}
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
- 狙いキーワード「${targetKw || topic.symptom}」を**タイトル先頭または前半**に配置
- タイトルは32字以内。数字・疑問形・読者の関心（〜との付き合い方/〜が起こる背景）を含める。「治る」「改善率」「必ず」などの断定・保証は使わない
- 例: 「長岡市の肩こりの原因｜整体院トゥルースが解説」「長岡市で気圧頭痛に悩む方へ」
- 内部で5候補を考えてクリック率・SEO最強の1本を選ぶ

### ステップ2: アウトライン（6ブロック構成）
必ず以下の6ブロック構成で本文を組み立てること：
- **ブロック1**: 冒頭フック（100字以内・狙いキーワードを最初の1文に含める）
- **ブロック2**: 原因解説（背骨の歪み・自律神経・季節の影響など。<h2>で見出し）
- **ブロック3**: やってはいけないNG行動 or セルフケア方法（番号付きリスト必須）
- **ブロック4**: 整体院トゥルースの考え方と施術の進め方（院の強みを自然に紹介。効果は約束せず、お体の状態を確認して進めることを伝える）
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
- **改行・段落分けを強く意識する**: 1つの<p>タグは2〜3文・120字以内。長い説明ほど<p>を複数に分割し、スマホ画面で見ても文字がぎっしり詰まらないようにする
- 各ブロックは最低2〜3個の<p>タグに分ける（1ブロック=1個の長い<p>にしない）
- 話題が切り替わる箇所は必ず<p>を分ける（原因の説明→対処法の説明、のように意味の切れ目で改行）

### ステップ6: FAQ ブロック（featured snippet + PAA対策）
以下のルールで「よくある質問」を本文末尾に追加する:
- <h2>よくある質問</h2> で始める
- 各Q&Aを <details><summary>Q. 〜〜？</summary><p>A. 〜〜</p></details> 形式で4問書く
- 質問は「${topic.coreSymptom || topic.symptom} [悩み]」「長岡市 整体 [疑問]」形式
- 回答は50〜100字で簡潔に。最後に「詳しくは当院にご相談ください」を添える
- 例: Q.「肩こりは整体で何回通えばいいですか？」A.「状態や生活習慣によって個人差が大きく、回数をお約束することはできません。初回にお体の状態を確認してからご提案します。」

### ステップ7: まとめ文
- 全ブロックの要点を2〜3個の短い<p>に分けてまとめる（1つの長い段落にしない）
- 「繰り返しにくい体づくりを一緒に考えていく」というメッセージで締める（効果の約束・断定はしない）
- NAPの直前に、次の注意書きを<p>で1文入れる: 「※当院は整体院であり、病気の診断や治療は行いません。強い痛みや急な症状がある場合は、先に医療機関の受診をおすすめします。」
- 末尾に院名・住所・電話番号（NAP）を明記する

---

## 【SEO/MEOルール（絶対遵守）】
1. **禁止語**: 「治る」「治す」「完治」「治療」(当院の施術について)「絶対」「必ず(効果の保証として)」「100%」「改善率」「確実」「保証」「最高」「No.1」「医学的に証明」「診断します」「原因を特定」「根本原因」「根本改善」
1a. **健康表現は断定・保証しない**: 効果は「〜と言われています」「〜の場合があります」「〜を目指します」で書く。「あなたの頭痛は〜が原因です」のように診断ととれる書き方はしない。実績の数値（改善率○%など）は書かない。タイトルでも「整体で楽に！」「〜を解消！」のような効果の言い切りは避ける。競合ページが使っていても真似しない
1b. **ハッシュタグ禁止**: 本文中に「#○○」「#長岡市」等の#記号ハッシュタグを一切使用しない。SEO・MEO効果はなく投稿品質を下げるため絶対禁止
2. **推奨語**: 「整える」「サポート」「ケア」「目指す」「体の使い方を見直す」「繰り返しにくい体づくり」
3. **NAP情報（末尾CTAに必須）**:
   「■ 整体院トゥルース（ボディコーディネートサロン Truth）／■ 所在地: 新潟県長岡市／■ 専門: 肩こり・頭痛・姿勢・骨盤矯正の整体／■ 初回限定: 通常12,000円→4,680円（税込・施術40分・1日3名限定）」
4. **過去投稿との類似タイトル禁止（以下と80%以上類似しないこと）**:
${recentTitles.length ? recentTitles.map(t => `   - ${t}`).join('\n') : '   (履歴なし)'}
5. **本文文字数**: 2000〜2800字（FAQ込み。SEOは長文有利）
6. **医療広告ガイドライン**: 施術効果の断定表現は禁止。体験例・可能性として表現する
7. **E-E-A-T強化**: 「Google口コミ130件以上」「医療関係者・プロスポーツ選手対応実績」を自然に言及する

## 【AIO対策ルール（AI検索最適化・追加遵守）】
8. **結論ファースト**: ブロック1の最初の1〜2文で検索意図への直接回答を先に述べてから共感フックに続ける。問いかけだけで書き出さない（例:「長岡市で繰り返す肩こりは、背骨の歪みと自律神経の乱れが原因のことが多いです。マッサージに行っても数日で元通り……そんな経験はありませんか？」）
9. **質問形見出し**: h2見出しのうち最低1つを実際の検索質問文の形にする（例:「長岡市で肩こりに効く整体はどこ？」）。FAQの質問文も検索意図そのままの疑問文にし、回答は2文以内・1文目で結論を述べる
10. **定義文**: ブロック2内に「◯◯とは、〜の状態を指します」型の定義文を1文だけ入れる。医学的断定は避け「〜と言われています」等の表現にとどめる
11. **AI抽出用の要点**: ブロック2に症状セルフチェックの<ul>リスト（2〜4項目）を入れる（ブロック3の<ol>とは別）

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
  "bodyHtml": "6ブロック構成の本文HTML。2000〜2800文字。FAQ<details>タグ4問を末尾に必ず含める。<h2><h3><p><ul><ol><strong><details><summary>を適切に使用。本文の最末尾にFAQ4問と同内容のFAQPage構造化データを<script type=\\"application/ld+json\\">{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"FAQPage\\",\\"mainEntity\\":[...]}</script>として1つ含める（質問・回答はFAQブロックと完全一致させる）"
}
`;

  console.log(`🤖 [${topic.slot}/10] 生成中: ${topic.symptom} × ${topic.angle} (${topic.seasonal})`);

  let text;
  try {
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
      // 2026-09-20: 503(高負荷)・404(モデル廃止)でも待たずに次のモデルへ切替える（3.8-flashの503で毎日1回失敗していた）
      const isBusy = e.message?.includes('503') || e.message?.toLowerCase().includes('overloaded') || e.message?.toLowerCase().includes('high demand');
      const isGone = e.message?.includes('404') || e.message?.toLowerCase().includes('no longer available');
      if ((isQuota || isBusy || isGone) && modelIdx < modelCandidates.length - 1) {
        const prev = modelCandidates[modelIdx];
        modelIdx++;
        model = makeModel(modelCandidates[modelIdx]);
        console.log(`⚠️ ${prev} が ${isQuota ? '枠上限(429)' : isBusy ? '高負荷(503)' : '廃止(404)'} → ${modelCandidates[modelIdx]} に切替えて再試行`);
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

  text = result.response.text();
  } catch (geminiError) {
    // Gemini全滅（6回試行を使い切った／モデル切替で試行を消費した場合を含む）→ Claudeを最終段として1回だけ試す。
    // ANTHROPIC_API_KEY 未設定なら従来どおりそのまま失敗する。
    if (!isAnthropicAvailable()) throw geminiError;
    console.log(`⚠️ Gemini全滅: ${String(geminiError.message).split('\n')[0]}`);
    try {
      text = await generateWithClaude(prompt, { maxOutputTokens: 16000, label: `blog ${topic.slot}/10` });
    } catch (claudeError) {
      throw new Error(`Gemini全滅かつClaudeも失敗しました。Gemini: ${String(geminiError.message).split('\n')[0]} / Claude: ${String(claudeError.message).split('\n')[0]}`);
    }
  }
  let article;
  try {
    article = JSON.parse(text);
  } catch {
    // 2026-09-14: gemini-3.6-flash（429フォールバック先）がbodyHtml文字列中に
    // 未エスケープの制御文字（改行等）を混入させ「Bad control character in
    // string literal」でパース失敗する事例を確認。文字列リテラル内の生の制御文字
    // のみをエスケープして再試行する（文字列外の整形用改行はJSON構文上合法なので触らない）。
    const sanitized = sanitizeJsonControlChars(text);
    try {
      article = JSON.parse(sanitized);
    } catch {
      const match = sanitized.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSONパース失敗:\n' + text.slice(0, 500));
      article = JSON.parse(match[0]);
    }
  }

  if (isDuplicateTitle(article.title) && retryCount < 2) {
    console.log(`⚠️ タイトル類似検出 → 再生成 (${retryCount + 1})`);
    await new Promise(r => setTimeout(r, 1500));
    return generateArticleForTopic(topic, retryCount + 1);
  }

  // ---- 健康表現ガード（断定・保証・診断の防止）----
  // 言い換えで済む語は自動で言い換え、残る語があれば再生成（最大2回）→ それでも残れば投稿させず失敗にする
  const guard = sanitizeArticle(article);
  if (guard.applied.length) console.log(`🛡️ 健康表現ガード: 自動言い換え (${guard.applied.join(', ')})`);
  if (guard.blockers.length) {
    const lines = guard.blockers.map(b => `${b.field}: ${b.reason}「${b.snippet}」`);
    if (guardRetry < 2) {
      console.log(`⚠️ 健康表現ガードNG → 再生成 (${guardRetry + 1}/2): ${lines.join(' / ')}`);
      await new Promise(r => setTimeout(r, 1500));
      const note = `\n## 【前回の生成で見つかった問題（必ず直すこと）】\n${lines.map(l => `- ${l}`).join('\n')}\n- 断定・保証・診断ととれる表現を使わず、「〜と言われています」「〜の場合があります」「〜を目指します」に言い換える\n`;
      return generateArticleForTopic(topic, retryCount, guardRetry + 1, note);
    }
    throw new Error(`健康表現ガードNG（再生成上限）: ${lines.join(' / ')}`);
  }

  // 専用ページが狙う語（長岡市 頭痛 整体 など）はメタキーワードからも外す
  if (typeof article.keywords === 'string') {
    article.keywords = article.keywords.split(/[,、，]/).map(k => k.trim()).filter(k => k && !isPillarKeyword(k)).join(',');
  }

  // ---- 頭痛の専用ページへの内部リンク（頭痛記事は必須。AIが入れ忘れた場合は機械的に補う）----
  if (headacheTopic || isHeadacheArticle(article, topic)) {
    const link = ensurePillarLink(article.bodyHtml, article.title);
    article.bodyHtml = link.bodyHtml;
    console.log(link.inserted ? '🔗 頭痛の専用ページへの内部リンクを自動挿入' : '🔗 頭痛の専用ページへの内部リンク: 本文に既にあり');
    if (!hasPillarLink(article.bodyHtml)) throw new Error('頭痛の専用ページへの内部リンクを入れられませんでした');
  }
  if (/長岡市\s*(頭痛\s*整体|整体\s*頭痛)/.test(`${article.title}${article.h1Text || ''}`)) {
    console.log(`⚠️ タイトル/H1が専用ページの狙い語（長岡市 頭痛 整体）と同じ: ${article.title}`);
  }

  article.slug = article.slug || slug;
  article.category = topic.category;
  article.publishAt = topic.publishAt;
  console.log(`✅ [${topic.slot}/10] ${article.title}`);
  return article;
}
