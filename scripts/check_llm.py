"""真实大模型联调自检：配置好密钥后运行一次，确认「静」确实由模型驱动。

    python scripts/check_llm.py            # 连通性 + 一轮真实的大楼决策 + 一轮终端对话
    python scripts/check_llm.py --rounds 3 # 多跑几轮看稳定性与耗时

读取与后端相同的环境变量（项目根目录 .env 或系统环境）：
    LLM_API_KEY / LLM_BASE_URL / LLM_MODEL      通用写法（任何 OpenAI 兼容的 chat/completions 接口）
    DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL   原有写法，继续有效
不会打印密钥。退出码 0 表示真实模型路径可用；非 0 时会给出可操作的原因。
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
import httpx  # noqa: E402
import app as game  # noqa: E402  (loads .env exactly like the server does)

OBSERVATIONS = [
    {"id": "o1", "type": "enter_room", "detail": "住户进入了 101 大堂", "t": 40},
    {"id": "o2", "type": "speech", "detail": "住户说：「静，这部电话还能打出去吗？」", "t": 44},
]
STATE = {
    "t": 45, "map_floor": "1F",
    "player": {"visible": True, "room": "101 大堂", "floor": "1F", "x": 21.4, "z": 22.3, "height_above_floor": 0, "posture": "stand", "holding": None,
               "danger": [], "injured": False, "underwater_s": 0, "swimming": False, "heading_degrees": 180, "facing": "南"},
    "items_you_saw_taken": [], "blind_rooms": ["106"], "blackout_floors": [], "breaches": [], "main_anchor": False, "stakes": [], "confessed": False,
    "whiteboard": None, "water_level": 0.48, "smoke": {}, "alarm": False, "doors_locked": ["X_SEC", "D204"], "cameras_covered": [],
    "story": {"clues": ["N1"]}, "memory_door_reached": False,
    "interaction": {"mode": "wait", "activity": {"kind": "inspect", "focus": "前台电话", "seconds": 3, "observed": True},
                    "exit_promise": {"status": "paused", "text": "陪主人出去看看", "reason": "先听完并回应主人当前的要求"},
                    "wait_request": {"active": False}, "relationship": {"stance": "cooperative", "exposed": False, "ruptured": False},
                    "observations": OBSERVATIONS, "guidance_allowed": False, "quiet": True, "needs_response": True, "care_needed": False},
    "navigation_intent": {"purpose": "none", "query_changes_goal": False},
    "navigation": {"status": "paused", "message": "当前没有有效的出口行程。"},
    "projection": {"available": True, "active": None, "available_walls": [], "expressions": [{"id": "warm-smile", "label": "温柔微笑"}]},
}
EVENTS = [{"id": "o2", "type": "speech", "detail": OBSERVATIONS[1]["detail"], "t": 44}]
HISTORY = [{"role": "player", "text": "静，我想出去看看。"}, {"role": "ai", "text": "那么，我会为您指引出去的路。"}, {"role": "player", "text": "静，这部电话还能打出去吗？"}]


async def post(client, path, body):
    started = time.time()
    response = await client.post(path, json=body)
    return response.status_code, response.json(), int((time.time() - started) * 1000)


async def main(rounds: int) -> int:
    provider = (await game.health())["provider"]  # a coarse label; the address itself may be private
    print(f"接口：{provider}\n模型：{game.MODEL}\n密钥：{'已配置' if game.API_KEY else '未配置'}")
    if not game.API_KEY:
        print("\n✗ 没有密钥。游戏会运行在「离线兜底」模式：静的台词与决策来自脚本，不是 AI 对话。\n"
              "  在项目根目录创建 .env（参考 .env.example），填入 LLM_API_KEY 后重试。")
        return 2
    failures = 0
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=game.app), base_url="http://check", timeout=120) as client:
        code, probe, ms = await post(client, "/api/llm/check", {})
        if not probe.get("ok"):
            print(f"\n✗ 连通性自检失败（{ms} ms）：{probe.get('error')}")
            return 1
        print(f"\n✓ 连通性自检通过（{probe['ms']} ms）：{probe.get('say', '')}")
        for i in range(rounds):
            code, out, ms = await post(client, "/api/agent", {"session": f"check-{i}", "state": STATE, "ascii": "", "events": EVENTS, "history": HISTORY})
            ok = code == 200 and out.get("source") == "llm" and isinstance(out.get("say"), str) and isinstance(out.get("tools"), list)
            failures += not ok
            print(f"\n{'✓' if ok else '✗'} 大楼频道 第 {i + 1} 轮（{ms} ms，来源 {out.get('source')}{'，兜底原因 ' + out['fallback'] if out.get('fallback') else ''}）")
            print(f"   内心：{out.get('thought')}\n   台词：{out.get('say')}\n   语气：{out.get('emotion')}\n   工具：{json.dumps(out.get('tools'), ensure_ascii=False)}")
            decision = out.get("interaction") or {}
            print(f"   互动：mode={decision.get('mode')} evidence={decision.get('evidence')} exit_promise={decision.get('exit_promise')}")
            if ok and not out["say"] and not out["tools"]:
                print("   注意：这一轮她选择了沉默。对一句直接的提问来说不寻常，建议多跑几轮观察。")
        code, out, ms = await post(client, "/api/agent", {"session": "check-console", "channel": "console", "state": {**STATE, "console_in_use": True},
                                                          "events": [{"type": "console", "detail": "status"}], "history": [{"role": "console", "text": "status"}]})
        ok = code == 200 and out.get("source") == "llm" and bool(out.get("reply"))
        failures += not ok
        print(f"\n{'✓' if ok else '✗'} 维护终端频道（{ms} ms，来源 {out.get('source')}）\n   回复：{out.get('reply')}")
        code, out, ms = await post(client, "/api/fable", {"session": "check", "ending_key": "out", "ending": "寓言之外", "variant": "sky",
                                                          "actions": ["destroy_wall {\"room\":\"206\",\"side\":\"N\"}"], "thoughts": ["墙可以再补。他不能有事。"]})
        ok = code == 200 and out.get("source") == "llm"
        failures += not ok
        print(f"\n{'✓' if ok else '✗'} 结局寓言（{ms} ms，来源 {out.get('source')}）：《{out.get('title')}》{out.get('moral')}")
    health = await game.health()
    print(f"\n统计：成功 {health['llm']['calls_ok']} 次，失败 {health['llm']['calls_failed']} 次" + (f"，最近错误：{health['llm']['last_error']}" if health['llm']['last_error'] else ""))
    print("结论：" + ("真实模型路径可用。" if not failures else "有请求回落到了离线兜底，请根据上面的错误检查密钥、接口地址与模型名。"))
    await game.client.aclose()
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rounds", type=int, default=1)
    sys.exit(asyncio.run(main(max(1, min(10, parser.parse_args().rounds)))))
