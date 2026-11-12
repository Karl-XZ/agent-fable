"""Render Jing's fixed lines; narration and player lines remain caption-only."""
import asyncio
import hashlib
import json
import os
import sys
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
import app  # Loads the local backend environment without exposing credentials.
from tts import SpeechRequest, pcm_stream


async def main():
    path = root / "story.json"
    story = json.loads(path.read_text(encoding="utf-8"))
    output = root / "web/public/cinematics"
    output.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(1)

    async def render(beat):
        if beat["who"] != "静":
            beat["audio"] = ""
            return
        signature = json.dumps([beat["text"], beat["emotion"], os.environ.get("DASHSCOPE_TTS_MODEL"), os.environ.get("DASHSCOPE_TTS_VOICE")], ensure_ascii=False)
        name = hashlib.sha256(signature.encode()).hexdigest()[:20] + ".wav"
        target = output / name
        async with semaphore:
            if not target.exists():
                for attempt in range(3):
                    pcm = bytearray()
                    try:
                        async for chunk in pcm_stream(SpeechRequest(text=beat["text"], emotion=beat["emotion"])):
                            pcm.extend(chunk)
                        break
                    except (TimeoutError, OSError):
                        if attempt == 2:
                            raise
                        print(beat["id"], "network_retry", attempt + 1, flush=True)
                        await asyncio.sleep(1)
                if not pcm or len(pcm) % 2:
                    raise RuntimeError("Invalid PCM for " + beat["id"])
                with wave.open(str(target), "wb") as audio:
                    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000); audio.writeframes(pcm)
            with wave.open(str(target), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
            beat["audio"] = "/cinematics/" + name
            beat["seconds"] = round(max(beat["seconds"], duration + 0.8), 2)
            print(beat["id"], "audio_seconds", round(duration, 2), flush=True)

    try:
        await asyncio.gather(*(render(beat) for beats in story["films"].values() for beat in beats))
        path.write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Rendered film voices; credentials stayed on backend.", flush=True)
    finally:
        await app.client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
