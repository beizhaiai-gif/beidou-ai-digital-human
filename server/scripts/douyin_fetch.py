#!/usr/bin/env python3
"""抖音博主作品采集（Playwright，复用扫码登录的持久化 profile）。

用法:
  python douyin_fetch.py user <sec_uid> [limit]
  python douyin_fetch.py resolve <url-or-text>     # 短链 → sec_uid
  python douyin_fetch.py whoami                    # 查看当前登录态

核心思路:
  不自己算 a_bogus 签名 —— 直接用浏览器打开博主主页，让抖音页面自己去发
  /aweme/v1/web/aweme/post/ 请求，我们拦截响应把 JSON 拿下来。
  签名、指纹、cookie 全部由真实浏览器负责，抖音风控无法区分。

输出: stdout 只写一行 JSON；日志走 stderr。
"""
import asyncio
import json
import os
import re
import sys
import time
from playwright.async_api import async_playwright

ROOT = os.environ.get("DY_ROOT", os.path.join(os.getcwd(), "data", "douyin"))
# 坑：Chromium 的 --user-data-dir 不能带中文路径，否则启动会卡死。
PROFILE = os.environ.get("DY_PROFILE") or os.path.join(
    os.path.expanduser("~"), ".cache", "beizhai-workbench", "dy-profile"
)
COOKIE_JSON = os.path.join(ROOT, "cookies.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

LOGIN_KEYS = ("sessionid", "sessionid_ss", "sid_tt")
ARGS = ["--no-sandbox", "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled", "--disable-background-networking"]

LOCK = "/tmp/douyin_browser.lock"


def acquire_lock():
    """同一个 profile 不能被两个 Chromium 同时打开，先清掉旧实例。"""
    if os.path.exists(LOCK):
        try:
            old = int(open(LOCK).read().strip())
            os.kill(old, 0)
            os.kill(old, 9)
            time.sleep(1.5)
        except Exception:
            pass
    # 兜底：脚本被 kill -9 时 Chromium 子进程会残留，占着 profile 不放
    os.system("pkill -9 -f '[c]hrome-headless-shell' 2>/dev/null")
    time.sleep(0.8)
    with open(LOCK, "w") as f:
        f.write(str(os.getpid()))


def release_lock():
    try:
        with open(LOCK) as f:
            if f.read().strip() == str(os.getpid()):
                os.remove(LOCK)
    except Exception:
        pass


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


async def inject_cookies(ctx):
    """把用户在本机登录得到的 cookie（含 HttpOnly 的 sessionid）注入浏览器。

    这条路径绕开了服务器 IP 的短信/实名风控：登录动作发生在用户自己的
    网络环境里，服务器只复用登录后的 cookie。
    """
    if not os.path.exists(COOKIE_JSON):
        log("no cookies.json")
        return 0
    try:
        arr = json.load(open(COOKIE_JSON, encoding="utf-8"))
    except Exception as e:
        log("cookies.json 解析失败", e)
        return 0
    cks = []
    for c in arr:
        if not c.get("name"):
            continue
        ck = {
            "name": c["name"],
            "value": c.get("value", ""),
            "domain": c.get("domain") or ".douyin.com",
            "path": c.get("path") or "/",
        }
        if c.get("expires"):
            ck["expires"] = float(c["expires"])
        if "secure" in c:
            ck["secure"] = bool(c["secure"])
        if "httpOnly" in c:
            ck["httpOnly"] = bool(c["httpOnly"])
        cks.append(ck)
    try:
        await ctx.add_cookies(cks)
        names = {c["name"] for c in cks}
        log("injected cookies:", len(cks), "| sessionid:",
            "sessionid" in names or "sessionid_ss" in names)
        return len(cks)
    except Exception as e:
        log("cookie 注入失败", type(e).__name__, str(e)[:200])
        return 0


def pick_play_url(it):
    """取最高码率无水印播放地址。"""
    v = it.get("video") or {}
    best = None
    best_rate = -1
    for br in (v.get("bit_rate") or []):
        urls = ((br.get("play_addr") or {}).get("url_list") or [])
        if not urls:
            continue
        rate = int(br.get("bit_rate") or 0)
        if rate > best_rate:
            best_rate, best = rate, urls[-1]
    if best:
        return best
    for key in ("play_addr", "download_addr"):
        urls = ((v.get(key) or {}).get("url_list") or [])
        if urls:
            return urls[-1]
    return ""


def to_video(it):
    if not it:
        return None
    aweme_id = str(it.get("aweme_id") or "")
    if not aweme_id:
        return None
    v = it.get("video") or {}
    st = it.get("statistics") or {}
    covers = ((v.get("cover") or {}).get("url_list")
              or (v.get("origin_cover") or {}).get("url_list") or [])
    images = it.get("images") or []
    play = pick_play_url(it)
    return {
        "awemeId": aweme_id,
        "title": str(it.get("desc") or "").strip(),
        "cover": covers[0] if covers else "",
        # 抖音主页接口 duration 单位是毫秒
        "durationMs": int(v.get("duration") or it.get("duration") or 0),
        "createTime": int(it.get("create_time") or 0) or None,
        "likeCount": int(st.get("digg_count") or 0),
        "commentCount": int(st.get("comment_count") or 0),
        "collectCount": int(st.get("collect_count") or 0),
        "shareCount": int(st.get("share_count") or 0),
        "isImageAlbum": bool(images),
        "playUrl": play,
    }


def to_user(au, sec_uid):
    au = au or {}
    return {
        "secUserId": sec_uid,
        "nickname": str(au.get("nickname") or ""),
        "avatar": ((au.get("avatar_thumb") or {}).get("url_list") or [""])[0],
        "signature": str(au.get("signature") or ""),
        "followerCount": int(au.get("follower_count") or 0),
        "totalFavorited": int(au.get("total_favorited") or 0),
        "awemeCount": int(au.get("aweme_count") or 0),
    }


async def cmd_user(sec_uid, limit):
    limit = max(1, min(int(limit or 20), 200))
    collected = {}
    author = None

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, headless=True, user_agent=UA,
            viewport={"width": 1440, "height": 900}, args=ARGS)
        await inject_cookies(ctx)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        names = {c["name"] for c in await ctx.cookies()}
        logged_in = bool(names & set(LOGIN_KEYS))
        log("logged_in =", logged_in)

        async def on_resp(resp):
            nonlocal author
            if "/aweme/v1/web/aweme/post/" not in resp.url:
                return
            try:
                j = await resp.json()
            except Exception:
                return
            for it in (j.get("aweme_list") or []):
                v = to_video(it)
                if v:
                    collected.setdefault(v["awemeId"], v)
                if not author and it.get("author"):
                    author = it["author"]
            log("xhr ->", len(j.get("aweme_list") or []), "累计", len(collected))

        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))

        await page.goto(f"https://www.douyin.com/user/{sec_uid}",
                        wait_until="domcontentloaded", timeout=90000)
        await page.wait_for_timeout(5000)

        # 滚动加载到够数或不再新增
        idle = 0
        for _ in range(40):
            if len(collected) >= limit:
                break
            before = len(collected)
            await page.mouse.wheel(0, 2400)
            await page.wait_for_timeout(1800)
            if len(collected) == before:
                idle += 1
                if idle >= 3:
                    break
            else:
                idle = 0

        if not author:
            try:
                author = await page.evaluate(
                    "() => (window._ROUTER_DATA||{}).loaderData?.user_page?.userInfo?.user || null")
            except Exception:
                pass

        videos = list(collected.values())[:limit]
        out = {
            "ok": bool(videos),
            "loggedIn": logged_in,
            "user": to_user(author, sec_uid),
            "videos": videos,
            "error": "" if videos else (
                "未登录或该博主主页取不到作品" if not logged_in else "该博主没有公开作品"),
        }
        emit(out)
        await ctx.close()


