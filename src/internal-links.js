import { ZUTSU_PILLAR, isHeadacheArticle } from './seo-config.js';

// =====================================
// 頭痛記事 → 頭痛の専用ページ への内部リンク（必須）
// 2026-10-14 頭痛SEO対策 P2。
//  - 頭痛に関する記事には、専用ページへのリンクを必ず1本入れる。
//  - AIが入れ忘れた／消した場合は、生成後にこのモジュールが確実に補う（AI任せにしない）。
//  - 投稿直前にも hasPillarLink() で再確認する（batch.js）。
// =====================================

export function hasPillarLink(bodyHtml) {
  const html = String(bodyHtml || '');
  // <a href="...nagaoka-seitai-zutsu-truth...">（絶対URL・相対URLどちらも可）
  const re = new RegExp(`<a\\s[^>]*href=["'][^"']*${escapeRe(ZUTSU_PILLAR.pathMarker)}[^"']*["']`, 'i');
  return re.test(html);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// タイトル文字列から決まる固定のアンカー選択（同じ記事なら毎回同じ・記事ごとに分散）
function pickAnchor(title) {
  let h = 0;
  for (const ch of String(title || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return ZUTSU_PILLAR.anchors[h % ZUTSU_PILLAR.anchors.length];
}

export function buildPillarLinkParagraph(title) {
  const anchor = pickAnchor(title);
  return (
    `<p>頭痛全般についての詳しい情報は、` +
    `<a href="${ZUTSU_PILLAR.url}">${anchor}</a>もあわせてご覧ください。</p>`
  );
}

/**
 * 本文HTMLに専用ページへのリンクが無ければ、自然な位置に1段落を差し込む。
 * 位置の優先順: FAQ見出し(<h2>よくある質問)の直前 → 構造化データ<script>の直前 → 末尾。
 * 返り値: { bodyHtml, inserted }
 */
export function ensurePillarLink(bodyHtml, title) {
  const html = String(bodyHtml || '');
  if (hasPillarLink(html)) return { bodyHtml: html, inserted: false };

  const para = buildPillarLinkParagraph(title);
  const faqIdx = html.search(/<h2[^>]*>\s*よくある質問/);
  if (faqIdx >= 0) {
    return { bodyHtml: html.slice(0, faqIdx) + para + '\n' + html.slice(faqIdx), inserted: true };
  }
  const ldIdx = html.search(/<script[^>]*application\/ld\+json/i);
  if (ldIdx >= 0) {
    return { bodyHtml: html.slice(0, ldIdx) + para + '\n' + html.slice(ldIdx), inserted: true };
  }
  return { bodyHtml: html + '\n' + para, inserted: true };
}

/**
 * 記事の最終チェック用。頭痛記事なのにリンクが無ければ問題として返す。
 */
export function checkPillarLink(article, topic = {}) {
  if (!isHeadacheArticle(article, topic)) return [];
  return hasPillarLink(article.bodyHtml) ? [] : ['頭痛記事なのに頭痛の専用ページへの内部リンクが無い'];
}
