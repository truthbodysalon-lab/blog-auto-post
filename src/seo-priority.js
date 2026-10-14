// =====================================
// 週次の順位計測の結果（keywords/seo-priority.json）を、記事テーマの巡回に反映する
// 2026-10-14: Truth経営/SEO/SEO継続の仕組み.md
//
// ■ 決め方（LLMを使わない決定論ルール）
//  - 直近28日の表示回数が10回以上で、平均掲載順位が8〜20位のサブトピック = 「あと一押しの語」
//    → 巡回の中で1周に2回登場させる（boost）。
//  - 順位が7位以内なら、すでに取れているので増やさない。表示が無い語は増やさない
//    （新しい記事は表示が出るまで数週間かかるため、表示0を理由に外さない）。
//  - ファイルが21日より古い／壊れている場合は無視する（古い順位で偏らせない）。
// =====================================
import fs from 'fs';
import path from 'path';

const PRIORITY_FILE = path.resolve('keywords/seo-priority.json');
const MAX_AGE_DAYS = 21;
const MAX_BOOST_PER_SYMPTOM = 3;

export function loadSeoPriority(now = new Date()) {
  try {
    if (!fs.existsSync(PRIORITY_FILE)) return null;
    const p = JSON.parse(fs.readFileSync(PRIORITY_FILE, 'utf8'));
    if (!p.updatedAt || p.status !== 'ok') return null;
    const ageDays = (now.getTime() - new Date(p.updatedAt).getTime()) / 86400000;
    if (!(ageDays <= MAX_AGE_DAYS)) return null;
    return p;
  } catch {
    return null;
  }
}

// そのコア症状で「1周に2回登場させる」サブトピックIDの集合
export function boostedIds(coreSymptom, now = new Date()) {
  const p = loadSeoPriority(now);
  const ids = p?.boost?.[coreSymptom];
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.slice(0, MAX_BOOST_PER_SYMPTOM));
}

// 巡回リストを作る: 基本は全サブトピックを1周、boost対象だけ周の後半にもう1回入れる
export function buildRotation(list, boosted) {
  if (!boosted || boosted.size === 0) return list;
  const extra = list.filter(s => boosted.has(s.id));
  return [...list, ...extra];
}
