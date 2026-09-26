/**
 * エキテン用 記事生成
 * HPブログより短め・プレーンテキスト中心（エキテンのエディタに合わせる）
 * 600〜900字、読みやすい構成
 */
import 'dotenv/config';
import { generateText } from './gemini-client.js';
import { getNextSubtopic } from './content-clusters.js';

const CORE_SYMPTOMS = ['肩こり', '頭痛', '姿勢', '骨盤矯正', '猫背', '反り腰'];

// 店舗のプロフィール文（プロンプトへの背景情報）。
// 2026-09-26 エキテン審査却下（「根本改善」「専門」「口コミ130件以上」等が
// 効果断定・優位性断定・検証不能な実績数値と判定された）を受けて、
// プロンプトの時点でこれらの語をそもそも出さない表現に変更。
// 店舗の正式名称「肩こり頭痛改善専門 整体院トゥルース」は固有名詞なのでそのまま使う。
const SALON_PROFILE = `
肩こり頭痛改善専門 整体院トゥルース（ボディコーディネートサロン Truth）
所在地: 新潟県長岡市
得意分野: 肩こり・頭痛・姿勢・骨盤のケアを中心とした整体
特徴: 骨格のバランスに着目したケアを行っており、多くのお客様にご利用いただいています
初回限定: 通常12,000円→4,680円（税込・施術40分・1日3名限定）
`;

// =====================================
// エキテン掲載NGワード対策（2026-09-26 審査却下対応）
// エキテンの店舗情報掲載ガイドライン（https://www.ekiten.jp/documents/attention.html）は
// 「効果の断定・保証」「誇大表現」「根拠のない優位性の最上級表現」「検証できない実績数値」を
// 掲載NGとしている。却下メール(support@ekiten.jp, 2026-09-26)の指摘は
// 「改善／施術の効果を保証する表現」で、実際に却下された記事には
// 「根本改善」「改善をサポート」「理想のボディラインへと導きます」
// 「背骨のゆがみ改善を専門とし」「Google口コミ130件以上の実績」が含まれていた。
//
// プロンプトの指示だけでは（LLMが指示を破ることがあるため）保証にならないので、
// 生成後に必ずこの対応表で機械的に検問する。ここに追加していけば対応できる。
// 順序が重要: 文法が壊れないよう、より具体的（長い）言い回しを先に処理してから
// 単語単位の汎用置換にフォールバックする。
// =====================================

