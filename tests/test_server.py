"""Delivery, limits and failure behaviour of the public endpoints."""
import asyncio
import json
from unittest.mock import AsyncMock

import httpx

import app as game
import brain


def call(method, path, **kw):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://test") as client:
            return await client.request(method, path, **kw)
    return asyncio.run(run())


def test_model_failure_falls_back_to_the_offline_director_without_leaking_details(monkeypatch, tmp_path):
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", AsyncMock(side_effect=RuntimeError("upstream said: Bearer test-only-secret")))
    response = call("POST", "/api/agent", json={"session": "down", "state": {}})
    assert response.status_code == 200
    assert response.json()["source"] == "local"
    assert "test-only-secret" not in response.text
    assert not (tmp_path / "calls.jsonl").exists()


def test_spent_quota_keeps_the_game_running_locally(monkeypatch, tmp_path):
    model = AsyncMock(return_value={"say": "好。", "tools": []})
    monkeypatch.setattr(game, "API_KEY", "test-only-secret")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", model)
    monkeypatch.setitem(game.session_calls, "spent", [400, __import__("time").time()])
    assert call("POST", "/api/agent", json={"session": "spent", "state": {}}).json()["source"] == "local"
    assert model.call_count == 0
    assert call("POST", "/api/agent", json={"session": "fresh", "state": {}}).json()["source"] == "llm"


def test_session_table_is_bounded(monkeypatch):
    monkeypatch.setattr(game, "session_calls", {})
    monkeypatch.setattr(game, "MAX_SESSIONS", 40)
    for i in range(200):
        game.quota(f"s{i}")
    assert len(game.session_calls) <= 40


def test_bodies_are_bounded_and_must_be_json_objects():
    assert call("POST", "/api/agent", content=b"x" * (game.MAX_BODY + 1), headers={"content-type": "application/json"}).status_code == 413
    assert call("POST", "/api/agent", content=b"{not json", headers={"content-type": "application/json"}).status_code == 400
    assert call("POST", "/api/agent", json=[1, 2]).status_code == 400
    assert call("POST", "/api/fable", content=b"[]", headers={"content-type": "application/json"}).status_code == 400


def test_model_tool_calls_survive_sloppy_argument_fields(monkeypatch, tmp_path):
    monkeypatch.setattr(game, "API_KEY", "k")
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "llm", AsyncMock(return_value={"say": "", "tools": [{"name": "confess", "args": None}, {"name": "confess"}, {"name": "open_door", "args": "D110"}, {"name": "open_door", "args": {"id": "D110"}}, {"name": "rm", "args": {}}, "junk"]}))
    out = call("POST", "/api/agent", json={"state": {}}).json()
    assert out["tools"] == [{"name": "confess", "args": {}}, {"name": "confess", "args": {}}, {"name": "open_door", "args": {}}, {"name": "open_door", "args": {"id": "D110"}}]
    assert out["source"] == "llm" and "fallback" not in out