async def cmd_resolve(target):
    """短链 / 分享文案 → sec_uid。"""
    raw = str(target or "").strip()
    if re.match(r"^MS4wLjABAAAA", raw):
        emit({"ok": True, "secUserId": raw.split("?")[0]})
        return
    m = re.search(r"douyin\.com/user/([A-Za-z0-9_\-]+)", raw)
    if m:
        emit({"ok": True, "secUserId": m.group(1)})
        return
    m = re.search(r"https?://[^\s'\"）)】]+", raw)
    if not m:
        emit({"ok": False, "error": "没识别到链接"})
        return
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, headless=True, user_agent=UA, args=ARGS)
        await inject_cookies(ctx)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(m.group(0), wait_until="domcontentloaded", timeout=60000)
            # 抖音短链是"精选页 → JS 二次跳转"，3 秒不够，最多等 20 秒
            final = page.url
            for _ in range(14):
                await page.wait_for_timeout(1500)
                final = page.url
                if re.search(r"douyin\.com/user/([A-Za-z0-9_\-]+)", final):
                    break
                # 有些短链会带 modal_id（作品分享），先关掉弹层再看地址
                if "modal_id" in final:
                    try:
                        await page.keyboard.press("Escape")
                    except Exception:
                        pass
            mm = re.search(r"douyin\.com/user/([A-Za-z0-9_\-]+)", final)
            if mm:
                emit({"ok": True, "secUserId": mm.group(1)})
                await ctx.close()
                return

            # 兜底：从页面数据里找当前登录/展示的博主 sec_uid
            try:
                uid = await page.evaluate(
                    "() => (window._ROUTER_DATA||{}).loaderData?.user_page?.userInfo?.user?.sec_uid || ''")
            except Exception:
                uid = ""
            if uid:
                emit({"ok": True, "secUserId": uid})
            else:
                emit({"ok": False,
                      "error": f"这个短链没跳到博主主页（落到了 {final[:80]}）。请复制博主主页里的完整链接，形如 douyin.com/user/MS4wLjABAAAA..."})
        except Exception as e:
            emit({"ok": False, "error": f"{type(e).__name__}: {e}"})
        await ctx.close()


