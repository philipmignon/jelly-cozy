#!/usr/bin/env python3
"""Generate rive/tank.rml: an 8-bit aquarium drawn as pixel rectangles.

Logical screen is 144x256 pixels, each drawn P=5 artboard units square, on a
720x1280 artboard. Every sprite is a Node holding one Shape per colour; each
Shape is the union of merged pixel-run Rectangles.

The host (src/) owns the jelly, food, ripples, meters and buttons through the
`Tank` view model. Ambient motion (plants, surface, rays, bubbles) is stepped
timelines here, one animation + one state machine layer per motion.
"""
import math
import random
from pathlib import Path
from xml.sax.saxutils import quoteattr

P = 5
LW, LH = 144, 256
W, H = LW * P, LH * P

OUT = Path(__file__).resolve().parent.parent / "rive" / "tank.rml"

# ---------------------------------------------------------------- ids

_next = 100


def nid():
    global _next
    _next += 1
    return f"0:{_next}"


# ---------------------------------------------------------------- palette (ARGB)

C = {
    # water
    "w0": "FF9BEDEF", "w1": "FF5CCFE3", "w2": "FF35A9D6", "w3": "FF2C82C2", "w4": "FF2662A8",
    "foam": "FFE8FBFF", "ray": "26FFFFFF",
    # frame / cabinet
    "frame": "FF2B2D42", "frameHi": "FF4A4E6A", "lamp": "FFFFF2A8",
    "wood": "FF8A5A3C", "woodDk": "FF6B4129", "woodHi": "FFB07A50", "ink": "FF4A2C1F",
    "inset": "FF3A2216", "track": "FF2B1A12",
    # sand / rock / plant
    "sand0": "FFFFF0C8", "sand1": "FFF2D49B", "sand2": "FFD9B277", "sand3": "FFC0955C",
    "rock0": "FFB5C4DC", "rock1": "FF7D8FB0", "rock2": "FF5D6D8C", "rock3": "FF3D4766",
    "back0": "FF2A6FA8", "back1": "FF245E96",
    "g0": "FF8BE38F", "g1": "FF3FAE5C", "g2": "FF237A4A", "gb0": "FF2E8C78", "gb1": "FF206B66",
    # chest
    "cw": "FFB07A50", "cb": "FF8A5A3C", "cy": "FFFFD166", "ck": "FF4A2C1F",
    # jelly (healthy)
    "jO": "FFB0509A", "jB": "E6FFC4EC", "jS": "F0F28FD0", "jH": "FFFFFFFF", "jG": "FFE05FB0",
    # jelly (pale)
    "pO": "FF6F7F99", "pB": "E6DFE8EF", "pS": "F0B8C6D4", "pH": "FFFFFFFF", "pG": "FF98A8BE",
    # jelly (flushed: eating, petting)
    "rO": "FFA02E82", "rB": "EEFF9AD8", "rS": "F5F06BBF", "rH": "FFFFFFFF", "rG": "FFC9308F",
    "tent": "D9F28FD0", "arm": "E6FFC4EC", "armF": "E6F28FD0",
    "glow": "99FFD6F5",
    # food / ui
    "f0": "FFFF9F43", "f1": "FFFFD166", "ripple": "CCE8FBFF",
    "murk": "FF6F8F4A", "algae": "D05F8F3A", "night": "FF0B1236",
    "btn": "FFF4E4C8", "btnHi": "FFFFFAF0", "btnLo": "FFC9A77C",
    "red": "FFE05F5F", "white": "FFFFFFFF", "yel": "FFFFD166", "yelDk": "FFE0A83A",
    "aqua": "FF4CC3E0", "green": "FF3FAE5C", "sun": "FFFFB703", "moon": "FFFFF2A8",
    "moonO": "FFC9A227", "heart": "FFFF6FA8", "barFood": "FFFF9F43", "barWater": "FF4CC3E0",
}

# ---------------------------------------------------------------- pixel -> rml


def merge_rects(pixels):
    """pixels: set of (x, y). Returns list of (x, y, w, h) covering them."""
    rows = {}
    for x, y in pixels:
        rows.setdefault(y, []).append(x)
    runs = {}  # y -> list of (x0, x1)
    for y, xs in rows.items():
        xs.sort()
        out = []
        start = prev = xs[0]
        for x in xs[1:]:
            if x == prev + 1:
                prev = x
                continue
            out.append((start, prev))
            start = prev = x
        out.append((start, prev))
        runs[y] = out
    rects = []
    open_ = {}  # (x0,x1) -> [y0, h]
    for y in sorted(runs):
        cur = set(runs[y])
        nxt = {}
        for key, (y0, h) in open_.items():
            if key in cur and y0 + h == y:
                nxt[key] = (y0, h + 1)
                cur.discard(key)
            else:
                rects.append((key[0], y0, key[1] - key[0] + 1, h))
        for key in cur:
            nxt[key] = (y, 1)
        open_ = nxt
    for key, (y0, h) in open_.items():
        rects.append((key[0], y0, key[1] - key[0] + 1, h))
    return rects


