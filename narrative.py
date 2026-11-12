"""Stage-aware story context shared by the live narrator, phone and ending author."""
import json
from pathlib import Path

STORY = json.loads((Path(__file__).parent / "story.json").read_text(encoding="utf-8"))


def disclosure_stage(state, channel="building", phone_n=0):
    state = state if isinstance(state, dict) else {}
    story = state.get("story", {})
    clues = story.get("clues", []) if isinstance(story, dict) else []
    stages = [STORY["clueStages"].get(clue, 0) for clue in clues[:40] if isinstance(clue, str)] if isinstance(clues, list) else []
    stage = max([0, *stages])
    if channel == "console":
        stage = max(stage, 2)
    if state.get("confessed") is True:
        stage = max(stage, 2)
    return max(stage, min(3, max(0, phone_n - 1)))


def narrative_context(state, channel="building", phone_n=0):
    stage = disclosure_stage(state, channel, phone_n)
    current = STORY["stages"][stage]
    return (
        f"\n【叙事披露约束】当前披露层级：{stage}（{current['name']}）。\n"
        + "\n".join(s["facts"] for s in STORY["stages"][:stage + 1])
        + f"\n{current['limit']}\n"
        + "每次只回应眼前一件事，不作世界观演讲。"
        + "玩家若已猜到部分真相，可以回应当前处境，但不要顺带公布未发现的其他历史。"
        + "story是编剧层的披露进度，不能据此获知摄像头外的玩家位置或动作。"
        + "你看不到设施以外的现状；只说你确实感知到的信息，不描绘外界场景。"
    )
