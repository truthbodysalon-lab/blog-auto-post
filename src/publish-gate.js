import { checkArticle } from './health-claims.js';
import { checkPillarLink } from './internal-links.js';

/**
 * 投稿直前の最終ゲート（batch.js）。生成時のガードをすり抜けた記事を公開させない。
 *  - 健康表現の断定・保証・診断（health-claims.js）
 *  - 頭痛記事なのに頭痛の専用ページへの内部リンクが無い（internal-links.js）
 * 返り値: 問題の文字列配列（空なら投稿してよい）
 */
export function publishGateProblems(article) {
  const problems = [];
  for (const b of checkArticle(article)) problems.push(`${b.field}: ${b.reason}「${b.snippet}」`);
  problems.push(...checkPillarLink(article, article._topic || {}));
  return problems;
}
