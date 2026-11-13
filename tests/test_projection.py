from test_narrative import setup_llm, request


def test_projection_tools_and_grounded_body_rules_reach_the_live_model(monkeypatch,tmp_path):
    fake=setup_llm(monkeypatch,tmp_path,{'say':'我会在墙上显示影像。','tools':[{'name':'project_self','args':{'room':'110','expression':'warm-smile'}},{'name':'hide_projection','args':{}}]})
    response=request('/api/agent',{'session':'projection-contract','state':{'projection':{'available':True,'active':None}}})
    assert [t['name'] for t in response.json()['tools']]==['project_self','hide_projection']
    prompt=fake.call_args.args[0][0]['content']
    assert 'list_projection_walls' in prompt and 'state.projection.active' in prompt
