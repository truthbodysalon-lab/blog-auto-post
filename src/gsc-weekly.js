// =====================================
// 週次の順位計測（Search Console API・LLM不使用）
// 2026-10-14: Truth経営/SEO/SEO継続の仕組み.md
//
// 毎週日曜（strategy-update.yml に相乗り）に実行し、次を行う。
//  1. 追う語（seo-config.js の TRACKED_KEYWORDS）の表示回数・クリック・平均掲載順位を記録
//     rankings/gsc-weekly.json（履歴）/ rankings/gsc-weekly-latest.md（Obsidian取り込み用）
//  2. 「あと一押し」の記事テーマを keywords/seo-priority.json に出力（topics側が読む）
//  3. Discordに要点3行を通知
//
// ■ Googleの検索結果は読まない（スクレイピング禁止）。Search Console の公式APIだけを使う。
// ■ 権限が無い時は「未認可」と記録してDiscordに手順を通知し、正常終了する（黙って止まらない）。
// ■ 認証: 環境変数 GSC_SA_KEY（サービスアカウント鍵のJSON）→ なければ gsc-credentials.json
// ■ すべての通信にタイムアウトを付ける（ハング対策）。
// =====================================
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { TRACKED_KEYWORDS, ZUTSU_PILLAR } from './seo-config.js';
import { CONTENT_CLUSTERS } from './content-clusters.js';

const HTTP_TIMEOUT_MS = 30000;
const SERVICE_ACCOUNT_EMAIL_HINT = 'blog-keyword-reader@gen-lang-client-0042199399.iam.gserviceaccount.com';
const SITE_CANDIDATES = [
  process.env.GSC_SITE_URL,
  'sc-domain:body-salon-truth.com',
  'https://body-salon-truth.com/',
].filter(Boolean);

const HISTORY_FILE = path.resolve('rankings/gsc-weekly.json');
const LATEST_MD = path.resolve('rankings/gsc-weekly-latest.md');
const PRIORITY_FILE = path.resolve('keywords/seo-priority.json');
const HISTORY_MAX = 60;

// ---------- 純関数（オフラインテスト対象） ----------

const REGION = new Set(['長岡市', '長岡', '新潟', '新潟県']);
const GENERIC = new Set(['整体', '整体院', '頭痛', '肩こり', '姿勢', '骨盤', '骨盤矯正', 'おすすめ', '口コミ']);

function tokensOf(q) {
  return String(q || '').split(/[\s　]+/).filter(Boolean);
}

/** 語順を問わず、追う語と同じ語の組か */
export function matchesTracked(query, tracked) {
  const a = [...new Set(tokensOf(query))].sort().join('|');
  const b = [...new Set(tracked.tokens)].sort().join('|');
  return a === b;
}

/** クエリが、そのサブトピックの特徴語（地域名・整体・頭痛などの一般語を除く）を含むか */
export function matchesSubtopic(query, subtopic) {
  const q = String(query || '').replace(/[\s　]+/g, '');
  const toks = tokensOf(subtopic.keyword).filter(t => !REGION.has(t));
  const distinct = toks.filter(t => !GENERIC.has(t));
  // 特徴語の半分以上（切り上げ）を含めば一致。特徴語が無い場合は全語が必要
  const must = distinct.length > 0 ? distinct : toks;
  const need = distinct.length > 0 ? Math.ceil(must.length / 2) : must.length;
  return must.length > 0 && must.filter(t => q.includes(t)).length >= need;
}

function pageKind(url) {
  try {
    const u = new URL(url);
    if (u.pathname === '/' || u.pathname === '') return 'top';
    if (u.pathname.includes(ZUTSU_PILLAR.pathMarker)) return 'pillar';
    return 'other';
  } catch {
    return 'other';
  }
}

function emptyAgg() {
  return { impressions: 0, clicks: 0, posSum: 0 };
}
function addRow(agg, r) {
  agg.impressions += r.impressions;
  agg.clicks += r.clicks;
  agg.posSum += r.position * r.impressions; // 表示回数で重み付けした平均にする
}
function finish(agg) {
  return {
    impressions: agg.impressions,
    clicks: agg.clicks,
    position: agg.impressions > 0 ? Math.round((agg.posSum / agg.impressions) * 10) / 10 : null,
  };
}

