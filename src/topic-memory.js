// 話題の記憶 — 公開済みの記事と「公開前チェックで弾かれた話題」を覚えて、同じ話題を選び直さない
//
// なぜ（2026-10-31）: 話題は時刻だけで決まり（topics.js の getClockSlot → content-clusters.js の
// pickSubtopicByRotation）、公開済みを見ていなかった。約50個のサブトピックが4〜9日で一巡し、
// 同じキーワードで始まるタイトルが必ず再登場していた。さらに公開前チェックで弾かれても、同じ時間帯の
// 再実行（post → recovery、代行の連続投稿）は同じ枠＝同じ話題を言い換えるだけだったため、
// 10/27〜10/31の5日で18回弾かれた（全件 類似度0.50以上。しきい値を0.65に上げても13件は通らない）。
//
// 状態は posts/ に置く（.gitignore 済み。run_blog.sh の git reset --hard でも消えない）。
// history.json が無い環境（GitHub Actions のまっさらな実行など）では、従来どおりの順番回しに戻る。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_FILE = () => process.env.BLOG_HISTORY_FILE || path.join(ROOT, 'posts/history.json');
const REJECT_FILE = () => process.env.BLOG_REJECT_FILE || path.join(ROOT, 'posts/rejected-subtopics.json');

const DAY = 86400000;
export const REJECT_DAYS = 3;          // 弾かれた話題を候補から外しておく日数
export const BOOST_BONUS_DAYS = 3;     // 順位計測で「あと一押し」の語は、この日数ぶん古く使ったものとして扱う

// 「長岡市 生理痛 骨盤 歪み」→ ['生理痛', '骨盤', '歪み']。地名は全記事に入るので判定に使わない
export function keywordTokens(keyword) {
  return String(keyword || '')
    .replace(/長岡市[でのにへ]?/g, ' ')
    .split(/[\s　]+/)
    .filter(t => t.length >= 2);
}

// publishAt は「YYYY/MM/DD HH:MM」（JST）
function parsePublishAt(s) {
  const m = String(s || '').match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:00+09:00`) || 0;
}

export function loadPublished() {
  try {
    const items = JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'));
    if (!Array.isArray(items)) return [];
    return items
      .filter(it => it && typeof it.title === 'string')
      .map(it => ({ title: it.title, t: parsePublishAt(it.publishAt) }));
  } catch {
    return [];
  }
}

// そのサブトピックの語がすべて入った公開済みタイトルのうち、最も新しい公開時刻（未使用なら0）
export function lastUsedMs(subtopic, published) {
  const tokens = keywordTokens(subtopic?.keyword);
  if (tokens.length === 0) return 0;
  let last = 0;
  for (const p of published) {
    if (p.t > last && tokens.every(tok => p.title.includes(tok))) last = p.t;
  }
  return last;
}

export function loadRejections() {
  try {
    const r = JSON.parse(fs.readFileSync(REJECT_FILE(), 'utf8'));
    return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
  } catch {
    return {};
  }
}

// 公開前チェック（タイトル類似など）で弾かれた話題を覚える。古い記録は書くついでに捨てる
export function recordRejection(subtopicId, now = Date.now()) {
  if (!subtopicId) return;
  const r = loadRejections();
  r[subtopicId] = now;
  for (const [id, t] of Object.entries(r)) if (now - t > REJECT_DAYS * DAY) delete r[id];
  try {
    fs.mkdirSync(path.dirname(REJECT_FILE()), { recursive: true });
    const tmp = `${REJECT_FILE()}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(r, null, 1));
    fs.renameSync(tmp, REJECT_FILE());
  } catch (e) {
    console.warn(`⚠️ 弾かれた話題の記録に失敗: ${e.message}`);
  }
}

export function isRecentlyRejected(subtopicId, rejections, now = Date.now()) {
  const t = rejections[subtopicId];
  return typeof t === 'number' && now - t <= REJECT_DAYS * DAY;
}

// 巡回リスト（boost の語は2回入っている）から、最後に使ったのが最も古い話題を選ぶ。
//   - 最近弾かれた話題は外す（全部外れるときだけ外さずに選ぶ）
//   - 同点は従来の順番（時刻で決まる開始位置から）で先に来るもの＝挙動が急に変わりすぎない
//   - 公開済みの記録が無ければ、従来どおり開始位置のものを返す
export function chooseFreshest(list, startIdx, opts = {}) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const len = list.length;
  const start = ((startIdx % len) + len) % len;
  const published = opts.published ?? loadPublished();
  if (published.length === 0) return list[start];
  const now = opts.now ?? Date.now();
  const rejections = opts.rejections ?? loadRejections();

  const seen = new Map(); // id → 巡回順の最初の位置と登場回数
  for (let k = 0; k < len; k++) {
    const s = list[(start + k) % len];
    if (!s?.id) continue;
    const e = seen.get(s.id);
    if (e) e.count++; else seen.set(s.id, { s, order: k, count: 1 });
  }
  const pick = (cands) => {
    let best = null;
    for (const c of cands) {
      const score = lastUsedMs(c.s, published) - (c.count > 1 ? BOOST_BONUS_DAYS * DAY : 0);
      if (!best || score < best.score || (score === best.score && c.order < best.order)) best = { ...c, score };
    }
    return best?.s ?? null;
  };
  const all = [...seen.values()];
  const fresh = all.filter(c => !isRecentlyRejected(c.s.id, rejections, now));
  return pick(fresh.length ? fresh : all) ?? list[start];
}
