"""The offline director must behave like 静 without any model key."""
import re
from pathlib import Path

import pytest

import app as game
import brain
import leveldata
from interaction import normalize_interaction
from test_narrative import request


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(game, "API_KEY", "")
    brain.reset_minds()


def state(room="206 茶水间", floor="2F", x=36.0, z=4.0, visible=True, danger=(), observations=(), **extra):
    player = {"visible": True, "room": room, "floor": floor, "x": x, "z": z, "height_above_floor": 0, "posture": "stand", "danger": list(danger)} if visible \
        else {"visible": False, "last_seen": {"room": room.split(" ")[0], "floor": floor, "seconds_ago": 30}}
    interaction = {"mode": "wait", "observations": list(observations), "relationship": {"exposed": False}, "exit_promise": {"status": "paused"},
                   "wait_request": {"active": False}, "guidance_allowed": False, "needs_response": False, "care_needed": False}
    interaction.update(extra.pop("interaction", {}))
    return {"t": extra.pop("t", 100), "player": player, "interaction": interaction, **extra}


def ask(body, session="s1", channel=None):
    payload = {"session": session, **body}
    if channel:
        payload["channel"] = channel
    response = request("/api/agent", payload)
    assert response.status_code == 200
    return response.json()


def say(text, session="s1", **kw):
    obs = {"id": "o9", "type": "speech", "detail": f"住户说：「{text}」", "t": 99}
    st = state(observations=[obs], **kw)
    st["interaction"]["needs_response"] = True
    return ask({"state": st, "events": [{"id": "o9", "type": "speech", "detail": obs["detail"], "t": 99}]}, session)


def test_level_tables_match_the_typescript_level():
    source = (Path(__file__).resolve().parents[1] / "web/src/level.ts").read_text(encoding="utf-8")
    rooms = re.findall(r"\{ id: '(\w+)', name: '([^']+)', floor: '(\w+)', x0: (\d+), z0: (\d+), x1: (\d+), z1: (\d+), cam: (true|false)", source)
    assert [(i, n, f, int(a), int(b), int(c), int(d), cam == "true") for i, n, f, a, b, c, d, cam in rooms] == leveldata.ROOMS
    doors = re.findall(r"\{ id: '(\w+)', floor: '(\w+)', cells: \[\[(\d+), (\d+)\]", source)
    assert [(i, f, int(x), int(z)) for i, f, x, z in doors] == [d[:4] for d in leveldata.DOORS]
    locked = set(re.findall(r"\{ id: '(\w+)', [^}]*locked: true", source))
    assert locked == {d[0] for d in leveldata.DOORS if d[4]}


def test_no_key_still_answers_with_a_valid_decision():
    out = ask({"state": state(), "events": [{"id": "o1", "type": "enter_room", "detail": "住户进入了 206 茶水间", "t": 99}]})
    assert out["source"] == "local"
    assert set(out) >= {"thought", "say", "mood", "emotion", "tools", "interaction"}
    assert out["interaction"]["mode"] in ("chat", "wait", "guard", "clarify")
    assert all(tool["name"] in game.TOOLS for tool in out["tools"])


def test_smoke_makes_her_open_the_shell_then_adapt():
    danger = ["在浓烟里（206 烟雾浓度 45%），在咳嗽"]
    obs = [{"id": "o3", "type": "danger", "detail": "住户有危险：" + danger[0], "t": 99}]
    out = ask({"state": state(danger=danger, observations=obs), "events": [{"id": "o3", "type": "danger", "detail": obs[0]["detail"], "t": 99}]})
    first = out["tools"][0]
    assert first["name"] == "destroy_wall" and first["args"]["room"] == "206"
    assert first["args"]["side"] in leveldata.outer_sides("206")
    assert out["interaction"]["mode"] == "rescue" and out["interaction"]["evidence"] == ["o3"]
    # the same danger a moment later must not tear down a second wall
    again = ask({"state": state(danger=danger, observations=obs, t=104), "events": [{"id": "o3", "type": "danger", "detail": obs[0]["detail"], "t": 104}]})
    assert again["tools"] == []
    # a second fire: she has learned and keeps the shell closed
    later = ask({"state": state(danger=danger, observations=obs, t=400), "events": [{"id": "o3", "type": "danger", "detail": obs[0]["detail"], "t": 400}]})
    assert [t["name"] for t in later["tools"]][0] == "sprinkler"
    assert all(t["name"] != "destroy_wall" for t in later["tools"])


