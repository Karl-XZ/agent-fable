import asyncio
from unittest.mock import AsyncMock
import httpx
import app as game


def test_guided_exit_is_a_memory_door_not_an_endless_walk(monkeypatch, tmp_path):
    fake = AsyncMock(return_value={"say": "我会为您指引出去的路。", "tools": []})
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", fake)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
            return await client.post('/api/agent', json={"session": "memory-test", "state": {"story": {"clues": []}}, "events": []})
    assert asyncio.run(run()).status_code == 200
    prompt = fake.call_args.args[0][0]['content']
    assert '失忆门' in prompt
    assert '近期' in prompt
    assert '循环散步路线' not in prompt


def test_guidance_preserves_the_promised_exit_instead_of_offering_home(monkeypatch, tmp_path):
    fake = AsyncMock(return_value={"say": "前面那扇亮着的门就是出口。", "tools": []})
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", fake)
    from test_narrative import request
    response = request('/api/agent', {"session": "exit-cover-story", "state": {"player": {"room": "108"}, "story": {"clues": []}}, "events": [{"type": "near_exit", "detail": "住户坚持出去看看，已到108东端亮门前"}]})
    assert response.status_code == 200
    prompt = fake.call_args.args[0][0]['content']
    assert '【对住户的出行承诺】' in prompt
    assert '称作休息或回家' not in prompt
    assert '在进入失忆门之前' in prompt
    assert '回家好好休息' in prompt
    assert '仍需确认安全回应' not in prompt


def test_regenerating_film_audio_does_not_revoice_narration(monkeypatch, tmp_path):
    import json
    from scripts import render_film_voices as render
    beats = json.loads(json.dumps(game.STORY['films']['intro'][:4], ensure_ascii=False))
    (tmp_path / 'story.json').write_text(json.dumps({"films": {"intro": beats, "memory": []}}, ensure_ascii=False), encoding='utf-8')
    calls = []
    async def fake_pcm(request):
        calls.append(request.text)
        yield b'\x00\x00' * 240
    monkeypatch.setattr(render, 'root', tmp_path)
    monkeypatch.setattr(render, 'pcm_stream', fake_pcm)
    monkeypatch.setattr(render.app, 'client', AsyncMock())
    asyncio.run(render.main())
    saved = json.loads((tmp_path / 'story.json').read_text(encoding='utf-8'))['films']['intro']
    assert calls == [beats[3]['text']]
    assert all(beat['audio'] == '' for beat in saved[:3])
    assert saved[3]['audio'].startswith('/cinematics/')
