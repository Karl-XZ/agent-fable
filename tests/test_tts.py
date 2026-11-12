import asyncio
import json
from unittest.mock import AsyncMock

import httpx
from websockets.asyncio.server import serve

import app as game
import tts
from fastapi import HTTPException


def test_jing_default_delivery_masks_inner_mood():
    for mood in ('calm', 'concerned', 'persuasive', 'anxious', 'panic', 'defeated', 'angry'):
        assert tts.emotion_direction('', mood) == tts.emotion_direction('', 'calm')
    assert '表演' in tts.emotion_direction('', 'panic')
    assert tts.emotion_direction('短暂失控，随后恢复礼貌', 'panic') == '短暂失控，随后恢复礼貌'


def test_tts_reuses_warmed_connection_across_utterances(monkeypatch):
    async def run():
        connections = []
        tasks = []
        async def upstream(ws):
            connections.append(ws)
            async for raw in ws:
                frame = json.loads(raw)
                if frame['header']['action'] == 'run-task':
                    tasks.append(frame['header']['task_id'])
                    await ws.send(json.dumps({'header': {'event': 'task-started'}}))
                elif frame['header']['action'] == 'finish-task':
                    await ws.send(b'\x01\x00\xff\xff')
                    await ws.send(json.dumps({'header': {'event': 'task-finished'}}))
        async with serve(upstream, '127.0.0.1', 0) as server:
            monkeypatch.setenv('DASHSCOPE_API_KEY', 'test-only-secret')
            monkeypatch.setenv('DASHSCOPE_TTS_WS_URL', f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}')
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url='http://test') as client:
                assert (await client.post('/api/tts/warmup')).status_code == 200
                for text in ['第一句。', '第二句。']:
                    response = await client.post('/api/tts', json={'text': text})
                    assert response.status_code == 200
                    assert response.content == b'\x01\x00\xff\xff'
        assert len(connections) == 1
        assert len(set(tasks)) == 2
    asyncio.run(run())


def test_static_path_cannot_read_backend_configuration():
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
            response = await client.get("/..%2f..%2f.env")
        assert response.status_code == 404
    asyncio.run(run())


def post(path, body):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
            return await client.post(path, json=body)
    return asyncio.run(run())


def test_tts_missing_key_is_explicit(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "")
    response = post("/api/tts", {"text": "欢迎回来。", "emotion": "温柔"})
    assert response.status_code == 503
    assert "key" not in response.text.lower()


def test_tts_rejects_empty_and_oversized_text():
    for text in ("", "   ", "啊" * 301):
        assert post("/api/tts", {"text": text}).status_code == 422


def test_tts_streams_pcm_and_forwards_separate_direction(monkeypatch):
    async def run():
        received = []
        async def upstream(ws):
            start = json.loads(await ws.recv()); received.append(start)
            tid = start["header"]["task_id"]
            await ws.send(json.dumps({"header": {"event": "task-started", "task_id": tid}}))
            received.append(json.loads(await ws.recv()))
            received.append(json.loads(await ws.recv()))
            await ws.send(b"\x01\x00\xff\xff")
            await ws.send(b"\x00\x40")
            await ws.send(json.dumps({"header": {"event": "task-finished", "task_id": tid}}))
        async with serve(upstream, "127.0.0.1", 0) as server:
            monkeypatch.setenv("DASHSCOPE_API_KEY", "test-only-secret")
            monkeypatch.setenv("DASHSCOPE_TTS_WS_URL", f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}")
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
                response = await client.post("/api/tts", json={"text": "请别走。", "mood": "anxious", "emotion": "温柔，但压抑着焦虑"})
        assert response.status_code == 200
        assert response.content == b"\x01\x00\xff\xff\x00\x40"
        assert response.headers["x-audio-sample-rate"] == "24000"
        parameters = received[0]["payload"]["parameters"]
        assert "温柔，但压抑着焦虑" in parameters["instruction"]
        assert parameters["format"] == "pcm"
        assert received[1]["payload"]["input"]["text"] == "请别走。"
        assert received[2]["header"]["action"] == "finish-task"
    asyncio.run(run())


def test_tts_provider_error_does_not_expose_credentials(monkeypatch):
    async def run():
        async def upstream(ws):
            await ws.recv()
            await ws.send(json.dumps({"header": {"event": "task-failed", "error_message": "test-only-secret"}}))
        async with serve(upstream, "127.0.0.1", 0) as server:
            monkeypatch.setenv("DASHSCOPE_API_KEY", "test-only-secret")
            monkeypatch.setenv("DASHSCOPE_TTS_WS_URL", f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}")
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
                response = await client.post("/api/tts", json={"text": "请别走。"})
        assert response.status_code == 502
        assert "test-only-secret" not in response.text
    asyncio.run(run())


def test_agent_exposes_per_utterance_emotion_and_defaults(monkeypatch, tmp_path):
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    for direction in ("轻声说，努力保持镇定", None):
        reply = {"say": "请别走。", "mood": "anxious", "tools": []}
        if direction is not None:
            reply["emotion"] = direction
        monkeypatch.setattr(game, "llm", AsyncMock(return_value=reply))
        response = post("/api/agent", {"session": "tts-test"})
        assert response.status_code == 200
        data = response.json()
        assert data["say"] == "请别走。"
        assert data["emotion"]
        if direction is not None:
            assert data["emotion"] == direction


def test_cancelled_client_closes_upstream_before_playback(monkeypatch):
    async def run():
        closed = asyncio.Event()
        async def upstream(ws):
            await ws.recv()
            await ws.send(json.dumps({"header": {"event": "task-started"}}))
            await ws.recv(); await ws.recv()
            await ws.send(b"\x00\x40")
            await ws.wait_closed(); closed.set()
        class DisconnectedRequest:
            async def is_disconnected(self):
                return True
        async with serve(upstream, "127.0.0.1", 0) as server:
            monkeypatch.setenv("DASHSCOPE_API_KEY", "test-only-secret")
            monkeypatch.setenv("DASHSCOPE_TTS_WS_URL", f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}")
            try:
                await tts.speech(tts.SpeechRequest(text="请别走。"), DisconnectedRequest())
                assert False, "Disconnected clients must not start playback"
            except HTTPException as error:
                assert error.status_code == 499
            await asyncio.wait_for(closed.wait(), 2)
    asyncio.run(run())
