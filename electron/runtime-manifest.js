/**
 * 运行环境组件清单（供客户端首次启动做环境检测 + 按需下载）。
 *
 * 三大块：
 *   ffmpeg    音视频处理（分平台二进制）
 *   python    venv（含 PyTorch，跑 FireRed 字级时间戳）—— 必须分平台
 *   talkcraft  video-talkcraft 工具 + FireRed 口型模型权重（跨平台通用）
 *
 * 检测口径：runtime 根目录下对应文件/目录存在即视为就绪。
 * 下载口径：从 BEIDOU_RUNTIME_BASE 下载 archive 名，tar.gz 解压到 runtime 根。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

/** 当前平台标签：mac-x64 / mac-arm64 / win-x64 */
export function platformTag() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  return 'win-x64'
}

/** FireRed 模型目录名（与 timestamps_cpu.py 的默认约定一致） */
const MODEL_DIR = 'sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25'

/** 模型默认落点（timestamps_cpu.py 没传 --model-dir 时就读这里） */
const kouboDir = () => path.join(os.homedir(), '.cache', 'koubo')

const IS_WIN = process.platform === 'win32'
const pyExe = IS_WIN ? 'python.exe' : 'bin/python'

/** 本平台需要检测的组件数组 */
export function getComponents() {
  const tag = platformTag()
  return [
    {
      key: 'ffmpeg',
      label: 'FFmpeg 音视频工具',
      check: (root) => exists(path.join(root, 'ffmpeg')) && exists(path.join(root, 'ffprobe')),
      archive: `ffmpeg-${tag}.tar.gz`,
      size: 160_000_000,
    },
    {
      key: 'python',
      label: 'Python 运行环境（含 PyTorch）',
      check: (root) => exists(path.join(root, 'python', pyExe)),
      archive: `python-${tag}.tar.gz`,
      size: 800_000_000,
    },
    {
      key: 'talkcraft',
      label: '数字人引擎与口型模型',
      // 目录非空即视为就绪（里面是脚本 + FireRed 模型权重，跨平台）
      check: (root) => {
        const d = path.join(root, 'video-talkcraft')
        if (!exists(d)) return false
        try {
          return fs.readdirSync(d).length > 0
        } catch {
          return false
        }
      },
      archive: 'talkcraft.tar.gz', // 跨平台，文件名不带平台标签
      size: 770_000_000,
    },
    {
      key: 'firered',
      label: 'FireRed 语音识别模型',
      dest: () => kouboDir(),
      check: () =>
        exists(path.join(kouboDir(), MODEL_DIR, 'model.int8.onnx')) &&
        exists(path.join(kouboDir(), MODEL_DIR, 'tokens.txt')),
      archive: 'firered.tar.gz', // .onnx 模型跨平台通用
      size: 740_000_000,
    },
  ]
}
