/**
 * TikHub 抖音采集（免登录）
 *
 * 为什么换成它：原来的路是「Playwright 开真实浏览器 + 拦截 XHR」，必须先扫码登录抖音。
 * 但 headless 下抖音风控很容易识别出来 —— 二维码不出、扫了不认、一直等不到 sessionid。
 * TikHub 直接给数据，不碰浏览器，也就没有登录这回事。
 *
 * 端点（api.tikhub.io，Bearer token）：
 *   GET /api/v1/douyin/web/handler_user_profile?sec_user_id=
 *   GET /api/v1/douyin/web/fetch_user_post_videos?sec_user_id=&count=&max_cursor=
 */
import { getService } from './services.js'

const DEFAULT_BASE = 'https://api.tikhub.io'

export function tikhubReady() {
  return Boolean(getService('tikhub')?.apiKey)
}

function cfg() {
  const s = getService('tikhub') || {}
  return {
    apiKey: s.apiKey || '',
    base: (s.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
  }
}

async function callOnce(path, params, timeout) {
  const { apiKey, base } = cfg()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    )
    const url = `${base}${path}${qs.toString() ? `?${qs}` : ''}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const d = data?.detail
      const msg =
        (typeof d === 'string' ? d : d?.message) || data?.message || data?.error || `HTTP ${res.status}`
      const retryable = res.status === 429 || res.status >= 500
      return { ok: false, error: String(msg).slice(0, 300), status: res.status, retryable }
    }
    return { ok: true, data }
  } catch (e) {
    const timeoutErr = e.name === 'AbortError'
    return {
      ok: false,
      error: timeoutErr ? 'TikHub 请求超时' : String(e.message || e),
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 带重试的调用 —— 实测 TikHub 偶发超时（第一次 30s 断，隔几秒再发就好），
 * 所以超时 / 5xx / 429 都自动再试一次，别让用户以为是配错了。
 */
async function call(path, params = {}, timeout = 45_000) {
  const { apiKey } = cfg()
  if (!apiKey) return { ok: false, error: '还没配 TikHub Token —— 设置 → 第三方服务 → TikHub' }

  let last = await callOnce(path, params, timeout)
  if (!last.ok && last.retryable) {
    await new Promise((r) => setTimeout(r, 1200))
    last = await callOnce(path, params, timeout)
  }
  return last
}

/* ---------------- 解析 sec_user_id ---------------- */

/**
 * 支持：主页链接 / 分享短链 / 纯 sec_uid / 抖音号
 * 短链（v.douyin.com）靠跟随重定向拿真地址，不用第三方接口。
 */
export async function resolveSecUserId(input) {
  let raw = String(input || '').trim()
  if (!raw) return { ok: false, error: '请填博主主页链接或 sec_uid' }

  // 抖音分享文案里真正的只有一小段有用，先从长文本里抠出来
  if (raw.length > 60 || /复制|打开抖音|看看|的作品|长按/.test(raw)) {
    const url = raw.match(/https?:\/\/[^\s，,。、"']+/)
    if (url) {
      raw = url[0]
    } else {
      // 没有链接，看看有没有「抖音号：xxxx」
      const dyId = raw.match(/抖音号[：:]\s*([\w.@-]{2,40})/)
      if (dyId) {
        raw = dyId[1]
      } else {
        return {
          ok: false,
          error: '这段文案里没有主页链接也没有抖音号 —— 请粘完整分享文案（带 v.douyin.com 链接），或直接贴主页链接',
        }
      }
    }
  }

  // 已经是 sec_uid（MS4wLjABAAAA… 这种）
  if (/^MS4wLjAB[A-Za-z0-9_-]{10,}$/.test(raw)) return { ok: true, secUserId: raw }

  // 链接里直接带 /user/<sec_uid>
  const m = raw.match(/\/user\/([A-Za-z0-9_-]{20,})/)
  if (m) return { ok: true, secUserId: m[1] }

  // 短链：先自己跟跳转，跳不出主页就用 TikHub 解析（分享链接多半是视频页）
  const short = raw.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/?/)
  if (short) {
    try {
      const res = await fetch(short[0], { redirect: 'follow', headers: { 'User-Agent': UA } })
      const real = res.url || ''
      const m2 = real.match(/\/user\/([A-Za-z0-9_-]{20,})/)
      if (m2) return { ok: true, secUserId: m2[1] }
    } catch {
      /* 自己跳不动就交给 TikHub */
    }

    // 分享链接是视频页：拿视频详情里的作者 sec_uid
    const one = await fetchOneVideoByUrl(short[0])
    if (one.ok && one.data.authorSecUid) {
      return { ok: true, secUserId: one.data.authorSecUid, via: 'video-author' }
    }
    return {
      ok: false,
      error: one.ok
        ? '这个链接里没找到作者信息，换成「主页链接」试试'
        : `短链解析失败：${one.error || '未知原因'}`,
    }
  }

  // 纯抖音号 → 查询
  if (/^[\w.@-]{2,30}$/.test(raw)) {
    const r = await call('/api/v1/douyin/web/fetch_user_profile_by_short_id', { short_id: raw.replace(/^@/, '') })
    const uid = pickProfile(r.data)?.sec_uid
    if (uid) return { ok: true, secUserId: uid }
    return { ok: false, error: '这个抖音号没查到，换主页链接试试' }
  }

  return { ok: false, error: '认不出这是什么 —— 请贴「主页链接」（不是单条视频链接）' }
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/* ---------------- 取数据 ---------------- */

/** 用户信息（昵称/头像/粉丝/作品数） */
export async function fetchProfile(secUserId) {
  const r = await call('/api/v1/douyin/web/handler_user_profile', { sec_user_id: secUserId })
  if (!r.ok) return r
  const u = pickProfile(r.data)
  if (!u) return { ok: false, error: '没拿到用户信息（sec_uid 可能不对）' }
  return {
    ok: true,
    data: {
      secUserId: u.sec_uid || secUserId,
      nickname: u.nickname || '未命名',
      avatar: pickUrl(u.avatar_thumb) || pickUrl(u.avatar_larger) || pickUrl(u.avatar_medium) || '',
      signature: u.signature || '',
      followerCount: num(u.follower_count),
      awemeCount: num(u.aweme_count),
    },
  }
}

/** 作品列表（含点赞/评论/时长/发布时间） */
export async function fetchVideos(secUserId, limit = 20) {
  /**
   * 用 app/v3 而不是 web 版 —— 实测 web 版返回的列表**不含最新作品**：
   * 同一个博主 web 前 5 条是 07-15 / 06-04 / 09-25…，app/v3 里却有 10-20、10-19 的新片。
   * 这是「博主明明发了但采不到」的根因。
   *
   * 另外两边都不是严格时间倒序（抖音会混排置顶/推荐），拿到后必须自己按 create_time 重排。
   */
  const r = await call('/api/v1/douyin/app/v3/fetch_user_post_videos', {
    sec_user_id: secUserId,
    count: Math.min(Math.max(limit, 1), 50),
    max_cursor: 0,
    sort_type: 0,
  })
  if (!r.ok) return r

  const list = pickAwemeList(r.data)
  if (!list.length) {
    // 空列表不一定是错，可能这号真没作品
    return { ok: true, data: [], empty: true }
  }
  return { ok: true, data: list.slice(0, limit).map(normalizeVideo) }
}

/** 按 aweme_id 拿最新详情（播放地址有时效，采集时存的下次就过期了） */
export async function fetchOneVideo(awemeId) {
  const r = await call('/api/v1/douyin/web/fetch_one_video', { aweme_id: awemeId })
  if (!r.ok) return r
  const root = r.data
  const v =
    root?.data?.aweme_detail ||
    root?.aweme_detail ||
    root?.data?.data?.aweme_detail ||
    pickAwemeList(root)?.[0] ||
    null
  if (!v) return { ok: false, error: '没拿到这条视频的详情' }
  // 优先 H.264：抖音默认给的是 H.265(HEVC)，浏览器直接报 Format error
  const play =
    pickUrl(v.video?.play_addr_h264) ||
    pickUrl(v.video?.play_addr) ||
    pickUrl(v.video?.download_addr)
  return { ok: true, data: { ...normalizeVideo(v), playUrl: play } }
}

/** 抖音综合搜索（热榜选题前先查真实素材，别让模型凭空编） */
export async function searchVideos(keyword, { sort = '0', publishTime = '7', limit = 12 } = {}) {
  const { apiKey, base } = cfg()
  if (!apiKey) return { ok: false, error: '还没配 TikHub Token' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  try {
    const res = await fetch(`${base}/api/v1/douyin/search/fetch_general_search_v1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        cursor: 0,
        sort_type: sort,
        publish_time: publishTime,
        filter_duration: '0',
        content_type: '1',
      }),
      signal: ctrl.signal,
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: `搜索失败 HTTP ${res.status}` }
    }
    // 返回结构里作品列表的位置不固定，几种常见位置都试
    const root = d?.data
    const list =
      root?.data?.flatMap?.((x) => x?.aweme_info || []) ||
      root?.aweme_list ||
      root?.data?.aweme_list ||
      []
    const items = (Array.isArray(list) ? list : []).slice(0, limit).map((a) => ({
      title: (a.desc || '').trim(),
      like: num(a.statistics?.digg_count),
      author: a.author?.nickname || '',
    }))
    return { ok: true, data: items.filter((x) => x.title) }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '搜索超时' : String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** 单条视频：直接丢分享链接进去，TikHub 自己解析 */
