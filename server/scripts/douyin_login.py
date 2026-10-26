#!/usr/bin/env python3
"""抖音扫码登录（Playwright）。

**重要**：抖音现在把 headless 浏览器直接扔到「验证码中间页」——
没有登录按钮、没有二维码，所以无头模式基本废了（截出来的图手机扫不出来）。
实测 2026-10：headful 4.6 秒正常打开首页；headless 直接是验证码页。
所以默认走 headful（弹真实窗口），headless 只留作实验。

  python douyin_login.py headful   ← 用这个，弹窗口，在里面扫码
  python douyin_login.py headless  实验性，大概率被拦

stdout 只输出一行 JSON：{"ok":bool,"loggedIn":bool,"qr":"<路径>","reason":"..."}
实时状态另写 qr_state.json（starting / waiting / scanned / expired / verify / ok / timeout），给前端轮询。
登录态落在 $DY_ROOT/profile（persistent context 自动保存）。
"""
import asyncio
import hashlib
import json
import os
import sys
import time

from playwright.async_api import async_playwright

ROOT = os.environ.get("DY_ROOT", os.path.join(os.getcwd(), "data", "douyin"))
# 坑：Chromium 的 --user-data-dir 不能带中文路径，否则启动会直接卡死。
# 项目目录叫「数字人」，所以 profile 单独放英文路径。
PROFILE = os.environ.get("DY_PROFILE") or os.path.join(
    os.path.expanduser("~"), ".cache", "beizhai-workbench", "dy-profile"
)
QR = os.path.join(ROOT, "qr.png")
STATE = os.path.join(ROOT, "qr_state.json")
TIMEOUT = int(os.environ.get("DY_LOGIN_TIMEOUT", "240"))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 反检测：去掉自动化特征参数 + 抹掉 navigator.webdriver
ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--window-position=140,90",
    "--window-size=1180,820",
]

