// =====================================
// SEO設定（頭痛の専用ページ＝ピラーページ）
// 2026-10-14: 頭痛SEO対策（Truth経営/SEO/頭痛SEO対策_2026-10.md）P1・P2
//
// ■ 方針
//  - 「長岡市 整体 頭痛」「長岡市 頭痛 整体」そのものは頭痛の専用ページだけが狙う。
//    ブログ記事は緊張型・片頭痛・気圧・セルフケア・季節など「周辺語」を担当し、
//    頭痛の専用ページへ内部リンクで評価を集める（自社記事同士の食い合いを防ぐ）。
//  - 専用ページのURLはこのファイル1か所に集約する。
//    専用ページが新URLになったら ZUTSU_PILLAR.url を書き換える（または環境変数
//    ZUTSU_PILLAR_URL で上書き。コード変更なしで差し替え可能）。
//
// 2026-10-14 追加: 肩こりの専用ページ（KATAKORI_PILLAR）も頭痛と同じ仕組みで扱う。
//  - 「長岡市 整体 肩こり」「長岡市 肩こり 整体」そのものは肩こりの専用ページだけが狙う。
//  - 肩こり記事は肩こりの専用ページへ、頭痛記事は頭痛の専用ページへ内部リンクを必須にする
//    （両方の症状を含む記事は両方）。URLは環境変数 KATAKORI_PILLAR_URL でも上書き可。
// =====================================

const DEFAULT_PILLAR_URL =
  'https://body-salon-truth.com/nagaoka-seitai-shoujyo/nagaoka-seitai-zutsu-truth/';

const pillarUrl = (process.env.ZUTSU_PILLAR_URL || DEFAULT_PILLAR_URL).trim();