export async function fetchOneVideoByUrl(shareUrl) {
  const r = await call('/api/v1/douyin/web/fetch_one_video_by_share_url', { share_url: shareUrl })
  if (!r.ok) return r

  const root = r.data
  // 这个接口的返回位置不固定，常见两处
  const v =
    root?.data?.aweme_detail ||
    root?.aweme_detail ||
    root?.data?.data?.aweme_detail ||
    pickAwemeList(root)?.[0] ||
    null
  if (!v) return { ok: false, error: '没解析出视频，确认是抖音的分享链接' }
  return { ok: true, data: normalizeVideo(v) }
}

/* ---------------- 结构兼容 ---------------- */

/** TikHub 一般透传抖音原始结构，但外层包了一层 data，这里把常见位置都试一遍 */
function pickProfile(root) {
  return (
    root?.data?.user ||
    root?.user ||
    root?.data?.data?.user ||
    root?.data ||
    null
  )
}

function pickAwemeList(root) {
  const cands = [
    root?.data?.aweme_list,
    root?.aweme_list,
    root?.data?.data?.aweme_list,
    root?.data?.data,
    root?.data,
  ]
  for (const c of cands) {
    if (Array.isArray(c)) return c
  }
  return []
}

/**
 * 抖音的封面默认给 .heic —— Chrome / Firefox 根本渲染不了，列表里全是灰块。
 * url_list 里通常混着 jpeg / webp 的节点，优先挑这些；实在没有才退回第一个。
 */
