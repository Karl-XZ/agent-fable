import json
from unittest.mock import AsyncMock

import pytest
import app as game
from test_narrative import request


def context(**changes):
    result = {"mode": "wait", "guidance_allowed": False, "quiet": True, "activity": {"kind": "reading", "observed": True}, "relationship": {"stance": "cooperative", "exposed": False, "ruptured": False}, "observations": [{"id": "e1", "type": "speech", "detail": "住户说：先不出去了，我看看这张纸。", "t": 4}]}
    result.update(changes)
    return {"player": {"visible": True}, "interaction": result}


def test_catalog_covers_all_approved_modes():
    from interaction import MODES
    assert set(MODES) == set('care chat assist guide wait clarify probe conceal negotiate guard restrain appeal search rescue repair'.split())


@pytest.mark.parametrize('mode', 'care chat assist guide wait clarify probe conceal negotiate guard restrain appeal search rescue repair'.split())
def test_each_approved_mode_survives_normalization(mode):
    from interaction import normalize_interaction
    assert normalize_interaction({'mode': mode}, context())['mode'] == mode


@pytest.mark.parametrize('confidence', [float('nan'), float('inf'), [], 'certain', True])
def test_invalid_confidence_is_not_accepted_as_certainty(confidence):
    from interaction import normalize_interaction
    assert normalize_interaction({'mode': 'clarify', 'confidence': confidence}, context())['confidence'] == 0


def test_normalizer_preserves_grounded_decisions_and_limits_fields():
    from interaction import normalize_interaction
    decision = {"mode": "care", "intent": "先看纸条", "confidence": 5, "reason": "住户明确请求", "evidence": ["invented", "e1"], "exit_promise": "pause", "stance": "guarded", "remember": ["主人想先看文件"], "commitment": {"text": "等主人看完", "status": "active"}}
    normalized = normalize_interaction(decision, context(), 'building')
    assert normalized['mode'] == 'care'
    assert normalized['confidence'] == 1
    assert normalized['evidence'] == ['e1']
    assert normalized['exit_promise'] == 'pause'
    assert normalized['remember'] == ['主人想先看文件']
    assert normalized['commitment']['status'] == 'active'


@pytest.mark.parametrize('decision', [None, '', [], 1, {"mode": "invented"}])
def test_invalid_and_legacy_decisions_are_optional(decision):
    from interaction import normalize_interaction
    assert normalize_interaction(decision, context(), 'building') is None


def test_invented_or_non_speech_evidence_cannot_create_confrontation():
    from interaction import normalize_interaction
    decision = {"mode": "restrain", "confidence": .9, "stance": "confronted", "exposed": True, "ruptured": True, "evidence": ["e1"], "remember": ["主人知道全部真相"], "exit_promise": "withdraw"}
    state = context(observations=[{"id": "e1", "type": "inspect", "detail": "住户在看纸条", "t": 4}])
    normalized = normalize_interaction(decision, state, 'building')
    assert normalized['stance'] == 'keep'
    assert normalized['exposed'] is False and normalized['ruptured'] is False
    assert normalized['exit_promise'] == 'keep'


def test_console_does_not_edit_resident_relationship_or_promises():
    from interaction import normalize_interaction
    decision = {"mode": "chat", "confidence": .9, "stance": "confronted", "exposed": True, "ruptured": True, "evidence": ["e1"], "exit_promise": "withdraw", "remember": ["住户要离开"]}
    normalized = normalize_interaction(decision, context(), 'console')
    assert normalized['stance'] == 'keep'
    assert not normalized['exposed'] and not normalized['ruptured']
    assert normalized['exit_promise'] == 'keep'
    assert normalized['remember'] == []


def test_agent_injects_contextual_persona_and_returns_additive_decision(monkeypatch, tmp_path):
    fake = AsyncMock(return_value={"say": "", "tools": [], "mood": "anxious", "emotion": "从容温柔，礼貌地等待", "interaction": {"mode": "wait", "confidence": .8, "evidence": ["e1"], "exit_promise": "pause"}})
    monkeypatch.setattr(game, 'API_KEY', 'test-only-secret')
    monkeypatch.setattr(game, 'LOG', tmp_path / 'calls.jsonl')
    monkeypatch.setattr(game, 'llm', fake)
    response = request('/api/agent', {"state": context(), "session": "context-test"})
    assert response.status_code == 200
    assert response.json()['say'] == ''
    assert response.json()['interaction']['mode'] == 'wait'
    assert response.json()['emotion'] == '从容温柔，礼貌地等待'
    prompt = fake.call_args.args[0][0]['content']
    assert '【互动与关系】' in prompt and 'guidance_allowed=false' in prompt
    assert '只有fake_door事件确认' not in prompt
    assert '不需要主人先说取消导航' in prompt
    assert '已经摊牌的事实不会因恢复照护而消失' in prompt
    assert '每次只指引下一步' not in prompt


def test_console_say_is_not_broadcast(monkeypatch, tmp_path):
    fake = AsyncMock(return_value={"say": "主人别跑", "reply": "检修授权已确认", "tools": []})
    monkeypatch.setattr(game, 'API_KEY', 'test-only-secret')
    monkeypatch.setattr(game, 'LOG', tmp_path / 'calls.jsonl')
    monkeypatch.setattr(game, 'llm', fake)
    response = request('/api/agent', {"state": context(), "channel": "console"})
    assert response.json()['say'] == ''
    assert response.json()['reply'] == '检修授权已确认'


def test_current_sight_loss_overrides_old_sofa_history_in_prompt():
    from interaction import interaction_context
    prompt = interaction_context({'player': {'visible': False, 'last_seen': {'room': '209'}}, 'interaction': {'mode': 'search', 'activity': {'kind': 'unknown'}}})
    assert '【这一轮的感知事实】' in prompt
    assert '本轮选择search' in prompt
    assert '不得断言主人仍躺着' in prompt


def test_waiting_is_a_grounded_durable_request_and_darkness_does_not_cancel_it():
    from interaction import normalize_interaction, interaction_context
    state = context(wait_request={'active': True})
    state['player'] = {'visible': False}
    prompt = interaction_context(state)
    assert 'wait_request' in prompt and '关灯' in prompt
    assert '本轮选择search' not in prompt
    decision = {'mode':'wait','wait_request':'begin','confidence':.9,'evidence':['e1']}
    assert normalize_interaction(decision, context())['wait_request'] == 'begin'
    assert normalize_interaction(decision, context(), 'console')['wait_request'] == 'keep'
    decision['evidence']=['invented']
    assert normalize_interaction(decision, context())['wait_request'] == 'keep'


def test_health_identifies_the_current_interaction_protocol():
    import asyncio
    assert asyncio.run(game.health())['interaction_protocol'] == 2


def test_jing_addresses_objections_without_a_body_or_turning_every_answer_into_a_route():
    from interaction import interaction_context
    prompt=interaction_context(context())
    assert '没有可供主人定位的身体' in prompt
    assert '具体异议' in prompt
    assert '临时查询' in prompt
