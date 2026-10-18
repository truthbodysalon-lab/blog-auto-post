#!/usr/bin/env python3
"""threads-auto-post の常駐ループ（auto_post.yml）が動いているかを見張る（2026-10-19・Mac不要の見張り）。

このループに Threads投稿・定刻起動（インスタのストーリー／LINEステップ配信／学習系）・見張り(ops_deadman) が乗っている。
止まっていたら Discord に知らせる（6時間に1回）。復旧したら1回だけ知らせる。LINEは使わない。
ループの再起動は threads-auto-post 側の cron（2,32分）が担う（この見張りは知らせるだけ）。
公開リポのため、ログには判定結果（OK/NG・経過分）しか出さない。
"""
import datetime
import json
import os
import urllib.request

REPO = "truthbodysalon-lab/threads-auto-post"
STATE = os.path.join(os.path.dirname(__file__), "loop_watch_state.json")
STALL_MIN = 60          # 最後の実行が終わってからこの分数を超えたら停止とみなす
REALERT_SEC = 6 * 3600


def api(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                               "Authorization": f"Bearer {os.environ.get('GH_TOKEN', '')}",
                                               "User-Agent": "loop-watch"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def discord(text):
    hook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not hook:
        print("Discord未設定（送信せず）")
        return False
    req = urllib.request.Request(hook, data=json.dumps({"content": text[:1900]}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "loop-watch"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status in (200, 204)
    except Exception as e:  # noqa: BLE001
        print("Discord送信失敗:", type(e).__name__)
        return False


def main():
    try:
        runs = api(f"https://api.github.com/repos/{REPO}/actions/workflows/auto_post.yml/runs?per_page=5")["workflow_runs"]
    except Exception as e:  # noqa: BLE001
        print("取得失敗（判定せず）:", type(e).__name__)
        return
    now = datetime.datetime.now(datetime.timezone.utc)
    running = any(r["status"] in ("in_progress", "queued", "waiting", "pending", "requested") for r in runs)
    gap = None
    if not running and runs:
        last = max(datetime.datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00")) for r in runs)
        gap = (now - last).total_seconds() / 60
    down = (not running) and (gap is None or gap > STALL_MIN)
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    print("判定:", "NG" if down else "OK", "" if gap is None else f"（最終終了から{gap:.0f}分）", "実行中" if running else "")
    jst = (now + datetime.timedelta(hours=9)).strftime("%m/%d %H:%M")
    changed = False
    if down:
        if now.timestamp() - st.get("last_alert", 0) >= REALERT_SEC:
            msg = ("⚠️ 常駐ループ（threads-auto-post/auto_post.yml）が止まっています"
                   + (f"（最後の実行終了から約{gap:.0f}分）" if gap is not None else "（実行履歴なし）")
                   + f" {jst}時点\nThreads投稿・インスタのストーリー定刻起動・LINEステップ配信の起動・見張りが止まっている可能性があります。"
                   "GitHub の threads-auto-post → Actions → Threads Auto Post → Run workflow で再開できます。")
            if discord(msg):
                st.update(last_alert=now.timestamp(), down=True)
                changed = True
    elif st.get("down"):
        if discord(f"✅ 常駐ループ（threads-auto-post）は復旧しています {jst}時点"):
            st.update(down=False)
            changed = True
    if changed:
        json.dump(st, open(STATE, "w"))
        print("STATE_CHANGED")


if __name__ == "__main__":
    main()
