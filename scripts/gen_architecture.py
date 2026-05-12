#!/usr/bin/env python3
"""调 OpenAI gpt-image-1 生成架构图, 输出到 docs/architecture.png"""
import base64
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()
client = OpenAI()

PROMPT = """
A clean modern technical architecture diagram for a realtime voice translation web app, in flat illustrated style with warm cream paper background (#FDFAF3), accents in burnt orange (#D97757) and dark ink (#2B2620). Composition (top to bottom, left to right):

Top layer: a smartphone showing a Chinese app called "实时转译" with live captions and a small orange FFT waveform at the bottom. Label "Browser · Web Audio · VAD ONNX · Vanilla JS".

Below it, an arrow labeled "WebSocket / PCM16 24kHz" pointing down to a rounded rectangle labeled "FastAPI Server · RoomManager · RecordingSession".

From the FastAPI server, three arrows branch out to three engine boxes side by side:
1. left: "DashScope · Qwen3-ASR (识别)" with a microphone icon
2. middle: "DeepSeek-V4 · Translate (翻译)" with a globe icon
3. right: "OpenAI Realtime · gpt-realtime-translate (端到端)" with a sparkle icon

To the right of FastAPI, a SQLite database cylinder labeled "SQLite WAL · users · sessions · recordings · rooms".

Use clean sans-serif typography, minimalist line icons, subtle drop shadows, generous whitespace, professional and friendly aesthetic. Aspect ratio 3:2 horizontal. No code, no UI mockups inside arrows. Editorial illustration quality, suitable for a GitHub README hero image.
"""

OUT = Path(__file__).parent.parent / "docs" / "architecture.png"
OUT.parent.mkdir(parents=True, exist_ok=True)


def gen(model="gpt-image-1"):
    print(f"→ generating with {model}…")
    kwargs = {
        "model": model,
        "prompt": PROMPT,
        "size": "1536x1024",
    }
    if model == "gpt-image-1":
        kwargs["quality"] = "high"
    else:
        kwargs["quality"] = "hd"
        kwargs["response_format"] = "b64_json"
    result = client.images.generate(**kwargs)
    b64 = result.data[0].b64_json
    if not b64:
        raise RuntimeError("no b64_json in response")
    OUT.write_bytes(base64.b64decode(b64))
    print(f"✓ saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    model = sys.argv[1] if len(sys.argv) > 1 else "gpt-image-1"
    try:
        gen(model)
    except Exception as e:
        print(f"✗ {model} failed: {e}")
        if model == "gpt-image-1":
            print("retrying with dall-e-3…")
            gen("dall-e-3")
        else:
            sys.exit(1)