// 店舗の正式名称は固有名詞なので判定対象から除外する（マスクしてから検問する）。
// 長い名称を先に判定しないと、短い名称が先にマスクされて残った断片が誤検知される。
const STORE_NAME_EXEMPT = [
  '肩こり頭痛改善専門 整体院トゥルース',
  '整体院トゥルース',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskStoreNames(text) {
  const placeholders = [];
  let masked = text;
  for (const name of STORE_NAME_EXEMPT) {
    const re = new RegExp(escapeRegExp(name), 'g');
    masked = masked.replace(re, () => {
      const token = `\u0000SN${placeholders.length}\u0000`;
      placeholders.push(name);
      return token;
    });
  }
  return { masked, placeholders };
}

function unmaskStoreNames(text, placeholders) {
  let out = text;
  placeholders.forEach((name, i) => {
    out = out.split(`\u0000SN${i}\u0000`).join(name);
  });
  return out;
}

// [検出パターン(g付き正規表現), 置換後の文字列, 分類ラベル]
// 分類ラベルはログ表示用。置換後の文字列は「置換後も日本語として自然か」を
// 実際の生成物で確認しながら調整すること（機械的な単語置換は不自然になりやすい）。
const NG_REPLACEMENTS = [
  // --- 検証不能・変動する実績数値（フレーズ単位。文末の述語まで含めて置換する） ---
  [/Google口コミ\d+件以上の実績(があります|を誇ります|です)?/g, '多くのお客様にご利用いただいています', '実績数値(口コミ件数)'],
  [/口コミ\d+件以上(の実績)?(があります|を誇ります|です)?/g, '多くのお客様にご利用いただいています', '実績数値(口コミ件数)'],
  [/\d+件以上の実績(があります|を誇ります|です)?/g, '多くのお客様にご利用いただいています', '実績数値(件数)'],
  [/満足度\d+%/g, '多くのお客様にご満足いただいています', '実績数値(満足度)'],

  // --- 効果の断定・保証（フレーズ単位を先に。生の単語置換は最後） ---
  [/ゆがみ改善/g, 'ゆがみのケア', '効果断定(改善)'],
  [/根本改善をサポート/g, '根本へのアプローチをサポート', '効果断定(根本改善)'],
  // 「を根本改善！」のような体言止め・感嘆形でも自然に読めるよう「根本ケア」に寄せる
  // （「根本へのアプローチ」は名詞句で、をサポート等の述語が続かないと体言止めで不自然になるため）
  [/根本改善/g, '根本ケア', '効果断定(根本改善)'],
  [/姿勢を整えます/g, '姿勢のケアをサポートします', '効果断定(姿勢を整える)'],
  [/姿勢を整える/g, '姿勢のケアをサポートする', '効果断定(姿勢を整える)'],
  [/姿勢を整え/g, '姿勢のケアをサポートし', '効果断定(姿勢を整える)'],
  [/改善をサポート/g, 'ケアをサポート', '効果断定(改善)'],
  [/改善します/g, 'ケアします', '効果断定(改善)'],
  [/改善/g, 'ケア', '効果断定(改善)'],
  [/解消し/g, '和らげ', '効果断定(解消)'],
  [/解消/g, '緩和', '効果断定(解消)'],
  [/治療/g, '施術', '医療的断定(治療)'],
  [/完治/g, '症状が落ち着くこと', '効果断定(完治)'],
  [/必ず/g, 'ぜひ', '効果断定(必ず)'],
  [/確実に/g, 'しっかりと', '効果断定(確実に)'],
  [/即効/g, '早めの', '効果断定(即効)'],
  // 「治る」は活用で語形が変わる(治ります/治った等は「治る」を部分文字列に含まない)ため、
  // 主要な活用形をそれぞれ個別に用意する(辞書形「治る」は最後のフォールバック)。
  [/治りました/g, '楽になりました', '効果断定(治る)'],
  [/治りますように/g, '楽になりますように', '効果断定(治る)'],
  [/治ります/g, '楽になります', '効果断定(治る)'],
  [/治って/g, '楽になって', '効果断定(治る)'],
  [/治った/g, '楽になった', '効果断定(治る)'],
  [/治れば/g, '楽になれば', '効果断定(治る)'],
  [/治る/g, '楽になる', '効果断定(治る)'],
  [/100%/g, '', '効果断定(100%)'],

  // --- 効果の暗示 ---
  [/へと導きます/g, 'を目指すお手伝いをします', '効果暗示(導く)'],
  [/へ導きます/g, 'を目指すお手伝いをします', '効果暗示(導く)'],
  [/を導きます/g, 'をサポートします', '効果暗示(導く)'],
  [/導きます/g, 'サポートします', '効果暗示(導く)'],
  [/導いて/g, 'サポートして', '効果暗示(導く)'],
  [/導いた/g, 'サポートした', '効果暗示(導く)'],
  [/導く/g, 'サポートする', '効果暗示(導く)'],
  [/が良くなります/g, 'が楽になることを目指します', '効果暗示(良くなる)'],
  [/が良くなった/g, 'が楽になることを目指した', '効果暗示(良くなる)'],
  [/が良くなる/g, 'が楽になることを目指す', '効果暗示(良くなる)'],
  [/がなくなります/g, 'が軽くなることを目指します', '効果暗示(なくなる)'],
  [/がなくなった/g, 'が軽くなることを目指した', '効果暗示(なくなる)'],
  [/がなくなる/g, 'が軽くなることを目指す', '効果暗示(なくなる)'],
  [/変わります/g, '変化を目指せます', '効果暗示(変わる)'],
  [/変わりました/g, '変化を目指せました', '効果暗示(変わる)'],
  [/変わった/g, '変化した', '効果暗示(変わる)'],

  // --- 優位性の断定（根拠なし・最上級表現） ---
  [/を専門としています/g, 'を得意としています', '優位性断定(専門)'],
  [/を専門とする/g, 'を得意とする', '優位性断定(専門)'],
  [/を専門とし/g, 'を得意とし', '優位性断定(専門)'],
  [/専門とする/g, '得意とする', '優位性断定(専門)'],
  [/専門/g, '得意分野', '優位性断定(専門)'],
  [/業界トップ/g, '', '優位性断定(業界トップ)'],
  [/No\.?\s?1/gi, '', '優位性断定(No1)'],
  [/唯一/g, '', '優位性断定(唯一)'],
  [/最高/g, '', '優位性断定(最高)'],
];

/**
 * NG_REPLACEMENTSを1パス適用するだけ（検問の合否判定はしない）。
 * プロンプトに埋め込む前のキーワード/テーマの下ごしらえなど、
 * 「そもそもNG語を書かせない」ための軽い前処理に使う。
 */
function applyNgReplacements(text) {
  let result = text;
  const applied = [];
  for (const [pattern, replacement, ruleLabel] of NG_REPLACEMENTS) {
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
      applied.push(ruleLabel);
    }
    pattern.lastIndex = 0;
  }
  return { result: result.replace(/[ \t]{2,}/g, ' '), applied };
}

/**
 * 生成後の検問（本チェック）。
 * 店舗名を除外したうえでNG語を対応表で自動言い換えし、
 * それでもNG語が残っていれば投稿させずに例外を投げる
 * （＝却下される記事をそのままエキテンへ投げない）。
 */
