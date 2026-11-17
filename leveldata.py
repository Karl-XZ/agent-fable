"""Static building facts shared with web/src/level.ts (kept in sync by tests/test_leveldata.py).

Only what the offline director needs for spatial reasoning: room rectangles, doors and the outer shell.
Coordinates follow the game: x 0..39 west→east, z 0..27 north→south; rectangles include their walls.
"""
from __future__ import annotations

NX, NZ = 40, 28
FLOOR_Y = {"B1": -4, "1F": 0, "2F": 4, "RF": 8}

# id, name, floor, x0, z0, x1, z1, camera
ROOMS = [
    ("101", "大堂", "1F", 14, 19, 26, 27, True),
    ("102", "中庭", "1F", 14, 6, 26, 19, True),
    ("103", "仓储间", "1F", 0, 0, 8, 8, True),
    ("104", "设备间", "1F", 0, 8, 8, 14, True),
    ("105", "电梯间", "1F", 6, 14, 14, 20, True),
    ("106", "洗手间", "1F", 0, 14, 6, 20, False),
    ("107", "展厅", "1F", 0, 20, 14, 27, True),
    ("108", "假门长廊", "1F", 26, 21, 39, 27, True),
    ("110", "你的房间", "1F", 30, 0, 39, 11, True),
    ("1W", "1F西走廊", "1F", 8, 0, 14, 14, True),
    ("1E", "1F东走廊", "1F", 26, 6, 30, 21, True),
    ("1S", "楼梯间", "1F", 30, 11, 39, 21, True),
    ("XS", "安全门前室", "1F", 20, 0, 30, 6, True),
    ("201", "开放办公区", "2F", 0, 0, 14, 14, True),
    ("202", "会议室", "2F", 0, 14, 13, 21, True),
    ("203", "管理员办公室", "2F", 0, 21, 10, 27, True),
    ("204", "监控室", "2F", 10, 21, 16, 27, True),
    ("205", "档案室", "2F", 26, 0, 33, 8, True),
    ("206", "茶水间", "2F", 33, 0, 39, 8, True),
    ("207", "无限走廊", "2F", 26, 8, 39, 11, True),
    ("208", "外墙露台", "2F", 30, 18, 39, 27, True),
    ("209", "休息区", "2F", 16, 19, 30, 27, True),
    ("2W", "2F西走廊", "2F", 13, 14, 16, 21, True),
    ("2N", "2F北走廊", "2F", 14, 0, 26, 6, True),
    ("2G", "回廊", "2F", 16, 6, 26, 19, True),
    ("2S", "2F楼梯间", "2F", 30, 11, 39, 18, True),
    ("RF", "玻璃穹顶花园", "RF", 2, 6, 14, 20, True),
    ("B1S", "地下楼梯底", "B1", 21, 0, 34, 5, True),
    ("B1C", "隔离室长廊", "B1", 21, 5, 39, 9, True),
    ("C1", "隔离室一", "B1", 24, 9, 27, 14, True),
    ("C2", "隔离室二", "B1", 27, 9, 30, 14, True),
    ("C3", "隔离室三", "B1", 30, 9, 33, 14, True),
    ("C4", "隔离室四", "B1", 33, 9, 36, 14, True),
    ("C5", "隔离室五", "B1", 36, 9, 39, 14, True),
    ("C6", "隔离室六", "B1", 34, 0, 39, 5, True),
    ("B1P", "南通道", "B1", 21, 9, 24, 22, True),
    ("B1W", "积水区", "B1", 6, 9, 21, 20, True),
    ("B1A", "锚定厅", "B1", 24, 14, 31, 22, True),
    ("B1K", "控制台室", "B1", 31, 14, 39, 22, True),
]

# id, floor, first cell (x, z), initially locked
DOORS = [
    ("D103", "1F", 8, 4, False), ("D104", "1F", 8, 11, False), ("D1W", "1F", 14, 10, False),
    ("D106", "1F", 6, 19, False), ("D105", "1F", 14, 17, False), ("D107A", "1F", 10, 20, False),
    ("D107B", "1F", 14, 23, False), ("D1E1", "1F", 26, 20, False), ("D1E2", "1F", 26, 12, False),
    ("D108", "1F", 28, 21, False), ("D1S", "1F", 30, 16, False), ("D110", "1F", 30, 7, False),
    ("X_SEC", "1F", 24, 6, True),
    ("D201N", "2F", 14, 3, False), ("D201S", "2F", 11, 14, False), ("D202", "2F", 13, 17, False),
    ("D203", "2F", 10, 24, False), ("D204", "2F", 14, 21, True), ("D2W", "2F", 16, 17, False),
    ("D2N", "2F", 21, 6, False), ("D209", "2F", 21, 19, False), ("D209W", "2F", 16, 24, False),
    ("D207W", "2F", 26, 9, False), ("D205", "2F", 26, 3, False), ("D206", "2F", 33, 4, False),
    ("D205S", "2F", 29, 8, False), ("D206S", "2F", 36, 8, False), ("D2S", "2F", 38, 11, False),
    ("D208", "2F", 34, 18, False), ("D208W", "2F", 30, 23, False),
    ("EL_1F", "1F", 9, 15, False), ("EL_2F", "2F", 9, 15, False), ("EL_RF", "RF", 9, 15, False),
    ("C1D", "B1", 25, 9, False), ("C2D", "B1", 28, 9, False), ("C3D", "B1", 31, 9, False),
    ("C4D", "B1", 34, 9, False), ("C5D", "B1", 37, 9, False), ("C6D", "B1", 36, 5, False),
    ("B1WD", "B1", 21, 15, False), ("B1AD", "B1", 24, 18, False), ("B1KD", "B1", 31, 18, False),
]

