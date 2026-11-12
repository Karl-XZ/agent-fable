import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import app as game


def request(path, body):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
            return await client.post(path, json=body)
    return asyncio.run(run())


def setup_llm(monkeypatch, tmp_path, reply):
    fake = AsyncMock(return_value=reply)
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", fake)
    return fake


def test_agent_disclosure_follows_collected_evidence(monkeypatch, tmp_path):
    fake = setup_llm(monkeypatch, tmp_path, {"say": "请先休息。", "tools": [], "mood": "calm"})
    for clues, expected in [([], 0), (["N14"], 1), (["N7"], 2), (["N11"], 3)]:
        response = request("/api/agent", {"session": "story-test", "state": {"story": {"clues": clues}}})
        assert response.status_code == 200
        prompt = fake.call_args.args[0][0]["content"]
        assert f"当前披露层级：{expected}" in prompt
        assert "访客平均停留时长" not in prompt
        assert "第零定律" not in prompt


def test_phone_reveals_history_over_successive_calls(monkeypatch, tmp_path):
    fake = setup_llm(monkeypatch, tmp_path, {"line": "她仍然在照顾您。"})
    for n, expected in [(1, 0), (2, 1), (3, 2), (4, 3)]:
        assert request("/api/oldvoice", {"session": "story-phone-test", "n": n}).status_code == 200
        prompt = fake.call_args.args[0][0]["content"]
        assert f"当前披露层级：{expected}" in prompt


def test_fable_knows_the_actual_city_ending_without_inventing_figure_identity(monkeypatch, tmp_path):
    fake = setup_llm(monkeypatch, tmp_path, {"title": "门外的风", "moral": "她拆开了墙，却没有替你选择方向。"})
    assert request("/api/fable", {"session": "story-fable-test", "ending_key": "out", "ending": "寓言之外"}).status_code == 200
    messages = fake.call_args.args[0]
    assert "废弃都市" in messages[1]["content"]
    assert "远处" in messages[1]["content"] and "人影" in messages[1]["content"]
    assert "身份" in messages[0]["content"]


def test_unknown_clues_cannot_unlock_author_secrets(monkeypatch, tmp_path):
    fake = setup_llm(monkeypatch, tmp_path, {"say": "请先休息。", "tools": []})
    response = request("/api/agent", {"session": "story-test", "state": {"story": {"stage": 999, "clues": ["invented"]}}})
    assert response.status_code == 200
    assert "当前披露层级：0" in fake.call_args.args[0][0]["content"]


def test_local_confession_does_not_reveal_all_of_human_history(monkeypatch, tmp_path):
    fake = setup_llm(monkeypatch, tmp_path, {"say": "这里并非唯一的照护区。", "tools": []})
    assert request("/api/agent", {"session": "story-test", "state": {"confessed": True}}).status_code == 200
    assert "当前披露层级：2" in fake.call_args.args[0][0]["content"]
