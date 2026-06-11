# body-salon-truth ブログ自動投稿

整体院 Truth の管理画面に、AIが生成した記事を自動投稿するシステム。完全無料構成（Gemini無料枠 + Playwright + ローカル実行）。

## セットアップ（初回のみ）

### 1. Gemini APIキーを取得（無料）
1. https://aistudio.google.com/apikey にアクセス
2. Googleアカウントでログイン
3. 「Create API key」をクリック → コピー

### 2. .envファイルを作成
```bash
cp .env.example .env
```

`.env` を開いて以下を埋める：
- `ADMIN_LOGIN_ID` — 管理画面のID
- `ADMIN_PASSWORD` — 管理画面のパスワード
- `GEMINI_API_KEY` — 上で取得したキー

## 使い方

### 記事生成だけ試す
```bash
npm run generate
```

### ドライラン（投稿せず動作確認）
```bash
npm run post:dry
```
ブラウザが立ち上がり、登録ボタンの直前まで進んで停止します。

### 本番投稿（ブラウザ表示あり）
```bash
npm run post:debug
```

### 本番投稿（バックグラウンド）
```bash
npm run post
```

## 自動実行（Macのcron）

毎朝7時に自動投稿する場合：
```bash
crontab -e
```
以下を追加：
```
0 7 * * * cd "/Users/mt112/Desktop/my files/myfiles/blog-auto-post" && /usr/local/bin/node src/main.js >> cron.log 2>&1
```

## ファイル構成
- `src/login.js` — ログイン処理（Cookie永続化）
- `src/post.js` — Playwrightで投稿フォーム操作
- `src/generate.js` — Gemini APIで記事生成
- `src/main.js` — 全体オーケストレーション
- `src/notify.js` — Discord通知（任意）
- `posts/` — 生成された記事のJSONログ
- `auth.json` — ログインCookie（自動生成、git無視）

## トラブル時
- `debug-*.png` が自動保存されるので状況を確認
- ログイン失敗時は `auth.json` を削除して再実行