async def cmd_whoami():
    if not os.path.isdir(PROFILE):
        emit({"ok": True, "loggedIn": False, "reason": "no profile"})
        return
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, headless=True, user_agent=UA, args=ARGS)
        await inject_cookies(ctx)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2500)
        names = {c["name"] for c in await ctx.cookies()}
        emit({"ok": True, "loggedIn": bool(names & set(LOGIN_KEYS)),
              "cookieCount": len(names)})
        await ctx.close()


async def cmd_video(target):
    """单条视频链接 / 分享文案 → 视频信息（含无水印播放地址）。

    抖音视频页在加载时会自己发 /aweme/v1/web/aweme/detail/，我们拦下来即可，
    签名由页面负责；拦不到再从 window._ROUTER_DATA 兜底。
    """
    raw = str(target or "").strip()
    m = re.search(r"https?://[^\s'\"）)】]+", raw)
    url = m.group(0) if m else raw
    if not url.startswith("http"):
        emit({"ok": False, "error": "没识别到链接，请粘贴 douyin.com/video/... 或 v.douyin.com 短链"})
        return

    found = {}

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, headless=True, user_agent=UA,
            viewport={"width": 1440, "height": 900}, args=ARGS)
        await inject_cookies(ctx)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        names = {c["name"] for c in await ctx.cookies()}
        logged_in = bool(names & set(LOGIN_KEYS))

        async def on_resp(resp):
            if "/aweme/v1/web/aweme/detail/" not in resp.url:
                return
            try:
                j = await resp.json()
            except Exception:
                return
            d = j.get("aweme_detail")
            if d and "item" not in found:
                found["item"] = d
                log("detail ->", d.get("aweme_id"))

        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log("打开失败", type(e).__name__, str(e)[:120])

        # 短链会先跳转，等到 /video/<id> 或 modal_id
        aweme_id = ""
        for _ in range(16):
            await page.wait_for_timeout(1200)
            mm = re.search(r"/video/(\d+)", page.url) or re.search(r"modal_id=(\d+)", page.url)
            if mm:
                aweme_id = mm.group(1)
                break
            if "item" in found:
                break

        # 等 detail 接口回来
        for _ in range(10):
            if "item" in found:
                break
            await page.wait_for_timeout(1200)

        # 兜底：SSR 数据
        if "item" not in found:
            try:
                item = await page.evaluate("""() => {
                  const d = (window._ROUTER_DATA || {}).loaderData || {};
                  for (const k of Object.keys(d)) {
                    const r = d[k] && d[k].videoInfoRes;
                    if (r && r.item_list && r.item_list[0]) return r.item_list[0];
                  }
                  return null;
                }""")
                if item:
                    found["item"] = item
                    log("router_data 兜底命中")
            except Exception as e:
                log("router_data 读取失败", type(e).__name__)

        if "item" in found:
            v = to_video(found["item"])
        elif aweme_id:
            v = {"awemeId": aweme_id, "title": "", "cover": "", "durationMs": 0,
                 "createTime": None, "likeCount": 0, "commentCount": 0,
                 "collectCount": 0, "shareCount": 0, "isImageAlbum": False, "playUrl": ""}
        else:
            v = None

        if not v:
            emit({"ok": False, "loggedIn": logged_in,
                  "error": "没能解析出视频。请确认链接是单条作品（douyin.com/video/... 或 v.douyin.com 短链）"})
        elif not v.get("playUrl"):
            emit({"ok": False, "loggedIn": logged_in, "awemeId": v["awemeId"],
                  "error": "这条作品没有视频流（可能是图文），或已被删除/设为私密"})
        else:
            emit({"ok": True, "loggedIn": logged_in, "video": v})
        await ctx.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd not in ("user", "resolve", "video", "whoami"):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    if cmd in ("user", "resolve", "video") and len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    acquire_lock()
    try:
        if cmd == "user":
            asyncio.run(cmd_user(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 20))
        elif cmd == "resolve":
            asyncio.run(cmd_resolve(sys.argv[2]))
        elif cmd == "video":
            asyncio.run(cmd_video(sys.argv[2]))
        else:
            asyncio.run(cmd_whoami())
    finally:
        release_lock()
