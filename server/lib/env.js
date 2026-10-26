/**
 * 极简 .env 加载器（不引第三方依赖）
 *
 * 为什么不用 dotenv：项目只依赖 express，为了两个变量装个包不划算。
 * 为什么不用 node --env-file：启动命令一改，别人就容易漏掉，还是代码里加载更稳。
 *
 * 只读取项目根目录的 .env.local / .env，且**已在 process.env 里的值优先**（部署时用真实环境变量覆盖）。
 * 这两个文件都写在 .gitignore 里。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

for (const name of ['.env.local', '.env']) {
  const file = path.join(ROOT, name)
  if (!fs.existsSync(file)) continue

  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !process.env[key]) process.env[key] = val
  }
}

/**
 * 外部可执行文件的路径。
 *
 * 原来散在各 lib 里写死 `~/.workbuddy/binaries/...` —— 那是本机 WorkBuddy 自带的运行时。
 * 给别人用的桌面端不能依赖本机路径，所以这里把 ffmpeg / python / 口型模型统一收口到
 * 「运行时根目录」RUNTIME_ROOT（打包后落在 userData/runtime，由客户端首次启动按平台下载）。
 *
 * 每个 BIN 都做了「文件存在才用运行时路径，否则回退本机路径」，所以**本地开发零影响**，
 * 别人安装后第一次打开才会去下载并落到 userData/runtime。
 *
 *   PY_BIN         Python 解释器（跑时间戳 / 抽帧脚本，含 PyTorch）
 *   NODE_BIN       跑 Remotion 的 node（默认就用当前进程这个，最不容易错）
 *   FFMPEG_BIN / FFPROBE_BIN   ffmpeg 套件
 *   TALK_CRAFT_HOME            video-talkcraft 技能目录（含 FireRed 口型模型）
 */
const HOME = process.env.HOME || ''

/**
 * 运行时根目录：ffmpeg / python / 口型模型统一落这里。
 * 打包后 BEIDOU_DATA_ROOT 指到 userData，于是落在 ~/Library/Application Support/北抖AI数字人/runtime
 * （Win 是 %APPDATA%/北抖AI数字人/runtime）。本地开发时若没设该变量，则回退到项目内 runtime/。
 */
export const RUNTIME_ROOT = process.env.BEIDOU_DATA_ROOT
  ? path.join(process.env.BEIDOU_DATA_ROOT, 'runtime')
  : path.join(ROOT, 'runtime')

const IS_WIN = process.platform === 'win32'
const exe = (n) => (IS_WIN ? `${n}.exe` : n)

/** 运行时文件存在就用它，否则回退到本机 WorkBuddy 自带路径（开发机零影响） */
function pick(existing, fallback) {
  return existing && fs.existsSync(existing) ? existing : fallback
}

export const PY_BIN =
  process.env.PY_BIN ||
  pick(
    path.join(RUNTIME_ROOT, 'python', IS_WIN ? 'python.exe' : 'bin/python'),
    path.join(HOME, '.workbuddy/binaries/python/envs/default/bin/python')
  )
export const NODE_BIN = process.env.NODE_BIN || process.execPath
export const FFMPEG_BIN =
  process.env.FFMPEG_BIN || pick(path.join(RUNTIME_ROOT, exe('ffmpeg')), path.join(HOME, '.workbuddy/bin/ffmpeg'))
export const FFPROBE_BIN =
  process.env.FFPROBE_BIN || pick(path.join(RUNTIME_ROOT, exe('ffprobe')), path.join(HOME, '.workbuddy/bin/ffprobe'))
export const TALK_CRAFT_HOME =
  process.env.TALK_CRAFT_HOME ||
  pick(path.join(RUNTIME_ROOT, 'video-talkcraft'), path.join(HOME, 'WorkBuddy/数字人/tools/video-talkcraft'))

/**
 * 可变数据的根目录。
 *
 * 打包成桌面端后，程序装在 `/Applications/北抖AI数字人.app` 里 ——
 * 那个目录随时可能被覆盖更新，甚至只读。成片（每条 200MB+）和账号配置
 * 绝对不能写在那儿，所以 Electron 主进程会把这里指到 userData：
 *
 *   macOS  ~/Library/Application Support/北抖AI数字人/
 *   Win    %APPDATA%/北抖AI数字人/
 *
 * 不设环境变量时行为完全不变（还是 server/ 下面的目录），本地开发零影响。
 */
export const DATA_ROOT = process.env.BEIDOU_DATA_ROOT || ''

/** 某个可变目录的落点：优先 DATA_ROOT，否则用原来的相对位置 */
export function dataDir(name, fallbackRoot) {
  return DATA_ROOT ? path.join(DATA_ROOT, name) : path.join(fallbackRoot, name)
}
