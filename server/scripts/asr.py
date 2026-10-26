#!/usr/bin/env python3
"""本地语音转文字（faster-whisper small）。

为什么不用火山 ASR：现有 key 只开通了 TTS/声音复刻，
调 volc.seedasr.auc 会报 `requested resource not granted`。
本机已装 faster-whisper + small 模型，13 秒音频约 10 秒出结果，够用。

用法: python asr.py <音频或视频文件>
stdout: 一行 JSON {"ok":true,"text":"...","seconds":12.3}
"""
import json
import sys
import time

def main():
    path = sys.argv[1]
    t0 = time.time()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"缺 faster-whisper: {e}"}, ensure_ascii=False))
        return

    try:
        model = WhisperModel("small", device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            path,
            language="zh",
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            initial_prompt="以下是普通话口播视频的内容，请用简体中文输出。",
        )
        parts = [s.text.strip() for s in segments if s.text.strip()]
        text = "".join(parts)
        # 模型偶尔会吐出繁中/英文标点，简单收一下
        text = text.replace("，", "，").replace(",", "，").strip()
        print(json.dumps(
            {"ok": True, "text": text, "seconds": round(time.time() - t0, 1)},
            ensure_ascii=False,
        ))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
