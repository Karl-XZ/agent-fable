"""Backend-only Qwen-Audio streaming TTS; credentials never enter the browser."""
import asyncio
import json
import os
import time
import uuid
from contextlib import suppress, asynccontextmanager

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from websockets.asyncio.client import connect
from websockets.protocol import State

class SpeechConnection:
    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.lock = asyncio.Lock()
        self.socket = None
        self.identity = None

    async def get(self):
        identity = (os.environ.get('DASHSCOPE_TTS_WS_URL', ''), os.environ.get('DASHSCOPE_API_KEY', ''))
        if self.socket is None or self.socket.state != State.OPEN or identity != self.identity:
            await self.close()
            self.socket = await connect(identity[0], additional_headers={'Authorization': 'Bearer ' + identity[1]}, open_timeout=10, close_timeout=2, max_size=2**20)
            self.identity = identity
        return self.socket

    async def close(self):
        socket, self.socket = self.socket, None
        if socket is not None:
            await socket.close()


_connection = None


def speech_connection():
    global _connection
    if _connection is None or _connection.loop is not asyncio.get_running_loop():
        _connection = SpeechConnection()
    return _connection


@asynccontextmanager
async def speech_lifespan(_app):
    try:
        yield
    finally:
        await speech_connection().close()


router = APIRouter(lifespan=speech_lifespan)


@router.post('/api/tts/warmup')
async def warmup():
    if not os.environ.get('DASHSCOPE_API_KEY') or not os.environ.get('DASHSCOPE_TTS_WS_URL'):
        raise HTTPException(503, '阿里云语音尚未配置')
    channel = speech_connection()
    try:
        async with channel.lock:
            await channel.get()
    except Exception:
        raise HTTPException(502, '阿里云语音连接暂时不可用') from None
    return {'ready': True}


def emotion_direction(emotion, mood="calm") -> str:
    if isinstance(emotion, str) and emotion.strip():
        return emotion.strip()[:120]
    # Jing performs reassurance; her internal state does not dictate the voice.
    return "表演出温柔、从容、礼貌的照护者语气，带轻微微笑；掩饰真实情绪，不流露焦虑、怒意或慌乱"


class SpeechRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=300)
    emotion: str = Field(default="", max_length=120)
    mood: str = Field(default="calm", max_length=12)


async def pcm_stream(speech: SpeechRequest):
    task_id = str(uuid.uuid4())
    deadline = time.monotonic() + 45
    instruction = "请用中文普通话，保持同一位女性管家角色的音色。" + emotion_direction(speech.emotion, speech.mood)

    def frame(action, payload):
        return json.dumps({"header": {"action": action, "task_id": task_id, "streaming": "duplex"}, "payload": payload}, ensure_ascii=False)

    channel = speech_connection()
    async with channel.lock:
        ws = await channel.get()
        finished = False
        try:
            async for data in synthesize(ws, speech, deadline, instruction, frame):
                yield data
            finished = True
        finally:
            # An interrupted task leaves unread events; never reuse that connection.
            if not finished:
                await channel.close()


async def synthesize(ws, speech, deadline, instruction, frame):
    await ws.send(frame("run-task", {
        "task_group": "audio", "task": "tts", "function": "SpeechSynthesizer",
        "model": os.environ.get("DASHSCOPE_TTS_MODEL", "qwen-audio-3.1-tts-flash"),
        "parameters": {"text_type": "PlainText", "voice": os.environ.get("DASHSCOPE_TTS_VOICE", "longanhuan_v3.1"),
                       "format": "pcm", "sample_rate": 24000, "instruction": instruction},
        "input": {},
    }))
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("TTS deadline exceeded")
        data = await asyncio.wait_for(ws.recv(), min(20, remaining))
        if isinstance(data, bytes):
            if data:
                yield data
            continue
        event = json.loads(data).get("header", {}).get("event")
        if event == "task-started":
            await ws.send(frame("continue-task", {"input": {"text": speech.text}}))
            await ws.send(frame("finish-task", {"input": {}}))
        elif event == "task-failed":
            # Provider errors may echo credentials or request data; keep them private.
            raise RuntimeError("TTS provider rejected the task")
        elif event == "task-finished":
            return

@router.post("/api/tts")
async def speech(speech: SpeechRequest, request: Request):
    if not os.environ.get("DASHSCOPE_API_KEY") or not os.environ.get("DASHSCOPE_TTS_WS_URL"):
        raise HTTPException(503, "阿里云语音尚未配置")
    stream = pcm_stream(speech)
    first_task = asyncio.create_task(anext(stream))
    ready = False
    try:
        while not first_task.done():
            await asyncio.wait({first_task}, timeout=0.2)
            if await request.is_disconnected():
                raise HTTPException(499, "语音请求已取消")
        first = first_task.result()
        ready = True
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "阿里云语音暂时不可用，请稍后重试") from None
    finally:
        if not first_task.done():
            first_task.cancel()
            with suppress(asyncio.CancelledError):
                await first_task
        if not ready:
            await stream.aclose()

    async def body():
        try:
            yield first
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()

    return StreamingResponse(body(), media_type="application/octet-stream", headers={
        "X-Audio-Sample-Rate": "24000", "X-Audio-Format": "pcm_s16le",
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })
