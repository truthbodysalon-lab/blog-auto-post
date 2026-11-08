// =====================================
// 管理画面（アクセス解析・Search Console連携）から「反応の良い記事」を集める（読み取り専用）
// 2026-11-08: AI運用ルール/2026-11-08_HPブログは反応データを手本に書く.md
//
//  - 取るもの: ページビュー/セッション（期間別）と、検索語×ページのクリック・表示・順位
//  - 出力    : keywords/cms-reactions.json（生成が読む）/ rankings/cms-reactions-latest.md（人が読む）
//  - どちらも .gitignore 済み（公開リポジトリにアクセス数を出さない）
//  - 通信はすべてタイムアウト付き。取れなかった項目は null/空にして、取れた分だけで書く（止まらない）
//  - 投稿・設定変更は一切しない
//
// 使い方: node src/cms-reactions.js            （収集して保存）
//         CMS_REACTIONS_DRY=1 node ...          （保存せず要約だけ表示）
// =====================================
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getBrowserContext, ensureLoggedIn } from './login.js';
import { summarize } from './reaction-context.js';

const OUT_JSON = path.resolve('keywords/cms-reactions.json');
const OUT_MD = path.resolve('rankings/cms-reactions-latest.md');
const OBSIDIAN_MD = '/Users/mt112/Desktop/my files/myfiles/AI運用ルール/ブログ反応データ_最新.md';
const FETCH_TIMEOUT_MS = 60000;
const PAGE_TITLE_TIMEOUT_MS = 20000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function readJsonSafe(f, dflt) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; }
}

// ---------- ブラウザ内でのデータ取得 ----------
async function postInPage(page, url, params) {
  return page.evaluate(async ({ url, params, timeoutMs }) => {
    const csrf = document.querySelector('input[name=_csrfToken]')?.value || '';
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(params),
      });
      const text = await res.text();
      try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null }; }
    } catch (e) {
      return { status: 'ERR', json: null, error: String(e) };
    } finally { clearTimeout(to); }
  }, { url, params, timeoutMs: FETCH_TIMEOUT_MS });
}

