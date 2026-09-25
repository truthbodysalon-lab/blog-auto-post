"""Audit confirmed publications and dispatch supplemental posts if needed."""
import datetime as dt
import json, os, re, subprocess, time, uuid

def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)

def runs():
    return json.loads(gh('run','list','--limit','200','--json','databaseId,workflowName,status,createdAt,displayTitle'))

def successes(run):
    total = 0
    try:
        for line in gh('run','view',str(run['databaseId']),'--log').splitlines():
            if '[INFO] 投稿成功:' not in line:
                continue
            match = re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z', line)
            if not match:
                continue  # タイムスタンプなしは無視してカウント継続
            published = dt.datetime.fromisoformat(match.group()[:19] + '+00:00')
            if start <= published < end:
                total += 1
    except subprocess.CalledProcessError:
        pass  # ログ取得失敗は0件として扱う
    return total

now = dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
day = (now - dt.timedelta(hours=6)).date()
start = dt.datetime.combine(day, dt.time(), now.tzinfo)
end = start + dt.timedelta(days=1)
target = int(os.environ.get('TARGET_COUNT', '10'))
if not 0 <= target <= 10:
    raise ValueError('target must be 0..10')

# 既存の成功数をカウント（進行中は無視してスキップ）
count = 0
for run in runs():
    created = dt.datetime.fromisoformat(run['createdAt'].replace('Z', '+00:00'))
    if run['workflowName'] not in {'Blog Auto Post', 'Blog Auto Post Recovery'}:
        continue
    if not start - dt.timedelta(days=1) <= created < end:
        continue
    if run['status'] != 'completed':
        print(f'[SKIP] {run["workflowName"]} ({run["databaseId"]}) まだ実行中 — カウントから除外', flush=True)
        continue
    count += successes(run)

print(f'{day}: confirmed publications {count}/{target}', flush=True)

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
        print(f'[WARN] 補完{i+1}: 投稿確認できず (successes={s}) — 次の補完へ続行', flush=True)
        failed += 1
        continue

    confirmed += 1
    print(f'✅ 補完投稿{i+1} 確認 (計{confirmed}本)', flush=True)

    if dt.datetime.now(now.tzinfo).date() != day:
        print('日付が変わったため補完終了', flush=True)
        break

print(f'=== 監査完了: 補完成功{confirmed}本 / 失敗{failed}本 ===', flush=True)
total_confirmed = count + confirmed
if total_confirmed < target:
    print(f'[WARN] 最終実績: {total_confirmed}/{target}本 (不足{target - total_confirmed}本)', flush=True)
else:
    print(f'✅ 最終実績: {total_confirmed}/{target}本', flush=True)
