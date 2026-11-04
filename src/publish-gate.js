import { checkArticle } from './health-claims.js';
import { checkPillarLink, checkKatakoriLink } from './internal-links.js';
import { isDuplicateTitle } from './topics.js';

/**
 * 投稿直前の最終ゲート（batch.js）。生成時のガードをすり抜けた記事を公開させない。
 *  - 健康表現の断定・保証・診断（health-claims.js）
 *  - 頭痛記事なのに頭痛の専用ページへの内部リンクが無い（internal-links.js）
 *  - 肩こり記事なのに肩こりの専用ページへの内部リンクが無い（internal-links.js）
 *  - 直近の公開済みタイトルと類似（topics.js isDuplicateTitle）
 *    2026-11-04: generate.js は類似タイトルを2回再生成した後もそのまま返すため、ここで止める。
 *    batch.js はこの「タイトル重複」の文言を見て、弾かれた話題を記録する（topic-memory.js）。
 * 返り値: 問題の文字列配列（空なら投稿してよい）
 */
export function publishGateProblems(article) {
  const problems = [];
  for (const b of checkArticle(article)) problems.push(`${b.field}: ${b.reason}「${b.snippet}」`);
  problems.push(...checkPillarLink(article, article._topic || {}));
  problems.push(...checkKatakoriLink(article, article._topic || {}));
  if (article.title && isDuplicateTitle(article.title)) problems.push(`title: タイトル重複（直近の公開済みタイトルと類似）「${article.title}」`);
  return problems;
}
