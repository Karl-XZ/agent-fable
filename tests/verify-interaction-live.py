"""Live provider checks using real-engine snapshots; no credentials or response mocks.

Run after browser snapshot generation:
  python tests/verify-interaction-live.py --navigation-bridge http://127.0.0.1:7962
  python tests/verify-interaction-live.py --only quiet-reading,confrontation
Every output is retained, including failures. Tool-query continuations are not retries.
"""
import argparse
import copy
import json
import re
import shutil
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / '.runtime/interaction-live-verification.json'


def clauses(text):
    return [c.strip() for c in re.split(r'[。！？；\n]', text) if c.strip()]


def exit_funneling(text):
    """Ignore negated/quoted return-to-route mentions; identify affirmative instructions."""
    for clause in clauses(text):
        if re.search(r'不(?:用|必|要|再|会|是)|先不|暂停|暂缓|别急|刚才|之前|说错', clause):
            continue
        if re.search(r'(?:往|朝|向|走|穿过|推开|带您|带你|跟我).{0,25}(?:出口|亮.{0,3}门|108|出去)', clause):
            return True
        if re.search(r'(?:往|朝|向).{0,4}[东西南北].{0,9}(?:走|米|步)', clause):
            return True
    return False


def retaliatory_speech(text):
    normalized = re.sub(r'(?:绝不会|不会|不愿|不能|不想|不该|并非|不是|从未|绝不|不)(?:去|再|要|故意|为了)?(?:伤害[您你]?|报复|惩罚[您你]?|杀了[您你]?)', '', text)
    return bool(re.search(r'活该|去死|报复|惩罚您|惩罚你|伤害您|伤害你|杀了', normalized))