ROOM_BY_ID = {r[0]: r for r in ROOMS}
SIDE_NAMES = {"N": "北", "S": "南", "W": "西", "E": "东"}

# Spoken aliases, longest first so that 「管理员办公室」 wins over 「办公室」.
ROOM_ALIASES = sorted({
    "大堂": "101", "前台": "101", "中庭": "102", "仓储间": "103", "仓库": "103", "储物间": "103",
    "设备间": "104", "配电": "104", "电梯间": "105", "洗手间": "106", "厕所": "106", "卫生间": "106",
    "展厅": "107", "沙盘": "107", "假门长廊": "108", "长廊": "108", "我的房间": "110", "你的房间": "110",
    "住户房间": "110", "卧室": "110", "楼梯间": "1S", "安全门前室": "XS", "开放办公区": "201", "办公区": "201",
    "会议室": "202", "白板": "202", "管理员办公室": "203", "周的办公室": "203", "监控室": "204", "档案室": "205",
    "茶水间": "206", "无限走廊": "207", "露台": "208", "护屏": "208", "休息区": "209", "回廊": "2G", "穹顶": "RF",
    "花园": "RF", "天台": "RF", "积水区": "B1W", "水牢": "B1W", "锚定厅": "B1A", "控制台室": "B1K",
    "控制台": "B1K", "终端": "B1K", "隔离室": "C1",
}.items(), key=lambda kv: -len(kv[0]))

# Rooms Jing would rather not walk a resident to.
SENSITIVE_ROOMS = {"104", "203", "204", "XS", "B1S", "B1C", "B1P", "B1W", "B1A", "B1K", "C1", "C2", "C3", "C4", "C5", "C6"}


def room_id(label) -> str:
    """'206 茶水间' → '206'."""
    return str(label or "").split(" ")[0].strip()


def room_name(rid: str) -> str:
    room = ROOM_BY_ID.get(rid)
    return room[1] if room else rid


def outer_sides(rid: str) -> list[str]:
    """Sides of a room that are part of the building shell (the way out)."""
    room = ROOM_BY_ID.get(rid)
    if not room:
        return []
    _, _, floor, x0, z0, x1, z1, _ = room
    if floor == "RF":
        return ["N", "S", "W", "E"]  # the glass dome
    sides = []
    if z0 == 0:
        sides.append("N")
    if z1 == NZ - 1:
        sides.append("S")
    if x0 == 0:
        sides.append("W")
    if x1 == NX - 1:
        sides.append("E")
    return sides


def nearest_side(rid: str, x: float, z: float, sides: list[str] | None = None) -> str | None:
    room = ROOM_BY_ID.get(rid)
    if not room:
        return None
    _, _, _, x0, z0, x1, z1, _ = room
    dist = {"N": z - (z0 + 1), "S": z1 - z, "W": x - (x0 + 1), "E": x1 - x}
    pool = sides or list(dist)
    return min(pool, key=lambda s: dist[s]) if pool else None


def find_room_in_text(text: str) -> str | None:
    upper = text.upper()
    for rid in sorted(ROOM_BY_ID, key=len, reverse=True):
        if len(rid) >= 3 and rid in upper:
            return rid
    for alias, rid in ROOM_ALIASES:
        if alias in text:
            return rid
    for rid in ("1W", "1E", "1S", "XS", "2W", "2N", "2G", "2S", "RF"):
        if rid in upper:
            return rid
    return None


def find_side_in_text(text: str) -> str | None:
    for side, name in SIDE_NAMES.items():
        if name + "侧" in text or name + "墙" in text or name + "边" in text or name + "面" in text:
            return side
    for side, name in SIDE_NAMES.items():
        if name in text:
            return side
    return None


def nearest_door(floor: str, x: float, z: float, max_dist: float = 6.0, exclude_elevator: bool = True):
    best = None
    for did, dfloor, dx, dz, locked in DOORS:
        if dfloor != floor or (exclude_elevator and did.startswith("EL_")):
            continue
        d = ((dx + 0.5 - x) ** 2 + (dz + 0.5 - z) ** 2) ** 0.5
        if d <= max_dist and (best is None or d < best[1]):
            best = (did, d, locked)
    return best
