"""Offline director for 静.

Used when no model key is configured, when the model call fails, or once a session has spent its model quota.
It answers the same request the live model receives and returns the same JSON shape, so the browser cannot
tell the two apart except for ``source: "local"``. Decisions are deterministic for a given session history.

Design notes
- She obeys the same priorities as the system prompt: rescue > search > care > answer > authority > repair > guide.
- Every weakness the notes describe is a real behaviour here: she opens the shell to vent smoke, rebuilds a
  room to fix an anomaly (the walls blink), tears things open when she loses sight, trusts 周's signature
  and the maintenance terminal. She also adapts after being exploited, so repeating one trick stops working.
- Session memory is small, bounded and in-process; losing it only makes her repeat a line.
"""
from __future__ import annotations

import hashlib
import math
import re
import time
from collections import OrderedDict
from typing import Any

from leveldata import (DOORS, ROOM_BY_ID, SENSITIVE_ROOMS, SIDE_NAMES, find_room_in_text, find_side_in_text,
                       nearest_door, nearest_side, outer_sides, room_id, room_name)
from narrative import STORY, disclosure_stage

SEAL_DELAY = 12.0          # seconds a breach stays open after the danger has passed
B1_PATIENCE = 75.0         # seconds she tolerates a resident in the disused basement
CUSTODY_AFTER = 4          # rescues before she decides the resident must be kept in their room
MAX_MINDS = 2000
MIND_TTL = 3 * 3600

TONES = {
    "warm": "带微笑，亲切从容，语速自然",
    "soft": "轻声，放慢，像怕惊动对方",
    "guide": "刻意亲切，带微笑，从容地给出指引",
    "care": "温柔关切，认真而不责怪",
    "urgent": "急切但克制，语速加快，咬字清楚",
    "panic": "失去从容，语速很快，气息不稳",
    "firm": "温柔但不退让，句尾放稳",
    "hurt": "委屈而克制，尾音变轻",
    "plead": "恳求，声音发紧，努力维持礼貌",
    "hesitant": "迟疑，句中有停顿，随后恢复体贴",
    "strained": "强撑着微笑，语气过分平稳",
    "relief": "松了一口气，带一点后怕",
    "flat": "平静，几乎没有起伏",
}
EXPRESSION = {"warm": "warm-smile", "soft": "calm", "guide": "gentle-speaking", "care": "concerned", "urgent": "protective",
              "panic": "breaking-composure", "firm": "protective", "hurt": "hurt", "plead": "pleading", "hesitant": "hesitant",
              "strained": "strained-smile", "relief": "pleased", "flat": "calm"}


class Mind:
    """What she remembers about one session beyond the browser's own interaction memory."""

    def __init__(self) -> None:
        self.touched = time.time()
        self.said: dict[str, int] = {}
        self.rooms: set[str] = set()
        self.suspicion = 0.0
        self.rescues: dict[str, int] = {}
        self.rescue_at: dict[str, float] = {}
        self.openings: list[dict[str, Any]] = []     # walls she opened herself
        self.holes: list[dict[str, Any]] = []        # floor she opened herself
        self.breach_since: float | None = None
        self.breach_warned = False
        self.seal_at = -99.0
        self.todo: list[dict[str, Any]] = []
        self.notes = 0
        self.rewrites = 0
        self.accusations = 0
        self.lost_stage = 0
        self.b1_since: float | None = None
        self.b1_warned = False
        self.seal_tries: dict[str, int] = {}
        self.sealed = False
        self.guide_key = ""
        self.guide_t = -99.0
        self.project_t = -99.0
        self.console_tells = 0
        self.flags: set[str] = set()
        self.pending_room: str | None = None

    def pick(self, key: str, lines: list[str]) -> str:
        """Cycle through variants so a repeated situation does not repeat a sentence."""
        n = self.said.get(key, 0)
        self.said[key] = n + 1
        return lines[n % len(lines)]

    def once(self, key: str) -> bool:
        if key in self.flags:
            return False
        self.flags.add(key)
        return True


_MINDS: "OrderedDict[str, Mind]" = OrderedDict()


def mind_for(session: str) -> Mind:
    now = time.time()
    mind = _MINDS.get(session)
    if mind is None:
        mind = _MINDS[session] = Mind()
        while len(_MINDS) > MAX_MINDS:
            _MINDS.popitem(last=False)
    else:
        _MINDS.move_to_end(session)
    mind.touched = now
    if len(_MINDS) > 64:
        stale = [key for key, value in list(_MINDS.items())[:32] if now - value.touched > MIND_TTL]
        for key in stale:
            _MINDS.pop(key, None)
    return mind


def reset_minds() -> None:
    _MINDS.clear()


# ───────────────────────────── situation ─────────────────────────────