def test_fallback_turns_are_labelled_with_their_reason(monkeypatch, tmp_path):
    monkeypatch.setattr(game, "LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(game, "API_KEY", "")
    assert call("POST", "/api/agent", json={"state": {}}).json()["fallback"] == "no_key"
    monkeypatch.setattr(game, "API_KEY", "k")
    monkeypatch.setattr(game, "llm", AsyncMock(side_effect=RuntimeError("x")))
    out = call("POST", "/api/agent", json={"session": "label", "state": {}}).json()
    assert out["source"] == "local" and out["fallback"] == "model_error"


def test_generic_provider_settings_shape_the_request(monkeypatch):
    sent = []

    async def post(url, **kwargs):
        sent.append((url, kwargs))
        return httpx.Response(200, json={"choices": [{"message": {"content": "```json\n{\"say\": \"好\", \"tools\": []}\n```"}}]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(game.client, "post", post)
    monkeypatch.setattr(game, "API_KEY", "sk-test")
    monkeypatch.setattr(game, "BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(game, "MODEL", "any-openai-compatible")
    monkeypatch.setattr(game, "LLM_THINKING", "omit")
    monkeypatch.setattr(game, "LLM_JSON_MODE", False)
    monkeypatch.setattr(game, "LLM_EXTRA_BODY", {"top_p": 0.8})
    assert asyncio.run(game.llm([{"role": "user", "content": "hi"}]))["say"] == "好"
    url, kwargs = sent[0]
    assert url == "http://127.0.0.1:9/v1/chat/completions"
    assert kwargs["headers"]["Authorization"] == "Bearer sk-test"
    payload = kwargs["json"]
    assert payload["model"] == "any-openai-compatible" and payload["top_p"] == 0.8
    assert "thinking" not in payload and "response_format" not in payload


def test_bad_credentials_are_diagnosed_once_and_never_echoed(monkeypatch):
    calls = []

    async def post(url, **kwargs):
        calls.append(url)
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-secret-123"}}, request=httpx.Request("POST", url))
    monkeypatch.setattr(game.client, "post", post)
    monkeypatch.setattr(game, "API_KEY", "sk-secret-123")
    monkeypatch.setitem(game._probe, "result", None)
    result = call("POST", "/api/llm/check").json()
    assert result["ok"] is False and "401" in result["error"] and "密钥" in result["error"]
    assert "sk-secret-123" not in json.dumps(result, ensure_ascii=False)
    assert len(calls) == 1, "an invalid key must not be retried"
    health = asyncio.run(game.health())
    assert health["llm"]["calls_failed"] >= 1 and "401" in health["llm"]["last_error"]
    assert "sk-secret-123" not in json.dumps(health, ensure_ascii=False)


def test_connectivity_check_reports_missing_and_working_configurations(monkeypatch):
    monkeypatch.setattr(game, "API_KEY", "")
    assert call("POST", "/api/llm/check").json() == {"ok": False, "configured": False, "error": "未配置 LLM_API_KEY（或 DEEPSEEK_API_KEY）"}
    monkeypatch.setattr(game, "API_KEY", "k")
    monkeypatch.setitem(game._probe, "result", None)
    monkeypatch.setattr(game, "llm", AsyncMock(return_value={"ok": True, "say": "您好"}))
    first = call("POST", "/api/llm/check").json()
    assert first["ok"] is True and first["say"] == "您好" and "cached" not in first
    assert call("POST", "/api/llm/check").json()["cached"] is True


def test_static_delivery_rules(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>t</title>" + "x" * 4000, encoding="utf-8")
    (dist / "assets" / "app-abc.js").write_text("console.log(1);" * 400, encoding="utf-8")
    (dist / "jing").mkdir()
    (dist / "jing" / "a.png").write_bytes(b"\x89PNG" + b"0" * 2000)
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")
    monkeypatch.setattr(game, "DIST", dist)
    page = call("GET", "/", headers={"accept-encoding": "gzip"})
    assert page.status_code == 200 and page.headers["cache-control"] == "no-cache"
    assert page.headers.get("content-encoding") == "gzip"
    assert page.headers["x-content-type-options"] == "nosniff"
    script = call("GET", "/assets/app-abc.js", headers={"accept-encoding": "gzip"})
    assert script.status_code == 200 and "immutable" in script.headers["cache-control"]
    image = call("GET", "/jing/a.png", headers={"accept-encoding": "gzip"})
    assert image.status_code == 200 and "content-encoding" not in image.headers and "max-age=604800" in image.headers["cache-control"]
    assert call("GET", "/some/client/route").status_code == 200       # the page shell
    assert call("GET", "/assets/missing-123.js").status_code == 404    # never the page shell
    assert call("GET", "/api/unknown").status_code == 404
    assert call("GET", "/../secret.txt").status_code in (404, 400)
    assert call("GET", "/%2e%2e/secret.txt").status_code in (404, 400)


def test_unbuilt_frontend_explains_itself(monkeypatch, tmp_path):
    monkeypatch.setattr(game, "DIST", tmp_path / "nothing")
    response = call("GET", "/")
    assert response.status_code == 503 and "npm run build" in response.text


def test_health_reports_which_brain_is_active(monkeypatch):
    monkeypatch.setattr(game, "API_KEY", "")
    health = asyncio.run(game.health())
    assert health["brain"] == "local" and health["key"] is False and health["version"]
    monkeypatch.setattr(game, "API_KEY", "k")
    assert asyncio.run(game.health())["brain"] == "llm"


def test_offline_memory_is_bounded(monkeypatch):
    brain.reset_minds()
    monkeypatch.setattr(brain, "MAX_MINDS", 50)
    for i in range(300):
        brain.mind_for(f"m{i}")
    assert len(brain._MINDS) <= 50


def test_decision_log_rotates(monkeypatch, tmp_path):
    log = tmp_path / "calls.log"
    log.write_text("x" * 2048, encoding="utf-8")
    monkeypatch.setattr(game, "LOG", log)
    monkeypatch.setattr(game, "MAX_LOG", 1024)
    game.record({"a": 1})
    assert json.loads(log.read_text(encoding="utf-8")) == {"a": 1}
    assert (tmp_path / "calls.log.1").stat().st_size == 2048
