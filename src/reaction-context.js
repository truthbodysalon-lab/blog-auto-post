// =====================================
// 自社サイトの反応データ（keywords/cms-reactions.json）を、毎日のブログ作成に反映する
// 2026-11-08: AI運用ルール/2026-11-08_HPブログは反応データを手本に書く.md
//
// ■ 決め方（LLMを使わない決定論ルール）
//  - 頭痛の枠（1日10枠のうち3枠）を「反応型」にする。題材は「身近な食べ物・飲み物・習慣 × 頭痛」で、
//    まだ記事にしていないものを順番に選ぶ（実測で最も検索されている型）。
//  - 全枠のプロンプトに「実測で反応が良かった記事の型」を短く添える。
//  - データが無い・21日より古い・壊れている日は何もしない（従来どおり。生成は止めない）。
// =====================================
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('keywords/cms-reactions.json');
const MAX_AGE_DAYS = 21;
const REACTION_PER_DAY = 3; // 頭痛の枠の数（DAY_PLANに頭痛は3回）

// 身近な題材（食べ物・飲み物・習慣）。書き足してよい。label=表示名 / kw=狙う検索語 / re=すでに書いたかの判定
export const REACTION_SUBJECTS = [
  { label: 'コーヒー・カフェイン', kw: '頭痛 コーヒー', re: /コーヒー|カフェイン/ },
  { label: 'お茶（緑茶・麦茶）', kw: '頭痛 お茶', re: /緑茶|麦茶|ほうじ茶|紅茶|お茶/ },
  { label: 'お酒（ビール・ワイン）', kw: '頭痛 お酒', re: /お酒|ビール|ワイン|アルコール|二日酔い/ },
  { label: '炭酸水・炭酸飲料', kw: '頭痛 炭酸', re: /炭酸/ },
  { label: '牛乳・ヨーグルト', kw: '頭痛 牛乳', re: /牛乳|ヨーグルト|乳製品/ },
  { label: '水分不足・水の飲み方', kw: '頭痛 水分不足', re: /水分|水を飲/ },
  { label: 'スポーツドリンク', kw: '頭痛 スポーツドリンク', re: /スポーツドリンク|経口補水/ },
  { label: 'チョコレート', kw: '頭痛 チョコレート', re: /チョコ/ },
  { label: 'チーズ', kw: '頭痛 チーズ', re: /チーズ/ },
  { label: 'パン・小麦', kw: '頭痛 パン', re: /小麦|パン|グルテン/ },
  { label: 'ナッツ', kw: '頭痛 ナッツ', re: /ナッツ|アーモンド|くるみ/ },
  { label: 'バナナ', kw: '頭痛 バナナ', re: /バナナ/ },
  { label: '味噌汁', kw: '頭痛 味噌汁', re: /味噌/ },
  { label: 'お酢', kw: '頭痛 お酢', re: /お酢|酢/ },
  { label: '生姜', kw: '頭痛 生姜', re: /生姜|しょうが|ショウガ/ },
  { label: '納豆', kw: '頭痛 納豆', re: /納豆/ },
  { label: '卵', kw: '頭痛 卵', re: /卵|たまご/ },
  { label: '白米・糖質', kw: '頭痛 糖質', re: /糖質|白米|ご飯|炭水化物/ },
  { label: '朝食を抜く・空腹', kw: '頭痛 空腹', re: /空腹|朝食|食事を抜/ },
  { label: '夜遅い食事', kw: '頭痛 夜遅い食事', re: /夜遅い|夜食|遅い食事/ },
  { label: '辛いもの', kw: '頭痛 辛いもの', re: /辛い|唐辛子|カプサイシン/ },
  { label: '冷たいもの・アイス', kw: '頭痛 アイス', re: /アイス|冷たいもの|かき氷/ },
  { label: 'お風呂・入浴', kw: '頭痛 お風呂', re: /お風呂|入浴|湯船|シャワー/ },
  { label: '睡眠不足・寝すぎ', kw: '頭痛 寝すぎ', re: /睡眠|寝すぎ|寝不足|二度寝/ },
  { label: '枕の高さ', kw: '頭痛 枕', re: /枕/ },
  { label: 'スマホの見すぎ', kw: '頭痛 スマホ', re: /スマホ|スマートフォン/ },
  { label: 'マスク', kw: '頭痛 マスク', re: /マスク/ },
  { label: 'エアコン・冷房', kw: '頭痛 エアコン', re: /エアコン|冷房|暖房/ },
  { label: '車の運転', kw: '頭痛 運転', re: /運転/ },
  { label: '歯の食いしばり', kw: '頭痛 食いしばり', re: /食いしばり|歯ぎしり/ },
  { label: 'メガネ・視力', kw: '頭痛 メガネ', re: /メガネ|眼鏡|視力|老眼/ },
  { label: 'ヒールの靴・靴選び', kw: '頭痛 ヒール', re: /ヒール|靴/ },
  { label: '重いバッグ・リュック', kw: '頭痛 バッグ', re: /バッグ|リュック|カバン/ },
  { label: 'ヘアゴム・髪を結ぶ（ポニーテール）', kw: 'ポニーテール 頭痛', re: /ポニーテール|ヘアゴム|髪を結/ },
  { label: '朝日・日光', kw: '頭痛 日光', re: /日光|朝日|まぶしい|光/ },
  { label: '雪かき', kw: '頭痛 雪かき', re: /雪かき|除雪/ },
  { label: '深呼吸・呼吸', kw: '頭痛 深呼吸', re: /深呼吸|呼吸/ },
  { label: 'ストレッチ・軽い運動', kw: '頭痛 ストレッチ', re: /ストレッチ|軽い運動|ヨガ/ },
];