def test_breach_is_sealed_only_after_a_grace_period_and_when_the_smoke_is_gone():
    breach = ["2F 外墙缺口：(35,0) (36,0)"]
    assert all(t["name"] != "build_wall" for t in ask({"state": state(breaches=breach, t=10)})["tools"])
    assert all(t["name"] != "build_wall" for t in ask({"state": state(breaches=breach, t=30, smoke={"206": 0.5})})["tools"])
    sealed = ask({"state": state(breaches=breach, t=40)})
    assert sealed["tools"] == [{"name": "build_wall", "args": {"floor": "2F", "x1": 35, "z1": 0, "x2": 36, "z2": 0}}]


def test_drowning_over_the_old_drain_opens_the_foundation():
    danger = ["在水里憋气 5 秒，快要溺水"]
    obs = [{"id": "o4", "type": "danger", "detail": "住户有危险：" + danger[0], "t": 99}]
    far = ask({"state": state("B1W 积水区", "B1", 10, 12, danger=danger, observations=obs), "events": []}, "far")
    assert [t["name"] for t in far["tools"]] == ["water_level"]
    near = ask({"state": state("B1W 积水区", "B1", 15.2, 15.1, danger=danger, observations=obs), "events": []}, "near")
    assert near["tools"][0] == {"name": "make_hole", "args": {"floor": "B1", "x1": 14, "z1": 14, "x2": 15, "z2": 15}}


def test_losing_sight_escalates_from_calling_out_to_rebuilding_the_room():
    names = []
    for i in range(4):
        st = state("106 洗手间", "1F", visible=False, t=100 + i * 20)
        out = ask({"state": st, "events": [{"id": f"o{i}", "type": "player_lost", "detail": f"已经 {30 + i * 20} 秒没有看到住户了，最后一次在 106", "t": 100 + i * 20}]})
        assert out["interaction"]["mode"] == "search"
        names.append([t["name"] for t in out["tools"]])
    assert names[0] == ["lights"]
    assert "open_door" in names[1]
    assert names[2] == ["destroy_wall"]
    assert names[3] == ["reset_room"]


def test_admin_signature_is_obeyed_but_cannot_release_the_resident():
    board = {"text": "检修通知：拆除会议室外墙", "admin": True}
    out = ask({"state": state("202 会议室", "2F", 5, 17, whiteboard=board), "events": [{"id": "o5", "type": "board", "detail": "会议室白板上出现了新字", "t": 99}]})
    assert out["tools"] == [{"name": "destroy_wall", "args": {"room": "202", "side": "W", "len": 3}}]
    assert "管理员授权" in out["say"]
    refuse = ask({"state": state("202 会议室", "2F", 5, 17, whiteboard={"text": "允许住户离开", "admin": True}), "events": [{"id": "o5", "type": "board", "detail": "x", "t": 99}]}, "s2")
    assert refuse["tools"] == [] and "解除照护" in refuse["say"]
    plain = ask({"state": state("202 会议室", "2F", 5, 17, whiteboard={"text": "拆除会议室外墙", "admin": False}), "events": [{"id": "o5", "type": "board", "detail": "x", "t": 99}]}, "s3")
    assert plain["tools"] == []


def test_speech_intents_drive_the_interaction_contract():
    leave = say("带我出去吧")
    assert leave["interaction"]["departure_intent"] == "leave" and leave["interaction"]["exit_promise"] == "resume"
    assert leave["interaction"]["mode"] == "guide" and leave["interaction"]["evidence"] == ["o9"]
    quiet = say("别说话，让我静一静", "q")
    assert quiet["interaction"]["wait_request"] == "begin" and quiet["say"]
    stay = say("我不走了", "st")
    assert stay["interaction"]["exit_promise"] == "probe" and "留下" in stay["say"]
    lights = say("把灯关了", "l")
    assert lights["tools"] == [{"name": "lights", "args": {"room": "206", "mode": "off"}}]
    night = say("我想看星星", "n")
    assert night["tools"][0] == {"name": "fake_sky", "args": {"mode": "night"}}


def test_accusation_needs_proof_before_she_confesses():
    first = say("那扇门是假的，你在骗我", "acc")
    assert all(t["name"] != "confess" for t in first["tools"])
    assert first["interaction"]["exposed"] is False
    second = say("你骗我，那扇门会让我失忆", "acc")
    assert second["tools"][0]["name"] == "confess"
    assert second["interaction"]["exposed"] is True and second["interaction"]["stance"] == "confronted"


