// オフラインテスト（通信なし）: node scripts/gsc-weekly-test.mjs
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { matchesTracked, matchesSubtopic, summarize, decideBoost, buildWindows, renderMarkdown } from '../src/gsc-weekly.js';
import { TRACKED_KEYWORDS } from '../src/seo-config.js';
import { buildRotation } from '../src/seo-priority.js';
import { CONTENT_CLUSTERS, pickSubtopicByRotation } from '../src/content-clusters.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 語順を問わず一致
const t1 = TRACKED_KEYWORDS.find(t => t.id === 't1');
ok(matchesTracked('長岡市 頭痛 整体', t1), '語順違い');
ok(matchesTracked('長岡市 整体 頭痛', t1), '同順');
ok(!matchesTracked('長岡市 整体 頭痛 原因', t1), '余計な語は別の語');
ok(!matchesTracked('長岡 整体 頭痛', t1), '長岡と長岡市は別');

// サブトピック判定
const z3 = CONTENT_CLUSTERS['頭痛'].subtopics.find(s => s.id === 'zutsu-03');
ok(matchesSubtopic('長岡 気圧 頭痛 雨の日', z3), '特徴語を含む');
ok(!matchesSubtopic('長岡市 頭痛 整体', z3), '一般語だけでは一致しない');

// 集計
const win = buildWindows(new Date('2026-10-18T03:00:00Z')); // JST 10/18正午 → 終端 10/15
ok(win.end === '2026-10-15', '終端は3日前');
ok(win.w7[0] === '2026-10-09' && win.w28[0] === '2026-09-18', '期間');
const mk = (date, query, page, impressions, position, clicks = 0) => ({ date, query, page, impressions, position, clicks });
const rows = [
  mk('2026-10-14', '長岡市 頭痛 整体', 'https://body-salon-truth.com/nagaoka-seitai-shoujyo/nagaoka-seitai-zutsu-truth/', 10, 12),
  mk('2026-10-13', '長岡市 整体 頭痛', 'https://body-salon-truth.com/blog/abc/', 30, 6),
  mk('2026-10-01', '長岡市 整体 頭痛', 'https://body-salon-truth.com/blog/abc/', 20, 9),
  mk('2026-10-12', '長岡 気圧 頭痛', 'https://body-salon-truth.com/blog/kiatsu/', 15, 11),
  mk('2026-09-01', '長岡市 整体 頭痛', 'https://body-salon-truth.com/', 99, 1), // 28日の外
];
const s = summarize(rows, win);
const tr1 = s.tracked.find(t => t.id === 't1');
ok(tr1.w28.impressions === 60, '28日合計=60');
ok(tr1.w28.position === Math.round(((10 * 12 + 30 * 6 + 20 * 9) / 60) * 10) / 10, '表示回数で重み付けした順位');
ok(tr1.w7.impressions === 40, '7日=40');
ok(tr1.pages[0].kind === 'other' && tr1.cannibal === true, 'ブログが最多なら食い合い疑い');
ok(s.tracked.find(t => t.id === 't5').w28.position === null, '表示なしは順位null');
const kz = s.subtopics.find(x => x.id === 'zutsu-03');
ok(kz.impressions === 15 && kz.position === 11, 'サブトピック集計');
const b = decideBoost(s.subtopics);
ok(JSON.stringify(b.boost['頭痛']) === JSON.stringify(['zutsu-03']), '8〜20位・表示10以上でboost');
const md = renderMarkdown('2026-10-18', win, s, b);
ok(md.startsWith('# SEO週次 2026-10-18') && md.includes('食い合い'), 'md');

// 巡回: boostは1周に2回、無ければそのまま
const list = CONTENT_CLUSTERS['頭痛'].subtopics.slice(0, 4);
ok(buildRotation(list, new Set()).length === 4, 'boost無しは不変');
const rot = buildRotation(list, new Set([list[1].id]));
ok(rot.length === 5 && rot.filter(x => x.id === list[1].id).length === 2, 'boostは2回');
ok(rot[1].id !== rot[2].id, '同じテーマが連続しない');

// 優先ファイルが無い時は従来の巡回と同じ
const a = pickSubtopicByRotation('頭痛', 0);
ok(a && a.id, '巡回は従来どおり動く');

// 鍵なしで実行: 一時フォルダで「記録して正常終了」すること（通信しない）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-'));
const out = execFileSync('node', [path.resolve('src/gsc-weekly.js')], {
  cwd: tmp, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8',
});
ok(/no_credentials/.test(out), '鍵なしは no_credentials');
const hist = JSON.parse(fs.readFileSync(path.join(tmp, 'rankings/gsc-weekly.json'), 'utf8'));
ok(hist.runs.at(-1).status === 'no_credentials', '履歴に記録');
ok(!fs.existsSync(path.join(tmp, 'keywords/seo-priority.json')), '未認可時は優先ファイルを書き換えない');

console.log(`gsc-weekly-test: ${n}項目 PASS`);