def attrs(**kw):
    return " ".join(f'{k}={quoteattr(str(v))}' for k, v in kw.items() if v is not None)


def bind(vm_path, key, converter=None):
    conv = f' converterId="{converter}"' if converter else ""
    return f'<DataBindContext sourcePathIds="{vm_path}" propertyKey="{key}"{conv}/>'


def color_shape(name, color, pixels):
    rects = merge_rects(pixels)
    body = "".join(
        f'<Rectangle x="{x * P}" y="{y * P}" width="{w * P}" height="{h * P}" originX="0" originY="0" name="r"/>'
        for x, y, w, h in rects
    )
    return f'<Shape {attrs(name=name)}>{body}<Fill name="Fill"><SolidColor colorValue="{C[color]}" name="c"/></Fill></Shape>'


def sprite(name, grid, x=0, y=0, opacity=None, binds=(), node_id=None, children_front=(), children_back=()):
    """grid: dict (px, py) -> colour key, coordinates relative to the node."""
    by_color = {}
    for p, col in grid.items():
        by_color.setdefault(col, set()).add(p)
    shapes = "".join(color_shape(f"{name}.{col}", col, px) for col, px in sorted(by_color.items()))
    b = "".join(binds)
    return (
        f'<Node {attrs(x=x * P, y=y * P, opacity=opacity, name=name, id=node_id)}>'
        f'{b}{"".join(children_front)}{shapes}{"".join(children_back)}</Node>'
    )


def node(name, children, x=0, y=0, opacity=None, binds=(), node_id=None):
    return (
        f'<Node {attrs(x=x, y=y, opacity=opacity, name=name, id=node_id)}>'
        f'{"".join(binds)}{"".join(children)}</Node>'
    )


def ascii_grid(rows, legend, ox=0, oy=0):
    g = {}
    for yy, row in enumerate(rows):
        for xx, ch in enumerate(row):
            if ch in legend:
                g[(xx + ox, yy + oy)] = legend[ch]
    return g


# ---------------------------------------------------------------- view model

VM = "0:10"
VMI = "0:11"
props = {}  # name -> (id, type, default)
_prop_order = []


def prop(name, kind="number", default=0):
    if name not in props:
        props[name] = (nid(), kind, default)
        _prop_order.append(name)
    return f"{VM}-{props[name][0]}"


# ---------------------------------------------------------------- scene geometry

WATER_TOP, WATER_BOT = 10, 207
SAND_BASE = 192
GLASS_L, GLASS_R = 3, 140
CAB_TOP = 212

rng = random.Random(7)


def sand_top(x):
    return SAND_BASE + round(2 * math.sin(x * 0.09) + 1.5 * math.sin(x * 0.23 + 1))


# -- water background with dithered band edges
def water_grid():
    bands = [(WATER_TOP, "w0"), (28, "w1"), (68, "w2"), (112, "w3"), (156, "w4")]
    g = {}
    for y in range(WATER_TOP, WATER_BOT + 1):
        idx = max(i for i, (start, _) in enumerate(bands) if y >= start)
        for x in range(GLASS_L, GLASS_R + 1):
            col = bands[idx][1]
            if idx > 0:
                start = bands[idx][0]
                if y - start < 2 and (x + y) % 2 == 0:
                    col = bands[idx - 1][1]
            g[(x, y)] = col
    return g


def rays():
    out = []
    for i, x0 in enumerate([30, 66, 104]):
        g = {}
        for y in range(WATER_TOP + 3, 165):
            if y > 120 and (y % 2):
                continue
            cx = x0 - (y - WATER_TOP) * 0.35
            for dx in range(6 - (i % 2)):
                x = round(cx) + dx
                if GLASS_L <= x <= GLASS_R and (y > 100 and (x + y) % 2 or y <= 100):
                    g[(x, y)] = "ray"
        out.append((f"Ray{i}", g))
    return out


