"""Audit actual success events; never fan out supplemental publication jobs."""
import datetime as dt
import json, os, re, subprocess, time, uuid

def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)

def runs():
    return json.loads(gh('run','list','--limit','200','--json','databaseId,workflowName,status,createdAt,displayTitle'))

def successes(run):
    return len(re.findall(r'\[INFO\] 投稿成功:',gh('run','view',str(run['databaseId']),'--log')))

now=dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
day=(now-dt.timedelta(hours=6)).date()
start=dt.datetime.combine(day,dt.time(),now.tzinfo)
end=start+dt.timedelta(days=1)
target=int(os.environ.get('TARGET_COUNT','10'))
if not 0 <= target <= 10: raise ValueError('target must be 0..10')
count=0
for run in runs():
    created=dt.datetime.fromisoformat(run['createdAt'].replace('Z','+00:00'))
    if run['workflowName'] not in {'Blog Auto Post','Blog Auto Post Recovery'} or not start <= created < end: continue
    if run['status']!='completed': raise RuntimeError('Publication still active; wait for next audit')
    count+=successes(run)
print(f'{day}: confirmed publications {count}/{target}',flush=True)
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
    if dt.datetime.now(now.tzinfo).date()!=day: break
