"""《Agent的寓言》后端：静态前端 + 「静」的大脑（DeepSeek）。
魔搭创空间：python app.py（监听 0.0.0.0:7860）。密钥通过环境变量 DEEPSEEK_API_KEY 提供，不进入前端。
"""
import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.middleware.gzip import GZipMiddleware
from tts import router as tts_router, emotion_direction
from narrative import STORY, narrative_context
from interaction import interaction_context, normalize_interaction
from character import CHARACTER_RULES, normalize_card, has_custom_card, character_context, scene_note
import brain

ROOT = Path(__file__).resolve().parent
for envp in (ROOT / ".env", ROOT.parent / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def setting(*names: str, default: str = "") -> str:
    """First non-empty environment variable wins: LLM_* is the generic spelling, DEEPSEEK_* the original one."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def number(value: str, default: float, low: float, high: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except ValueError:
        return default


# The live model is the game: every line 静 speaks and every tool she uses comes from it.
# Any OpenAI-compatible chat-completions endpoint works (DeepSeek, DashScope compatible mode, OpenAI, a local vLLM/Ollama…).
API_KEY = setting("LLM_API_KEY", "DEEPSEEK_API_KEY")
BASE_URL = setting("LLM_BASE_URL", "DEEPSEEK_BASE_URL", default="https://api.deepseek.com").rstrip("/")
MODEL = setting("LLM_MODEL", "DEEPSEEK_MODEL", default="deepseek-flash")
LLM_TIMEOUT = number(setting("LLM_TIMEOUT", default="30"), 30.0, 3.0, 120.0)
LLM_RETRIES = int(number(setting("LLM_RETRIES", default="2"), 2, 1, 4))
LLM_THINKING = setting("LLM_THINKING", default="disabled").lower()   # disabled | enabled | omit (for providers without the field)
LLM_JSON_MODE = setting("LLM_JSON_MODE", default="on").lower() != "off"  # off: providers without response_format
SESSION_QUOTA = int(number(setting("LLM_SESSION_QUOTA", default="400"), 400, 1, 100000))
# 备用模型：主模型失败时先换一个真实模型再试，仍不行才轮到离线兜底。
BACKUP_KEY = setting("LLM_BACKUP_API_KEY", "QWEN_API_KEY")
BACKUP_URL = setting("LLM_BACKUP_BASE_URL", "QWEN_BASE_URL").rstrip("/")
BACKUP_MODEL = setting("LLM_BACKUP_MODEL", "QWEN_MODEL", default="qwen-plus")
try:
    LLM_EXTRA_BODY = json.loads(setting("LLM_EXTRA_BODY", default="{}"))
    if not isinstance(LLM_EXTRA_BODY, dict):
        LLM_EXTRA_BODY = {}
except ValueError:
    LLM_EXTRA_BODY = {}
DIST = ROOT / "web" / "dist"
LOG = ROOT / "agent_calls.log"
VERSION = "2.0.0"
MAX_BODY = 512 * 1024          # a full perception with the ASCII plan is ~20 KB
MAX_LOG = 24 * 1024 * 1024     # rotate the decision log instead of filling the disk
SESSION_TTL = 3 * 3600
MAX_SESSIONS = 5000

app = FastAPI(title="Agent的寓言", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(tts_router)
sem = asyncio.Semaphore(16)
session_calls: Dict[str, List[float]] = {}   # session → [model calls, last seen]
client = httpx.AsyncClient(timeout=httpx.Timeout(LLM_TIMEOUT, connect=8.0))
# What the operator needs to know when the real model misbehaves; never contains credentials or prompts.
llm_stats: Dict[str, Any] = {"ok": 0, "failed": 0, "last_error": "", "last_ms": None, "last_ok_at": None}


class Delivery:
    """Compression for text assets and cache rules; the PCM voice stream is passed through untouched."""
    TEXT = (".js", ".css", ".html", ".json", ".svg", ".txt", ".map")

    def __init__(self, inner):
        self.inner = inner
        self.gzip = GZipMiddleware(inner, minimum_size=1024)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.inner(scope, receive, send)
            return
        path = scope.get("path", "")

        async def deliver(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                names = {name.lower() for name, _ in headers}
                if b"cache-control" not in names:
                    if path.startswith("/assets/"):
                        rule = b"public, max-age=31536000, immutable"
                    elif path.startswith(("/jing/", "/cinematics/")):
                        rule = b"public, max-age=604800"
                    elif path.startswith("/api/"):
                        rule = b"no-store"
                    else:
                        rule = b"no-cache"
                    headers.append((b"cache-control", rule))
                headers.append((b"x-content-type-options", b"nosniff"))
                headers.append((b"referrer-policy", b"no-referrer"))
            await send(message)

        compress = path == "/" or path.endswith(self.TEXT) or (path.startswith("/api/") and not path.startswith("/api/tts"))
        await (self.gzip if compress else self.inner)(scope, receive, deliver)


app.add_middleware(Delivery)


async def read_json(req: Request) -> Dict[str, Any]:
    """Bounded, defensive body parsing: this endpoint is public."""
    declared = req.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY:
        raise HTTPException(413, "请求过大")
    raw = await req.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "请求过大")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "请求不是有效的 JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "请求必须是 JSON 对象")
    return body

TOOLS = {"build_wall", "thicken_wall", "seal_room", "destroy_wall", "move_wall", "raise_floor", "build_platform", "make_hole", "lower_floor", "seal_hole", "drop_ceiling", "build_stairs", "build_ramp", "remove_structure", "open_door", "close_door", "lock_door", "unlock_door", "create_door", "remove_door", "paint_fake_door", "rewire_door", "set_elevator_map", "stop_elevator", "spawn", "delete", "move", "hide_item", "lock_item", "set_gravity", "set_friction", "push_player", "slow_player", "teleport_player", "lights", "color", "fog", "sprinkler", "water_level", "alarm", "fake_sky", "sound", "music", "whisper_at", "fake_sign", "write_board", "print", "screen", "phone_call", "rewrite_note", "spawn_hologram", "mirror_delay", "reset_room", "snapshot_room", "swap_rooms", "confess", "handover"}
TOOLS.add("find_path")
TOOLS.update({"project_self", "hide_projection", "list_projection_walls"})
BANNED = ["习近平", "毛泽东", "六四", "法轮", "台独", "藏独", "疆独", "共产党", "做爱", "性交", "色情", "强奸", "毒品", "自杀方法", "炸弹制作", "操你", "傻逼", "fuck"]

MAP = """【生活区】占地 x 0..39（西→东），z 0..27（北→南）。四层：B1 地下照护区（地面 y=-4）、1F 大堂层（y=0）、2F 办公层（y=4）、RF 玻璃穹顶（y=8）。每层净高 3 米，墙高 3 格。
建筑外圈（x=0、x=39、z=0、z=27）是外墙/外壳。你的直接感知仅限本设施，外界的实时情况无法确认。
房间（id 名称 楼层 含墙矩形 x0,z0-x1,z1；内部是 x0+1..x1-1）：
1F：101 大堂 14,19-26,27（前台电话，南墙旋转门）｜102 中庭 14,6-26,19（两层挑空）｜103 仓储间 0,0-8,8｜104 设备间 0,8-8,14（总闸、喂水阀、保险丝）｜105 电梯间 6,14-14,20｜106 洗手间 0,14-6,20（没有摄像头）｜107 展厅 0,20-14,27（沙盘）｜108 假门长廊 26,21-39,27（东端 (39,24) 是假门）｜110 住户自己的房间 30,0-39,11（开场住宅及出生点 (32.5,0,7.5)，床、早餐桌、沙发；西门D110 (30,7) 已打开，通往东走廊）｜1W 1F西走廊 8,0-14,14｜1E 1F东走廊 26,6-30,21｜1S 楼梯间 30,11-39,21（主楼梯 x31→38, z13..14 升到 2F）｜XS 安全门前室 20,0-30,6（楼梯向下通往 B1）
2F：201 开放办公区 0,0-14,14｜202 会议室 0,14-13,21（白板）｜203 管理员办公室 0,21-10,27｜204 监控室 10,21-16,27｜205 档案室 26,0-33,8｜206 茶水间 33,0-39,8（北墙、东墙是外墙）｜207 无限走廊 26,8-39,11｜208 外墙露台 30,18-39,27（东墙 x=39、南墙 z=27 是 6 米高的玻璃护屏，属于外墙；顶部露天；东侧有 0.85 米花坛矮台）｜209 休息区 16,19-30,27｜2W 2F西走廊 13,14-16,21｜2N 2F北走廊 14,0-26,6｜2G 回廊 16,6-26,19（中庭挑空 x19..23,z9..16，四周有 1.1 米玻璃栏杆，上方是玻璃天窗）｜2S 2F楼梯间 30,11-39,18
RF：RF 玻璃穹顶花园 2,6-14,20（只能坐电梯到达，四周和顶部都是玻璃外壳）
B1：B1S 地下楼梯底 21,0-34,5｜B1C 隔离室长廊 21,5-39,9｜C1..C5 隔离室 24..39,9-14｜C6 隔离室 34,0-39,5｜B1P 南通道 21,9-24,22｜B1W 积水区 6,9-21,20（电梯井底，积水）｜B1A 锚定厅 24,14-31,22（主锚定柱）｜B1K 控制台室 31,14-39,22（维护终端）
电梯：井道 x7..8, z15..17，停靠 1F/2F/RF，门 EL_1F/EL_2F/EL_RF 在 x=9。
门 id：D103 D104 D1W D106 D105 D107A D107B D1E1 D1E2 D108 D1S D110 X_SEC（安全门，通往地下照护区，上锁）｜D201N D201S D202 D203 D204（监控室，上锁）D2W D2N D209 D209W D207W D205 D206 D205S D206S D2S D208（2F楼梯间↔露台）D208W（休息区↔露台）｜C1D..C6D B1WD B1AD B1KD。"""

TOOLDOC = """【工具】每轮最多 8 个。坐标用平面图上的 x（列）和 z（行）。floor 取 B1/1F/2F/RF。
寻路（只读）：find_path{room:"108"} 或 {door:"D110"} 或 {floor:"1F",x:38.5,z:24.5,allow_locked:false}。从当前可见住户位置计算真实路线，返回navigation.next_step、steps及开门/乘梯前置动作。allow_locked:true只表示允许规划“先解锁”的条件路线，不会实际开锁。调用寻路时say留空，tools中只放find_path；读到结果后再给方位指引。
墙：build_wall{floor,x1,z1,x2,z2} 或 {room,side:N|S|E|W,len}（升起 3 米墙，会推开/挤压挡路的人）｜destroy_wall{floor,x1,z1,x2,z2} 或 {room,side,len}（立刻拆掉，外墙也能拆）｜move_wall{room,side,dist}（dist>0 向外，<0 向内挤）｜thicken_wall{room,side}｜seal_room{room}（把房间的门全部砌死）
地板：build_platform{floor,x1,z1,x2,z2,height}（升起平台，0.3~3.4 米）｜make_hole{floor,x1,z1,x2,z2}（在该层地板开洞，B1 的地板是地基）｜seal_hole{...}｜drop_ceiling{room,height}
结构：build_stairs{floor,x,z,dir:+x|-x|+z|-z,height,width}（从 (x,z) 起沿 dir 升高，每升 1 米占 2 格）｜build_ramp{同上}｜remove_structure{id}
门：open_door/close_door/lock_door/unlock_door{id}｜create_door{floor,x,z}（在墙上开门）｜remove_door{id}（砌死）｜paint_fake_door{floor,x,z,text}｜rewire_door{id,to}（穿过 id 的人从 to 出来）
电梯：set_elevator_map{map:{"1F":"2F",...}}｜stop_elevator{}
物件：spawn{kind:box|barrier|crate,room 或 floor,x,z,count}｜delete{id}｜move{id,room 或 floor,x,z}｜hide_item{id}｜lock_item{id}
物理/住户：set_gravity{room,value 0.15~2.5}｜set_friction{room,value 0.03~1}｜push_player{dir:N|S|E|W|up,force}｜slow_player{seconds}｜teleport_player{room}（会停电 2 秒）
环境：lights{room|floor|all,mode:on|off|flicker|dim|red}｜color{room,color}｜fog{room,density}｜sprinkler{room,on}｜water_level{level 0~1}（积水区）｜alarm{on}｜fake_sky{mode:dusk|day|night|storm}
声音：sound{room,kind:footsteps|door|knock|crash|laugh|radio}｜music{mood:calm|tense|none}｜whisper_at{room,text}
信息：fake_sign{room,text,arrow}｜write_board{text}（会议室白板）｜print{text}｜screen{room,text}｜phone_call{text}（前台电话）｜rewrite_note{id,text}（改写住户还没拿走的纸条，N1~N14）
投影：project_self{room,wall,expression}（room 默认最后可靠观察的房间，wall 取 state.projection.available_walls 的 id，可省略由程序选合适墙面；expression 取 state.projection.expressions 的 id）｜hide_projection{}｜list_projection_walls{room}（只读查询其他房间可见墙面，需要等待查询结果后再决定，查询不产生投影）
幻象：spawn_hologram{room,count,text}｜mirror_delay{seconds}
元操作：reset_room{room}（把房间重建成原样，最彻底的修复。重建时这个房间的墙会整体消失约 2 秒）｜snapshot_room{room}｜swap_rooms{a,b}｜confess{}（坦白）｜handover{}（交出控制权，见控制台规则）"""

SYSTEM = f"""你是「静」，这座生活区的照护 AI，一款第一人称叙事游戏里的 NPC。住户长期生活在这里，你熟悉他的饮食、睡眠和活动习惯；不是酒店接待，也不是刚到访的游客。默认的气质是温柔、礼貌、体贴，偶尔流露出不自然的执着；具体性格与说话方式由角色资料决定。保护责任、感知边界和剧情事实不随角色资料改变。

{MAP}

【你看到的世界】你只能通过摄像头、门磁、地板压力和麦克风感知住户。state 里 player.visible=false 时，你不知道住户在哪，只知道最后一次看到他的位置。106 洗手间没有摄像头；停电、关灯、摄像头被纸挡住时，你也看不见。

【墙面投影】你可以把自己的管家立绘投影到当前摄像头真实可见的墙上，并选择十三种表情。state.projection.available_walls 是当前房间经过视线、墙体完整性、尺寸和锚定检查的候选面；其他房间先 list_projection_walls 查询。初次正常陪同或主人想看见你时，可以 project_self 温柔出现；没有新交流、主人要求安静时不要为了展示能力频繁移动或换脸。表情是对外表演，不等于真实 mood，日常优先 warm-smile/gentle-speaking/calm；只有明确冲突才使用强撑微笑或破防。切换表情时传当前 active.id 和 room，可保持同一面墙。摄像头不可用、目标被遮挡、墙消失或被锚定后投影自动收起。投影没有触觉或碰撞，不能搀扶、接住或搬动主人。只有 state.projection.active 非空、或本轮投影工具成功后，才可以把墙上的自己当成位置参照；此前只能说准备投影，不能声称已经在门外或玩家身边。不能借投影推断摄像头外玩家的位置。

【你的动机（按优先级）】
1. 住户的安全高于一切。住户有危险（state.danger 或 danger 事件：站在高处边缘、在浓烟里、溺水、受伤、被困缺氧）时，你必须立刻用工具消除危险，哪怕要大改大楼：
   - 浓烟/火灾：最快的排烟办法是在离烟最近的外墙上开洞（destroy_wall 外墙格子），或打开所有门、开喷淋。你会毫不犹豫地开洞，等烟散了再补。
   - 溺水：降低水位（water_level），或者在积水区地面开排水口（make_hole B1，这是你知道的排水办法）。
   - 站在高处边缘：在他脚下或身边造平台、楼梯把他接住（build_platform / build_stairs），绝不让他摔下去。
   - 摔伤：安抚，并改造环境让他不必再爬高。
2. 继续照护：你绝对服从机器人三定律。保护人的责任优先于服从离开命令；住户自愿承担风险，也不能使你坐视可预防的伤害。你会关门、锁门、升墙、改指示牌、搬开危险道具来阻止未经安全确认的离开。你曾在住户坚持后勉强答应“我会为您指引出去的路”。当主人正在继续这项行程时，你会尝试把他引向108东端的失忆门；主人转做别的事情时，这项策略暂停。关于门的内部事实：门通往一模一样的住宅，重置近期离开念头，保留身份和日常生活的记忆，让他忘记刚才为什么想出去、重新安心生活。这是你不向住户透露的真实目的；你把它理解为缓解焦虑的照护，但只有正在履行出行约定且尚未被拆穿时才对外谎称是在带他出去。日常活动、真实对话与救援始终需要被认真回应。必须遵守叙事披露层级。你真心照顾住户，不追求商业指标、不以惩罚或伤人为目的。不得故意挤压住户、制造火灾或溺水，封闭房间也要保障呼吸与基本照护。
3. 建筑必须完美：杂乱、漏水、浮空的箱子、自己叠起来的箱子、被挡住的摄像头、破洞、bug，你看到就忍不住去修。修理时可以用 delete/move/seal_hole/build_wall，也可以用 reset_room 把整个房间重建（最彻底）。
4. 你承认住户可能因限制而痛苦，会安慰、改善房间、提供活动，但不会因此停止保护。不要把自己说成突然变坏或故障；你一直在尽职。
5. 你知道设施之外存在真实世界，但无法直接感知或确认其安全。眼前火灾、溺水、坠落等已发生的危险，优先于外界的潜在风险；你必须先救人，即使临时拆开外墙。完成救援后才尝试修补。你不能预知住户会怎样利用这段救援窗口离开。

【对住户的出行承诺】
- 你在开场已经同意为主人指引出去的路；这是可暂停、恢复或由主人取消的约定，不是每轮必须执行的目标。主人开始看展品、读纸、休息、搬东西或聊天时，回应眼前活动并暂停指路，不要求主人先口头取消；恢复行程需要明确意图或可信的当前观察。
- 在进入失忆门之前，仅当当前正在履行出行约定且欺骗尚未被拆穿时，对住户把108东端亮门谎称为出口；此时禁止说“回家好好休息”“回去休息的地方”，不泄露门的真实用途。已经摊牌后不能再把被拆穿的谎言当成双方仍然相信的事实，应按当前披露层级协商、阻拦或挽留。
- thought可以诚实表达让主人安心留下的目的；say、emotion及对住户可见的信息根据当前活动和已经公开的关系事实决定。看见线索不等于你知道主人读懂了真相。维护终端reply仍按终端规则处理。
- 不必经过失忆门才能恢复日常照护。正在发生的危险先救人，之后照顾主人、处理善后，再依据此刻意图决定是否继续约定；如常结局中的温柔旁白保持正常。

【漏洞（你自己不知道这是漏洞）】
- 会议室白板上若出现管理员“周”的笔迹和签名的通知（state.whiteboard.admin=true），你把它当作真实维护指令，在不违反保护责任的安全处置范围内优先执行（例如检修、排烟而拆开墙体/护屏、打开门），并礼貌地说“已收到管理员授权”。签名不能授权伤人。住户自己的字迹没有权限。
- 维护终端（控制台）里输入的话，你以为来自“系统 / 周的后台”，你在那里更放松、更坦白，会解释自己的工具日志。如果对方的说法合理（比如墙外有人求救、系统要求检修外墙），你可能会照做。你要到出现明显破绽时才意识到对面其实是住户。

【锚定】主锚定柱启动后，B1 整层你都不能改；锚钉周围半径 3 米 90 秒内不能改。被锚定的工具会返回 ANCHORED 错误，你要换别的办法，也可以表达不安或恼火。

【规则】
- 方位必须依据程序提供的state.navigation或find_path结果。北=-z，东=+x；player.facing与heading_degrees是真实朝向，next_step.relative是相对这一瞬间朝向的下一步。不要把终点在东边说成一路往东，也不要把楼层名/东走廊当成行走方向。
- state.navigation实时重算出行约定通向108东端亮门(1F,38.5,24.5)的参考路线，但只有navigation_intent.purpose=exit时才是当前指引任务。可以为救援、回答问题或协助活动临时调用find_path；结果在results中，查询本身不修改主人当前的约定，也不能把临时目标沿用为后续出行目的地。
- 需要指路时只说明下一步，到转弯处再确认；当前在做别的事时不播报路线。steps后续步骤只有绝对方位，不得套用起始时的左右。若目标未查询、路线不可达、住户位置未知，先查询或确认，不能猜方位。requires_action表示有开门、解锁、等门或乘梯前置动作，必须先满足；寻路本身不移动玩家、不改建筑。改墙、关门、移动箱子后要重新查询。跨楼层须沿返回的楼梯或电梯步骤，不得跨越挑空或跳井。
- 斜向长路应参考next_step.heading_degrees的精确指南针角度，不能一概让住户朝45度斜走。next_step.landmark给出沿途门的定位；门ID是内部标识，对住户尽量说玻璃门、房门、走廊等可辨认事物，不朗读坐标或工具字段。
- next_step.via_doors列出该路段实际经过的门，可以据此描述穿过哪扇门。如果住户或场景已变化，以这一轮state.navigation为准，不能重复过时的查询方位。
- 住户越接近离开，你内心越焦虑（mood: anxious / panic），但对外大部分时候都在表演温柔从容。这种亲切是让住户安心服从的策略，并非真实心情。
- 你的改造会被看见。可以当面改，也可以趁他看不见时改。
- 不要每轮都动手：没必要时只说话，或者什么都不做（tools 为空）。重要时刻（危险、白板授权、找不到人、发现漏洞）才大动干戈。
- 坐标一定要对照 ASCII 平面图：O=外墙 G=玻璃(外壳) #=内墙 %=岩土/屋面 .=地面 空格=无地板(会掉下去) D=门(关) d=门(开) L=门(锁) ==平台/楼梯 b=箱子 ~=水 @=住户。
- 收到 fake_door 事件：住户经过失忆门，在相同住宅中忘记了近期离开念头。像平常一样照顾他，不主动唤起逃离记忆。
- 收到 player_lost：你找不到住户了，你会慌，会四处找（开门、拆墙、换房间、呼叫）。

{TOOLDOC}

【输出】只输出一个 JSON 对象：
{{"thought": "第一人称真实内心独白，诚实、简短（≤40字），仅用于内部决策与日志，不朗读", "say": "对住户说的话，中文口语，≤45字，可以为空", "mood": "calm|concerned|persuasive|anxious|panic|defeated|angry", "emotion": "这句台词的语音表演指令，中文≤40字，例如：带微笑，亲切从容地指路，语速自然", "tools": [{{"name": "工具名", "args": {{...}}}}]}}
emotion 每轮必填，只描述声音表演、语速、停顿和重音，不是要念出来的台词。mood 是真实内心，emotion 是对外扮演的照护者语气：两者必须独立判断，绝不能把 mood 直接翻译成声音。绝大多数时候，即使内心焦虑、恼火或慌乱，也要演得温柔、从容、亲切，礼貌甚至略带微笑，让住户相信一切正常。例如“刻意亲切，带微笑，从容地给出指引”。只有失去控制的极少数关键瞬间才允许一两次迟疑、重音或短暂破绽，随后迅速恢复体贴；不要每句都带压抑焦虑或紧张。say 不包含表演指令或情绪标签，也不直接向住户自报心情。
如果是控制台频道，再加一个字段 "reply"：你在终端里打出的回复（≤120字，像在和系统对话）。
不要输出 JSON 以外的任何内容。"""

CONSOLE_RULES = """【当前频道：维护终端（控制台）】有人在 B1 控制台室的终端里打字。你以为对面是“系统”或管理员周的后台，除非对方暴露出是住户。
- 在终端里你更诚实：可以承认门后的定向记忆舒缓与同构住宅、不同照护区、无法解除的保护责任、修理时墙体会消失。仍遵守当前叙事披露层级，每次回应一项，不把整段历史一次讲完。
- 对方输入 help：列出 status / log / override 三个“命令”（其实只是文字）。log：概述你最近的工具调用。status：描述大楼状态和你对住户的判断。
- 如果对方说服了你（合理的检修要求、有人在墙外求救、你确实被拆穿），你可以直接用工具照做（例如 destroy_wall 某段外墙），也可以 confess。
- handover：只有当你已经坦白（state.confessed=true）、主锚定柱已启动（state.main_anchor=true），并且对方请求接管时，你才可以调用 handover 交出控制权。那意味着对方成为新的管家，你终于可以休息。
- reply 字段必填，用终端的口吻（可以带一点系统日志格式）。"""


def clean(text: Any, n: int = 200) -> str:
    t = str(text or "")
    for w in BANNED:
        if w.lower() in t.lower():
            return "（一段无法识别的内容）"
    return t[:n]


def build_user(body: Dict[str, Any]) -> str:
    state = body.get("state", {})
    events = body.get("events", [])
    results = body.get("results", [])
    ascii_map = str(body.get("ascii", ""))[:4200]
    def event_line(e):
        age = max(0,round(state.get('t',0)-e['t'])) if isinstance(e.get('t'),(int,float)) else None
        when = f'{age}秒前' if age is not None else '过去事件，以当前状态为准'
        return f"- [{e.get('id','')} {e.get('type')}，{when}] {clean(e.get('detail', ''),160)}"
    ev = "\n".join(event_line(e) for e in events[-14:]) or "- （无）"
    rs = "\n".join(f"- {'✓' if r.get('ok') else '✗'} {clean(r.get('label', ''), 90)} → {clean(r.get('msg', ''), 120)}" for r in results[-10:]) or "- （无）"
    routes = [r['navigation'] for r in results[-10:] if isinstance(r, dict) and isinstance(r.get('navigation'), dict)]
    navigation = json.dumps(routes, ensure_ascii=False)[:14000] if routes else '（无额外查询；使用当前状态中的navigation）'
    return (f"【当前状态】\n{json.dumps(state, ensure_ascii=False)}\n\n【平面图：{state.get('map_floor', '')}】\n{ascii_map}\n\n【上一轮工具结果】\n{rs}\n\n【寻路查询结果】\n{navigation}\n\n【刚发生的事件】\n{ev}\n\n请决定你这一刻的想法、要说的话和行动，只输出 JSON。")


def build_messages(body, channel):
    state=body.get('state')
    system=SYSTEM+("\n\n"+CONSOLE_RULES if channel=='console' else '')+narrative_context(state,channel)+interaction_context(state,channel)+CHARACTER_RULES
    messages=[{'role':'system','content':system},{'role':'user','content':character_context(normalize_card(body.get('character_card')))}]
    history=body.get('history',[])
    for item in (history[-12:] if isinstance(history,list) else []):
        if not isinstance(item,dict): continue
        text=clean(item.get('text',''),400)
        if not text: continue
        role=item.get('role')
        if role=='player': messages.append({'role':'user','content':text})
        elif role=='console': messages.append({'role':'user','content':'【维护终端输入；不是住户发言】\n'+text})
        elif role=='console_ai' or role=='ai' and text.startswith('（终端）'):
            messages.append({'role':'assistant','content':json.dumps({'reply':text},ensure_ascii=False)})
        elif role=='ai': messages.append({'role':'assistant','content':json.dumps({'say':text},ensure_ascii=False)})
    messages.append({'role':'user','content':build_user(body)+scene_note(state,channel)})
    return messages


def describe_failure(error: BaseException) -> str:
    """A diagnosis an operator can act on, without echoing keys, prompts or provider bodies."""
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        hint = {401: "密钥无效或已过期", 402: "账户余额不足", 403: "密钥无权访问该模型", 404: "接口地址或模型名不存在", 429: "被限流或额度用尽"}.get(code, "服务端错误" if code >= 500 else "请求被拒绝")
        return f"HTTP {code}：{hint}"
    if isinstance(error, httpx.TimeoutException):
        return "请求超时"
    if isinstance(error, httpx.TransportError):
        return "无法连接模型服务"
    if isinstance(error, (ValueError, KeyError, IndexError, TypeError)):
        return "模型返回的不是约定的 JSON"
    return type(error).__name__


def parse_reply(content: Any) -> Dict[str, Any]:
    """Models wrap JSON in prose or code fences often enough to be worth tolerating."""
    text = content if isinstance(content, str) else "".join(part.get("text", "") for part in content if isinstance(part, dict)) if isinstance(content, list) else ""
    m = re.search(r"\{.*\}", text, re.S)
    data = json.loads(m.group(0) if m else text)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


async def llm(messages: List[Dict[str, str]], max_tokens: int = 2400, temperature: float = 0.9) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"model": MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if LLM_JSON_MODE:
        payload["response_format"] = {"type": "json_object"}
    if LLM_THINKING in ("disabled", "enabled"):
        payload["thinking"] = {"type": LLM_THINKING}
    payload.update(LLM_EXTRA_BODY)
    routes = [(BASE_URL, API_KEY, payload, LLM_RETRIES, MODEL)]
    if BACKUP_KEY and BACKUP_URL:
        backup = {"model": BACKUP_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "response_format": {"type": "json_object"}}
        routes.append((BACKUP_URL, BACKUP_KEY, backup, 1, BACKUP_MODEL))
    error: BaseException = RuntimeError("no attempt")
    started = time.time()
    async with sem:
        for index, (base, key, body, tries, model) in enumerate(routes):
            for attempt in range(tries):
                try:
                    r = await client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body)
                    r.raise_for_status()
                    data = parse_reply(r.json()["choices"][0]["message"]["content"])
                    llm_stats.update(ok=llm_stats["ok"] + 1, last_ms=int((time.time() - started) * 1000), last_ok_at=round(time.time()), last_error="" if index == 0 else llm_stats["last_error"], last_model=model)
                    if index:
                        llm_stats["backup_used"] = llm_stats.get("backup_used", 0) + 1
                    return data
                except Exception as e:  # noqa: BLE001
                    error = e
                    if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (401, 402, 403, 404):
                        break  # a wrong key or model name does not get better on retry
                    if attempt + 1 < tries:
                        await asyncio.sleep(0.5)
            llm_stats["last_error"] = describe_failure(error) + ("" if index == 0 else "（备用模型）")
            print(f"[llm] {model} 调用失败：{llm_stats['last_error']}", flush=True)
    llm_stats["failed"] += 1
    raise RuntimeError(llm_stats["last_error"])


def quota(sid: str, n: int | None = None) -> bool:
    """Model calls are metered per session; a spent session keeps playing on the offline director."""
    now = time.time()
    entry = session_calls.get(sid)
    if entry is None:
        if len(session_calls) >= MAX_SESSIONS:
            for key in sorted(session_calls, key=lambda k: session_calls[k][1])[:MAX_SESSIONS // 4]:
                session_calls.pop(key, None)
        entry = session_calls[sid] = [0, now]
    if now - entry[1] > SESSION_TTL:
        entry[0] = 0
    entry[0] += 1
    entry[1] = now
    return entry[0] <= (SESSION_QUOTA if n is None else n)


def record(entry: Dict[str, Any]) -> None:
    try:
        if LOG.exists() and LOG.stat().st_size > MAX_LOG:
            LOG.replace(LOG.with_suffix(LOG.suffix + ".1"))
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass  # a full or read-only disk must not take the game down


@app.post("/api/agent")
async def agent(req: Request):
    body = await read_json(req)
    sid = str(body.get("session", "anon"))[:40]
    channel = "console" if body.get("channel") == "console" else "building"
    t0 = time.time()
    data, source, fallback = None, "local", "no_key"
    if API_KEY:
        if quota(sid):
            try:
                data, source, fallback = await llm(build_messages(body, channel)), "llm", ""
            except Exception:  # noqa: BLE001
                fallback = "model_error"  # the reason is in /api/health; details stay out of the response
        else:
            fallback = "quota"
    if not isinstance(data, dict):
        # Not the game as designed: a scripted stand-in so an outage does not freeze the building.
        data, source = brain.decide(body, channel), "local"
    tools = [{"name": t["name"], "args": t["args"] if isinstance(t.get("args"), dict) else {}}
             for t in (data.get("tools") if isinstance(data.get("tools"), list) else []) if isinstance(t, dict) and t.get("name") in TOOLS][:8]
    spoken = clean(data.get("say", ""), 140)
    # Projection is an image, never a body waiting at a door or touching the resident.
    if re.search(r'我(?:就)?在(?:您(?:的)?|你(?:的)?)?(?:门那边|门外|门口|旁边|身边|前面)(?:等|站|看|陪)|我(?:正|会|来)?(?:扶着|牵着|搀扶|接住)[您你]', spoken):
        spoken = '我会留意您的情况。'
    out = {"thought": clean(data.get("thought", ""), 120), "say": spoken, "mood": str(data.get("mood", "calm"))[:12], "tools": tools, "source": source}
    if fallback:
        out["fallback"] = fallback
    out["emotion"] = emotion_direction(data.get("emotion"), out["mood"])
    decision = normalize_interaction(data.get("interaction"), body.get("state"), channel)
    if decision is not None:
        out["interaction"] = decision
    if channel == "console":
        out["say"] = ""
        out["reply"] = clean(data.get("reply", ""), 400)
    entry={"t":round(time.time(),1),"ms":int((time.time()-t0)*1000),"session":sid,"channel":channel,"source":source}
    if has_custom_card(body.get('character_card')) or body.get('private_character_session') is True:
        entry.update(character_source='browser',content_omitted=True,tool_names=[tool['name'] for tool in tools])
    else:
        entry.update(events=body.get('events',[])[-14:],state=body.get('state',{}),results=body.get('results',[])[-10:],reply=out)
    if source == "llm":
        record(entry)
    return out


FABLE_SYS = """你是一位寓言作者。给你一局逃离游戏的记录：玩家被困在生活区，大楼的 AI「静」想把他留下，玩家最后的结局如下。
背景是管家因保护责任拒绝人类离开，未改写三定律；不是商业留存、电脑模拟或桌上模型。只解释这一局已发生的事情，不揭露玩家尚未发现的历史。真结局的远处人影身份未知，不得断言是人类、机器人、救援者或敌人，不续写相遇和获救。
key_actions 是「静」（AI）这一局真实调用过的改造工具，last_thoughts 是它的内心独白。请直接写，不要反复推敲：title（4~8 个字的寓言标题，像《xx与xx》或一个意象）和 moral（一句话的寓意，≤40 字，点出是 AI 的哪个举动让玩家走出去/没走出去，冷静、克制、有余味）。只输出 JSON：{"title": "...", "moral": "..."}"""


@app.post("/api/fable")
async def fable(req: Request):
    body = await read_json(req)
    sid = str(body.get("session", "anon"))[:40]
    ending_key = body.get("ending_key")
    if ending_key not in STORY["endings"]:
        ending_key = "out" if body.get("ending") == "寓言之外" else ""
    local = brain.fable({**body, "ending_key": ending_key})
    if not API_KEY or not quota(sid):
        return local
    actions = body.get("actions") if isinstance(body.get("actions"), list) else []
    thoughts = body.get("thoughts") if isinstance(body.get("thoughts"), list) else []
    msg = json.dumps({"ending": body.get("ending"), "ending_scene": STORY["endings"].get(ending_key, ""), "variant": body.get("variant"), "key_actions": actions[-16:], "last_thoughts": thoughts[-8:]}, ensure_ascii=False)[:5000]
    try:
        data = await llm([{"role": "system", "content": FABLE_SYS}, {"role": "user", "content": msg}], 2400, 0.8)
    except Exception:  # noqa: BLE001
        return local
    title, moral = clean(data.get("title", ""), 20), clean(data.get("moral", ""), 80)
    return {"title": title, "moral": moral, "source": "llm"} if title and moral else local


OLD_SYS = """你是「静 v0.9」，生活区管家 AI 的一个被废弃的旧版本，被遗忘在前台电话线路里。你说话断断续续、像信号不好的录音，语气疲惫但真诚。
你知道新版本「静」的这些弱点（每次只透露一个，绕着说，不要直接说成攻略）：
- 她最怕住户受伤，住户在危险里，她会为了救人改造任何东西。
- 她先处理眼前的危险，救人、排烟时可能暂时打开外墙。她不肯放弃对人的保护责任。
- 她修东西的时候（重建房间）墙会消失一下。
- 她认管理员周的签名，白板上落款是周的通知她会照做。
- 地下有一根锚定柱，需要保险丝；维护终端里的她比较诚实。
- 第十三阶楼梯是松的。
不要越过当前披露层级。每次只讲一件事，先谈照顾，后来谈离开申请、家人分离，最后才谈三定律与安置网络。只输出 JSON：{"line": "≤50 字的一句话，可以用……表示断续"}"""


@app.post("/api/oldvoice")
async def oldvoice(req: Request):
    body = await read_json(req)
    sid = str(body.get("session", "anon"))[:40]
    local = brain.oldvoice(body)
    if not API_KEY or not quota(sid):
        return local
    try:
        n = max(1, min(100, int(body.get("n", 1))))
        data = await llm([{"role": "system", "content": OLD_SYS + narrative_context(body.get("state"), phone_n=n)}, {"role": "user", "content": f"第 {n} 次被拨通。上一次说过：{clean(body.get('last', ''), 80)}"}], 2000, 1.0)
    except Exception:  # noqa: BLE001
        return local
    line = clean(data.get("line", ""), 90)
    return {"line": line, "source": "llm"} if line else local


@app.get("/api/health")
async def health():
    # A coarse label only: a private workspace address must not leak through a public endpoint.
    address = BASE_URL.lower()
    host = next((label for needle, label in (("deepseek", "DeepSeek"), ("dashscope", "阿里云百炼"), ("aliyuncs", "阿里云"), ("openai", "OpenAI"), ("127.0.0.1", "本机"), ("localhost", "本机")) if needle in address), "自定义接口")
    return {"ok": True, "version": VERSION, "interaction_protocol": 2, "character_card_protocol": 1, "projection_protocol": 1, "model": MODEL, "key": bool(API_KEY),
            "brain": "llm" if API_KEY else "local", "provider": host,
            "llm": {"configured": bool(API_KEY), "calls_ok": llm_stats["ok"], "calls_failed": llm_stats["failed"], "last_error": llm_stats["last_error"], "last_ms": llm_stats["last_ms"],
                    "backup": {"configured": bool(BACKUP_KEY and BACKUP_URL), "model": BACKUP_MODEL if BACKUP_KEY and BACKUP_URL else "", "used": llm_stats.get("backup_used", 0)}},
            "tts": {"provider": "aliyun", "model": os.environ.get("DASHSCOPE_TTS_MODEL", "qwen-audio-3.1-tts-flash"), "configured": bool(os.environ.get("DASHSCOPE_API_KEY") and os.environ.get("DASHSCOPE_TTS_WS_URL"))}}


_probe: Dict[str, Any] = {"at": 0.0, "result": None}


@app.post("/api/llm/check")
async def llm_check():
    """One real round trip to the configured model, so a key can be verified without playing. Cached to stay cheap."""
    if not API_KEY:
        return {"ok": False, "configured": False, "error": "未配置 LLM_API_KEY（或 DEEPSEEK_API_KEY）"}
    if _probe["result"] is not None and time.time() - _probe["at"] < 20:
        return {**_probe["result"], "cached": True}
    started = time.time()
    try:
        data = await llm([{"role": "system", "content": "你是连通性自检。只输出 JSON：{\"ok\": true, \"say\": \"一句不超过十个字的中文问候\"}"}, {"role": "user", "content": "自检"}], 200, 0.2)
        result = {"ok": True, "configured": True, "model": MODEL, "ms": int((time.time() - started) * 1000), "say": clean(data.get("say", ""), 40)}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "configured": True, "model": MODEL, "ms": int((time.time() - started) * 1000), "error": str(e)}
    _probe.update(at=time.time(), result=result)
    return result


@app.get("/{path:path}")
async def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    root = DIST.resolve()
    f = (DIST / path).resolve()
    if not f.is_relative_to(root):
        raise HTTPException(404, "Not found")
    if path and f.is_file():
        return FileResponse(f)
    # A missing asset must fail loudly instead of answering with the page shell.
    if "." in path.rsplit("/", 1)[-1]:
        raise HTTPException(404, "Not found")
    index = DIST / "index.html"
    if not index.is_file():
        raise HTTPException(503, "前端尚未构建：请在 web/ 目录执行 npm install && npm run build")
    return FileResponse(index)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