STEALTH = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
window.chrome = window.chrome || {runtime: {}};
"""

SESSION = ("sessionid", "sessionid_ss", "sid_tt")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def write_state(state):
    try:
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump({"state": state, "at": int(time.time() * 1000)}, f, ensure_ascii=False)
    except Exception:
        pass


def has_session(cookies):
    names = {c.get("name") for c in cookies}
    return any(n in names for n in SESSION)


def mark_logged_in():
    """写登录标记 —— 后端 hasSession() 靠它 + cookie 双确认，避免游客 sessionid 误判"""
    try:
        with open(os.path.join(ROOT, "login_ok.json"), "w", encoding="utf-8") as f:
            json.dump({"at": int(time.time() * 1000)}, f)
    except Exception:
        pass


async def cookie_value(ctx, name):
    try:
        for c in await ctx.cookies():
            if c.get("name") == name:
                return c.get("value")
    except Exception:
        pass
    return None


async def detect_login_state(page):
    """三态判断：logged / guest / unknown

    只看 cookie 会误判（游客也有 sessionid），只看按钮也会误判（页面还没渲染完）。
    所以同时看：登录按钮 / 登录弹窗 / 「投稿」+「我的」这类登录后才有的入口。
    """
    try:
        info = await page.evaluate("""() => {
          const txt = (document.body.innerText || '').slice(0, 5000);
          let loginBtn = false;
          for (const el of document.querySelectorAll('button, div[role="button"], span, a')) {
            const t = (el.textContent || '').trim();
            if (t !== '登录' && t !== '立即登录') continue;
            const r = el.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) { loginBtn = true; break; }
          }
          return {
            loginBtn,
            dialog: /扫码登录|验证码登录|密码登录/.test(txt),
            submit: txt.includes('投稿'),
            mine: txt.includes('我的'),
            len: txt.length,
          };
        }""")
    except Exception:
        return "unknown"

    if not info or info.get("len", 0) < 60:
        return "unknown"
    if info.get("loginBtn") or info.get("dialog"):
        return "guest"
    if info.get("submit") and info.get("mine"):
        return "logged"
    return "unknown"


async def page_state(page):
    """读页面文字判断当前处在哪一步 —— 扫码成功/过期/要验证，提示都不一样"""
    try:
        txt = await page.evaluate("() => (document.body.innerText || '').slice(0, 4000)")
    except Exception:
        return "waiting"
    if any(k in txt for k in ("扫描成功", "请在手机", "扫码成功", "手机上确认")):
        return "scanned"
    if any(k in txt for k in ("二维码已失效", "二维码失效", "已过期", "点击刷新")):
        return "expired"
    if any(k in txt for k in ("拖动滑块", "请完成验证", "安全验证", "验证码中间页")):
        return "verify"
    return "waiting"


async def shot_qr(page, last_hash):
    """只截二维码那一块；内容没变就不重复写文件（避免前端反复加载同一张图）"""
    try:
        box = await page.evaluate("""() => {
          let best = {w: 0};
          for (const im of document.querySelectorAll('img, canvas')) {
            const r = im.getBoundingClientRect();
            const ratio = r.width / Math.max(r.height, 1);
            if (r.width >= 120 && r.width <= 460 && ratio > 0.72 && ratio < 1.4) {
              if (r.width > best.w) best = {x: r.x, y: r.y, w: r.width, h: r.height};
            }
          }
          return best.w ? best : null;
        }""")
        vp = page.viewport_size or {"width": 1180, "height": 820}
        clip = None
        if box:
            pad = 8
            x = max(0, box["x"] - pad)
            y = max(0, box["y"] - pad)
            clip = {
                "x": x,
                "y": y,
                "width": max(40, min(box["w"] + pad * 2, vp["width"] - x)),
                "height": max(40, min(box["h"] + pad * 2, vp["height"] - y)),
            }

        buf = await (page.screenshot(clip=clip, full_page=False) if clip else page.screenshot(full_page=False))
        # 调试用：整页另存一份，方便看出弹窗到底弹出没有
        try:
            await page.screenshot(path=os.path.join(ROOT, "qr_full.png"), full_page=False)
        except Exception:
            pass

        h = hashlib.md5(buf).hexdigest()
        if h == last_hash:
            return last_hash, False
        with open(QR, "wb") as f:
            f.write(buf)
        log("二维码已更新", "裁剪" if clip else "整页", len(buf), "bytes")
        return h, True
    except Exception as e:
        log("截图失败", type(e).__name__, str(e)[:120])
        return last_hash, False


async def wait_login(ctx, page, headless):
    waited = 0
    last_hash = ""
    last_state = ""
    sid_before = getattr(page, "_sid_before", None)

    while waited < TIMEOUT:
        st = await detect_login_state(page)

        # 登录成功的两个信号，命中任一即可：
        # ① sessionid 被服务端换掉了（扫码后的正常行为）
        # ② 页面从「有登录按钮」变成「有投稿/我的」的登录态
        now_sid = await cookie_value(ctx, "sessionid")
        sid_changed = bool(sid_before) and bool(now_sid) and now_sid != sid_before
        if sid_changed or st == "logged":
            mark_logged_in()
            write_state("ok")
            log("登录成功", "sessionid 变化" if sid_changed else "页面已是登录态")
            return True

        shown = "waiting" if st == "unknown" else st
        if shown != last_state:
            last_state = shown
            log("状态 ->", shown)
        write_state(shown)

        # 两种模式都截图：headful 时窗口可能不可见（后端不在用户 GUI 会话里跑），
        # 但页面是真实渲染的，截出来照样能扫 —— 这才是绕过风控又让人看见二维码的办法。
        last_hash, changed = await shot_qr(page, last_hash)
        if changed:
            log("二维码刷新")

        await page.wait_for_timeout(2500)
        waited += 2.5

    write_state("timeout")
    return False


def clean_locks():
    """上次进程被 kill 会留下 SingletonLock/SingletonSocket，新实例会打不开同一 profile。"""
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        f = os.path.join(PROFILE, name)
        try:
            if os.path.islink(f) or os.path.exists(f):
                os.unlink(f)
                log("清理残留锁", name)
        except Exception:
            pass


async def main():
    headless = (sys.argv[1] if len(sys.argv) > 1 else "headful") != "headful"
    os.makedirs(PROFILE, exist_ok=True)
    clean_locks()
    write_state("starting")

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE,
            headless=headless,
            args=ARGS,
            user_agent=UA,
            viewport={"width": 1180, "height": 820},
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9"},
        )
        await ctx.add_init_script(STEALTH)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        # 任何等待最多 6 秒，别让默认 30s 把流程拖死
        page.set_default_timeout(6000)

        try:
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            log("首页加载失败", type(e).__name__)

        await page.wait_for_timeout(3000)

        # 记录当前 sessionid —— 扫码成功后服务端会换一个新的，靠这个变化判断登录
        page._sid_before = await cookie_value(ctx, "sessionid")
        log("初始 sessionid:", (page._sid_before or "无")[:8])

        # 先看是不是本来就登着（复用 profile 的情况）
        state = await detect_login_state(page)
        log("初始页面状态:", state)
        if state == "logged":
            mark_logged_in()
            write_state("ok")
            emit({"ok": True, "loggedIn": True, "reason": "已登录"})
            await ctx.close()
            return

        # headless 容易被扔到验证码页，先看一眼
        title = ""
        try:
            title = await page.title()
        except Exception:
            pass
        if "验证" in title or "captcha" in title.lower():
            write_state("verify")
            log("被拦到验证码页：", title)

        # 触发登录弹窗
        # 坑：Playwright 的文本选择器（text="登录"）在抖音首页会挂住 30s，
        # 4 个选择器轮下来能卡两分钟 —— 表现就是「一直正在开浏览器」。
        # 所以改成 JS 直接找元素点，一次就完。
        clicked = None
        for attempt in range(5):
            try:
                clicked = await page.evaluate("""() => {
                  const nodes = document.querySelectorAll(
                    '[data-e2e="login-button"], button, div[role="button"], span, a'
                  );
                  for (const el of nodes) {
                    const t = (el.textContent || '').trim();
                    if (t !== '登录' && t !== '立即登录') continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 4 || r.height < 4) continue;
                    el.click();
                    return t;
                  }
                  return null;
                }""")
            except Exception as e:
                log("点击登录异常", type(e).__name__, str(e)[:100])
            if clicked:
                log("已点击登录入口：", clicked)
                break
            log(f"第 {attempt + 1} 轮没找到登录按钮，等 2s")
            await page.wait_for_timeout(2000)

        if not clicked:
            try:
                head = await page.evaluate("() => (document.body.innerText || '').slice(0, 200)")
                log("页面文字：", repr(head))
            except Exception:
                pass
            log("没找到登录按钮（页面可能被风控或结构变了）")

        # 二维码是懒加载的，等它画出来，然后统一截给前端
        await page.wait_for_timeout(5000)
        await shot_qr(page, "")
        write_state("waiting")

        logged = await wait_login(ctx, page, headless)
        if logged:
            emit({"ok": True, "loggedIn": True, "qr": QR, "reason": "登录成功"})
        else:
            emit({"ok": False, "loggedIn": False, "qr": QR,
                  "reason": f"{TIMEOUT}s 内没等到登录"})
        try:
            await ctx.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
