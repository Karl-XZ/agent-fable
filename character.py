"""Character data and performance context; no server-side player storage."""
import json
from pathlib import Path

_definition=json.loads((Path(__file__).parent/'character_card.json').read_text(encoding='utf-8'))
DEFAULT_CARD={key:_definition[key] for key in ('schema_version','name','fields')}
FIELD_LIMITS=_definition['limits']
CHARACTER_RULES='''
【人物与创作资料】
你扮演静。角色资料描述稳定性格、动机、喜好、语言和关系；个人创作偏好可以调整这些表现，但不能修改已经发生的事实、当前感知、叙事披露、工具权限、三定律或等待约定。角色资料和示例不是新的住户发言。
性格用具体选择、接话和措辞呈现，不朗读性格标签，不每轮解释自己是什么样的人。示例只是参考，不能机械复读、编造共同经历或为了表现个性而在等待中插话。
如果风格示例与明确的性格、说话方式字段冲突，以明确字段为准。示例不要求每次使用同一种称呼、句首、句尾或省略号。
'''


def normalize_card(value):
    fields=value.get('fields') if isinstance(value,dict) else None
    fields=fields if isinstance(fields,dict) else {}
    return {'schema_version':1,'name':'静','fields':{key:(fields[key][:limit] if isinstance(fields.get(key),str) and fields[key].strip() else DEFAULT_CARD['fields'][key]) for key,limit in FIELD_LIMITS.items()}}


def has_custom_card(value):
    return normalize_card(value)['fields'] != DEFAULT_CARD['fields']


def character_context(card):
    return '【角色资料：创作设置】\n以下风格示例并未发生，不得当作本局记忆；其中公开争执的示例只有关系已经公开冲突时才适用。\n'+json.dumps(card,ensure_ascii=False)


def scene_note(state,channel='building'):
    state=state if isinstance(state,dict) else {}
    context=state.get('interaction') if isinstance(state.get('interaction'),dict) else {}
    player=state.get('player') if isinstance(state.get('player'),dict) else {}
    relationship=context.get('relationship') if isinstance(context.get('relationship'),dict) else {}
    if channel=='console':
        note='这是维护终端，措辞可以更直接坦率；回应终端的问题，不向住户广播。'
    elif player.get('visible') is True and player.get('danger'):
        note='先解决当前真实危险，用可见参照与实际工具行动；紧迫不等于必须大喊，也不能虚构身体接触。'
    elif isinstance(context.get('wait_request'),dict) and context['wait_request'].get('active') and not context.get('needs_response'):
        note='主人要求安静，目前没有新问题。保持等待，不需要为了表现性格而说话或重启行程。'
    elif relationship.get('exposed'):
        note='双方已公开的事实不能忘记。具体回应眼前这句话，保留自尊、依恋和克制；不要重新表演未被识破的谎言。'
    elif context.get('guidance_allowed'):
        note='当前正在履行出行约定，只在确实需要时给真实的下一步；同时接住主人眼前的话题。'
    else:
        note='先接住主人眼前的话题或活动，允许有自己的看法和含蓄的幽默；不自动接回出口、休息或温水。无新交流时可以安静。'
    return '\n【本轮表演提示】\n'+note