const BAD_IMG = /\.(heic|heif)(\?|$)/i

function pickUrl(o) {
  if (!o) return ''
  if (typeof o === 'string') return o
  const l = o.url_list || o.urlList || o.urls
  if (!Array.isArray(l) || !l.length) return ''
  return l.find((u) => u && !BAD_IMG.test(u)) || l[0] || ''
}

/** 封面：cover 经常只有 heic，origin_cover / dynamic_cover 里才有能显示的 */
function pickCover(v) {
  const cands = [v.video?.cover, v.video?.origin_cover, v.video?.dynamic_cover, v.cover]
  for (const c of cands) {
    const u = pickUrl(c)
    if (u && !BAD_IMG.test(u)) return u
  }
  return pickUrl(v.video?.cover) || pickUrl(v.cover)
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeVideo(v) {
  const stats = v.statistics || {}
  const cover = pickCover(v)
  return {
    awemeId: v.aweme_id || v.awemeId || '',
    title: (v.desc || v.title || '').trim(),
    cover,
    durationMs: num(v.video?.duration || v.duration || v.durationMs),
    createTime: num(v.create_time || v.createTime) || null,
    likeCount: num(stats.digg_count ?? v.likeCount),
    commentCount: num(stats.comment_count ?? v.commentCount),
    collectCount: num(stats.collect_count ?? v.collectCount),
    shareCount: num(stats.share_count ?? v.shareCount),
    isImageAlbum: Array.isArray(v.images) && v.images.length > 0,
    playUrl:
      pickUrl(v.video?.play_addr_h264) ||
      pickUrl(v.video?.play_addr) ||
      pickUrl(v.video?.download_addr),
    authorSecUid: v.author?.sec_uid || v.author?.secUid || '',
    authorName: v.author?.nickname || '',
  }
}