function sanitizeForEkiten(text, label) {
  const { masked, placeholders } = maskStoreNames(text);
  const { result: replaced, applied } = applyNgReplacements(masked);
  const finalText = unmaskStoreNames(replaced, placeholders);

  if (applied.length) {
    console.log(`🛡️ エキテン検問: ${label} を自動言い換え (${applied.join(', ')})`);
  }

  // 置換後も店舗名を除いてNG語が残っていないか再チェック
  const { masked: recheckMasked } = maskStoreNames(finalText);
  const remaining = NG_REPLACEMENTS.filter(([pattern]) => {
    pattern.lastIndex = 0;
    const hit = pattern.test(recheckMasked);
    pattern.lastIndex = 0;
    return hit;
  });

  if (remaining.length) {
    const labels = remaining.map(([, , l]) => l).join(', ');
    throw new Error(
      `エキテン検問NG: ${label} に置換しきれないNG表現が残存 (${labels})。この記事は投稿しません。`
    );
  }

  return finalText;
}

function pickSymptom(dayOfYear) {
  return CORE_SYMPTOMS[dayOfYear % CORE_SYMPTOMS.length];
}

/**
 * 【タイトル】【本文】形式の応答を生成させる。
 * どちらかのラベルが欠けている応答は不完全とみなして再生成させる
 * （以前は検証なしでフォールバックしていたため、切れた記事がそのまま公開され得た）。
 */
function callGemini(prompt) {
  return generateText(prompt, {
    temperature: 0.85,
    label: 'ekiten',
    waits: [8000, 15000, 25000, 60000, 90000],
    validate: (text) => {
      if (!text.includes('【タイトル】') || !text.includes('【本文】')) {
        throw new Error(`【タイトル】【本文】が欠落: ${text.slice(0, 120)}`);
      }
    },
  });
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

  // プロンプトに埋め込むキーワード/テーマは、そもそもNG語を書かせないよう
  // 事前に軽く言い換えておく（本チェックは生成後のsanitizeForEkitenで行う）。
  const promptKw = applyNgReplacements(targetKw).result;
  const promptTheme = applyNgReplacements(theme).result;

  const prompt = `
あなたはプロのWebライターです。
整体院のエキテンブログ用の記事を書いてください。

${SALON_PROFILE}

## 記事条件
- テーマ: ${promptTheme}
- 狙うSEOキーワード: 「${promptKw}」
- 作成日: ${dateStr}（${month}月の季節感を自然に入れる）

## 構成ルール（必ず守る）
1. **タイトル**（25〜35字）: 「${promptKw}」を含む、読者が思わずクリックするタイトル
2. **本文**（600〜900字）:
   - 冒頭：読者の悩みに共感（2〜3文）
   - 原因：${coreSymptom}が起きる仕組みを簡単に（3〜4文）
   - セルフケアのヒント（2〜3文）
   - 整体院トゥルースの紹介（2〜3文・「長岡市」を自然に含める）
   - 締め：来院を促す一言 + 初回料金 4,680円（税込）を明記

## エキテン掲載ガイドライン上、絶対に使ってはいけない表現（重要）
エキテンは「施術の効果を保証・断定する表現」「根拠のない優位性の最上級表現」
「検証できない実績数値」の掲載を禁止しており、違反すると審査で掲載自体が却下される。
以下の禁止語は必ず避け、右側の言い換え例のような自然な表現にすること
（言い換えずに禁止語をそのまま書かないこと）。

| 禁止語（使わない） | 言い換え例（こう書く） |
|---|---|
| 改善する／改善をサポート | ケアする／ケアをサポート |
| 根本改善 | 根本へのアプローチ |
| 解消する | 和らげる |
| 治る／完治する | 楽になる／症状が落ち着く |
| 治療 | 施術 |
| 〜へと導きます／〜が良くなります | 〜を目指すお手伝いをします |
| 専門としています | 得意としています |
| 業界トップ／唯一／最高／No.1（根拠のない最上級・優位性表現） | （使わない。書くなら客観的な事実のみ） |
| Google口コミ◯件以上・満足度◯%などの具体的な実績数値 | 多くのお客様にご利用いただいています（具体的な数字は書かない） |
| 必ず／確実に／即効／100% | ぜひ／しっかりと／早めの（断定を避ける） |

- ただし店舗の正式名称「肩こり頭痛改善専門 整体院トゥルース」は固有名詞なので、
  上の禁止語に「改善」「専門」が含まれていても言い換えずにそのまま使ってよい。
- 実在するかどうか確認できない数字（口コミ件数・施術人数・満足度など）を新しく作らないこと。
3. **文体**: 柔らかく親しみやすい・専門的すぎない
4. **段落**: 改行を多用して読みやすく（1段落3〜4文まで）

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

  const rawTitle = titleMatch ? titleMatch[1].trim() : `${targetKw}について`;
  const rawBodyText = bodyMatch ? bodyMatch[1].trim() : raw;

  // 生成後の検問（本チェック）。ここで例外が投げられた場合、呼び出し元
  // （ekiten-batch.js）はエラーとしてログに出して終了し、投稿は行わない。
  const title = sanitizeForEkiten(rawTitle, 'タイトル');
  const bodyText = sanitizeForEkiten(rawBodyText, '本文');

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
