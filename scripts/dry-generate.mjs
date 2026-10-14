// 記事を1本だけ生成して検査する（投稿しない）。
//   GEMINI_API_KEY=... node scripts/dry-generate.mjs [JSTの時(7-16)] [出力JSONパス]
import fs from 'fs';
import { generateDailyTopics } from '../src/topics.js';
import { generateArticleForTopic } from '../src/generate.js';
import { publishGateProblems } from '../src/publish-gate.js';
import { hasPillarLink } from '../src/internal-links.js';
import { isHeadacheArticle, isPillarKeyword, ZUTSU_PILLAR } from '../src/seo-config.js';

const hour = parseInt(process.argv[2] || '8', 10);
const out = process.argv[3];
const now = new Date(Date.UTC(2026, 9, 14, hour - 9, 47));
const topic = generateDailyTopics(1, { now })[0];
console.log('TOPIC', JSON.stringify({ core: topic.coreSymptom, kw: topic.subtopicKeyword, theme: topic.subtopicTheme, angle: topic.angle }));
const article = await generateArticleForTopic(topic);
article._topic = { coreSymptom: topic.coreSymptom, subtopicId: topic.subtopicId };
const text = String(article.bodyHtml).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
const links = (article.bodyHtml.match(new RegExp(ZUTSU_PILLAR.pathMarker, 'g')) || []).length;
console.log('RESULT', JSON.stringify({
  title: article.title, h1: article.h1Text, titleIsPillarKw: isPillarKeyword(article.title),
  headacheArticle: isHeadacheArticle(article, topic), hasPillarLink: hasPillarLink(article.bodyHtml), pillarLinkCount: links,
  textLength: text.length, gateProblems: publishGateProblems(article),
}, null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(article, null, 2));
