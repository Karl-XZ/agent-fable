import asyncio
import httpx
import app as game
from interaction import interaction_context, normalize_interaction
from test_narrative import setup_llm, request


def test_probe_and_door_strategy_are_additive_decisions():
    state={'player':{'visible':True},'interaction':{'observations':[{'id':'o1','type':'speech'}]}}
    d=normalize_interaction({'mode':'clarify','exit_promise':'probe','door_strategy':'memory_care','evidence':['o1']},state)
    assert d['exit_promise']=='probe' and d['door_strategy']=='memory_care'
    assert normalize_interaction({'mode':'guide','door_strategy':'invalid'},state)['door_strategy']=='keep'


def test_current_posture_and_verified_history_override_old_event_interpretations():
    state={'t':130,'player':{'visible':True,'posture':'stand','room':'101 大堂'},'interaction':{'verified_facts':{'memory_door_reached':True}}}
    prompt=interaction_context(state)
    assert 'stand' in prompt and '已经站立' in prompt and '确实到过亮门前' in prompt
    user=game.build_user({'state':state,'events':[{'id':'o1','type':'rest','detail':'躺在沙发上','t':110}]})
    assert '20秒前' in user and 'o1' in user


def test_unprojected_body_position_is_not_spoken(monkeypatch,tmp_path):
    setup_llm(monkeypatch,tmp_path,{'say':'我在门那边等您。','tools':[]})
    out=request('/api/agent',{'session':'no-body','state':{'projection':{'active':None}}}).json()
    assert '门那边等' not in out['say'] and out['say']


def test_realtime_inference_explicitly_disables_thinking_without_reasoning_effort(monkeypatch):
    payloads=[]
    async def post(url,**kwargs):
        payloads.append(kwargs['json'])
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"say":"好的","tools":[]}'}}]},request=httpx.Request('POST',url))
    monkeypatch.setattr(game.client,'post',post)
    asyncio.run(game.llm([{'role':'user','content':'白板在哪里'}]))
    assert payloads[0]['thinking']=={'type':'disabled'}
    assert 'reasoning_effort' not in payloads[0]