async function collectRaw() {
  const raw = { errors: [] };
  const { browser, context } = await getBrowserContext();
  try {
    const page = await context.newPage();
    await ensureLoggedIn(page);
    const base = new URL(process.env.ADMIN_URL).origin;
    await page.goto(`${base}/admin/reports/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    const m = html.match(/id:\s*'(\d+)',\s*\n?\s*token:\s*'([0-9a-f]+)'/);
    if (!m) raw.errors.push('アクセス解析のid/tokenがページから見つからない（画面が変わった可能性）');

    const ga = async (mode) => {
      if (!m) return null;
      const r = await postInPage(page, '/admin/google-analytics/report-data/', { id: m[1], token: m[2], mode });
      if (!Array.isArray(r.json?.rows)) { raw.errors.push(`${mode}: 取得失敗(${r.status})`); return null; }
      return r.json.rows;
    };
    raw.pv3m = await ga('pageViewsRanking_threeMonths');
    raw.pv1m = await ga('pageViewsRanking_oneMonth');
    raw.pv1w = await ga('pageViewsRanking_oneWeek');
    raw.sessions3m = await ga('sessionsRanking_threeMonths');

    const sc = async (mode, flag) => {
      const r = await postInPage(page, '/admin/google-oauth/search-console/', { mode, dimensionflag: flag });
      if (!Array.isArray(r.json?.result)) { raw.errors.push(`検索データ ${mode}/${flag}: 取得失敗(${r.status})`); return null; }
      return r.json.result;
    };
    raw.scPage3m = await sc('threeMonths', 'queryandpage');
    raw.scPage1m = await sc('oneMonth', 'queryandpage');
  } finally {
    await browser.close().catch(() => {});
  }
  return raw;
}

// 公開ページのタイトルを取得（ブラウザ不要・サーバーはHeadlessChrome UAを弾くので通常UAで）
async function fetchArticleTitle(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), PAGE_TITLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const t = (await res.text()).match(/<title>([\s\S]*?)<\/title>/i);
    return t ? t[1].replace(/\s+/g, ' ').trim() : null;
  } catch { return null; } finally { clearTimeout(to); }
}

function mdReport(data) {
  const L = [];
  L.push(`# ブログ反応データ（自社サイトの実測）`);
  L.push('');
  L.push(`- 取得: ${data.fetchedAt}（管理画面のアクセス解析＋Search Console連携・直近3か月）`);
  L.push(`- 状態: ${data.status}${data.errors?.length ? ' / 取得失敗あり: ' + data.errors.join(' ; ') : ''}`);
  L.push(`- 使い方: AI運用ルール/2026-11-08_HPブログは反応データを手本に書く.md`);
  L.push('');
  L.push(`## 手本にする記事（反応が良かった上位）`);
  L.push('');
  L.push(`| # | タイトル | 検索クリック | 表示 | PV(3か月) | 平均滞在 | 公開日 | 主な検索語 |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  (data.winners || []).forEach((w, i) => {
    L.push(`| ${i + 1} | ${w.title} | ${w.clicks} | ${w.impressions} | ${w.pv3m ?? '—'} | ${w.avgDurationSec != null ? w.avgDurationSec + '秒' : '—'} | ${w.publishedAt || '—'} | ${w.topQueries.slice(0, 3).join(' / ')} |`);
  });
  L.push('');
  L.push(`## 勝ちパターン（上位記事の共通点）`);
  L.push('');
  const pt = data.patterns || {};
  L.push(`- 上位${(data.winners || []).length}本のうち: 疑問形タイトル ${pt.winners?.question ?? '—'}本 / 専門家の語り口 ${pt.winners?.expert ?? '—'}本 / 身近な食べ物・飲み物・習慣が題材 ${pt.winners?.everyday ?? '—'}本`);
  if (pt.recentAuto) L.push(`- 直近の自動投稿${pt.recentAuto.n}本のうち: 疑問形 ${pt.recentAuto.question}本 / 専門家の語り口 ${pt.recentAuto.expert}本 / 身近な題材 ${pt.recentAuto.everyday}本`);
  if (data.autoSeries) L.push(`- 直近の自動投稿${data.autoSeries.n}本の平均PV(3か月): ${data.autoSeries.avgPv3m}（手本の上位は平均 ${data.winnersAvgPv3m ?? '—'}）`);
  L.push('');
  L.push(`## あと一押しの検索語（表示が多いのに順位が低い／クリック率が低い）`);
  L.push('');
  (data.opportunities || []).forEach(o => L.push(`- 「${o.query}」 表示${o.impressions} / クリック${o.clicks} / 順位${o.position}`));
  L.push('');
  L.push(`## すでに書いた身近な題材（重複させない）`);
  L.push('');
  L.push((data.coveredSubjects || []).join('、') || '（なし）');
  L.push('');
  return L.join('\n');
}

async function main() {
  const dry = process.env.CMS_REACTIONS_DRY === '1';
  const history = readJsonSafe(path.resolve('posts/history.json'), []);
  const raw = await collectRaw();

  // 手本記事のタイトルは公開ページから取る（検索データはURLしか持たないため）
  const draft = summarize(raw, { history, titleOf: null });
  const need = draft.candidatePages.slice(0, 14);
  const titles = {};
  for (const p of need) {
    titles[p.url] = await fetchArticleTitle(p.url);
  }
  const data = summarize(raw, { history, titleOf: (u) => titles[u] || null });
  data.fetchedAt = new Date().toISOString();
  data.errors = raw.errors;
  data.status = !raw.scPage3m || !raw.pv3m ? 'partial' : 'ok';

  console.log(`[cms-reactions] status=${data.status} winners=${data.winners.length} opportunities=${data.opportunities.length} errors=${raw.errors.length}`);
  data.winners.slice(0, 8).forEach((w, i) => console.log(`  ${i + 1}. clicks=${w.clicks} imp=${w.impressions} pv3m=${w.pv3m ?? '-'} dur=${w.avgDurationSec ?? '-'} ${w.title}`));
  if (dry) return;
  if (data.status === 'partial' && !data.winners.length) {
    console.log('[cms-reactions] 取れた分が無いため既存ファイルを上書きしない');
    process.exitCode = 0;
    return;
  }
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 1));
  const md = mdReport(data);
  fs.writeFileSync(OUT_MD, md);
  // Obsidianへの写し（Grok Bot・Codex・Claudeが同じものを見る）。書けなくても止めない
  try { fs.writeFileSync(OBSIDIAN_MD, md); } catch (e) { console.log(`[cms-reactions] Obsidianへの写しは書けなかった: ${e.message}`); }
  console.log(`[cms-reactions] 保存: ${OUT_JSON}`);
}

main().catch(e => {
  console.error('[cms-reactions] 失敗（既存データはそのまま・生成は止まらない）:', e.message);
  process.exitCode = 0;
});
