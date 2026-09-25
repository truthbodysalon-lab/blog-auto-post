"""Audit actual publications on the live site; never fan out supplemental publication jobs
based on CI's own success/failure display (that can be wrong — see 2026-09-24 incident where
CI showed 11 successful runs but only 2 articles were actually published).

当日の達成数は body-salon-truth.com の実サイト（XMLサイトマップ）を取得して数える。
実サイトの取得・パースに失敗した場合は「0件」とみなさず、追加投稿を見送って
Discordで警告するだけに留める（安全側）。

補完投稿は1本失敗しても即座に諦めず、残りの不足分を引き続き試みる
（2026-09-25: 1本失敗で全断ちするとGitHubクーロンの欠けと合わさって
1日分が丸ごと未達になる事故があったため）。
"""
import datetime as dt
import json, os, re, subprocess, time, urllib.error, urllib.request, uuid
import xml.etree.ElementTree as ET

# body-salon-truth.com は Goope 系CMS。トップページの「BLOG」ウィジェットは
# 最新4件しか出ないため（1日10本投稿する運用では不足）、全記事URLと更新日時を
# 持つXMLサイトマップを実際に取得して構造を確認した上でこちらを採用した。
# 確認済み: https://body-salon-truth.com/sitemap/xml/ は
#   <url><loc>https://body-salon-truth.com/.../detail/<slug>/</loc>
#        <lastmod>2026-09-25T01:03:22+09:00</lastmod></url>
# の形式で、自動投稿記事はすべて <loc> に "/detail/" を含む1カテゴリ配下に入る。
SITEMAP_URL = 'https://body-salon-truth.com/sitemap/xml/'
SITEMAP_TIMEOUT_SEC = 30
SITEMAP_NS = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
DISCORD_TIMEOUT_SEC = 10

JST = dt.timezone(dt.timedelta(hours=9))

def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)

def runs():
    return json.loads(gh('run','list','--limit','200','--json','databaseId,workflowName,status,createdAt,displayTitle'))

def successes(run):
    """個々の補完dispatch runが実際に1本投稿できたかをCIログから確認する
    （こちらは1回のトリガーに対する確認用途のみ。当日の達成数判定には使わない）。"""
    total = 0
    try:
        for line in gh('run','view',str(run['databaseId']),'--log').splitlines():
            if '[INFO] 投稿成功:' not in line:
                continue
            match = re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z', line)
            if not match:
                continue
            published = dt.datetime.fromisoformat(match.group()[:19] + '+00:00')
            if start <= published < end:
                total += 1
    except subprocess.CalledProcessError:
        pass
    return total