// URL末尾のスラッグ（本文にリンクが入っているかの判定に使う）
function lastSegment(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

const DEFAULT_KATAKORI_PILLAR_URL =
  'https://body-salon-truth.com/nagaoka-seitai-shoujyo/nagaoka-seitai-katakori/';

const katakoriPillarUrl = (process.env.KATAKORI_PILLAR_URL || DEFAULT_KATAKORI_PILLAR_URL).trim();

export const ZUTSU_PILLAR = {
  // 頭痛の専用ページ。現状は既存の頭痛ページ（書き直し後も同じURLのまま使う予定）
  url: pillarUrl,
  // 本文に既にリンクがあるかを判定する印（URLのスラッグ部分）
  pathMarker: lastSegment(pillarUrl) || 'nagaoka-seitai-zutsu-truth',
  // アンカーテキストの候補。同じ文言ばかりにならないよう記事ごとに切り替える
  anchors: [
    '頭痛でお悩みの方へ｜長岡市の整体院トゥルース',
    '長岡市の頭痛について｜整体院トゥルース',
    '整体院トゥルースの頭痛のページ',
  ],
  // このキーワードの検索1位は専用ページだけが狙う。ブログ記事は狙わない
  reservedKeywords: [
    '長岡市 整体 頭痛',
    '長岡市 頭痛 整体',
    '長岡 整体 頭痛',
    '長岡 頭痛 整体',
    '長岡市 頭痛',
    '頭痛 長岡市',
  ],
};

// 肩こりの専用ページ（ピラーページ）。仕組みは ZUTSU_PILLAR と同じ。
export const KATAKORI_PILLAR = {
  url: katakoriPillarUrl,
  // 本文に既にリンクがあるかを判定する印（URLのスラッグ部分）
  pathMarker: lastSegment(katakoriPillarUrl) || 'nagaoka-seitai-katakori',
  anchors: [
    '肩こりでお悩みの方へ｜長岡市の整体院トゥルース',
    '長岡市の肩こりについて｜整体院トゥルース',
    '整体院トゥルースの肩こりのページ',
  ],
  // このキーワードの検索1位は専用ページだけが狙う。ブログ記事は狙わない
  reservedKeywords: [
    '長岡市 整体 肩こり',
    '長岡市 肩こり 整体',
    '長岡 整体 肩こり',
    '長岡 肩こり 整体',
    '長岡市 肩こり',
    '肩こり 長岡市',
  ],
};

// 「専用ページが狙う語」を判定するときに取り除く一般語。
// これらを取り除いて何も残らないキーワード = 専用ページと同じ語を狙っている。
// （「片頭痛」「気圧」「セルフケア」などの周辺語が残れば、ブログが担当してよい）
// 症状名（頭痛／肩こり）は専用ページごとに stripGeneric で「自分の症状だけ」を取り除く。
// 両方の症状を含む語（長岡市 肩こり 頭痛 関係 など）は周辺語として残す。
const GENERIC_TOKENS = [
  '長岡市', '長岡', '新潟県', '新潟', '整体院', '整体', '院', 'おすすめ',
  'オススメ', '口コミ', '評判', '人気', '安い', '近く', 'ランキング', '専門',
  '改善', '対策', '悩み', 'の', 'で', 'に', 'は', 'を', 'が', 'と',
];

function normalizeKeyword(s) {
  return String(s || '').replace(/[\s　・、,，/／｜|]/g, '');
}

function stripGeneric(keyword, symptomTokens, peripheralRe) {
  let rest = normalizeKeyword(keyword);
  if (!rest) return null;
  // その症状を含まない語は対象外
  if (!symptomTokens.some(t => rest.includes(t))) return null;
  // 「片頭痛」などは周辺語なので、先に印を付けて残す
  if (peripheralRe) rest = rest.replace(peripheralRe, '＠周辺語＠');
  // 長いトークンから順に取り除く
  for (const tok of [...GENERIC_TOKENS, ...symptomTokens].sort((a, b) => b.length - a.length)) {
    rest = rest.split(tok).join('');
  }
  return rest;
}

/**
 * 頭痛の専用ページが狙う語（ブログ記事では狙ってはいけない語）か。
 * 例: 「長岡市 頭痛 整体」「長岡市 頭痛 改善 整体 おすすめ」→ true
 *     「長岡市 気圧 頭痛 対策」「長岡市 片頭痛 整体 効果」→ false
 */
export function isZutsuPillarKeyword(keyword) {
  // 「片頭痛」「偏頭痛」「緊張型頭痛」などは周辺語なので残す
  const rest = stripGeneric(keyword, ['頭痛'], /(片|偏|緊張型|群発|後頭部|慢性)頭痛/g);
  return rest !== null && rest.length === 0;
}

/**
 * 肩こりの専用ページが狙う語（ブログ記事では狙ってはいけない語）か。
 * 例: 「長岡市 肩こり 整体」「長岡市 整体 肩こり おすすめ」→ true
 *     「長岡市 肩こり ストレッチ」「長岡市 デスクワーク 肩こり」→ false
 * 「肩こり」と「頭痛」の両方を含む語（例: 長岡市 肩こり 頭痛 関係）は周辺語として残る。
 */
export function isKatakoriPillarKeyword(keyword) {
  const rest = stripGeneric(keyword, ['肩こり', '肩凝り', '肩コリ'], null);
  return rest !== null && rest.length === 0;
}

/**
 * いずれかの専用ページ（頭痛・肩こり）が狙う語か。
 * ブログのトピック・キーワード選定はこの関数で除外する。
 */
export function isPillarKeyword(keyword) {
  return isZutsuPillarKeyword(keyword) || isKatakoriPillarKeyword(keyword);
}

// 専用ページが狙う語の代わりに、頭痛記事（ブログ）が担当する周辺テーマ。
// content-clusters の頭痛サブトピックが尽きた／使えない時の最終退避先。
export const ZUTSU_PERIPHERAL_FALLBACKS = [
  { keyword: '長岡市 緊張型頭痛 首 肩', theme: '緊張型頭痛と首・肩まわりのこわばり' },
  { keyword: '長岡市 頭痛 種類 違い', theme: '頭痛の種類（緊張型・片頭痛など）と一般的な特徴' },
  { keyword: '長岡市 頭痛 セルフケア 自宅', theme: '自宅でできる頭痛との付き合い方・セルフケア' },
  { keyword: '長岡市 寒暖差 頭痛 秋 冬', theme: '寒暖差が大きい季節の頭痛と過ごし方' },
];

/**
 * 記事が「頭痛に関する記事」か。専用ページへの内部リンクを必須にする対象。
 * トピック指定だけでなく、生成された記事の中身（タイトル・本文の頭痛の登場回数）でも判定する。
 */
export function isHeadacheArticle(article, topic = {}) {
  if ((topic.coreSymptom || '') === '頭痛') return true;
  const head = [article.title, article.h1Text, article.naviName, article.keywords, article.description]
    .filter(Boolean)
    .join(' ');
  if (/頭痛/.test(head)) return true;
  const bodyText = String(article.bodyHtml || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '');
  return (bodyText.match(/頭痛/g) || []).length >= 5;
}

// 肩こりの専用ページが狙う語の代わりに、肩こり記事（ブログ）が担当する周辺テーマ。
export const KATAKORI_PERIPHERAL_FALLBACKS = [
  { keyword: '長岡市 肩こり 原因', theme: '肩こりが起きやすい背景（姿勢・筋肉の緊張・生活習慣）' },
  { keyword: '長岡市 デスクワーク 肩こり', theme: 'デスクワークの肩まわりのこわばりとセルフケア' },
  { keyword: '長岡市 肩こり ストレッチ', theme: '自宅でできる肩まわりのストレッチ' },
  { keyword: '長岡市 冬 肩こり', theme: '寒さで肩まわりが固まりやすい季節の過ごし方' },
];

/**
 * 記事が「肩こりに関する記事」か。肩こりの専用ページへの内部リンクを必須にする対象。
 * 判定は isHeadacheArticle と同じ（トピック指定／タイトル等に肩こり／本文に5回以上）。
 */
export function isKatakoriArticle(article, topic = {}) {
  if ((topic.coreSymptom || '') === '肩こり') return true;
  const head = [article.title, article.h1Text, article.naviName, article.keywords, article.description]
    .filter(Boolean)
    .join(' ');
  if (/肩こり|肩凝り|肩コリ/.test(head)) return true;
  const bodyText = String(article.bodyHtml || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '');
  return (bodyText.match(/肩こり|肩凝り|肩コリ/g) || []).length >= 5;
}

// =====================================
// 週次の順位計測（Search Console）で追う語
// 2026-10-14: 計測の仕組み（Truth経営/SEO/SEO継続の仕組み.md）
//  - 語順は問わない（「長岡市 整体 頭痛」と「長岡市 頭痛 整体」は同じ語として合算する）
//  - pillar: true は専用ページが狙う語（pillarKind 無し=頭痛、'katakori'=肩こり）。ここにブログ記事が表示されたら食い合いの疑い
// =====================================
export const TRACKED_KEYWORDS = [
  { id: 't1', label: '長岡市 整体 頭痛', tokens: ['長岡市', '整体', '頭痛'], pillar: true },
  { id: 't2', label: '長岡 頭痛 整体', tokens: ['長岡', '頭痛', '整体'], pillar: true },
  { id: 't3', label: '長岡市 頭痛', tokens: ['長岡市', '頭痛'], pillar: true },
  { id: 't4', label: '長岡 頭痛', tokens: ['長岡', '頭痛'], pillar: true },
  // 2026-10-14: 肩こりの専用ページも同じ仕組みで追う（pillarKind: 'katakori' = 肩こりの専用ページが担当）
  { id: 't5', label: '長岡市 肩こり 整体', tokens: ['長岡市', '肩こり', '整体'], pillar: true, pillarKind: 'katakori' },
  { id: 't6', label: '長岡 肩こり 整体', tokens: ['長岡', '肩こり', '整体'], pillar: true, pillarKind: 'katakori' },
  { id: 't7', label: '長岡市 整体', tokens: ['長岡市', '整体'], pillar: false },
  { id: 't8', label: '長岡 整体', tokens: ['長岡', '整体'], pillar: false },
];
