/**
 * Google Search Console API
 * 実際の流入クエリ・インプレッション・CTRを取得
 *
 * 【初回セットアップ手順】
 * 1. Google Cloud Console (truth-blog プロジェクト) を開く
 *    https://console.cloud.google.com/apis/library?project=truth-blog
 * 2. "Google Search Console API" を有効化
 * 3. 「IAMと管理」→「サービスアカウント」→ 新規作成
 *    名前: blog-keyword-reader
 * 4. キーを作成（JSON形式）→ ダウンロード
 * 5. ダウンロードしたJSONを blog-auto-post/gsc-credentials.json に保存
 * 6. Search Console (https://search.google.com/search-console) を開く
 *    設定 → ユーザーと権限 → ユーザーを追加
 *    サービスアカウントのメールアドレスを「閲覧者」で追加
 * 7. .env に追記: GSC_SITE_URL=https://body-salon-truth.com/
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const CREDENTIALS_PATH = path.resolve('gsc-credentials.json');
const SITE_URL = process.env.GSC_SITE_URL || 'https://body-salon-truth.com/';

export async function fetchGSCQueries(days = 90) {
  try {
    // 認証: Application Default Credentials (gcloud auth application-default login) を優先
    // → なければサービスアカウントキー (gsc-credentials.json) を使用
    let auth;
    const ADC_PATH = `${process.env.HOME}/.config/gcloud/application_default_credentials.json`;
    if (fs.existsSync(ADC_PATH)) {
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      });
    } else if (fs.existsSync(CREDENTIALS_PATH)) {
      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      });
    } else {
      console.warn('  ⚠️ GSC: 認証情報が見つかりません。スキップします。');
      return [];
    }

    const searchconsole = google.searchconsole({ version: 'v1', auth });


    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const fmt = d => d.toISOString().slice(0, 10);

    console.log(`  🔍 GSC: 過去${days}日のクエリ取得中 (${fmt(startDate)} 〜 ${fmt(endDate)})`);

    const res = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        dimensions: ['query'],
        rowLimit: 100,
        dataState: 'final',
      },
    });

    const rows = res.data.rows || [];
    console.log(`  → ${rows.length}件のクエリを取得`);

    return rows.map(r => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
  } catch (e) {
    console.warn(`  ⚠️ GSC エラー: ${e.message.slice(0, 120)}`);
    return [];
  }
}