/**
 * rows: [{date:'YYYY-MM-DD', query, page, clicks, impressions, position}]
 * windows: { w7:[from,to], prev7:[from,to], w28:[from,to] }（YYYY-MM-DD の文字列比較で判定）
 */
export function summarize(rows, windows) {
  const inWin = (d, [from, to]) => d >= from && d <= to;
  const tracked = TRACKED_KEYWORDS.map(t => {
    const aggs = { w7: emptyAgg(), prev7: emptyAgg(), w28: emptyAgg() };
    const pages = new Map();
    for (const r of rows) {
      if (!matchesTracked(r.query, t)) continue;
      for (const k of Object.keys(aggs)) if (inWin(r.date, windows[k])) addRow(aggs[k], r);
      if (inWin(r.date, windows.w28)) {
        const p = pages.get(r.page) || { url: r.page, impressions: 0 };
        p.impressions += r.impressions;
        pages.set(r.page, p);
      }
    }
    const w28 = finish(aggs.w28);
    const pageList = [...pages.values()]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 3)
      .map(p => ({
        url: p.url,
        kind: pageKind(p.url),
        impressions: p.impressions,
        share: w28.impressions > 0 ? Math.round((p.impressions / w28.impressions) * 100) : 0,
      }));
    // 専用ページが狙う語で、専用ページ以外が最も表示されている = 食い合いの疑い
    const cannibal = t.pillar && pageList.length > 0 && pageList[0].kind !== 'pillar';
    return {
      id: t.id,
      label: t.label,
      pillar: t.pillar,
      w7: finish(aggs.w7),
      prev7: finish(aggs.prev7),
      w28,
      pages: pageList,
      cannibal,
    };
  });

  // サブトピック（記事テーマ）ごとの28日実績 → あと一押し判定
  const subtopics = [];
  for (const [symptom, cluster] of Object.entries(CONTENT_CLUSTERS)) {
    for (const s of cluster.subtopics) {
      const agg = emptyAgg();
      for (const r of rows) {
        if (inWin(r.date, windows.w28) && matchesSubtopic(r.query, s)) addRow(agg, r);
      }
      const f = finish(agg);
      subtopics.push({ symptom, id: s.id, keyword: s.keyword, ...f });
    }
  }
  return { tracked, subtopics };
}

/** 表示10回以上・平均8〜20位 = あと一押し。症状ごとに表示回数の多い順で最大3件 */
export function decideBoost(subtopics) {
  const boost = {};
  const cand = subtopics
    .filter(s => s.impressions >= 10 && s.position !== null && s.position >= 8 && s.position <= 20)
    .sort((a, b) => b.impressions - a.impressions);
  for (const s of cand) {
    boost[s.symptom] = boost[s.symptom] || [];
    if (boost[s.symptom].length < 3) boost[s.symptom].push(s.id);
  }
  return { boost, candidates: cand };
}

