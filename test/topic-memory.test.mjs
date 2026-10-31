// topic-memory.js のテスト（投稿・ログイン・生成AIは使わない。読み書きは一時フォルダだけ）
// 実行: node test/topic-memory.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-memory-'));
process.env.BLOG_HISTORY_FILE = path.join(TMP, 'history.json');
process.env.BLOG_REJECT_FILE = path.join(TMP, 'rejected-subtopics.json');

const M = await import('../src/topic-memory.js');
const { keywordTokens, lastUsedMs, chooseFreshest, recordRejection, loadRejections, isRecentlyRejected, REJECT_DAYS } = M;

const DAY = 86400000;
const NOW = Date.parse('2026-10-31T12:00:00+09:00');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); } };
const pub = (title, daysAgo) => ({ title, t: NOW - daysAgo * DAY });

const A = { id: 'a', keyword: '長岡市 生理痛 骨盤 歪み' };
const B = { id: 'b', keyword: '長岡市 猫背 骨盤 歪み' };
const C = { id: 'c', keyword: '長岡市 肩こり ストレッチ' };
const D = { id: 'd', keyword: '長岡市 膝 痛み' };

console.log('[1] 語の取り出し');
t('長岡市を除いて語に分ける', () => assert.deepEqual(keywordTokens('長岡市 生理痛 骨盤 歪み'), ['生理痛', '骨盤', '歪み']));
t('「長岡市で」も除く', () => assert.deepEqual(keywordTokens('長岡市で 肩こり'), ['肩こり']));
t('空なら空', () => assert.deepEqual(keywordTokens(''), []));

console.log('[2] 最後に使った時刻');
const published = [pub('長岡市 生理痛 骨盤 歪みの関係と秋の姿勢ケア', 5), pub('生理痛と骨盤の歪み？在宅ワーク女性の秋の体ケア', 2), pub('肩こりストレッチ30秒', 8)];
t('語がすべて入ったタイトルの中で最新を返す', () => assert.equal(lastUsedMs(A, published), NOW - 2 * DAY));
t('一部の語しか入っていなければ未使用（猫背が無い）', () => assert.equal(lastUsedMs(B, published), 0));
t('一度も使っていなければ0', () => assert.equal(lastUsedMs(D, published), 0));

console.log('[3] 話題の選び方');
t('公開済みの記録が無ければ従来どおり開始位置', () => assert.equal(chooseFreshest([A, B, C], 1, { published: [], now: NOW }).id, 'b'));
t('未使用の話題を、使った話題より先に選ぶ', () => assert.equal(chooseFreshest([A, C, D], 0, { published, rejections: {}, now: NOW }).id, 'd'));
t('全部使っていれば、最後に使ったのが最も古いものを選ぶ', () =>
  assert.equal(chooseFreshest([A, C], 0, { published, rejections: {}, now: NOW }).id, 'c'));   // A=2日前・C=8日前
t('同点（どちらも未使用）なら開始位置から近い順', () =>
  assert.equal(chooseFreshest([A, B, D], 2, { published: [pub('x', 1)], rejections: {}, now: NOW }).id, 'd'));
t('最近弾かれた話題は外す', () =>
  assert.equal(chooseFreshest([A, B, D], 0, { published, rejections: { b: NOW - DAY, d: NOW - DAY }, now: NOW }).id, 'a'));
t('全部弾かれていれば外さずに選ぶ（止まらない）', () =>
  assert.ok(chooseFreshest([A, C], 0, { published, rejections: { a: NOW, c: NOW }, now: NOW })));
t(`弾かれた記録は${REJECT_DAYS}日で切れる`, () => {
  assert.equal(isRecentlyRejected('b', { b: NOW - (REJECT_DAYS + 1) * DAY }, NOW), false);
  assert.equal(isRecentlyRejected('b', { b: NOW - DAY }, NOW), true);
});
t('順位で「あと一押し」の語（巡回に2回入る）は少し優先される', () => {
  const p = [pub('生理痛 骨盤 歪み', 4), pub('肩こり ストレッチ', 5)];       // A=4日前・C=5日前 → 普通ならC
  assert.equal(chooseFreshest([A, C, A], 0, { published: p, rejections: {}, now: NOW }).id, 'a');  // Aは2回＝3日ぶん古い扱い
});
t('空のリストは null', () => assert.equal(chooseFreshest([], 0, { published, now: NOW }), null));

console.log('[4] 弾かれた話題の記録');
t('記録してファイルに残る', () => { recordRejection('b', NOW); assert.equal(loadRejections().b, NOW); });
t(`${REJECT_DAYS}日より古い記録は書くついでに捨てる`, () => {
  recordRejection('old', NOW - 10 * DAY);
  recordRejection('new', NOW);
  const r = loadRejections();
  assert.equal(r.old, undefined); assert.equal(r.new, NOW);
});
t('subtopicId が無ければ何もしない', () => { const before = JSON.stringify(loadRejections()); recordRejection(undefined, NOW); assert.equal(JSON.stringify(loadRejections()), before); });

console.log('[5] 実データで効果を確かめる（本物の history.json を読むだけ・書き換えない）');
const REAL = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'blog-auto-post-runner', 'posts', 'history.json');
if (fs.existsSync(REAL)) {
  fs.copyFileSync(REAL, process.env.BLOG_HISTORY_FILE);
  fs.writeFileSync(process.env.BLOG_REJECT_FILE, '{}');
  const { CONTENT_CLUSTERS } = await import('../src/content-clusters.js');
  const { boostedIds, buildRotation } = await import('../src/seo-priority.js');
  const { isPillarKeyword } = await import('../src/content-clusters.js').then(m => m).catch(() => ({}));
  const real = M.loadPublished();
  const now = Math.max(...real.map(p => p.t));
  let oldRecent = 0, newRecent = 0, total = 0;
  for (const core of Object.keys(CONTENT_CLUSTERS)) {
    const base = CONTENT_CLUSTERS[core].subtopics.filter(s => !(isPillarKeyword && isPillarKeyword(s.keyword)));
    if (!base.length) continue;
    const list = buildRotation(base, boostedIds(core));
    for (let n = 0; n < list.length; n++) {
      total++;
      const oldPick = list[n], newPick = chooseFreshest(list, n, { published: real, rejections: {}, now });
      if (now - lastUsedMs(oldPick, real) < 9 * DAY) oldRecent++;
      if (now - lastUsedMs(newPick, real) < 9 * DAY) newRecent++;
    }
  }
  console.log(`  全${total}通りの開始位置で、直近9日に公開済みの話題を選んだ回数: 従来 ${oldRecent} → 新方式 ${newRecent}`);
  t('新方式は直近に公開済みの話題を選ぶ回数が従来より少ない', () => assert.ok(newRecent < oldRecent, `従来${oldRecent} 新${newRecent}`));
} else {
  console.log('  （本物の history.json が無いので省略）');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`== 結果: PASS=${pass} FAIL=${fail} ==`);
process.exit(fail ? 1 : 0);
