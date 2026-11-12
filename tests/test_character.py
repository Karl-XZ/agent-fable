import json
from unittest.mock import AsyncMock

import app as game
from test_narrative import request


def test_injury_performance_prioritizes_care_without_inventing_recovery_from_movement():
    from character import scene_note, DEFAULT_CARD
    note=scene_note({'player':{'visible':True,'injured':False},'interaction':{'care_needed':True}})
    assert '受伤' in note and '走动' in note and '嘲讽' in note
    assert '温柔' in DEFAULT_CARD['fields']['personality']
    assert '带一点自负' not in DEFAULT_CARD['fields']['personality']


def test_default_card_is_complete_and_overrides_cannot_change_identity_or_other_requests():
    from character import DEFAULT_CARD, normalize_card
    assert set(DEFAULT_CARD['fields']) == {'personality','motivation','preferences','speech_style','relationship','examples'}
    card = normalize_card({'fields': {'personality': '谨慎，有一点幽默', 'speech_style': '短句', 'name': '别人', 'unknown': '秘密'}})
    assert card['name'] == '静' and card['fields']['personality'] == '谨慎，有一点幽默'
    assert 'unknown' not in card['fields']
    assert normalize_card(None) == DEFAULT_CARD
    assert normalize_card(None)['fields']['personality'] != '谨慎，有一点幽默'


def test_card_fields_are_bounded_and_bad_shapes_use_defaults():
    from character import DEFAULT_CARD, normalize_card, FIELD_LIMITS
    for value in [None, [], 'bad', {'fields': []}]:
        assert normalize_card(value) == DEFAULT_CARD
    value=normalize_card({'fields': {key:'x'*20000 for key in FIELD_LIMITS}})
    assert all(len(value['fields'][key])==limit for key,limit in FIELD_LIMITS.items())


def test_card_examples_are_not_memories_and_scene_note_respects_wait_and_disclosure():
    from character import character_context, normalize_card, scene_note
    text=character_context(normalize_card(None))
    assert '风格示例' in text and '并未发生' in text
    note=scene_note({'interaction':{'wait_request':{'active':True},'needs_response':False,'mode':'wait'}})
    assert '安静' in note and '说话' in note
    assert '失忆门' not in note


def test_actual_dialogue_has_real_roles_and_terminal_is_distinct(monkeypatch,tmp_path):
    fake=AsyncMock(return_value={'say':'嗯，我听着。','tools':[]})
    monkeypatch.setattr(game,'API_KEY','test-only');monkeypatch.setattr(game,'LOG',tmp_path/'calls.jsonl');monkeypatch.setattr(game,'llm',fake)
    response=request('/api/agent',{'history':[{'role':'player','text':'我想先看看。'},{'role':'ai','text':'好，您慢慢看。'},{'role':'console','text':'检修模式'},{'role':'console_ai','text':'维护响应'}], 'state':{'player':{'visible':True},'interaction':{'mode':'chat'}}})
    assert response.status_code==200
    messages=fake.call_args.args[0]
    assert any(m['role']=='user' and m['content']=='我想先看看。' for m in messages)
    assert any(m['role']=='assistant' and json.loads(m['content']).get('say')=='好，您慢慢看。' for m in messages if m['role']=='assistant')
    assert any('维护终端' in m['content'] for m in messages)
    assert '【最近对话】' not in messages[-1]['content']
    assert '【本轮表演提示】' in messages[-1]['content']


def test_custom_card_reaches_only_this_inference_and_never_the_log_even_if_echoed(monkeypatch,tmp_path):
    private='BROWSER-ONLY-PRIVATE-CARD-49271'
    fake=AsyncMock(return_value={'say':private,'thought':private,'tools':[{'name':'print','args':{'text':private}}]})
    logfile=tmp_path/'calls.jsonl'
    monkeypatch.setattr(game,'API_KEY','test-only');monkeypatch.setattr(game,'LOG',logfile);monkeypatch.setattr(game,'llm',fake)
    body={'session':'personal-card','character_card':{'schema_version':1,'fields':{'speech_style':private}},'state':{'player':{'visible':True},'interaction':{'mode':'chat','memories':[{'text':private}]}}}
    assert request('/api/agent',body).status_code==200
    assert any(private in m['content'] for m in fake.call_args.args[0])
    assert private not in logfile.read_text(encoding='utf-8')
    log=json.loads(logfile.read_text(encoding='utf-8'))
    assert log['content_omitted'] is True and log['character_source']=='browser'
    request('/api/agent',{'session':'personal-card','private_character_session':True,'state':{'interaction':{'memories':[{'text':private}]}}})
    assert private not in logfile.read_text(encoding='utf-8')
    fake.return_value={'say':'普通回复','tools':[]}
    request('/api/agent',{'session':'other-player','state':{'player':{'visible':True}}})
    assert not any(private in m['content'] for m in fake.call_args.args[0])


def test_health_supports_character_card_protocol():
    import asyncio
    assert asyncio.run(game.health())['character_card_protocol']==1