export function jstDateString(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Search Consoleのデータは2〜3日遅れで確定するため、終端は「今日の3日前」 */
export function buildWindows(now = new Date()) {
  const end = addDays(jstDateString(now), -3);
  return {
    end,
    w7: [addDays(end, -6), end],
    prev7: [addDays(end, -13), addDays(end, -7)],
    w28: [addDays(end, -27), end],
  };
}

const fmtPos = x => (x === null ? '-' : `${x}位`);
function trend(cur, prev) {
  if (cur.position === null || prev.position === null) return '';
  const d = Math.round((prev.position - cur.position) * 10) / 10; // 正 = 順位が上がった
  if (Math.abs(d) < 0.5) return '→';
  return d > 0 ? `↑${d}` : `↓${-d}`;
}

export function renderMarkdown(date, windows, summary, boostResult) {
  const L = [];
  L.push(`# SEO週次 ${date}`);
  L.push('');
  L.push(`> 計測期間: 直近7日 ${windows.w7[0]}〜${windows.w7[1]} ／ 28日 ${windows.w28[0]}〜${windows.w28[1]}（Search Console・平均掲載順位は表示回数で重み付け）`);
  L.push('> 注意: 表示が少ない語はGoogleが匿名化して出さないため、「-」は0回ではなく「取得できていない」を含みます。順位の変動は1週で判断せず、4週の流れで見ます。');
  L.push('');
  L.push('## 追っている語');
  L.push('');
  L.push('| 語 | 7日 表示 | 7日 順位 | 前週比 | 28日 表示 | 28日 順位 | クリック(28日) | 表示されたページ |');
  L.push('|---|---:|---:|---|---:|---:|---:|---|');
  for (const t of summary.tracked) {
    const pg = t.pages.length ? t.pages.map(p => `${p.kind}(${p.share}%)`).join(' / ') : '-';
    L.push(`| ${t.label} | ${t.w7.impressions} | ${fmtPos(t.w7.position)} | ${trend(t.w7, t.prev7)} | ${t.w28.impressions} | ${fmtPos(t.w28.position)} | ${t.w28.clicks} | ${pg}${t.cannibal ? ' ⚠食い合い疑い' : ''} |`);
  }
  L.push('');
  L.push('## 次の記事テーマへの反映');
  L.push('');
  const keys = Object.keys(boostResult.boost);
  if (keys.length === 0) {
    L.push('- 「あと一押し」（28日で表示10回以上・平均8〜20位）の記事テーマはまだありません。テーマの巡回は通常どおりです。');
  } else {
    for (const c of boostResult.candidates) {
      const mark = boostResult.boost[c.symptom]?.includes(c.id) ? '【優先】' : '';
      L.push(`- ${mark}${c.symptom}／${c.keyword}（${c.id}）: 表示${c.impressions}回・${fmtPos(c.position)} → 翌週から巡回で1周に2回`);
    }
  }
  const seen = summary.subtopics.filter(s => s.impressions > 0).length;
  L.push(`- 28日で表示があった記事テーマ: ${seen} / ${summary.subtopics.length}（表示0のテーマは自動では外しません。新しい記事は表示が出るまで数週間かかるため）`);
  const cann = summary.tracked.filter(t => t.cannibal);
  if (cann.length) {
    L.push('');
    L.push('## 食い合いの疑い（専用ページ以外が表示されている語）');
    for (const t of cann) L.push(`- ${t.label}: ${t.pages.map(p => `${p.url}（${p.share}%）`).join('、')}`);
    L.push('→ 該当記事のtitleを周辺語へ寄せ、頭痛の専用ページへのリンクを確認する（人が判断）。');
  }
  L.push('');
  return L.join('\n');
}

// ---------- 入出力 ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

async function sendDiscord(content) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1900) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.warn(`Discord通知失敗 HTTP ${res.status}`);
  } catch (e) {
    console.warn(`Discord通知失敗: ${String(e.message).slice(0, 80)}`); // URLは出さない
  }
}

function loadCredentials() {
  const env = process.env.GSC_SA_KEY;
  if (env && env.trim()) {
    try {
      return JSON.parse(env);
    } catch {
      try {
        return JSON.parse(Buffer.from(env, 'base64').toString('utf8'));
      } catch {
        return 'invalid';
      }
    }
  }
  const f = path.resolve('gsc-credentials.json');
  if (fs.existsSync(f)) return readJson(f, 'invalid');
  return null;
}

const MANUAL_STEPS =
  '🙋手動操作のお願い（SEO週次計測・1回だけ）\n' +
  '1) Search Console → 設定 → ユーザーと権限 → ユーザーを追加\n' +
  `   ${SERVICE_ACCOUNT_EMAIL_HINT} を「制限付き」で追加\n` +
  '2) GitHubのSecret登録: ターミナルで gh secret set GSC_SA_KEY -R truthbodysalon-lab/blog-auto-post < blog-auto-postフォルダ/gsc-credentials.json\n' +
  '詳細: Obsidian Truth経営/SEO/SEO継続の仕組み.md';

async function fetchAllRows(sc, siteUrl, start, end) {
  const rows = [];
  const PAGE = 25000;
  for (let startRow = 0; startRow < 200000; startRow += PAGE) {
    const res = await sc.searchanalytics.query(
      {
        siteUrl,
        requestBody: {
          startDate: start,
          endDate: end,
          dimensions: ['date', 'query', 'page'],
          rowLimit: PAGE,
          startRow,
          dataState: 'final',
        },
      },
      { timeout: HTTP_TIMEOUT_MS },
    );
    const got = res.data.rows || [];
    for (const r of got) {
      rows.push({
        date: r.keys[0], query: r.keys[1], page: r.keys[2],
        clicks: r.clicks || 0, impressions: r.impressions || 0, position: r.position || 0,
      });
    }
    if (got.length < PAGE) break;
  }
  return rows;
}

