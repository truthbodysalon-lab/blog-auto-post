// =====================================
// 健康表現ガード（断定・保証・診断の防止）
// 2026-10-14 頭痛SEO対策。トゥルースは整体院であって医療機関ではない。
//  - 「治る」「完治」「必ず」「改善率○%」などの断定・保証は書かない（競合が使っていても真似しない）
//  - 診断ととれる表現（「原因を特定」「〜と診断」）は書かない
//  - 生成後に1) 安全に言い換えられる語は自動で言い換え 2) 言い換えで済まない語が残れば
//    投稿させずに例外（＝再生成）にする。batch.js が投稿直前にもう一度検査する。
// =====================================

// ■ 自動言い換え（文法が崩れない対応表。長い語形を先に）
const REPLACEMENTS = [
  // 根本改善 → 推奨しない（断定ととられやすい）
  [/根本的な改善/g, '根本からのケア', '根本改善'],
  [/根本改善/g, '根本からのケア', '根本改善'],
  // 「治る」系。活用形ごとに個別に（辞書形は部分一致しないため）
  [/治りました/g, '楽になりました', '治る'],
  [/治りますように/g, '楽になりますように', '治る'],
  [/治ります/g, '楽になります', '治る'],
  [/治って/g, '楽になって', '治る'],
  [/治った/g, '楽になった', '治る'],
  [/治れば/g, '楽になれば', '治る'],
  [/治る/g, '楽になる', '治る'],
  // 当院・整体の「治療」→「施術」（病院での治療など、医療機関の話はそのまま）
  [/(当院|トゥルース|整体院?)(では|で|の|は|が)?治療/g, '$1$2施術', '治療'],
  [/確実に/g, 'しっかりと', '確実'],
  [/奇跡の?/g, '', '誇大'],
  // 原因の特定＝診断ととれる
  [/根本原因を特定し(て)?/g, '状態を丁寧に確認し$1', '原因特定'],
  [/原因を特定し(て)?/g, '状態を確認し$1', '原因特定'],
  [/原因を特定(します|する|できます)/g, '状態を確認$1', '原因特定'],
  [/根本原因/g, '背景', '原因断定'],
  // 百分率の効果断定（「100%」単独）
  [/100\s?[%％]|100パーセント/g, '', '100%'],
];

// ■ 言い換えで済まない語（残ったら再生成）。[パターン, 理由]
const BLOCKERS = [
  [/完治|根治/, '完治・根治（治癒の断定）'],
  [/即効/, '「即効」（効果の断定）'],
  [/(改善率|成功率|解消率|満足度|リピート率|症状改善率)/, '改善率などの数値実績'],
  // 効果・満足などの近くにある百分率（一般統計の「約40%が頭痛持ち」は対象外）
  [/\d+(?:\.\d+)?\s?[%％][^。<]{0,8}(改善|効果|満足|解消|軽減|楽に|良くな|成功|リピート)/, '効果を示す百分率'],
  [/(改善|効果|満足|解消|軽減|成功|リピート)[^。<]{0,8}\d+(?:\.\d+)?\s?[%％]/, '効果を示す百分率'],
  // 保証（「保証しません」「保証できません」は否定なので許可）
  [/保証(?!しません|できません|はできません|いたしません|はしておりません|しておりません)/, '保証表現'],
  [/絶対/, '「絶対」（断定）'],
  // 必ず＋効果（「必ず医療機関へ」のような安全の呼びかけは許可）
  [/必ず[^。<]{0,15}(改善|良く|よく|楽に|治|効|消え|なくな|軽く|整う|変わ|解消)/, '「必ず」＋効果（保証）'],
  [/(痛み|頭痛|症状|こり)が(消えます|なくなります|無くなります|消える|なくなる)/, '症状が消えるという断定'],
  [/(診断します|診断できます|診断いたします|診断した結果|診断の結果)/, '診断ととれる表現'],
  [/\bNo\.?\s?1\b|ナンバーワン|地域一番|業界トップ|最高峰/i, '最上級・優位性の断定'],
  // 治す系（「〜を治すものではありません」のような否定は許可）
  [/治(す|します|せます|せる)(?![^。<]{0,14}(ない|ません|ではなく|ではありません))/, '「治す」（治療の断定）'],
];

/**
 * 1つの文字列に言い換えを適用する。
 * 返り値: { text, applied: [ラベル...] }
 */
export function applyReplacements(text) {
  let out = String(text ?? '');
  const applied = [];
  for (const [re, rep, label] of REPLACEMENTS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      applied.push(label);
      re.lastIndex = 0;
      out = out.replace(re, rep);
    }
    re.lastIndex = 0;
  }
  return { text: out, applied };
}

/**
 * 言い換えで済まない語を検出する（言い換え後の文字列に対して使う）。
 * 返り値: [{ reason, snippet }]
 */
export function findBlockers(text) {
  const s = String(text ?? '');
  const found = [];
  for (const [re, reason] of BLOCKERS) {
    const m = s.match(re);
    if (m) {
      const at = m.index ?? 0;
      found.push({ reason, snippet: s.slice(Math.max(0, at - 10), at + m[0].length + 10).replace(/\s+/g, ' ') });
    }
  }
  return found;
}

const TEXT_FIELDS = ['title', 'naviName', 'h1Text', 'description', 'keywords', 'bodyHtml'];

/**
 * 記事オブジェクトの検問。
 *  - 各文字列フィールドに言い換えを適用（記事を直接書き換える）
 *  - 言い換え後もNG語が残るフィールドを集計
 * 返り値: { applied: [ラベル], blockers: [{field, reason, snippet}] }
 */
export function sanitizeArticle(article) {
  const applied = new Set();
  for (const f of TEXT_FIELDS) {
    if (typeof article[f] !== 'string') continue;
    const r = applyReplacements(article[f]);
    article[f] = r.text;
    r.applied.forEach(a => applied.add(a));
  }
  if (Array.isArray(article.tags)) {
    article.tags = article.tags.map(t => applyReplacements(t).text);
  }
  return { applied: [...applied], blockers: checkArticle(article) };
}

/** 書き換えずに検査だけする（投稿直前のゲート用）。言い換え対象の語が残っていてもNG扱い。 */
export function checkArticle(article) {
  const blockers = [];
  for (const f of TEXT_FIELDS) {
    if (typeof article[f] !== 'string') continue;
    const text = article[f];
    for (const b of findBlockers(text)) blockers.push({ field: f, ...b });
    // 言い換え対象語がそのまま残っている＝sanitizeを通っていない
    for (const [re, , label] of REPLACEMENTS) {
      re.lastIndex = 0;
      if (re.test(text)) blockers.push({ field: f, reason: `未処理の表現（${label}）`, snippet: (text.match(re) || [''])[0] });
      re.lastIndex = 0;
    }
  }
  return blockers;
}