def notify_discord(message):
    """Discord Webhookで警告を送る。URL未設定・送信失敗は握りつぶし、監査処理は止めない。
    Webhook URL自体は絶対にログ出力しない（Publicリポジトリのため）。"""
    url = os.environ.get('DISCORD_WEBHOOK_URL')
    if not url:
        print('[WARN] DISCORD_WEBHOOK_URL 未設定のためDiscord通知はスキップ')
        return
    body = json.dumps({'content': message}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(req, timeout=DISCORD_TIMEOUT_SEC)
    except Exception as e:
        print(f'[WARN] Discord通知失敗: {e}')

def count_published_today_on_site():
    """本番サイトの実データから当日(JST, start<=t<end)公開のブログ記事数を数える。
    取得・パースに失敗したら None を返す（呼び出し側は0件として扱ってはいけない）。"""
    req = urllib.request.Request(SITEMAP_URL, headers={'User-Agent': 'blog-auto-post-audit/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=SITEMAP_TIMEOUT_SEC) as resp:
            if resp.status != 200:
                print(f'[WARN] サイトマップ取得失敗: HTTP {resp.status}')
                return None
            data = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f'[WARN] サイトマップ取得失敗: {e}')
        return None

    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        print(f'[WARN] サイトマップのパース失敗: {e}')
        return None

    count = 0
    for url_el in root.findall('sm:url', SITEMAP_NS):
        loc = url_el.findtext('sm:loc', default='', namespaces=SITEMAP_NS) or ''
        lastmod = url_el.findtext('sm:lastmod', default='', namespaces=SITEMAP_NS) or ''
        if '/detail/' not in loc or not lastmod:
            continue
        try:
            published = dt.datetime.fromisoformat(lastmod)
        except ValueError:
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=JST)
        published_jst = published.astimezone(JST)
        if start <= published_jst < end:
            count += 1
    return count

now = dt.datetime.now(JST)
day = (now - dt.timedelta(hours=6)).date()
start = dt.datetime.combine(day, dt.time(), JST)
end = start + dt.timedelta(days=1)
target = int(os.environ.get('TARGET_COUNT', '10'))
if not 0 <= target <= 10:
    raise ValueError('target must be 0..10')

# blog-post.yml/recovery.yml は concurrency group で直列化されているため
# 「進行中runがある」こと自体はクラッシュ理由にしない（待たずに続行してよい）。
# 判定材料は常に実サイトの公開数のみを使う。

count = count_published_today_on_site()
if count is None:
    notify_discord(f'⚠️ ブログ自動投稿 監査: 本番サイトの記事数を取得できなかったため、追加投稿を見送りました（{day} JST）。手動確認をお願いします。')
    raise SystemExit(0)  # 取得不能は安全側に倒す。CIは赤くしない（Discordで警告済み・次回監査で再判定）

print(f'{day}: confirmed publications (live site) {count}/{target}', flush=True)

if now.date() != day:
    print('Past-day audit: report shortfall; do not publish into a different day')
    raise SystemExit(0)

needed = max(0, target - count)
if needed == 0:
    print('✅ 目標達成済み', flush=True)
    raise SystemExit(0)

print(f'⚠️ 不足: {needed}本を補完します', flush=True)
confirmed = 0
failed = 0

for i in range(needed):
    token = 'audit-' + uuid.uuid4().hex
    try:
        gh('workflow', 'run', 'blog-post.yml', '-f', 'request_id=' + token)
    except subprocess.CalledProcessError as e:
        print(f'[WARN] 補完{i+1}トリガー失敗: {e}', flush=True)
        failed += 1
        continue

    deadline = time.monotonic() + 1800
    found = None
    while time.monotonic() < deadline:
        matches = [r for r in runs() if r['displayTitle'] == token]
        if matches:
            found = matches[0]
            if found['status'] == 'completed':
                break
        time.sleep(20)

    if not found or found['status'] != 'completed':
        print(f'[WARN] 補完{i+1}: タイムアウト — 次の補完へ続行', flush=True)
        failed += 1
        continue

    s = successes(found)
    if s != 1:
        print(f'[WARN] 補完{i+1}: CIログで投稿確認できず (successes={s}) — 次の補完へ続行', flush=True)
        failed += 1
        continue

    confirmed += 1
    print(f'✅ 補完投稿{i+1} 確認 (計{confirmed}本)', flush=True)

    if dt.datetime.now(JST).date() != day:
        print('日付が変わったため補完終了', flush=True)
        break

# 最終判定は必ず実サイトを再取得して行う（CIログの自己申告だけを信用しない）
live_count_after = count_published_today_on_site()
final_count = live_count_after if live_count_after is not None else count + confirmed
print(f'=== 監査完了: 補完トリガー成功{confirmed}本 / 失敗{failed}本 | 実サイト最終確認 {final_count}/{target}本 ===', flush=True)

if final_count < target:
    notify_discord(f'⚠️ ブログ自動投稿 監査完了: 実サイト{final_count}/{target}本（不足{target - final_count}本）。手動確認をお願いします（{day} JST）。')
else:
    print('✅ 実サイトで目標達成を確認', flush=True)
