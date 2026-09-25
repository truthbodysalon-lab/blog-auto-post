"""Audit actual publications on the live site; never fan out supplemental publication jobs
based on CI's own success/failure display (that can be wrong — see 2026-09-24 incident where
CI showed 11 successful runs but only 2 articles were actually published).

当日の達成数は body-salon-truth.com の実サイト（XMLサイトマップ）を取得して数える。
実サイトの取得・パースに失敗した場合は「0件」とみなさず、追加投稿を見送って
Discordで警告するだけに留める（安全側）。
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
    total=0
    for line in gh('run','view',str(run['databaseId']),'--log').splitlines():
        if '[INFO] 投稿成功:' not in line: continue
        match=re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z',line)
        if not match: raise RuntimeError('Publication timestamp missing')
        published=dt.datetime.fromisoformat(match.group()[:19]+'+00:00')
        if start <= published < end: total+=1
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

now=dt.datetime.now(JST)
day=(now-dt.timedelta(hours=6)).date()
start=dt.datetime.combine(day,dt.time(),JST)
end=start+dt.timedelta(days=1)
target=int(os.environ.get('TARGET_COUNT','10'))
if not 0 <= target <= 10: raise ValueError('target must be 0..10')

# 実行中のワークフローが残っていれば待つ（同時実行での二重投稿を避ける）
for run in runs():
    created=dt.datetime.fromisoformat(run['createdAt'].replace('Z','+00:00'))
    if run['workflowName'] not in {'Blog Auto Post','Blog Auto Post Recovery'} or not start-dt.timedelta(days=1) <= created < end: continue
    if run['status']!='completed': raise RuntimeError('Publication still active; wait for next audit')

count = count_published_today_on_site()
if count is None:
    notify_discord(f'⚠️ ブログ自動投稿 監査: 本番サイトの記事数を取得できなかったため、追加投稿を見送りました（{day} JST）。手動確認をお願いします。')
    raise RuntimeError('Live site verification unavailable; refusing to dispatch (safe default)')

print(f'{day}: confirmed publications (live site) {count}/{target}',flush=True)
if now.date()!=day:
    print('Past-day audit: report shortfall; do not publish into a different day')
    raise SystemExit(0)
for i in range(max(0,target-count)):
    token='audit-'+uuid.uuid4().hex
    gh('workflow','run','blog-post.yml','-f','request_id='+token)
    deadline=time.monotonic()+1800
    found=None
    while time.monotonic()<deadline:
        matches=[r for r in runs() if r['displayTitle']==token]
        if matches:
            found=matches[0]
            if found['status']=='completed': break
        time.sleep(20)
    if not found or found['status']!='completed': raise RuntimeError('Timed out; no further dispatch')
    if successes(found)!=1: raise RuntimeError('Publication not confirmed; no further dispatch')
    print(f'Confirmed supplemental publication {i+1}',flush=True)
    if dt.datetime.now(JST).date()!=day: break