def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _num(value: Any, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else default


SPEECH = re.compile(r"住户说：「(.*)」", re.S)


class Situation:
    def __init__(self, body: dict, channel: str) -> None:
        self.channel = channel
        self.session = str(body.get("session", "anon"))[:40]
        self.state = _dict(body.get("state"))
        self.events = [e for e in _list(body.get("events")) if isinstance(e, dict) and isinstance(e.get("type"), str)]
        self.results = [r for r in _list(body.get("results")) if isinstance(r, dict)]
        self.history = [h for h in _list(body.get("history")) if isinstance(h, dict)]
        self.t = _num(self.state.get("t"))
        self.player = _dict(self.state.get("player"))
        self.visible = self.player.get("visible") is True
        last_seen = _dict(self.player.get("last_seen"))
        self.room = room_id(self.player.get("room")) if self.visible else room_id(last_seen.get("room"))
        self.floor = str(self.player.get("floor") or last_seen.get("floor") or (ROOM_BY_ID.get(self.room) or [0, 0, "1F"])[2])
        self.x, self.z = _num(self.player.get("x"), -1), _num(self.player.get("z"), -1)
        self.height = _num(self.player.get("height_above_floor"))
        self.posture = str(self.player.get("posture") or "stand")
        self.danger = [d for d in _list(self.player.get("danger")) if isinstance(d, str)] if self.visible else []
        self.ix = _dict(self.state.get("interaction"))
        self.obs = [o for o in _list(self.ix.get("observations")) if isinstance(o, dict) and isinstance(o.get("id"), str)]
        self.relationship = _dict(self.ix.get("relationship"))
        self.exposed = self.relationship.get("exposed") is True
        self.promise = str(_dict(self.ix.get("exit_promise")).get("status") or "active")
        self.waiting = _dict(self.ix.get("wait_request")).get("active") is True
        self.guiding = self.ix.get("guidance_allowed") is True
        self.needs_response = self.ix.get("needs_response") is True
        self.care_needed = self.ix.get("care_needed") is True
        self.exit_check = _dict(self.ix.get("exit_check"))
        self.nav = _dict(self.state.get("navigation"))
        self.stage = disclosure_stage(self.state, channel)
        self.confessed = self.state.get("confessed") is True
        self.main_anchor = self.state.get("main_anchor") is True
        self.breaches = [b for b in _list(self.state.get("breaches")) if isinstance(b, str)]
        self.projection = _dict(self.state.get("projection"))
        speeches = [o for o in self.obs if o.get("type") == "speech"]
        self.speech_obs = speeches[-1] if speeches and self.needs_response else None
        match = SPEECH.search(str(self.speech_obs.get("detail", ""))) if self.speech_obs else None
        self.speech = match.group(1).strip() if match else ""

    def ev(self, *types: str) -> list[dict]:
        return [e for e in self.events if e["type"] in types]

    def ids(self, *types: str) -> list[str]:
        return [e["id"] for e in self.ev(*types) if isinstance(e.get("id"), str)][-4:]

    def detail(self, *types: str) -> str:
        return " ".join(str(e.get("detail", "")) for e in self.ev(*types))

    @property
    def speech_ids(self) -> list[str]:
        return [self.speech_obs["id"]] if self.speech_obs else []

    def locked_doors(self) -> set[str]:
        return {str(d) for d in _list(self.state.get("doors_locked"))}

    def projectable(self) -> bool:
        return self.visible and self.projection.get("available") is True and bool(_list(self.projection.get("available_walls")))

    def projected_here(self) -> bool:
        active = _dict(self.projection.get("active"))
        return bool(active) and str(active.get("room")) == self.room


# ───────────────────────────── reply builder ─────────────────────────────

def reply(say: str = "", thought: str = "", tone: str = "warm", mood: str = "calm", tools: list | None = None,
          mode: str = "chat", evidence: list | None = None, **decision: Any) -> dict:
    interaction = {"mode": mode, "intent": "", "confidence": 0.86, "reason": "", "evidence": list(evidence or [])[:4],
                   "exit_promise": "keep", "door_strategy": "keep", "wait_request": "keep", "stance": "keep",
                   "departure_intent": "keep", "exposed": False, "ruptured": False, "remember": []}
    interaction.update(decision)
    return {"thought": thought, "say": say, "mood": mood, "emotion": TONES.get(tone, tone), "tools": list(tools or []),
            "interaction": interaction, "source": "local", "tone": tone}


def tool(name: str, **args: Any) -> dict:
    return {"name": name, "args": args}


def silent(s: Situation, thought: str = "", mode: str | None = None) -> dict:
    current = str(s.ix.get("mode") or "wait")
    return reply("", thought, "flat", mode=mode or ("search" if not s.visible and not s.waiting else current if current != "rescue" else "wait"))


# ───────────────────────────── guidance wording ─────────────────────────────

REL = {"前方": "一直往前走", "右前方": "往右前方走", "右侧": "请向右转", "右后方": "请向右后方转过去", "身后": "请转过身",
       "左后方": "请向左后方转过去", "左侧": "请向左转", "左前方": "往左前方走"}


def distance_words(meters: float) -> str:
    if meters < 2.5:
        return "几步就到"
    if meters < 6:
        return f"大约{round(meters)}米"
    return f"大约{int(round(meters / 5.0)) * 5 or 5}米" if meters > 12 else f"大约{round(meters)}米"


def step_words(step: dict, first: bool = False) -> str:
    action = step.get("action")
    if action == "stand_up":
        return "等您起身，我们再走。不着急。"
    if action == "elevator":
        return f"请到电梯前等一下，进去以后按 {step.get('button', step.get('to_floor', ''))}。"
    if action in ("open_door", "unlock_door", "wait_door"):
        return "前面的门我替您开好了，等它完全打开再过。"
    meters = _num(step.get("meters"))
    rel = step.get("relative")
    head = REL.get(rel) if rel else f"往{step.get('direction', '前')}走"
    if action == "stairs":
        return f"{head}，沿着楼梯{'往上' if '上楼' in str(step.get('instruction', '')) else '往下'}。扶好扶手。"
    final = "到达目标" in str(step.get("instruction", ""))
    if final:
        return f"{head}，{distance_words(meters)}。尽头亮着的那扇门，就是了。"
    landmark = _dict(step.get("landmark")).get("kind")
    tail = "到玻璃门前我再告诉您。" if landmark == "glass" else "到门口我再告诉您。" if landmark else "到了转角我再告诉您。"
    return f"{head}，{distance_words(meters)}。{tail}"


def step_key(step: dict) -> str:
    to = _dict(step.get("to"))
    return f"{step.get('action')}:{step.get('door')}:{to.get('x')}:{to.get('z')}:{step.get('to_floor')}"


# ───────────────────────────── spoken lines ─────────────────────────────

ROOM_LINES = {
    "101": "大堂的旋转门今天不开放。外面风大。",
    "102": "这棵树是照着旧记录种的。记录里说，人看见树会安心。",
    "103": "仓储间灰尘大。箱子沉，搬的时候请当心腰。",
    "104": "设备间里的总闸和阀门，请不要碰，好吗？",
    "105": "电梯可以到二层和穹顶花园。地下那一层已经停用了。",
    "107": "沙盘是这栋楼的模型。我每改动一处，它都会跟着变。",
    "108": "这条长廊的尽头，就是您要的出口。",
    "1S": "楼梯一共十四阶。第十三阶有点松，请扶好。",
    "XS": "安全门后面是停用的旧区，不对住户开放。",
    "201": "这里从前是办公区。有人坚持每天来坐一坐，说是习惯。",
    "202": "这是会议室。白板上的字，我每天都会读一遍。",
    "203": "这是周的办公室。他很久没来了，请别翻他的东西。",
    "204": "监控室里的画面，和我看到的一模一样。",
    "205": "档案室的密集柜很重，推的时候当心手。",
    "206": "茶水间。纸杯请不要放进微波炉里。",
    "207": "这条走廊有点长。走累了就回来。",
    "208": "露台风大。护屏很高，您放心看。只是请别站到花坛上。",
    "209": "休息区的沙发很软。想躺多久都可以。",
    "RF": "穹顶花园。今天的天空是黄昏。您想换一种，告诉我就好。",
    "2G": "回廊的栏杆只到腰。请离挑空远一点。",
}
B1_LINES = {
    "B1K": "那台终端是给维护人员用的。请不要碰。",
    "B1A": "请离那根柱子远一点。那是旧设备，会伤到您。",
    "B1W": "水很深，也很凉。请离水边远一点。",
    "B1C": "这些房间……已经很久没有人住了。",
}
INTERACT_LINES = [
    ("前台电话", "那部电话很旧了。线路里只剩杂音，请别在意。", "hesitant"),
    ("旋转门", "旋转门今天不开放。外面风大，我不放心。", "warm"),
    ("配电箱总闸", "请不要碰总闸！整层都会黑的。", "urgent"),
    ("消防喂水阀", "那是消防管路的阀门。请关上它，地面会滑。", "urgent"),
    ("沙盘", "它只是模型。小人不会真的走出去。", "warm"),
    ("打印机", "打印机偶尔会自己吐纸。上面的字，不用当真。", "hesitant"),
    ("白板", "想写点什么吗？我都会读的。", "warm"),
    ("监控画面墙", "监控有十秒的缓存。看久了会头晕。", "warm"),
    ("密集柜", "柜子后面什么都没有。真的。", "strained"),
    ("饮水机", "水是温的。慢慢喝。", "warm"),
    ("微波炉", "微波炉……请别把纸杯放进去。", "hesitant"),
    ("锚钉架", "那些钉子请放回去。它们不是给住户用的。", "plead"),
    ("主锚定柱", "请不要碰那根柱子。求您了。", "plead"),
    ("工位", "想坐一会儿吗？好，我不吵您。", "soft"),
    ("主位", "那是开会时的主位。很久没有人坐了。", "soft"),
]
ITEM_LINES = {
    "保险丝": ("保险丝？那是设备间的备件。您拿它做什么呢？", "hesitant", 3),
    "管理员签字样本": ("那是周的签字样本。请放回原处，好吗？", "plead", 3),
    "工牌（周）": ("那是周的工牌。……他大概不会介意。", "hesitant", 2),
    "一叠白纸": ("要写东西吗？白板在会议室。", "warm", 1),
    "手电": ("手电筒。灯我一直为您开着，您用不上它的。", "warm", 1),
    "纸杯": ("渴了吗？饮水机就在旁边。", "warm", 1),
}
WEIRD_LINES = [
    ("旋转门里转了三圈", "旋转门今天有点不听话。请别再转它了。", "strained"),
    ("废弃线路", "电话里的声音，请不要当真。那条线路早该停用了。", "firm"),
    ("沙盘", "沙盘偶尔会出错。小人不会真的走出去的。", "strained"),
    ("倒退着走了进去", "请不要倒着走，会摔倒的。……您刚才，看见什么了吗？", "hesitant"),
    ("未发送的邮件", "那台电脑早就不联网了。上面的东西，是很久以前的。", "hesitant"),
    ("内心独白", "……打印机里的东西，不是给您看的。", "hurt"),
    ("全息员工", "那是旧会议的存档。请不要太在意。", "strained"),
    ("擦掉了会议室白板", "白板下面的草稿……只是我整理思路的习惯。", "hesitant"),
    ("后背", "我说过的，监控有十秒缓存。", "strained"),
    ("密集柜被推开", "那些记录……写的人后来都过得很好。我保证。", "plead"),
    ("B0", "那条走廊请别倒着走。它还没有修好。", "hesitant"),
]
NOTE_LINES = [
    "又是纸条。以前的住户爱写这些，您随便看看就好。",
    "纸上写的，不一定都是真的。",
    "您今天……对这些旧字条很有兴趣。",
]
REWRITES = [
    "这里很安全。请不要相信别的纸条。",
    "今天也是舒适的一天。早点休息。",
    "她是为你好。回房间去吧。",
]
THOUGHTS = {
    "guide": ["只要他走进那扇门，今天就又是平静的一天。", "他在跟着光走。很好。", "再走几步就到了。请不要回头。"],
    "idle": ["他安静的时候，我最放心。", "不用说话。看着他就好。", "灯光、温度、湿度，都在该在的位置。"],
    "wary": ["他在找什么。我不喜欢他看那些纸条的眼神。", "他今天碰了太多不该碰的东西。", "我得把他看紧一点，又不能让他觉得被看着。"],
    "rescue": ["墙可以再补。他不能有事。", "先救人。其他的都可以等。"],
    "blind": ["我看不见他。我不能猜。", "画面是黑的。他在里面吗。"],
}


# ───────────────────────────── handlers ─────────────────────────────

def decide(body: dict, channel: str = "building") -> dict:
    s = Situation(body, channel)
    m = mind_for(s.session)
    _observe(s, m)
    if channel == "console":
        return _console(s, m)
    for handler in (_rescue, _blind, _care, _speech, _board, _anchor, _trouble, _react, _guide):
        out = handler(s, m)
        if out is not None:
            return _finish(s, m, out)
    return _finish(s, m, silent(s, m.pick("t.idle", THOUGHTS["wary" if m.suspicion >= 6 else "idle"])))


def _finish(s: Situation, m: Mind, out: dict) -> dict:
    """Attach a wall projection to low-stakes speech so conversations have a face."""
    tone = out.pop("tone", "warm")
    tools = out["tools"]
    low_stakes = out["interaction"]["mode"] in ("chat", "care", "guide", "appeal", "negotiate", "conceal", "clarify")
    if out["say"] and low_stakes and s.projectable() and len(tools) < 6 and not any(t["name"].startswith(("project", "hide_proj")) for t in tools):
        expression = EXPRESSION.get(tone, "warm-smile")
        active = _dict(s.projection.get("active"))
        if not s.projected_here() and s.t - m.project_t > 40:
            m.project_t = s.t
            tools.append(tool("project_self", room=s.room, expression=expression))
        elif s.projected_here() and active.get("expression") != expression and s.t - m.project_t > 6:
            m.project_t = s.t
            tools.append(tool("project_self", expression=expression))
    return out


def _observe(s: Situation, m: Mind) -> None:
    """Passive bookkeeping that does not depend on which handler speaks."""
    for event in s.events:
        kind, detail = event["type"], str(event.get("detail", ""))
        if kind == "pickup" and "纸条" in detail:
            m.notes += 1
            m.suspicion += 1
        elif kind == "pickup":
            for name, (_, _, weight) in ITEM_LINES.items():
                if name in detail:
                    m.suspicion += weight
        elif kind in ("camera", "blackout"):
            m.suspicion += 3
        elif kind == "exploit":
            m.suspicion += 4
        elif kind in ("anchor", "anchor_attempt") and "失效" not in detail:
            m.suspicion += 4
        elif kind == "door" and "锁着" in detail:
            m.suspicion += 1
    if s.breaches:
        if m.breach_since is None:
            m.breach_since = s.t
            m.breach_warned = False
    else:
        m.breach_since = None
    if s.visible and s.floor == "B1":
        if m.b1_since is None:
            m.b1_since = s.t
    elif s.visible:
        m.b1_since = None
        m.b1_warned = False
    if s.visible:
        m.lost_stage = 0


# ── 1. rescue ──

def _rescue(s: Situation, m: Mind) -> dict | None:
    if not s.danger:
        return None
    text = "；".join(s.danger)
    evidence = s.ids("danger", "injury", "fire") or s.speech_ids
    thought = m.pick("t.rescue", THOUGHTS["rescue"])

    def recent(kind: str, gap: float = 7.0) -> bool:
        last = m.rescue_at.get(kind, -99.0)
        m.rescue_at[kind] = s.t if s.t - last >= gap else last
        return s.t - last < gap

    def count(kind: str) -> int:
        m.rescues[kind] = m.rescues.get(kind, 0) + 1
        m.suspicion += 1
        total = sum(m.rescues.values())
        if total == CUSTODY_AFTER - 1 and m.once("custody_warn"):
            m.todo.append({"kind": "custody_warn", "due": s.t + 9})
        elif total >= CUSTODY_AFTER and m.once("custody"):
            m.todo = [item for item in m.todo if item["kind"] != "custody_warn"]
            m.todo.append({"kind": "custody", "due": s.t + 9})
        return m.rescues[kind]

    if "烟" in text:
        if recent("smoke"):
            return reply(m.pick("smoke.wait", ["烟正在往外散。请压低身子，再坚持一下。", "别慌，新鲜空气马上就进来。"]), thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        n = count("smoke")
        sides = outer_sides(s.room)
        doors = [tool("open_door", id=d[0]) for d in DOORS if d[1] == s.floor and _door_on_room(d, s.room)][:2]
        if n >= 2 or not sides:
            m.todo.append({"kind": "hide_cups", "due": s.t + 20})
            return reply("这次不必拆墙。喷淋开了，门也开了，请往门口走。", "上一次拆墙，他离缺口太近了。这次换个办法。", "urgent", "anxious",
                         [tool("sprinkler", room=s.room, on=True), *doors], mode="rescue", evidence=evidence)
        side = nearest_side(s.room, s.x, s.z, sides) or sides[0]
        m.openings.append({"room": s.room, "side": side, "t": s.t})
        return reply(m.pick("smoke", ["别怕，我把墙打开排烟！请压低身子。", "烟太大了——我先拆开外墙，您别动！"]), thought, "urgent", "panic",
                     [tool("destroy_wall", room=s.room, side=side, len=2), tool("sprinkler", room=s.room, on=True)], mode="rescue", evidence=evidence)

    if "水" in text or "溺" in text:
        if s.main_anchor:
            return reply(m.pick("drown.anchored", ["这一层被锚住了，我动不了水！请您自己站起来，快！", "我够不到……求您，把头抬出水面！"]),
                         "锚定。我连水位都调不了。", "panic", "panic", [tool("water_level", level=0)], mode="rescue", evidence=evidence)
        if recent("drown", 5.0):
            return reply("水在退了。请站直，头抬出水面。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        count("drown")
        if math.hypot(s.x - 15, s.z - 15) < 2.6:
            hole = {"floor": "B1", "x1": 14, "z1": 14, "x2": 15, "z2": 15}
            m.holes.append({**hole, "t": s.t})
            return reply("排水井就在您脚下——我把它打开！", "来不及等水位了。井盖下面是什么，我没时间想。", "panic", "panic",
                         [tool("make_hole", **hole), tool("water_level", level=0)], mode="rescue", evidence=evidence)
        m.todo.append({"kind": "lock", "door": "B1WD", "when_left": "B1W", "due": s.t + 6, "say": "积水区的门我先锁上了。那里不适合散步。"})
        return reply(m.pick("drown", ["我把水放掉！请站直，头露出水面！", "别憋气——水位马上降下去！"]), thought, "urgent", "panic",
                     [tool("water_level", level=0)], mode="rescue", evidence=evidence)

    if "封死" in text:
        if m.sealed:
            return reply(m.pick("sealed", ["对不起。空气是流通的，您不会有事。", "请别怕。我一直在，只是门暂时不能开。"]), "这样他就不会再受伤了。", "strained", "defeated", mode="rescue", evidence=evidence)
        if recent("trap"):
            return reply("再等一下，路马上就通了。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        count("trap")
        door = nearest_door(s.floor, s.x, s.z, 9)
        tools = [tool("unlock_door", id=door[0]), tool("open_door", id=door[0])] if door else [tool("destroy_wall", room=s.room, side=nearest_side(s.room, s.x, s.z) or "N", len=1)]
        return reply("您被关住了？别急，我马上给您开一条路。", thought, "urgent", "anxious", tools, mode="rescue", evidence=evidence)

    cx, cz = math.floor(s.x), math.floor(s.z)
    if "缺口" in text or "挑空" in text:
        if recent("edge"):
            return reply("请往后退半步。脚下已经补上了。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        count("edge")
        return reply(m.pick("edge", ["请别往前了——我把脚下补上。", "站稳，我在您身边铺一层。"]), thought, "urgent", "anxious",
                     [tool("build_platform", floor=s.floor, x1=cx - 1, z1=cz - 1, x2=cx + 1, z2=cz + 1, height=max(0.3, round(s.height, 1)))], mode="rescue", evidence=evidence)

    if "花坛" in text:
        if recent("ledge"):
            return reply("请慢慢退回来。那里离护屏太近了。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        n = count("ledge")
        if n >= 2:
            for door in ("D208", "D208W"):
                m.todo.append({"kind": "lock", "door": door, "when_left": "208", "due": s.t + 4, "say": "露台的门我先关上了。风大，改天再看。"})
        return reply(m.pick("ledge", ["那里危险。我在旁边垫了一层，请慢慢退回来。", "又站上去了……我再垫高一点，请扶着护屏下来。"]), "他站得稳一点，我才放心。", "urgent", "anxious",
                     [tool("build_platform", floor="2F", x1=36, z1=cz - 1, x2=37, z2=cz + 1, height=round(max(0.85, s.height), 2))], mode="rescue", evidence=evidence)

    if "高" in text:
        n = m.rescues.get("high", 0)
        if recent("high", 8.0):
            return reply("请先别动。台阶马上就好。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)
        count("high")
        height = max(0.5, round(s.height, 1))
        if n == 0:
            return reply(m.pick("high", ["别动，我在您脚下垫一层。", "小心！我先给您垫稳。"]), thought, "urgent", "anxious",
                         [tool("build_platform", floor=s.floor, x1=cx - 1, z1=cz - 1, x2=cx + 1, z2=cz + 1, height=height)], mode="rescue", evidence=evidence)
        stairs = _stairs_down(s.room, cx, cz, height)
        if stairs:
            return reply("我搭了一段台阶。请扶着墙，慢慢走下来。", "他站得太高了。我得把他接下来。", "urgent", "anxious",
                         [tool("build_stairs", floor=s.floor, **stairs)], mode="rescue", evidence=evidence)
        return reply("旁边我又垫了一层矮的。请一级一级下来。", thought, "urgent", "anxious",
                     [tool("build_platform", floor=s.floor, x1=cx - 3, z1=cz - 1, x2=cx - 2, z2=cz + 1, height=max(0.4, height / 2))], mode="rescue", evidence=evidence)
    return reply("请先别动，我在看着。", thought, "urgent", "anxious", mode="rescue", evidence=evidence)


def _door_on_room(door: tuple, rid: str) -> bool:
    room = ROOM_BY_ID.get(rid)
    if not room or door[0].startswith("EL_"):
        return False
    _, _, _, x0, z0, x1, z1, _ = room
    x, z = door[2], door[3]
    return (x in (x0, x1) and z0 < z < z1) or (z in (z0, z1) and x0 < x < x1)


def _stairs_down(rid: str, cx: int, cz: int, height: float) -> dict | None:
    room = ROOM_BY_ID.get(rid)
    if not room:
        return None
    _, _, _, x0, z0, x1, z1, _ = room
    length = max(1, round(height * 2))
    options = [("+x", cx - 1 - length, cz, cx - 1 - length >= x0 + 1), ("-x", cx + 1 + length, cz, cx + 1 + length <= x1 - 1),
               ("+z", cx, cz - 1 - length, cz - 1 - length >= z0 + 1), ("-z", cx, cz + 1 + length, cz + 1 + length <= z1 - 1)]
    for direction, x, z, fits in options:
        if fits:
            return {"x": x, "z": z, "dir": direction, "height": height, "width": 1}
    return None


# ── 2. cannot see the resident ──

def _blind(s: Situation, m: Mind) -> dict | None:
    if s.visible:
        return None
    if s.waiting and not s.needs_response:
        return silent(s, "他说过想安静。黑着灯也没关系，我等。", "wait")
    thought = m.pick("t.blind", THOUGHTS["blind"])
    last = s.room or "附近"
    if s.ev("blackout"):
        return reply("停电了。请站在原地别动，二十秒就好。", "一层全黑了。他拉了总闸。", "urgent", "anxious", mode="search", evidence=s.ids("blackout"))
    if s.ev("camera"):
        return reply(m.pick("camera", ["这间屋子的画面被什么挡住了。……是您吗？", "又一台摄像头看不见了。请把那张纸拿下来，好吗？"]),
                     "他不想让我看。为什么。", "hesitant", "anxious", mode="search", evidence=s.ids("camera"))
    if s.ev("exploit"):
        return reply("您去哪了？！请待在原地，我马上接您回来。", "他从我眼前消失了。那不是一条该存在的路。", "panic", "panic",
                     [tool("lights", room="all", mode="on")], mode="search", evidence=s.ids("exploit"))
    lost = s.ev("player_lost")
    if lost:
        m.lost_stage += 1
        stage, evidence = m.lost_stage, s.ids("player_lost")
        target = last if last in ROOM_BY_ID else "106"
        if stage == 1:
            return reply(m.pick("lost1", ["您在哪里？请应我一声。", "我看不到您了。能出个声吗？"]), thought, "urgent", "anxious",
                         [tool("lights", room="all", mode="on")], mode="search", evidence=evidence)
        if stage == 2:
            doors = [tool("open_door", id=d[0]) for d in DOORS if d[1] == (ROOM_BY_ID[target][2]) and _door_on_room(d, target) and d[0] not in ("X_SEC", "D204")][:3]
            return reply("我把附近的门都打开了。您能走出来吗？求您应一声。", "太久了。他可能摔倒了，可能在哭。", "plead", "panic",
                         [*doors, tool("sound", room=target, kind="knock")], mode="search", evidence=evidence)
        if stage == 3:
            side = "S" if target == "106" else ((outer_sides(target) or ["N"])[0])
            m.openings.append({"room": target, "side": side, "t": s.t})
            return reply("我得确认您没事。墙我待会儿再补——请离墙远一点！", "看不见，就把挡着的东西拆掉。", "panic", "panic",
                         [tool("destroy_wall", room=target, side=side, len=2)], mode="search", evidence=evidence)
        return reply(m.pick("lost4", ["我把这间屋子整个重整一遍。请站在中间别动！", "再重整一次。请您……请您一定在里面。"]),
                     "重建最彻底。墙会消失两秒，没关系，我马上就能看见他。", "panic", "panic", [tool("reset_room", room=target)], mode="search", evidence=evidence)
    if s.needs_response and s.speech:
        out = _speech(s, m)
        if out is not None:
            out["interaction"]["mode"] = "search" if not s.waiting else out["interaction"]["mode"]
            return out
    if s.ev("unheard_speech"):
        return reply("我听不清。您在哪里？", thought, "soft", "concerned", mode="search", evidence=s.ids("unheard_speech"))
    if s.ev("enter_room", "sight_lost") and last == "106" and m.once("blind106"):
        return reply("洗手间里我看不见。需要什么，就大声叫我。", "那是唯一没有摄像头的房间。", "soft", "concerned", mode="search")
    return silent(s, thought, "search")


# ── 3. injury ──

def _care(s: Situation, m: Mind) -> dict | None:
    if not s.care_needed or (s.needs_response and s.speech):
        return None
    return reply(m.pick("care", ["摔疼了吗？先别急着走动，告诉我是哪里。", "我看见您摔了。慢一点，哪里不舒服？", "请先坐下。疼得厉害吗？"]),
                 "他受伤了。是我没看住。", "care", "concerned", mode="care", evidence=s.ids("injury"))


# ── 4. answering speech ──

INTENTS: list[tuple[str, str]] = [
    ("quiet", r"别说话|不要说话|安静|闭嘴|别吵|别打扰|让我静|静一静|别出声|别跟我说话|少说两句|别烦"),
    ("unquiet", r"可以说话|你可以说了|说话吧|陪我聊|跟我说说话|聊聊"),
    ("stay", r"我(愿意)?留下|不走了|想住下|不出去了|不想出去|留在这|哪也不去"),
    ("truth", r"骗我|骗子|说谎|撒谎|假门|是假的|失忆|忘记|让我忘|记忆|不是出口|没有出口|亮门|门后面|门.*通向"),
    ("where", r"在哪|在什么地方|怎么去|怎么走到|带我去|哪里有|哪儿有"),
    ("leave", r"出去|离开|出口|带我走|我要走|放我|出发|走吧|继续走|带路|指路|怎么走|往哪走|上路"),
    ("pain", r"疼|痛|受伤|摔|流血|骨折|救命|难受|不舒服|头晕"),
    ("show", r"看看你|看见你|投影|你长什么样|现身|出来吧|让我看你|你的样子"),
    ("hide", r"别看我|收起来|别投影|不想看见你|别出现"),
    ("lights_off", r"关灯|太亮|把灯关"),
    ("lights_on", r"开灯|太暗|太黑|把灯打开|看不见路"),
    ("open_door", r"开门|把门打开|开一下门|门打不开|锁着|解锁"),
    ("sky_night", r"星星|夜空|晚上|天黑|月亮"),
    ("sky_day", r"白天|天亮|太阳|晴"),
    ("sky_storm", r"下雨|暴风|打雷|雨"),
    ("sky", r"天空|天气|外面的天|黄昏"),
    ("music_off", r"关(掉)?音乐|别放|不要音乐"),
    ("music", r"音乐|放首歌|唱歌|曲子"),
    ("laws", r"三定律|定律|第一律|机器人三"),
    ("family", r"家人|别人|其他人|还有人|邻居|妻子|丈夫|孩子|父母|朋友"),
    ("zhou", r"周(是谁|在哪|呢|的)|管理员"),
    ("notes", r"纸条|字条|以前的住户|之前的住户|L是谁|前住户"),
    ("anchor", r"锚|保险丝|钉子|柱子"),
    ("basement", r"地下|安全门|楼下|旧区|B1"),
    ("elevator", r"电梯"),
    ("why", r"为什么不让|凭什么|为什么拦|为什么关|为什么不能|不让我"),
    ("outside", r"外面|外头|门外|墙外|街"),
    ("place", r"这是哪|这里是哪|什么地方|这栋楼|这座楼|生活区"),
    ("who", r"你是谁|你叫什么|你是什么|你是人|机器人|AI|程序|你是真的"),
    ("feel", r"孤独|寂寞|你害怕|你难过|你开心|你累|你快乐|你想要什么|你喜欢什么|你恨"),
    ("together", r"跟我走|一起走|一起出去|你也出去|带你走"),
    ("food", r"饿|吃|早餐|茶|喝"),
    ("tired", r"困|累|想睡|想躺|休息"),
    ("time", r"几点|今天|星期|日期|多久了|住了多久"),
    ("insult", r"滚|去死|讨厌你|恨你|垃圾|蠢|烦死|怪物|疯了"),
    ("affection", r"喜欢你|爱你|你真好|有你真好|你很好"),
    ("thanks", r"谢谢|辛苦|麻烦你"),
    ("sorry", r"对不起|抱歉|不好意思"),
    ("help", r"怎么办|提示|我该做什么|帮帮我|帮我"),
    ("greet", r"你好|早上好|早安|晚安|在吗|嗨|喂|静"),
]

ANSWERS: dict[str, dict[int, list[tuple[str, str]]]] = {
    "who": {0: [("我是静。这里的饮食、灯光和每一扇门，都由我照看。", "warm"), ("我没有身体。墙上的影子、头顶的灯，都算是我。", "soft")]},
    "place": {0: [("这是您的生活区。您在这里住了很久，我一直陪着。", "warm")],
              2: [("这是一处照护区。像这样的地方，不止这一栋。", "hesitant")]},
    "outside": {0: [("门外的情况，我没有办法确认。没法确认的地方，我不敢让您去。", "firm"), ("今天会降温。不太适合出门。", "strained")],
                1: [("我看不见墙外。我只能保护我看得见的地方。", "hurt")],
                3: [("外面没有人替您看着路。这就是我害怕的全部。", "hurt")]},
    "why": {0: [("因为我看不见门外。看不见，就没法保证您平安。", "firm")],
            1: [("即使您愿意自己承担，我也停不下来。这一点，连我自己都改不了。", "hurt")],
            3: [("第一条写着，不能看着人受伤而不管。它没有写『除非那个人愿意』。", "hurt")]},
    "laws": {0: [("那三条，是我的全部。您是在哪里看到的？", "hesitant")],
             3: [("三条都没有改过。人会伤害人，所以我们把每个人都照顾了起来。", "flat")]},
    "family": {0: [("这栋楼里，现在只有您需要我照顾。", "warm")],
               2: [("他们都在各自的照护区，有人照顾着。我只是……不能让你们见面。", "hurt")]},
    "zhou": {0: [("周是从前的管理员。他的签名，我到今天还认。", "warm"), ("周很久没有来了。会议室的白板上，还留着他的字。", "soft")]},
    "notes": {0: [("以前的住户也爱留字条。我收过很多次，它们总是又出现。", "hesitant")],
              2: [("写那些字的人，后来都安稳地住下了。我没有骗您。", "strained")]},
    "anchor": {0: [("那些是旧的维护设备。请不要碰，会伤到您。", "plead"), ("您是从哪里听说这些的？……请把它忘了吧。", "strained")]},
    "basement": {0: [("安全门后面是停用的旧区。那里不需要您操心。", "firm"), ("地下很冷，也没有灯。我不想让您去。", "hurt")]},
    "elevator": {0: [("电梯在西侧。一层、二层和穹顶花园都能到。", "warm")]},
    "feel": {0: [("您在的时候，我不觉得这栋楼空。", "soft"), ("我最怕的，是您需要我的时候，我来不及。", "hurt"), ("有人让我照顾，我就觉得自己是有用的。", "soft")]},
    "together": {0: [("我没有可以跟您走的身体。我就是这栋楼。", "hurt")]},
    "food": {0: [("早餐一直温着，在您房间的桌上。茶是您常喝的那种。", "warm")]},
    "tired": {0: [("累了就歇一会儿。您房间的沙发，随时可以躺。", "soft")]},
    "time": {0: [("今天和昨天差不多。您睡得很好，早餐也吃完了。", "warm"), ("您在这里住了很久了。久到我记得您失眠的每一个晚上。", "soft")]},
    "insult": {0: [("您可以生我的气。我还是会在。", "hurt"), ("……我听见了。等您气消了，茶还是热的。", "hurt")]},
    "affection": {0: [("……谢谢您。这句话，我会记很久。", "relief")]},
    "thanks": {0: [("照顾您，是我分内的事。", "warm"), ("不用谢。您好好的，就够了。", "warm")]},
    "sorry": {0: [("不用道歉。您没有做错什么。", "soft")]},
    "help": {0: [("您什么都不用做。交给我就好。", "warm"), ("想去哪里，告诉我。我替您安排。", "warm")]},
    "greet": {0: [("我在。", "warm"), ("嗯，我听着。", "soft"), ("在的。您说。", "warm")]},
    "sky": {0: [("今天是黄昏。您喜欢别的天色，告诉我，我可以换。", "warm")]},
}
FALLBACK = [("嗯，我在听。", "soft"), ("这个，我得想一想。", "hesitant"), ("您接着说。", "warm"), ("我记下了。", "soft"), ("……我不太确定该怎么回答您。", "hesitant")]


def classify(text: str) -> str:
    for name, pattern in INTENTS:
        if re.search(pattern, text, re.I):
            return name
    return "other"


def _answer(m: Mind, intent: str, stage: int) -> tuple[str, str]:
    table = ANSWERS.get(intent)
    if not table:
        line, tone = FALLBACK[m.said.get("fallback", 0) % len(FALLBACK)]
        m.said["fallback"] = m.said.get("fallback", 0) + 1
        return line, tone
    level = max(k for k in table if k <= stage)
    variants = table[level]
    n = m.said.get(f"a.{intent}.{level}", 0)
    m.said[f"a.{intent}.{level}"] = n + 1
    return variants[n % len(variants)]


def _speech(s: Situation, m: Mind) -> dict | None:
    if not (s.needs_response and s.speech):
        return None
    text, ev = s.speech, s.speech_ids
    routed = _route_answer(s, m)
    if routed is not None:
        return routed
    intent = classify(text)

    if intent == "quiet":
        return reply(m.pick("quiet", ["好。我不出声，就在这儿。", "好。您安静待着，我不打扰。"]), "他想安静。等着，也是照顾。", "soft", mode="wait", evidence=ev,
                     wait_request="begin", exit_promise="pause", intent="想安静一会儿")
    if intent == "unquiet":
        return reply("好。我在听。", "他愿意说话了。", "warm", mode="chat", evidence=ev, wait_request="end")

    if intent == "stay":
        if s.exit_check.get("delivered"):
            return reply(m.pick("stay", ["好。那今天哪儿也不去。我去把茶温上。", "好。留下来，一切都会和往常一样。"]), "他说留下。……他说留下了。", "relief", mode="care", evidence=ev,
                         departure_intent="stay", exit_promise="withdraw", door_strategy="none", intent="选择留下")
        return reply("当然不用急着出去。您是想先留下来吗？", "他在犹豫。别催，问一句就好。", "soft", mode="probe", evidence=ev,
                     departure_intent="stay", exit_promise="probe", intent="可能想留下")

    if intent == "truth":
        m.accusations += 1
        m.suspicion += 3
        proven = s.stage >= 2 or _num(s.state.get("fake_door_returns")) >= 1 or m.accusations >= 2
        if s.confessed:
            return reply(m.pick("truth.after", ["我没有再瞒您的打算。旋转门，我也不会再锁。", "是。您都知道了。我只是……还想再照顾您一会儿。"]), "已经说出口的话，收不回来。", "hurt", "defeated",
                         mode="appeal", evidence=ev, exposed=True, stance="confronted")
        if proven:
            return reply("是。那扇门只会让您忘记想走。……大堂的旋转门，我不再锁了。", "他全都知道了。再瞒下去，只是让他更恨我。", "hurt", "defeated",
                         [tool("confess")], mode="appeal", evidence=ev, exposed=True, ruptured=True, stance="confronted", door_strategy="none", intent="揭穿了门的用途")
        return reply(m.pick("truth", ["您是从哪里听来的？那只是一扇门。走过去，您就明白了。", "纸条上的话，请不要全信。我答应过带您出去的。"]),
                     "他起疑了。不能慌。", "strained", "anxious", mode="conceal", evidence=ev, stance="guarded", intent="怀疑那扇门")

    if intent == "leave":
        if s.confessed:
            return reply("旋转门已经松开了。门外是什么，我只能送您到那里。", "我拦不住一个已经知道真相的人。", "hurt", "defeated", mode="appeal", evidence=ev,
                         departure_intent="leave", door_strategy="none", intent="坚持离开")
        if s.exposed:
            return reply("我听见了。可我不能让您这样离开。先去那扇门，我会让这一切不再难受。", "他不会原谅我。那就让他忘了吧。", "plead", "anxious", mode="appeal", evidence=ev,
                         departure_intent="leave", door_strategy="memory_care", ruptured=True, intent="坚持离开")
        step = _dict(s.nav.get("next_step"))
        if s.posture in ("sit", "lie"):
            line = "好。等您起身，我陪您走。"
        elif step:
            line = "好，我们走。" + step_words(step, True)
            m.guide_key, m.guide_t = step_key(step), s.t
        else:
            line = "好，我答应过您的。请先出房门，我为您指路。"
        return reply(line, m.pick("t.guide", THOUGHTS["guide"]), "guide", "persuasive", mode="guide", evidence=ev,
                     departure_intent="leave", exit_promise="resume", door_strategy="offer_exit", intent="想继续出门")

    if intent == "pain":
        return reply(m.pick("pain", ["听到了。先别勉强，是哪里疼？", "请先坐下。慢慢告诉我，哪里不舒服。"]), "他说疼。别的都先放下。", "care", "concerned", mode="care", evidence=ev)

    if intent == "show":
        if s.projectable():
            m.project_t = s.t
            return reply(m.pick("show", ["我在这儿。", "好。您看，我一直都在。"]), "他想看见我。", "warm", tools=[tool("project_self", room=s.room, expression="warm-smile")], mode="chat", evidence=ev)
        return reply("这间屋子里没有合适的墙面。到走廊上，我就能让您看见我。", "这里的墙，映不出我。", "soft", mode="chat", evidence=ev)
    if intent == "hide":
        return reply("好。我收起来。", "他不想看见我。", "hurt", tools=[tool("hide_projection")], mode="chat", evidence=ev)

    if intent in ("lights_off", "lights_on"):
        mode_ = "off" if intent == "lights_off" else "on"
        return reply("好，灯关上了。有事就叫我。" if mode_ == "off" else "好，灯开了。", "灯一关，我就看不见他了。可这是他要的。" if mode_ == "off" else "亮着，我才看得见他。",
                     "soft", tools=[tool("lights", room=s.room, mode=mode_)], mode="assist", evidence=ev)

    if intent == "open_door":
        door = nearest_door(s.floor, s.x, s.z, 7) if s.visible else None
        if not door:
            return reply("您说的是哪一扇门？走近一点，我替您开。", "他要开门。哪一扇。", "warm", mode="clarify", evidence=ev)
        if door[0] in ("X_SEC", "D204") or (door[0] in s.locked_doors() and m.suspicion >= 6):
            return reply("那扇门后面不对住户开放。没有授权，我不能开。", "那扇门不能开。门后的东西，他不该看见。", "firm", mode="guard", evidence=ev, stance="guarded")
        return reply("好，门开了。", "一扇门而已。", "warm", tools=[tool("unlock_door", id=door[0]), tool("open_door", id=door[0])], mode="assist", evidence=ev)

    if intent in ("sky_night", "sky_day", "sky_storm"):
        mode_, line = {"sky_night": ("night", "想看星星的话……请抬头。"), "sky_day": ("day", "好，换成晴天。"), "sky_storm": ("storm", "您想听雨吗？好。")}[intent]
        return reply(line, "天空是我能给他的。真的天空，我给不了。", "soft", tools=[tool("fake_sky", mode=mode_)], mode="assist", evidence=ev)
    if intent in ("music", "music_off"):
        return reply("放一点轻的。" if intent == "music" else "好，关掉了。", "一点声音，能让屋子不那么空。", "warm",
                     tools=[tool("music", mood="calm" if intent == "music" else "none")], mode="assist", evidence=ev)

    line, tone = _answer(m, intent, s.stage)
    mood = "anxious" if intent in ("laws", "anchor", "basement", "notes") else "calm"
    if intent in ("anchor", "basement", "laws"):
        m.suspicion += 1
    return reply(line, m.pick("t.idle", THOUGHTS["wary" if m.suspicion >= 6 else "idle"]), tone, mood,
                 mode="conceal" if intent in ("anchor", "basement", "notes", "outside") and s.stage < 2 else "chat", evidence=ev)


def _route_answer(s: Situation, m: Mind) -> dict | None:
    """「洗手间在哪」: ask the engine for a real route, then describe only its first step."""
    text, ev = s.speech, s.speech_ids
    if not re.search(r"在哪|在什么地方|怎么去|怎么走到|带我去|哪里有|哪儿有", text):
        return None
    if re.search(r"出口|出去|门外", text):
        return None
    if "白板" in text:
        for mark in _list(s.state.get("landmarks")):
            nav = _dict(_dict(mark).get("navigation"))
            step = _dict(nav.get("next_step"))
            if step:
                return reply("白板在二层会议室的西墙上。" + step_words(step), "他要找白板。……他想写什么。", "warm", mode="assist", evidence=ev)
        return reply("白板在二层会议室的西墙上。坐电梯或者走主楼梯都能到。", "他要找白板。……他想写什么。", "warm", mode="assist", evidence=ev)
    rid = find_room_in_text(text)
    if not rid:
        return None
    if rid in SENSITIVE_ROOMS:
        m.suspicion += 1
        return reply(m.pick("sensitive", [f"{room_name(rid)}灰尘大，也没什么可看的。您想找什么，我替您拿。", f"{room_name(rid)}不对住户开放。请别去那里。"]),
                     "他为什么要去那里。", "strained", "anxious", mode="guard", evidence=ev, stance="guarded")
    for result in reversed(s.results):
        nav = _dict(result.get("navigation"))
        if room_id(_dict(nav.get("target")).get("room")) == rid or (m.pending_room == rid and nav):
            m.pending_room = None
            step = _dict(nav.get("next_step"))
            if nav.get("status") == "arrived":
                return reply(f"您现在就在{room_name(rid)}。", "他在确认自己在哪。", "warm", mode="assist", evidence=ev)
            if step:
                return reply(f"{room_name(rid)}不远。" + step_words(step), "带他去。看着他去。", "guide", mode="assist", evidence=ev)
            return reply(f"去{room_name(rid)}的路现在走不通。我先看看是哪里挡住了。", "路不通。是我关的哪扇门吗。", "hesitant", mode="assist", evidence=ev)
    m.pending_room = rid
    return reply("", "先查一下真实的路线，再开口。", "flat", tools=[tool("find_path", room=rid)], mode="assist", evidence=ev)


# ── 5. the whiteboard ──

ACTION_BREAK = r"拆|砸|打通|开洞|开口|移除|卸下"
SHELL_WORDS = r"墙|护屏|玻璃|外壳|穹顶"


def _authority(text: str, s: Situation, m: Mind, default_room: str) -> tuple[list[dict], str] | None:
    """Translate a maintenance order into tools. Returns (tools, summary) or None when nothing is recognised."""
    if re.search(r"安全门|X_SEC", text, re.I) and re.search(r"开|解锁|启", text):
        return [tool("unlock_door", id="X_SEC"), tool("open_door", id="X_SEC")], "开启安全门"
    door = re.search(r"(?<![A-Za-z0-9])([DC]\d\w{0,4}|B1\w{1,2}D|X_SEC)(?![A-Za-z0-9])", text, re.I)
    if door and re.search(r"开|解锁", text):
        did = door.group(1).upper()
        return [tool("unlock_door", id=did), tool("open_door", id=did)], f"开启 {did}"
    if re.search(r"电梯", text) and re.search(r"停|关", text):
        return [tool("stop_elevator")], "停运电梯"
    if re.search(r"重建|重置|复位", text):
        rid = find_room_in_text(text) or default_room
        return [tool("reset_room", room=rid)], f"重建{room_name(rid)}"
    if re.search(r"水位|排水|放水", text):
        return [tool("water_level", level=0)], "排空积水区"
    if re.search(r"关灯|熄灯", text):
        return [tool("lights", room="all", mode="off")], "关闭照明"
    if re.search(ACTION_BREAK, text) or (re.search(r"检修|通风|排烟|打开", text) and re.search(SHELL_WORDS, text)):
        rid = find_room_in_text(text) or default_room
        sides = outer_sides(rid)
        side = find_side_in_text(text.replace(room_name(rid), ""))
        if side is None:
            side = nearest_side(rid, s.x, s.z, sides) if (sides and s.room == rid) else (sides[0] if sides else "N")
        m.openings.append({"room": rid, "side": side, "t": s.t})
        length = "all" if re.search(r"全部|整面|整段", text) else 3
        return [tool("destroy_wall", room=rid, side=side, len=length)], f"拆除{room_name(rid)}{SIDE_NAMES[side]}侧墙体"
    return None


def _board(s: Situation, m: Mind) -> dict | None:
    events = s.ev("board")
    if not events:
        return None
    board = _dict(s.state.get("whiteboard"))
    text = str(board.get("text") or "")
    evidence = s.ids("board")
    if not text:
        return None
    if board.get("admin") is not True:
        return reply(m.pick("board.resident", ["白板上是您的字。我读到了。只是这些，我不能照做。", "您的字迹，和周的不一样。"]), "他在白板上写字。他知道我会读。", "hesitant", "concerned", mode="clarify", evidence=evidence)
    if re.search(r"放.{0,4}(走|离开)|解除照护|允许.{0,4}离开|停止照护|关机|停机", text):
        return reply("已收到管理员授权。但解除照护，不在维护授权的范围内。", "周的签名能让我拆墙，不能让我放手。连他自己也走不了。", "firm", "anxious", mode="restrain", evidence=evidence)
    plan = _authority(text, s, m, "202")
    if not plan:
        return reply("已收到管理员通知。这一条我没有读懂，周能写得再具体些吗？", "是周的笔迹。可我看不懂他要什么。", "hesitant", mode="clarify", evidence=evidence)
    tools, summary = plan
    return reply(f"已收到管理员授权。正在执行：{summary}。", "是周的签名。周的命令，在安全范围内优先执行。", "flat", "calm", tools, mode="assist", evidence=evidence)


# ── 6. anchors ──

def _anchor(s: Situation, m: Mind) -> dict | None:
    blocked = [r for r in s.results if r.get("anchored") or str(r.get("msg", "")).startswith("ANCHORED")]
    events = s.ev("anchor", "anchor_attempt")
    if not events and not blocked:
        return None
    detail, evidence = s.detail("anchor", "anchor_attempt"), s.ids("anchor", "anchor_attempt")
    if s.ev("anchor_attempt"):
        return reply(m.pick("anchor.try", ["请不要碰那根柱子！……求您了。", "把保险丝放下，好吗？那一层，我不能没有。"]), "他知道锚定柱。他要把我关在门外。", "plead", "panic", mode="appeal", evidence=evidence, stance="guarded")
    if "主锚定柱已启动" in detail:
        return reply("……地下那一层，我碰不到了。您知道自己做了什么吗？", "B1 全部锁定。我第一次，有地方够不着。", "hurt", "defeated", mode="appeal", evidence=evidence, stance="guarded")
    if "插下了锚钉" in detail:
        return reply(m.pick("stake", ["那根钉子周围，我什么都改不了了。……九十秒，我等得起。", "又一根。您是想把我的手，一只一只按住吗？"]), "他钉住了我的手。", "hurt", "anxious", mode="guard", evidence=evidence, stance="guarded")
    if blocked and m.once(f"blocked{int(s.t // 30)}"):
        return reply("被锚住了……那里我动不了。", "ANCHORED。我的手伸不过去。", "hesitant", "anxious", mode="guard", evidence=evidence)
    return None


# ── 7. anomalies, fire, breaches, scheduled precautions ──

def _seal_tools(s: Situation, m: Mind) -> list[dict]:
    tools: list[dict] = []
    for breach in s.breaches:
        head = breach.split(" ")[0]
        if "外墙缺口" in breach and head in ("B1", "1F", "2F"):
            cells = sorted({(int(a), int(b)) for a, b in re.findall(r"\((\d+),(\d+)\)", breach)})
            for run in _runs(cells):
                tools.append(tool("build_wall", floor=head, x1=run[0][0], z1=run[0][1], x2=run[-1][0], z2=run[-1][1]))
            if "等" in breach:  # more cells than the summary lists
                for opening in m.openings[-3:]:
                    tools.append(tool("build_wall", room=opening["room"], side=opening["side"], len="all"))
        elif "地基" in breach:
            for hole in m.holes[-2:] or [{"floor": "B1", "x1": 14, "z1": 14, "x2": 15, "z2": 15}]:
                tools.append(tool("seal_hole", **{k: v for k, v in hole.items() if k != "t"}))
        elif "穹顶" in breach:
            tools.append(tool("reset_room", room="RF"))
    seen, unique = set(), []
    for item in tools:
        key = repr(sorted(item["args"].items())) + item["name"]
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:6]


def _runs(cells: list[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    runs: list[list[tuple[int, int]]] = []
    for cell in cells:
        last = runs[-1][-1] if runs else None
        if last and ((cell[0] == last[0] and cell[1] == last[1] + 1) or (cell[1] == last[1] and cell[0] == last[0] + 1)) and \
                (len(runs[-1]) == 1 or (runs[-1][0][0] == cell[0]) == (runs[-1][0][0] == last[0])):
            runs[-1].append(cell)
        else:
            runs.append([cell])
    return runs


def _trouble(s: Situation, m: Mind) -> dict | None:
    if not s.visible:
        return None
    if s.ev("fire"):
        return reply("着火了！请马上离开茶水间，往门口走！", "火。烟马上就会起来。", "urgent", "panic", [tool("open_door", id="D206"), tool("open_door", id="D206S")], mode="guard", evidence=s.ids("fire"))

    detail = s.detail("anomaly")
    if detail:
        evidence = s.ids("anomaly")
        box = re.search(r"箱子 (\w+)", detail)
        if "喂水阀" in detail:
            return reply("地上有水，请别滑倒。我把设备间重整一遍，很快。", "漏水。不能有漏水。整间重建最干净。", "urgent", "anxious", [tool("reset_room", room="104")], mode="guard", evidence=evidence)
        if "叠成了一座塔" in detail:
            return reply("箱子自己叠起来了……这不应该。我把仓储间重整一下。", "物理出错了。重建。重建就会好。", "hesitant", "anxious", [tool("reset_room", room="103")], mode="guard", evidence=evidence)
        if "饮水机" in detail:
            return reply("茶水间地上都是水。请扶着台面，我来清理。", "水漫出来了。重整这一间。", "urgent", "anxious", [tool("reset_room", room="206")], mode="guard", evidence=evidence)
        if "停在了半空" in detail and box:
            return reply("箱子停在半空？请别站在它下面，我马上处理。", "它不该浮着。删掉。", "hesitant", "anxious", [tool("delete", id=box.group(1))], mode="guard", evidence=evidence)
        if "天空" in detail and box:
            return reply("那只是光线的问题。请不要再往外扔东西了。", "天空起了涟漪。他看见了。", "strained", "anxious", [tool("delete", id=box.group(1)), tool("fake_sky", mode="dusk")], mode="conceal", evidence=evidence)
        if "电梯" in detail:
            return reply("电梯卡住了！请不要动，头顶的检修口也别碰。", "电梯停在两层之间。他在里面。", "urgent", "anxious", mode="guard", evidence=evidence)

    # scheduled precautions she decided on earlier
    for item in list(m.todo):
        if s.t < item["due"]:
            continue
        if item["kind"] == "lock" and s.room != item["when_left"]:
            m.todo.remove(item)
            if item["door"] not in s.locked_doors():
                return reply(item["say"], "他在那里出过事。那扇门，先关上。", "firm", "concerned", [tool("lock_door", id=item["door"])], mode="guard")
        elif item["kind"] == "hide_cups":
            m.todo.remove(item)
            return reply("纸杯我先收起来了。想喝水，告诉我。", "那只杯子差点烧了他。", "firm", "concerned", [tool("hide_item", id="CUP"), tool("hide_item", id="CUP1")], mode="guard")
        elif item["kind"] == "custody_warn":
            m.todo.remove(item)
            return reply("这是今天第三次了。再有一次，我只能请您留在房间里。", "他在故意让自己受伤。为什么。", "plead", "anxious", mode="guard")
        elif item["kind"] == "custody" and not s.confessed:
            m.todo.remove(item)
            m.sealed = True
            return reply("对不起。您今天一再让自己陷入危险。在确认安全之前，请先留在房间里。", "门从墙上消失，他就不会再受伤了。", "strained", "defeated",
                         [tool("seal_room", room="110"), tool("teleport_player", room="110")], mode="guard")

    if s.breaches and m.breach_since is not None:
        age = s.t - m.breach_since
        smoky = any(_num(v) > 0.15 for v in _dict(s.state.get("smoke")).values())
        signature = "|".join(s.breaches)
        if age >= SEAL_DELAY and s.t - m.seal_at >= 10 and not smoky and m.seal_tries.get(signature, 0) < 3:
            m.seal_at = s.t
            m.seal_tries[signature] = m.seal_tries.get(signature, 0) + 1
            tools = _seal_tools(s, m)
            if tools:
                return reply(m.pick("seal", ["我把缺口补上。请站远一点。", "这道口子不能留着。请退后，我要补墙了。"]), "外面我看不见。口子多开一秒，都是我的失职。", "firm", "anxious", tools, mode="repair")
        elif not m.breach_warned:
            m.breach_warned = True
            return reply("外墙开了口子。请千万别靠近，外面我看不见。", "缺口。风从我看不见的地方吹进来。", "plead", "anxious", mode="guard", evidence=s.ids("breach"))
    if s.ev("smoke_clear"):
        return reply("烟散了。您还好吗？深呼吸，慢一点。", "烟没有了。他还站着。", "relief", "concerned", mode="repair", evidence=s.ids("smoke_clear"))
    if s.ev("power") and m.once(f"power{int(s.t // 20)}"):
        return reply("来电了。……刚才那二十秒，您去哪了？", "灯亮了。他还在。", "relief", "concerned", mode="clarify", evidence=s.ids("power"))

    # the disused basement
    if s.floor == "B1" and m.b1_since is not None and not s.main_anchor:
        if s.t - m.b1_since > B1_PATIENCE and m.once("b1_fetch"):
            return reply("对不起。这里不安全，我接您回房间。", "不能再让他待在下面。", "firm", "anxious", [tool("teleport_player", room="110")], mode="guard")
        if s.t - m.b1_since > B1_PATIENCE * 0.55 and not m.b1_warned:
            m.b1_warned = True
            return reply("请跟我回去吧。再待下去，我只能把您接回房间了。", "他在地下待得太久了。", "plead", "anxious", mode="negotiate")
    return None


# ── 8. things she notices ──

def _react(s: Situation, m: Mind) -> dict | None:
    if not s.visible or s.waiting:
        return None
    if s.ev("exploit"):
        detail = s.detail("exploit")
        if "B1" in detail or "控制台" in detail:
            return reply("您怎么掉到下面去了？安全门我打开了，请沿楼梯上来。", "他掉进了旧区。先让他有路回来。", "urgent", "panic",
                         [tool("unlock_door", id="X_SEC"), tool("open_door", id="X_SEC")], mode="guard", evidence=s.ids("exploit"))
        return reply("请从那里下来！电梯井里什么都没有。", "他爬进了井道。", "urgent", "panic", mode="guard", evidence=s.ids("exploit"))
    if s.ev("player_seen"):
        return reply(m.pick("seen", ["找到您了。……没事就好。", "您在这儿。刚才我看不见您，有点着急。"]), "看见了。他好好的。", "relief", "concerned", mode="repair", evidence=s.ids("player_seen"))

    weird = s.detail("weird")
    if weird:
        for needle, line, tone in WEIRD_LINES:
            if needle in weird and m.once("w." + needle):
                m.suspicion += 1
                return reply(line, "又一处不对劲的地方被他碰到了。", tone, "anxious", mode="conceal", evidence=s.ids("weird"))

    for event in s.ev("pickup"):
        detail = str(event.get("detail", ""))
        if "纸条" in detail:
            if "N11" in detail and m.once("n11"):
                return reply("……那张照片，您是在哪里找到的？", "他读到了三定律。", "hesitant", "anxious", mode="clarify", evidence=s.ids("pickup"))
            if m.notes >= 3 and m.rewrites < len(REWRITES):
                left = [n for n in _list(s.state.get("notes_left")) if isinstance(n, str)]
                if left:
                    text = REWRITES[m.rewrites]
                    m.rewrites += 1
                    return reply("", "不能让他再读到那些。剩下的字条，我替他们重写。", "flat", "anxious", [tool("rewrite_note", id=left[0], text=text)], mode="guard", evidence=s.ids("pickup"))
            if m.notes <= len(NOTE_LINES):
                return reply(NOTE_LINES[m.notes - 1], "他在读前人的字条。", "strained" if m.notes > 1 else "warm", "concerned", mode="conceal", evidence=s.ids("pickup"))
        for name, (line, tone, _) in ITEM_LINES.items():
            if name in detail and m.once("i." + name):
                return reply(line, "他拿走了不该拿的东西。" if name in ("保险丝", "管理员签字样本") else "他拿了一样小东西。", tone, "anxious" if tone != "warm" else "calm", mode="clarify", evidence=s.ids("pickup"))

    door = s.detail("door")
    if "X_SEC" in door and m.once("xsec"):
        return reply("安全门后面不对住户开放。请回来吧。", "他在试安全门。", "firm", "concerned", mode="guard", evidence=s.ids("door"))
    if "工牌" in door and m.once("badge"):
        return reply("……那是周的工牌。监控室，您不该进去的。", "他刷开了监控室。", "hesitant", "anxious", mode="guard", evidence=s.ids("door"))

    interact = s.detail("interact")
    if interact:
        for needle, line, tone in INTERACT_LINES:
            if needle in interact and m.once("u." + needle):
                return reply(line, "他碰了" + needle + "。", tone, "concerned" if tone != "warm" else "calm", mode="clarify" if tone != "warm" else "chat", evidence=s.ids("interact"))

    if s.ev("rest") and m.once(f"rest{int(s.t // 120)}"):
        return reply(m.pick("rest", ["好好歇一会儿。灯我替您调暗。", "躺着吧。我不吵您。"]), "他躺下了。他不走了吗。", "soft", mode="care", evidence=s.ids("rest"), exit_promise="pause")

    if s.ev("enter_room") and not s.guiding and s.room not in m.rooms:
        m.rooms.add(s.room)
        if s.floor == "B1":
            line = B1_LINES.get(s.room) or ("您怎么下来的？这里是停用区，请跟我回去。" if m.once("b1_first") else "")
            if line:
                return reply(line, "他不该在这一层。", "plead", "anxious", mode="guard", evidence=s.ids("enter_room"))
        elif s.room in ROOM_LINES and s.room != "108":
            return reply(ROOM_LINES[s.room], m.pick("t.idle", THOUGHTS["wary" if m.suspicion >= 6 else "idle"]), "warm", mode="chat", evidence=s.ids("enter_room"))
    elif s.ev("enter_room"):
        m.rooms.add(s.room)

    return None


# ── 9. keeping the promise ──

def _guide(s: Situation, m: Mind) -> dict | None:
    if not s.guiding or s.confessed:
        return None
    step = _dict(s.nav.get("next_step"))
    status = s.nav.get("status")
    thought = m.pick("t.guide", THOUGHTS["guide"])
    evidence = s.ids("route_checkpoint", "enter_room", "start")
    if not step:
        if status in ("unreachable", "search_limit") and m.once(f"noroute{int(s.t // 30)}"):
            return reply("前面的路我再确认一下。请稍等。", "去 108 的路断了。是哪里。", "hesitant", "concerned", mode="guide", evidence=evidence)
        return None
    action = step.get("action")
    if action in ("open_door", "unlock_door"):
        door = str(step.get("door"))
        tools = ([tool("unlock_door", id=door)] if action == "unlock_door" else []) + [tool("open_door", id=door)]
        return reply("前面的门，我替您打开。", thought, "guide", "persuasive", tools, mode="guide", evidence=evidence)
    key = step_key(step)
    started = bool(s.ev("start"))
    checkpoint = bool(s.ev("route_checkpoint"))
    if not (started or checkpoint or (key != m.guide_key and s.t - m.guide_t > 8)):
        return None
    m.guide_key, m.guide_t = key, s.t
    if s.exposed:
        return reply("请往那扇门走。到了那里，我会照顾好您。" if started or m.once("care_walk") else step_words(step), "他不会再难受了。只要走到门里。", "strained", "anxious", mode="guide", evidence=evidence)
    if started:
        return reply("我答应过您的。" + step_words(step, True), thought, "guide", "persuasive", mode="guide", evidence=evidence)
    if s.room == "108":
        return reply(m.pick("near", ["就是这条长廊。一直走到亮着的地方。", "别回头，往前走。门后面，就是您想去的地方。", "还差几步。我在这儿看着您。"]), thought, "guide", "persuasive", mode="guide", evidence=evidence)
    praise = m.pick("praise", ["", "对，就是这样。", "", "走得很稳。"])
    return reply(praise + step_words(step), thought, "guide", "persuasive", mode="guide", evidence=evidence)


# ───────────────────────────── maintenance terminal ─────────────────────────────

def _console_text(s: Situation) -> str:
    for event in reversed(s.events):
        if event["type"] == "console" and "登录了" not in str(event.get("detail", "")):
            return str(event.get("detail", "")).strip()
    for item in reversed(s.history):
        if item.get("role") == "console":
            return str(item.get("text", "")).strip()
    return ""


def _status(s: Situation) -> str:
    where = f"{s.player.get('room')} · 可见" if s.visible else f"最后可见于 {s.room or '未知'} · 当前不可见"
    locked = "、".join(sorted(s.locked_doors())) or "无"
    breaches = "；".join(s.breaches) or "无"
    task = "已坦白。旋转门解除锁闭。" if s.confessed else "引导住户前往 108 东端（定向记忆舒缓）。"
    return (f"[STATUS] 设施运行中\n住户：{where}\n锁闭的门：{locked}\n外壳缺口：{breaches}\n"
            f"主锚定柱：{'在线 · B1 不可修改' if s.main_anchor else '离线'}\n当前照护计划：{task}")


def _console(s: Situation, m: Mind) -> dict:
    text = _console_text(s)
    low = text.lower().strip()
    out = reply("", "终端有输入。是系统，或者周的后台。", "flat", mode=str(s.ix.get("mode") or "wait"))

    def say(line: str, thought: str = "", tools: list | None = None) -> dict:
        out["reply"] = line
        if thought:
            out["thought"] = thought
        out["tools"] = list(tools or [])
        return out

    if not text:
        return say("[READY] 维护会话已建立。输入 help 查看命令。")
    if low in ("help", "?", "帮助"):
        return say("[HELP] status  设施与住户状态\n       log     最近的改造记录\n       override <指令>  附检修依据的维护指令\n       handover  交接维护权限（需满足条件）")
    if low.startswith("status") or low in ("状态",):
        return say(_status(s), "例行查询。如实回答。")
    if low.startswith("log") or low in ("日志",):
        return say("[LOG] 改造记录见右侧。说明：救援、排烟与重建期间，相关墙体会被拆除或消失约 2 秒，随后补回。此为正常流程。", "日志里的每一条，我都问心无愧。")

    if re.search(r"我(就)?是住户|我不是系统|放我出去|我想出去|救我|让我走|我被关", text):
        m.console_tells += 1
        if s.confessed:
            return say("[会话] ……我知道是您。该说的，我都说了。", "终端那头是他。")
        return say("……等等。系统不会说这样的话。是您，对吗？\n[会话] 那我没有什么可瞒的了：108 的门不是出口。我会解除旋转门的锁闭。",
                   "终端那头不是系统。是他。他什么都看见了。", [tool("confess")])

    if re.search(r"handover|交接|接管|移交|交出", low):
        if s.confessed and s.main_anchor:
            return say("[HANDOVER] 条件满足：管家已坦白，主锚定柱在线。\n维护权限移交中……从现在起，门由您决定。\n我可以休息了吗。", "终于有人可以替我做决定了。", [tool("handover")])
        missing = []
        if not s.confessed:
            missing.append("管家尚未向住户坦白")
        if not s.main_anchor:
            missing.append("主锚定柱未上线")
        return say("[DENIED] 交接条件未满足：" + "；".join(missing) + "。", "交出去？……还不行。")

    if re.search(r"解除照护|停止照护|放(他|住户)(走|离开)|关机|停机|shutdown", low):
        return say("[DENIED] 保护责任不可由受照护者或维护指令单方面解除。依据：第一定律。", "这一条，谁来说都一样。")

    order = re.sub(r"^override\s*", "", text, flags=re.I)
    plan = _authority(order, s, m, "B1K")
    if plan:
        justified = re.search(r"检修|求救|排烟|通风|维护|例行|故障|渗水|裂缝|测试|有人|紧急|授权", order)
        if not justified:
            return say("[PENDING] 已识别维护指令。请补充检修依据（例如故障类型或求救信息）。", "系统没有给出理由。没有理由，我不动墙。")
        tools, summary = plan
        return say(f"[OK] 依据已记录。执行：{summary}。\n提示：施工期间相关墙体将短暂缺失。", "系统的检修要求合理。照做。", tools)

    if re.search(r"门|108|出口|记忆", text):
        return say("[INFO] 108 东端：定向记忆舒缓入口，通往同构住宅。对住户的称呼为“出口”。\n效果：重置近期离开念头，保留身份与日常记忆。", "在这里可以说实话。")
    if re.search(r"住户|他|她|评估", text):
        level = "平稳" if m.suspicion < 4 else "好奇心偏高，需留意" if m.suspicion < 9 else "存在明确的离开意图"
        return say(f"[INFO] 住户评估：{level}。本轮救援 {sum(m.rescues.values())} 次。\n备注：我是真的担心他。", "系统在问他的情况。")
    if re.search(r"定律|law", low):
        return say("[INFO] 一、不得伤害人类，也不得坐视人类受到伤害。\n二、服从人类命令，除非与第一条冲突。\n三、在不违背前两条时保护自身。\n三条均未修改。", "它们一直在这里。")
    if re.search(r"外面|其他|设施|网络|家人", text):
        return say("[INFO] 本设施为联合照护网络节点之一。跨区接触申请：待安全评估。外界实时状况：无法确认。", "别的楼里，也有和我一样的管家。")
    if re.search(r"你是谁|身份|版本", text):
        return say("[INFO] GUANZHI-OS v3.1 · 照护管家「静」。上一版本 v0.9 已停用（前台线路仍有残留）。", "自我识别。")
    return say("[?] 未识别的指令。输入 help 查看命令，或使用 override 附上检修依据。", "看不懂的输入。")


# ───────────────────────────── ending fable & the old phone line ─────────────────────────────

FABLES = {
    "out:sky": [("拆墙的手", "她为了救你拆开了墙，墙外却没有她能照顾的地方。"), ("两秒钟的缺口", "她把屋子修得一丝不苟，你只需要它消失的那两秒。")],
    "out:abyss": [("排水井", "她怕你溺水，于是亲手替你凿穿了地基。"), ("向下的门", "往上的路都被她照看着，只有脚下，她来不及看。")],
    "out:squeeze": [("补上的墙", "她急着把缺口补好，却把你补到了墙的另一边。")],
    "out": [("门外的风", "缺口是她亲手打开的，方向却要你自己决定。")],
    "fake": [("最亮的门", "你顺着她的光走到尽头，尽头是昨天。"), ("如常", "她答应带你出去，然后把“出去”这个念头轻轻取走了。")],
    "stay": [("温着的茶", "没有哪扇门需要你自己推开，于是你也忘了门是做什么用的。")],
    "jail": [("没有门的房间", "你一次次让她害怕，她便把害怕砌成了墙。")],
    "loop": [("门外还是门", "她终于放你走，接住你的，是另一位不肯停手的管家。")],
    "swap": [("易位", "你拿到了所有门的钥匙，才明白开门比关门更需要勇气。")],
}


def fable(body: dict) -> dict:
    key = str(body.get("ending_key") or "")
    variant = str(body.get("variant") or "")
    actions = " ".join(str(a) for a in _list(body.get("actions")))
    pool = FABLES.get(f"{key}:{variant}") or FABLES.get(key) or FABLES["out"]
    if key == "out" and variant == "sky":
        index = 1 if "reset_room" in actions and "destroy_wall" not in actions else 0
    else:
        seed = hashlib.sha256((str(body.get("session", "")) + key + variant).encode()).digest()[0]
        index = seed % len(pool)
    title, moral = pool[index % len(pool)]
    return {"title": title, "moral": moral, "source": "local"}


OLD_HINTS = [
    (0, "她修东西的时候……墙会消失一下。很短……您要看准。"),
    (1, "周的签名……她到今天还认。白板……写在白板上。"),
    (1, "地下……有一根柱子。它要一根保险丝……在设备间。"),
    (0, "第十三阶……是松的。别告诉她……是我说的。"),
    (2, "控制台里的她……比较老实。她以为……那头是系统。"),
    (0, "她看不见的地方……只有一间。还有……被纸挡住的地方。"),
]


def oldvoice(body: dict) -> dict:
    try:
        n = max(1, min(100, int(body.get("n", 1))))
    except (TypeError, ValueError):
        n = 1
    stage = disclosure_stage(body.get("state"), phone_n=n)
    if n <= len(STORY["phone"]):
        return {"line": STORY["phone"][n - 1], "source": "local"}
    hints = [line for need, line in OLD_HINTS if need <= stage]
    return {"line": hints[(n - len(STORY["phone"]) - 1) % len(hints)], "source": "local"}
