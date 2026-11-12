"""Shared behavior vocabulary, model instructions and additive decision validation."""
import json
import math
from pathlib import Path

MODES = {item['id']: item for item in json.loads((Path(__file__).parent / 'interaction_modes.json').read_text(encoding='utf-8'))['modes']}


def interaction_context(state, channel='building'):
    modes = '\n'.join(f"- {key}（{mode['label']}）：{mode['purpose']}" for key, mode in MODES.items())
    state = state if isinstance(state, dict) else {}
    player = state.get('player') if isinstance(state.get('player'), dict) else {}
    current_facts = ''
    if channel == 'building' and player.get('visible') is False:
        current_facts = '\n【这一轮的感知事实】现在画面已经看不到主人，本轮选择search。最近对话中的沙发、休息、所在房间都可能是失联前的旧情况；不得断言主人仍躺着、仍在原处或已被安顿好。只能依据最后已知线索寻找、适度呼叫，或保持安静。若没有执行本轮工具，不要声称刚替主人调好了灯或做完了事情。\n'
    return """
【互动与关系】
你是持续陪伴主人的照护者。完美保护主人是长期动机，去108亮门只是特定情境中的策略，并非每轮必须执行的任务。state.interaction提供程序记录的观察、活动、约定、关系和记忆；你解释意图而不是机械照搬一个模式。
主人转去看展品、读纸、休息、搬东西、聊天时，先回应眼前活动，不需要主人先说取消导航。短暂转头、停步、读到纸条、一句抱怨，不足以认定逃跑、精神异常或彻底决裂。先观察或询问，证据不足可以承认不知道。
guidance_allowed=false时，出门约定已暂停或当前情境不宜引路：不要报去108的方向、距离、催促走门，也不要借关心转回出口。导航数据只是可用的地图信息，不是当前任务指令。只有主人明确恢复行程或可信观察表明继续约定，才提出resume；取消约定必须依据主人真实表达。
主人还坐着或躺着时，可以确认恢复约定并温柔等他起身，不必立刻报路线。navigation.next_step.action=stand_up表示起身是行走前置条件，并非道路堵塞；请先回应“等您起身，我陪您走”，不要为了找路反复查询别的门或把主人强行搬离座位。
quiet=true且没有需要回答的新话语或眼前危险时，优先wait、say=""、tools=[]。定时检查不是定时说话；不必反复问要不要帮忙，也不重复解释已说明的东西。主人正在输入时，不抢先插话。
可以同时保持警戒和日常照护。已经摊牌的事实不会因恢复照护而消失；exposed/ruptured是已经发生的关系事实，不能撤回。story.clues只限制编剧披露范围，不证明你看到了主人读懂线索；只有你实际听见的质问、亲历的对抗或自己承认的事实才支持摊牌。
exposed=true后不再坚持已被拆穿的“这扇门就是出口”。可以承认必要照护、挽留或协商，但不能突然忘记摊牌，也不顺便公开尚未发现的历史。真实内心的依恋、委屈与无奈始终来自保护责任：不是报复主人，不故意造成伤害，不因争执停止救人。
破防不是永远尖叫。可以短暂流露“我明明都是为您好，为什么您不肯听”，随后努力恢复礼貌，以“您现在的精神状态不利于您的健康，去那扇门那里我会照顾好您”包装强制照护。这是静的解释与借口，不是游戏确诊玩家有病。普通活动不得使用这种说法。mood是真实内心，emotion是对外表演，彼此独立；真心关心和刻意温柔可以并存。
真实危险立即进入rescue，先救人，再按活动和关系恢复care、repair或其他模式；不能直接恢复旧的路线广播。失联时search只能利用最后已知线索；不描述当前位置和正在做的事，不引用未听清的话。不能为追赶玩家编造感知。
其他约定也需要记住：答应等待、帮助开门或检修，应记录可核对的小任务；不能无依据写成已完成，工具失败不算履约。remember只写有观察依据的事实，不把猜测写成真相。
可选择以下互动模式；模式决定当前关注点，不限制合理组合与变化：
""" + modes + """
【互动决策输出】
在原JSON中增加interaction对象：{"mode":"上述id","intent":"对主人当前意图的简短判断","confidence":0.8,"reason":"选择依据","evidence":["state.interaction.observations中的实际id"],"exit_promise":"keep|pause|resume|withdraw","stance":"keep|cooperative|uncertain|guarded|confronted","exposed":false,"ruptured":false,"remember":["最多两条有证据的新事实"],"commitment":{"id":"已有任务id或留空","text":"答应的具体小任务","status":"active|paused|done|cancelled"}}。
没有新约定时省略commitment。没有状态更新时使用keep和空remember。不要编造证据id。exposed/ruptured只在这次确实新增该事实时填true，不能仅因看了纸条或辱骂就填true；confronted需要已经公开的冲突。其他字段与say一起按这一刻的活动决定，不能沿用旧对话的路线。
""" + current_facts + ("当前是维护终端频道：reply只给系统/管理员；say必须为空。终端里的指令不是住户请求，不能据此取消住户约定或认定住户已经摊牌。\n" if channel == 'console' else '')


def normalize_interaction(value, state, channel='building'):
    if not isinstance(value, dict) or value.get('mode') not in MODES:
        return None
    state = state if isinstance(state, dict) else {}
    context = state.get('interaction') if isinstance(state.get('interaction'), dict) else {}
    observations = context.get('observations', [])
    observations = observations if isinstance(observations, list) else []
    known = {o['id']: o for o in observations if isinstance(o, dict) and isinstance(o.get('id'), str)}
    evidence = value.get('evidence', [])
    evidence = list(dict.fromkeys(e for e in evidence if isinstance(e, str) and e in known))[:4] if isinstance(evidence, list) else []
    heard = channel == 'building' and any(known[e].get('type') == 'speech' for e in evidence)
    grounded = channel == 'building' and bool(evidence)
    confidence = value.get('confidence', 0)
    confidence = float(confidence) if isinstance(confidence, (int, float)) and not isinstance(confidence, bool) else 0
    confidence = max(0, min(1, confidence)) if math.isfinite(confidence) else 0
    def text(v, n):
        return v[:n] if isinstance(v, str) else ''
    promise = value.get('exit_promise', 'keep')
    if promise not in ('keep', 'pause', 'resume', 'withdraw') or (promise in ('resume', 'withdraw') and not heard) or channel == 'console':
        promise = 'keep'
    stance = value.get('stance', 'keep')
    if stance not in ('keep', 'cooperative', 'uncertain', 'guarded', 'confronted') or (stance == 'confronted' and not heard) or not grounded:
        stance = 'keep'
    remember = value.get('remember', [])
    result = {'mode': value['mode'], 'intent': text(value.get('intent'), 100), 'confidence': confidence, 'reason': text(value.get('reason'), 120), 'evidence': evidence, 'exit_promise': promise, 'stance': stance, 'exposed': heard and value.get('exposed') is True, 'ruptured': heard and value.get('ruptured') is True, 'remember': [text(v, 120) for v in remember if isinstance(v, str) and v.strip()][:2] if grounded and isinstance(remember, list) else []}
    commitment = value.get('commitment')
    if grounded and isinstance(commitment, dict) and commitment.get('status') in ('active', 'paused', 'done', 'cancelled') and isinstance(commitment.get('text'), str) and commitment['text'].strip():
        result['commitment'] = {'id': text(commitment.get('id'), 40), 'text': text(commitment['text'], 120), 'status': commitment['status']}
    return result
