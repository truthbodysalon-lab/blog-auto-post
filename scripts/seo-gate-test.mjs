// 頭痛SEO対策（2026-10-14）の仕組みを検査するオフラインテスト。APIキー不要。
//   node scripts/seo-gate-test.mjs
import assert from 'assert';
import { isPillarKeyword, isHeadacheArticle, ZUTSU_PILLAR } from '../src/seo-config.js';
import { ensurePillarLink, hasPillarLink } from '../src/internal-links.js';
import { sanitizeArticle, checkArticle } from '../src/health-claims.js';
import { generateDailyTopics } from '../src/topics.js';
import { CONTENT_CLUSTERS } from '../src/content-clusters.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 専用ページが狙う語の判定
for (const k of ['長岡市 頭痛 整体', '長岡市 整体 頭痛', '長岡 整体 頭痛', '長岡市 頭痛 改善 整体 おすすめ', '長岡市 頭痛']) ok(isPillarKeyword(k), `pillar: ${k}`);
for (const k of ['長岡市 気圧 頭痛 対策', '長岡市 片頭痛 整体 効果', '長岡市 緊張型頭痛 整体', '長岡市 頭痛 セルフケア 自宅', '長岡市 肩こり 整体', '長岡市 肩こり 頭痛 関係']) ok(!isPillarKeyword(k), `peripheral: ${k}`);
for (const [core, c] of Object.entries(CONTENT_CLUSTERS)) for (const s of c.subtopics) ok(!isPillarKeyword(s.keyword), `cluster ${s.id}`);

// 内部リンク
const body = '<h2>原因</h2><p>本文</p><h2>よくある質問</h2><p>Q</p><script type="application/ld+json">{}</script>';
const r = ensurePillarLink(body, 'タイトルA');
ok(r.inserted && hasPillarLink(r.bodyHtml), 'link inserted');
ok(r.bodyHtml.indexOf(ZUTSU_PILLAR.url) < r.bodyHtml.indexOf('よくある質問'), 'link before FAQ');
ok(!ensurePillarLink(r.bodyHtml, 'タイトルA').inserted, 'no double insert');
ok(!hasPillarLink('<a href="https://body-salon-truth.com/other/">x</a>'), 'other link is not pillar');
ok(isHeadacheArticle({ title: '長岡市 気圧頭痛', bodyHtml: '' }, {}), 'headache by title');
ok(!isHeadacheArticle({ title: '長岡市 猫背', bodyHtml: '<p>頭痛</p>' }, { coreSymptom: '姿勢' }), 'not headache');

// 健康表現
const bad = { title: '頭痛が治る整体', naviName: 'x', h1Text: '根本改善', description: '改善率93.7%', keywords: 'a', bodyHtml: '<p>必ず良くなります。完治を目指す。当院の治療。</p>', tags: [] };
const g = sanitizeArticle(bad);
ok(g.blockers.length >= 3, 'blockers detected: ' + JSON.stringify(g.blockers.map(b => b.reason)));
ok(!/治る|根本改善/.test(bad.title + bad.h1Text), 'replaced');
const good = { title: '長岡市の気圧頭痛', naviName: 'n', h1Text: 'h', description: '整体院トゥルースが解説', keywords: 'k', bodyHtml: '<p>医療機関で相談が必要です。必ず医師に相談を。整体は病気を治すものではありません。保証はできません。</p>', tags: [] };
ok(checkArticle(good).length === 0, 'good article passes: ' + JSON.stringify(checkArticle(good)));

// 割り振り: 30日×10枠で、頭痛が専用ページ語にならない・毎日 3/3/2/2・サブトピックが偏らない
const counts = {}; const subs = {};
for (let d = 0; d < 30; d++) for (let h = 7; h <= 16; h++) {
  const now = new Date(Date.UTC(2026, 9, 14 + d, h - 9, 47));
  const t = generateDailyTopics(1, { now })[0];
  ok(!isPillarKeyword(t.subtopicKeyword), 'sub not pillar');
  ok(!isPillarKeyword(t.symptom), 'symptom not pillar: ' + t.symptom);
  counts[t.coreSymptom] = (counts[t.coreSymptom] || 0) + 1;
  subs[t.subtopicId] = (subs[t.subtopicId] || 0) + 1;
}
console.log('30日の症状配分', counts, 'サブトピック種類数', Object.keys(subs).length);
ok(counts['肩こり'] === 90 && counts['頭痛'] === 90 && counts['姿勢'] === 60 && counts['骨盤矯正'] === 60, 'distribution 3/3/2/2');
for (const [core, c] of Object.entries(CONTENT_CLUSTERS)) {
  const v = c.subtopics.map(s => subs[s.id] || 0);
  ok(Math.min(...v) > 0 && Math.max(...v) - Math.min(...v) <= 2, `subtopic spread ${core}: ${v}`);
}
console.log(`OK: ${n} checks passed`);