// 「身近な題材」かどうかの判定（勝ちパターンの共通点を数えるため）
const EVERYDAY_RE = new RegExp(REACTION_SUBJECTS.map(s => s.re.source).join('|') + '|塩|梅干|ジュース|油|散歩|歩|座椅子|畳|いびき|晴れ');
const QUESTION_RE = /[？?]|なぜ|どうして|って/;
const EXPERT_RE = /整体師|院長|専門院|専門家/;

export const normTitle = (t) => String(t || '').split(' | ')[0].replace(/\s+/g, ' ').trim();
const flags = (title) => ({ question: QUESTION_RE.test(title), expert: EXPERT_RE.test(title), everyday: EVERYDAY_RE.test(title) });
const count = (titles, key) => titles.filter(t => flags(t)[key]).length;

const safeDecode = (u) => { try { return decodeURIComponent(u); } catch { return String(u); } };
const JUNK_QUERY = /same category|同じカテゴリー|個人情報|トゥルース|柳原町|ゆるみ|^["”“]/;

function publishedAtOf(url) {
  const m = safeDecode(url).match(/detail\/(\d{4})(\d{2})(\d{2})\d{6}/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// 収集した生データ → 手本記事・勝ちパターン・あと一押しの検索語
export function summarize(raw, { history = [], titleOf = null } = {}) {
  const pv = new Map();
  for (const [t, v] of raw.pv3m || []) pv.set(normTitle(t), (pv.get(normTitle(t)) || 0) + Number(v || 0));
  const dur = new Map();
  for (const row of raw.sessions3m || []) {
    const [t, s, d] = row;
    const k = normTitle(t);
    const cur = dur.get(k) || { s: 0, tot: 0 };
    cur.s += Number(s || 0); cur.tot += Number(s || 0) * Number(d || 0);
    dur.set(k, cur);
  }
  const avgDur = (k) => { const c = dur.get(k); return c && c.s ? Math.round(c.tot / c.s) : null; };

  // 検索データをページ単位にまとめる
  const pages = new Map();
  const queries = new Map();
  for (const r of raw.scPage3m || []) {
    const [q, url] = r.keys || [];
    if (!q || !url) continue;
    const p = pages.get(url) || { url, clicks: 0, impressions: 0, q: [] };
    p.clicks += r.clicks; p.impressions += r.impressions; p.q.push({ q, clicks: r.clicks, impressions: r.impressions, position: r.position });
    pages.set(url, p);
    const a = queries.get(q) || { query: q, clicks: 0, impressions: 0, posW: 0 };
    a.clicks += r.clicks; a.impressions += r.impressions; a.posW += r.position * r.impressions;
    queries.set(q, a);
  }
  const candidatePages = [...pages.values()]
    .filter(p => safeDecode(p.url).includes('/detail/') && p.clicks >= 3)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .map(p => ({ ...p, topQueries: p.q.sort((x, y) => y.clicks - x.clicks || y.impressions - x.impressions).slice(0, 5).map(x => x.q), publishedAt: publishedAtOf(p.url) }));

  const winners = [];
  for (const p of candidatePages) {
    const title = normTitle(titleOf ? titleOf(p.url) : '') || `（題名未取得）${p.topQueries[0] || ''}`;
    const k = normTitle(title);
    const pv3m = pv.get(k) ?? null;
    const avgDurationSec = avgDur(k);
    const ok = p.clicks >= 8 || ((pv3m ?? 0) >= 30 && (avgDurationSec ?? 0) >= 30);
    if (!ok) continue;
    winners.push({ title, url: p.url, clicks: p.clicks, impressions: p.impressions, pv3m, avgDurationSec, publishedAt: p.publishedAt, topQueries: p.topQueries, score: p.clicks * 3 + (pv3m ?? 0) });
  }
  // 同じ記事が別URL（サイト内の別ページ）で出ることがあるため、題名でまとめる（PVは二重に数えない）
  const merged = new Map();
  for (const w of winners) {
    const k = normTitle(w.title);
    const m = merged.get(k);
    if (!m) { merged.set(k, { ...w, topQueries: [...w.topQueries] }); continue; }
    m.clicks += w.clicks; m.impressions += w.impressions;
    for (const q of w.topQueries) if (!m.topQueries.includes(q)) m.topQueries.push(q);
    if (w.publishedAt && (!m.publishedAt || w.publishedAt < m.publishedAt)) m.publishedAt = w.publishedAt;
    m.score = m.clicks * 3 + (m.pv3m ?? 0);
  }
  const top = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 8);

  const recent = history.slice(-60).map(h => normTitle(h.title)).filter(Boolean);
  const autoPv = recent.map(t => pv.get(t) ?? 0);
  const winnersAvgPv3m = top.length ? Math.round(top.reduce((s, w) => s + (w.pv3m ?? 0), 0) / top.length) : null;

  const opportunities = [...queries.values()]
    .map(a => ({ query: a.query, clicks: a.clicks, impressions: a.impressions, position: Math.round((a.posW / Math.max(1, a.impressions)) * 10) / 10 }))
    .filter(o => !JUNK_QUERY.test(o.query) && o.impressions >= 80 && o.position < 25 && (o.position >= 5 || o.clicks / o.impressions < 0.03))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  // すでに書いた身近な題材。手本記事のタイトル・自社が検索で拾われている語（＝その題材の記事が既にある）・公開済みの全記事のどこかに出てくるもの
  const allTitles = history.map(h => normTitle(h.title)).filter(Boolean);
  const corpus = [...top.map(w => w.title), ...queries.keys(), ...allTitles].join('\n');
  const coveredSubjects = REACTION_SUBJECTS.filter(s => s.re.test(corpus)).map(s => s.label);
  // 手本記事の検索語から題材の語（塩・梅干し・ジュース等）を取り出して「書いた題材」に足す
  const STOP = /頭痛|頭が|偏頭痛|片頭痛|治る|効く|効果|なぜ|原因|食べる|いたい|痛い|くなる|とは/;
  for (const w of top) {
    const word = w.topQueries.flatMap(q => q.split(/\s+/)).find(t => t && !STOP.test(t));
    if (word && !coveredSubjects.includes(word)) coveredSubjects.push(word);
  }

  const winnerTitles = top.map(w => w.title);
  return {
    winners: top,
    candidatePages: candidatePages.map(p => ({ url: p.url, clicks: p.clicks })),
    winnersAvgPv3m,
    patterns: {
      winners: { n: top.length, question: count(winnerTitles, 'question'), expert: count(winnerTitles, 'expert'), everyday: count(winnerTitles, 'everyday') },
      recentAuto: recent.length ? { n: recent.length, question: count(recent, 'question'), expert: count(recent, 'expert'), everyday: count(recent, 'everyday') } : null,
    },
    autoSeries: recent.length ? { n: recent.length, avgPv3m: Math.round((autoPv.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 } : null,
    opportunities,
    coveredSubjects,
  };
}

// ---------- 生成側が使う ----------
export function loadReactions(now = new Date()) {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!d.fetchedAt || d.status !== 'ok' || !Array.isArray(d.winners) || d.winners.length < 3) return null;
    const age = (now.getTime() - new Date(d.fetchedAt).getTime()) / 86400000;
    return age <= MAX_AGE_DAYS ? d : null;
  } catch {
    return null;
  }
}

// 頭痛の枠だけ「反応型」。題材はまだ書いていない身近な題材から、日替わりで順番に選ぶ（書き終えた題材は公開済み記事のタイトルに出るので自然に外れる）
export function pickReactionTopic(core, { dayIndex = 0, headacheOrdinal = 0, history = [], now = new Date() } = {}) {
  if (core !== '頭痛') return null;
  const data = loadReactions(now);
  if (!data) return null;
  const titles = history.map(h => String(h.title || '')).join('\n');
  const covered = new Set(data.coveredSubjects || []);
  const pool = REACTION_SUBJECTS.filter(s => !covered.has(s.label) && !s.re.test(titles));
  const list = pool.length ? pool : REACTION_SUBJECTS; // 全部書き終えたら最初から（重複はタイトル類似の門前払いが止める）
  const s = list[(dayIndex * REACTION_PER_DAY + headacheOrdinal) % list.length];
  return { keyword: s.kw, theme: `${s.label}と頭痛の関係`, label: s.label };
}

const line = (w) => `- 「${w.title}」（検索クリック${w.clicks}・平均滞在${w.avgDurationSec ?? '—'}秒・主な検索語: ${w.topQueries.slice(0, 3).join(' / ')}）`;

// プロンプトに足す文章。反応型の枠は詳しく、それ以外は短い参考だけ。データが無ければ空文字
export function reactionPromptBlock(topic, now = new Date()) {
  const data = loadReactions(now);
  if (!data) return '';
  const top = data.winners.slice(0, 5);
  const common = `
## 【参考: 自社サイトの実測で反応が良かった記事の型（管理画面のアクセス解析・直近3か月）】
手本にするのは「型」と「読者の関心の切り口」だけ。題材・文章・言い回しは写さない。
${top.map(line).join('\n')}
- 共通点: 読者がそのまま検索する疑問（「なぜ〜？」「〜と頭痛の関係は？」）に、冒頭で直接答える。身近な食べ物・飲み物・習慣を1つに絞って具体的に書く。
`;
  if (!topic?.reactionSlot) return common;
  return `${common}
## 【この回は「反応型」の枠（必ず守る）】
- 題材は「${topic.subtopicTheme}」1つだけ。狙う検索語は「${topic.subtopicKeyword}」。1記事1題材で、その題材の疑問に正面から答える
- すでに書いた題材（書かない）: ${(data.coveredSubjects || []).join('、') || '（なし）'}
- タイトルは読者の疑問形（例:「${topic.subtopicTheme.replace('と頭痛の関係', '')}は頭痛と関係がある？整体師が体の面から整理【長岡市】」の型）。「効く」「治る」「軽減される」「楽になる」と言い切るタイトル・見出しにしない
- 本文は「なぜそう言われるのか（体の仕組み・生活の面）」→「一般的な考え方」→「日常で気をつけたいこと」→「当院ではどう見るか」の順。効果の約束・断定はしない
- 塩分・糖分・カフェイン・お酒など摂り方に注意が要る題材は、「持病がある方・服薬中の方は医師や薬剤師に相談を」の一文を必ず入れる。摂る量の指示・サプリ・薬の話はしない
- 頭痛の専用ページへの内部リンクと、末尾のNAP・注意書きは、これまでのルールどおり必須
`;
}