function recordRun(run) {
  const hist = readJson(HISTORY_FILE, { runs: [] });
  hist.runs = [...(hist.runs || []), run].slice(-HISTORY_MAX);
  writeJson(HISTORY_FILE, hist);
}

async function main() {
  const now = new Date();
  const date = jstDateString(now);
  const windows = buildWindows(now);

  const cred = loadCredentials();
  if (cred === null || cred === 'invalid') {
    const status = cred === null ? 'no_credentials' : 'invalid_credentials';
    recordRun({ date, status });
    console.log(`⚠️ GSC: ${status}（鍵が未登録／壊れている）`);
    await sendDiscord(`⚠️ SEO週次計測は実行できませんでした（${status}）\n${MANUAL_STEPS}`);
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: cred,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });

  let siteUrl = null;
  try {
    const list = await sc.sites.list({}, { timeout: HTTP_TIMEOUT_MS });
    const owned = (list.data.siteEntry || []).map(s => s.siteUrl);
    siteUrl = SITE_CANDIDATES.find(c => owned.includes(c)) || null;
    if (!siteUrl) {
      recordRun({ date, status: 'unauthorized', visibleSites: owned.length });
      console.log('⚠️ GSC: このサービスアカウントに見えるサイトがありません（権限未付与）');
      await sendDiscord(`⚠️ SEO週次計測: Search Consoleの権限が未付与です（見えるサイト${owned.length}件）\n${MANUAL_STEPS}`);
      return;
    }
  } catch (e) {
    recordRun({ date, status: 'error', message: String(e.message).slice(0, 120) });
    await sendDiscord(`❌ SEO週次計測エラー（sites.list）: ${String(e.message).slice(0, 120)}`);
    process.exitCode = 1;
    return;
  }

  let rows;
  try {
    rows = await fetchAllRows(sc, siteUrl, windows.w28[0], windows.w28[1]);
  } catch (e) {
    recordRun({ date, status: 'error', message: String(e.message).slice(0, 120) });
    await sendDiscord(`❌ SEO週次計測エラー（query）: ${String(e.message).slice(0, 120)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`GSC: ${rows.length}行取得（${siteUrl} ${windows.w28[0]}〜${windows.w28[1]}）`);

  const summary = summarize(rows, windows);
  const boostResult = decideBoost(summary.subtopics);
  const md = renderMarkdown(date, windows, summary, boostResult);

  fs.mkdirSync(path.dirname(LATEST_MD), { recursive: true });
  fs.writeFileSync(LATEST_MD, md);
  recordRun({
    date, status: 'ok', siteUrl, rows: rows.length, windows,
    tracked: summary.tracked.map(t => ({ id: t.id, w7: t.w7, w28: t.w28, cannibal: t.cannibal })),
    boost: boostResult.boost,
  });
  writeJson(PRIORITY_FILE, {
    updatedAt: now.toISOString(),
    status: 'ok',
    source: 'gsc',
    rule: '28日で表示10回以上・平均8〜20位のサブトピックを巡回で1周に2回登場させる',
    boost: boostResult.boost,
  });

  const head = summary.tracked.filter(t => t.pillar).slice(0, 3);
  const line1 = head.map(t => `${t.label} ${fmtPos(t.w28.position)}/表示${t.w28.impressions}`).join('、');
  const line2 = Object.keys(boostResult.boost).length
    ? `優先テーマ: ${boostResult.candidates.slice(0, 3).map(c => `${c.keyword}(${fmtPos(c.position)})`).join('、')}`
    : '優先テーマ: 該当なし（巡回は通常どおり）';
  const cann = summary.tracked.filter(t => t.cannibal).length;
  const line3 = cann ? `⚠食い合い疑い${cann}語（詳細はObsidian Truth経営/SEO/週次）` : '食い合い疑い: なし';
  await sendDiscord(`📈 SEO週次 ${date}\n${line1}\n${line2}\n${line3}`);
  console.log(md);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch(async e => {
    console.error('gsc-weekly失敗:', e.message);
    await sendDiscord(`❌ SEO週次計測が失敗: ${String(e.message).slice(0, 150)}`);
    process.exitCode = 1;
  });
}
