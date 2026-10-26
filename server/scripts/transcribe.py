#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""faster-whisper 逐词转写：输出词级时间戳 JSON

用法: python transcribe.py <audio_or_video> [model]
输出: {"ok":true,"data":{"language":"zh","duration":31.4,"words":[{"w":"你","s":0.12,"e":0.31}]}}
"""
import json
import sys


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "缺少音频路径"}))
        return

    media = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "small"

    try:
        from faster_whisper import WhisperModel

        # Intel Mac 无 CUDA：CPU + int8 最快
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            media,
            language="zh",
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            beam_size=5,
        )

        words = []
        for seg in segments:
            for w in (seg.words or []):
                text = (w.word or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "w": text,
                        "s": round(float(w.start), 3),
                        "e": round(float(w.end), 3),
                    }
                )

        print(
            json.dumps(
                {
                    "ok": True,
                    "data": {
                        "language": info.language,
                        "duration": round(float(info.duration), 2),
                        "words": words,
                    },
                },
                ensure_ascii=False,
            )
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
