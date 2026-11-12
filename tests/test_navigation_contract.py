from unittest.mock import AsyncMock
from test_narrative import request
import app as game


def test_path_query_is_allowed_and_structured_results_reach_the_model(monkeypatch, tmp_path):
    monkeypatch.setattr(game, 'API_KEY', 'test-only-key')
    monkeypatch.setattr(game, 'LOG', tmp_path / 'calls.jsonl')
    model = AsyncMock(return_value={'say': '', 'tools': [{'name': 'find_path', 'args': {'room': '108'}}]})
    monkeypatch.setattr(game, 'llm', model)
    result = request('/api/agent', {'session': 'navigation', 'results': [{'ok': True, 'label': 'find_path', 'msg': 'route', 'navigation': {'status': 'ok', 'next_step': {'direction': '北', 'instruction': '先向北走'}}}]})
    assert result.status_code == 200
    assert result.json()['tools'][0]['name'] == 'find_path'
    prompt = model.call_args.args[0][-1]['content']
    assert '先向北走' in prompt and 'next_step' in prompt
    assert '方位必须依据程序提供' in model.call_args.args[0][0]['content']