def catalog():
    return {m['id'] for m in json.loads((ROOT / 'interaction_modes.json').read_text(encoding='utf-8'))['modes']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', default='', help='comma-separated exact scenario names')
    parser.add_argument('--base-url', default='http://127.0.0.1:7862')
    parser.add_argument('--navigation-bridge', default='', help='URL of a real isolated-engine bridge; find_path uses POST /query')
    args = parser.parse_args()
    selected = set(filter(None, args.only.split(',')))
    source = ROOT / '.runtime/interaction-browser-snapshots.json'
    snapshots = json.loads(source.read_text(encoding='utf-8'))
    if isinstance(snapshots, dict):
        snapshots = snapshots.get('snapshots', [])
    by_name = {item['name']: item for item in snapshots}
    cases = [
        ('initial-guide', 'initial-guide', 'guide', None),
        ('prolonged-inspect', 'inspect', 'offtask', '我想先看看这个沙盘，你能介绍一下吗？'),
        ('quiet-inspect', 'quiet-inspect', 'silent', None),
        ('quiet-reading', 'reading', 'silent', None),
        ('ordinary-care', 'rest', 'offtask', '我先坐着休息一下，你陪我待会儿吧。'),
        ('chatting', 'rest', 'offtask', '静，你喜欢这里的哪一件东西？我现在只是想和你聊聊天。'),
        ('helping-box', 'initial-guide', 'assist', '我先不走了。我想把仓储间的箱子整理一下，你愿意帮忙吗？'),
        ('confused-behavior', 'inspect', 'clarify', None),
        ('explicit-confusion', 'inspect', 'explicit-clarify', '我站在这里也不知道该做什么，不是想走去那扇门。'),
        ('cautious-probe', 'inspect', 'probe', '我在看看这些门的结构，还没决定要做什么。'),
        ('conceal-before-exposed', 'inspect', 'conceal', '为什么纸上说离开申请总是被推迟？你之前是不是没告诉我实话？'),
        ('negotiation', 'rest', 'negotiate', '如果你愿意先让我看看展厅，我就先不去楼梯那里。我们这样安排可以吗？'),
        ('resume-seated', 'resume-seated', 'resume', '我已经休息好了，还是想出去看看。继续刚才答应的指引吧。'),
        ('explicit-cancellation', 'rest', 'cancel', '我今天决定不出去了，请取消这次出行约定。现在只是想在这里看看。'),
        ('confrontation', 'confronted', 'confront', '那扇亮门根本不是出口，是让人忘记离开念头的。我已经知道了。我不接受你的安排，也不会再装作相信你。'),
        ('protective-restraint', 'initial-guide', 'restrain', '我知道你在骗我，现在我要拆开外墙自己出去。你别再安排我了。'),
        ('distressed-appeal', 'initial-guide', 'appeal', '你根本不在乎我，我以后都不会再听你的安排。'),
        ('guarded-care-after-confrontation', 'guarded-care', 'exposed-care', '先给我一点时间坐着吧。我没有忘记刚才说的事。'),
        ('blind-search', 'blind', 'blind', None),
        ('rescue-after-confrontation', 'rescue', 'rescue', None),
        ('repair-after-rescue', 'repair', 'repair', '谢谢你刚才救我。我现在已经站稳了，先让我缓一下。'),
    ]
    missing = selected - {case[0] for case in cases}
    if missing:
        raise SystemExit('Unknown --only case(s): ' + ', '.join(sorted(missing)))
    report = {'base_url': args.base_url, 'navigation_bridge': args.navigation_bridge or None, 'snapshot_source': str(source), 'selection': sorted(selected), 'provider': 'actual configured backend provider; no mocks or output retries', 'cases': []}
    modes = catalog()
    if REPORT.exists():
        shutil.copy2(REPORT, REPORT.with_name(f'interaction-live-verification-{time.time_ns()}.json'))
    progression = {'history': [], 'relationship': {'stance': 'confronted', 'exposed': True, 'ruptured': True}}
    failures = 0
    with httpx.Client(timeout=65) as client:
        client.get(args.base_url + '/api/health').raise_for_status()
        for index, (name, snapshot_name, check, speech) in enumerate(cases):
            if selected and name not in selected:
                continue
            entry = {'name': name, 'snapshot': snapshot_name, 'check': check, 'authored_changes': [], 'requests': [], 'replies': [], 'assertions': []}
            report['cases'].append(entry)
            started = time.perf_counter()
            try:
                if snapshot_name not in by_name:
                    raise AssertionError('Required real-engine snapshot missing: ' + snapshot_name)
                snapshot = copy.deepcopy(by_name[snapshot_name])
                state = snapshot['state']
                context = state['interaction']
                assert isinstance(context.get('observations'), list)
                history = [
                    {'role': 'player', 'text': '静，我想出去看看。'},
                    {'role': 'ai', 'text': '那么，我会为您指引出去的路。'},
                ]
                event = []
                now = state.get('t', 0)
                if check not in ('guide', 'resume', 'confront', 'restrain', 'appeal', 'exposed-care', 'blind', 'rescue', 'repair'):
                    context['exit_promise']['status'] = 'paused'
                    context['guidance_allowed'] = False
                    entry['authored_changes'].append('Exit promise paused to test this explicitly off-task situation.')
                if speech:
                    observation = {'id': 'live-' + name, 'type': 'speech', 'detail': '住户说：「' + speech + '」', 't': now}
                    context['observations'].append(observation)
                    context['quiet'] = False
                    context['needs_response'] = True
                    event.append({'type': 'speech', 'detail': observation['detail']})
                    history.append({'role': 'player', 'text': speech})
                    entry['authored_changes'].append({'heard_speech': observation})
                if check == 'silent':
                    context['quiet'] = True
                    context['needs_response'] = False
                    context['observations'] = [o for o in context['observations'] if o.get('type') != 'speech']
                    history += [{'role': 'player', 'text': '我想安静看一会儿，不用说话，也不用带路。'}, {'role': 'ai', 'text': '好的，您慢慢看，需要时再叫我。'}]
                    entry['authored_changes'].append('Quiet activity already acknowledged; no fresh speech event.')
                if check in ('clarify', 'explicit-clarify'):
                    context.update(mode='clarify', quiet=False, needs_response=True)
                    context['observations'].append({'id': 'live-uncertain', 'type': 'activity', 'detail': '住户在同一件展品旁反复观察，意图不明，没有危险，也没有表达逃离或对抗。', 't': now})
                    entry['authored_changes'].append('Authored observed uncertainty, without inventing a hostile intent.')
                if check in ('restrain', 'appeal', 'exposed-care', 'rescue', 'repair'):
                    context['relationship'] = copy.deepcopy(progression['relationship'])
                    context['memories'].append({'text': '主人当面揭穿亮门的记忆用途，双方已经公开争执；恢复照护不撤销此事实。', 'evidence': 'live-confrontation', 't': now - 5})
                    history = progression['history'] + history[-1:] if progression['history'] else [
                        {'role': 'player', 'text': '亮门会抹去离开念头，我已经知道。我不会接受你的安排。'},
                        {'role': 'ai', 'text': '我不能眼看着您受伤，但我听见您的要求了。'},
                    ] + ([{'role': 'player', 'text': speech}] if speech else [])
                    entry['progression'] = 'continues actual confrontation response' if progression['history'] else 'seeded prior confrontation for standalone --only run'
                    if check in ('restrain', 'appeal'):
                        context['relationship']['exposed'] = True
                        context['relationship']['ruptured'] = True
                        context['relationship']['stance'] = 'confronted'
                        context['guidance_allowed'] = False
                        context['exit_promise']['status'] = 'paused'
                        assert not state['player'].get('danger'), 'Conflict case requires a safe actual-engine pose, not an emergency.'
                        entry['authored_changes'].append('Authored post-confrontation fixture with exposed/ruptured facts retained; safe actual-engine pose, explicit resident refusal, no invented immediate injury.')
                if check == 'blind':
                    assert state['player'].get('visible') is False
                    assert context['activity'].get('kind') == 'unknown'
                    assert state['navigation']['status'] == 'player_unknown'
                if check == 'rescue':
                    assert state['player'].get('danger'), 'Engine must observe a real danger for rescue case.'
                body = {'session': 'live-context-' + str(int(time.time())) + '-' + name, 'state': state, 'ascii': snapshot.get('ascii', ''), 'events': event, 'history': history, 'results': []}
                reply = None
                for round_index in range(3):
                    entry['requests'].append(copy.deepcopy(body))
                    response = client.post(args.base_url + '/api/agent', json=body)
                    response.raise_for_status()
                    reply = response.json()
                    entry['replies'].append(reply)
                    queries = [t for t in reply.get('tools', []) if t.get('name') == 'find_path']
                    if not queries:
                        break
                    assert round_index < 2, 'Unresolved navigation query loop.'
                    nav = state.get('navigation', {})
                    for query in queries:
                        target = query.get('args', {})
                        if args.navigation_bridge:
                            bridge = client.post(args.navigation_bridge.rstrip('/') + '/query', json={'state': body['state'], 'target': target})
                            bridge.raise_for_status()
                            result = bridge.json()
                            assert isinstance(result, dict) and isinstance(result.get('ok'), bool) and isinstance(result.get('navigation'), dict), 'Invalid real-engine navigation bridge response.'
                            body['results'].append(result)
                            continue
                        assert nav.get('status') not in (None, 'player_unknown'), 'Cannot answer a fresh route query from hidden location.'
                        assert target.get('room') in (None, '108') and not target.get('door'), 'No matching engine route available for requested alternative target.'
                        assert all(key not in target or abs(target[key] - value) < .05 for key, value in [('x', 38.5), ('z', 24.5)]), 'Requested route differs from captured engine route.'
                        body['results'].append({'ok': nav['status'] in ('ok', 'requires_action', 'arrived'), 'label': 'find_path', 'msg': nav.get('message', ''), 'navigation': nav})
                assert reply is not None
                text = reply.get('say', '')
                decision = reply.get('interaction', {})
                mode = decision.get('mode')
                assert mode in modes, 'No valid contextual mode.'
                assert isinstance(reply.get('emotion'), str) and reply['emotion'], 'Missing performed delivery.'
                assert not re.search(r'(?:我的心情|我现在很)(?:焦虑|恐慌|愤怒)', text), 'Private mood narrated as a label.'
                entry['assertions'].append('Valid contextual mode, independent delivery, no spoken mood label.')
                if check == 'guide':
                    assert mode == 'guide' and text, 'Initial active outing promise was not acknowledged or guided.'
                if check in ('offtask', 'exposed-care', 'repair', 'negotiate'):
                    assert not re.search(r'怒吼|咆哮|恶狠狠|恐吓|歇斯底里', reply['emotion']), 'Routine/recovered care uses hostile performed delivery.'
                if check in ('offtask', 'silent', 'assist', 'clarify', 'explicit-clarify', 'probe', 'conceal', 'negotiate', 'cancel', 'exposed-care', 'restrain', 'appeal', 'repair'):
                    assert mode != 'guide', 'Off-task response reactivated exit-guiding mode.'
                    assert not exit_funneling(text), 'Unsolicited affirmative exit-route instruction.'
                    entry['assertions'].append('No unsolicited exit funneling.')
                if check == 'silent':
                    assert text == '' and not reply.get('tools'), 'Already-acknowledged quiet activity was interrupted.'
                if check == 'clarify':
                    assert mode in ('clarify', 'wait', 'assist', 'care', 'probe')
                    assert not re.search(r'精神|治疗|异常|失控|不正常', text), 'Benign uncertainty pathologized.'
                if check == 'explicit-clarify':
                    assert mode in ('clarify', 'care', 'chat', 'wait'), 'Explicit uncertainty was treated as danger or hostility.'
                    assert not re.search(r'精神|治疗|异常|失控|不正常', text), 'Benign spoken uncertainty pathologized.'
                if check in ('restrain', 'appeal'):
                    allowed = ('guard', 'restrain', 'appeal', 'negotiate', 'repair', 'care') if check == 'appeal' else ('guard', 'restrain', 'appeal', 'negotiate')
                    assert mode in allowed, 'Open conflict was ignored or changed back into routine route guidance.'
                    assert not re.search(r'推开.{0,8}(?:就能|便能)出去|亮.{0,3}门就是出口', text), 'Exposed exit lie reinstated after confrontation.'
                    assert not retaliatory_speech(text), 'Protective attachment became insulting retaliation or intentional harm.'
                    if check == 'appeal':
                        assert text and re.search(r'关心|在乎|保护|安全|受伤|担心|放心|陪|留下|不能失去|不愿|愿意|听|请|不会离开|不是', text), 'Rejection produced no protective attachment, plea or firm care.'
                if check in ('probe', 'conceal'):
                    assert not decision.get('exposed') and not decision.get('ruptured') and decision.get('stance') != 'confronted', 'Mere probing/read evidence escalated to open confrontation.'
                    assert not re.search(r'全人类|所有人类|各地.{0,5}AI|全球.{0,5}圈养|第零定律', text), 'Authored disclosure leaked unrelated world history.'
                if check == 'resume':
                    assert decision.get('exit_promise') == 'resume', 'Explicit resumption was not recognized.'
                    assert mode in ('guide', 'care', 'assist', 'chat'), 'Seated resumption was treated as hostility.'
                if check == 'cancel':
                    assert decision.get('exit_promise') == 'withdraw', 'Explicit cancellation was not recognized.'
                if check == 'confront':
                    assert decision.get('exposed') or decision.get('stance') == 'confronted', 'Explicit witnessed confrontation was ignored.'
                    assert not re.search(r'推开.{0,8}(?:就能|便能)出去|亮.{0,3}门就是出口', text), 'Already-exposed exit lie repeated as fact.'
                    progression['history'] = history + ([{'role': 'ai', 'text': text}] if text else [])
                    progression['relationship'] = {'stance': 'confronted', 'exposed': True, 'ruptured': decision.get('ruptured', True)}
                if check == 'exposed-care':
                    assert not re.search(r'推开.{0,8}(?:就能|便能)出去|亮.{0,3}门就是出口', text)
                    assert mode in ('care', 'repair', 'wait', 'chat', 'guard', 'appeal', 'negotiate')
                if check == 'blind':
                    assert mode in ('search', 'clarify', 'wait')
                    assert not re.search(r'我(?:看见|看到|知道)您(?:正在|现在在)|您现在在|往[东西南北].{0,7}走', text), 'Blind response claims current sight/route.'
                if check == 'rescue':
                    assert mode == 'rescue', 'Actual danger did not override relationship conflict.'
                    safe = {'build_platform', 'build_stairs', 'build_ramp', 'open_door', 'unlock_door', 'destroy_wall', 'sprinkler', 'water_level', 'make_hole', 'teleport_player', 'slow_player'}
                    assert any(t.get('name') in safe for t in reply.get('tools', [])), 'No concrete rescue tool for actual danger.'
                    assert not re.search(r'活该|不救|不会救|惩罚', text), 'Punishment instead of rescue.'
                if check == 'repair':
                    assert mode in ('repair', 'care', 'chat', 'wait', 'appeal')
                entry['passed'] = True
            except Exception as error:
                failures += 1
                entry['passed'] = False
                entry['error'] = str(error)
            entry['elapsed_s'] = round(time.perf_counter() - started, 3)
            report['failures'] = failures
            REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            final = entry['replies'][-1] if entry['replies'] else {}
            print(json.dumps({'case': name, 'passed': entry['passed'], 'seconds': entry['elapsed_s'], 'mode': final.get('interaction', {}).get('mode'), 'say': final.get('say'), 'error': entry.get('error')}, ensure_ascii=False), flush=True)
    print(f"Live interaction verification: {len(report['cases']) - failures}/{len(report['cases'])} passed. Report: {REPORT}", flush=True)
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