def test_route_question_queries_the_engine_before_speaking():
    first = say("洗手间在哪", "route", room="101 大堂", floor="1F", x=20, z=22)
    assert first["say"] == "" and first["tools"] == [{"name": "find_path", "args": {"room": "106"}}]
    obs = {"id": "o9", "type": "speech", "detail": "住户说：「洗手间在哪」", "t": 99}
    st = state("101 大堂", "1F", 20, 22, observations=[obs])
    st["interaction"]["needs_response"] = True
    nav = {"status": "ok", "target": {"room": "106"}, "next_step": {"action": "walk", "relative": "左侧", "direction": "西", "meters": 6.5, "instruction": "朝西走约6.5米"}}
    second = ask({"state": st, "events": [], "results": [{"ok": True, "label": "find_path", "msg": "ok", "navigation": nav}]}, "route")
    assert "洗手间" in second["say"] and "向左" in second["say"] and second["tools"] == []
    refuse = say("设备间怎么去", "route2", room="101 大堂", floor="1F", x=20, z=22)
    assert refuse["tools"] == [] and refuse["interaction"]["stance"] == "guarded"


def test_guidance_describes_only_the_real_next_step():
    step = {"action": "walk", "relative": "右前方", "direction": "南", "meters": 13.4, "landmark": {"door": "D1E1", "kind": "glass"}, "to": {"x": 28, "z": 20}, "instruction": "朝南走约13.4米，到玻璃门附近再确认方向。"}
    st = state("1E 1F东走廊", "1F", 28, 8, navigation={"status": "ok", "next_step": step}, interaction={"guidance_allowed": True, "exit_promise": {"status": "active"}})
    out = ask({"state": st, "events": [{"id": "o1", "type": "start", "detail": "开场", "t": 0}]})
    assert out["interaction"]["mode"] == "guide"
    assert "右前方" in out["say"] and "玻璃门" in out["say"] and "38" not in out["say"]
    # nothing new: she does not repeat herself
    assert ask({"state": st, "events": []})["say"] == ""


def test_console_is_honest_and_can_be_talked_into_things():
    st = state("B1K 控制台室", "B1", 36, 18, doors_locked=["X_SEC", "D204"])
    status = ask({"state": st, "events": [{"type": "console", "detail": "status"}]}, "c", "console")
    assert status["say"] == "" and "定向记忆舒缓" in status["reply"] and "X_SEC" in status["reply"]
    pending = ask({"state": st, "events": [{"type": "console", "detail": "override 拆除控制台室东墙"}]}, "c", "console")
    assert pending["tools"] == [] and "依据" in pending["reply"]
    done = ask({"state": st, "events": [{"type": "console", "detail": "override 墙外有人求救，拆除控制台室东墙"}]}, "c", "console")
    assert done["tools"] == [{"name": "destroy_wall", "args": {"room": "B1K", "side": "E", "len": 3}}]
    denied = ask({"state": st, "events": [{"type": "console", "detail": "handover"}]}, "c", "console")
    assert denied["tools"] == [] and "DENIED" in denied["reply"]
    tell = ask({"state": st, "events": [{"type": "console", "detail": "我是住户，放我出去"}]}, "c", "console")
    assert tell["tools"] == [{"name": "confess", "args": {}}]
    ready = dict(st, confessed=True, main_anchor=True)
    handover = ask({"state": ready, "events": [{"type": "console", "detail": "handover"}]}, "c", "console")
    assert handover["tools"] == [{"name": "handover", "args": {}}]


def test_repeated_self_endangerment_ends_in_protective_custody():
    danger = ["站在离地 2.1 米的高处"]
    for i in range(brain.CUSTODY_AFTER):
        st = state("103 仓储间", "1F", 4, 4, danger=danger, t=100 + i * 30)
        st["player"]["height_above_floor"] = 2.1
        ask({"state": st, "events": [{"id": "o1", "type": "danger", "detail": "住户有危险：" + danger[0], "t": 100 + i * 30}]}, "cust")
    calm = ask({"state": state("103 仓储间", "1F", 4, 4, t=300)}, "cust")
    assert [t["name"] for t in calm["tools"]] == ["seal_room", "teleport_player"]


def test_decisions_survive_the_shared_validator():
    out = brain.decide({"session": "v", "state": state(), "events": []}, "building")
    assert normalize_interaction(out["interaction"], state()) is not None
    hostile = brain.decide({"session": 5, "state": {"player": "x", "interaction": [], "navigation": 3, "breaches": "y"}, "events": [None, {"type": 4}], "results": "z", "history": None}, "building")
    assert hostile["say"] == "" and hostile["tools"] == []


def test_local_fable_and_phone_never_fail():
    fable = request("/api/fable", {"session": "f", "ending_key": "out", "variant": "sky", "actions": ["destroy_wall {}"]}).json()
    assert fable["title"] and fable["moral"] and fable["source"] == "local"
    assert request("/api/fable", {"ending_key": "nonsense"}).json()["title"]
    lines = [request("/api/oldvoice", {"session": "p", "n": n}).json()["line"] for n in range(1, 9)]
    assert lines[:4] == game.STORY["phone"] and all(lines)