def surface(frame):
    g = {}
    for x in range(GLASS_L, GLASS_R + 1):
        g[(x, WATER_TOP)] = "foam"
        if ((x + frame * 4) // 4) % 2 == 0:
            g[(x, WATER_TOP + 1)] = "foam"
        if ((x + frame * 4 + 2) // 6) % 3 == 0:
            g[(x, WATER_TOP + 3)] = "w0" if frame else "foam"
    return g


def ellipse_blob(cx, cy, rx, ry, cols, flat_bottom=None):
    """Shaded rock: cols = (hi, base, shade, outline)."""
    hi, base, shade, outline = cols
    inside = set()
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            if dx * dx + dy * dy <= 1 and (flat_bottom is None or y <= flat_bottom):
                inside.add((x, y))
    g = {}
    for x, y in inside:
        edge = any((x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge and outline:
            g[(x, y)] = outline
            continue
        dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
        if dx + dy < -0.9:
            g[(x, y)] = hi
        elif dx + dy > 0.55:
            g[(x, y)] = shade
        else:
            g[(x, y)] = base
    return g


def sand_grid():
    g = {}
    for x in range(GLASS_L, GLASS_R + 1):
        top = sand_top(x)
        for y in range(top, WATER_BOT + 1):
            if y == top:
                col = "sand0"
            elif y > WATER_BOT - 3:
                col = "sand2"
            else:
                col = "sand1"
            g[(x, y)] = col
    for _ in range(90):
        x = rng.randint(GLASS_L, GLASS_R)
        y = rng.randint(sand_top(x) + 2, WATER_BOT - 3)
        g[(x, y)] = rng.choice(["sand2", "sand2", "sand3"])
    return g


def back_rocks():
    g = {}
    for cx, cy, rx, ry, col in [(14, 190, 22, 40, "back1"), (40, 196, 16, 22, "back0"),
                                (128, 188, 22, 46, "back1"), (106, 198, 14, 18, "back0")]:
        for y in range(cy - ry, cy + ry):
            for x in range(cx - rx, cx + rx):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 and GLASS_L <= x <= GLASS_R and y <= WATER_BOT:
                    if (x, y) not in g or col == "back0":
                        g[(x, y)] = col
    return g


def kelp(base_x, base_y, heights, frame, cols, seed):
    """frame in -1,0,1 -> lean. cols = (light, dark)."""
    light, dark = cols
    g = {}
    for k, h in enumerate(heights):
        bx = base_x + k * 4 - len(heights) * 2
        for t in range(h):
            f = t / h
            off = round(frame * 3 * f ** 1.6 + 1.2 * math.sin(t * 0.35 + k * 2 + seed) * f)
            x, y = bx + off, base_y - t
            g[(x, y)] = light
            g[(x + 1, y)] = dark
            if t > 3 and (t + k * 3) % 7 == 0:
                side = 1 if (t // 7 + k) % 2 else -1
                lx = x + (2 if side > 0 else -1)
                g[(lx, y)] = dark
                g[(lx + side, y - 1)] = dark
    return g


CHEST = [
    "...KKKKKKKKKK...",
    "..KwwwwwwwwwwK..",
    ".KwBBBBBBBBBBwK.",
    ".KYYYYYYYYYYYYK.",
    ".KwwwwwYYwwwwwK.",
    ".KwwwwYKKYwwwwK.",
    ".KwwwwwYYwwwwwK.",
    ".KwwwwwwwwwwwwK.",
    ".KYYYYYYYYYYYYK.",
    ".KKKKKKKKKKKKKK.",
]
CHEST_LEG = {"K": "ck", "w": "cw", "B": "cb", "Y": "cy"}
CHEST_X, CHEST_Y = 92, 192

BUBBLE = [".W.", "W.W", ".W."]

# ---------------------------------------------------------------- jelly


def bell(w, h, pal):
    O, B, S, Hh, G = (pal + k for k in "OBSHG")
    inside = set()
    half = w / 2
    for y in range(-h, 0):
        for x in range(-w // 2, w // 2):
            px, py = x + 0.5, y + 0.5
            if (px / half) ** 2 + (py / h) ** 2 <= 1:
                inside.add((x, y))
    # hollow subumbrella: the rim hangs below the middle of the underside
    for x in range(-w // 2 + 3, w // 2 - 3):
        inside.discard((x, -1))
    g = {}
    for x, y in inside:
        edge = any((x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            g[(x, y)] = O
        elif (x + 1, y) not in inside or (x, y + 1) not in inside or (x + 2, y) not in inside and x > 0:
            g[(x, y)] = S
        else:
            g[(x, y)] = B
    # highlight
    hx, hy = -round(w * 0.24), -round(h * 0.7)
    for p in [(hx, hy), (hx + 1, hy - 1), (hx + 2, hy - 1), (hx, hy + 1), (hx + 4, hy - 2)]:
        if g.get(p) in (B, S):
            g[p] = Hh
    # gonads: three little rings
    gy = -round(h * 0.6)
    for gx in (-round(w * 0.24), 0, round(w * 0.24)):
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            p = (gx + dx - (1 if gx == 0 else 0) * 0 , gy + dy)
            if g.get(p) in (B, S, Hh):
                g[p] = G
    return g


BELL_FRAMES = [(26, 14), (24, 15), (20, 17), (23, 16)]
TENTS = [(-9, 15, 0.0), (-6, 12, 1.7), (5, 12, 3.1), (8, 15, 4.4)]
ARMS = [(-3, 10, 0.6), (1, 11, 2.4)]


def tentacles(frame):
    ph = frame / 4 * 2 * math.pi
    g = {}
    for x0, length, k in TENTS:
        for t in range(length):
            amp = min(1, t / 4)
            off = round(1.7 * math.sin(ph + t * 0.45 + k) * amp)
            g[(x0 + off, t)] = "tent"
    for x0, length, k in ARMS:
        for t in range(length):
            amp = min(1, t / 3)
            off = round(1.2 * math.sin(ph + t * 0.5 + k) * amp)
            g[(x0 + off, t)] = "arm"
            g[(x0 + off + 1, t)] = "arm"
            if t % 3 == 1:
                side = -1 if (t // 3 + int(k)) % 2 else 2
                g[(x0 + off + side, t)] = "armF"
    return g


def glow_grid():
    g = {}
    for y in range(-26, 22):
        for x in range(-22, 22):
            d = ((x + 0.5) / 21) ** 2 + ((y + 0.5 + 4) / 22) ** 2
            if d > 1:
                continue
            outer = d > 0.6 and (x + y) % 2 == 0 and (x + 2 * y) % 4 != 0
            inner = d > 0.3 and x % 3 == 0 and y % 3 == 0
            if outer or inner:
                g[(x, y)] = "glow"
    return g




def ring(r):
    g = {}
    for a in range(0, 360, 3):
        x = round(r * math.cos(math.radians(a)))
        y = round(r * math.sin(math.radians(a)))
        g[(x, y)] = "ripple"
    return g


# ---------------------------------------------------------------- UI art

ICON_FOOD = [
    "....OOOOOO....",
    "...ORRRRRRO...",
    "...OOOOOOOO...",
    "...OWWWWWWO...",
    "...OWYYYYWO...",
    "...OWYFFYWO...",
    "...OWYFFYWO...",
    "...OWYYYYWO...",
    "...OWWWWWWO...",
    "...OOOOOOOO...",
    "..............",
    ".F..F...F.....",
    "...F...F..F...",
]
ICON_FOOD_LEG = {"O": "ink", "R": "red", "W": "white", "Y": "yel", "F": "f0"}

ICON_CLEAN = [
    ".........C....",
    "........C.C...",
    ".........C....",
    "..C...........",
    ".C.C..........",
    "..C...........",
    "..OOOOOOOOOO..",
    ".OYYYYYYYYYYO.",
    ".OYDYYYYDYYYO.",
    ".OYYYYDYYYYYO.",
    ".OYYDYYYYYDYO.",
    ".OGGGGGGGGGGO.",
    "..OOOOOOOOOO..",
]
ICON_CLEAN_LEG = {"O": "ink", "Y": "yel", "D": "yelDk", "G": "green", "C": "aqua"}

ICON_SUN = [
    "......Y.......",
    "..Y...Y...Y...",
    "...Y.....Y....",
    ".....YYY......",
    "....YYYYY.....",
    "YY.YYYyYYY.YY.",
    "....YYYYY.....",
    ".....YYY......",
    "...Y.....Y....",
    "..Y...Y...Y...",
    "......Y.......",
]
ICON_SUN_LEG = {"Y": "sun", "y": "yel"}

ICON_MOON = [
    ".....OOOO.....",
    "...OOMMMO.....",
    "..OMMMMO......",
    "..OMMMO.......",
    ".OMMMMO.......",
    ".OMMMMO.......",
    ".OMMMMMO......",
    "..OMMMMMO..O..",
    "..OMMMMMMOOMO.",
    "...OOMMMMMMO..",
    ".....OOOOOO...",
]
ICON_MOON_LEG = {"O": "moonO", "M": "moon"}

MINI_FOOD = [
    "..OO...",
    ".OYFO..",
    ".OFFFO.",
    "..OFFO.",
    "...OO..",
]
MINI_DROP = [
    "...C...",
    "..CCC..",
    ".CCCCC.",
    ".CCWCC.",
    ".CCCCC.",
    "..CCC..",
]
MINI_HEART = [
    ".RR.RR.",
    "RRRRRRR",
    "RRRRRRR",
    ".RRRRR.",
    "..RRR..",
    "...R...",
]

SPONGE = [
    ".OOOOOOOOOO.",
    "OYYYYYYYYYYO",
    "OYDYYYYDYYYO",
    "OYYYYDYYYYYO",
    "OYYDYYYYYDYO",
    "OGGGGGGGGGGO",
    "OGGGGGGGGGGO",
    ".OOOOOOOOOO.",
]


def button_base():
    w, h = 26, 22
    g = {}
    for y in range(h):
        for x in range(w):
            corner = (x in (0, w - 1) and y in (0, h - 1))
            if corner:
                continue
            edge = x in (0, w - 1) or y in (0, h - 1) or (x in (1, w - 2) and y in (1, h - 2))
            if edge and not (x in (1, w - 2) and y in (1, h - 2) and x not in (0, w - 1) and y not in (0, h - 1)):
                g[(x, y)] = "ink"
            elif y >= h - 4:
                g[(x, y)] = "btnLo"
            elif y <= 2 or x <= 1:
                g[(x, y)] = "btnHi"
            else:
                g[(x, y)] = "btn"
    # round the corners one more pixel
    for x, y in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]:
        g[(x, y)] = "ink"
    return g


# ---------------------------------------------------------------- animation helpers

anims = []  # (anim_xml, anim_id)


def hold_track(obj_id, key, frames_values):
    kfs = "".join(
        f'<KeyFrameDouble value="{v}" frame="{f}" interpolationType="hold"/>' for f, v in frames_values
    )
    return f'<KeyedObject objectId="{obj_id}"><KeyedProperty propertyKey="{key}">{kfs}</KeyedProperty></KeyedObject>'


def add_anim(name, duration, tracks):
    aid = nid()
    anims.append((f'<LinearAnimation loopValue="loop" duration="{duration}" name="{name}" id="{aid}">{"".join(tracks)}</LinearAnimation>', aid, name))
    return aid


def frame_cycle(name, frame_ids, seq, step):
    """Flip opacity through frame_ids following seq (indices), `step` frames each."""
    dur = len(seq) * step
    tracks = []
    for i, fid in enumerate(frame_ids):
        kv = [(n * step, 1 if s == i else 0) for n, s in enumerate(seq)]
        tracks.append(hold_track(fid, 18, kv))
    add_anim(name, dur, tracks)


# ---------------------------------------------------------------- build the scene (back to front, reversed at the end)

back_to_front = []

# water
back_to_front.append(sprite("Water", water_grid()))

# surface (2 frames)
surf_ids = [nid(), nid()]
back_to_front.append(node("Surface", [sprite(f"Surface{f}", surface(f), node_id=surf_ids[f], opacity=1 - f) for f in (0, 1)]))
frame_cycle("Surface", surf_ids, [0, 1], 36)

# light rays, parent fades with daylight
ray_nodes, ray_ids = [], []
for name, g in rays():
    rid = nid()
    ray_ids.append(rid)
    ray_nodes.append(sprite(name, g, node_id=rid))
back_to_front.append(node("Rays", ray_nodes, binds=[bind(prop("daylight", default=1), 18)]))
add_anim("Rays", 360, [
    hold_track(ray_ids[0], 18, [(0, 1), (60, 0.7), (120, 0.45), (200, 0.7), (280, 1)]),
    hold_track(ray_ids[1], 18, [(0, 0.5), (90, 0.8), (170, 1), (250, 0.7), (320, 0.5)]),
    hold_track(ray_ids[2], 18, [(0, 0.8), (70, 1), (150, 0.6), (230, 0.4), (300, 0.7)]),
])

# back rocks + back kelp
back_to_front.append(sprite("BackRocks", back_rocks()))


def plant(name, base_x, base_y, heights, cols, seed, step):
    ids = [nid() for _ in range(3)]
    frames = [sprite(f"{name}F{i}", kelp(base_x, base_y, heights, lean, cols, seed), node_id=ids[i], opacity=1 if i == 1 else 0)
              for i, lean in enumerate((-1, 0, 1))]
    frame_cycle(name, ids, [0, 1, 2, 1], step)
    return node(name, frames)


back_to_front.append(plant("KelpBackL", 22, 196, [58, 74, 50], ("gb0", "gb1"), 0.3, 34))
back_to_front.append(plant("KelpBackR", 120, 196, [64, 46], ("gb0", "gb1"), 1.9, 40))

# sand, rocks, chest
back_to_front.append(sprite("Sand", sand_grid()))
rock_cols = ("rock0", "rock1", "rock2", "rock3")
rocks = {}
rocks.update(ellipse_blob(28, 196, 14, 10, rock_cols, flat_bottom=201))
rocks.update(ellipse_blob(46, 200, 6, 4, rock_cols, flat_bottom=202))
rocks.update(ellipse_blob(126, 199, 9, 6, rock_cols, flat_bottom=203))
back_to_front.append(sprite("Rocks", rocks))
back_to_front.append(sprite("Chest", ascii_grid(CHEST, CHEST_LEG), x=CHEST_X, y=CHEST_Y))

# front kelp
back_to_front.append(plant("KelpFrontL", 56, 202, [40, 30], ("g0", "g1"), 2.7, 28))
back_to_front.append(plant("KelpFrontR", 134, 205, [34, 46, 26], ("g0", "g2"), 4.1, 31))

# bubbles from the chest, each on its own loop
bubble_grid = ascii_grid(BUBBLE, {"W": "foam"}, -1, -1)
for i, (dur, x0) in enumerate([(300, 99), (372, 101), (444, 98), (520, 100)]):
    bid = nid()
    back_to_front.append(sprite(f"Bubble{i}", bubble_grid, x=x0, y=CHEST_Y, node_id=bid, opacity=0))
    start_y, end_y = CHEST_Y - 1, WATER_TOP + 3
    rise = start_y - end_y
    rise_frames = 230 + i * 18
    ys, xs, ops = [], [], [(0, 1), (rise_frames, 0)]
    for s in range(rise + 1):
        f = round(s * rise_frames / rise)
        ys.append((f, (start_y - s) * P))
        xs.append((f, (x0 + round(math.sin(s * 0.35 + i) * 1.2)) * P))
    add_anim(f"Bubble{i}", dur, [hold_track(bid, 14, ys), hold_track(bid, 13, xs), hold_track(bid, 18, ops)])

# night overlay over the water (jelly and food draw above it)
back_to_front.append(
    node("Night", [f'<Shape name="NightRect"><Rectangle x="{GLASS_L * P}" y="{WATER_TOP * P}" width="{(GLASS_R - GLASS_L + 1) * P}" height="{(WATER_BOT - WATER_TOP + 1) * P}" originX="0" originY="0" name="r"/><Fill name="Fill"><SolidColor colorValue="{C["night"]}" name="c"/></Fill></Shape>'],
         opacity=0, binds=[bind(prop("nightShade"), 18)])
)

# food pellets
FOOD_N = 10
food_grid = {(0, 0): "f1", (1, 0): "f0", (0, 1): "f0", (1, 1): "f0"}
for i in range(FOOD_N):
    back_to_front.append(sprite(f"Food{i}", food_grid, opacity=0,
                                binds=[bind(prop(f"food{i}x"), 13), bind(prop(f"food{i}y"), 14), bind(prop(f"food{i}o"), 18)]))

# the jelly
JX, JY = 72, 110
jelly_children_back_to_front = []
jelly_children_back_to_front.append(sprite("Glow", glow_grid(), opacity=0, binds=[bind(prop("glow"), 18)]))
tent_frames = [sprite(f"Tent{f}", tentacles(f), opacity=1 if f == 0 else 0, binds=[bind(prop(f"tf{f}", default=1 if f == 0 else 0), 18)]) for f in range(4)]
jelly_children_back_to_front.append(node("Tentacles", tent_frames))
for pal, nm, pname in (("j", "BellHealthy", "healthy"), ("p", "BellPale", "pale"), ("r", "BellFlush", "flush")):
    frames = [sprite(f"{nm}{f}", bell(w, h, pal), opacity=1 if f == 0 else 0, binds=[bind(prop(f"bf{f}", default=1 if f == 0 else 0), 18)])
              for f, (w, h) in enumerate(BELL_FRAMES)]
    jelly_children_back_to_front.append(node(nm, frames, opacity=1 if pal == "j" else 0, binds=[bind(prop(pname, default=1 if pal == "j" else 0), 18)]))
back_to_front.append(node("Jelly", list(reversed(jelly_children_back_to_front)), x=JX * P, y=JY * P,
                          binds=[bind(prop("jx", default=JX * P), 13), bind(prop("jy", default=JY * P), 14)]))

# tap ripple
ripple_frames = [sprite(f"Ripple{i}", ring(r), opacity=0, binds=[bind(prop(f"rf{i}"), 18)]) for i, r in enumerate((3, 6, 9))]
back_to_front.append(node("Ripple", ripple_frames, binds=[bind(prop("rx"), 13), bind(prop("ry"), 14)]))

# murk + algae
back_to_front.append(
    node("Murk", [f'<Shape name="MurkRect"><Rectangle x="{GLASS_L * P}" y="{WATER_TOP * P}" width="{(GLASS_R - GLASS_L + 1) * P}" height="{(WATER_BOT - WATER_TOP + 1) * P}" originX="0" originY="0" name="r"/><Fill name="Fill"><SolidColor colorValue="{C["murk"]}" name="c"/></Fill></Shape>'],
         opacity=0, binds=[bind(prop("murkShade"), 18)])
)
for lvl in range(3):
    g = {}
    r2 = random.Random(100 + lvl)
    for _ in range(5 + lvl * 3):
        side = r2.choice([0, 1])
        cx = r2.randint(GLASS_L + 1, GLASS_L + 9) if side == 0 else r2.randint(GLASS_R - 9, GLASS_R - 1)
        cy = r2.randint(WATER_TOP + 14, SAND_BASE - 6)
        for _ in range(r2.randint(5, 10)):
            g[(cx + r2.randint(-2, 2), cy + r2.randint(-2, 2))] = "algae"
    back_to_front.append(sprite(f"Algae{lvl}", g, opacity=0, binds=[bind(prop(f"algae{lvl}"), 18)]))

# cleaning sponge sweep
sponge = ascii_grid(SPONGE, {"O": "ink", "Y": "yel", "D": "yelDk", "G": "green"}, -6, -4)
for sx, sy in [(-10, -3), (-14, 2), (-19, -1), (-24, 3)]:
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        sponge[(sx + dx, sy + dy)] = "white"
back_to_front.append(sprite("Sponge", sponge, y=100, opacity=0, binds=[bind(prop("wipeX", default=-100), 13), bind(prop("wipeO"), 18)]))

# glass highlights
glass = {}
for t in range(16):
    glass[(8 + t // 2, 16 + t)] = "ray"
for t in range(8):
    glass[(12 + t // 2, 16 + t)] = "ray"
back_to_front.append(sprite("GlassShine", glass))

# tank frame + hood
frame = {}
for y in range(0, CAB_TOP):
    for x in list(range(0, GLASS_L)) + list(range(GLASS_R + 1, LW)):
        frame[(x, y)] = "frameHi" if x in (GLASS_L - 1, GLASS_R + 1) else "frame"
for y in range(0, WATER_TOP):
    for x in range(GLASS_L, GLASS_R + 1):
        frame[(x, y)] = "frameHi" if y == 0 else "frame"
for y in range(WATER_BOT + 1, CAB_TOP):
    for x in range(GLASS_L, GLASS_R + 1):
        frame[(x, y)] = "frameHi" if y == WATER_BOT + 1 else "frame"
back_to_front.append(sprite("Frame", frame))
lamp = {(x, y): "lamp" for x in range(18, 126) for y in (WATER_TOP - 2, WATER_TOP - 1)}
back_to_front.append(sprite("LampStrip", lamp, binds=[bind(prop("daylight", default=1), 18)]))

# cabinet
cab = {}
for y in range(CAB_TOP, LH):
    for x in range(LW):
        if y in (CAB_TOP, CAB_TOP + 1):
            cab[(x, y)] = "woodHi"
        elif (y - CAB_TOP) % 11 == 0 or (x * 7 + (y - CAB_TOP) // 11 * 31) % 53 == 0:
            cab[(x, y)] = "woodDk"
        else:
            cab[(x, y)] = "wood"
for y in range(215, 226):
    for x in range(6, 138):
        cab[(x, y)] = "ink" if y in (215, 225) or x in (6, 137) else "inset"
back_to_front.append(sprite("Cabinet", cab))

# meters
BAR_W = 30
for i, (mini, leg, pname, col) in enumerate([
    (MINI_FOOD, {"O": "ink", "Y": "f1", "F": "f0"}, "barFood", "barFood"),
    (MINI_DROP, {"C": "aqua", "W": "white"}, "barWater", "barWater"),
    (MINI_HEART, {"R": "heart"}, "barMood", "heart"),
]):
    gx = 9 + i * 43
    back_to_front.append(sprite(f"MeterIcon{i}", ascii_grid(mini, leg), x=gx, y=217))
    track = {(x, y): "track" for x in range(gx + 9, gx + 9 + BAR_W) for y in range(218, 223)}
    back_to_front.append(sprite(f"MeterTrack{i}", track))
    back_to_front.append(
        f'<Shape x="{(gx + 9) * P}" y="{218 * P}" name="MeterFill{i}"><Rectangle width="{BAR_W * P}" height="{5 * P}" originX="0" originY="0" name="r">'
        f'{bind(prop(pname, default=BAR_W * P), 20)}</Rectangle><Fill name="Fill"><SolidColor colorValue="{C[col]}" name="c"/></Fill></Shape>'
    )

# buttons
BTN_X = [23, 59, 95]
BTN_Y = 229
btn_hit_ids = []
for i, (label, icon_layers) in enumerate([
    ("Feed", [("Icon", ICON_FOOD, ICON_FOOD_LEG, None)]),
    ("Clean", [("Icon", ICON_CLEAN, ICON_CLEAN_LEG, None)]),
    ("Lamp", [("Sun", ICON_SUN, ICON_SUN_LEG, "sunO"), ("Moon", ICON_MOON, ICON_MOON_LEG, "moonO")]),
]):
    inner = [sprite(f"{label}Base", button_base())]
    for nm, rows, leg, op in icon_layers:
        oy = 4 if len(rows) >= 13 else 5
        inner.append(sprite(f"{label}{nm}", ascii_grid(rows, leg), x=6, y=oy,
                            opacity=None if op is None else (1 if op == "sunO" else 0),
                            binds=[] if op is None else [bind(prop(op, default=1 if op == "sunO" else 0), 18)]))
    # shadow under the button (stays put when pressed)
    shadow = {(x, 22): "woodDk" for x in range(1, 25)} | {(x, 23): "woodDk" for x in range(2, 24)}
    press = node(f"{label}Press", list(reversed(inner)), binds=[bind(prop(f"b{i}y"), 14)])
    hid = nid()
    btn_hit_ids.append(hid)
    hit = (f'<Shape name="{label}Hit" id="{hid}"><Rectangle width="{26 * P}" height="{24 * P}" originX="0" originY="0" name="r"/>'
           f'<Fill name="Fill"><SolidColor colorValue="01FFFFFF" name="c"/></Fill></Shape>')
    back_to_front.append(node(f"{label}Button", [hit, press, sprite(f"{label}Shadow", shadow)], x=BTN_X[i] * P, y=BTN_Y * P))

# triggers
for t in ("feed", "clean", "lamp"):
    prop(t, kind="trigger")

# ---------------------------------------------------------------- assemble

SM, AB, STYLE = nid(), nid(), nid()

layers = []
for xml, aid, name in anims:
    sid = nid()
    layers.append(
        f'<StateMachineLayer name="{name}" id="{nid()}"><AnyState x="0" y="-100"/><ExitState x="200" y="-100"/>'
        f'<EntryState><StateTransition stateToId="{sid}"/></EntryState><AnimationState x="100" y="100" animationId="{aid}" id="{sid}"/></StateMachineLayer>'
    )

listeners = []
for hid, t in zip(btn_hit_ids, ("feed", "clean", "lamp")):
    listeners.append(
        f'<StateMachineListenerSingle targetId="{hid}" listenerTypeValue="click" name="{t}">'
        f'<ListenerViewModelChange><BindablePropertyTrigger propertyValue="1">'
        f'<DataBindContext sourcePathIds="{prop(t)}" propertyKey="686" direction="true"/>'
        f'</BindablePropertyTrigger></ListenerViewModelChange></StateMachineListenerSingle>'
    )

sm = f'<StateMachine name="Tank" id="{SM}">{"".join(listeners)}{"".join(layers)}</StateMachine>'

vm_props, vm_vals = [], []
for name in _prop_order:
    pid, kind, default = props[name]
    if kind == "trigger":
        vm_props.append(f'<ViewModelPropertyTrigger name="{name}" id="{pid}"/>')
        vm_vals.append(f'<ViewModelInstanceTrigger viewModelPropertyId="{pid}"/>')
    else:
        vm_props.append(f'<ViewModelPropertyNumber name="{name}" id="{pid}"/>')
        vm_vals.append(f'<ViewModelInstanceNumber propertyValue="{default}" viewModelPropertyId="{pid}"/>')
vm = (f'<ViewModel defaultInstanceId="{VMI}" name="Tank" id="{VM}">{"".join(vm_props)}'
      f'<ViewModelInstance exports="true" name="Default" id="{VMI}">{"".join(vm_vals)}</ViewModelInstance></ViewModel>')

scene = "\n".join(reversed(back_to_front))  # first declared paints on top
anim_xml = "\n".join(a for a, _, _ in anims)
doc = f'''<Rive version="1" kind="fragment">
<Artboard defaultStateMachineId="{SM}" viewModelId="{VM}" viewModelInstanceId="{VMI}" styleId="{STYLE}" width="{W}" height="{H}" name="Tank" id="{AB}">
<LayoutComponentStyle name="Tank Style" id="{STYLE}"/>
<Fill name="Background"><SolidColor colorValue="{C["frame"]}" name="c"/></Fill>
{scene}
{sm}
{anim_xml}
</Artboard>
{vm}
</Rive>
'''
OUT.write_text(doc)

# host contract: property names + constants
import json
contract = {
    "P": P, "LW": LW, "LH": LH, "W": W, "H": H,
    "waterTop": WATER_TOP, "waterBot": WATER_BOT, "glassL": GLASS_L, "glassR": GLASS_R,
    "sandTop": [sand_top(x) for x in range(LW)], "cabTop": CAB_TOP,
    "foodN": FOOD_N, "barW": BAR_W, "buttons": [{"x": x, "y": BTN_Y, "w": 26, "h": 24} for x in BTN_X],
    "bellFrames": BELL_FRAMES, "props": _prop_order,
}
(OUT.parent.parent / "src" / "contract.json").write_text(json.dumps(contract, indent=1))
print(f"wrote {OUT} ({len(doc)//1024} KB), {len(_prop_order)} props, {len(anims)} animations")
