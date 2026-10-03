#!/usr/bin/env python3
"""Generate rive/tank.rml + rive/img/*.png: the aquarium in an HD pixel-art style
(after Dave the Diver): hue-shifted pixel sprites over smooth gradient lighting.

Sprites are drawn here pixel by pixel and written as small PNGs at logical
resolution; the .riv shows them at P=3 with nearest-neighbour sampling. Light,
fog, glow, vignette and night are smooth Rive gradients on top.

Logical screen 240x428, artboard 720x1284. Host contract -> src/contract.json.
The 8-bit version lives on in tools/gen_8bit.py.
"""
import base64
import hashlib
import json
import math
import random
import struct
import zlib
from pathlib import Path

P = 3
LW, LH = 240, 428
W, H = LW * P, LH * P

ROOT = Path(__file__).resolve().parent.parent
RIVE = ROOT / "rive"
IMG = RIVE / "img"
IMG.mkdir(parents=True, exist_ok=True)
for old in IMG.glob("*.png"):
    old.unlink()

# ---------------------------------------------------------------- ids

_next = 100


def nid():
    global _next
    _next += 1
    return f"0:{_next}"


# ---------------------------------------------------------------- colour


def hx(s, a=255):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def argb(c):
    r, g, b, a = c
    return f"{a:02X}{r:02X}{g:02X}{b:02X}"


def mix(c1, c2, t):
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))


def ramp(*hexes, a=255):
    return [hx(h, a) for h in hexes]


BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bay(x, y):
    return (BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5


# hue-shifted ramps, dark -> light
R_ROCK = ramp("1a1f3d", "28305c", "3a4a7c", "55709c", "7b98bd", "a8c2dc")
R_ROCK_MID = ramp("173a6a", "1f4b7f", "2a5f94", "3a77a8")
R_FAR = ramp("1d5f98", "2469a2", "2c76ad")
R_CORAL = ramp("4a1b3c", "7a2a52", "b23e5f", "df5f62", "f6926c", "ffc98a")
R_FAN = ramp("2a1848", "472876", "6b40a3", "9469cc", "bf9eea")
R_BRAIN = ramp("3a2a1e", "6a4a2a", "a0703a", "cfa050", "ecd07a")
R_KELP = ramp("0d2c2c", "13473a", "1d6845", "318e4f", "5cb659", "a3da69")
R_KELP_MID = ramp("123d50", "17505a", "1f6560", "26756a", "2d8270")
R_SAND = ramp("6b4a3a", "9a6e4f", "c99a68", "e3c088", "f4ddaa", "fff4d4")
R_WOOD = ramp("2b1712", "45261a", "693c24", "8e5632", "b47945", "d8a464")
R_GOLD = ramp("6b3a12", "a8641a", "e09a28", "ffcf4a", "fff2a0")
R_STAR = ramp("6a1e24", "b23a2e", "ec6a3a", "ffa45a")
R_CREAM = ramp("4a2c1f", "a78560", "d9bf94", "f1e2c4", "fffaf0")

JELLY = {
    "j": {"out": hx("8a3a8c", 230), "d": hx("c860b4", 185), "m": hx("f29ad6", 185), "l": hx("ffc8ec", 195),
          "h": hx("fff4fb", 235), "rim": hx("ffd6f2", 215), "cav": hx("9a4aa6", 95), "g": hx("ff78c4", 215),
          "gd": hx("b8418e", 220), "can": hx("ffe2f6", 70)},
    "p": {"out": hx("5f6f8f", 230), "d": hx("8796b4", 185), "m": hx("b2c0d6", 185), "l": hx("d8e2ee", 195),
          "h": hx("ffffff", 235), "rim": hx("e2eaf4", 215), "cav": hx("6d7a96", 95), "g": hx("9fb0c8", 215),
          "gd": hx("74839e", 220), "can": hx("f0f4fa", 70)},
    "r": {"out": hx("8a245f", 235), "d": hx("d0458f", 200), "m": hx("f56aae", 200), "l": hx("ff9ccc", 210),
          "h": hx("fff0f7", 240), "rim": hx("ffc0e0", 225), "cav": hx("a8306f", 110), "g": hx("ff3f9a", 230),
          "gd": hx("b01f6a", 230), "can": hx("ffd0e8", 80)},
    # v7 morph: the golden moon, a warm gold bell with an amber clover
    "jm": {"out": hx("8a4206", 235), "d": hx("e08816", 205), "m": hx("f8ae2e", 205), "l": hx("ffd062", 210),
           "h": hx("fff6d8", 240), "rim": hx("ffdc8e", 222), "cav": hx("b0600e", 105), "g": hx("f0700a", 225),
           "gd": hx("a04406", 230), "can": hx("fff0b8", 75)},
}

# ---------------------------------------------------------------- pixel canvas + png


class Px:
    def __init__(self):
        self.d = {}

    def put(self, x, y, c):
        if c[3] == 0:
            return
        self.d[(int(x), int(y))] = c

    def over(self, x, y, c):
        x, y = int(x), int(y)
        b = self.d.get((x, y))
        if b is None:
            self.d[(x, y)] = c
            return
        a = c[3] / 255
        ba = b[3] / 255
        oa = a + ba * (1 - a)
        rgb = tuple(round((c[i] * a + b[i] * ba * (1 - a)) / oa) for i in range(3))
        self.d[(x, y)] = (*rgb, round(oa * 255))

    def get(self, x, y):
        return self.d.get((int(x), int(y)))

    def has(self, x, y):
        return (int(x), int(y)) in self.d

    def bbox(self):
        xs = [p[0] for p in self.d]
        ys = [p[1] for p in self.d]
        return min(xs), min(ys), max(xs), max(ys)


def png_bytes(w, h, pixels):
    """Encode a sprite as PNG. Pixel art rarely has more than 256 colours, so it goes out as an indexed
    PNG (PLTE + tRNS, 1/2/4/8 bits) when it can; that is ~15% smaller than RGBA. Same pixels either way."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    clear = (0, 0, 0, 0)
    grid = [[pixels.get((x, y), clear) for x in range(w)] for y in range(h)]
    rgba = zlib.compress(b"".join(b"\0" + b"".join(bytes(c) for c in row) for row in grid), 9)
    best = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", rgba) + chunk(b"IEND", b""))
    cols = sorted({c for row in grid for c in row}, key=lambda c: (c[3], c))  # translucent first: short tRNS
    if len(cols) <= 256:
        idx = {c: i for i, c in enumerate(cols)}
        bits = 1 if len(cols) <= 2 else 2 if len(cols) <= 4 else 4 if len(cols) <= 16 else 8
        per = 8 // bits
        raw = bytearray()
        for row in grid:
            raw.append(0)
            vals = [idx[c] for c in row]
            for i in range(0, w, per):
                b = 0
                for j in range(per):
                    b = (b << bits) | (vals[i + j] if i + j < w else 0)
                raw.append(b)
        trns = bytes(c[3] for c in cols).rstrip(b"\xff")
        pal_png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, bits, 3, 0, 0, 0))
                   + chunk(b"PLTE", b"".join(bytes(c[:3]) for c in cols)) + (chunk(b"tRNS", trns) if trns else b"")
                   + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
        if len(pal_png) < len(best):
            best = pal_png
    return best


def write_png(path, w, h, pixels):
    path.write_bytes(png_bytes(w, h, pixels))


assets = []
sprites = {}  # sprite name -> (assetId, x0, y0, x1, y1): one ImageAsset per sprite, shared by every <Image> of it


def sprite(name, px):
    """Register sprite `name` once (px may be a Px or a callable returning one) and
    return (assetId, bbox). Later calls with the same name reuse the asset."""
    if name not in sprites:
        if callable(px):
            px = px()
        if not px.d:
            raise ValueError(f"empty sprite {name}")
        x0, y0, x1, y1 = px.bbox()
        w, h = x1 - x0 + 1, y1 - y0 + 1
        write_png(IMG / f"{name}.png", w, h, {(x - x0, y - y0): c for (x, y), c in px.d.items()})
        aid = nid()
        ref = ' exportTypeValue="referenced"' if asset_group(name) else ""  # loaded by the host (see asset_group)
        assets.append(f'<ImageAsset file="img/{name}.png" samplerFilter="nearest" width="{w}" height="{h}"{ref} name="{name}" id="{aid}"/>')
        sprites[name] = (aid, x0, y0, x1, y1)
    return sprites[name]


# ---- asset groups: art the host loads only when it is needed (src/spritegroups.ts). A grouped sprite is a
# referenced ImageAsset: the .riv keeps the record, its PNG goes into public/sprites/<group>.json with the rest of
# its group, and the host fetches that file when a jelly of the species (or the event) shows up. Everything else
# (tank, decor, shop, helpers, visitors) stays embedded. A new species or event needs nothing more than a line here.
EVENT_GROUPS = {"hw_": "ev-halloween"}  # sprite-name prefix -> group


def asset_group(name):
    """The group sprite `name` loads with, or None to embed it in the .riv."""
    for prefix, group in EVENT_GROUPS.items():
        if name.startswith(prefix):
            return group
    if name.startswith(("Bell", "Tent")):  # the v1 moon adult kept its bare names (sprite_name)
        return "sp-moon"
    for sp in SPECIES:  # every other jelly sprite is <Species><Stage><Part> (sprite_name)
        if name.startswith(sp.capitalize()):
            return f"sp-{sp}"
    return None


def image(name, px, lx=0, ly=0, opacity=None, binds=(), node_id=None, blend=None, node_name=None):
    """Return a Node at logical (lx, ly) holding an <Image> of sprite `name`, scaled
    by P with nearest sampling. The PNG is cropped to the sprite's bounds."""
    aid, x0, y0, _, _ = sprite(name, px)
    bm = f' blendModeValue="{blend}"' if blend else ""
    img = (f'<Image x="{x0 * P}" y="{y0 * P}" scaleX="{P}" scaleY="{P}" originX="0" originY="0"'
           f' samplerFilter="nearest" assetId="{aid}"{bm} name="{name}.img"/>')
    return node(node_name or name, [img], x=lx * P, y=ly * P, opacity=opacity, binds=binds, node_id=node_id)


def frame_image(name, px, opacity, binds=(), blend=None):
    """A bare, unnamed <Image> of sprite `name`, opacity-bound: for one-hot frame sets with thousands of members
    (the jelly tentacle poses and bodies), where every attribute is paid for ~14,000 times. So it is placed in
    LOGICAL units inside a parent scaled by P (see SCALED), centred (the default origin) and sampled as its asset
    says (nearest): no scale, origin or sampler attributes."""
    aid, x0, y0, x1, y1 = sprite(name, px)
    bm = f' blendModeValue="{blend}"' if blend else ""
    op = f' opacity="{opacity}"' if opacity != 1 else ""
    cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
    return f'<Image x="{cx:g}" y="{cy:g}"{op} assetId="{aid}"{bm}>{"".join(binds)}</Image>'


SCALED = dict(scaleX=P, scaleY=P)  # the parent of frame_image()s


# ---------------------------------------------------------------- rml helpers


def attrs(**kw):
    return " ".join(f'{k}="{v}"' for k, v in kw.items() if v is not None)


def bind(vm_path, key, conv=None):
    cv = f' converterId="{conv}"' if conv else ""
    return f'<DataBindContext sourcePathIds="{vm_path}" propertyKey="{key}"{cv}/>'


def node(name, children, x=0, y=0, opacity=None, binds=(), node_id=None, scaleX=None, scaleY=None):
    return (f'<Node {attrs(x=x, y=y, scaleX=scaleX, scaleY=scaleY, opacity=opacity, name=name, id=node_id)}>'
            f'{"".join(binds)}{"".join(children)}</Node>')


def lin_grad(x0, y0, x1, y1, stops):
    s = "".join(f'<GradientStop colorValue="{argb(c)}" position="{p}"/>' for p, c in stops)
    return f'<LinearGradient startX="{x0}" startY="{y0}" endX="{x1}" endY="{y1}" name="g">{s}</LinearGradient>'


def rad_grad(cx, cy, r, stops):
    s = "".join(f'<GradientStop colorValue="{argb(c)}" position="{p}"/>' for p, c in stops)
    return f'<RadialGradient startX="{cx}" startY="{cy}" endX="{cx + r}" endY="{cy}" name="g">{s}</RadialGradient>'


def solid(c):
    return f'<SolidColor colorValue="{argb(c)}" name="c"/>'


def rect_shape(name, x, y, w, h, paint, opacity=None, binds=(), blend=None, sid=None, rect_binds=""):
    bm = f' blendModeValue="{blend}"' if blend else ""
    return (f'<Shape {attrs(x=x, y=y, opacity=opacity, name=name, id=sid)}{bm}>{"".join(binds)}'
            f'<Rectangle width="{w}" height="{h}" originX="0" originY="0" name="r">{rect_binds}</Rectangle>'
            f'<Fill name="f">{paint}</Fill></Shape>')


def ellipse_shape(name, x, y, w, h, paint, opacity=None, binds=(), blend=None, sid=None, stroke=None):
    bm = f' blendModeValue="{blend}"' if blend else ""
    paints = (f'<Fill name="f">{paint}</Fill>' if paint else "") + (stroke or "")
    return (f'<Shape {attrs(x=x, y=y, opacity=opacity, name=name, id=sid)}{bm}>{"".join(binds)}'
            f'<Ellipse width="{w}" height="{h}" name="e"/>{paints}</Shape>')


def poly_shape(name, pts, paint, blend=None, sid=None, opacity=None):
    bm = f' blendModeValue="{blend}"' if blend else ""
    verts = "".join(f'<StraightVertex x="{x}" y="{y}"/>' for x, y in pts)
    return (f'<Shape {attrs(opacity=opacity, name=name, id=sid)}{bm}><PointsPath isClosed="true" name="p">{verts}</PointsPath>'
            f'<Fill name="f">{paint}</Fill></Shape>')


# ---------------------------------------------------------------- view model

VM, VMI = "0:10", "0:11"
props = {}
_order = []


def prop(name, kind="number", default=0):
    if name not in props:
        props[name] = (nid(), kind, default)
        _order.append(name)
    return f"{VM}-{props[name][0]}"


# v12: the jelly is drawn once, as the JellyComp component, bound to its own view model (Jelly). The host's flat
# per-slot names (j3k5) live in Tank as seven nested view model properties j0..j6, one Jelly instance each.
JVM = nid()
jprops = {}
_jorder = []


def jprop(name, default=0):
    if name not in jprops:
        jprops[name] = (nid(), default)
        _jorder.append(name)
    return f"{JVM}-{jprops[name][0]}"


# ---------------------------------------------------------------- animation helpers

anims = []


def keys(obj_id, key, kv, interp="hold"):
    kfs = []
    for f, v in kv:
        if interp == "cubic":
            kfs.append(f'<KeyFrameDouble value="{v}" frame="{f}" interpolationType="cubic">'
                       f'<CubicEaseInterpolator x1="0.42" y1="0" x2="0.58" y2="1"/></KeyFrameDouble>')
        else:
            kfs.append(f'<KeyFrameDouble value="{v}" frame="{f}" interpolationType="{interp}"/>')
    return f'<KeyedObject objectId="{obj_id}"><KeyedProperty propertyKey="{key}">{"".join(kfs)}</KeyedProperty></KeyedObject>'


def add_anim(name, duration, tracks):
    aid = nid()
    anims.append((f'<LinearAnimation loopValue="loop" duration="{duration}" name="{name}" id="{aid}">{"".join(tracks)}</LinearAnimation>', aid, name))


def frame_cycle(name, ids, seq, step):
    tracks = [keys(fid, 18, [(n * step, 1 if s == i else 0) for n, s in enumerate(seq)]) for i, fid in enumerate(ids)]
    add_anim(name, len(seq) * step, tracks)


# ---------------------------------------------------------------- layout (logical)

HOOD = 14
WATER_TOP = 14
GLASS_L, GLASS_R = 5, 234
SAND_BASE = 318
WATER_BOT = 349
CAB_TOP = 356

rng = random.Random(11)

# v5: the tank is a wider world you pan across. World x runs 0..WLW logical (0..1440 artboard): the
# small tank 0..240, the medium stretch 240..360 (coral garden + seagrass meadow), the large stretch
# 360..480 (the glowing cave). The right wall stands at TIER_W[tier]; scenery past it is never seen
# (the wall carries an opaque "outside" panel, and the camera clamps inside the wall).
WLW = 480
TIER_W = [240, 360, 480]
TIER_JELLIES = [3, 5, 7]
TIER_PRICE = [0, 150, 400]
WORLD_R = WLW - GLASS_L - 1  # 474: the last water column of the large tank
SLOTS = 7


def sand_top(x):
    return SAND_BASE + round(3 * math.sin(x * 0.05) + 2 * math.sin(x * 0.13 + 1))


# ---------------------------------------------------------------- shading primitives


def shade_index(t, n, x, y, dither=0.6):
    return max(0, min(n - 1, int(t * n + bay(x, y) * dither)))


def blob(px, cx, cy, rx, ry, rmp, light=(-0.55, -0.75, 0.45), flat=None, outline=True, rough=0.0, seed=0):
    """Shaded ellipsoid, lit from the upper left. rmp is dark -> light."""
    ln = math.sqrt(sum(v * v for v in light))
    lx, ly, lz = (v / ln for v in light)
    r2 = random.Random(seed)
    inside = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            wob = rough * math.sin(math.atan2(dy, dx) * 5 + seed) * 0.08
            if dx * dx + dy * dy <= 1 + wob and (flat is None or y <= flat):
                inside.add((x, y))
    n = len(rmp)
    for x, y in inside:
        dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
        dz = math.sqrt(max(0.0, 1 - dx * dx - dy * dy))
        t = 0.15 + 0.85 * max(0.0, dx * lx + dy * ly + dz * lz)
        if rough and r2.random() < 0.08:
            t -= 0.18
        idx = shade_index(t, n - 1, x, y) + 1 if outline else shade_index(t, n, x, y)
        if outline and any((x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            idx = 1 if (dx * lx + dy * ly) > 0.2 else 0  # selective outline: lit edges stay mid
        px.put(x, y, rmp[min(idx, n - 1)])
    return inside


# ---------------------------------------------------------------- scenery


def soften(px, haze, amount=1.0):
    """Depth of field for a distant layer: a 3x3 blur of colour and alpha, eased toward the water's haze."""
    if not px.d:
        return px
    x0, y0, x1, y1 = px.bbox()
    out = Px()
    for y in range(y0 - 1, y1 + 2):
        for x in range(x0 - 1, x1 + 2):
            acc = [0.0, 0.0, 0.0]
            wsum = asum = 0.0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    c = px.d.get((x + dx, y + dy))
                    wt = 2.0 if dx == dy == 0 else 1.0
                    wsum += wt
                    if c:
                        a = c[3] / 255 * wt
                        asum += a
                        for i in range(3):
                            acc[i] += c[i] * a
            if asum <= 0:
                continue
            blur = tuple(acc[i] / asum for i in range(3))
            orig = px.d.get((x, y))
            a = asum / wsum
            if orig:
                rgb = tuple(orig[i] + (blur[i] - orig[i]) * amount for i in range(3))
                a = orig[3] / 255 + (a - orig[3] / 255) * amount
            else:
                rgb = blur
                a *= amount
            rgb = tuple(rgb[i] + (haze[i] - rgb[i]) * 0.25 * amount for i in range(3))
            if a >= 0.06:
                out.put(x, y, (round(rgb[0]), round(rgb[1]), round(rgb[2]), round(min(1, a) * 255)))
    return out


def far_layer():
    return soften(_far_layer(), hx("1f78b8"), 1.0)


def _far_layer():
    px = Px()
    for cx, cy, rx, ry in [(22, 300, 40, 90), (70, 318, 34, 46), (200, 296, 46, 100), (150, 322, 40, 38), (240, 320, 30, 60),
                           (292, 300, 40, 104), (338, 322, 30, 44), (372, 296, 34, 120)]:
        for y in range(int(cy - ry), WATER_BOT + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if not (GLASS_L <= x <= WORLD_R):
                    continue
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                wob = 0.06 * math.sin(y * 0.3 + cx) + 0.04 * math.sin(x * 0.5)
                if dx * dx + min(dy, 0) ** 2 <= 1 + wob:
                    top = not ((dx * dx + min(dy - 2 / ry, 0) ** 2) <= 1 + wob)
                    c = R_FAR[2] if top or (dx < -0.5 and (x + y) % 3 == 0) else R_FAR[1] if dx < 0 else R_FAR[0]
                    if not px.has(x, y) or top:
                        px.put(x, y, c)
    for bx, h in [(40, 120), (48, 90), (176, 140), (186, 100), (120, 70), (262, 130), (270, 96), (318, 150), (350, 84)]:
        for t in range(h):
            x = bx + round(3 * math.sin(t * 0.06 + bx))
            y = WATER_BOT - t
            px.put(x, y, R_FAR[1])
            px.put(x + 1, y, R_FAR[0])
            if t % 9 == 4:
                for k in range(1, 5):
                    px.put(x + 1 + k, y - k // 2, R_FAR[0])
    return px


def mid_layer():
    return soften(_mid_layer(), hx("1a6aa8"), 0.45)


def _mid_layer():
    px = Px()
    for cx, cy, rx, ry, seed in [(14, 318, 26, 40, 1), (52, 328, 20, 18, 2), (224, 310, 30, 48, 3), (186, 330, 18, 16, 4),
                                 (290, 322, 24, 34, 6), (336, 330, 18, 20, 7), (372, 318, 24, 36, 8)]:
        blob(px, cx, cy, rx, ry, R_ROCK_MID, flat=WATER_BOT, rough=1, seed=seed, outline=False)
    return px


def kelp(px, base_x, base_y, heights, lean, rmp, seed):
    for k, h in enumerate(heights):
        bx = base_x + k * 6 - len(heights) * 3
        for t in range(h):
            f = t / h
            off = lean * 7 * f ** 1.5 + 2.2 * math.sin(t * 0.12 + k * 1.7 + seed) * f
            x, y = round(bx + off), base_y - t
            px.put(x - 1, y, rmp[4])
            px.put(x, y, rmp[3])
            px.put(x + 1, y, rmp[2])
            if t > 6 and (t + k * 5) % 11 == 0:
                side = 1 if (t // 11 + k) % 2 else -1
                for i in range(1, 9):
                    lx = x + side * (1 + i)
                    ly = y - round(i * 0.6) + (1 if i > 6 else 0)
                    for w in range(-1, 2):
                        if abs(w) + i * 0.15 < 1.8:
                            c = rmp[4] if w < 0 else rmp[2] if w > 0 else rmp[3]
                            px.put(lx, ly + w, rmp[1] if i > 6 else c)
        for i in range(-2, 3):
            px.put(bx + i, base_y + 1, rmp[1])
    for x, y in [(x + 1, y) for (x, y) in list(px.d) if not px.has(x + 1, y)]:
        px.put(x, y, rmp[0])


def branch_coral(px, x, y, ang, length, thick, depth, rmp, r2):
    steps = int(length)
    cx, cy = x, y
    for i in range(steps):
        cx += math.cos(ang)
        cy += math.sin(ang)
        rr = max(1.0, thick * (1 - i / steps * 0.35))
        for yy in range(int(cy - rr) - 1, int(cy + rr) + 2):
            for xx in range(int(cx - rr) - 1, int(cx + rr) + 2):
                dx, dy = xx + 0.5 - cx, yy + 0.5 - cy
                d = math.hypot(dx, dy)
                if d <= rr:
                    side = dx / rr
                    n = len(rmp)
                    if d > rr - 0.9 and side > 0.35:
                        idx = 1
                    elif side < -0.35:
                        idx = n - 1 if dy < 0 else n - 2
                    elif side > 0.25:
                        idx = n - 4
                    else:
                        idx = n - 3 if (xx + yy) % 5 else n - 2
                    px.put(xx, yy, rmp[idx])
    if depth > 0:
        for da in (-0.55 + r2.uniform(-0.15, 0.15), 0.5 + r2.uniform(-0.15, 0.15)):
            branch_coral(px, cx, cy, ang + da, length * 0.72, thick * 0.75, depth - 1, rmp, r2)
    else:
        px.put(round(cx), round(cy), rmp[-1])


def brain_coral(px, cx, cy, rx, ry):
    inside = blob(px, cx, cy, rx, ry, R_BRAIN, flat=cy + ry * 0.4)
    for x, y in inside:
        g = math.sin(x * 0.9 + 2.2 * math.sin(y * 0.5)) + 0.6 * math.sin(y * 1.1 - x * 0.3)
        c = px.get(x, y)
        if g > 0.9 and c != R_BRAIN[0]:
            i = R_BRAIN.index(c) if c in R_BRAIN else 2
            px.put(x, y, R_BRAIN[max(1, i - 1)])


def starfish(px, cx, cy, r):
    for y in range(cy - r - 1, cy + r + 2):
        for x in range(cx - r - 1, cx + r + 2):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            a = math.atan2(dy, dx) + math.pi / 2
            rr = r * (0.42 + 0.58 * abs(math.cos(a * 2.5)) ** 2)
            d = math.hypot(dx, dy)
            if d <= rr:
                t = 0.7 - dx / r * 0.3 - dy / r * 0.3
                px.put(x, y, R_STAR[0 if d > rr - 0.8 else min(3, shade_index(t, 3, x, y) + 1)])
    px.put(cx, cy, R_STAR[3])


def sand():
    px = Px()
    for x in range(GLASS_L, WLW):
        top = sand_top(x)
        for y in range(top, WATER_BOT + 1):
            depth = (y - top) / max(1, WATER_BOT - top)
            if y == top:
                c = R_SAND[5]
            elif y == top + 1:
                c = R_SAND[4]
            else:
                t = 0.92 - depth * 0.4 + 0.05 * math.sin(x * 0.4 + y * 0.9)
                c = R_SAND[shade_index(t, 5, x, y, 0.5)]
            px.put(x, y, c)
    for _ in range(70):
        x = rng.randint(GLASS_L, GLASS_R)
        y = rng.randint(sand_top(x) + 3, WATER_BOT - 1)
        px.put(x, y, rng.choice([R_SAND[1], R_SAND[2], R_SAND[5]]))
    for _ in range(12):
        x = rng.randint(GLASS_L + 4, GLASS_R - 4)
        y = rng.randint(sand_top(x) + 4, WATER_BOT - 3)
        blob(px, x, y, rng.choice([2, 3]), 2, R_ROCK[1:], seed=rng.random() * 9)
    r5 = random.Random(55)  # the new stretches get their own grit, so the small tank's stays as it was
    for _ in range(70):
        x = r5.randint(GLASS_R + 1, WORLD_R)
        y = r5.randint(sand_top(x) + 3, WATER_BOT - 1)
        px.put(x, y, r5.choice([R_SAND[1], R_SAND[2], R_SAND[5]]))
    for _ in range(10):
        x = r5.randint(GLASS_R + 4, WORLD_R - 4)
        y = r5.randint(sand_top(x) + 4, WATER_BOT - 3)
        blob(px, x, y, r5.choice([2, 3]), 2, R_ROCK[1:], seed=r5.random() * 9)
    # the cave mouth: the floor falls into shadow toward the back of the arch
    for (x, y), c in list(px.d.items()):
        u = abs(x + 0.5 - CAVE_C) / (CAVE_A + 4)
        k = 0.86 * (1 - smoothstep((u - 0.78) / 0.42)) + 0.3 * smoothstep((x - CAVE_C - CAVE_A + 6) / 14)
        k *= 1 - 0.3 * (y - sand_top(x)) / max(1, WATER_BOT - sand_top(x))
        if k > 0.02:
            px.put(x, y, mix(c, hx("0b0e28"), min(0.86, k)))
    return px


def chest_art():
    """Treasure chest, lid standing open behind a pile of gold. Origin = bottom-left."""
    px = Px()
    w, h = 34, 18
    top = -h
    # the lid, hinged on the box's back edge and tipped open: we see its dark inside face, tapering as it
    # leans away, with a rounded gold rim along its front edge (now on top) and brass hinges at its foot
    lid_h = 11
    for k in range(lid_h):
        y = top - 1 - k
        inset = 1 + k // 4 + (2 if k == lid_h - 1 else 1 if k == lid_h - 2 else 0)
        x0, x1 = inset, w - 1 - inset
        for x in range(x0, x1 + 1):
            if x in (x0, x1) or k == lid_h - 1:
                c = R_WOOD[0]
            elif k == lid_h - 2:
                c = R_GOLD[3] if x0 + 2 < x < x1 - 2 else R_GOLD[2]
            elif k == lid_h - 3:
                c = R_GOLD[1]
            elif k < 2:
                c = R_WOOD[0]
            elif k % 3 == 1:
                c = R_WOOD[0]
            else:
                c = R_WOOD[2] if (x * 3 + k) % 7 == 0 else R_WOOD[1]
            px.put(x, y, c)
    for hx_ in (5, 6, w - 7, w - 6):
        px.put(hx_, top - 1, R_GOLD[1])
        px.put(hx_, top - 2, R_GOLD[2] if hx_ in (5, w - 7) else R_GOLD[0])
    for y in range(top, 0):
        for x in range(w):
            t = 0.65 - x / w * 0.35
            px.put(x, y, R_WOOD[1] if (y - top) % 6 == 0 else R_WOOD[shade_index(t, 5, x, y) + 1])
    for y in range(top, 0):
        px.put(0, y, R_WOOD[0])
        px.put(w - 1, y, R_WOOD[0])
    for x in range(w):
        px.put(x, -1, R_WOOD[0])
    for bx in (3, 4, w - 5, w - 4):
        for y in range(top, -1):
            px.put(bx, y, R_GOLD[3] if bx in (3, w - 5) else R_GOLD[1])
    for x in range(1, w - 1):
        px.put(x, top, R_GOLD[2])
        px.put(x, top + 1, R_GOLD[1])
    for y in range(top + 3, top + 10):
        for x in range(w // 2 - 3, w // 2 + 3):
            px.put(x, y, R_GOLD[2] if y < top + 9 else R_GOLD[0])
    px.put(w // 2 - 1, top + 5, R_WOOD[0])
    px.put(w // 2 - 1, top + 6, R_WOOD[0])
    px.put(w // 2 - 2, top + 4, R_GOLD[4])
    # the gold heaped in the open box, in front of the lid
    for x in range(2, w - 2):
        hgt = 3 + round(2 * math.sin(x * 0.7) + math.sin(x * 1.9))
        for k in range(hgt):
            c = R_GOLD[4] if k == hgt - 1 else R_GOLD[3] if (x + k) % 3 else R_GOLD[2]
            px.put(x, top - 1 - k, c)
    return px


def bubble_art(r):
    px = Px()
    for y in range(-r - 1, r + 2):
        for x in range(-r - 1, r + 2):
            d = math.hypot(x + 0.5, y + 0.5)
            if r - 0.9 <= d <= r + 0.1:
                px.put(x, y, hx("dff8ff", 210 if x + y > -1 else 255))
            elif d < r - 0.9:
                px.put(x, y, hx("bfefff", 50))
    px.put(-r // 2, -r // 2 - 1, hx("ffffff"))
    return px


def fish_art(frame, flip, tint):
    body = [mix(c, tint, 0.45) for c in ramp("23345c", "3d5f8e", "77a4c8", "c4e4f2")]
    px = Px()
    for y in range(-3, 4):
        for x in range(-6, 6):
            dx, dy = (x + 0.5) / 6, (y + 0.5) / 3.2
            if dx * dx + dy * dy <= 1:
                px.put(x, y, body[1 + shade_index(0.6 - dy * 0.5, 3, x, y, 0.3)])
    tail = ([(-7, -2), (-7, -1), (-7, 0), (-7, 1), (-8, -3), (-8, 2)] if frame == 0
            else [(-7, -1), (-7, 0), (-8, -2), (-8, -1), (-8, 0), (-8, 1)])
    for p in tail:
        px.put(*p, body[1])
    px.put(3, -1, body[0])
    if flip:
        f = Px()
        for (x, y), c in px.d.items():
            f.put(-x - 1, y, c)
        return f
    return px


# ---------------------------------------------------------------- the jelly

BELL_FRAMES = [(62, 32), (58, 35), (50, 40), (56, 36)]

# ---- v10: an 8-frame pulse for juvenile and adult bells (polyps and ephyrae keep their 4). Each frame is
# (width, height, pinch) over the rest bell; pinch > 0 pulls the margin in (the power stroke), < 0 flares it.
# The logic eases through them (src/species.ts PULSE_KEYS): rest -> a slight swell (anticipation) -> a quick
# squeeze -> release -> an overshoot past rest -> settle back to rest.
PULSE8 = [(1.00, 1.00, 0.0), (1.04, 0.95, -0.02), (0.93, 1.10, 0.03), (0.86, 1.19, 0.05),
          (0.81, 1.26, 0.07), (0.90, 1.13, 0.04), (1.07, 0.91, -0.04), (1.02, 0.98, -0.01)]
PULSE_NAMES = ["rest", "swell", "squeeze", "squeeze2", "peak", "release", "overshoot", "settle"]
# the pale palette (a sad, slow jelly) keeps 4 drawn frames: each of the 8 shows its nearest one
PALE_OF = [0, 0, 2, 4, 4, 2, 6, 0]
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def nbf(k, g):
    """Body frames per stage: juvenile and adult bells pulse in 8; polyps, ephyrae and the comb's shimmer in 4."""
    return 8 if g >= 2 and k != 3 else 4


def pinched(dx, dy, pinch):
    """x scale at height dy (-1 top .. 0 margin) for a bell whose margin is pulled in by `pinch`."""
    return 1 - pinch * (1 + min(0.0, dy)) ** 2


WATER = (36, 120, 178)  # the mid-water blue a bell is mostly seen against


def glass_pass(px, inside, half, h, P_, organs=(), interior=0.74, edge=1.1, min_a=56, band=1, margin=-2, hue_keep=0.3):
    """v10 glow pass over a shaded bell (origin = rim centre, dome above y = 0): a fresnel alpha ramp (a
    see-through middle that thickens toward the silhouette), a lit band just inside the edge (bright on the
    upper-left, a softer back-lit glow on the shadow side), a light selective outline where the light hits,
    and the organs kept dense with a faint halo so they glow through the jelly. `organs` = pixel coords."""
    dist, front = {}, [q for q in inside if any((q[0] + a, q[1] + b) not in inside for a, b in N4)]
    for q in front:
        dist[q] = 0
    for d in range(1, band + 2):
        nxt = []
        for x, y in front:
            for a, b in N4:
                q = (x + a, y + b)
                if q in inside and q not in dist:
                    dist[q] = d
                    nxt.append(q)
        front = nxt
    organs = set(organs)
    lite, hi = P_["l"], P_["h"]
    for (x, y) in inside:
        c = px.get(x, y)
        if c is None or y >= margin:
            continue
        dx, dy = (x + 0.5) / half, (y + 0.5) / h
        nl = math.hypot(dx, dy) or 1
        lit = (-0.6 * dx - 0.8 * dy) / nl  # outward normal . toward the light
        dz = math.sqrt(max(0.0, 1 - min(1.0, dx * dx + dy * dy)))
        fres = (1 - dz) ** 1.5
        d = dist.get((x, y), 99)
        if (x, y) in organs:
            px.put(x, y, c[:3] + (max(c[3], 222),))
            continue
        if d == 0:
            if lit > 0.3:  # selective outline: lit from the upper left
                px.put(x, y, mix(c, lite, 0.6)[:3] + (238,))
            continue
        if d <= band:
            if lit > 0.25:
                px.put(x, y, mix(c, hi, 0.7 if d == 1 else 0.4)[:3] + (236 if d == 1 else 220,))
            else:
                back = max(0.0, min(1.0, 0.5 - lit))  # the back-lit glow fades out toward the shadow side
                px.put(x, y, mix(c, lite, (0.45 if d == 1 else 0.22) * (1 - 0.6 * back))[:3] + (min(255, round(c[3] * edge)),))
            continue
        k = interior + (edge - interior) * min(1.0, fres + 0.12 * bay(x, y))
        k = round(k * 6) / 6
        a = max(min_a, min(255, round(c[3] * k)))
        while a < c[3]:  # thinner, but keep its hue: pre-tint so the water shifts the colour only part of the way
            t0, t1 = 1 - c[3] / 255, 1 - a / 255
            want = [c[i] + (WATER[i] - c[i]) * (t0 + (t1 - t0) * hue_keep) for i in range(3)]
            raw = [(want[i] - t1 * WATER[i]) / (1 - t1) for i in range(3)]
            if all(-8 <= v <= 263 for v in raw):  # a bright warm colour can't be pre-tinted that far: stay denser
                c = tuple(max(0, min(255, round(v))) for v in raw) + (a,)
                break
            a = min(c[3], a + 12)
        px.put(x, y, c[:3] + (a,))
    for (x, y) in organs:  # halo: the organ's light leaking into the jelly around it
        c = px.get(x, y)
        if c is None:
            continue
        glow = mix(c, hi, 0.45)[:3] + (60,)
        for a, b in N4:
            q = (x + a, y + b)
            if q in inside and q not in organs and dist.get(q, 99) > band and q[1] < margin:
                px.over(q[0], q[1], glow)


def bell(w, h, pal, s=1.0, pinch=0.0):
    J = JELLY[pal]
    px = Px()
    half = w / 2
    inside = set()
    for y in range(-h, 1):
        for x in range(-int(half) - 2, int(half) + 2):
            dx, dy = (x + 0.5) / half, (y + 0.5) / h
            dx /= pinched(dx, dy, pinch)
            if dx * dx + dy * dy <= 1:
                inside.add((x, y))
    for x in range(-int(half * pinched(0, 0, pinch)) + 2, int(half * pinched(0, 0, pinch)) - 1):  # lappets: scallops along the rim
        if x % 5 in (0, 1):
            inside.add((x, 1))
    cav_ry = 7 * s
    light = (-0.5, -0.8, 0.5)
    ln = math.sqrt(sum(v * v for v in light))
    lx, ly, lz = (v / ln for v in light)
    rim_half = half * pinched(0, 0, pinch)
    for x, y in inside:
        dx, dy = (x + 0.5) / half, (y + 0.5) / h
        dz = math.sqrt(max(0, 1 - dx * dx - dy * dy))
        t = 0.2 + 0.8 * max(0, dx * lx + dy * ly + dz * lz)
        c = [J["d"], J["m"], J["l"]][shade_index(t, 3, x, y, 0.8)]
        in_cav = (x + 0.5) ** 2 / (rim_half - 5 * s) ** 2 + (y - 0.5) ** 2 / cav_ry ** 2 <= 1
        if in_cav:
            c = J["cav"] if y > -cav_ry + 2 else J["d"]
        if any((x + a, y + b) not in inside for a, b in N4):
            c = J["out"] if y < -2 else J["rim"]
        elif y >= -1 and not in_cav:
            c = J["rim"]
        px.put(x, y, c)
    org = set()
    cy = -h * 0.55
    for k in range(9):  # radial canals
        a = math.pi * (0.1 + 0.8 * k / 8)
        for st in range(max(2, round(4 * s)), int(half), 2):
            x = round(-math.cos(a) * st * pinched(0, -0.5, pinch))
            y = round(cy + math.sin(a) * st * (h / half) * 0.9)
            if (x, y) in inside and px.get(x, y) not in (J["out"], J["rim"]):
                px.over(x, y, J["can"])
    for gx, gy, rx, ry in [(-6, -0.74, 4.2, 2.6), (6, -0.74, 4.2, 2.6), (-10, -0.52, 6.0, 3.6), (10, -0.52, 6.0, 3.6)]:
        gx = round(gx * w / 62 * pinched(0, gy, pinch))
        gyy = round(h * gy)
        for y in range(gyy - 5, gyy + 6):
            for x in range(gx - 7, gx + 8):
                d = ((x + 0.5 - gx) / (rx * s)) ** 2 + ((y + 0.5 - gyy) / (ry * s)) ** 2
                if d <= 1 and (x, y) in inside:
                    org.add((x, y))
                    if d >= 0.5:
                        px.put(x, y, J["gd"] if y > gyy else J["g"])
                    else:
                        px.over(x, y, J["g"][:3] + (150,))
    glass_pass(px, inside, half, h, J, org, band=2 if s == 1 else 1)
    for k in range(10):  # specular streak
        a = math.radians(205 + k * 4.5)
        x, y = round(math.cos(a) * half * 0.72), round(math.sin(a) * h * 0.78)
        if (x, y) in inside:
            px.put(x, y, J["h"])
            if 3 <= k <= 6 and (x + 1, y) in inside:
                px.put(x + 1, y, J["h"])
    sx, sy = round(-half * 0.22), round(-h * 0.86)
    if (sx, sy) in inside:
        px.put(sx, sy, J["h"])
    return px


TENT_N = 16

# ---- trailing tentacles: how the tentacles/arms react to motion. The host writes j{s}tr0..tr4
# (one-hot) and the slot shows that pose's 4 sway frames (tf). Neutral keeps the v2 sprites.
#   0 fanned   drifting or sinking: relaxed, a little wider, a lazier sway
#   1 neutral  the v2 art
#   2 stream   rising after a pulse: pulled together into a narrow streak below, straighter, longer
#   3 trailL   gliding right: the streak sweeps back to the left
#   4 trailR   gliding left: the streak sweeps back to the right
TR_FAN, TR_NEUTRAL, TR_STREAM, TR_LEFT, TR_RIGHT = range(5)
TRAIL_POSES = ["fanned", "neutral", "stream", "trailL", "trailR"]
TRAIL_SUFFIX = ["Fan", "", "Stream", "TrailL", "TrailR"]
# spread: x at depth relative to the root x; amp/wave: sway size/wavelength; len: length; lean: -1 left, +1 right
TRAIL = [
    dict(spread=1.42, amp=1.5, wave=0.8, len=0.9, lean=0),
    dict(spread=1.0, amp=1.0, wave=1.0, len=1.0, lean=0),
    dict(spread=0.26, amp=0.32, wave=0.62, len=1.18, lean=0),
    dict(spread=0.4, amp=0.42, wave=0.7, len=1.12, lean=-1),
    dict(spread=0.4, amp=0.42, wave=0.7, len=1.12, lean=1),
]


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def gathered(x0, t, depth, spread):
    """Root x moved toward spread * x0 over the first `depth` pixels below the rim."""
    return x0 * (1 + (spread - 1) * smoothstep(t / depth))


def swept(u, L, lean, bend):
    """Offset of a trailing strand at fraction u of its length L: back along the lean, and a little
    shorter as it lies over."""
    if not lean:
        return 0.0, 0.0
    return lean * bend * L * u ** 1.6, -0.22 * bend * L * u ** 2


def strand(pts):
    """Fill the gaps of a 1-px strand whose x jumps more than a pixel between rows."""
    out = []
    for (xa, ya, ca), (xb, yb, cb) in zip(pts, pts[1:] + pts[-1:]):
        out.append((xa, ya, ca))
        n = max(abs(round(xb) - round(xa)), abs(round(yb) - round(ya)))
        for q in range(1, n):
            out.append((xa + (xb - xa) * q / n, ya + (yb - ya) * q / n, ca))
    return out


MOON_TENT = {"thin": "f7a6dc", "thin_d": "d77bc0", "arm_l": "ffd2ef", "arm_m": "f49ad4", "arm_d": "c766ae"}
MOON_TENT_M = {"thin": "ffd28a", "thin_d": "e0a04a", "arm_l": "ffecc4", "arm_m": "f6c46e", "arm_d": "c4862a"}


def tentacles(frame, s=1.0, tr=TR_NEUTRAL, cols=MOON_TENT, nf=4):
    px = Px()
    ph = frame / nf * 2 * math.pi
    r2 = random.Random(5)
    q = TRAIL[tr]
    plot = px.put if tr in (TR_NEUTRAL, TR_FAN) else px.over  # a streak bunches up: let it get denser
    thin, thin_d = hx(cols["thin"], 150), hx(cols["thin_d"], 150)
    if plot == px.over:
        thin, thin_d = hx(cols["thin"], 120), hx(cols["thin_d"], 140)
    n = TENT_N if s == 1 else round(TENT_N * s)
    for i in range(n):
        x0 = -23 * s + i * 46 * s / (n - 1)
        length = round((44 + r2.randint(0, 26)) * s)
        k = r2.random() * 6
        L = round(length * q["len"])
        pts = []
        for t in range(1, L):
            u = t / L
            x = gathered(x0, t, 30 * s, q["spread"])
            x += 3.2 * s * q["amp"] * math.sin(ph - t * 0.16 * q["wave"] / s + k) * min(1, t / (10 * s))
            dx, dy = swept(u, L, q["lean"], 0.54)
            pts.append((x + dx, t + dy, thin if t % 7 else thin_d))
        for x, y, c in strand(pts):
            plot(round(x), round(y), c)
    arm_l, arm_m, arm_d = hx(cols["arm_l"], 205), hx(cols["arm_m"], 205), hx(cols["arm_d"], 215)
    aspread = {TR_FAN: 1.55, TR_STREAM: 0.4}.get(tr, 0.55 if q["lean"] else 1.0)
    for j, x0 in enumerate((-7, -2.5, 2.5, 7)):  # oral arms, frilled ribbons
        x0 *= s
        length = round((46 + j % 2 * 6) * s)
        L = round(length * (1 + (q["len"] - 1) * 0.7))
        for t in range(1, L):
            u = t / L
            x = gathered(x0, t, 22 * s, aspread)
            x += 2.6 * s * q["amp"] * math.sin(ph - t * 0.12 * q["wave"] / s + j * 1.9) * min(1, t / (8 * s))
            dx, dy = swept(u, L, q["lean"], 0.38)
            x, y = x + dx, round(t + dy)
            wdt = round((2.6 - 1.6 * t / L) * s * (0.85 if tr >= TR_STREAM else 1))
            frill = 1 if (t + j * 2) % 4 < 2 else 0
            for o in range(-wdt - frill, wdt + 1):
                c = arm_d if o in (-wdt - frill, wdt) else arm_l if o < 0 else arm_m
                px.over(round(x) + o, y, c)
    return px


# ---------------------------------------------------------------- v2 species
# k: 0 moon, 1 blue blubber, 2 upside-down (Cassiopea), 3 comb jelly
# g: 0 polyp, 1 ephyra, 2 juvenile (drawn at ~0.6), 3 adult
# palettes: "h" healthy, "p" pale, "r" flush


def pal(a, **kw):
    return {k: hx(v, a) for k, v in kw.items()}


BLUBBER = {
    "h": pal(240, out="161a5c", d="25328e", m="3753bc", l="5b80e2", h="eef6ff", rim="f2f7ff", rim2="a9c3f5", spot="9fc0f8", cav="0f1648"),
    "p": pal(236, out="474e6c", d="68708f", m="8b94b0", l="adb6cb", h="f6f8fb", rim="eef1f5", rim2="c9d0de", spot="c8d0e0", cav="3a4058"),
    "r": pal(242, out="35136c", d="5826a8", m="7a48d6", l="a476f2", h="fff2ff", rim="fff2fb", rim2="d6b6f6", spot="d6b8ff", cav="2a0c58"),
    # v7 morph: midnight blubber, near-black navy with gold spots
    "m": pal(244, out="04051a", d="0a1034", m="131c4c", l="20306e", h="c8d6ff", rim="d4dcf8", rim2="5a68a4", spot="ffc84a", cav="03040e"),
}
UPSIDE = {
    "h": pal(255, out="2a2412", d="534b22", m="7e7432", l="a99d4e", h="e2d894", rim="c8b66c", spot="f4f1e2", blue="78c6df", ctr="3c3618"),
    "p": pal(255, out="3a3830", d="66625a", m="8c887c", l="b3afa0", h="ecead8", rim="cfcab8", spot="f8f8f2", blue="b4d0dc", ctr="55524a"),
    "r": pal(255, out="3c2210", d="72481a", m="a67428", l="d4a44a", h="fff0b0", rim="ecc474", spot="fff8e8", blue="86d6f0", ctr="5a3412"),
    # v7 morph: albino, a white-pink bell with pale aqua spots
    "m": pal(255, out="7a5262", d="c89cac", m="e6c2cc", l="f8e0e6", h="ffffff", rim="ffd4e0", spot="b8fff0", blue="8ae8e2", ctr="b48494"),
}
COMB = {
    "h": {"body": hx("bff2ff"), "edge": hx("eaffff"), "deep": hx("3a9cc8"), "inner": hx("ffb4cc"), "comb": 1.0, "sat": 1.0},
    "p": {"body": hx("c6ccd4"), "edge": hx("eef1f4"), "deep": hx("74808e"), "inner": hx("c8bcc4"), "comb": 0.6, "sat": 0.3},
    "r": {"body": hx("ffc4e6"), "edge": hx("fff0fa"), "deep": hx("c86aa8"), "inner": hx("ff8cb4"), "comb": 1.0, "sat": 1.0},
    # v7 morph: gold comb, an amber body; the comb rows still run rainbow
    "m": {"body": hx("ffcf6a"), "edge": hx("fff0c0"), "deep": hx("c06a12"), "inner": hx("ff8a4a"), "comb": 1.0, "sat": 1.0},
}
RAINBOW = ramp("ff4f7a", "ff9a3c", "ffe14d", "5df07a", "3fd0ff", "8f6bff")
PAL_MOON = {"h": "j", "p": "p", "r": "r", "m": "jm"}


def tint(k, p):
    """A small ramp (out, d, m, l, h, tent, gut) for polyps and ephyrae of species k."""
    if k == 0:
        J = JELLY[PAL_MOON[p]]
        return {"out": J["out"], "d": J["d"], "m": J["m"], "l": J["l"], "h": J["h"], "tent": J["rim"], "gut": J["g"]}
    if k == 1:
        B = BLUBBER[p]
        return {"out": B["out"], "d": B["d"], "m": B["m"], "l": B["l"], "h": B["h"], "tent": B["rim2"], "gut": B["spot"]}
    if k == 2:
        U = UPSIDE[p]
        return {"out": U["out"], "d": U["d"], "m": U["m"], "l": U["l"], "h": U["h"], "tent": mix(U["h"], hx("c8f0a0"), 0.6), "gut": U["blue"]}
    if k >= 4:
        N = NEW[k][p]
        tent = N.get("tent", N["rim"])
        gut = N.get("stripe", N["can"]) if k in (5, 7, 8) else N.get("yd", N.get("dot", N["can"]))
        return {"out": N["out"][:3] + (220,), "d": N["d"][:3] + (200,), "m": N["m"][:3] + (190,), "l": N["l"][:3] + (200,),
                "h": N["h"], "tent": tent[:3] + (190,), "gut": gut[:3] + (220,)}
    C = COMB[p]
    return {"out": C["deep"][:3] + (210,), "d": mix(C["deep"], C["body"], 0.5)[:3] + (150,), "m": C["body"][:3] + (130,),
            "l": C["edge"][:3] + (170,), "h": hx("ffffff", 230), "tent": C["edge"][:3] + (170,), "gut": C["inner"][:3] + (170,)}


def edge_recolor(px, col, sides=((1, 0), (0, 1))):
    """Selective outline: recolour pixels whose neighbour on a shadow side is empty."""
    for (x, y) in [p for p in px.d if any(not px.has(p[0] + a, p[1] + b) for a, b in sides)]:
        px.put(x, y, col)


def disc(px, cx, cy, r, cols, over=False):
    """A small lit ball, cols = (dark, mid, light, highlight)."""
    for y in range(math.floor(cy - r), math.ceil(cy + r) + 1):
        for x in range(math.floor(cx - r), math.ceil(cx + r) + 1):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            if dx * dx + dy * dy <= r * r:
                t = -(dx + dy * 1.2) / max(r, 0.8)
                c = cols[3] if t > 0.9 else cols[2] if t > 0.15 else cols[1] if t > -0.7 else cols[0]
                (px.over if over else px.put)(x, y, c)


def rainbow(i, sat=1.0, a=255):
    c = RAINBOW[i % len(RAINBOW)]
    if sat < 1:
        g = sum(c[:3]) // 3
        c = mix((g, g, g, 255), c, sat)
    return c[:3] + (a,)


# ---- polyp (scyphistoma): stalk on a rock, crown of tentacles. Origin = base of the stalk.

POLYP_H = 14


def polyp(frame, k, p):
    C = tint(k, p)
    px = Px()
    sway = (-1.5, 0, 1.5, 0)[frame]
    spread = (1.0, 0.9, 1.0, 1.1)[frame]
    H = POLYP_H

    def cx(t):
        return sway * (t / H) ** 2

    for t in range(0, H + 1):
        hw = 2.7 - t * 0.7 if t <= 1 else 1.0 if t < 7 else 1.0 + (t - 7) / (H - 7) * 2.4
        c0 = cx(t)
        xs = list(range(math.floor(c0 - hw + 0.5), math.floor(c0 + hw + 0.5)))
        for i, x in enumerate(xs):
            if i == 0:
                c = C["l"]
            elif i == len(xs) - 1:
                c = C["out"]
            else:
                c = C["m"] if (x + t) % 3 else C["d"]
            if t == H and 0 < i < len(xs) - 1:
                c = C["h"] if i < len(xs) // 2 else C["l"]
            px.put(x, -t, c)
    top = cx(H)
    px.put(round(top), -H - 1, C["l"])  # hypostome
    if k == 3:  # comb polyps carry a few rainbow pixels
        for i, t in enumerate((9, 11, 13)):
            px.put(round(cx(t)), -t, rainbow(i + frame))
    n = 9
    for i in range(n):
        f = i / (n - 1) * 2 - 1
        x, y = top + f * 3.0, -H - 0.5
        a = f * 0.62 * spread
        for st in range(7):
            u = st / 6
            ang = a * (1 + 1.1 * u)
            x += math.sin(ang) * 0.9
            y -= math.cos(ang) * 0.9
            px.over(round(x), round(y), C["h"] if st == 6 else C["tent"])
    return px


def polyp_motes(frame):
    px = Px()
    for i in range(3):
        a = 2 * math.pi * (i / 3 + frame / 12)
        x, y = math.cos(a) * 7, -POLYP_H - 9 + math.sin(a) * 3
        px.put(round(x), round(y), hx("f4fbff", 170))
        px.put(round(x - math.sin(a) * 1.5), round(y + math.cos(a)), hx("f4fbff", 70))
    return px


# ---- ephyra: a tiny 8-armed star, tilted toward the viewer. Origin = centre of the disc.

def ephyra(frame, k, p):
    C = tint(k, p)
    R = 8.5
    rr = (1.0, 0.86, 0.74, 0.88)[frame]
    curl = (0.0, 0.8, 1.6, 0.8)[frame]
    tilt = 0.78
    info = {}
    for ri in range(0, int(R * 5) + 1):
        rf = ri / 5
        for ti in range(0, 629):
            th = ti / 100
            arm = (th - math.pi / 8) % (math.pi / 4)
            d = min(arm, math.pi / 4 - arm)
            in_arm = rf > 2.6 and d <= 0.2 * (1 - (rf - 2.6) / (R - 2.6) * 0.25)
            if rf >= R * 0.78 and d < 0.06:
                in_arm = False
            if rf > 3.2 and not in_arm:
                continue
            r = rf * rr
            X = r * math.cos(th)
            Y = r * math.sin(th) * tilt + curl * (rf / R) ** 2 * (1 if math.sin(th) > -0.3 else 0.4)
            key = (math.floor(X), math.floor(Y))
            if key not in info or rf < info[key][0]:
                info[key] = (rf, th, d)
    px = Px()
    for (x, y), (rf, th, d) in info.items():
        t = 0.55 - 0.3 * x / R - 0.5 * y / (R * tilt)
        c = [C["d"], C["m"], C["l"]][shade_index(t, 3, x, y, 0.6)]
        if rf < 2.2:
            c = C["gut"]
        px.put(x, y, c)
    for (x, y) in list(px.d):
        if any((x + a, y + b) not in info for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px.put(x, y, C["out"] if (x > 0 or y > 0) else C["l"])
    for gx, gy in ((-1, -1), (0, -1), (-1, 0), (0, 0)):
        if px.has(gx, gy):
            px.put(gx, gy, C["h"] if (gx, gy) == (-1, -1) else C["gut"])
    if k == 3:
        for i in range(8):
            th = i * math.pi / 4 + math.pi / 8
            x, y = math.floor(5 * rr * math.cos(th)), math.floor(5 * rr * math.sin(th) * tilt + curl * 0.4)
            if px.has(x, y):
                px.put(x, y, rainbow(i + frame))
    return px


def ephyra_mouth(frame, k):
    C = tint(k, "h")
    px = Px()
    w = (0, 1, 0, -1)[frame]
    for t in range(1, 8):
        x = round(w * t / 7)
        px.put(x, t, C["tent"][:3] + (190,))
        if t >= 6:
            px.put(x - 1, t, C["tent"][:3] + (140,))
            px.put(x + 1, t + (frame % 2), C["tent"][:3] + (140,))
    return px


# ---- blue blubber (Catostylus): chunky indigo dome, white rim, light spots; 8 cauliflower arms

BLUB_FRAMES = [(50, 30), (46, 33), (41, 36), (45, 34)]
BLUB_SPOTS = [(-0.55, -0.62, 1.6), (-0.2, -0.82, 1.3), (0.18, -0.7, 1.7), (0.52, -0.55, 1.4), (-0.78, -0.3, 1.2),
              (-0.4, -0.38, 1.7), (0.0, -0.45, 1.3), (0.38, -0.3, 1.6), (0.75, -0.25, 1.1), (-0.15, -0.2, 1.1),
              (0.2, -0.95, 0.9), (-0.62, -0.15, 0.9), (0.6, -0.78, 0.9)]


def blubber_bell(w, h, p, s=1.0, pinch=0.0):
    B = BLUBBER[p]
    px = Px()
    half = w / 2
    inside = set()
    for y in range(-h, 1):
        for x in range(-int(half) - 2, int(half) + 2):
            dx, dy = (x + 0.5) / half, (y + 0.5) / h
            dx /= pinched(dx, dy, pinch)
            if abs(dx) ** 2.5 + abs(dy) ** 1.9 <= 1:
                inside.add((x, y))
    rim_half = half * pinched(0, 0, pinch)
    for x in range(-int(rim_half) + 2, int(rim_half) - 1):
        if x % 4 in (0, 1):
            inside.add((x, 1))
    light = (-0.5, -0.8, 0.5)
    ln = math.sqrt(sum(v * v for v in light))
    lx, ly, lz = (v / ln for v in light)
    rim_rows = max(1, round(2 * s))
    org = set()
    for x, y in inside:
        dx, dy = (x + 0.5) / half, (y + 0.5) / h
        dz = math.sqrt(max(0, 1 - dx * dx - dy * dy))
        t = 0.12 + 0.88 * max(0, dx * lx + dy * ly + dz * lz)
        c = [B["d"], B["m"], B["l"]][shade_index(t, 3, x, y, 0.8)]
        for sx, sy, sr in BLUB_SPOTS:
            ex, ey = (x + 0.5 - sx * half * pinched(0, sy, pinch)) / (sr * s + 0.4), (y + 0.5 - sy * h) / (sr * s * 0.8 + 0.4)
            if ex * ex + ey * ey <= 1:
                c = B["spot"] if t > 0.35 else B["l"]
                org.add((x, y))
        if any((x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c = B["out"] if y < -rim_rows else B["rim"]
        elif y > -rim_rows:
            c = B["rim"] if y >= 0 or x % 2 == 0 else B["rim2"]
        elif y == -rim_rows:
            c = B["rim2"]
        px.put(x, y, c)
    # a chunky, fleshy bell: only a little see-through, but the lit rim and the glowing spots
    glass_pass(px, inside, half, h, B, org & {q for q, c in px.d.items() if c in (B["spot"], B["l"])}, interior=0.86,
               band=2 if s == 1 else 1, margin=-rim_rows - 1)
    for k in range(9):  # specular arc
        a = math.radians(208 + k * 5)
        x, y = round(math.cos(a) * half * 0.74), round(math.sin(a) * h * 0.8)
        if (x, y) in inside:
            px.put(x, y, B["h"])
            if 2 <= k <= 5 and (x + 1, y) in inside:
                px.put(x + 1, y, B["h"])
    return px


BLUB_ARM = {"o": hx("1c2466", 235), "d": hx("3a4ca6", 235), "m": hx("7896e0", 235), "l": hx("bcd2fa", 235), "w": hx("f6f9ff", 240)}


def blubber_arms(frame, s=1.0, tr=TR_NEUTRAL, nf=4):
    px = Px()
    ph = frame / nf * 2 * math.pi
    q = TRAIL[tr]
    root = {TR_FAN: 1.2, TR_STREAM: 0.6}.get(tr, 0.7 if q["lean"] else 1.0)  # where the arms leave the pillar
    flare = {TR_FAN: 3.3, TR_STREAM: 0.1}.get(tr, 0.25 if q["lean"] else 1.0)  # how far they spread with depth
    pill = max(2, round(5 * s))
    for t in range(1, pill + 1):
        hw = round(4.5 * s - t * 0.3 * s)
        for o in range(-hw, hw + 1):
            px.put(o, t, BLUB_ARM["l"] if o < -hw / 3 else BLUB_ARM["m"] if o < hw / 2 else BLUB_ARM["d"])
    for idx, j in enumerate((1, 6, 3, 4, 0, 7, 2, 5)):  # back to front
        back = idx < 4
        f = j / 7 * 2 - 1
        x0 = f * 4.5 * s * root
        L = (17 + (j * 5) % 7) * s * (1 + (q["len"] - 1) * 0.9)
        cols = ((BLUB_ARM["o"], BLUB_ARM["d"], BLUB_ARM["m"], BLUB_ARM["l"]) if back
                else (BLUB_ARM["d"], BLUB_ARM["m"], BLUB_ARM["l"], BLUB_ARM["w"]))
        n = int(L)
        x = x0
        y = pill
        for t in range(n):
            u = t / L
            dx, dy = swept(u, L, q["lean"], 0.5)
            x = x0 + f * 3.5 * s * flare * u + 1.8 * s * q["amp"] * math.sin(ph - t * 0.2 * q["wave"] / s + j * 1.3) * u + dx
            y = pill + t + dy
            r = (2.3 - 0.7 * u) * s + (0.7 * s if (t + j * 2) % 3 == 0 else 0)
            if tr >= TR_STREAM:
                r *= 0.88
            disc(px, x, y, max(0.8, r), cols)
            if (t + j) % 3 == 1 and not back:  # cauliflower frills
                px.put(round(x - r), round(y), BLUB_ARM["w"])
                px.put(round(x + r - 1), round(y + 1), BLUB_ARM["l"])
        if tr == TR_NEUTRAL:  # the v2 tip sits one row past the last disc
            y = pill + n
        else:
            y += 1
        disc(px, x, y, 2.6 * s * (0.85 if tr >= TR_STREAM else 1), cols)
        tip = round(4 * s * (1.6 if tr >= TR_STREAM else 1))
        for d in range(1, tip + 1):  # terminal filament
            fx = x + math.sin(ph - L * 0.2 / s - d * 0.3 + j * 1.3) * d * 0.3 * q["amp"] + q["lean"] * d * 0.5
            px.over(round(fx), round(y) + round(2.6 * s) + d, BLUB_ARM["l"][:3] + (170,))
    return px


# ---- upside-down jelly (Cassiopea): bell down on the sand, frilly arms up. Origin = underside centre.

# v10: the settled Cassiopea pulses in place on the same curve: (rim lift, width) per frame. Polyps aside, it has 8.
UPS8 = [(0, 1.0), (-0.3, 1.03), (0.8, 0.99), (1.5, 0.97), (2.2, 0.95), (1.3, 0.97), (-0.5, 1.04), (-0.2, 1.01)]


def upside_bell(frame, p, s=1.0):
    U = UPSIDE[p]
    px = Px()
    lift, wm = UPS8[frame]
    rx = 19 * s * wm
    ry = 4.2 * s
    th = 3.2 * s
    lift = lift * s
    cyt = -th
    inside = {}
    for y in range(-round(th + ry + lift) - 2, 2):
        for x in range(-int(rx) - 1, int(rx) + 2):
            dx = (x + 0.5) / rx
            if abs(dx) > 1:
                continue
            curl = lift * abs(dx) ** 3
            yy = y + 0.5 + curl
            top = (dx * dx + ((yy - cyt) / ry) ** 2) <= 1
            lens = cyt <= yy <= -th * dx * dx
            if top or lens:
                inside[(x, y)] = "top" if top and yy <= cyt + ry * math.sqrt(max(0, 1 - dx * dx)) * 0.35 else "side"
    for (x, y), part in inside.items():
        dx = (x + 0.5) / rx
        if part == "top":
            ang = math.atan2((y + 0.5 - cyt) / max(ry, 1), dx)
            rad = math.hypot(dx, (y + 0.5 - cyt) / max(ry, 1))
            t = 0.75 - 0.35 * dx - 0.2 * (y - cyt) / ry
            c = [U["d"], U["m"], U["l"]][shade_index(t, 3, x, y, 0.7)]
            if rad < 0.22:
                c = U["ctr"]
            elif int((ang + math.pi) / (2 * math.pi) * 16) % 2 == 0 and rad > 0.55:
                c = U["l"] if c != U["d"] else U["m"]
            elif 0.5 < rad < 0.85 and (x * 7 + y * 13) % 11 == 0:
                c = U["spot"]
        else:
            t = 0.55 - 0.4 * dx
            c = [U["out"], U["d"], U["m"]][shade_index(t, 3, x, y, 0.6)]
        px.put(x, y, c)
    org = {q for q, c in px.d.items() if c in (U["spot"], U["ctr"])}
    for (x, y) in list(px.d):
        nb = [(x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))]
        if any(nb):
            px.put(x, y, U["out"] if (nb[0] or nb[2] or y > cyt) else U["rim"])
            org.discard((x, y))
    # v10 glow pass: a thick, fleshy bell lying on the sand stays opaque; it gets the lit rim and glowing spots
    glass_pass(px, set(inside), rx, th + ry, U, org, interior=1.0, edge=1.0, margin=1)
    for x in range(-int(rx * 0.85), int(rx * 0.85) + 1):  # contact shadow on the sand
        if not px.has(x, 1):
            px.put(x, 1, hx("2a1a10", 70))
    return px


UPS_ARM = {"o": hx("2a2a12"), "d": hx("5a5824"), "m": hx("88843a"), "l": hx("b4b05c"), "tip": hx("cdeea2"), "tip2": hx("eefad0"),
           "w": hx("f6f4e8"), "b": hx("6cc8e2")}
# the albino's arms: pink-white stems, pale aqua tips and vesicles
UPS_ARM_M = {"o": hx("6a4252"), "d": hx("b88a9c"), "m": hx("dcb4c2"), "l": hx("f4d8e0"), "tip": hx("c4fff0"), "tip2": hx("effffa"),
             "w": hx("ffffff"), "b": hx("86e6e0")}


def upside_arms(frame, s=1.0, UPS_ARM=UPS_ARM, nf=4):
    """Eight branching oral arms fanned upward: olive stems, frilly leafy clusters,
    white and blue vesicles, pale green tips. Gaps kept open so the arms read."""
    px = Px()
    ph = frame / nf * 2 * math.pi
    base_y = -3.2 * s - 1.5
    for idx, j in enumerate((0, 7, 1, 6, 2, 5, 3, 4)):  # outer arms behind, centre arms in front
        r2 = random.Random(70 + j)
        f = j / 7 * 2 - 1
        a0 = f * 0.9
        L = (14 - 2.5 * abs(f)) * s
        back = idx < 4
        stem = (UPS_ARM["o"], UPS_ARM["d"], UPS_ARM["d"], UPS_ARM["m"]) if back else (UPS_ARM["o"], UPS_ARM["d"], UPS_ARM["m"], UPS_ARM["l"])
        leaf = (UPS_ARM["d"], UPS_ARM["m"], UPS_ARM["l"], UPS_ARM["tip"]) if back else (UPS_ARM["m"], UPS_ARM["l"], UPS_ARM["tip"], UPS_ARM["tip2"])
        x, y = f * 6.5 * s, base_y + abs(f) * 1.5 * s
        steps = int(L * 2)
        for st in range(steps):
            u = st / steps
            # v10: the sway travels out along the arm from the bell (phase delay with distance)
            ang = a0 * (0.55 + 0.6 * u) + 0.26 * math.sin(ph - u * 2.6 + j * 0.9) * u * u
            x += math.sin(ang) * 0.5
            y -= math.cos(ang) * 0.5
            disc(px, x, y, max(0.6, (0.9 - 0.3 * u) * s), stem)
            if u > 0.4 and st % 4 == 1:  # side branchlet ending in a frilly cluster
                side = 1 if (st // 4) % 2 else -1
                bl = r2.uniform(1.6, 2.8) * s
                ba = ang + side * 0.9
                bx, by = x + math.sin(ba) * bl, y - math.cos(ba) * bl
                for q in range(1, 4):
                    px.put(round(x + math.sin(ba) * bl * q / 4), round(y - math.cos(ba) * bl * q / 4), stem[2])
                disc(px, bx, by, r2.uniform(0.9, 1.4) * s, leaf)
                if r2.random() < 0.55:
                    px.put(round(bx), round(by), UPS_ARM["w"] if r2.random() < 0.6 else UPS_ARM["b"])
        for q in range(3):  # leafy terminal cluster
            ca = ang + (q - 1) * 0.8
            disc(px, x + math.sin(ca) * 1.3 * s, y - math.cos(ca) * 1.3 * s, 1.3 * s, leaf)
        px.put(round(x), round(y - 1), UPS_ARM["w"])
    for _ in range(round(10 * s)):  # vesicles scattered over the mass
        r3 = random.Random(_ * 7 + 3)
        vx, vy = r3.uniform(-12, 12) * s, base_y - r3.uniform(2, 11) * s
        if px.has(round(vx), round(vy)):
            px.put(round(vx), round(vy), UPS_ARM["b"] if _ % 3 == 0 else UPS_ARM["w"])
    edge_recolor(px, UPS_ARM["o"])
    return px


# ---- comb jelly (ctenophore): glassy egg, 8 rainbow comb rows, two long tentacles. Origin = body centre.

COMB_R = (13, 18)


def comb_body(frame, p, s=1.0):
    C = COMB[p]
    rx, ry = COMB_R[0] * s, COMB_R[1] * s
    px = Px()

    def hw(y):
        dy = (y + 0.5) / ry
        return rx * (1 + 0.1 * dy) * math.sqrt(max(0, 1 - dy * dy))

    inside = set()
    for y in range(-math.ceil(ry), math.ceil(ry) + 1):
        for x in range(-math.ceil(rx) - 2, math.ceil(rx) + 2):
            if abs(x + 0.5) <= hw(y):
                inside.add((x, y))
    for x, y in inside:
        w = max(hw(y), 0.5)
        dx, dy = (x + 0.5) / w, (y + 0.5) / ry
        r = min(1, math.sqrt(((x + 0.5) / rx) ** 2 + dy * dy))
        fres = r ** 3
        c = mix(C["body"], C["edge"], fres)[:3] + (round(40 + 120 * fres),)
        px.put(x, y, c)
    pr = (0.24 * rx, 0.42 * ry)  # pharynx
    for x, y in inside:
        if ((x + 0.5) / pr[0]) ** 2 + ((y + 0.5 - 0.25 * ry) / pr[1]) ** 2 <= 1:
            px.put(x, y, mix(px.get(x, y), C["inner"], 0.6)[:3] + (110,))
    for x, y in inside:
        if any((x + a, y + b) not in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            lit = (x + 0.5) * 0.6 + (y + 0.5) < 0
            px.put(x, y, C["edge"][:3] + (220,) if lit else C["deep"][:3] + (200,))
    px.put(0, -math.ceil(ry) + 1, hx("ffffff", 230))  # statocyst
    px.put(-1, -math.ceil(ry) + 2, hx("ffffff", 140))
    rows = set()
    for ri in range(8):
        phi = math.radians(11.25 + 45 * ri)
        front = math.cos(phi) > 0
        sx = math.sin(phi)
        y0, y1 = round(-0.8 * ry), round(0.74 * ry)
        for n, y in enumerate(range(y0, y1 + 1)):
            x = math.floor(sx * hw(y) * 0.92)
            wave = math.sin(2 * math.pi * (n / 10 - frame / 4) + ri * 0.9)
            bright = wave > 0.0
            a = (255 if bright else 110) * (1 if front else 0.4) * C["comb"]
            col = rainbow(n // 2 + ri + frame, C["sat"], round(a)) if bright else hx("dff8ff", round(a * 0.8))
            (px.put if front else px.over)(x, y, col)
            if front and bright:
                rows.add((x, y))
    # v10 glow pass: a lit rim on the glass and the lit comb plates glowing into the body around them
    # (band 0: the glass already carries its own lit edge; a solid band would wall it in)
    glass_pass(px, inside, rx, ry, {"l": C["edge"], "h": hx("ffffff", 235)}, rows, interior=1.0, edge=1.0, margin=ry + 2, band=0)
    for k in range(6):  # specular
        a = math.radians(212 + k * 7)
        x, y = math.floor(math.cos(a) * rx * 0.7), math.floor(math.sin(a) * ry * 0.72)
        px.put(x, y, hx("ffffff", 200))
    return px


def comb_tentacles(frame, s=1.0, tr=TR_NEUTRAL, nf=4):
    px = Px()
    ph = frame / nf * 2 * math.pi
    q = TRAIL[tr]
    rx, ry = COMB_R[0] * s, COMB_R[1] * s
    L = round(64 * s * {TR_FAN: 0.92}.get(tr, q["len"]))
    flare = {TR_FAN: 14, TR_STREAM: 1.5}.get(tr, 2.5 if q["lean"] else 8)
    amp = {TR_FAN: 8, TR_STREAM: 1.8}.get(tr, 2.4 if q["lean"] else 6)
    pinch = {TR_STREAM: 0.55}.get(tr, 0.3 if q["lean"] else 0)  # pull the pair together into one wake
    fall = 0.88 if tr == TR_FAN else 0.95
    for side in (-1, 1):
        x0, y0 = side * 0.7 * rx, 0.05 * ry
        pts = []
        for t in range(L):
            u = t / L
            x = x0 * (1 - pinch * smoothstep(u * 2.5)) + side * flare * s * min(1, u * 3) ** 0.7
            x += amp * s * math.sin(ph - t * 0.075 * q["wave"] / s + side * 1.4) * u ** 0.8
            dx, dy = swept(u, L, q["lean"], 0.62)
            pts.append((x + dx, y0 + t * fall + dy, t))
        back = side if not q["lean"] else -q["lean"]  # the side branches trail behind too
        for i, (x, y, t) in enumerate(pts):
            seg = [(x, y, t)] if tr == TR_NEUTRAL else strand(pts[i:i + 2])[:-1] or [(x, y, t)]
            for sx, sy, _ in seg:
                px.over(round(sx), round(sy), hx("ffe0f0", 170))
            if t > 8 and t % 4 == 2:
                for d in (1, 2):
                    px.over(round(x) + back * d, round(y) + d, hx("ffb8da", 120 - d * 30))
    return px


# ---------------------------------------------------------------- v6 species (k 4..8)
# 4 fried egg (Cotylorhiza), 5 sea nettle (Chrysaora), 6 crystal (Aequorea), 7 flower hat (Olindias),
# 8 lion's mane (Cyanea). Healthy palettes are hand-picked; pale and flush derive from them.
FRIED, NETTLE, CRYSTAL, FLOWER, LION = range(4, 9)


def derive_pals(base):
    """healthy / pale / flush from one healthy palette: pale drains toward a cold grey, flush warms toward pink."""
    grey, pink = hx("9aa6ba"), hx("ff6ab4")
    out = {"h": dict(base), "p": {}, "r": {}}
    for key, c in base.items():
        out["p"][key] = mix(c, grey, 0.6)[:3] + (c[3],)
        out["r"][key] = mix(c, pink, 0.32)[:3] + (min(255, c[3] + 15),)
    return out


NEW = {
    FRIED: derive_pals(pal(235, out="7a5a2a", d="c9b07a", m="e8d6a6", l="f8eccc", h="fffaf0", rim="d6bf8a", cav="a08850",
                          stripe="e8d6a6", can="fff4dc", yo="8a4a10", yd="d88a18", ym="f4b62a", yl="ffd85a", yh="fff2b0",
                          arm="f2e2bc", armd="b89a64", knob="8a5cd8", knobl="c8a8ff")),
    NETTLE: derive_pals(pal(238, out="6a2410", d="c46a1e", m="e89a34", l="f8c260", h="fff2c8", rim="ffd88a", cav="8a3a14",
                           stripe="7a2a18", can="ffe2a0", arm="fbeedd", armm="ecd2b0", armd="b88a6a", tent="8a2a2a", tentd="5a1818")),
    CRYSTAL: derive_pals(pal(90, out="9fdcef", d="bfe8f4", m="d8f4fa", l="eefcff", h="ffffff", rim="e4fbff", cav="8fc8dc",
                            stripe="d8f4fa", can="ffffff", dot="7dffb8", tent="e6faff", tentd="b8e6f2")),
    FLOWER: derive_pals(pal(170, out="8a5a6a", d="caa2a8", m="e6c6c4", l="f6e2dc", h="fff8f4", rim="f4dcd4", cav="a07888",
                           stripe="ff7ab4", can="9af0a0", tent="d8c0b8", tentd="a88a88")),
    LION: derive_pals(pal(244, out="4a0c0c", d="8e1e14", m="c2381e", l="e8662a", h="ffc890", rim="f49a48", cav="5a1210",
                         stripe="e45a24", can="ffb070", arm="f06a2a", armm="c8401c", armd="7a1a10", tent="ffc25a", tentd="e8963a")),
}
# v7 morphs: a rare colourway per species (real-world inspired where possible), over the healthy palette
MORPH = {
    FRIED: dict(yo="6e0a1e", yd="c0203a", ym="ec4458", yl="ff8890", yh="ffd6da"),  # strawberry: a pink-red yolk
    NETTLE: dict(out="4e3a7a", d="9a82cc", m="c0aaea", l="ded2fa", h="fbf8ff", rim="ece2ff", cav="5e4a90",
                 stripe="f6f0ff", can="f2eaff"),  # pastel nettle: lavender, pale stripes
    CRYSTAL: dict(out="2a5ad0", d="4a84e8", m="78aaf4", l="b0d4ff", h="ffffff", rim="a0c8ff", cav="2a58b8",
                  stripe="78aaf4", can="e8f4ff", dot="4aa8ff", tent="d8ecff", tentd="9cc4f4"),  # sapphire crystal
    FLOWER: dict(out="3a1470", d="6a2ac0", m="9450e8", l="c08cff", h="f4e8ff", rim="d4b0ff", cav="4a1a90",
                 stripe="ff3ae0", can="3affd0", tent="b89ae8", tentd="7a5ab8"),  # neon: violet bell, electric tips
    LION: dict(out="120c40", d="2a2690", m="4a4cc8", l="7a84ec", h="d4dcff", rim="9aaaff", cav="140e4a",
               stripe="6a5ad8", can="b8c4ff", arm="8a9cf4", armm="5a68d0", armd="282a80", tent="c4e6ff",
               tentd="8cbcee"),  # blue lion's mane (Cyanea lamarckii): blue-violet bell, pale blue mane
}
MORPH_ALPHA = {CRYSTAL: 110}
for _k, _over in MORPH.items():
    NEW[_k]["m"] = {key: (hx(_over[key], MORPH_ALPHA.get(_k, c[3])) if key in _over else c) for key, c in NEW[_k]["h"].items()}
FLOWER_TIPS_M = ramp("39ff14", "ff2ef0", "00f0ff", "fff200", "ff5a1e")  # electric tips
# adult bell size and how flat the dome is (exponent on y: >2 flatter top, <2 rounder)
NEW_BELL = {FRIED: (60, 12, 2.6), NETTLE: (54, 34, 1.9), CRYSTAL: (58, 24, 2.2), FLOWER: (40, 30, 2.0), LION: (80, 40, 1.8)}
FLOWER_TIPS = ramp("ff5aa8", "a8ff5a", "b47aff", "ffe14d", "5ae0ff")


def dome(w, h, P_, s=1.0, expo=2.0, lappet=5, stripes=0, lobes=0, canals=0, cav=True, pinch=0.0, extra=None, glass=None):
    """A shaded jellyfish bell, origin = centre of the rim. P_ needs out d m l h rim cav stripe can.
    v10: `pinch` pulls the margin in (or flares it, < 0) for the pulse; `extra(px, inside)` draws more organs
    (returning their pixels) before the glow pass; `glass` overrides glass_pass keywords."""
    px = Px()
    half = w / 2
    inside = set()
    for y in range(-h, 1):
        for x in range(-int(half) - 2, int(half) + 2):
            dx, dy = (x + 0.5) / half, (y + 0.5) / h
            dx /= pinched(dx, dy, pinch)
            if abs(dx) ** 2 + abs(dy) ** expo <= 1:
                inside.add((x, y))
    rim_half = half * pinched(0, 0, pinch)
    if lobes:  # soft rounded notches between the rim lobes (lion's mane)
        depth = h * 0.24
        for k in range(1, lobes):
            xn = -rim_half + k * 2 * rim_half / lobes
            wid = 2 * rim_half / lobes * 0.26
            for (x, y) in list(inside):
                d = abs(x + 0.5 - xn) / wid
                if d < 1 and y > -depth * (1 - d * d):
                    inside.discard((x, y))
    if lappet:
        for x in range(-int(half) + 2, int(half) - 1):
            if x % lappet in (0, 1) and (x, 0) in inside:
                inside.add((x, 1))
    light = (-0.5, -0.8, 0.5)
    ln = math.sqrt(sum(v * v for v in light))
    lx, ly, lz = (v / ln for v in light)
    cav_ry = max(2, 6 * s)
    org = set()
    for x, y in inside:
        dx, dy = (x + 0.5) / half, (y + 0.5) / h
        dz = math.sqrt(max(0, 1 - dx * dx - min(1, dy * dy)))
        t = 0.18 + 0.82 * max(0, dx * lx + dy * ly + dz * lz)
        c = [P_["d"], P_["m"], P_["l"]][shade_index(t, 3, x, y, 0.8)]
        if stripes:
            ang = math.atan2((x + 0.5) / pinched(0, dy, pinch), -(y + 0.5) + h * 0.15)
            if math.sin(ang * stripes) > 0.55 and y > -h * 0.92:
                c = mix(P_["stripe"], P_["d"], 0.25) if t < 0.45 else P_["stripe"]
                org.add((x, y))
        in_cav = cav and (x + 0.5) ** 2 / max(1, rim_half - 4 * s) ** 2 + (y - 0.5) ** 2 / cav_ry ** 2 <= 1
        if in_cav:
            c = P_["cav"] if y > -cav_ry + 2 else P_["d"]
            org.discard((x, y))
        if any((x + a, y + b) not in inside for a, b in N4):
            c = P_["out"] if y < -2 else P_["rim"]
            org.discard((x, y))
        elif y >= -1 and not in_cav:
            c = P_["rim"]
        px.put(x, y, c)
    if canals:
        cy = -h * 0.5
        for k in range(canals):
            a = math.pi * (0.06 + 0.88 * k / max(1, canals - 1))
            for st in range(max(2, round(3 * s)), int(half), 2):
                x = round(-math.cos(a) * st * pinched(0, -0.5, pinch))
                y = round(cy + math.sin(a) * st * (h / half) * 0.95)
                if (x, y) in inside and px.get(x, y) not in (P_["out"], P_["rim"]):
                    px.over(x, y, P_["can"])
                    org.add((x, y))
    if extra:
        org |= set(extra(px, inside))
    glass_pass(px, inside, half, h, P_, org, band=2 if s == 1 and h >= 20 else 1, **(glass or {}))
    for k in range(10):  # specular streak
        a = math.radians(205 + k * 4.5)
        x, y = round(math.cos(a) * half * 0.72), round(math.sin(a) * h * 0.78)
        if (x, y) in inside:
            px.put(x, y, P_["h"])
            if 3 <= k <= 6 and (x + 1, y) in inside:
                px.put(x + 1, y, P_["h"])
    return px


def strands(px, ph, s, tr, n, xhalf, lmin, lmax, c1, c2, seed, amp=3.2, wave=0.16, depth=30, lenk=1.0):
    """n fine tentacles hanging from the rim, reacting to the trail pose like the moon jelly's."""
    r2 = random.Random(seed)
    q = TRAIL[tr]
    plot = px.put if tr in (TR_NEUTRAL, TR_FAN) else px.over
    n = max(3, round(n * (1 if s == 1 else s)))
    for i in range(n):
        x0 = -xhalf * s + i * 2 * xhalf * s / (n - 1)
        length = round((lmin + r2.randint(0, lmax - lmin)) * s * lenk)
        k = r2.random() * 6
        L = round(length * q["len"])
        pts = []
        for t in range(1, L):
            u = t / L
            x = gathered(x0, t, depth * s, q["spread"])
            x += amp * s * q["amp"] * math.sin(ph - t * wave * q["wave"] / s + k) * min(1, t / (10 * s))
            dx, dy = swept(u, L, q["lean"], 0.54)
            pts.append((x + dx, t + dy, c1 if t % 7 else c2))
        for x, y, c in strand(pts):
            plot(round(x), round(y), c)


def ribbons(px, ph, s, tr, xs, lens, width, cols, frill=True, knobs=None, root=0):
    """Frilled oral arms (moon-jelly style ribbons). cols = (light, mid, dark); knobs = (dark, light) dots."""
    q = TRAIL[tr]
    l_, m_, d_ = cols
    aspread = {TR_FAN: 1.55, TR_STREAM: 0.4}.get(tr, 0.55 if q["lean"] else 1.0)
    for j, x0 in enumerate(xs):
        x0 *= s
        length = round(lens[j % len(lens)] * s)
        L = round(length * (1 + (q["len"] - 1) * 0.7))
        for t in range(1, L):
            u = t / L
            x = gathered(x0, t, 22 * s, aspread)
            x += 2.6 * s * q["amp"] * math.sin(ph - t * 0.12 * q["wave"] / s + j * 1.9) * min(1, t / (8 * s))
            dx, dy = swept(u, L, q["lean"], 0.38)
            x, y = x + dx, round(t + dy + root)
            wdt = max(1, round((width - (width - 1) * 0.6 * t / L) * s * (0.85 if tr >= TR_STREAM else 1)))
            fr = 1 if frill and (t + j * 2) % 4 < 2 else 0
            for o in range(-wdt - fr, wdt + 1):
                c = d_ if o in (-wdt - fr, wdt) else l_ if o < 0 else m_
                px.over(round(x) + o, y, c)
            if knobs and (t + j) % 3 == 0 and t > 2:
                side = -1 if (t // 3 + j) % 2 else 1
                kx = round(x) + side * (wdt + 1)
                px.put(kx, y, knobs[0])
                px.put(kx, y - 1, knobs[1])


def new_bell(k, f, p, s=1.0):
    P_ = NEW[k][p]
    bw, bh, ex = NEW_BELL[k]
    fw, fh, pinch = PULSE8[f]
    w, h = max(8, round(bw * fw * s)), max(5, round(bh * fh * s))
    if k == FRIED:
        ry = max(3, round((9 + (1 if fh > 1.05 else 0)) * s))  # the yolk: a tall golden dome riding on the disc
        rx = max(4, round(13 * s * (0.94 if fw < 0.88 else 1.03 if fw > 1.03 else 1)))

        def yolk(px, inside):
            before = dict(px.d)
            blob(px, 0, -h * 0.55, rx, ry + h * 0.2, [P_["yo"], P_["yd"], P_["ym"], P_["yl"], P_["yh"]], flat=round(-h * 0.25))
            return [q for q, c in px.d.items() if before.get(q) != c]
        # the disc is the see-through part; the yolk glows warm through it
        return dome(w, h, P_, s, expo=ex, lappet=4, canals=12, pinch=pinch, extra=yolk, glass=dict(interior=0.7, margin=-1))
    if k == NETTLE:
        return dome(w, h, P_, s, expo=ex, lappet=3, stripes=16, pinch=pinch, glass=dict(interior=0.84, hue_keep=0.2))
    if k == CRYSTAL:
        rw = round(w * pinched(0, 0, pinch))

        def ring(px, inside):
            for x in range(-rw // 2 + 2, rw // 2 - 1, 3):  # the ring of green photocytes, faint by day
                px.put(x, -1, P_["dot"][:3] + (150,))
            return []
        return dome(w, h, P_, s, expo=ex, lappet=0, canals=26, cav=False, pinch=pinch, extra=ring,
                    glass=dict(interior=0.92, edge=1.6, min_a=60))
    if k == FLOWER:
        return dome(w, h, P_, s, expo=ex, lappet=0, stripes=8, canals=8, pinch=pinch, glass=dict(interior=0.7))
    return dome(w, h, P_, s, expo=ex, lappet=6, stripes=8, canals=10, pinch=pinch, glass=dict(interior=0.84, hue_keep=0.2))


def crystal_glow(f, s=1.0, core="b8ffd8", halo="5dffa0"):
    """Night photophores: bright dots on the rim plus a soft halo pixel around each (screen-blended)."""
    bw, bh, _ = NEW_BELL[CRYSTAL]
    w = round(round(bw * PULSE8[f][0] * s) * pinched(0, 0, PULSE8[f][2]))
    px = Px()
    for x in range(-w // 2 + 2, w // 2 - 1, 3):
        px.put(x, -1, hx(core, 255))
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            px.over(x + dx, -1 + dy, hx(halo, 110))
    return px


def new_tent(k, f, s=1.0, tr=TR_NEUTRAL, p="h", nf=4):
    px = Px()
    ph = f / nf * 2 * math.pi
    P_ = NEW[k][p]
    bw = NEW_BELL[k][0]
    if k == FRIED:  # eight stubby club arms with violet-tipped appendages
        ribbons(px, ph, s, tr, (-9, -6, -3, -1, 1, 3, 6, 9), (16, 20, 18, 22), 2.2, (P_["arm"], P_["l"], P_["armd"]),
                frill=False, knobs=(P_["knob"], P_["knobl"]))
    elif k == NETTLE:  # long maroon tentacles and four long frilly cream oral arms
        strands(px, ph, s, tr, 20, 25, 60, 95, P_["tent"][:3] + (175,), P_["tentd"][:3] + (190,), seed=11, amp=2.6)
        ribbons(px, ph, s, tr, (-6, -2, 2, 6), (66, 74, 70, 62), 2.8, (P_["arm"], P_["armm"], P_["armd"]))
    elif k == CRYSTAL:  # a fringe of many short glassy tentacles and a little mouth tube
        strands(px, ph, s, tr, 40, bw / 2 - 2, 22, 40, P_["tent"][:3] + (120,), P_["tentd"][:3] + (140,), seed=13, amp=2.0)
        ribbons(px, ph, s, tr, (0,), (10,), 2.0, (P_["l"], P_["m"], P_["d"]), frill=False)
    elif k == LION:  # a heavy mane of fine golden tentacles over frilly red curtains
        strands(px, ph, s, tr, 38, bw / 2 - 6, 80, 120, P_["tent"][:3] + (125,), P_["tentd"][:3] + (140,), seed=17, amp=2.4,
                wave=0.1)
        ribbons(px, ph, s, tr, (-10, -5, 0, 5, 10), (44, 52, 48, 50, 42), 3.4, (P_["arm"], P_["armm"], P_["armd"]))
    return px


def flower_tent(f, s=1.0, p="h", nf=4):
    """Flower hat: tentacles curl up and over the bell, each ending in a bright tip; a few hang below.
    Origin = rim centre (like the swimmers); the curls rise above the bell top."""
    px = Px()
    ph = f / nf * 2 * math.pi
    P_ = NEW[FLOWER][p]
    tips = FLOWER_TIPS_M if p == "m" else FLOWER_TIPS
    bw, bh, _ = NEW_BELL[FLOWER]
    half = bw / 2 * s
    n = max(6, round(14 * s))
    for i in range(n):
        u0 = i / (n - 1)
        x0 = -half + u0 * 2 * half
        side = -1 if x0 < 0 else 1
        out = (6 + 6 * abs(x0) / half) * s
        top = -(bh * 0.7 + 6 + 8 * (1 - abs(x0) / half)) * s
        p0, p1, p2 = (x0, 1), (x0 + side * out * 1.6, 6 * s), (x0 + side * out * 0.4, top)
        pts = bez(p0, p1, p2, n=max(14, round(30 * s)))
        # v10: a ripple travels from the rim out to the bright tip (phase delay along the curl)
        m = len(pts) - 1
        pts = [(x + 1.7 * s * math.sin(ph - q_ / m * 3.0 + i * 1.3) * (q_ / m) ** 1.4, y) for q_, (x, y) in enumerate(pts)]
        for q_, (x, y) in enumerate(pts):
            px.over(round(x), round(y), (P_["tent"] if q_ % 5 else P_["tentd"])[:3] + (200,))
        tx, ty = pts[-1]
        tip = tips[i % len(tips)]
        for dx, dy in ((0, 0), (1, 0), (0, -1), (1, -1)):
            px.put(round(tx) + dx, round(ty) + dy, tip)
        px.put(round(tx), round(ty) - 2, hx("ffffff", 220))
    for i in range(max(3, round(6 * s))):  # short hanging tentacles
        x0 = -half * 0.6 + i * (1.2 * half) / max(1, round(6 * s) - 1)
        for t in range(1, round((10 + i % 3 * 3) * s)):
            px.over(round(x0 + 1.2 * s * math.sin(ph - t * 0.3 + i)), t, P_["tentd"][:3] + (150,))
    return px


# ---- per species/stage frame sets: body(bf, pal) -> Px, tent(tf) -> Px

def moon_body(g, f, p):
    fw, fh, pinch = PULSE8[f]
    w, h = round(62 * fw), round(32 * fh)
    if g == 3:
        return bell(w, h, PAL_MOON[p], pinch=pinch)
    return bell(round(w * 0.6), round(h * 0.6), PAL_MOON[p], s=0.6, pinch=pinch)


def species_body(k, g, f, p):
    if g == 0:
        return polyp(f, k, p)
    if g == 1:
        return ephyra(f, k, p)
    s = 1.0 if g == 3 else 0.6
    if k == 0:
        return moon_body(g, f, p)
    if k == 1:
        fw, fh, pinch = PULSE8[f]
        return blubber_bell(round(50 * fw * s), round(30 * fh * s), p, s, pinch)
    if k == 2:
        return upside_bell(f, p, s)
    if k >= 4:
        return new_bell(k, f, p, s)
    return comb_body(f, p, s)


def ntf(g, tr):
    """v10: tentacle sway frames. Juvenile and adult neutral and fanned poses ripple in 8; the stream and trail
    poses (and polyps, ephyrae) keep 4, each shown for two of the 8 tf props."""
    return 8 if g >= 2 and tr in (TR_FAN, TR_NEUTRAL) else 4


def species_tent(k, g, f, tr=TR_NEUTRAL, p="h"):
    """Tentacles / arms, sway frame f of ntf(g, tr). p = "m" gives a morph's own tentacles (only for MORPH_TENT
    species, juvenile and adult)."""
    if g == 0:
        return polyp_motes(f)
    if g == 1:
        return ephyra_mouth(f, k)
    s = 1.0 if g == 3 else 0.6
    nf = ntf(g, tr)
    m = p == "m" and k in MORPH_TENT
    if k == 2:
        return upside_arms(f, s, UPS_ARM_M if m else UPS_ARM, nf=nf)
    if k == FLOWER:
        return flower_tent(f, s, "m" if m else "h", nf=nf)
    if k >= 4:
        return new_tent(k, f, s, tr, "m" if m else "h", nf=nf)
    if k == 0:
        return tentacles(f, s, tr, MOON_TENT_M if m else MOON_TENT, nf=nf)
    return [tentacles, blubber_arms, None, comb_tentacles][k](f, s, tr, nf=nf)


# species whose morph needs its own tentacles too (the rest keep their usual ones): the golden moon's arms go
# gold, the albino's arms pink-white, the neon flower hat's tips electric, the blue lion's mane pale blue
MORPH_TENT = (0, 2, FLOWER, LION)


def has_morph_tent(k, g):
    return g >= 2 and k in MORPH_TENT


def trails(k, g):
    """Juvenile and adult moon, blubber and comb trail. Polyps and settled upside-downs (arms up, on the
    sand) don't; an ephyra's mouth is too small to show it."""
    return g >= 2 and k not in (2, FLOWER)


SPECIES = ["moon", "blubber", "upside", "comb", "friedegg", "nettle", "crystal", "flowerhat", "lionsmane"]
STAGES = ["polyp", "ephyra", "juvenile", "adult"]
# halo colour per species (screen blend)
GLOW = {0: "ffb8ea", 1: "8fb4ff", 2: "d6f08a", 3: "9ff4ff", 4: "fff2a0", 5: "ffc078", 6: "9affd0", 7: "ffa6e0", 8: "ff9a5a"}


def food_art():
    px = Px()
    c = ramp("8a3a10", "e06a1e", "ff9f43", "ffd27a")
    for (x, y), i in {(0, 0): 3, (1, 0): 2, (2, 0): 1, (0, 1): 2, (1, 1): 2, (2, 1): 1, (1, 2): 0, (0, 2): 1}.items():
        px.put(x, y, c[i])
    return px


def sponge_art(trail=True):
    px = Px()
    yel = ramp("6a4a10", "c99220", "f2c43a", "ffe27a", "fff6c0")
    grn = ramp("123d22", "1e6a34", "33a04a")
    w, h = 26, 16
    for y in range(h):
        for x in range(w):
            if x in (0, w - 1) and y in (0, h - 1):
                continue
            if y >= h - 5:
                c = grn[2] if y == h - 5 else grn[1]
            else:
                c = yel[1 + shade_index(0.8 - y / h * 0.6 - x / w * 0.2, 4, x, y)]
            if x in (0, w - 1) or y in (0, h - 1):
                c = yel[0] if y < h - 5 else grn[0]
            px.put(x, y, c)
    r2 = random.Random(3)
    for _ in range(14):
        x, y = r2.randint(2, w - 3), r2.randint(2, h - 7)
        px.put(x, y, yel[1])
        px.put(x + 1, y, yel[2])
    if trail:
        for sx, sy, s in [(-6, 3, 2), (-12, 9, 1), (-17, 4, 2), (-23, 10, 1)]:
            for d in range(-s, s + 1):
                px.put(sx + d, sy, hx("ffffff"))
                px.put(sx, sy + d, hx("ffffff"))
    return px


def caustics(frame):
    px = Px()
    t = frame / 4 * 2 * math.pi
    for x in range(GLASS_L, CAVE_C - CAVE_A - 6):  # no sun reaches the cave floor
        for y in range(sand_top(x) + 1, WATER_BOT):
            v =(math.sin(x * 0.21 + t) + math.sin(y * 0.55 - x * 0.09 + t * 1.3)
                 + math.sin((x + y * 1.4) * 0.13 - t * 0.7))
            if abs(v) < 0.22:
                px.put(x, y, hx("fff3c0", 120))
    return px


# ---------------------------------------------------------------- v8: things you pick up, and grime on the glass
# The held food can and sponge are drawn by a tiny renderer: each is described in its own frame (a material
# ramp and a surface normal per point), sampled on the screen's pixel grid at any angle and lit from the
# upper left in SCREEN space, so a tipped can keeps its light where the room's light is. Then a selective
# outline: the darkest step of the local ramp on the shadow side, a mid step on the lit side.

_L3 = (-0.55, -0.75, 0.45)
_LN = math.sqrt(sum(v * v for v in _L3))
LIGHT3 = tuple(v / _LN for v in _L3)


def _hash2(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535


def vnoise(x, y, seed=0):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash2(ix, iy, seed), _hash2(ix + 1, iy, seed)
    c, d = _hash2(ix, iy + 1, seed), _hash2(ix + 1, iy + 1, seed)
    top = a + (b - a) * sx
    return top + (c + (d - c) * sx - top) * sy


def fbm(x, y, seed=0, octaves=3):
    v, amp, f, tot = 0.0, 1.0, 1.0, 0.0
    for o in range(octaves):
        v += vnoise(x * f, y * f, seed + o * 17) * amp
        tot += amp
        amp *= 0.5
        f *= 2
    return v / tot


def render_local(fn, angle_deg, reach, spec=0.3):
    """Sample fn(lx, ly) -> (ramp, (nx, ny, nz), bias) | (ramp, None, idx) | None over the screen grid
    around the origin, the object turned by angle_deg (clockwise on screen). A normal is turned with the
    object and lit by LIGHT3; `bias` nudges the light (paint, grooves). A None normal means a flat paint
    index. Returns (px, ramp_of) for the outline pass."""
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    px, ramp_of = Px(), {}
    for wy in range(-reach, reach + 1):
        for wx in range(-reach, reach + 1):
            cx, cy = wx + 0.5, wy + 0.5
            lx, ly = cx * ca + cy * sa, -cx * sa + cy * ca  # into the object's frame
            got = fn(lx, ly)
            if not got:
                continue
            rmp, nrm, extra = got
            n = len(rmp)
            if nrm is None:
                idx = max(0, min(n - 1, extra))
            else:
                nx, ny, nz = nrm
                wnx, wny = nx * ca - ny * sa, nx * sa + ny * ca  # the normal turns with the object
                d = wnx * LIGHT3[0] + wny * LIGHT3[1] + nz * LIGHT3[2]
                # a hard little specular: a half-vector toward the viewer
                hx_, hy_, hz_ = LIGHT3[0], LIGHT3[1], LIGHT3[2] + 1
                hn = math.sqrt(hx_ * hx_ + hy_ * hy_ + hz_ * hz_)
                sp = max(0.0, (wnx * hx_ + wny * hy_ + nz * hz_) / hn) ** 18
                t = 0.1 + 0.8 * max(0.0, d) + spec * sp + extra
                idx = max(1, min(n - 1, int(t * (n - 1) + bay(wx, wy) * 0.7 + 0.5)))
            px.put(wx, wy, rmp[idx])
            ramp_of[(wx, wy)] = rmp
    return px, ramp_of


def sel_outline(px, ramp_of, lit_idx=2):
    """Selective outline: edge pixels facing the light keep a mid step of their ramp; the rest go darkest."""
    out = dict(px.d)
    for (x, y), c in px.d.items():
        open_ = [(a, b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)) if (x + a, y + b) not in px.d]
        if not open_:
            continue
        ox = sum(a for a, _ in open_)
        oy = sum(b for _, b in open_)
        rmp = ramp_of.get((x, y))
        if not rmp:
            continue
        lit = ox * LIGHT3[0] + oy * LIGHT3[1] > 0.25
        out[(x, y)] = rmp[min(lit_idx, len(rmp) - 1)] if lit else rmp[0]
    px.d = out
    return px


# ---- the food can: a tin shaker with a ribbed aqua cap and a red label with a yellow fish.
# Origin = the spout (middle of the cap's top face, where the holes are); +y runs down the can.

R_TIN = ramp("1a1c34", "343c62", "5c6a94", "92a4c8", "c8d6ec", "f6faff")
R_LABEL = ramp("3a0c28", "761832", "be342e", "ea662a", "ffa244", "ffdc86")
R_CAP = ramp("08263a", "0f4c62", "177e8e", "2cb2b2", "72e2d2", "dcfff2")
R_FISHY = ramp("5e2c08", "b8700e", "f2b024", "ffe064", "fffad0")
R_FLAKE = ramp("7a2a0e", "d8581a", "ff9a3c", "ffd27a", "fff4c8")
CAN_HW, CAP_HW, CAN_LEN = 6.0, 6.6, 25.0
CAN_SCALE = 1.4  # drawn bigger than its design units: it's in your hand, nearer than the glass


def can_local(lx, ly):
    # the cap's top face, seen a little from above: an ellipse with the shaker holes
    if (lx / CAP_HW) ** 2 + ((ly + 0.4) / 1.9) ** 2 <= 1 and ly < 0.6:
        for hx_, hy_ in ((-3.2, -0.4), (-1.1, -1.1), (1.1, -1.1), (3.2, -0.4), (-1.1, 0.5), (1.1, 0.5)):
            if abs(lx - hx_) < 0.75 and abs(ly - hy_) < 0.6:
                return R_CAP, None, 0
        return R_CAP, (lx / CAP_HW * 0.35, -0.85, 0.4), 0.12
    if -0.4 <= ly < 4.6 and abs(lx) <= CAP_HW:  # ribbed cap side
        nx = lx / CAP_HW
        groove = -0.22 if (lx * 1.0 + 40) % 2.0 < 0.55 else 0.0
        return R_CAP, (nx, 0, math.sqrt(max(0.0, 1 - nx * nx))), groove
    if 4.6 <= ly < 5.6 and abs(lx) <= CAP_HW + 0.4:  # cap lip
        nx = lx / (CAP_HW + 0.4)
        return R_CAP, (nx, 0.35, math.sqrt(max(0.0, 1 - nx * nx))), -0.2
    if 5.6 <= ly < CAN_LEN - 0.6 and abs(lx) <= CAN_HW:
        nx = lx / CAN_HW
        nrm = (nx, 0, math.sqrt(max(0.0, 1 - nx * nx)))
        if 8.6 <= ly < 21.4:  # label
            if ly < 9.4 or ly >= 20.6:
                return R_FISHY, nrm, 0.05
            fx, fy = lx - 0.6, ly - 14.6
            if (fx / 3.3) ** 2 + (fy / 2.1) ** 2 <= 1:
                if abs(fx - 1.6) < 0.6 and abs(fy + 0.5) < 0.6:
                    return R_LABEL, None, 0
                return R_FISHY, nrm, 0.15
            if -5.4 <= fx < -2.9 and abs(fy) <= (-2.9 - fx) * 0.9 + 0.2:  # tail
                return R_FISHY, nrm, 0.05
            for bx, by in ((3.6, 11.4), (4.4, 10.3)):
                if abs(lx - bx) < 0.55 and abs(ly - by) < 0.55:
                    return R_LABEL, None, 5
            if 18.4 <= ly < 19.4 and math.sin(lx * 1.3) > -0.2:  # a cream wave under the fish
                return R_LABEL, nrm, 0.3
            return R_LABEL, nrm, 0.0
        return R_TIN, nrm, 0.0
    if CAN_LEN - 0.6 <= ly < CAN_LEN + 0.4 and abs(lx) <= CAN_HW - 0.6:  # bottom rim
        nx = lx / CAN_HW
        return R_TIN, (nx, 0.5, math.sqrt(max(0.0, 1 - nx * nx))), -0.25
    return None


def can_art(pour):
    """canF0 upright (spout at the pointer, the can hanging below it); canF1 tipped -135 degrees to pour,
    the can up and to the right of the pointer (the falling flakes are their own animated sprites)."""
    px, ramp_of = render_local(lambda lx, ly: can_local(lx / CAN_SCALE, ly / CAN_SCALE), -135 if pour else 0, 48)
    px = sel_outline(px, ramp_of)
    if pour:  # shake lines either side of the can's base: it's being shaken
        for pts in (((14, -31), (17, -34), (18, -38)), ((27, -20), (30, -21), (34, -22))):
            line_px(px, list(pts), hx("ffffff", 210), over=True)
    return px


def pour_flakes(frame):
    """A stream of flakes falling from the spout, three frames that drop a few px each."""
    px = Px()
    r2 = random.Random(70)
    flakes = [(r2.uniform(-3.2, 3.2), r2.uniform(0, 36), r2.choice([0, 0, 1, 2])) for _ in range(12)]
    for fx, fy, kind in flakes:
        y = (fy + frame * 4.2) % 36 + 2
        x = fx * (0.5 + y / 36) + math.sin(y * 0.4 + fx) * 0.8
        ix, iy = math.floor(x), math.floor(y)
        c = R_FLAKE
        if kind == 0:  # a flake like the ones in the water: lit top-left, dark bottom-right
            px.put(ix, iy, c[3])
            px.put(ix + 1, iy, c[2])
            px.put(ix, iy + 1, c[2])
            px.put(ix + 1, iy + 1, c[1])
        elif kind == 1:
            px.put(ix, iy, c[2])
            px.put(ix + 1, iy + 1, c[1])
        else:
            px.put(ix, iy, c[4] if y < 12 else c[3])
    return px


# ---------------------------------------------------------------- v11: more foods
# Three foods: flakes (the can), brine shrimp (a glass jar of tiny pink-orange shrimp) and plankton (a little
# green glass bottle of glowing green specks). Each pellet in the water shows as its kind (food{i}k0..2).
# The jar and the bottle are drawn like the can: in their own frame, sampled at any angle, lit from the
# upper left in screen space, then a selective outline. Origin = the mouth (where the food comes out).

R_BRINE = ramp("5a1420", "a3303a", "dc5a4c", "f78a62", "ffb98a", "ffe4c8")
R_JLID = ramp("1e2a12", "3e5a1a", "6a8e24", "9cbc34", "cfe266", "f4ffb4")   # a lime screw lid
R_GLASS = [hx("16323e", 235), hx("3e6c7c", 170), hx("7aa8b6", 120), hx("b4d8e2", 110), hx("e2f6fa", 150), hx("ffffff", 215)]
R_BGLASS = [hx("06261a", 240), hx("124a2e", 200), hx("1f7040", 170), hx("3a9c5a", 160), hx("86dc9a", 175), hx("e4fff0", 215)]
R_CORK = ramp("3a2010", "684020", "966434", "c4945a", "e6c08a")
R_PLK_LIQ = ramp("041a12", "0a3020", "10472c", "1a6238", "2a7e44")
R_PLK = ramp("2a8a3a", "5ad048", "a8f46a", "e8ffb0", "ffffff")
JAR_SCALE = BOTTLE_SCALE = CAN_SCALE


def _glass_edge(nx):
    """Fresnel: glass reads at its silhouette and is nearly clear face-on."""
    return abs(nx) > 0.8


def jar_local(lx, ly, lid):
    """The brine shrimp jar, mouth at y = 0, +y down the jar. A lime screw lid (when `lid`), a thick glass lip,
    rounded shoulders, and a body packed with tiny curled shrimp under a cream label."""
    HW = 7.0
    if lid:
        if (lx / 5.9) ** 2 + ((ly + 1.9) / 1.6) ** 2 <= 1 and ly < -1.0:  # the lid's top face
            return R_JLID, (lx / 5.9 * 0.35, -0.85, 0.4), 0.14
        if -1.9 <= ly < 1.6 and abs(lx) <= 5.9:  # knurled side
            nx = lx / 5.9
            groove = -0.24 if (lx + 40) % 1.6 < 0.5 else 0.0
            return R_JLID, (nx, 0, math.sqrt(max(0.0, 1 - nx * nx))), groove
    else:
        if (lx / 4.6) ** 2 + ((ly - 1.2) / 1.3) ** 2 <= 1 and ly < 1.2:  # the open mouth: shrimp at the top
            return R_BRINE, None, 2 if (math.floor(lx * 1.4) + math.floor(ly * 1.4)) % 3 else 4
    if 1.6 <= ly < 3.0 and abs(lx) <= 5.2:  # the lip
        nx = lx / 5.2
        return R_GLASS, (nx, -0.3, math.sqrt(max(0.0, 1 - nx * nx))), 0.1
    if ly < 3.0 or ly >= 22.0:
        return None
    if ly < 6.0:  # shoulders
        u = (ly - 3.0) / 3.0
        hw = 4.8 + (HW - 4.8) * math.sin(u * math.pi / 2)
    elif ly > 20.0:  # rounded base
        hw = HW - (ly - 20.0) ** 2 * 0.9
    else:
        hw = HW
    if abs(lx) > hw:
        return None
    nx = lx / HW
    nrm = (nx, 0.0 if 6 <= ly <= 20 else (-0.4 if ly < 6 else 0.4), math.sqrt(max(0.0, 1 - nx * nx)))
    if abs(lx) > hw - 0.9 or ly >= 21.2:
        return R_GLASS, nrm, 0.05
    if -3.6 <= lx <= -2.8 and 5.0 <= ly <= 19:  # a hard glint down the glass
        return R_GLASS, None, 5
    if ly < 4.6:  # air above the shrimp
        return R_GLASS, nrm, -0.1
    if 11.0 <= ly < 16.0 and abs(lx) < hw - 1.2:  # the label: cream paper, a little pink shrimp on it
        fx, fy = lx + 0.2, ly - 13.6
        ring = (fx / 2.6) ** 2 + (fy / 1.7) ** 2
        if 0.45 <= ring <= 1.15 and not (fx > 0.6 and fy < 0.4):
            return R_BRINE, None, 2
        if abs(fx - 2.0) < 0.5 and abs(fy + 0.9) < 0.5:
            return R_BRINE, None, 0
        if ly < 11.6 or ly >= 15.4:
            return R_CREAM, nrm, -0.15
        return R_CREAM, nrm, 0.12
    # packed shrimp: lighter curls, darker gaps, black eye dots
    n = vnoise(lx * 0.95 + 3, ly * 0.95, 51)
    if _hash2(math.floor(lx * 1.3 + 40), math.floor(ly * 1.3), 9) > 0.9:
        return R_BRINE, None, 0
    return R_BRINE, nrm, (n - 0.5) * 0.7


def bottle_local(lx, ly, cork):
    """The plankton bottle, mouth at y = 0: a cork (when `cork`), a narrow neck, a round body of green glass
    full of dark water and glowing green specks."""
    if cork:
        if -3.2 <= ly < 1.4 and abs(lx) <= 2.4 - (0.6 if ly < -2.4 else 0):
            nx = lx / 2.4
            pit = -0.3 if _hash2(math.floor(lx * 1.5 + 9), math.floor(ly * 1.5 + 9), 4) > 0.8 else 0.0
            return R_CORK, (nx, -0.5 if ly < -2.4 else 0, math.sqrt(max(0.0, 1 - nx * nx))), pit
    elif abs(lx) <= 1.6 and -0.2 <= ly < 1.6:  # open: the specks at the mouth
        return R_PLK, None, 3 if (math.floor(lx * 2) + math.floor(ly * 2)) % 2 else 1
    if 1.4 <= ly < 2.6 and abs(lx) <= 3.0:  # lip
        nx = lx / 3.0
        return R_BGLASS, (nx, -0.3, math.sqrt(max(0.0, 1 - nx * nx))), 0.1
    if ly < 2.6 or ly >= 22.6:
        return None
    if ly < 7.5:
        hw = 2.2
    elif ly < 12.0:  # a round shoulder
        u = (ly - 7.5) / 4.5
        hw = 2.2 + 4.3 * math.sin(u * math.pi / 2)
    elif ly > 20.0:
        hw = 6.5 - (ly - 20.0) ** 2 * 0.62
    else:
        hw = 6.5
    if abs(lx) > hw:
        return None
    nx = lx / 6.5 if ly >= 9 else lx / 2.2 * 0.8
    nrm = (nx, -0.45 if 7.5 <= ly < 12 else 0.0, math.sqrt(max(0.0, 1 - nx * nx)))
    if abs(lx) > hw - 0.9 or ly >= 21.8:
        return R_BGLASS, nrm, 0.05
    if -3.4 <= lx <= -2.6 and 11.5 <= ly <= 19.5 or (-1.3 <= lx <= -0.7 and 3.5 <= ly <= 7.0):  # glints
        return R_BGLASS, None, 5
    if ly < 9.2:  # the neck: air
        return R_BGLASS, nrm, -0.05
    h = _hash2(math.floor(lx * 1.2 + 30), math.floor(ly * 1.2), 23)
    if h > 0.86:  # a glowing speck
        return R_PLK, None, 4 if h > 0.95 else 3
    if h > 0.78:
        return R_PLK, None, 1
    return R_PLK_LIQ, nrm, 0.12


def jar_art(pour):
    """Upright with its lid on (on the shelf, or in hand at rest); pouring: lid off, tipped like the can."""
    px, ramp_of = render_local(lambda lx, ly: jar_local(lx / JAR_SCALE, ly / JAR_SCALE, not pour), -125 if pour else 0, 48)
    px = sel_outline(px, ramp_of)
    if pour:
        for pts in (((13, -30), (16, -33), (17, -37)), ((26, -19), (29, -20), (33, -21))):
            line_px(px, list(pts), hx("ffffff", 210), over=True)
    return px


def bottle_art(pour):
    px, ramp_of = render_local(lambda lx, ly: bottle_local(lx / BOTTLE_SCALE, ly / BOTTLE_SCALE, not pour), -120 if pour else 0, 48)
    px = sel_outline(px, ramp_of)
    if pour:
        for pts in (((12, -30), (15, -33), (16, -37)), ((25, -18), (28, -19), (32, -20))):
            line_px(px, list(pts), hx("ffffff", 210), over=True)
    return px


def shrimp_pellet(px, x, y, flip=False):
    """A tiny curled brine shrimp, 4 x 3, its middle at (x + 1, y + 1): a pink-orange C with a black eye."""
    cells = {(1, 0): 4, (2, 0): 3, (0, 1): 3, (3, 1): 1, (1, 2): 2, (2, 2): 1, (1, 1): 5}
    for (dx, dy), i in cells.items():
        px.put(x + (2 - dx if flip else dx), y + dy, R_BRINE[i])
    px.put(x + (3 if flip else -0), y + 0, R_BRINE[0])  # the eye


def plankton_pellet(px, x, y):
    """A glowing speck: a 2 x 2 core and a soft cross of light, its middle at (x + 1, y + 1)."""
    for (dx, dy), c in {(1, 1): R_PLK[4], (2, 1): R_PLK[3], (1, 2): R_PLK[3], (2, 2): R_PLK[2]}.items():
        px.put(x + dx - 1 + 1, y + dy - 1 + 1, c)
    for dx, dy in ((1, 0), (2, 0), (0, 1), (0, 2), (3, 1), (3, 2), (1, 3), (2, 3)):
        px.put(x + dx, y + dy, R_PLK[1][:3] + (120,))


def food_shrimp_art():
    px = Px()
    shrimp_pellet(px, 0, 0)
    return px


def food_plankton_art():
    """Drawn one px up-left of the flake's grid so its 2 x 2 core sits on the flake's middle."""
    px = Px()
    plankton_pellet(px, -1, -1)
    return px


def pour_shrimp(frame):
    """Brine shrimp tumbling out of the jar's mouth, three frames."""
    px = Px()
    r2 = random.Random(71)
    bits = [(r2.uniform(-3.4, 3.4), r2.uniform(0, 36), r2.random() < 0.5) for _ in range(10)]
    for fx, fy, flip in bits:
        y = (fy + frame * 4.2) % 36 + 2
        x = fx * (0.5 + y / 36) + math.sin(y * 0.4 + fx) * 0.8
        shrimp_pellet(px, math.floor(x) - 1, math.floor(y) - 1, flip)
    return px


def pour_plankton(frame):
    """A glittering trickle of green specks."""
    px = Px()
    r2 = random.Random(72)
    specks = [(r2.uniform(-2.6, 2.6), r2.uniform(0, 36), r2.random()) for _ in range(16)]
    for fx, fy, k in specks:
        y = (fy + frame * 4.2) % 36 + 2
        x = fx * (0.45 + y / 40) + math.sin(y * 0.5 + fx) * 0.7
        ix, iy = math.floor(x), math.floor(y)
        if k < 0.35:
            plankton_pellet(px, ix - 1, iy - 1)
        else:
            px.put(ix, iy, R_PLK[4] if k > 0.8 else R_PLK[3])
            px.over(ix + 1, iy, R_PLK[1][:3] + (110,))
    return px


# ---- the sponge: a chunky kitchen sponge, yellow foam over a green scouring pad, seen a little from above.
# Origin = its middle. Squished (pressed to the glass, scrubbing): wider and flatter, with suds.

R_FOAM = ramp("5a240a", "a65412", "de8e1e", "f6c03a", "ffe27e", "fffad6")
R_PAD = ramp("0a2818", "144a2a", "237236", "3e9c44", "7ccc5c")
R_SUDS_EDGE = hx("4a96c8")
R_SUDS_LIT = hx("d6f4ff")


def sponge_shape(squish):
    """Masks (front face, top face) and the pad row where the green starts, for a sponge that is
    `squish` (0 rest .. 1 pressed) flat."""
    hw = 15 + round(3 * squish)
    top, bot = -6 + round(3 * squish), 9 - round(1 * squish)
    pad = bot - 5 + round(squish)
    lid = 4 - round(squish)  # rows of top face
    front, upper = set(), set()
    for y in range(top, bot):
        bulge = 1 if squish and (y == top or y == bot - 1) else 0
        r = 1 if (y in (top, bot - 1)) else 0
        for x in range(-hw + r + bulge, hw - r - bulge):
            front.add((x, y))
    for k in range(lid):
        y = top - 1 - k
        for x in range(-hw + 2 + k, hw - (1 if k == lid - 1 else 0) + k - 1):
            upper.add((x, y))
    return front, upper, pad, hw, top, bot


def sponge_body(squish):
    px = Px()
    front, upper, pad, hw, top, bot = sponge_shape(squish)
    r2 = random.Random(41)
    for (x, y) in front:
        u, v = (x + hw) / (2 * hw), (y - top) / max(1, bot - top)
        rmp = R_PAD if y >= pad else R_FOAM
        t = 0.66 - 0.3 * u - 0.18 * v
        if not (x - 1, y) in front:
            t += 0.25
        if not (x + 1, y) in front or not (x, y + 1) in front:
            t -= 0.3
        if y == pad:
            t += 0.15  # the pad's top edge catches the light
        idx = max(1, min(len(rmp) - 1, int(t * (len(rmp) - 1) + bay(x, y) * 0.7 + 0.5)))
        px.put(x, y, rmp[idx])
    for (x, y) in upper:
        t = 0.95 - 0.25 * (x + hw) / (2 * hw)
        idx = max(2, min(len(R_FOAM) - 1, int(t * (len(R_FOAM) - 1) + bay(x, y) * 0.6 + 0.5)))
        px.put(x, y, R_FOAM[idx])
    # pores: little dark pits with a lit lower lip; flattened sideways when squished
    for _ in range(40 if not squish else 34):
        x, y = r2.randint(-hw + 2, hw - 3), r2.randint(top - len({yy for _, yy in upper}), pad - 2)
        if (x, y) not in front and (x, y) not in upper:
            continue
        on_top = (x, y) in upper
        px.put(x, y, R_FOAM[1] if not on_top else R_FOAM[2])
        if squish and (x + 1, y) in front:
            px.put(x + 1, y, R_FOAM[1])
        elif not squish and r2.random() < 0.5 and (x, y + 1) in front:
            px.put(x, y + 1, R_FOAM[4] if not on_top else R_FOAM[5])
    for _ in range(16):  # the pad's scratchy weave
        x, y = r2.randint(-hw + 2, hw - 3), r2.randint(pad + 1, bot - 2)
        if (x, y) in front:
            px.put(x, y, R_PAD[1] if r2.random() < 0.6 else R_PAD[4])
    ramp_of = {k: (R_PAD if k[1] >= pad and k in front else R_FOAM) for k in px.d}
    return sel_outline(px, ramp_of)


def bubble(px, cx, cy, r, fill_a=110):
    """A soap bubble: a lit rim on the upper left, a cool one on the lower right, a glint."""
    for y in range(math.floor(cy - r - 1), math.ceil(cy + r + 1)):
        for x in range(math.floor(cx - r - 1), math.ceil(cx + r + 1)):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            if d > r:
                continue
            if d > r - 1:
                c = R_SUDS_LIT if dx * LIGHT3[0] + dy * LIGHT3[1] > 0 else R_SUDS_EDGE
            else:
                c = hx("f2fbff", fill_a)
            px.put(x, y, c)
    if r >= 1.6:
        px.put(math.floor(cx - r * 0.45), math.floor(cy - r * 0.45), hx("ffffff"))


SUDS = [(-15, -3, 3.2), (-17.5, 1.5, 2.2), (-14, 4, 1.6), (15.5, -1, 3.0), (18, 3, 2.0), (16, -5.5, 1.7),
        (-7, -8, 2.6), (-3, -9.5, 1.8), (2, -8.5, 3.0), (8, -8, 2.2), (11.5, -7, 1.5), (-11, -7, 1.4),
        (-19, -2, 1.2), (20, -1.5, 1.1), (5, -11.5, 1.1)]


def sponge_suds(frame):
    px = Px()
    r2 = random.Random(90 + frame)
    for i, (x, y, r) in enumerate(SUDS):
        if (i + frame) % 5 == 0 and r < 2:  # small ones pop and come back
            continue
        wob = 0.35 * math.sin(frame * 2.1 + i * 1.7)
        bubble(px, x * 1.25 + r2.uniform(-0.3, 0.3), y * 1.25 - frame * 0.4 * (i % 2), max(1.0, r * 1.15 + wob))
    for k in range(6):  # loose foam dots
        x, y = r2.randint(-24, 24), r2.randint(-15, -8)
        px.put(x, y, hx("ffffff", 220))
    return px


def sponge_art_v8(squish):
    px = sponge_body(1 if squish else 0)
    if not squish:  # a couple of bubbles still clinging
        bubble(px, 13, -10.5, 1.9)
        bubble(px, 16.5, -7.5, 1.3)
    return px


# ---- dirt spots on the front glass: three kinds of grime, ~36-42 logical px across, origin = middle.
# Drawn fully dirty; the logic fades them with spot{i}o (a curve of dirt, so new ones read faintly).

R_ALGAE = ramp("0b2e26", "164a30", "2a6a34", "4c8e36", "86b444", "c8dc6a")
R_SMEAR = ramp("24120a", "45240f", "6c4019", "93622a", "b88a44", "d8b46e")
R_SPECK = ramp("2a160e", "54301a", "7e4e26", "a8743a")
R_CHALK = ramp("6a7a86", "a8b8c0", "d8e4e6", "f6fbfa")
SPOT_R = 22  # logical half extent the logic keeps clear of the glass edges


def spot_algae():
    """A green algae bloom: a lobed, fuzzy colony, denser and older in the middle, with spores around."""
    px = Px()
    R, seed = 19, 7
    hgt = {}
    for y in range(-23, 24):
        for x in range(-23, 24):
            cx, cy = x + 0.5, y + 0.5
            ang = math.atan2(cy, cx)
            rr = R * (0.6 + 0.55 * fbm(math.cos(ang) * 1.3 + 4, math.sin(ang) * 1.3 + 4, seed, 3))
            d = math.hypot(cx, cy)
            if d > rr:
                continue
            u = d / rr
            n = fbm(x * 0.24 + 9, y * 0.24 + 2, seed + 5, 3)
            if u > 0.72 and n + bay(x, y) * 0.35 < 0.45 + (u - 0.72) * 1.6:
                continue  # a patchy, dithered fringe
            hgt[(x, y)] = n + (1 - u) * 0.35
    for (x, y), h in hgt.items():
        gx = hgt.get((x + 1, y), h) - hgt.get((x - 1, y), h)
        gy = hgt.get((x, y + 1), h) - hgt.get((x, y - 1), h)
        lit = -(gx * LIGHT3[0] + gy * LIGHT3[1]) * 3.2
        t = 0.38 + lit + (h - 0.55) * 0.9
        idx = max(1, min(5, int(t * 5 + bay(x, y) * 0.8 + 0.5)))
        a = 235 if h > 0.5 else 200
        px.put(x, y, R_ALGAE[idx][:3] + (a,))
    for (x, y) in list(hgt):  # the colony's edge: a dark, slightly translucent rim
        if any((x + a, y + b) not in hgt for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            lit = any((x + a, y + b) not in hgt for a, b in ((-1, 0), (0, -1)))
            px.put(x, y, (R_ALGAE[2] if lit else R_ALGAE[0])[:3] + (225,))
    r2 = random.Random(12)
    for _ in range(9):  # spores and little satellite tufts
        a, d = r2.uniform(0, 2 * math.pi), r2.uniform(R * 0.95, R + 4.5)
        sx, sy = math.cos(a) * d, math.sin(a) * d
        rr = r2.choice([0.8, 1.2, 1.7])
        for y in range(math.floor(sy - 2), math.ceil(sy + 2)):
            for x in range(math.floor(sx - 2), math.ceil(sx + 2)):
                if math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= rr and not px.has(x, y):
                    up = (x + 0.5 - sx) + (y + 0.5 - sy) < 0
                    px.put(x, y, (R_ALGAE[4] if up else R_ALGAE[1])[:3] + (220,))
    for _ in range(14):  # dark filaments and yellow-green tips
        x, y = r2.randint(-13, 13), r2.randint(-13, 13)
        if px.has(x, y) and px.has(x + 1, y + 1):
            px.put(x, y, R_ALGAE[0][:3] + (235,))
            if px.has(x - 1, y - 1):
                px.put(x - 1, y - 1, R_ALGAE[5][:3] + (235,))
    return px


def spot_smear():
    """A brown smear: muck dragged across the glass in a short arc. Ragged, wavy edges; drag streaks along
    it; a dark dried rim; thin, lighter patches where it's spread thinnest; crumbs flicked off the end."""
    px = Px()
    curve = bez((-15, 7), (0, 13), (15, -7), 90)
    seed = 3
    cells = {}
    for y in range(-21, 21):
        for x in range(-21, 21):
            cx, cy = x + 0.5, y + 0.5
            best, bi = 1e9, 0
            for i, (qx, qy) in enumerate(curve):
                d = (qx - cx) ** 2 + (qy - cy) ** 2
                if d < best:
                    best, bi = d, i
            bt = bi / (len(curve) - 1)
            d = math.sqrt(best)
            qx, qy = curve[bi]
            i0, i1 = max(bi - 1, 0), min(bi + 1, len(curve) - 1)
            tx_, ty_ = curve[i1][0] - curve[i0][0], curve[i1][1] - curve[i0][1]
            tl = math.hypot(tx_, ty_) or 1
            side = ((cx - qx) * -ty_ + (cy - qy) * tx_) / tl
            ends = min(1, bt * 6, (1 - bt) * 4.5)  # rounded where it starts, frayed where it stops
            w = (5.5 + 4.5 * fbm(bt * 5 + (2 if side > 0 else 7), 0.5, seed)) * (0.45 + 0.55 * ends ** 0.6)
            w += 1.6 * (fbm(cx * 0.35, cy * 0.35, seed + 9) - 0.5)
            if d > w:
                continue
            if bt > 0.74 and vnoise(x * 0.7, y * 0.7, seed + 11) < (bt - 0.74) * 3.2:
                continue
            cells[(x, y)] = (d / max(w, 0.1), side, bt)
    for (x, y), (e, side, bt) in cells.items():
        streak = math.sin(side * 2.2 + 2.5 * fbm(bt * 10, side * 0.3, seed + 2))
        idx = 4 if streak > 0.6 else 3 if streak > -0.3 else 2
        if e < 0.55 and fbm(x * 0.32 + 5, y * 0.32, seed + 5) > 0.6:
            idx = 5
        a = 215 if idx < 5 else 175
        px.put(x, y, R_SMEAR[idx][:3] + (a,))
    for (x, y) in cells:  # the dried rim: darkest on the shadow side
        open_ = [(a_, b_) for a_, b_ in ((1, 0), (-1, 0), (0, 1), (0, -1)) if (x + a_, y + b_) not in cells]
        if open_:
            lit = sum(a_ for a_, _ in open_) * LIGHT3[0] + sum(b_ for _, b_ in open_) * LIGHT3[1] > 0.25
            px.put(x, y, R_SMEAR[2 if lit else 0][:3] + (235,))
        elif any((x + a_, y + b_) not in cells for a_, b_ in ((2, 0), (0, 2))):
            px.put(x, y, R_SMEAR[1][:3] + (225,))
    for sx, sy, rr in ((17, -12, 1.4), (19.5, -8, 1.0), (14.5, -16, 0.9), (-18, 11, 1.2), (8, 9, 1.0), (-6, -2, 0.8)):
        for y in range(math.floor(sy - 2), math.ceil(sy + 2)):
            for x in range(math.floor(sx - 2), math.ceil(sx + 2)):
                if math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= rr and not (x, y) in cells:
                    px.put(x, y, R_SMEAR[3 if (x + 0.5 - sx) + (y + 0.5 - sy) < 0 else 0][:3] + (225,))
    return px


def spot_speckles():
    """A speckle cluster: crusty brown and olive specks clumped together over a grimy film, with a few
    ochre rings where drips dried."""
    px = Px()
    r2 = random.Random(23)
    for y in range(-19, 20):  # the film that ties them together: sparse, dithered
        for x in range(-19, 20):
            d = math.hypot(x + 0.5, (y + 0.5) * 1.1)
            k = (1 - d / 19) * (0.55 + 0.7 * fbm(x * 0.18, y * 0.18, 31))
            if k > 0.2 and bay(x, y) + 0.5 < k * 1.25:
                px.put(x, y, R_SPECK[2][:3] + (85,))
    marks = []
    for _ in range(58):
        while True:
            x, y = r2.gauss(0, 7.5), r2.gauss(0, 6.5)
            if math.hypot(x, y) < 18:
                break
        roll = r2.random()
        kind = "ring" if roll < 0.1 else "big" if roll < 0.42 else "dot"
        rr = r2.uniform(2.4, 3.4) if kind == "ring" else r2.uniform(1.5, 2.6) if kind == "big" else r2.uniform(0.7, 1.3)
        marks.append((kind, x, y, rr, r2.random()))
    for kind, sx, sy, rr, tone in sorted(marks, key=lambda m: -m[3]):
        for y in range(math.floor(sy - rr - 1), math.ceil(sy + rr + 1)):
            for x in range(math.floor(sx - rr - 1), math.ceil(sx + rr + 1)):
                dx, dy = x + 0.5 - sx, y + 0.5 - sy
                lump = rr * (0.85 + 0.3 * vnoise(math.atan2(dy, dx) * 1.5 + sx, sy, 41))
                d = math.hypot(dx, dy)
                if d > lump:
                    continue
                up = dx * LIGHT3[0] + dy * LIGHT3[1] > 0
                if kind == "ring":
                    if d > lump - 1.05:
                        px.put(x, y, R_SMEAR[5 if up else 3])
                    else:
                        px.over(x, y, R_SMEAR[4][:3] + (70,))
                elif kind == "big":
                    edge = d > lump - 0.9
                    olive = tone < 0.35
                    dark, mid, hi = (R_ALGAE[0], R_ALGAE[2], R_ALGAE[3]) if olive else (R_SPECK[0], R_SPECK[1], R_SPECK[3])
                    px.put(x, y, dark if edge and not up else hi if up and d < lump * 0.55 else mid)
                else:
                    px.put(x, y, R_SPECK[0] if not up else R_SPECK[2])
    return px


SPOT_ART = [("SpotAlgae", spot_algae), ("SpotSmear", spot_smear), ("SpotSpeckle", spot_speckles)]


# ---- the Feed / Clean buttons while their tool is held: a gold ring round the button and a soft glow

def held_ring():
    px = Px()
    m = round_rect_mask(BTN_W + 6, BTN_H + 6, 9)
    inner = {(x + 3, y + 3) for x, y in round_rect_mask(BTN_W, BTN_H, 6)}
    gold = ramp("8a4a08", "d88a14", "ffc234", "ffe682", "fffbe0")
    for x, y in m:
        if (x, y) in inner:
            continue
        ring = {(x + a, y + b) in inner for a in (-1, 0, 1) for b in (-1, 0, 1)}
        near = True in ring
        u = (x + y) / (BTN_W + BTN_H + 12)
        if near:
            c = gold[4] if u < 0.25 else gold[3]
        else:
            c = gold[2] if u < 0.45 else gold[1]
        px.put(x - 3, y - 3, c)
    for x, y in list(px.d):  # the outermost pixels: a darker edge on the lower right, so it reads on the wood
        if any((x + a, y + b) not in px.d and (x + a + 3, y + b + 3) not in inner for a, b in ((1, 0), (0, 1))):
            if x > BTN_W // 2 or y > BTN_H // 2:
                px.put(x, y, gold[0])
    for gx, gy in ((-1, 6), (6, -1)):  # a glint at the top-left corner
        px.put(gx, gy, hx("ffffff"))
    return px


# ---------------------------------------------------------------- tank furniture + ui


METAL = ramp("15161f", "23253a", "34374f", "4c5070", "6c7194")


def frame_art():
    """Screen-fixed: the hood strip and the bottom rail, the full width of the screen. The side walls
    pan with the world (side_wall_art)."""
    px = Px()
    metal = METAL
    for y in range(0, HOOD):
        for x in range(0, LW):
            px.put(x, y, metal[4 if y == 0 else 3 if y == 1 else 1 if y < HOOD - 3 else 0])
    for y in range(WATER_BOT + 1, CAB_TOP):
        for x in range(0, LW):
            px.put(x, y, metal[3] if y == WATER_BOT + 1 else metal[1])
    for x in range(14, LW - 10, 32):
        px.put(x, 5, metal[4])
        px.put(x, 6, metal[0])
    return px


def cabinet_art():
    px = Px()
    for y in range(CAB_TOP, LH):
        for x in range(LW):
            yy = y - CAB_TOP
            if yy < 3:
                c = R_WOOD[5] if yy == 0 else R_WOOD[4]
            else:
                plank, py = (yy - 3) // 14, (yy - 3) % 14
                grain = math.sin(x * 0.11 + plank * 2.3 + math.sin(x * 0.03 + plank) * 3)
                t = 0.55 + 0.18 * grain - (0.25 if py == 13 else 0) + (0.12 if py == 0 else 0)
                c = R_WOOD[0] if py == 13 else R_WOOD[1 + shade_index(t, 4, x, y, 0.5)]
            px.put(x, y, c)
    return px


def round_rect_mask(w, h, r):
    m = set()
    for y in range(h):
        for x in range(w):
            cx, cy = min(max(x, r), w - 1 - r), min(max(y, r), h - 1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5:
                m.add((x, y))
    return m


BTN_W, BTN_H = 48, 50  # v11: a little narrower, so the wider tool shelf fits beside it


def button_art():
    px = Px()
    m = round_rect_mask(BTN_W, BTN_H, 6)
    for x, y in m:
        if any((x + a, y + b) not in m for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c = R_CREAM[0]
        elif y >= BTN_H - 5:
            c = R_CREAM[1]
        elif y <= 2 or x <= 2:
            c = R_CREAM[4]
        else:
            c = R_CREAM[2 + shade_index(0.75 - y / BTN_H * 0.3, 2, x, y, 0.4)]
        px.put(x, y, c)
    return px


def button_shadow():
    px = Px()
    for x in range(2, BTN_W - 2):
        px.put(x, BTN_H, hx("000000", 90))
        px.put(x, BTN_H + 1, hx("000000", 50))
    return px


def icon_food():
    px = Px()
    red = ramp("5a1418", "a0262a", "e04a46", "ff8a7a")
    can = ramp("33405a", "6c7f9e", "b5c5da", "eef4fa")
    lab = ramp("8a5a10", "e0a020", "ffd166")
    for y in range(8, 25):
        for x in range(7, 21):
            t = 0.9 - abs(x - 10.5) / 9
            c = lab[shade_index(t, 3, x, y, 0.5)] if 13 <= y <= 20 else can[shade_index(t, 4, x, y, 0.5)]
            if x in (7, 20) or y == 24:
                c = can[0]
            px.put(x, y, c)
    for y in range(4, 9):
        for x in range(6, 22):
            c = red[0] if x in (6, 21) or y == 8 else red[3] if y == 4 else red[2] if y < 7 else red[1]
            px.put(x, y, c)
    for x in range(11, 17):
        for y in range(15, 19):
            if ((x - 13.5) / 2.6) ** 2 + ((y - 16.5) / 1.6) ** 2 <= 1:
                px.put(x, y, hx("e06a1e"))
    px.put(10, 16, hx("e06a1e"))
    px.put(10, 17, hx("e06a1e"))
    for fx, fy in [(23, 18), (24, 22), (22, 25)]:
        px.put(fx, fy, hx("ff9f43"))
        px.put(fx + 1, fy, hx("e06a1e"))
    return px


def icon_clean():
    px = Px()
    for (x, y), c in sponge_art(trail=False).d.items():
        px.put(x, y + 10, c)
    for cx, cy, r in [(21, 4, 3), (15, 6, 2)]:
        for y in range(cy - r - 1, cy + r + 2):
            for x in range(cx - r - 1, cx + r + 2):
                if r - 0.9 <= math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + 0.1:
                    px.put(x, y, hx("4cc3e0"))
        px.put(cx - 1, cy - 1, hx("ffffff"))
    return px


def icon_sun():
    px = Px()
    sun = ramp("c06a10", "f09a20", "ffc93a", "fff0a0")
    cx, cy = 13, 13
    for k in range(8):
        a = k * math.pi / 4
        for s in range(9, 12):
            px.put(round(cx + math.cos(a) * s - 0.5), round(cy + math.sin(a) * s - 0.5), sun[1])
    for y in range(cy - 8, cy + 8):
        for x in range(cx - 8, cx + 8):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            if d <= 7:
                px.put(x, y, sun[0] if d > 6.2 else sun[1 + shade_index(0.7 - (dx + dy) / 14 * 0.6, 3, x, y, 0.4)])
    return px


def icon_moon():
    px = Px()
    moon = ramp("8a6a10", "d0a830", "f7e08a", "fff8d0")
    cx, cy, r = 12, 14, 9
    for y in range(cy - r - 1, cy + r + 2):
        for x in range(cx - r - 1, cx + r + 2):
            d1 = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            d2 = math.hypot(x + 0.5 - (cx + 5), y + 0.5 - (cy - 4))
            if d1 <= r and d2 > r - 1:
                edge = d1 > r - 1 or d2 < r
                px.put(x, y, moon[0] if edge else moon[1 + shade_index(0.7 - (x - cx) / r * 0.4, 3, x, y, 0.4)])
    for sx, sy in [(21, 6), (23, 13)]:
        for d in (-1, 0, 1):
            px.put(sx + d, sy, moon[3])
            px.put(sx, sy + d, moon[3])
    return px


def mini_icon(kind):
    px = Px()
    if kind == "food":
        blob(px, 5, 5, 4.2, 3.6, ramp("8a3a10", "e06a1e", "ff9f43", "ffd27a"))
    elif kind == "water":
        c = ramp("0f4a7a", "2a8fc8", "4cc3e0", "bff0ff")
        blob(px, 5, 6, 4, 4, c)
        for y in range(0, 4):
            for x in range(5 - y // 2 - 1, 5 + y // 2 + 1):
                px.put(x, y + 1, c[2] if x < 5 else c[1])
        px.put(4, 5, c[3])
    else:
        c = ramp("7a1a42", "d03a78", "ff6fa8", "ffc0d8")
        heart = set()
        for y in range(10):
            for x in range(11):
                fx, fy = (x + 0.5 - 5.5) / 5, (4 - (y + 0.5)) / 5
                if (fx * fx + fy * fy - 0.36) ** 3 - fx * fx * fy ** 3 <= 0:
                    heart.add((x, y))
        for x, y in heart:
            edge = any((x + a, y + b) not in heart for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            px.put(x, y, c[0] if edge else c[1 + shade_index(0.8 - (x + y) / 20, 3, x, y, 0.4)])
    return px


# ---------------------------------------------------------------- decorations (origin = base centre on the sand)

R_STONE = ramp("231d3a", "3b3a5c", "5a5f80", "8590a8", "b8c2cf", "e2e8ec")
R_ROOF = ramp("4a1424", "862434", "c4443e", "ec7656", "ffb08a")
R_IRON = ramp("24161e", "45262a", "73392c", "a35634", "cc8446", "e8b070")
R_BRASS = ramp("3a2410", "6e4416", "a8701e", "d8a838", "f4d470", "fff4c0")
R_PATINA = ramp("1e4a44", "347a6c", "5aaa94")
R_SHELL = ramp("4a3038", "8c6a6a", "c8aa9a", "ecdac4", "fffaf0")
R_MANTLE = ramp("1c1a66", "2a46b4", "3a88de", "6ad6ee", "c0f8ff")
R_MUSH = ramp("1e4a44", "2a9a80", "4cd0a8", "9af0cc")
R_MUSH_RIM = ramp("3a1e5a", "6a3a9a", "9a6ad0", "d0a8f4")


def shade_mask(px, mask, cols, dither=True):
    """cols = (outline, dark, mid, light, highlight). Light from the upper left: lit edges
    take light, shadow edges take the outline, one pixel in from the shadow edge is dark."""
    for x, y in mask:
        e = lambda a, b: (x + a, y + b) not in mask
        if e(1, 0) or e(0, 1):
            c = cols[0]
        elif e(-1, 0) or e(0, -1):
            c = cols[4] if (e(-1, 0) and e(0, -1)) else cols[3]
        elif e(2, 0) or e(0, 2):
            c = cols[1]
        else:
            c = cols[2] if not dither or bay(x, y) < 0.3 else cols[3] if (x + y) % 2 else cols[2]
        px.put(x, y, c)


def stroke_mask(pts, r):
    m = set()
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) * 3))
        for i in range(n + 1):
            cx, cy = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            for y in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 1):
                for x in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 1):
                    if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                        m.add((x, y))
    return m


def sand_mound(px, x0, x1, h, seed=1):
    r2 = random.Random(seed)
    for x in range(x0, x1 + 1):
        u = (x - x0) / max(1, x1 - x0) * 2 - 1
        top = -round(h * (1 - u * u)) - (1 if r2.random() < 0.3 else 0)
        for y in range(top, 1):
            px.put(x, y, R_SAND[5] if y == top else R_SAND[4] if y == top + 1 else R_SAND[3 if (x + y) % 3 else 2])


def castle_art():
    px = Px()

    def block(x0, x1, ytop, merlons=True):
        m = set()
        for y in range(ytop, 1):
            for x in range(x0, x1 + 1):
                m.add((x, y))
        if merlons:
            for x in range(x0, x1 + 1):
                if (x - x0) % 4 < 2:
                    m.add((x, ytop - 1))
                    m.add((x, ytop - 2))
        shade_mask(px, m, (R_STONE[0], R_STONE[1], R_STONE[2], R_STONE[3], R_STONE[4]))
        for x, y in m:  # brick courses
            row = (y - ytop) // 3
            if y > ytop and (y - ytop) % 3 == 0 and x0 < x < x1:
                px.put(x, y, R_STONE[1])
            elif (x - x0 + row % 2 * 2) % 5 == 0 and (y - ytop) % 3 != 0 and x0 < x < x1 and y > ytop:
                px.put(x, y, R_STONE[1])
        return m

    block(-6, 6, -21)                     # keep
    block(4, 12, -25)                     # right tower
    lt = block(-13, -5, -30, merlons=False)  # left tower, roofed
    roof = set()
    for y in range(-42, -29):
        hw = (y + 42) / 12 * 6.5
        for x in range(-9 - math.ceil(hw), -9 + math.ceil(hw) + 1):
            if abs(x + 8.5) <= hw + 0.5:
                roof.add((x, y))
    shade_mask(px, roof, (R_ROOF[0], R_ROOF[1], R_ROOF[2], R_ROOF[3], R_ROOF[4]), dither=False)
    for y in range(-48, -42):
        px.put(-9, y, R_IRON[1])
    for x, y in [(-8, -48), (-7, -48), (-6, -47), (-8, -47), (-7, -47), (-8, -46)]:
        px.put(x, y, R_CORAL[3] if y == -48 else R_CORAL[2])
    for y in range(-9, 1):  # arched door
        hw = 2.5 if y > -7 else 2.5 * math.sqrt(max(0, 1 - ((y + 7) / 2.6) ** 2))
        for x in range(-3, 3):
            if abs(x + 0.5) <= hw:
                px.put(x, y, hx("120e26") if x > -2 else hx("2a2650"))
    for wx, wy in [(-10, -24), (-10, -16), (8, -19), (0, -16)]:
        for d in range(3):
            px.put(wx, wy + d, hx("120e26"))
        px.put(wx - 1, wy, R_STONE[4])
    r2 = random.Random(4)
    for _ in range(22):  # moss
        x = r2.randint(-13, 12)
        y = r2.choice([0, -1, -2, -1, -21, -22, -25, -26])
        if px.has(x, y):
            px.put(x, y, r2.choice(R_KELP[2:5]))
    sand_mound(px, -15, 14, 2, seed=3)
    return px


def anchor_art():
    px = Px()
    ang = math.radians(24)

    def rot(u, v):  # local (u right, v up) -> pixel space, leaning right
        return (u * math.cos(ang) + v * math.sin(ang), -(v * math.cos(ang) - u * math.sin(ang)))

    m = set()
    lift = 3
    m |= stroke_mask([rot(0, 2 + lift), rot(0, 24 + lift)], 1.6)              # shank
    m |= stroke_mask([rot(-7, 19 + lift), rot(7, 19 + lift)], 1.3)             # stock
    arc = [rot(math.sin(a) * 9, lift + 9 - math.cos(a) * 9) for a in [i / 12 * 2.3 - 1.15 for i in range(13)]]
    m |= stroke_mask(arc, 1.5)                                            # arms
    for sgn in (-1, 1):                                                   # flukes
        tip = rot(sgn * 8.4, lift + 4.0)
        m |= stroke_mask([tip, rot(sgn * 11.5, lift + 7.5)], 1.6)
        m |= stroke_mask([tip, rot(sgn * 6.6, lift + 7.8)], 1.1)
    ring = set()
    rc = rot(0, 27 + lift)
    for y in range(math.floor(rc[1]) - 4, math.ceil(rc[1]) + 5):
        for x in range(math.floor(rc[0]) - 4, math.ceil(rc[0]) + 5):
            d = math.hypot(x + 0.5 - rc[0], y + 0.5 - rc[1])
            if 1.6 <= d <= 3.3:
                ring.add((x, y))
    m |= ring
    shade_mask(px, m, (R_IRON[0], R_IRON[1], R_IRON[2], R_IRON[3], R_IRON[4]))
    r2 = random.Random(8)
    for x, y in list(m):
        if r2.random() < 0.12 and px.get(x, y) == R_IRON[2]:
            px.put(x, y, R_IRON[1] if r2.random() < 0.5 else hx("8a4a2a"))
    sand_mound(px, -13, 11, 2, seed=5)
    return px


def helmet_art():
    px = Px()
    blob(px, 0, -11, 10.5, 10.5, R_BRASS[:5], flat=-1)
    for x in range(-13, 14):  # breastplate collar, mostly buried
        for y in range(-4, 1):
            if abs(x) <= 13 - (y + 4) * 0 and (abs(x) <= 12 or y > -3):
                c = R_BRASS[1] if y == -4 or abs(x) >= 12 else R_BRASS[2 if x > 2 else 3]
                px.put(x, y, c)
    for bx in (-10, -5, 5, 10):
        px.put(bx, -3, R_BRASS[4])
    cx, cy, r = -2, -11, 5.2  # front port
    for y in range(-18, -3):
        for x in range(-9, 5):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r - 1.4:
                px.put(x, y, hx("16263a") if (x - y) % 7 not in (0, 1) else hx("3a6a90"))
            elif d <= r:
                px.put(x, y, R_BRASS[4] if (x + 0.5 - cx) + (y + 0.5 - cy) < 0 else R_BRASS[1])
    px.put(cx - 2, cy - 2, hx("bfe8ff"))
    px.put(cx - 1, cy - 3, hx("bfe8ff"))
    for k in range(6):  # bolts
        a = k * math.pi / 3 + 0.3
        px.put(round(cx + math.cos(a) * (r + 0.6) - 0.5), round(cy + math.sin(a) * (r + 0.6) - 0.5), R_BRASS[5])
    for y in range(-14, -8):  # side port
        for x in range(6, 10):
            d = math.hypot((x + 0.5 - 8) / 1.8, (y + 0.5 + 11) / 2.8)
            if d <= 1:
                px.put(x, y, hx("16263a") if d < 0.6 else R_BRASS[1])
    for x in range(-2, 2):  # top valve
        px.put(x, -22, R_BRASS[3])
        px.put(x, -23, R_BRASS[4] if x < 0 else R_BRASS[2])
    r2 = random.Random(12)
    for _ in range(26):  # verdigris
        x, y = r2.randint(-10, 10), r2.randint(-20, -2)
        c = px.get(x, y)
        if c in (R_BRASS[1], R_BRASS[2]):
            px.put(x, y, r2.choice(R_PATINA))
    sand_mound(px, -15, 15, 4, seed=9)
    return px


CLAM_OPEN = (0.15, 0.4, 0.7, 1.0)


def clam_art(frame, pearl=False):
    """Giant clam, front view: two fluted valves with interlocking zigzag lips; when
    open, the blue mantle and a pearl show between them."""
    px = Px()
    o = CLAM_OPEN[frame]
    W = 15

    def lip(x):
        tri = abs(((x + 15) % 8) - 4) / 4
        return -7 - round(3 * tri)

    def bottom(x):
        return -round(5 * (x / (W + 0.5)) ** 4)

    gap = round(o * 7)
    low, up = set(), set()
    for x in range(-W, W + 1):
        for y in range(lip(x), bottom(x) + 1):
            low.add((x, y))
        top = -10 - gap - round(7 * (1 - (x / (W + 0.5)) ** 2)) + round(4 * (x / (W + 0.5)) ** 4)
        for y in range(top, lip(x) - gap + 1):
            up.add((x, y))
    if gap > 0:  # mantle + pearl in the gap
        for x in range(-W + 1, W):
            for y in range(lip(x) - gap, lip(x) + 1):
                t = (y - (lip(x) - gap)) / max(1, gap)
                c = R_MANTLE[1 + shade_index(0.9 - t * 0.6 - (x + W) / (4 * W), 4, x, y, 0.7)]
                if (x * 5 + y * 3) % 9 == 0:
                    c = hx("9a5ad8")
                px.put(x, y, c)
        if pearl and o >= 0.6:  # shop icon only; in the tank the pearl is its own node (prop `pearl`)
            disc(px, 0.5, lip(0) - 1.8, 2.4, (hx("8a8ab0"), hx("dcdcf0"), hx("f6f6ff"), hx("ffffff")))
    for m in (low, up):
        sub = Px()
        shade_mask(sub, m, (R_SHELL[0], R_SHELL[1], R_SHELL[2], R_SHELL[3], R_SHELL[4]))
        for (x, y), c in sub.d.items():
            ph = (x + 15) % 8
            if c != R_SHELL[0] and ph in (0, 7):  # flutes: shadow in each trough
                c = R_SHELL[1] if ph == 0 else R_SHELL[2]
            elif c != R_SHELL[0] and ph == 4:
                c = R_SHELL[4]
            px.put(x, y, c)
    sand_mound(px, -17, 17, 2, seed=11)
    return px


def mushroom_art():
    px = Px()
    for (cx, cy, rx, ry) in ((-8, -4, 7.5, 3.4), (7, -5, 6.5, 3.0), (-1, -10, 5.5, 2.6)):
        for y in range(cy, 1):
            px.put(round(cx), y, R_MUSH[0])
            px.put(round(cx) - 1, y, R_MUSH[1])
        m = set()
        for y in range(math.floor(cy - ry) - 1, math.ceil(cy + ry) + 1):
            for x in range(math.floor(cx - rx) - 1, math.ceil(cx + rx) + 1):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    m.add((x, y))
        for x, y in m:
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            rad = math.hypot(dx, dy)
            stripe = int((math.atan2(dy, dx) + math.pi) / (2 * math.pi) * 14) % 2
            if rad > 0.78:
                c = R_MUSH_RIM[2 if dy < 0 else 1]
            elif rad < 0.22:
                c = hx("e8fff4")
            else:
                c = R_MUSH[2 + stripe] if dy < 0.2 else R_MUSH[1 + stripe]
            if any((x + a, y + b) not in m for a, b in ((1, 0), (0, 1))):
                c = R_MUSH_RIM[0]
            px.put(x, y, c)
    sand_mound(px, -13, 12, 2, seed=13)
    return px


def mushroom_glow_art():
    """Neon tips for night: rims and mouths of the mushroom coral."""
    px = Px()
    base = mushroom_art()
    for (x, y), c in base.d.items():
        if c in (R_MUSH_RIM[2], R_MUSH_RIM[1]):
            px.put(x, y, hx("e6b0ff", 230))
        elif c == hx("e8fff4"):
            px.put(x, y, hx("b0fff0", 255))
        elif c == R_MUSH[3]:
            px.put(x, y, hx("7affd8", 200))
    return px


# ---- bubbler ----
# v13: the bubbler (decoration 5, shop item 24): a little stone volcano with an airstone in its crater, the kind
# every aquarium shop sells. A column of bubbles rises from the crater to the surface, each bubble on its own
# timeline (BubblerBub0..11, looping at different lengths), with a soft screen-blended shimmer of moving water
# behind them on a timeline of its own (BubblerShimmer). The logic (src/currents.ts) lifts jellies and food in it.
R_BASALT = ramp("16121e", "2a2434", "463c50", "665a6c", "908290", "c0b2b6")
R_GLAZE = ramp("4a1006", "962a0c", "d8541a", "f8923a", "ffd27a")  # painted lava: it's an ornament
BUB_LIP = 21         # logical px from the base point up to the crater's lip
BUB_TOP = WATER_TOP + 8  # where the bubbles pop (world y, logical): just under the surface line
BUB_BASE = SAND_BASE + 31  # its default base y (logical), as in DECOR


def bubbler_art():
    """The volcano, origin = base centre on the sand: a rough cone of dark stone lit from the upper left,
    glazed lava runs down from the lip, moss low on the shadow side, pebbles and a little sand at its foot."""
    px = Px()
    r2 = random.Random(24)
    light = (-0.55, -0.75, 0.45)
    ln = math.sqrt(sum(v * v for v in light))
    lx, ly, lz = (v / ln for v in light)
    half = {}
    m = set()
    for y in range(-BUB_LIP, 1):
        t = (y + BUB_LIP) / BUB_LIP  # 0 at the lip, 1 at the foot
        hw = 5.2 + 12.8 * t ** 1.45 + 0.8 * math.sin(y * 1.3 + 1) * t + (0.6 if y % 5 == 0 and t > 0.3 else 0)
        half[y] = hw
        for x in range(-20, 21):
            if abs(x + 0.5) <= hw:
                m.add((x, y))
    for y in range(-BUB_LIP - 1, -BUB_LIP + 1):  # the lip's rim, a touch wider than the cone's top
        for x in range(-6, 6):
            m.add((x, y))
    for x, y in sorted(m):
        hw = half.get(y, 4.6)
        u = max(-1.0, min(1.0, (x + 0.5) / hw))
        nz = math.sqrt(max(0.0, 1 - u * u))
        nx, ny = u * 0.9, -0.55  # a cone: leans back, faces up a little
        nl = math.sqrt(nx * nx + ny * ny + nz * nz)
        t = 0.12 + 0.88 * max(0.0, (nx * lx + ny * ly + nz * lz) / nl)
        if r2.random() < 0.1:
            t -= 0.16  # pitted stone
        idx = shade_index(t, len(R_BASALT) - 1, x, y) + 1
        if any((x + a, y + b) not in m for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            idx = 1 if u < -0.2 and y > -BUB_LIP else 0  # selective outline: the lit flank stays soft
        px.put(x, y, R_BASALT[min(idx, len(R_BASALT) - 1)])
    for x in range(-4, 4):  # the crater: a dark mouth with the airstone's cool glow deep in it
        px.put(x, -BUB_LIP - 1, R_BASALT[0])
        px.put(x, -BUB_LIP, R_BASALT[0] if abs(x + 0.5) > 2 else hx("3a5a6a") if abs(x + 0.5) > 1 else hx("7ab8c8"))
    for x in (-6, -5):
        px.put(x, -BUB_LIP - 1, R_BASALT[5])
    px.put(-6, -BUB_LIP, R_BASALT[4])
    px.put(4, -BUB_LIP - 1, R_BASALT[3])
    px.put(5, -BUB_LIP - 1, R_BASALT[2])
    # glazed lava runs from the lip: two-pixel ribbons, a hot core near the top, darkening to their ends
    for x0, length, lean, wob in ((-3, 15, -0.32, 0.8), (0, 9, 0.05, 1.2), (3, 18, 0.38, 0.7)):
        for k in range(length):
            y = -BUB_LIP + 1 + k
            x = round(x0 + lean * k + math.sin(k * wob) * 0.7)
            if (x, y) not in m or (x + 1, y) not in m:
                break
            f = k / length
            hot, warm = (R_GLAZE[4], R_GLAZE[3]) if f < 0.25 else (R_GLAZE[3], R_GLAZE[2]) if f < 0.7 else (R_GLAZE[2], R_GLAZE[1])
            px.put(x, y, hot if x < 0 else warm)
            px.put(x + 1, y, warm if x < 0 else R_GLAZE[1] if f > 0.5 else warm)
        px.put(x, y + 1, R_GLAZE[1]) if (x, y + 1) in m else None  # a drip at the end
    for _ in range(40):  # moss on the shadow side, low down
        x, y = r2.randint(3, 18), r2.randint(-9, 0)
        if (x, y) in m and r2.random() < 0.8:
            px.put(x, y, r2.choice(R_KELP[1:4]))
    for _ in range(12):
        x, y = r2.randint(-17, -5), r2.randint(-5, 0)
        if (x, y) in m:
            px.put(x, y, r2.choice(R_KELP[3:5]))
    for _ in range(10):  # glints of mica on the lit flank
        x, y = r2.randint(-12, -2), r2.randint(-18, -4)
        if (x, y) in m and px.get(x, y) in (R_BASALT[3], R_BASALT[4]):
            px.put(x, y, R_BASALT[5])
    for cx, cy, r in ((-18.5, -1.4, 2.2), (17.5, -1.0, 1.8), (-13, 0.2, 1.4), (21, 0.2, 1.1)):  # pebbles at its foot
        blob(px, cx, cy, r, r * 0.8, R_PEBBLE, rough=0.5, seed=round(cx))
    sand_mound(px, -22, 22, 2, seed=24)
    return px


def bubbler_fizz():
    """The column's smallest bubble: a 2x2 bead with a bright corner (bubble_art(1) reads as a letter)."""
    px = Px()
    for x, y, c in ((0, 0, hx("ffffff")), (1, 0, hx("dff8ff", 210)), (0, 1, hx("dff8ff", 210)), (1, 1, hx("bfefff", 120))):
        px.put(x - 1, y - 1, c)
    return px


def bubbler_icon():
    """The shop card's picture: the volcano with a few bubbles over the crater."""
    px = bubbler_art()
    for bx, by, r in ((-1, -BUB_LIP - 5, 2), (1, -BUB_LIP - 13, 2), (-1, -BUB_LIP - 21, 1)):
        for (x, y), c in (bubbler_fizz() if r == 1 else bubble_art(r)).d.items():
            px.over(bx + x, by + y, c)
    return px


# (rise frames, loop length, start frame, x offset, radius): bigger bubbles rise faster; the loops differ so the
# column never repeats the same pattern
BUB_SPECS = [(186, 214, 0, 0, 2), (172, 229, 40, 1, 2), (194, 241, 84, -1, 1), (160, 223, 120, 0, 3),
             (184, 251, 18, 1, 2), (176, 233, 150, -1, 2), (196, 263, 60, 0, 1), (168, 247, 100, 1, 3),
             (188, 271, 136, -1, 2), (176, 257, 196, 0, 2), (194, 239, 30, 1, 1), (164, 281, 220, 0, 3),
             (180, 227, 170, -1, 2), (170, 245, 76, 1, 2), (190, 259, 110, 0, 1), (174, 236, 206, -1, 2)]


def bubbler_inner():
    """What sits in the bubbler's Lift node, front to back: the volcano, its bubbles, the shimmer."""
    rise_to = BUB_TOP - BUB_BASE  # local logical y where they pop
    bubs = []
    for i, (rise, dur, start, dx, r) in enumerate(BUB_SPECS):
        bid = nid()
        art = bubbler_fizz() if r == 1 else bubble_art(r)
        bubs.append(image(f"BubblerBub{r}", art, lx=dx, ly=-BUB_LIP - 1, opacity=0, node_id=bid, node_name=f"BubblerBub{i}"))
        y0, end = -BUB_LIP - 1, start + rise
        # a loop that runs past its end wraps round: the bubble spends `start` frames of the next loop rising
        if end <= dur:
            ys = [(start, y0 * P), (end, rise_to * P)]
            op = [(0, 0), (start, 0), (start + 4, 1), (end - 3, 1), (end, 0)]
        else:
            frac = (dur - start) / rise
            mid_y = round((y0 + (rise_to - y0) * frac) * P)
            ys = [(0, mid_y), (end - dur, rise_to * P), (end - dur + 1, y0 * P), (start, y0 * P), (dur, mid_y)]
            op = [(0, 1), (end - dur - 3, 1), (end - dur, 0), (start, 0), (start + 4, 1), (dur, 1)]
        xs = [(f, (dx + round(math.sin(f / 23 + i * 1.7) * 1.4)) * P) for f in range(0, dur + 1, 30)]
        add_anim(f"BubblerBub{i}", dur, [keys(bid, 14, ys, "linear"), keys(bid, 13, xs, "cubic"), keys(bid, 18, op, "linear")])
    sid = nid()
    h = (-BUB_LIP - rise_to) * P
    shimmer = rect_shape("BubblerShimmer", -9 * P, rise_to * P, 18 * P, h,
                         lin_grad(-9 * P, 0, 9 * P, 0, [(0, hx("dff8ff", 0)), (0.5, hx("dff8ff", 34)), (1, hx("dff8ff", 0))]),
                         blend="screen", sid=sid)
    add_anim("BubblerShimmer", 150, [keys(sid, 18, [(0, 0.55), (75, 1), (150, 0.55)], "cubic")])
    return [image("Bubbler", bubbler_art())] + list(reversed(bubs)) + [shimmer]
# ---- end bubbler ----


# ---------------------------------------------------------------- pixel font

FONT = {
    "A": ".#.|#.#|###|#.#|#.#", "B": "##.|#.#|##.|#.#|##.", "C": ".##|#..|#..|#..|.##", "D": "##.|#.#|#.#|#.#|##.",
    "E": "###|#..|##.|#..|###", "F": "###|#..|##.|#..|#..", "G": ".##|#..|#.#|#.#|.##", "H": "#.#|#.#|###|#.#|#.#",
    "I": "###|.#.|.#.|.#.|###", "J": "..#|..#|..#|#.#|.#.", "K": "#.#|#.#|##.|#.#|#.#", "L": "#..|#..|#..|#..|###",
    "M": "#...#|##.##|#.#.#|#...#|#...#", "N": "#..#|##.#|#.##|#..#|#..#", "O": ".#.|#.#|#.#|#.#|.#.",
    "P": "##.|#.#|##.|#..|#..", "Q": ".##.|#..#|#..#|#.#.|.#.#", "R": "##.|#.#|##.|#.#|#.#", "S": ".##|#..|.#.|..#|##.",
    "T": "###|.#.|.#.|.#.|.#.", "U": "#.#|#.#|#.#|#.#|###", "V": "#.#|#.#|#.#|#.#|.#.", "W": "#...#|#...#|#.#.#|##.##|#...#",
    "X": "#.#|#.#|.#.|#.#|#.#", "Y": "#.#|#.#|.#.|.#.|.#.", "Z": "###|..#|.#.|#..|###",
    "0": "###|#.#|#.#|#.#|###", "1": ".#.|##.|.#.|.#.|###", "2": "##.|..#|.#.|#..|###", "3": "##.|..#|.#.|..#|##.",
    "4": "#.#|#.#|###|..#|..#", "5": "###|#..|##.|..#|##.", "6": ".##|#..|###|#.#|###", "7": "###|..#|.#.|.#.|.#.",
    "8": "###|#.#|###|#.#|###", "9": "###|#.#|###|..#|##.",
    "-": "...|...|###|...|...", "!": "#|#|#|.|#", ".": ".|.|.|.|#", ":": ".|#|.|#|.", "+": "...|.#.|###|.#.|...",
    "?": "##.|..#|.#.|...|.#.", "'": "#|#|.|.|.", "/": "..#|..#|.#.|#..|#..", " ": "..",
}


def text_width(s, scale=1):
    return sum((len(FONT[ch].split("|")[0]) + 1) * scale for ch in s) - scale


def draw_text(px, s, x, y, col, shadow=None, scale=1):
    for ch in s:
        rows = FONT[ch].split("|")
        for j, row in enumerate(rows):
            for i, b in enumerate(row):
                if b == "#":
                    for a in range(scale):
                        for c in range(scale):
                            if shadow:
                                px.put(x + i * scale + a, y + j * scale + c + scale, shadow)
                for a in range(scale):
                    for c in range(scale):
                        if b == "#":
                            px.put(x + i * scale + a, y + j * scale + c, col)
        x += (len(rows[0]) + 1) * scale
    return x


DIGITS_BIG = {
    "0": ".##.|#..#|#..#|#..#|#..#|#..#|.##.", "1": ".#..|##..|.#..|.#..|.#..|.#..|###.",
    "2": ".##.|#..#|...#|..#.|.#..|#...|####", "3": "###.|...#|...#|.##.|...#|...#|###.",
    "4": "#..#|#..#|#..#|####|...#|...#|...#", "5": "####|#...|###.|...#|...#|#..#|.##.",
    "6": ".##.|#...|#...|###.|#..#|#..#|.##.", "7": "####|...#|..#.|..#.|.#..|.#..|.#..",
    "8": ".##.|#..#|#..#|.##.|#..#|#..#|.##.", "9": ".##.|#..#|#..#|.###|...#|...#|.##.",
}


def big_digit(d):
    px = Px()
    for j, row in enumerate(DIGITS_BIG[str(d)].split("|")):
        for i, b in enumerate(row):
            if b == "#":
                px.put(i + 1, j + 1, hx("2a140c"))
    for j, row in enumerate(DIGITS_BIG[str(d)].split("|")):
        for i, b in enumerate(row):
            if b == "#":
                px.put(i, j, hx("fff2c8") if j < 3 else hx("ffd98a"))
    return px


# ---------------------------------------------------------------- sand dollar (the currency)

R_SD = ramp("5a3a2e", "a07a5c", "d4b490", "eedcbc", "fff8ea")


def sand_dollar(px, cx, cy, r):
    m = set()
    for y in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 1):
        for x in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 1):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                m.add((x, y))
    for x, y in m:
        dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
        t = 0.7 - 0.3 * dx - 0.35 * dy
        c = R_SD[2 + shade_index(t, 3, x, y, 0.5)]
        if any((x + a, y + b) not in m for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c = R_SD[0] if dx + dy > -0.3 else R_SD[1]
        px.put(x, y, c)
    if r < 4.5:
        for k in range(5):
            a = -math.pi / 2 + k * 2 * math.pi / 5
            px.put(math.floor(cx + math.cos(a) * r * 0.5), math.floor(cy + math.sin(a) * r * 0.5), R_SD[1])
        return
    for k in range(5):  # petal flower: filled petals with a darker edge
        a = -math.pi / 2 + k * 2 * math.pi / 5
        pet = set()
        for y in range(math.floor(cy - r), math.ceil(cy + r) + 1):
            for x in range(math.floor(cx - r), math.ceil(cx + r) + 1):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                u = (dx * math.cos(a) + dy * math.sin(a)) / (r * 0.66)
                v = (-dx * math.sin(a) + dy * math.cos(a)) / (r * 0.66)
                if 0.12 < u < 1 and abs(v) <= 0.26 * math.sin(u * math.pi):
                    pet.add((x, y))
        for x, y in pet:
            edge = any((x + a2, y + b2) not in pet for a2, b2 in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            px.put(x, y, R_SD[1] if edge else R_SD[2])
    px.put(math.floor(cx), math.floor(cy), R_SD[1])


def coin_icon(r=3.5):
    px = Px()
    sand_dollar(px, r, r, r)
    return px


def icon_shop():
    px = Px()
    sand_dollar(px, 13, 14, 11)
    for sx, sy in [(26, 4), (1, 22)]:
        for d in (-1, 0, 1):
            px.put(sx + d, sy, hx("fff6c8"))
            px.put(sx, sy + d, hx("fff6c8"))
    return px


# ---------------------------------------------------------------- sparkle burst

def sparkle_art(frame):
    px = Px()
    gold, white = hx("ffd86a"), hx("ffffff")
    for k in range(8):
        a = k * math.pi / 4 + (0.2 if frame else 0)
        rr = 13 if k % 2 == 0 else 9
        cx, cy = round(math.cos(a) * rr), round(math.sin(a) * rr)
        big = (k + frame) % 2 == 0
        n = 2 if big else 1
        for d in range(-n, n + 1):
            px.put(cx + d, cy, gold if abs(d) == n else white)
            px.put(cx, cy + d, gold if abs(d) == n else white)
    for d in range(-3 + frame, 4 - frame):
        px.put(d, 0, white if abs(d) < 2 else gold)
        px.put(0, d, white if abs(d) < 2 else gold)
    return px


# ---------------------------------------------------------------- v3 helpers (all face right at scaleX +1)

R_SNAIL_SHELL = ramp("3a1a10", "6e3418", "a8581e", "d88c34", "f4c060", "fff0b0")
R_SNAIL_BODY = ramp("1a2032", "34405c", "56688c", "8698bc", "bccce4")
R_SHRIMP_RED = ramp("5a0c16", "9a1626", "cc2a36", "ec5a52", "ff9a86")
R_SHRIMP_Y = ramp("7a3e16", "b8722a", "e0a44e", "f4d084", "fff0c4")
R_HSHELL = ramp("3e2018", "7a4430", "b87252", "e0a27a", "f6d0a8", "fff2e0")
R_CRAB = ramp("4a1010", "8e2418", "d0482a", "f07a44", "ffb07a", "ffe4c8")
EYE = hx("120a12")


def line_px(px, pts, col, over=False):
    """1-px polyline through float points."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) * 2))
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            (px.over if over else px.put)(math.floor(x), math.floor(y), col(i / n) if callable(col) else col)


def bez(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


def contact_shadow(px, x0, x1, y=1, a=70):
    for x in range(x0, x1 + 1):
        if not px.has(x, y):
            px.put(x, y, hx("2a1a10", a))


# ---- snail: golden mystery snail crawling on the front glass. Origin = centre of the shell.

def snail_art(frame):
    px = Px()
    B = R_SNAIL_BODY
    tail, front = (-9, 11) if frame == 0 else (-11, 13)
    sole = 6

    def top(x):
        if x < -4:
            return sole - max(0, round((x - tail) / (-4 - tail) * 2.6))
        if x <= 5:
            return 3
        u = (x - 5) / (front - 5)
        return round(3 - 3.2 * math.sin(math.pi * min(1, u * 1.1)) ** 0.6) if u < 0.93 else 4

    body = set()
    for x in range(tail, front + 1):
        for y in range(top(x), sole + 1):
            body.add((x, y))
    r2 = random.Random(31 + frame)
    for x, y in body:
        e = lambda a, b: (x + a, y + b) not in body
        if y == sole:
            c = B[0]
        elif e(1, 0):
            c = B[1]
        elif e(0, -1) or e(-1, 0):
            c = B[4] if x > 4 else B[3]
        elif y == sole - 1:
            c = B[2]
        else:
            c = B[3] if bay(x, y) < 0.2 else B[2]
        px.put(x, y, c)
    for x, y in body:  # golden flecks
        if px.get(x, y) in (B[2], B[3]) and r2.random() < 0.2:
            px.put(x, y, hx("e8c060") if r2.random() < 0.5 else B[4])
    for x in range(tail + 2, front - 1):  # rippling sole: the crawl wave
        if (x + frame * 2) % 4 == 0:
            px.put(x, sole, B[1])
    # tentacles: two eye stalks (far one darker), two short feelers at the front
    lean = 0 if frame == 0 else 1
    line_px(px, [(9.5, 2.5), (8.8 + lean * 0.5, -0.5), (9.2 + lean, -3.5)], B[1])
    line_px(px, [(10.5, 2.5), (11.3, -0.5), (12.6 + lean, -4.2)], B[3])
    for ex, ey, c in ((math.floor(9.2 + lean), -4, B[2]), (math.floor(12.6 + lean), -5, B[4])):
        px.put(ex, ey, EYE)
        px.put(ex - 1, ey, c)
    px.put(math.floor(12.6 + lean) - 1, -6, hx("ffffff"))
    line_px(px, [(front - 1, 4.5), (front + 1.6, 5.6)], B[3])
    line_px(px, [(front - 2, 5.2), (front + 0.6, 6.4)], B[2])
    # shell: shaded ball with a log-spiral suture, ridge highlights and an aperture lip
    shell = blob(px, 0, 0, 6.6, 6.2, R_SNAIL_SHELL, seed=4)
    b_ = math.log(2.1) / (2 * math.pi)
    cx_, cy_ = -0.8, -0.8
    for x, y in shell:
        dx, dy = x + 0.5 - cx_, y + 0.5 - cy_
        r = math.hypot(dx, dy)
        c = px.get(x, y)
        if c == R_SNAIL_SHELL[0]:
            continue
        if r < 0.9:
            px.put(x, y, R_SNAIL_SHELL[2])
            continue
        phi = math.atan2(-dy, dx)
        # radial distance (px) to the nearest turn of the suture r = r0 * e^(b(2πk - phi))
        best = min((r - 0.8 * math.exp(b_ * (2 * math.pi * kk - phi)) for kk in range(-1, 5)), key=abs)
        idx = R_SNAIL_SHELL.index(c) if c in R_SNAIL_SHELL else 3
        if abs(best) < 0.6:
            px.put(x, y, R_SNAIL_SHELL[1])
        elif 0.5 <= best < 1.4:  # the whorl bulges just outside the suture: lighter
            px.put(x, y, R_SNAIL_SHELL[min(5, idx + 1)])
    for x, y in ((3, 5), (4, 5), (5, 4), (5, 3), (6, 2)):  # aperture lip, where the body leaves the shell
        if (x, y) in shell:
            px.put(x, y, R_SNAIL_SHELL[5] if y > 2 else R_SNAIL_SHELL[4])
    px.put(-3, -4, hx("ffffff"))
    px.put(-2, -4, R_SNAIL_SHELL[5])
    px.put(-4, -3, R_SNAIL_SHELL[5])
    return px


def silhouette(px, col):
    s = Px()
    for (x, y), c in px.d.items():
        s.put(x, y, col[:3] + (round(col[3] * c[3] / 255),))
    return s


# ---- cleaner shrimp (Lysmata): red back split by a white dorsal stripe, yellow flanks, long white
# antennae. Origin = bottom-centre, standing on the sand. Frames 0-1 walk, 2-3 pick and eat.

def shrimp_art(frame, antennae=True):
    px = Px()
    pick = frame >= 2
    k = (0, 0, 0.22, 0.13)[frame]

    def dy(x):  # head-down shear for the pick frames
        return round(max(0, x + 6) * k)

    def yc(x):
        return (-9 + 0.034 * (x + 3) ** 2) if x < -3 else (-9 + 0.012 * (x + 3) ** 2)

    def th(x):
        if x < -8:
            return 1.6 + (x + 12) / 4 * 1.0
        if x < 0:
            return 2.6 + (x + 8) / 8 * 1.0
        if x < 9:
            return 3.6
        return max(0.6, 3.6 - (x - 9) / 4.5 * 3.0)

    # far-side legs first (behind the body)
    legs = (-3, 0, 3, 6, 8)
    for j, ax in enumerate(legs):
        sw = (1 if j % 2 == 0 else -1) * (1 if frame % 2 == 0 else -1) if not pick else 0
        by = round(yc(ax) + th(ax)) + dy(ax)
        line_px(px, [(ax + 1.5, by), (ax + 2.5 + sw * 0.5, by + 2), (ax + 2 - sw, 0.5)], hx("b8746a"))
    # tail fan
    ty = yc(-12)
    for x in range(-17, -12):
        hh = 1.5 + (-12 - x) * 0.45
        for y in range(math.floor(ty - hh), math.ceil(ty + hh * 0.7) + 1):
            edge = x == -17 or y in (math.floor(ty - hh), math.ceil(ty + hh * 0.7))
            c = R_SHRIMP_RED[1] if edge else R_SHRIMP_RED[3] if y < ty - 0.5 else R_SHRIMP_RED[2]
            if x == -17 and (y % 2 == 0):
                c = hx("fff6f0")
            px.put(x, y + dy(x), c)
    px.put(-15, math.floor(ty) - 1, hx("fff6f0"))
    px.put(-15, math.floor(ty) + 1, hx("fff6f0"))
    # body columns
    body = {}
    for x in range(-12, 14):
        c0, t0 = yc(x), th(x)
        for y in range(math.floor(c0 - t0 + 0.5), math.ceil(c0 + t0 - 0.5) + 1):
            v = (y + 0.5 - c0) / t0
            body[(x, y + dy(x))] = (v, x)
    for (x, y), (v, x0) in body.items():
        e = lambda a, b: (x + a, y + b) not in body
        if e(0, -1):
            c = hx("fffaf4")  # the white dorsal stripe
        elif e(0, 1) or e(1, 0):
            c = R_SHRIMP_Y[0] if v > 0 else R_SHRIMP_RED[0]
        elif v < 0.15:
            c = R_SHRIMP_RED[3] if v < -0.45 else R_SHRIMP_RED[2] if v < -0.1 else R_SHRIMP_RED[1]
        else:
            c = R_SHRIMP_Y[3] if v < 0.5 else R_SHRIMP_Y[2]
        px.put(x, y, c)
    for sx in (-9, -6, -3, 0):  # abdominal segment lines
        for (x, y), (v, x0) in body.items():
            if x0 == sx and -0.6 < v < 0.9:
                c = px.get(x, y)
                if c in (R_SHRIMP_RED[2], R_SHRIMP_RED[3]):
                    px.put(x, y, R_SHRIMP_RED[1])
                elif c in (R_SHRIMP_Y[2], R_SHRIMP_Y[3]):
                    px.put(x, y, R_SHRIMP_Y[1])
    for (x, y), (v, x0) in body.items():  # white saddle across the carapace + a few white spots
        if x0 == 1 and v < 0.4:
            px.put(x, y, hx("fff6f0"))
        if (x0, round(v * 3)) in ((-7, 1), (4, 1), (7, 0)):
            px.put(x, y, hx("fff6f0"))
    # pleopods (swimmerets) under the abdomen
    for x in range(-9, -1, 2):
        by = math.ceil(yc(x) + th(x) - 0.5) + 1 + dy(x)
        px.put(x, by, R_SHRIMP_Y[3])
        px.put(x - 1, by + 1, R_SHRIMP_Y[2])
    # eye
    ex, ey = 10, math.floor(yc(10) - th(10)) + 1 + dy(10)
    px.put(ex, ey, EYE)
    px.put(ex + 1, ey, EYE)
    px.put(ex, ey - 1, EYE)
    px.put(ex + 1, ey - 1, hx("ffffff"))
    # near legs: white with red knees
    for j, ax in enumerate(legs):
        sw = (1 if j % 2 == 0 else -1) * (1 if frame % 2 == 0 else -1) if not pick else (0 if j % 2 else 1)
        by = round(yc(ax) + th(ax)) + dy(ax)
        knee = (ax + 1 + sw * 0.5, by + 2 - (1 if pick and ax > 3 else 0))
        line_px(px, [(ax + 0.5, by), knee], hx("fff0e8"))
        line_px(px, [knee, (ax + 1 - sw, 0.5)], hx("fff0e8"))
        px.put(math.floor(knee[0]), math.floor(knee[1]), hx("e0505a"))
    # chelipeds: reaching to the sand (2), back to the mouth (3)
    my = math.floor(yc(12) + th(12)) + dy(12)
    if frame == 2:
        line_px(px, [(11, my), (14, my + 2), (16, 0.5)], hx("fff0e8"))
        px.put(16, 0, hx("ffffff"))
        px.put(17, 0, hx("e0505a"))
    elif frame == 3:
        line_px(px, [(11, my), (15, my + 2), (13, my)], hx("fff0e8"))
        px.put(13, my - 1, hx("e0505a"))
        px.put(12, my, hx("ff9f43"))  # a crumb in the claws
    else:
        line_px(px, [(11, my), (14, my + 1.5), (15.5, my + 3)], hx("fff0e8"))
        px.put(15, my + 3, hx("e0505a"))
    # antennae: two long white whips + the short forked antennules
    wav = (0, 1, 0, -1)[frame]
    hy = math.floor(yc(12) - th(12)) + dy(12)
    for p0, p1, p2 in (((12, hy), (21, hy - 11 + wav), (17 + wav, hy - 23)),
                          ((12.5, hy + 1), (25, hy - 3), (31, hy + 3 - wav))) if antennae else ():
        pts = bez(p0, p1, p2, 40)
        line_px(px, pts, lambda t: hx("ffffff", 235) if int(t * 40) % 6 else hx("f0b8b8", 235))
    if antennae:
        line_px(px, [(12.5, hy), (16, hy - 4), (19, hy - 4 + wav)], hx("fff0e8", 220))
    contact_shadow(px, -11, 12)
    return px


# ---- hermit crab in a peach whelk shell. Origin = bottom-centre on the sand. Frames 0-1 walk, 2-3 dig.

def crab_art(frame):
    px = Px()
    dig = frame >= 2
    bob = -1 if frame == 1 else 0
    tilt = 1 if dig else 0
    C = R_CRAB
    # far legs (behind)
    for j, lx in enumerate((3, 7)):
        sw = (1 if (j + frame) % 2 == 0 else -1) if not dig else 0
        line_px(px, [(lx + 1, -5 + bob), (lx + 4, -7 + bob), (lx + 6 + sw, 0.5)], C[1])
    # small claw (far side)
    blob(px, 13, -8 + bob + tilt, 2.2, 1.6, (C[0], C[1], C[2], C[3]), outline=False)
    # shell: spire whorls up-left behind the body whorl
    S = R_HSHELL
    for cx, cy, rx, ry in ((-13.5, -17.5 + bob, 1.8, 1.6), (-11.5, -15.5 + bob, 2.8, 2.4), (-8, -12.5 + bob, 4.6, 3.9)):
        blob(px, cx, cy, rx, ry, S, seed=2)
    main = blob(px, -2.5, -7.5 + bob, 8.6, 7.2, S, seed=5)
    for x, y in main:  # brown spiral bands following the whorl
        c = px.get(x, y)
        if c == S[0]:
            continue
        u = (y + 7.5 - bob) + 0.35 * (x + 2.5)
        if math.floor(u) % 5 == 0:
            px.put(x, y, S[max(1, S.index(c) - 2) if c in S else 1])
        elif (x * 3 + y * 7) % 13 == 0 and c in S:
            px.put(x, y, S[1])
    # aperture: dark mouth with a pale lip on its right
    ax_, ay_ = 3.5, -5.5 + bob
    for y in range(-11 + bob, 1):
        for x in range(0, 9):
            d = ((x + 0.5 - ax_) / 3.4) ** 2 + ((y + 0.5 - ay_) / 4.6) ** 2
            if d <= 1:
                px.put(x, y, hx("2a1410") if d < 0.62 else S[5] if x + 0.5 > ax_ else S[4])
    # body + walking legs (near side), banded red/white
    for j, lx in enumerate((2, 5, 8)):
        sw = (1 if (j + frame) % 2 == 0 else -1) if not dig else (1 if j == 2 else 0)
        knee = (lx + 3.5, -6.5 + bob)
        line_px(px, [(lx + 0.5, -3.5 + bob), knee], C[2])
        line_px(px, [knee, (lx + 5.5 + sw, 0.5)], lambda t: C[3] if t < 0.5 else C[2])
        px.put(math.floor(knee[0]), math.floor(knee[1]), C[5])
        px.put(math.floor(lx + 5.5 + sw), 0, C[1])
    blob(px, 6.5, -6.5 + bob + tilt, 3.2, 2.6, C[:5], seed=1)
    # eye stalks
    for ex, top, col in ((6.5, -13, C[1]), (8.5, -14, C[3])):
        line_px(px, [(ex, -8 + bob + tilt), (ex + 0.6, top + bob + tilt)], lambda t, col=col: col if int(t * 6) % 2 else C[5])
        ey = top + bob + tilt - 1
        px.put(math.floor(ex + 0.6), ey, EYE)
        px.put(math.floor(ex + 0.6) + 1, ey, EYE)
        px.put(math.floor(ex + 0.6), ey - 1, EYE if col == C[1] else hx("ffffff"))
    line_px(px, [(9.5, -9 + bob + tilt), (13, -12 + bob + tilt), (16, -12 + bob + tilt)], C[3])
    line_px(px, [(9.5, -8 + bob + tilt), (14, -10 + bob + tilt), (17, -8 + bob + tilt)], C[2])
    # big claw (near side)
    cy = (-4.5 + bob, -4.5 + bob, -1.8, -5.5)[frame]
    cxc = (12.5, 12.5, 13.5, 13)[frame]
    line_px(px, [(8, -5.5 + bob + tilt), (cxc - 2, cy)], C[1])
    claw = blob(px, cxc, cy, 3.3, 2.6, C, seed=3)
    tip_x = math.floor(cxc + 3)
    for d in range(3):
        px.put(tip_x + d, math.floor(cy) - 1, C[4] if d < 2 else C[1])
        px.put(tip_x + d, math.floor(cy) + 1, C[3] if d < 2 else C[1])
    for x, y in claw:
        if (x * 5 + y * 3) % 7 == 0 and px.get(x, y) in C[2:4]:
            px.put(x, y, C[5])
    if dig:  # flying sand + a little pit
        r2 = random.Random(60 + frame)
        sp = [(16, -3), (18, -5), (17, -7), (20, -4), (15, -6)] if frame == 2 else [(18, -9), (21, -7), (19, -11), (23, -4), (20, -2), (16, -10)]
        for sx, sy in sp:
            px.put(sx, sy, R_SAND[r2.choice([3, 4, 5])])
            if r2.random() < 0.5:
                px.put(sx + 1, sy, R_SAND[2])
        sand_mound(px, 14, 21, 2 if frame == 3 else 1, seed=frame)
    contact_shadow(px, -11, 14)
    return px


# ---------------------------------------------------------------- v7 visitors (all face right at scaleX +1)

R_TSHELL = ramp("1e120a", "3e2410", "6a3e18", "9a6224", "c88a34", "ecb85a", "fbe09a")  # tortoiseshell
R_TSKIN = ramp("0e2219", "1c4031", "2f6448", "4a8a5a", "74b26e", "acd890")
R_TBELLY = ramp("6a5a2a", "b09a52", "e0cc84", "f8eebc")
T_OUT = hx("0c1812")
LIGHT_DIR = (-0.6, -0.8)


def flipper(root, ang, L, wmax, cols, bend=0.4, scales=True):
    """A tapering paddle along a spine that curls back toward pointing behind (angle pi), shaded against the
    screen's upper-left light, with a lattice of pale scales and a selective outline. cols: 6 dark -> light."""
    px = Px()
    side = {}
    x, y = root
    steps = int(L * 4)
    bend = abs(bend) if math.sin(ang) >= 0 else -abs(bend)
    for i in range(steps + 1):
        u = i / steps
        a = ang + bend * u * u
        if i:
            x += math.cos(a) * L / steps
            y += math.sin(a) * L / steps
        w = wmax * math.sin(math.pi * min(1.0, 0.12 + u * 0.95)) ** 0.55 * (1 - 0.5 * u)
        nx, ny = -math.sin(a), math.cos(a)
        lit = nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1]
        v = -w
        while v <= w:
            key = (math.floor(x + nx * v), math.floor(y + ny * v))
            t = 0.55 + 0.4 * (v / max(w, 0.5)) * lit - 0.12 * u
            if key not in side or abs(v) < abs(side[key][1]):
                side[key] = (t, v)
            v += 0.35
    for (px_, py_), (t, v) in side.items():
        c = cols[1 + shade_index(t, 4, px_, py_, 0.6)]
        if scales and (px_ * 2 + py_ * 3) % 7 == 0 and 0.35 < t < 0.85:
            c = cols[5]
        px.put(px_, py_, c)
    m = set(px.d)
    for (x_, y_) in m:
        if (x_ + 1, y_) not in m or (x_, y_ + 1) not in m:
            px.put(x_, y_, cols[0])
        elif (x_ - 1, y_) not in m or (x_, y_ - 1) not in m:
            px.put(x_, y_, cols[4])
    return px


def turtle_art(frame):
    """Green sea turtle, side view, gliding right. Origin = the middle of the shell. Frames 0-3: one stroke of
    the front flippers (raised, sweeping, down, feathered back up)."""
    px = Px()
    far = [mix(c, hx("0a2030"), 0.35) for c in R_TSKIN]
    fa = (-112, 174, 128, -168)[frame]
    fw = (3.6, 3.8, 3.6, 2.3)[frame]
    ra = (156, 164, 172, 164)[frame]
    # far-side flippers first: the shell hides most of them
    for part in (flipper((9, 1), math.radians(fa + 16), 18, fw * 0.85, far),
                 flipper((-13, 1), math.radians(ra - 12), 8, 2.2, far, scales=False)):
        for (x, y), c in part.d.items():
            px.put(x, y, c)
    # carapace: a low streamlined teardrop, rounder at the front; plates (scutes) lit in the middle,
    # darker toward their seams, with faint radiating tortoiseshell streaks
    def prof(x):
        d = (x - 2) / (16.5 if x >= 2 else 20.5)
        k = max(0.0, 1 - d * d)
        return -10.0 * k ** 0.6, 1.5 + 2.6 * k ** 0.5
    shell = {}
    for x in range(-19, 19):
        top, bot = prof(x + 0.5)
        if bot - top < 2:
            continue
        for y in range(math.floor(top), math.ceil(bot)):
            shell[(x, y)] = (top, bot)
    cents = [(cx, prof(cx)[0] * 0.62 - 0.3, i) for i, cx in enumerate((-12, -5, 2, 9))] + \
            [(cx, prof(cx)[0] * 0.12 + 0.2, 4 + i) for i, cx in enumerate((-14, -7.5, -1, 5.5, 12))]
    for (x, y), (top, bot) in shell.items():
        cxp, cyp = x + 0.5, y + 0.5
        if cyp > bot - 1.6:  # marginal scutes along the rim
            c = R_TSHELL[4 if ((x + 40) // 3) % 2 else 3]
            if (x + 40) % 3 == 0:
                c = R_TSHELL[2]
            if cyp > bot - 0.6:
                c = R_TSHELL[1]
            px.put(x, y, c)
            continue
        ds = sorted((math.hypot(cxp - cx, (cyp - cy) * 1.6), cx, cy, i) for cx, cy, i in cents)
        d0, cx, cy, i = ds[0]
        gap = ds[1][0] - d0
        if gap < 0.7:
            px.put(x, y, R_TSHELL[1])
            continue
        nx, ny = (cxp - 1) / 19, (cyp + 3) / 7
        t = 0.58 - 0.22 * nx - 0.32 * ny
        t += 0.2 * max(0.0, 1 - d0 / 4.5) - (0.14 if gap < 1.5 else 0)
        t += 0.07 * math.sin(math.atan2(cyp - cy, cxp - cx) * 5 + i * 1.7)
        px.put(x, y, R_TSHELL[1 + shade_index(t, 6, x, y, 0.6)])
    sm = set(shell)
    for (x, y) in sm:  # selective outline: lit edges stay warm, shadow edges go dark
        if (x, y + 1) not in sm or ((x + 1, y) not in sm and y > -3):
            px.put(x, y, R_TSHELL[0])
        elif (x, y - 1) not in sm:
            px.put(x, y, R_TSHELL[6] if x < 6 else R_TSHELL[4])
        elif (x - 1, y) not in sm:
            px.put(x, y, R_TSHELL[3])
    # plastron: a cream keel under the rim
    for x in range(-12, 15):
        _, bot = prof(x + 0.5)
        y0 = math.ceil(bot)
        rows = 2 if -6 <= x <= 9 else 1
        for r in range(rows):
            px.put(x, y0 + r, R_TBELLY[3] if r == 0 and x < 6 else R_TBELLY[2])
        px.put(x, y0 + rows, R_TBELLY[0])
    # rear flipper and the tail
    for (x, y), c in flipper((-13, 3), math.radians(ra), 9, 2.6, R_TSKIN, scales=False).d.items():
        px.put(x, y, c)
    for x, y in ((-20, 3), (-21, 3), (-20, 4)):
        px.put(x, y, R_TSKIN[2] if y == 3 else R_TSKIN[0])
    # neck and head: big and rounded, a blunt beak, pale-edged plates on top, a big friendly eye
    HX, HY = 23.5, -1.6
    head = {}
    for y in range(-8, 6):
        for x in range(13, 32):
            dx, dy = (x + 0.5 - HX) / 6.8, (y + 0.5 - HY) / 5.3
            neck = 13 <= x <= 19 and -2.8 <= y + 0.5 - 0.12 * (x - 13) <= 4.2
            if dx * dx + dy * dy <= 1 or neck:
                head[(x, y)] = (dx, dy)
    for (x, y), (dx, dy) in head.items():
        t = 0.64 - 0.33 * dx - 0.45 * dy
        c = R_TSKIN[1 + shade_index(t, 5, x, y, 0.6)]
        if x <= 18 and (x * 2 + y) % 5 == 0 and dy > -0.4:  # neck folds
            c = R_TSKIN[2]
        px.put(x, y, c)
    plates = [(19.8, -5.0), (23.2, -6.3), (26.6, -5.2), (21.6, -2.9), (17.4, -3.4), (25.0, -3.2)]
    for (x, y), (dx, dy) in head.items():
        if dy > 0.0 or x > 28:
            continue
        ds = sorted(math.hypot(x + 0.5 - a, (y + 0.5 - b) * 1.25) for a, b in plates)
        if ds[1] - ds[0] < 0.75:
            px.put(x, y, R_TSKIN[1])
        elif ds[0] < 0.9:
            px.put(x, y, hx("d6d6a0"))
    hm = set(head)
    for (x, y) in hm:
        if (x, y + 1) not in hm or (x + 1, y) not in hm:
            px.put(x, y, T_OUT)
        elif (x, y - 1) not in hm:
            px.put(x, y, R_TSKIN[5] if x < 26 else R_TSKIN[4])
    for x in range(28, 31):  # the beak
        for y in range(-3, 2):
            if (x, y) in hm and (x + 1, y) in hm:
                px.put(x, y, hx("6a7656") if y < 0 else hx("44503a"))
    for x, y in ((23, 1), (24, 2), (25, 2), (26, 2), (27, 2), (28, 1), (29, 1), (30, 1)):  # a little smile
        if (x, y) in hm:
            px.put(x, y, T_OUT)
    for (x, y), c in (((25, -3), hx("ffffff")), ((26, -3), hx("0c100c")), ((25, -2), hx("0c100c")), ((26, -2), hx("0c100c")),
                      ((25, -1), hx("1c2a20")), ((26, -1), hx("0c100c")), ((27, -2), hx("0c100c")),
                      ((24, -4), R_TSKIN[1]), ((25, -4), R_TSKIN[1]), ((26, -4), R_TSKIN[1]), ((27, -4), R_TSKIN[2]),
                      ((24, -2), R_TSKIN[4]), ((25, 0), R_TSKIN[4]), ((26, 0), R_TSKIN[4])):
        px.put(x, y, c)
    px.over(27, 1, hx("f09a8a", 170))  # blush
    px.over(28, 0, hx("f09a8a", 110))
    # the near front flipper, over everything
    for (x, y), c in flipper((11, 3), math.radians(fa), 22, fw, R_TSKIN).d.items():
        px.put(x, y, c)
    return px


R_HORSE = ramp("4a1606", "8a320e", "c45e16", "ec9628", "ffc64c", "ffe88e")
HORSE_FIN = hx("ffe2a0", 170)


def seahorse_art(frame):
    """Yellow seahorse, tail curled round a kelp stalk, facing right. Origin = the grip (the stalk runs
    through it, under the coil's back half). Frames 0-3: a gentle bob with fluttering fins."""
    px = Px()
    bob = (0, -1, -1, 0)[frame]
    ph = frame * math.pi / 2
    trunk = {}
    for y in range(-23, -7):
        v = (-8 - y) / 15
        cx = 5.2 + 1.8 * math.sin(math.pi * v) - 1.2 * v
        hw = max(1.5, 1.6 + 2.6 * math.sin(math.pi * min(1.0, v * 1.1)) ** 0.8)
        for x in range(math.floor(cx - hw * 0.9), math.ceil(cx + hw * 1.15)):
            trunk[(x, y + bob)] = ((x + 0.5 - cx) / hw, y)
    # dorsal fin on the back, behind the trunk
    for y in range(-19, -11):
        yb = y + bob
        left = min(x for (x, yy) in trunk if yy == yb)
        w = 3 + round(1.2 * math.sin(y * 0.9 + ph))
        for d in range(1, w + 1):
            px.put(left - d, yb, HORSE_FIN if (y + d) % 2 else hx("ffc870", 190))
        px.put(left - w - 1, yb, hx("e8a040", 170))
    for (x, y), (u, y0) in trunk.items():
        t = 0.66 - 0.42 * u
        c = R_HORSE[1 + shade_index(t, 5, x, y, 0.5)]
        if y0 % 3 == 0 and -0.2 < u < 0.8 and c != R_HORSE[1]:
            c = R_HORSE[R_HORSE.index(c) - 1]  # faint bony rings across the middle
        px.put(x, y, c)
    tm = set(trunk)
    for (x, y), (u, y0) in trunk.items():
        if (x + 1, y) not in tm or (x, y + 1) not in tm and u > 0:
            px.put(x, y, R_HORSE[0])
        elif (x - 1, y) not in tm:
            px.put(x, y, R_HORSE[4])
            if y0 % 2 == 0:
                px.put(x - 1, y, R_HORSE[3])  # knobs along the back
    for x, y in ((6, -17), (6, -15), (7, -13)):  # pale belly flecks
        px.put(x, y + bob, R_HORSE[5])
    # head, snout, coronet, eye
    hd = blob(px, 4.6, -26.4 + bob, 3.3, 3.0, R_HORSE[:6], seed=3)
    for x in range(7, 13):
        yy = -26 + bob + (1 if x > 10 else 0) * 0
        px.put(x, yy, R_HORSE[4] if x < 11 else R_HORSE[3])
        px.put(x, yy + 1, R_HORSE[2])
        px.put(x, yy + 2, R_HORSE[0]) if x > 7 else None
    px.put(13, -27 + bob, R_HORSE[1])
    px.put(13, -26 + bob, R_HORSE[0])
    px.put(13, -25 + bob, R_HORSE[1])
    for (x, y), c in (((3, -30), R_HORSE[4]), ((4, -31), R_HORSE[5]), ((4, -30), R_HORSE[4]), ((5, -31), R_HORSE[4]),
                      ((6, -30), R_HORSE[3]), ((2, -29), R_HORSE[3])):
        px.put(x, y + bob, c)
    for (x, y), c in (((5, -28), hx("ffffff")), ((6, -28), hx("1a0c08")), ((5, -27), hx("1a0c08")), ((6, -27), hx("1a0c08")),
                      ((4, -28), R_HORSE[5]), ((7, -27), R_HORSE[2])):
        px.put(x, y + bob, c)
    px.over(7, -25 + bob, hx("ff7a6a", 140))  # cheek
    # pectoral fin behind the head
    for d in range(3):
        w = 2 + (1 if (frame + d) % 2 else 0)
        for k in range(w):
            px.over(2 - k, -24 + d + bob, HORSE_FIN)
    # tail: down from the trunk, then coiled round the stalk. The coil's back half passes behind the
    # stalk (|x| <= 1 left open there), so it reads as gripping it.
    pts = [(5.2, -8.0 + bob), (4.7, -6.5), (4.0, -4.8), (3.2, -3.2), (2.4, -1.9)]
    r = 2.5
    for i in range(0, 34):
        a = -0.65 + i * 0.16
        pts.append((r * math.cos(a), r * math.sin(a)))
        if a > 2 * math.pi - 0.9:
            break
    for i, (x, y) in enumerate(pts):
        n = len(pts)
        rad = 1.5 - 0.7 * i / n
        a = -0.65 + (i - 5) * 0.16
        behind = i >= 5 and math.pi + 0.35 < a < 2 * math.pi - 0.45
        band = (i // 2) % 2
        for yy in range(math.floor(y - rad), math.ceil(y + rad) + 1):
            for xx in range(math.floor(x - rad), math.ceil(x + rad) + 1):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 > rad * rad:
                    continue
                if behind and abs(xx) <= 1:
                    continue
                lit = (xx + 0.5 - x) + (yy + 0.5 - y) < -0.3
                c = R_HORSE[4 if lit else 3 - band]
                if (xx + 0.5 - x) + (yy + 0.5 - y) > rad * 0.9:
                    c = R_HORSE[0]
                px.put(xx, yy, c)
    return px


R_SUIT = ramp("4a2a06", "9a6010", "d89a1a", "f8c834", "ffe680", "fff8d0")
R_GEAR = ramp("0a0c16", "181c2c", "2c3248", "4a5270", "7a86a8")
R_FACE = ramp("7a3e2a", "c07050", "eca478", "ffd0a8")
R_LENS = ramp("1a3a5a", "2e78a8", "7ad0ec", "e0faff")


def limb(px, pts, r, cols):
    """A shaded tube through pts (cols dark -> light), lit from the upper left."""
    m = stroke_mask(pts, r)
    shade_mask(px, m, (cols[0], cols[1], cols[2], cols[3], cols[4]), dither=False)
    return m


def diver_art(frame):
    """The mini diver (a nod to Dave): yellow suit, round mask, regulator, wiping the inside of the front glass
    with a sponge. Front view; origin = the middle of the belly. Frames 0-3: the sponge goes round."""
    px = Px()
    kick = (0, 1, 0, -1)[frame]
    # tank valve and hose, behind
    for x, y, c in ((-6, -14, R_GEAR[3]), (-5, -14, R_GEAR[2]), (-6, -13, R_GEAR[2]), (-5, -13, R_GEAR[1]), (-7, -14, R_GEAR[1])):
        px.put(x, y, c)
    line_px(px, [(-5.5, -12), (-6.5, -9), (-5, -6.5), (-2.5, -6.2)], R_GEAR[1])
    # legs and fins
    for sgn in (-1, 1):
        k = kick * sgn
        limb(px, [(2.5 * sgn, 4), (3.2 * sgn, 9 + k * 0.5)], 1.5, R_SUIT[:5])
        fin = set()
        for i in range(6):
            w = 1.2 + i * 0.45
            cx, cy = (3.4 + i * 0.55) * sgn, 10 + i + (k if i > 2 else 0)
            for x in range(math.floor(cx - w), math.ceil(cx + w)):
                fin.add((x, math.floor(cy)))
        shade_mask(px, fin, (R_GEAR[0], R_GEAR[1], R_GEAR[2], hx("2a8a96"), hx("5ac8c8")), dither=False)
    # torso: a round yellow suit, a harness, the weight belt
    torso = blob(px, 0, -1, 6.3, 6.4, R_SUIT[:6], seed=2)
    for y in range(-6, 3):
        for sgn in (-1, 1):
            x = round((4.2 - (y + 6) * 0.12) * sgn)
            if (x, y) in torso:
                px.put(x, y, R_GEAR[2] if sgn < 0 else R_GEAR[1])
    for y in range(-5, 3):
        if (0, y) in torso:
            px.put(0, y, R_SUIT[2])
    for x in range(-7, 8):
        for y in (1, 2):
            if (x, y) in torso:
                px.put(x, y, R_GEAR[2] if y == 1 else R_GEAR[1])
    for x, y, c in ((-1, 1, hx("a8b2bc")), (0, 1, hx("d8e0e8")), (1, 1, hx("8a949e")), (-1, 2, hx("6a747e")), (0, 2, hx("8a949e")), (1, 2, hx("5a646e"))):
        px.put(x, y, c)
    # the steadying hand, flat on the glass
    limb(px, [(-5, -4), (-8.5, -2.5), (-10.5, -5)], 1.3, R_SUIT[:5])
    for x, y, c in ((-12, -6, R_GEAR[2]), (-11, -6, R_GEAR[3]), (-10, -6, R_GEAR[2]), (-12, -5, R_GEAR[1]), (-11, -5, R_GEAR[2]),
                    (-10, -5, R_GEAR[1]), (-11, -4, R_GEAR[1]), (-13, -6, R_GEAR[1]), (-12, -7, R_GEAR[2]), (-10, -7, R_GEAR[2])):
        px.put(x, y, c)
    # head: hood, face, the round mask with eyes behind the glass, a regulator, a headlamp
    hood = blob(px, 0, -11, 5.6, 5.4, R_SUIT[:6], seed=1)
    face = set()
    for y in range(-14, -6):
        for x in range(-4, 5):
            if ((x + 0.5) / 4.0) ** 2 + ((y + 0.5 + 10.2) / 3.6) ** 2 <= 1:
                face.add((x, y))
    for (x, y) in face:
        px.put(x, y, R_FACE[2] if (x + y) % 5 else R_FACE[3])
    for x in range(-5, 6):  # mask strap
        if (x, -11) in hood and (x, -11) not in face:
            px.put(x, -11, R_GEAR[1])
    for y in range(-14, -8):
        for x in range(-5, 6):
            d = ((x + 0.5) / 4.6) ** 2 + ((y + 0.5 + 11.4) / 2.7) ** 2
            if d <= 1:
                inner = ((x + 0.5) / 3.5) ** 2 + ((y + 0.5 + 11.4) / 1.8) ** 2 <= 1
                if inner:
                    t = 0.8 - (y + 13) * 0.25 - (x + 4) * 0.04
                    px.put(x, y, R_LENS[max(1, min(3, round(t * 3)))])
                else:
                    px.put(x, y, R_GEAR[0] if y > -12 or x > 2 else R_GEAR[2])
    for x, y, c in ((-2, -12, hx("0a0a14")), (-2, -11, hx("0a0a14")), (1, -12, hx("0a0a14")), (1, -11, hx("0a0a14")),
                    (-2, -12, hx("0a0a14")), (-3, -13, hx("ffffff")), (-2, -13, hx("e0faff")), (2, -12, hx("ffffff")),
                    (0, -11, R_GEAR[1])):
        px.put(x, y, c)
    px.put(-3, -12, hx("ffffff", 200))  # glare
    px.over(-3, -8, hx("f07a70", 170))
    px.over(3, -8, hx("f07a70", 170))
    for x, y, c in ((-1, -8, R_GEAR[2]), (0, -8, R_GEAR[3]), (1, -8, R_GEAR[2]), (-1, -7, R_GEAR[1]), (0, -7, R_GEAR[1]), (1, -7, R_GEAR[1]),
                    (-2, -7, R_GEAR[1])):
        px.put(x, y, c)
    for x, y, c in ((-1, -17, R_GEAR[2]), (0, -17, R_GEAR[3]), (1, -17, R_GEAR[1]), (-1, -16, R_GEAR[1]), (0, -16, hx("fff6c0")),
                    (1, -16, R_GEAR[1])):
        px.put(x, y, c)
    # the wiping arm and the sponge, going round
    a = math.radians((-45, 45, 135, 225)[frame])
    hxp, hyp = 11 + 3 * math.cos(a), -7 + 3 * math.sin(a)
    limb(px, [(5, -4), ((5 + hxp) / 2 + 1, (-4 + hyp) / 2 + 2), (hxp, hyp)], 1.3, R_SUIT[:5])
    sx0, sy0 = round(hxp) - 2, round(hyp) - 3
    yel = ramp("6a4a10", "c99220", "f2c43a", "ffe27a")
    for y in range(4):
        for x in range(6):
            c = yel[2] if (x + y) % 3 else yel[3]
            if y == 3:
                c = hx("2f8a40")
            if x == 5 or (y == 3 and x > 0):
                c = yel[0] if y < 3 else hx("1a5a2a")
            if y == 0 and x < 5:
                c = yel[3]
            px.put(sx0 + x, sy0 + y, c)
    px.put(sx0 + 2, sy0 + 1, yel[1])
    px.put(sx0 + 4, sy0 + 2, yel[1])
    for x, y in ((round(hxp), round(hyp)), (round(hxp) - 1, round(hyp)), (round(hxp), round(hyp) + 1)):
        px.put(x, y, R_GEAR[2])
    # a clean squeak where the sponge just was
    b = math.radians((-45, 45, 135, 225)[(frame + 3) % 4])
    gx, gy = round(11 + 4.2 * math.cos(b)), round(-7 + 4.2 * math.sin(b))
    for d in (-1, 0, 1):
        px.put(gx + d, gy, hx("ffffff", 230 if d == 0 else 150))
        px.put(gx, gy + d, hx("ffffff", 230 if d == 0 else 150))
    # bubbles from the regulator, rising
    for bx, by in ((2 + frame % 2, -19 - frame * 2), (4, -23 - ((frame + 2) % 4) * 2)):
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            px.put(bx + dx, by + dy, hx("e8fbff", 210))
        px.put(bx - 1, by - 1, hx("ffffff", 120))
    return px


# ---- Halloween event ----
# Everything here is event art: every sprite is named hw_* (the lead's on-demand loader groups them as
# "ev-halloween"), and all of it shows on one prop, evHalloween (0/1), written by the logic from src/season.ts.
# Layered over whichever theme is in use: carved pumpkins and a sunken cauldron on the sand (World), their
# candle and brew light over the Night layer (WorldMid), a bat visitor that hangs from the hood's front lip
# (WorldGlass), and the ghost-pale jelly morph (Jelly VM `ghost`, a palette group per stage, like Morph).

R_PUMPKIN = ramp("3e1004", "7a2608", "b8480c", "e2701a", "fb9a30", "ffc865")
R_PSTEM = ramp("1e200a", "3a3c14", "5e5c22", "8a8034", "b4a650")
R_CANDLE = ramp("c8500e", "f08a1c", "ffc040", "ffe88a", "fffbe0")  # the carved holes: rim -> hot middle
R_IRONPOT = ramp("0a0812", "16141f", "262434", "3c3a50", "5e5e7a", "9294b0")
R_BREW = ramp("124012", "1e7224", "36a83a", "6ad85a", "b4f68a", "eeffcc")
R_BATFUR = ramp("140a1e", "2a1638", "432656", "623a7a", "88589e", "b088c4")
R_BATWING = ramp("1a0c24", "2e1840", "48285c", "64387a", "8a58a0")
BAT_EAR = hx("e88aae")
BAT_BLUSH = hx("f07aa4", 150)

# carved faces, '#' = cut through. Cosy, not scary: round-ish eyes, a wide grin, one goofy tooth.
# Rows are centred on x = 0; the first row sits at the y given with the face.
HW_FACES = {
    "big": (-4, ["...#.......#...",
                 "..###.....###..",
                 ".#####...#####.",
                 "...............",
                 ".......#.......",
                 "...............",
                 "#.............#",
                 "##...........##",
                 ".#####.#######.",
                 "..#####.#####..",
                 "....#######...."]),
    "mid": (-3, ["..#.....#..",
                 ".###...###.",
                 "...........",
                 ".....#.....",
                 "#.........#",
                 "##.#####.##",
                 ".#########.",
                 "...#####..."]),
    "small": (-2, [".#...#.",
                   "##...##",
                   ".......",
                   "#.....#",
                   ".##.##.",
                   "..###.."]),
}


def hw_face_holes(face, dx=0, dy=0):
    y0, rows = HW_FACES[face]
    return {(x - len(row) // 2 + dx, y0 + j + dy) for j, row in enumerate(rows) for x, ch in enumerate(row) if ch == "#"}


def hw_pumpkin_mask(rx, ry):
    """A squat pumpkin, origin = the middle of its base on the sand. The top dips toward the stem."""
    m = set()
    cy = -ry
    for y in range(-2 * ry - 2, 1):
        for x in range(-rx - 1, rx + 2):
            nx, ny = (x + 0.5) / rx, (y + 0.5 - cy) / ry
            top = 1 - 0.16 * math.exp(-(nx / 0.28) ** 2) if ny < 0 else 1.0  # the dimple round the stem
            if nx * nx + (ny / top) ** 2 <= 1 and y <= 0:
                m.add((x, y))
    return m


def hw_pumpkin(rx, ry, face, ribs=5, lit=0.9):
    """Carved pumpkin lantern: ribbed, lit from the upper left; the cut face glows with the candle inside
    (`lit` scales how bright the holes look by day; the night light is hw_pumpkin_light)."""
    px = Px()
    m = hw_pumpkin_mask(rx, ry)
    cy = -ry
    holes = hw_face_holes(face, 0, round(cy))
    near_face = lambda x, y: any((x + a, y + b) in holes for a in (-1, 0, 1) for b in (-1, 0, 1))
    for (x, y) in m:
        nx, ny = (x + 0.5) / rx, (y + 0.5 - cy) / ry
        u = (nx + 1) / 2 * ribs  # which rib, and where across it
        f = u - math.floor(u)
        bulge = math.sin(f * math.pi)  # each rib is its own little cylinder
        t = 0.5 - 0.32 * nx - 0.3 * ny + 0.22 * (bulge - 0.6) + 0.12 * (-math.cos(f * math.pi))
        c = R_PUMPKIN[1 + shade_index(t, 3, x, y, 0.5)]  # kept to the mid ramp, so the lit face stands out
        if (f < 0.1 or f > 0.93) and not near_face(x, y):
            c = R_PUMPKIN[1 if nx > -0.2 else 2]  # the grooves between ribs (smoothed out round the face, so it reads)
        px.put(x, y, c)
    for (x, y) in m:  # selective outline: dark on the shadow sides, a lit rim top-left
        e = lambda a, b: (x + a, y + b) not in m
        if e(1, 0) or e(0, 1):
            px.put(x, y, R_PUMPKIN[0])
        elif (e(-1, 0) or e(0, -1)) and x < rx * 0.2:
            px.put(x, y, R_PUMPKIN[4])
    for (x, y) in holes:
        if (x, y) not in m:
            continue
        # the candle shows through every cut; the lip of the cut shades its top row
        c = mix(R_PUMPKIN[1], R_CANDLE[3], lit)
        if (x, y - 1) not in holes and (x, y + 1) in holes:
            c = mix(R_PUMPKIN[0], R_CANDLE[2], lit)
        px.put(x, y, c)
    # stem: a short curled stalk with a tiny leaf
    sx = -1
    for i in range(4):
        y = round(cy * 2) - i + (1 if rx > 8 else 0)
        for dx in (0, 1):
            px.put(sx + dx + (1 if i == 3 else 0), y, R_PSTEM[3 - dx] if i < 3 else R_PSTEM[2])
    ty = round(cy * 2) - 3 + (1 if rx > 8 else 0)
    px.put(sx + 2, ty, R_PSTEM[4])
    px.put(sx + 3, ty + 1, R_PSTEM[3])
    if rx > 7:
        for x, y, c in ((sx - 1, ty + 1, R_PSTEM[3]), (sx - 2, ty + 1, R_PSTEM[2]), (sx - 3, ty + 2, R_PSTEM[1]), (sx - 2, ty + 2, R_PSTEM[3])):
            px.put(x, y, c)
    for x in range(-rx + 2, rx - 1):  # it sits in the sand: a soft contact shadow
        px.over(x, 1, hx("2a140a", 90 if abs(x) < rx - 3 else 50))
    return px


def hw_pumpkin_light(rx, ry, face):
    """The candle shining out of the carved face, drawn over the Night layer (bright; faded by day)."""
    px = Px()
    holes = hw_face_holes(face, 0, round(-ry))
    m = hw_pumpkin_mask(rx, ry)
    for (x, y) in holes:
        if (x, y) not in m:
            continue
        inner = all((x + a, y + b) in holes for a, b in N4)
        px.put(x, y, R_CANDLE[4] if inner else R_CANDLE[3] if ((x - 1, y) in holes and (x, y - 1) in holes) else R_CANDLE[2])
    for (x, y) in list(px.d):  # a little bloom round each hole
        for a, b in N4:
            if (x + a, y + b) not in px.d and (x + a, y + b) in m:
                px.over(x + a, y + b, hx("ff9a2a", 70))
    return px


def hw_cauldron(frame):
    """A little sunken witch's cauldron, half in the sand, with a bubbling green brew. Origin = base centre.
    Frames 0-2: the brew's bubbles pop in turn."""
    px = Px()
    rx, ry, cy = 11, 8, -8
    body = set()
    for y in range(-17, 1):
        for x in range(-13, 14):
            nx, ny = (x + 0.5) / rx, (y + 0.5 - cy) / ry
            if nx * nx + ny * ny <= 1 and y >= -14:
                body.add((x, y))
    for (x, y) in body:
        nx, ny = (x + 0.5) / rx, (y + 0.5 - cy) / ry
        t = 0.45 - 0.35 * nx - 0.3 * ny
        px.put(x, y, R_IRONPOT[1 + shade_index(t, 3, x, y, 0.8)])
    for (x, y) in body:
        if (x + 1, y) not in body or (x, y + 1) not in body:
            px.put(x, y, R_IRONPOT[0])
    # a glint of the brew's light on the belly, and a riveted band
    for x in range(-8, 9):
        if (x, -6) in body:
            px.put(x, -6, R_IRONPOT[3] if x % 4 else R_IRONPOT[4])
    for x, y in ((-6, -11), (-5, -11), (-7, -10)):
        px.put(x, y, R_IRONPOT[4])
    # the rim: a thick lip, lit on top
    for x in range(-12, 13):
        for y in (-15, -14):
            px.put(x, y, R_IRONPOT[4] if y == -15 and x < 6 else R_IRONPOT[3] if y == -15 else R_IRONPOT[2])
    px.put(-12, -14, R_IRONPOT[1])
    px.put(12, -15, R_IRONPOT[2])
    px.put(12, -14, R_IRONPOT[0])
    # the brew, seen a little from above: an ellipse inside the rim
    for x in range(-10, 11):
        for y in (-17, -16):
            if (x + 0.5) ** 2 / 110 + (y + 16) ** 2 / 3.2 <= 1:
                px.put(x, y, R_BREW[3 if y == -17 else 2])
    pops = [(-5, -17), (2, -16), (6, -17)]
    for i, (bx, by) in enumerate(pops):
        if i == frame:
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, -2)):
                px.put(bx + dx, by + dy, R_BREW[4] if dy == -2 else R_BREW[3])
            px.put(bx, by - 2, R_BREW[5])
        else:
            px.put(bx, by, R_BREW[4])
    # stubby feet poking out of the sand
    for x in (-8, 7):
        for dx in (0, 1):
            px.put(x + dx, 1, R_IRONPOT[1 + dx])
    for x in range(-10, 11):
        px.over(x, 2, hx("2a140a", 80))
    return px


def hw_brew_light():
    """The brew's glow over the Night layer: its surface and a faint green lick up the rim."""
    px = Px()
    for x in range(-10, 11):
        for y in (-17, -16):
            if (x + 0.5) ** 2 / 110 + (y + 16) ** 2 / 3.2 <= 1:
                px.put(x, y, R_BREW[4 if abs(x) < 6 else 3])
    for x in range(-11, 12):
        px.over(x, -15, R_BREW[4][:3] + (90,))
    return px


# ---- the bat: hangs upside down from the hood's front lip (it's outside the glass, in front of the water),
# wrapped in its wings, and now and then stretches one. Origin = where its feet grip the lip. Frames:
# 0 hanging, wrapped; 1 hanging, stretching its wings; 2-3 flying (front view, wings up / down), body below
# the origin so the box is the same whichever it's doing. Faces right at sx +1 (it's nearly symmetric).
BAT_S = 1.3


def hw_fill_poly(pts):
    """Integer pixels inside a polygon (even-odd, sampled at pixel centres)."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    out = set()
    for y in range(math.floor(min(ys)), math.ceil(max(ys)) + 1):
        for x in range(math.floor(min(xs)), math.ceil(max(xs)) + 1):
            cx_, cy_ = x + 0.5, y + 0.5
            inside = False
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                if (y1 > cy_) != (y2 > cy_) and cx_ < x1 + (cy_ - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
            if inside:
                out.add((x, y))
    return out


def hw_oval(cx, cy, rx, ry):
    return {(x, y) for y in range(math.floor(cy - ry) - 1, math.ceil(cy + ry) + 1)
            for x in range(math.floor(cx - rx) - 1, math.ceil(cx + rx) + 1)
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1}


def hw_wing(sign, frame):
    """One wing's membrane (sign -1 left, +1 right) and its finger bones, in BAT_S-scaled units."""
    s = BAT_S
    if frame == 1:  # hanging, stretched out to the side: wrist up near the feet, scallops hanging down
        pts = [(3.5, 4.5), (8, 2.2), (11.5, 1.2), (12.4, 4.5), (11.8, 8.5), (10, 7.4), (8.6, 10.6), (6.6, 9.6), (5.2, 12.4), (3.6, 11)]
        bones = [((3.5, 4.5), (11.5, 1.2)), ((11.5, 1.2), (11.8, 8.5)), ((11.5, 1.2), (8.6, 10.6)), ((11.5, 1.2), (5.2, 12.4))]
    elif frame == 2:  # flying, wings up
        pts = [(2.8, 9.5), (7, 6), (11, 2.2), (14.6, 1.4), (13.4, 5.6), (11.4, 4.8), (10.2, 9), (8, 8), (6.4, 11.6), (3.4, 12.6)]
        bones = [((2.8, 9.5), (14.6, 1.4)), ((11, 2.2), (13.4, 5.6)), ((11, 2.2), (10.2, 9)), ((11, 2.2), (6.4, 11.6))]
    else:  # flying, wings down
        pts = [(2.8, 9), (7, 9.4), (11.2, 11.4), (14.2, 16.4), (11.6, 14.6), (10.4, 17.4), (8.4, 14.8), (6.4, 16.6), (4.6, 13.6), (3, 12.8)]
        bones = [((2.8, 9), (11.2, 11.4)), ((11.2, 11.4), (14.2, 16.4)), ((11.2, 11.4), (10.4, 17.4)), ((11.2, 11.4), (6.4, 16.6))]
    pts = [(sign * x * s, y * s) for x, y in pts]
    bones = [((sign * a * s, b * s), (sign * c * s, d * s)) for (a, b), (c, d) in bones]
    return hw_fill_poly(pts), bones


def hw_bat_face(px, cx, cy, flip):
    """Big round eyes with a shine, a tiny pink nose, a smile and one small fang; flip = hanging upside down."""
    d = -1 if flip else 1
    for sx in (-1, 1):
        ex = cx + sx * 2
        for x, y in ((ex, cy), (ex - 1 if sx < 0 else ex, cy), (ex, cy + d), (ex - 1 if sx < 0 else ex, cy + d)):
            px.put(x, y, hx("120814"))
        px.put(ex - (1 if sx < 0 else 0), cy if not flip else cy + d, hx("ffffff"))
        px.put(cx + sx * 4 - (1 if sx < 0 else 0), cy + 2 * d, BAT_BLUSH)
    px.put(cx - 1, cy + 2 * d, hx("ff9ac0"))
    px.put(cx, cy + 2 * d, hx("ff9ac0"))
    for x in (cx - 2, cx + 1):
        px.put(x, cy + 3 * d, hx("2a1230"))
    px.put(cx - 1, cy + 4 * d if not flip else cy + 4 * d, hx("2a1230"))
    px.put(cx, cy + 4 * d, hx("2a1230"))
    px.put(cx + 1, cy + 4 * d, hx("fff8f0"))  # the fang


def hw_bat(frame):
    s = BAT_S
    px = Px()
    hang = frame < 2
    fur, wingc = R_BATFUR, R_BATWING

    def shade_set(mask, cols, light=(-0.6, -0.8)):
        if not mask:
            return
        xs = [p[0] for p in mask]
        ys = [p[1] for p in mask]
        cx_, cy_ = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        hw_, hh_ = max(1, (max(xs) - min(xs)) / 2), max(1, (max(ys) - min(ys)) / 2)
        for (x, y) in mask:
            t = 0.55 + 0.4 * ((x - cx_) / hw_ * light[0] + (y - cy_) / hh_ * light[1])
            px.put(x, y, cols[1 + shade_index(t, len(cols) - 2, x, y, 0.6)])
        for (x, y) in mask:
            e = lambda a, b: (x + a, y + b) not in mask
            if e(1, 0) or e(0, 1) or e(-1, 0) and x > cx_:
                px.put(x, y, cols[0])

    if hang:
        body = hw_oval(0, 7.5 * s, 4.6 * s, 6.4 * s)
        head = hw_oval(0, 15.2 * s, 4.4 * s, 3.8 * s)
        if frame == 1:
            for sx in (-1, 1):
                m, bones = hw_wing(sx, 1)
                shade_set(m, wingc)
                for (a, b), (c, d) in bones:
                    line_px(px, [(a, b), (c, d)], wingc[4] if sx < 0 else wingc[3])
                px.put(round(sx * 11.5 * s) - (1 if sx < 0 else 0), round(1.2 * s) - 1, hx("e8d8f0"))  # thumb claw
        shade_set(body, wingc if frame == 0 else fur)
        if frame == 0:  # wings wrapped round: fold lines, and the furry tummy peeking out down the middle
            for y in range(round(3 * s), round(12.5 * s)):
                w = 1.3 * s * math.sin(math.pi * (y - 3 * s) / (9.5 * s))
                for x in range(-round(w), round(w) + 1):
                    px.put(x - 0, y, fur[4] if x < 0 else fur[3])
            for sx in (-1, 1):
                line_px(px, [(sx * 2.8 * s, 2.6 * s), (sx * 3.5 * s, 7 * s), (sx * 2.6 * s, 12 * s)], wingc[0] if sx > 0 else wingc[1])
        shade_set(head, fur)
        for sx in (-1, 1):  # ears pointing down and out, over the head's lower corners, pink inside
            ear = hw_fill_poly([(sx * 1.4 * s, 17.4 * s), (sx * 4.5 * s, 15.6 * s), (sx * 4.6 * s, 21.4 * s)])
            shade_set(ear, fur)
            for y in range(round(17.6 * s), round(19.8 * s)):
                px.put(round(sx * 3.5 * s) - (1 if sx < 0 else 0), y, BAT_EAR)
        hw_bat_face(px, 0, round(14.6 * s), True)
        for sx in (-1, 1):  # feet gripping the lip
            for y in (0, 1):
                px.put(sx * 1 - (1 if sx < 0 else 0), y, hx("1a0c22") if y == 0 else fur[2])
        return px
    # flying: front view, right way up
    for sx in (-1, 1):
        m, bones = hw_wing(sx, frame)
        shade_set(m, wingc)
        for (a, b), (c, d) in bones:
            line_px(px, [(a, b), (c, d)], wingc[4] if sx < 0 else wingc[3])
    body = hw_oval(0, 12 * s, 3.6 * s, 4.6 * s)
    head = hw_oval(0, 6.4 * s, 3.9 * s, 3.4 * s)
    ears = set()
    for sx in (-1, 1):
        ears |= hw_fill_poly([(sx * 1.2 * s, 5 * s), (sx * 3.9 * s, 6 * s), (sx * 3.4 * s, 0.6 * s)])
    shade_set(body, fur)
    for y in range(round(10 * s), round(15 * s)):  # tummy
        px.put(0, y, fur[4])
        px.put(-1, y, fur[4])
    shade_set(ears, fur)
    for sx in (-1, 1):
        for y in range(round(2 * s), round(4.6 * s)):
            px.put(round(sx * 2.7 * s) - (1 if sx < 0 else 0), y, BAT_EAR)
    shade_set(head, fur)
    hw_bat_face(px, 0, round(6.2 * s), False)
    for sx in (-1, 1):  # little feet tucked up
        px.put(sx * 2 - (1 if sx < 0 else 0), round(16.8 * s), hx("1a0c22"))
    return px


def hw_bat_eyes(frame):
    """Eyeshine for the night: the two shines, a touch bigger, over the bat's night tint."""
    px = Px()
    flip = frame < 2
    cy = round((14.6 if flip else 6.2) * BAT_S)
    d = -1 if flip else 1
    for sx in (-1, 1):
        ex = cx = sx * 2 - (1 if sx < 0 else 0)
        px.put(ex, cy if not flip else cy + d, hx("fff4c8"))
        px.over(ex + (1 if sx < 0 else -1), cy if not flip else cy + d, hx("ffd86a", 120))
    return px


# ---- the ghost-pale morph (art only; the logic's morph id 2 writes j{s}ghost = 1). A Ghost palette group per
# species and stage, like Morph: every palette gets a "g" key, its colours mapped by lightness onto a cool
# moonlit ramp (deep periwinkle shadows, mint-white light) and a little more see-through. While it shows, the
# usual tentacles fade back (GhostFade) and a pale halo glows round the bell.
HW_GHOST = ramp("262a52", "56649a", "92b2d2", "cdf0e8", "f4fffa")


def hw_ghostify(c, alpha=0.82):
    r, g_, b, a = c
    lum = (0.3 * r + 0.59 * g_ + 0.11 * b) / 255
    t = (0.16 + 0.84 * lum ** 0.7) * (len(HW_GHOST) - 1)
    i = min(len(HW_GHOST) - 2, int(t))
    rgb = mix(HW_GHOST[i], HW_GHOST[i + 1], t - i)[:3]
    return (*rgb, max(30, round(a * alpha)))


def hw_ghost_pal(src):
    return {key: (hw_ghostify(c) if isinstance(c, tuple) else c) for key, c in src.items()}


JELLY["jg"] = hw_ghost_pal(JELLY["j"])
PAL_MOON["g"] = "jg"
for _pals in (BLUBBER, UPSIDE):
    _pals["g"] = hw_ghost_pal(_pals["h"])
COMB["g"] = dict(hw_ghost_pal(COMB["h"]), comb=0.8, sat=0.18)  # the comb rows still shimmer, faintly
for _k in NEW:
    NEW[_k]["g"] = hw_ghost_pal(NEW[_k]["h"])
HW_GHOST_FADE = 0.45  # the usual tentacles' opacity under a ghost bell
HW_FADE_CONV = nid()  # DataConverterRangeMapper ghost 0..1 -> 1..HW_GHOST_FADE (appended last: the list is positional)


def hw_ghost_tents(tents):
    """The stage's tentacles, faded back while the ghost palette shows."""
    return [node("GhostFade", tents, binds=[bind(jprop("ghost"), 18, HW_FADE_CONV)])]


def hw_ghost_halo(gcy, gw, gh):
    return ellipse_shape("GhostGlow", 0, gcy, round(gw * 0.95), round(gh * 0.95),
                         rad_grad(0, 0, round(gw * 0.48), [(0, hx("e8fff6", 120)), (0.45, hx("a8e8e0", 50)), (1, hx("a8e8e0", 0))]),
                         blend="screen", opacity=0, binds=[bind(jprop("ghost"), 18)])


# ---- placement (logical; base points on the sand). Pumpkins: (x, rx, ry, face, tier). The cauldron sits in the
# open sand left of the chest. Only what the tier's glass holds is in view; the rest waits behind the wall.
HW_PUMPKINS = [(57, 11, 8, "big", 0), (75, 6, 5, "small", 0), (205, 8, 6, "mid", 0), (284, 7, 5, "small", 1), (446, 9, 7, "mid", 2)]
HW_CAULDRON_X = 131
HW_DEPTH = 9  # how far in front of the sand's top edge they sit (logical px)


def hw_base_y(x):
    return min(WATER_BOT - 2, sand_top(x) + HW_DEPTH)


def hw_event_bind():
    return dict(opacity=0, binds=[bind(prop("evHalloween"), 18)])


def hw_brew_bubble(r):
    px = Px()
    for (x, y), c in bubble_art(r).d.items():
        px.put(x, y, mix(c, R_BREW[4], 0.55)[:3] + (c[3],))
    return px


def hw_decor_node():
    """World layer: the pumpkins and the cauldron (bubbling in three frames) on the sand, behind the front kelp."""
    kids = [image(f"hw_Pumpkin{i}", lambda rx=rx, ry=ry, face=face: hw_pumpkin(rx, ry, face), lx=x, ly=hw_base_y(x))
            for i, (x, rx, ry, face, _) in enumerate(HW_PUMPKINS)]
    ids = [nid() for _ in range(3)]
    pot = [image(f"hw_Cauldron{f}", lambda f=f: hw_cauldron(f), opacity=1 if f == 0 else 0, node_id=ids[f]) for f in range(3)]
    frame_cycle("hw_CauldronBubble", ids, [0, 1, 2, 1, 0, 2], 22)
    # green bubbles drifting up from the brew, each its own loop
    by = -18
    for j, (dur, dx, r) in enumerate([(360, -3, 1), (430, 2, 2), (520, 5, 1)]):
        bid = nid()
        pot.append(image(f"hw_BrewBubble{r}", lambda r=r: hw_brew_bubble(r), node_id=bid, opacity=0, node_name=f"hw_BrewBubble{j}"))
        rise = min(dur - 20, 190 + j * 40)
        add_anim(f"hw_BrewBubble{j}", dur, [
            keys(bid, 14, [(0, by * P), (rise, (by - 60 - j * 12) * P)], "linear"),
            keys(bid, 13, [(f, (dx + round(math.sin(f / 30 + j) * 2)) * P) for f in range(0, rise + 1, 30)], "cubic"),
            keys(bid, 18, [(0, 0), (8, 1), (rise - 30, 0.8), (rise, 0)], "linear"),
        ])
    kids.append(node("hw_Cauldron", list(reversed(pot)), x=HW_CAULDRON_X * P, y=hw_base_y(HW_CAULDRON_X) * P))
    return node("HwDecor", list(reversed(kids)), **hw_event_bind())


def hw_glow_node():
    """WorldMid, over the Night layer: each pumpkin's candle light (faint by day, full at night) with a warm halo
    that flickers, and the brew's green glow. One flicker timeline for all of them (each its own pattern)."""
    kids, tracks = [], []
    flick = [[(0, 1), (9, 0.78), (14, 0.94), (26, 0.7), (31, 1), (47, 0.84), (52, 0.97), (70, 0.74), (76, 1), (95, 0.88), (120, 1)],
             [(0, 0.85), (12, 1), (20, 0.72), (33, 0.95), (45, 0.8), (58, 1), (66, 0.76), (84, 0.98), (101, 0.82), (120, 0.85)],
             [(0, 0.95), (7, 0.75), (19, 1), (38, 0.86), (44, 0.7), (51, 0.96), (73, 0.8), (88, 1), (106, 0.74), (120, 0.95)]]
    for i, (x, rx, ry, face, _) in enumerate(HW_PUMPKINS):
        hid, lid = nid(), nid()
        halo = ellipse_shape("CandleHalo", 0, -ry * P, (rx * 5) * P, (ry * 5) * P,
                             rad_grad(0, 0, round(rx * 2.5) * P, [(0, hx("ffb84a", 150)), (0.35, hx("ff8a2a", 70)), (1, hx("ff6a1a", 0))]),
                             blend="screen", sid=hid)
        light = node("Flame", [image(f"hw_PumpkinLight{i}", lambda rx=rx, ry=ry, face=face: hw_pumpkin_light(rx, ry, face))], node_id=lid)
        kids.append(node(f"hw_Lantern{i}", [
            node("HaloNight", [halo], opacity=0, binds=[bind(prop("nightShade"), 18)]),
            node("LightNight", [light], binds=[bind(prop("nightShade"), 18, NIGHT_GLOW_CONV)]),
        ], x=x * P, y=hw_base_y(x) * P))
        pat = flick[i % len(flick)]
        tracks.append(keys(hid, 18, pat, "linear"))
        tracks.append(keys(lid, 18, [(f, round(0.75 + 0.25 * v, 3)) for f, v in pat], "linear"))
    add_anim("hw_Flicker", 120, tracks)
    brew = node("hw_Brew", [
        node("HaloNight", [ellipse_shape("BrewHalo", 0, -19 * P, 44 * P, 30 * P,
                                         rad_grad(0, 0, 22 * P, [(0, hx("9af06a", 120)), (0.45, hx("4ccc3a", 45)), (1, hx("4ccc3a", 0))]),
                                         blend="screen")], opacity=0, binds=[bind(prop("nightShade"), 18)]),
        node("LightNight", [image("hw_BrewLight", hw_brew_light)], binds=[bind(prop("nightShade"), 18, NIGHT_GLOW_CONV)]),
    ], x=HW_CAULDRON_X * P, y=hw_base_y(HW_CAULDRON_X) * P)
    kids.append(brew)
    return node("HwGlow", list(reversed(kids)), **hw_event_bind())


# the bat's perch: the hood's front lip, the top of the water (world y, artboard units)
HW_BAT_HANG_Y = WATER_TOP * P
HW_BAT_NIGHT = hx("08103a", 140)


def hw_bat_node():
    """WorldGlass: the bat visitor (props batOn/X/Y/SX/F0..3, like the others), with a night tint and eyeshine."""
    tint_ = node("BatNight", list(reversed([
        image(f"hw_BatNight{f}", lambda f=f: silhouette(hw_bat(f), HW_BAT_NIGHT), opacity=1 if f == 0 else 0,
              binds=[bind(prop(f"batF{f}", default=1 if f == 0 else 0), 18)]) for f in range(4)])),
        opacity=0, binds=[bind(prop("nightShade"), 18)])
    eyes = node("BatEyes", list(reversed([
        image(f"hw_BatEyes{f}", lambda f=f: hw_bat_eyes(f), opacity=1 if f == 0 else 0, blend="screen",
              binds=[bind(prop(f"batF{f}", default=1 if f == 0 else 0), 18)]) for f in range(4)])),
        opacity=0, binds=[bind(prop("nightShade"), 18)])
    bat = visitor_node("bat", "hw_Bat", hw_bat, 120 * P, HW_BAT_HANG_Y, extra=[eyes, tint_])
    return node("HwBat", [bat], **hw_event_bind())


def hw_contract(c):
    """What the logic needs to know, merged into contract.json."""
    c["seasons"] = {"halloween": {"prop": "evHalloween", "sprites": "hw_", "visitor": "bat", "morphKey": "ghost"}}
    c["batHangY"] = HW_BAT_HANG_Y
    c["visitorOrigin"]["bat"] = "where its feet grip the hood's lip (y = batHangY when hanging); flying, the same point above it"
# ---- end Halloween event ----


# ---------------------------------------------------------------- v5: walls, the medium stretch, the cave

def side_wall_art(right):
    """A glass wall's metal edge, columns as the v4 frame had them. Left: x 0..4 (world). Right: x -5..-1,
    local to the wall node (which stands at wallX)."""
    px = Px()
    for y in range(0, CAB_TOP):
        for x in (range(-GLASS_L, 0) if right else range(0, GLASS_L)):
            sx = x + LW if right else x  # the v4 frame's screen column
            i = 3 if sx in (1, LW - 2) else 2 if sx in (GLASS_L - 1, GLASS_R + 1) else 1
            px.put(x, y, METAL[i])
    return px


R_SEAGRASS = ramp("163626", "1f5230", "2f7236", "48923c", "74b44a", "acd868")
R_SPONGE = ramp("4a1a10", "8a3416", "c85a22", "ec8a34", "ffbe5a", "ffe6a0")
R_TABLE = ramp("173c44", "235e5e", "348474", "52aa88", "86cca0", "c4ecc0")
R_URCHIN = ramp("140a24", "2c1a44", "4a3070", "70529a")
R_CAVE = ramp("080a1c", "10142e", "181f44", "232d5a", "334476", "4b6598")
GLOW_T, GLOW_C, GLOW_V, GLOW_P = hx("6affd8"), hx("8ff4ff"), hx("c9a0ff"), hx("ff8ad8")


def seagrass(lean, x0, x1, seed):
    """A meadow of 1-px eelgrass blades rooted in the sand, taller in the middle of the patch."""
    px = Px()
    r2 = random.Random(seed)
    blades = []
    x = x0
    while x <= x1:
        env = math.sin(math.pi * (x - x0) / (x1 - x0)) ** 0.6
        h = max(4, round(r2.randint(10, 27) * (0.3 + 0.7 * env)))
        blades.append((x, h, r2.random() * 6, r2.randint(1, 4), r2.uniform(0.6, 1.25)))
        x += r2.choice([1, 2, 2, 3])
    blades.sort(key=lambda b: b[3])  # darker blades behind the lit ones
    for bx, h, ph, shade, flex in blades:
        base = sand_top(bx) + 2
        for t in range(h):
            f = t / h
            off = lean * 4.5 * flex * f ** 1.6 + 0.9 * math.sin(t * 0.35 + ph) * f
            c = R_SEAGRASS[max(0, shade - 1)] if t < 2 else R_SEAGRASS[min(5, shade + (1 if f > 0.72 else 0))]
            px.put(round(bx + off), base - t, c)
    return px


def tube_sponge(px, x, base_y, heights, rmp):
    """Clustered tube sponges, lit from the left, a dark mouth at each top."""
    for k, h in enumerate(heights):
        bx = x + k * 4 - len(heights) * 2
        for t in range(h):
            cx = bx + round(0.6 * math.sin(t * 0.25 + k))
            for o in range(-1, 3):
                c = rmp[4] if o == -1 else rmp[3] if o == 0 else rmp[2] if o == 1 else rmp[0]
                if (t + k) % 5 == 0 and 0 <= o <= 1:
                    c = rmp[max(1, rmp.index(c) - 1)]
                px.put(cx + o, base_y - t, c)
        cx = bx + round(0.6 * math.sin(h * 0.25 + k))
        for o in range(-1, 3):
            px.put(cx + o, base_y - h, rmp[5] if o < 2 else rmp[1])
        px.put(cx, base_y - h + 1, rmp[0])
        px.put(cx + 1, base_y - h + 1, rmp[0])


def table_coral(px, cx, y, w):
    """A plate coral on a short stalk: lit top rim, shadowed underside, dithered polyps."""
    for t in range(4):
        px.put(cx, y + 1 + t, R_TABLE[1])
        px.put(cx + 1, y + 1 + t, R_TABLE[0])
    for x in range(cx - w, cx + w + 2):
        u = abs(x + 0.5 - cx - 0.5) / (w + 0.5)
        th = 2 if u < 0.85 else 1
        px.put(x, y - 1, R_TABLE[5] if x < cx else R_TABLE[4])
        for d in range(th):
            px.put(x, y + d, R_TABLE[3 if (x + d) % 3 else 2])
        px.put(x, y + th, R_TABLE[0])


def urchin(px, cx, cy, r):
    for k in range(14):
        a = k / 14 * 2 * math.pi
        for s in range(r, r + 3):
            px.put(round(cx + math.cos(a) * s), round(cy + math.sin(a) * s * 0.8), R_URCHIN[1 if k % 3 else 0])
    disc(px, cx, cy, r, (R_URCHIN[0], R_URCHIN[1], R_URCHIN[2], R_URCHIN[3]))


def shell(px, x, y):
    """A small spiral conch lying on the sand."""
    for (dx, dy), i in {(0, 0): 3, (1, 0): 4, (2, 0): 3, (3, 0): 2, (-1, 1): 2, (0, 1): 3, (1, 1): 3, (2, 1): 2,
                        (3, 1): 1, (4, 1): 1, (1, -1): 4, (2, -1): 3}.items():
        px.put(x + dx, y + dy, R_SHELL[i])
    px.put(x + 1, y, R_SHELL[1])


# ---- the cave: a dark rock arch on the far right. Its mouth is a semi-ellipse standing on the sand;
# its back rises to the right into a cliff that meets the hood; an overhang (the lip) juts out left.

CAVE_C, CAVE_A, CAVE_TOP, CAVE_BASE = 422, 44, 196, 354


def cave_open(x, y, grow=0.0):
    """Inside the arch's mouth (logical pixel x, y)."""
    dx = (x + 0.5 - CAVE_C) / (CAVE_A + grow)
    dy = min(0.0, (y + 0.5 - CAVE_BASE) / (CAVE_BASE - CAVE_TOP + grow))
    wob = 0.05 * math.sin(y * 0.21 + x * 0.05) + 0.03 * math.sin(x * 0.4)
    return dx * dx + dy * dy <= 1 + wob


def arch_top(x):
    """Top of the rock at column x: the lip, then the arch's back climbing into the cliff."""
    if x < LIP_X:
        return None
    if x < 392:
        return 114 - round((x - LIP_X) * 0.25) + round(1.5 * math.sin(x * 0.7))
    u = smoothstep((x - 392) / 80)
    return max(WATER_TOP, round(104 - (104 - WATER_TOP) * u ** 1.3 + 3 * math.sin(x * 0.23)))


LIP_X = TIER_W[1] + 1  # the lip's tip: just past the medium tank's wall


def lip_bot(x):
    return 124 + round((x - LIP_X) * 0.5 + 2 * math.sin(x * 0.5))


def leg_left(y):
    return 380 + round(1.5 * math.sin(y * 0.09)) - round(16 * smoothstep((y - 250) / 100))


def in_arch(x, y):
    t = arch_top(x)
    if t is None or y < t or cave_open(x, y):
        return False
    if x < LIP_X + 4 and y > t + (x - LIP_X + 1) * 2.6:  # round off the lip's tip
        return False
    return x >= 392 or y <= lip_bot(x) or x >= leg_left(y)


def arch_mask():
    m = set()
    for x in range(LIP_X, WLW):
        t = arch_top(x)
        if t is None:
            continue
        for y in range(t, WATER_BOT + 1):
            if in_arch(x, y):
                m.add((x, y))
    for sx, ln in ((LIP_X + 4, 8), (LIP_X + 11, 13), (LIP_X + 18, 9), (LIP_X + 24, 6)):  # stalactites under the lip
        y0 = max(y for (xx, y) in m if xx == sx and y < 200)
        for k in range(ln):
            w = 1.7 * (1 - k / ln) + 0.3
            for x in range(sx - 2, sx + 3):
                if abs(x - sx) <= w:
                    m.add((x, y0 + k))
    for sx, ln in ((CAVE_C - 15, 5), (CAVE_C - 7, 8), (CAVE_C + 6, 6), (CAVE_C + 14, 9), (CAVE_C + 21, 4)):  # and from the mouth's crown
        y0 = min(y for y in range(CAVE_TOP - 6, WATER_BOT) if (sx, y) not in m and cave_open(sx, y)) - 1
        for k in range(ln):
            w = 1.3 * (1 - k / ln) + 0.2
            for x in range(sx - 2, sx + 3):
                if abs(x - sx) <= w:
                    m.add((x, y0 + k))
    return m


ARCH = None  # (mask, dots, threads) once built


def arch_art():
    """The arch rock: lit from the upper left where it faces open water, a teal bounce along the rim of
    the mouth, cracks, moss on its back. Returns (px, dots, beads) for the glow layer."""
    m = arch_mask()
    r2 = random.Random(77)
    cave = lambda x, y: (x, y) not in m and cave_open(x, y) and y >= CAVE_TOP - 8 and x >= CAVE_C - CAVE_A - 6
    water = lambda x, y: (x, y) not in m and not cave(x, y)
    # distance from open water, for volume
    dist = {}
    frontier = [p for p in m if any(water(p[0] + a, p[1] + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for p in frontier:
        dist[p] = 1
    while frontier:
        nxt = []
        for x, y in frontier:
            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + a, y + b)
                if q in m and q not in dist:
                    dist[q] = dist[(x, y)] + 1
                    nxt.append(q)
        frontier = nxt
    rim = {}
    for x, y in m:
        for k in (1, 2, 3):
            if any(cave(x + a * k, y + b * k) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1))):
                rim[(x, y)] = k
                break
    px = Px()
    for x, y in m:
        d = dist.get((x, y), 40)
        strata = 0.5 * math.sin(y * 0.19 + math.sin(x * 0.07) * 2.2) + 0.5 * math.sin(x * 0.11 - y * 0.05)
        t = 0.66 - 0.03 * min(d, 14) + 0.1 * strata - 0.14 * smoothstep((x - 400) / 80) - 0.1 * smoothstep((y - 220) / 130)
        c = R_CAVE[1 + shade_index(t, 4, x, y, 0.8)]
        if water(x - 1, y) or water(x, y - 1):
            c = R_CAVE[5] if water(x, y - 1) and y < 240 else R_CAVE[4]
        elif water(x - 2, y) or water(x, y - 2) or water(x - 1, y - 1):
            c = R_CAVE[4] if bay(x, y) < 0.2 else R_CAVE[3]
        elif water(x + 1, y) or water(x, y + 1):
            c = R_CAVE[0]
        if (x, y) in rim:
            k = rim[(x, y)]
            c = mix(c, hx("2a9a98"), (0.42, 0.24, 0.1)[k - 1])
        px.put(x, y, c)
    # cracks: carved lines with a lit lip above
    for _ in range(9):
        x, y = r2.choice(sorted(p for p in m if dist.get(p, 0) > 4))
        for _ in range(r2.randint(10, 28)):
            if (x, y) not in m or (x, y) in rim:
                break
            px.put(x, y, R_CAVE[0])
            if (x - 1, y - 1) in m:
                px.put(x - 1, y - 1, R_CAVE[3])
            x += r2.choice([-1, 0, 1, 1])
            y += r2.choice([1, 1, 0])
    # ledges: a lit step with a shadow under it, so the cliff face reads as rock, not a flat fill
    for _ in range(9):
        x, y = r2.choice(sorted(p for p in m if dist.get(p, 0) > 5 and p not in rim and (p[0] > 396 or p[1] < 190)))
        ln, slope = r2.randint(10, 22), r2.uniform(-0.3, 0.2)
        for k in range(ln):
            xx, yy = x + k, round(y + k * slope)
            taper = min(k, ln - 1 - k)
            if all((xx, yy + d) in m and (xx, yy + d) not in rim for d in (-1, 0, 1, 2)):
                px.put(xx, yy, R_CAVE[3] if taper > 1 or bay(xx, yy) < 0 else R_CAVE[2])
                if taper > 0:
                    px.put(xx, yy + 1, R_CAVE[0])
                if taper > 2 and (xx + yy) % 2:
                    px.put(xx, yy + 2, R_CAVE[1])
    for _ in range(6):  # embedded boulders, lit like the rest
        x, y = r2.choice(sorted(p for p in m if dist.get(p, 0) > 8 and p not in rim))
        lump = Px()
        blob(lump, x, y, r2.randint(5, 9), r2.randint(4, 6), R_CAVE[1:5], rough=1, seed=r2.random() * 9)
        for (xx, yy), c in lump.d.items():
            if (xx, yy) in m and (xx, yy) not in rim:
                px.put(xx, yy, c)
    # moss and sponges on the lit back of the arch and the lip
    tops = {}
    for x, y in m:
        if water(x, y - 1) and (x not in tops or y < tops[x]):
            tops[x] = y
    for x, y in sorted(tops.items()):
        if y > 300:
            continue
        roll = r2.random()
        if roll < 0.32:
            for k in range(r2.randint(1, 3)):
                px.put(x, y - 1 - k, R_KELP[r2.randint(2, 4)])
        elif roll < 0.4:
            disc(px, x, y - 1.2, 1.6, (R_FAN[1], R_FAN[2], R_FAN[3], R_FAN[4]))
    for bx in (398, 452):
        if bx in tops:
            branch_coral(px, bx, tops[bx] - 1, -1.7 + (0.3 if bx > 420 else 0), 6, 1.4, 1, R_CORAL, r2)
    # bioluminescent dots: thickest around the mouth and under the lip
    cand = [p for p in m if p in rim and rim[p] >= 2] * 3 + [p for p in m if p[0] < 392 and water(p[0], p[1] + 2)] * 2 \
        + [p for p in m if p[0] > CAVE_C - 10 and dist.get(p, 0) > 3 and 50 < p[1] < CAVE_TOP - 6 and (p[0] * 7 + p[1] * 3) % 5 == 0]
    cand.sort()
    dots = []
    for p in r2.sample(cand, 80):
        if any(abs(p[0] - q[0]) + abs(p[1] - q[1]) < 3 for q, _ in dots):
            continue
        col = r2.choice([GLOW_T, GLOW_C, GLOW_C, GLOW_V]) if p in rim else r2.choice([GLOW_V, GLOW_C, GLOW_T])
        dots.append((p, col))
        px.put(*p, mix(R_CAVE[2], col, 0.45))
    # glow-worm threads hanging from the mouth's crown: faint silk, beads of light
    beads = []
    for tx in range(CAVE_C - 26, CAVE_C + 27, 4):
        tx += r2.choice([-1, 0, 1])
        ys = [y for y in range(CAVE_TOP - 8, WATER_BOT) if (tx, y) not in m and cave_open(tx, y)]
        if not ys:
            continue
        y0 = ys[0]
        ln = r2.randint(7, 26)
        for k in range(ln):
            px.put(tx, y0 + k, hx("7aa4cc", 70 if k % 2 else 110))
            if k > 2 and (k + tx) % 4 == 0:
                beads.append(((tx, y0 + k), r2.choice([GLOW_C, GLOW_T, hx("e8fff8")])))
    ARCH_TOPS.update({x: min(y for (xx, y) in m if xx == x) for x in {p[0] for p in m}})
    return px, dots, beads


ARCH_TOPS = {}  # column -> top of the arch rock, filled by arch_art


def cave_back_art():
    """What you see inside the mouth: a passage receding into the dark, a little lighter at its walls."""
    px = Px()
    for y in range(CAVE_TOP - 8, WATER_BOT + 1):
        for x in range(CAVE_C - CAVE_A - 6, CAVE_C + CAVE_A + 7):
            if not cave_open(x, y, grow=4):
                continue
            dx = (x + 0.5 - CAVE_C - 3) / CAVE_A
            dy = (y + 0.5 - 290) / 110
            r = math.hypot(dx, dy)
            inner = ((x + 0.5 - CAVE_C - 4) / (CAVE_A * 0.55)) ** 2 + (min(0, y + 0.5 - CAVE_BASE) / ((CAVE_BASE - CAVE_TOP) * 0.62)) ** 2 <= 1
            t = 0.08 + 0.55 * r ** 1.6 + 0.06 * math.sin(x * 0.35 + y * 0.12) + 0.05 * math.sin(y * 0.5 - x * 0.2)
            if inner:
                t *= 0.45
            px.put(x, y, R_CAVE[min(3, shade_index(t, 4, x, y, 0.9))])
    r2 = random.Random(81)
    pts = sorted(px.d)
    for _ in range(14):  # a few far motes of light deep inside
        x, y = r2.choice(pts)
        if y < 330:
            px.put(x, y, mix(R_CAVE[1], r2.choice([GLOW_C, GLOW_V]), 0.5))
    return px


# anemones: (column dark, mid, light), (tentacle shadow, dark, mid, light), tip, glow colour
A_VIOLET = (ramp("1c0a34", "34165a", "52287e"), ramp("4a1a64", "8a3aa8", "c062d0", "ec9cec"), hx("a8fcff"), GLOW_C)
A_TEAL = (ramp("0c2638", "16405a", "246078"), ramp("12485a", "1f7a86", "3cb4b4", "8eeedc"), hx("f4fffc"), GLOW_T)
A_PINK = (ramp("3a0c26", "661a44", "922e66"), ramp("6a1a48", "b03c78", "e46aa2", "ffb6d4"), hx("b4fff0"), GLOW_P)
A_ORANGE = (ramp("4a1a0c", "7a3216", "a8501e"), ramp("8a2e14", "d0602a", "f89448", "ffd08a"), hx("fff4d8"), None)
ANEMONES = [  # x, size, palette, where: "back" = tucked in the mouth's corners, behind the walkers; "arch" = on its back
    (388, 0.95, A_VIOLET, "back"),
    (457, 0.8, A_TEAL, "back"),
    (437, 0.75, A_PINK, "arch"),
]


def anemone(px, cx, by, frame, s, A, glow=None):
    """A tube anemone: a short flared column and a crown of long tentacles curling out and swaying.
    When `glow` is given (and the palette glows), the outer half of each tentacle is painted there too."""
    col, T, tip, gcol = A
    ph = frame / 4 * 2 * math.pi
    ch = max(3, round(6 * s))
    cw = 2.6 * s
    for t in range(ch + 1):
        hw = cw * (1 + 0.3 * t / ch)
        for x in range(math.floor(cx - hw), math.ceil(cx + hw)):
            u = (x + 0.5 - cx) / hw
            px.put(x, by - t, col[2] if u < -0.4 else col[1] if u < 0.45 else col[0])
    top = by - ch
    n = max(7, round(13 * s))
    for i in sorted(range(n), key=lambda i: -abs(i - (n - 1) / 2)):  # outer tentacles behind the middle ones
        f = i / (n - 1) * 2 - 1
        L = (9 + 5 * (1 - abs(f))) * s
        x, y = cx + f * cw * 1.15, top
        a0 = f * 1.3
        steps = max(4, int(L / 0.8))
        for st in range(steps):
            u = st / steps
            ang = a0 * (1 + 0.55 * u) + 0.38 * math.sin(ph + i * 1.3 + u * 2.4) * u
            x += math.sin(ang) * 0.8
            y -= math.cos(ang) * 0.8
            c = tip if u > 0.86 else T[3] if u > 0.6 else T[2] if u > 0.28 else T[1]
            if f > 0.35 and u < 0.6:
                c = T[0] if u < 0.28 else T[1]
            px.put(round(x), round(y), c)
            if glow is not None and gcol is not None and u > 0.4:
                a = (u - 0.4) / 0.6
                glow.over(round(x), round(y), gcol[:3] + (round(70 + 150 * a),))
                if u > 0.86:
                    glow.put(round(x), round(y), mix(gcol, hx("ffffff"), 0.6)[:3] + (255,))
                    for a2, b2 in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        glow.over(round(x) + a2, round(y) + b2, gcol[:3] + (70,))
    for x in range(math.floor(cx - cw), math.ceil(cx + cw)):
        px.put(x, top, T[3] if x < cx else T[2])


def chevron_art():
    """A right-pointing double chevron, cream with a dark selective outline. Origin = its centre-left."""
    px = Px()
    for off, a in ((0, 255), (5, 150)):
        for k in range(-5, 6):
            x = off + 5 - abs(k)
            px.put(x, k, hx("fff4d4", a))
            px.put(x + 1, k, hx("ffd98a", a) if k > 0 else hx("fff4d4", a))
    ink = Px()
    for (x, y) in list(px.d):
        for a2, b2 in ((1, 0), (0, 1), (1, 1), (-1, 0), (0, -1)):
            if not px.has(x + a2, y + b2):
                ink.put(x + a2, y + b2, hx("0a1a33", 140))
    for (x, y), c in px.d.items():
        ink.put(x, y, c)
    return ink


def mirror(px):
    out = Px()
    for (x, y), c in px.d.items():
        out.put(-x - 1, y, c)
    return out


def tank_icon(tier):
    """Shop icon for a tank upgrade: a little aquarium on a stand, wider for each tier, with a double arrow
    over it. Origin = bottom-centre."""
    px = Px()
    w = 30 if tier == 1 else 38
    h = 20
    x0 = -w // 2
    stand_top = -5
    y0 = stand_top - h
    for x in range(x0 + 1, x0 + w - 1):  # stand
        for y in range(stand_top, 0):
            px.put(x, y, R_WOOD[0] if y == -1 or x in (x0 + 1, x0 + w - 2) else R_WOOD[4] if y == stand_top else R_WOOD[2 if (x + y) % 4 else 3])
    for y in range(y0, stand_top):
        for x in range(x0, x0 + w):
            edge = x in (x0, x0 + w - 1) or y in (y0, y0 + 1, stand_top - 1)
            if edge:
                c = METAL[4] if y == y0 else METAL[3] if y == y0 + 1 else METAL[2] if x == x0 else METAL[1]
            else:
                u = (y - y0 - 2) / (h - 3)
                c = mix(hx("4cc9e6"), hx("125fa6"), u)
                if y >= stand_top - 4:
                    c = R_SAND[4] if y == stand_top - 4 else R_SAND[3]
            px.put(x, y, c)
    sb = stand_top - 4
    for k, gx in enumerate(range(x0 + 3, x0 + 9, 2)):  # seagrass + kelp on the left
        for t in range(3 + k % 2 * 2):
            px.put(gx + (t > 2), sb - 1 - t, R_SEAGRASS[3 + t % 2])
    for t in range(9):
        px.put(x0 + 11 + (1 if t in (3, 4) else 0), sb - 1 - t, R_KELP[3])
    jx, jy = x0 + w // 2 - 2 - (3 if tier == 2 else 0), y0 + 6  # a jelly
    for dx, dy, c in [(0, 0, "f29ad6"), (1, 0, "ffc8ec"), (2, 0, "f29ad6"), (-1, 1, "c860b4"), (0, 1, "f29ad6"),
                      (1, 1, "f29ad6"), (2, 1, "f29ad6"), (3, 1, "c860b4"), (-1, 2, "ffd6f2"), (1, 2, "ffd6f2"), (3, 2, "ffd6f2"),
                      (0, 3, "f7a6dc"), (2, 4, "f7a6dc")]:
        px.put(jx + dx, jy + dy, hx(c))
    if tier == 1:
        for x in range(x0 + w - 11, x0 + w - 4):  # a coral mound
            hh = 3 - abs(x - (x0 + w - 8)) // 2
            for t in range(hh):
                px.put(x, sb - 1 - t, R_CORAL[3 + (t == hh - 1)] if x < x0 + w - 7 else R_CORAL[2])
    else:
        ax = x0 + w - 13
        for y in range(y0 + 7, sb):  # the cave: a dark arch, glowing inside
            for x in range(ax, x0 + w - 1):
                dx = (x + 0.5 - (ax + 6)) / 4.2
                dy = (y + 0.5 - sb) / 7.5
                inner = dx * dx + min(dy, 0) ** 2 <= 1
                outer = y >= y0 + 7 + max(0, (ax + 4 - x))
                if outer and not inner:
                    px.put(x, y, R_CAVE[3] if (x - ax) < 2 or y == y0 + 7 + max(0, (ax + 4 - x)) else R_CAVE[1])
                elif inner:
                    px.put(x, y, R_CAVE[0])
        for gx, gy, c in [(ax + 5, sb - 2, GLOW_C), (ax + 7, sb - 4, GLOW_P), (ax + 6, sb - 1, GLOW_T), (ax + 2, y0 + 10, GLOW_C),
                          (ax + 9, y0 + 9, GLOW_V)]:
            px.put(gx, gy, c)
    ay = y0 - 5  # double arrow: the tank grows wider
    for x in range(x0 + 2, x0 + w - 2):
        px.put(x, ay, INK)
    for k in (1, 2):
        for s_, xe in ((1, x0 + 2), (-1, x0 + w - 3)):
            px.put(xe + s_ * k, ay - k, INK)
            px.put(xe + s_ * k, ay + k, INK)
    return px


# ---------------------------------------------------------------- v11: tank themes
# Four looks for the world backdrop: the water, the far and mid parallax layers, the floor (sand), the light
# shafts and the fog. Reef (0) is the original; Kelp Forest (1), Coral Garden (2) and Arctic (3) replace it.
# The interactive layer (reef rocks, chest, decor, jellies, helpers) is shared by all four. Each theme's
# backdrop groups are bound to theme{t} (one-hot); hidden ones are at opacity 0 and hold nothing clickable.

THEMES = ["Reef", "Kelp", "Coral", "Arctic"]
THEME_TITLES = ["REEF", "KELP FOREST", "CORAL GARDEN", "ARCTIC"]
THEME_WATER = {
    0: [(0, "8fe8f2"), (0.06, "4cc9e6"), (0.35, "1f95cf"), (0.7, "125fa6"), (1, "0b3a78")],
    1: [(0, "e4ecaa"), (0.05, "a8d690"), (0.3, "4fa088"), (0.66, "236a6c"), (1, "0e3442")],
    2: [(0, "d6fff8"), (0.05, "84f4ea"), (0.32, "2ed2dc"), (0.7, "1696cc"), (1, "0a5aa2")],
    3: [(0, "f4fdff"), (0.05, "bfeaf6"), (0.3, "62b2d6"), (0.68, "2a5e98"), (1, "0e2a5c")],
}
THEME_HAZE = {0: "1f78b8", 1: "3e8c7e", 2: "34b8d0", 3: "5a9cc8"}      # what distance fades toward
THEME_FOG_FAR = {0: ("1f95cf", "1a86c4", "1a6fb2", 150), 1: ("4fa088", "3a8a78", "2a6a62", 150),
                 2: ("2ed2dc", "28b8d4", "1e8ec4", 130), 3: ("62b2d6", "4a92c4", "2a5e98", 150)}
THEME_FOG_MID = {0: ("1f95cf", "1a86c4", "1a78b8", 90), 1: ("4fa088", "3a8a78", "2c6e64", 100),
                 2: ("2ed2dc", "28b8d4", "1a9ac8", 80), 3: ("62b2d6", "4a92c4", "305e96", 95)}
# light shafts: (top colour+alpha, middle colour+alpha)
THEME_SHAFT = {0: (("fffbe0", 110), ("e8fbff", 45)), 1: (("fff0a0", 125), ("f4f8b0", 50)),
               2: (("ffffff", 125), ("eafffc", 55)), 3: (("f4fcff", 120), ("d6f0ff", 50))}
FAR_R, MID_R = 330, 390   # how far right a far / mid layer ever shows (parallax 0.35 / 0.6 over the large tank)

R_KFAR = ramp("27675a", "317462", "3c816a", "4a8e72")
R_KFAR2 = ramp("1d5248", "245e52", "2c6a5a", "38785f")
R_GKELP = ramp("2a2408", "4c4410", "766818", "a48e22", "ccb43c", "ecdc7a")
R_GKELP2 = ramp("1e2a10", "324416", "4c6420", "6c862a", "94ac3e", "c4d470")   # greener stalks, further back
R_KROCK = ramp("1a2422", "28362f", "3a4a3c", "52644c", "72845c")
R_KFLOOR = ramp("2c2614", "4a4024", "6a5c34", "8e7c46", "b29e60", "d6c286")
R_CFAR = ramp("2584a8", "3196b8", "40a8c6", "56bad2")
R_CROCK = ramp("2e2650", "463c6c", "62588a", "8078a6", "a8a2c6")
R_YCORAL = ramp("5a3410", "9a5e14", "d4961e", "f4c842", "fff08a")
R_PCORAL = ramp("3a0e3a", "6e1c62", "a8348c", "da5cb2", "f89ad6")
R_SAND_W = ramp("7e7ea0", "a8b0c6", "d0d8e0", "eaeee8", "f8f8f0", "ffffff")
R_IFAR = ramp("5aa6cc", "74b8da", "94cce6", "bce2f2")
R_ICE = [hx("2a5a86", 235), hx("4a86b4", 225), hx("78b4d8", 220), hx("a8d8ee", 225), hx("d4f0fa", 235), hx("ffffff", 245)]
R_AROCK = ramp("161e30", "283450", "3e4c6c", "5c6c8a", "8696b0", "b2c0d2")
R_PEBBLE = ramp("2c3446", "465068", "66728a", "8c98ae", "b4bece", "e2e8f0")


def quantize(px, cap=255):
    """Keep a backdrop sprite to an indexed PNG: coarsen colour (then alpha) until it has <= cap colours."""
    for step, astep in ((1, 1), (2, 8), (4, 8), (4, 16), (6, 16), (8, 16), (8, 32), (12, 32), (16, 32), (16, 64)):
        q = lambda c: (min(255, round(c[0] / step) * step), min(255, round(c[1] / step) * step), min(255, round(c[2] / step) * step),
                       min(255, round(c[3] / astep) * astep))
        cols = {q(c) for c in px.d.values()}
        if len(cols) <= cap:
            out = Px()
            for k, c in px.d.items():
                qc = q(c)
                if qc[3] > 0:
                    out.d[k] = qc
            return out
    return px


def leaf(px, x0, y0, ang, L, wmax, rmp, droop=0.35, lit_up=True):
    """A kelp blade: a tapering leaf from (x0, y0) at angle `ang` (radians, 0 = right, -pi/2 = up), sagging
    as it goes. Lit along its upper edge, a darker underside and a faint midrib."""
    n = len(rmp)
    steps = max(2, int(L * 2.2))
    ca, sa = math.cos(ang), math.sin(ang)
    for i in range(steps + 1):
        u = i / steps
        cx = x0 + ca * L * u
        cy = y0 + sa * L * u + droop * L * u * u
        w = wmax * math.sin(math.pi * min(1.0, u * 1.15)) ** 0.7
        tx, ty = ca, sa + 2 * droop * u  # tangent
        tl = math.hypot(tx, ty) or 1
        nx_, ny_ = -ty / tl, tx / tl  # normal (one side)
        if ny_ > 0:
            nx_, ny_ = -nx_, -ny_  # point it up: the lit edge
        k = -w
        while k <= w + 1e-6:
            x, y = round(cx + nx_ * k), round(cy + ny_ * k)
            edge = abs(k) > w - 0.6
            if edge and k > 0:
                c = rmp[n - 2]  # the upper edge catches the light
            elif edge:
                c = rmp[1]
            elif abs(k) < 0.4 and u > 0.1:
                c = rmp[n - 4] if n >= 5 else rmp[1]
            else:
                c = rmp[n - 3] if k > 0 else rmp[max(1, n - 4)]
            px.put(x, y, c)
            k += 0.5


def giant_kelp(px, bx, base_y, top_y, rmp, seed, s=1.0, sway=0.0, canopy=1, blades=True):
    """Giant kelp (Macrocystis): a stipe climbing from its holdfast to the surface, a leaf-shaped blade with a
    gas bladder every few px, alternating sides; near the top it bends over and streams along the surface."""
    r2 = random.Random(seed)
    n = len(rmp)
    H = base_y - top_y
    bend = canopy * r2.choice((-1, 1))
    pts = []
    for i in range(H + 1):
        t = i / H
        x = bx + 3.2 * s * math.sin(t * 4.3 + seed) * t + sway * 11 * s * t ** 1.7
        pts.append((x, base_y - i))
    # the canopy: the last stretch lies over, streaming sideways along the surface
    if canopy:
        cx, cy = pts[-1]
        for k in range(1, int(26 * s)):
            pts.append((cx + bend * k, cy + 0.08 * k * k / s + 1.2 * math.sin(k * 0.5 + seed)))
    for i, (x, y) in enumerate(pts):
        X, Y = round(x), round(y)
        w = 2 if s >= 1 else 1
        for o in range(-1, w):
            c = rmp[n - 2] if o == -1 else rmp[n - 3] if o == 0 else rmp[2]
            px.put(X + o, Y, c)
        px.put(X + w, Y, rmp[0])
    if blades:
        every = max(4, round(6 * s))
        for i in range(every, len(pts) - 2, every):
            x, y = pts[i]
            side = 1 if (i // every) % 2 else -1
            if i > H:  # along the canopy: blades hang down from it
                ang = math.pi / 2 + side * 0.5
                L = r2.uniform(5, 9) * s
            else:
                ang = -math.pi / 2 + side * r2.uniform(0.75, 1.15)
                L = r2.uniform(6, 17) * s * (0.7 + 0.3 * min(1, i / (H * 0.3 + 1)))
                ang += r2.uniform(-0.3, 0.3)
            leaf(px, x + side * 1.5, y, ang, L, 1.9 * s + 0.5, rmp, droop=0.5)
            # the gas bladder at the blade's base
            bxx, byy = round(x + side * 2), round(y)
            px.put(bxx, byy, rmp[n - 2])
            px.put(bxx + (1 if side > 0 else 0), byy + 1, rmp[n - 4] if n > 4 else rmp[1])
            px.put(bxx - (1 if side > 0 else 0), byy - 1 if s >= 1 else byy, rmp[n - 1])
    # the holdfast: a tangle of roots on the rock
    for k in range(-3, 4):
        px.put(round(bx) + k, base_y + (1 if abs(k) > 1 else 0), rmp[1] if k % 2 else rmp[2])


def cobble(px, cx, cy, rx, ry, rmp, seed):
    blob(px, cx, cy, rx, ry, rmp, rough=1, seed=seed)


# ---- far layers

def far_kelp():
    px = Px()
    for (cx, cy, rx, ry) in [(30, 330, 40, 26), (110, 336, 44, 18), (190, 328, 36, 28), (262, 334, 40, 22), (318, 330, 30, 26)]:
        for y in range(int(cy - ry), WATER_BOT + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if GLASS_L <= x <= FAR_R and ((x + 0.5 - cx) / rx) ** 2 + (min(0, y + 0.5 - cy) / ry) ** 2 <= 1:
                    px.put(x, y, R_KFAR2[1] if (x + y) % 5 else R_KFAR2[2])
    r2 = random.Random(5)
    x = 10
    while x < FAR_R + 6:  # the far row: thin, hazy, reaching the surface
        giant_kelp(px, x, WATER_BOT - r2.randint(0, 12), WATER_TOP + r2.randint(1, 5), R_KFAR, r2.randint(0, 99), s=0.75,
                   canopy=1, blades=True)
        x += r2.randint(26, 40)
    near = Px()
    for x in (52, 128, 236, 304):  # a nearer row, darker
        giant_kelp(near, x + r2.randint(-4, 4), WATER_BOT - r2.randint(4, 14), WATER_TOP + r2.randint(1, 4), R_KFAR2, r2.randint(0, 99),
                   s=0.9, canopy=1)
    for k, c in near.d.items():
        px.put(*k, c)
    return quantize(soften(px, hx(THEME_HAZE[1]), 1.0))


def far_coral():
    px = Px()
    r2 = random.Random(6)
    c0, c1, c2, c3 = R_CFAR
    # bommies: rounded heads of coral rock along the floor, flat-topped table corals on stalks between them
    for cx, h, rx in [(20, 84, 40), (96, 60, 44), (164, 104, 38), (226, 56, 36), (282, 92, 42), (334, 70, 30)]:
        cy, ry = WATER_BOT + 4, h
        for y in range(int(cy - ry), WATER_BOT + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                bump = 0.12 * math.sin(x * 0.7 + cy) + 0.08 * math.sin(x * 1.9)
                if GLASS_L <= x <= FAR_R and dx * dx + dy * dy ** 2 * 0 + dy * dy <= 1 + bump:
                    top = not (dx * dx + ((y - 2 + 0.5 - cy) / ry) ** 2 <= 1 + bump)
                    px.put(x, y, c2 if top or (dx < -0.4 and (x + y) % 3 == 0) else c1 if dx < 0.2 else c0)
        for _ in range(3):  # branching coral silhouettes on top
            bx = cx + r2.randint(-rx // 2, rx // 2)
            by = round(cy - ry * math.sqrt(max(0.0, 1 - ((bx - cx) / rx) ** 2))) + 2
            branch_coral(px, bx, by, -1.6 + r2.uniform(-0.4, 0.4), r2.randint(5, 9), 1.4, 2, [c0, c1, c1, c2, c2, c3], r2)
    for tx, ty, w in [(58, 236, 12), (124, 226, 14), (236, 246, 10), (306, 222, 12)]:  # table corals
        for t in range(WATER_BOT - ty):
            px.put(tx, ty + t, c1)
        for x in range(tx - w, tx + w + 1):
            px.put(x, ty - 1, c3 if x < tx else c2)
            px.put(x, ty, c1)
    for fx, fy, w, h in [(196, 300, 20, 40), (58, 282, 14, 30), (318, 290, 16, 34)]:  # far sea fans
        for y in range(fy - h, fy):
            for x in range(fx - w, fx + w):
                d = ((x + 0.5 - fx) / w) ** 2 + ((y + 0.5 - fy) / h) ** 2
                if d <= 1 and ((x * 3 + y) % 4 == 0 or (x - y * 2) % 5 == 0):
                    px.put(x, y, c1)
    return quantize(soften(px, hx(THEME_HAZE[2]), 0.8))


def ice_ceiling(x, depth=1.0, seed=0):
    """Underside of the ice shelf at column x: a ragged ceiling with keels hanging deeper."""
    base = WATER_TOP + 8 + 4 * math.sin(x * 0.07 + seed) + 2 * math.sin(x * 0.31 + seed * 2)
    keel = 0
    for kx, kd, kw in ((40, 46, 30), (128, 30, 22), (205, 58, 34), (290, 38, 26), (360, 50, 30)):
        u = (x - kx - seed * 7) / kw
        if abs(u) < 1:
            keel = max(keel, kd * (1 - abs(u)) ** 1.4 * (1 + 0.15 * math.sin(x * 0.9)))
    return round(base + keel * depth)


def far_arctic():
    px = Px()
    c0, c1, c2, c3 = R_IFAR
    for x in range(GLASS_L, FAR_R + 1):  # the far ice shelf: sunlit through from above, its underside glowing
        bot = ice_ceiling(x, 1.25, 3) + 10
        for y in range(WATER_TOP, bot + 1):
            d = bot - y
            u = (y - WATER_TOP) / max(1, bot - WATER_TOP)
            c = hx("f4fcff") if d <= 1 else c3 if d <= 3 else mix(hx("e8f8ff"), c2, min(1, u * 1.4 + bay(x, y) * 0.3))
            px.put(x, y, c)
    for cx, cy, rx, ry in [(40, 326, 44, 26), (140, 334, 50, 18), (236, 322, 40, 30), (316, 330, 34, 22)]:  # far seabed
        for y in range(int(cy - ry), WATER_BOT + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if GLASS_L <= x <= FAR_R and ((x + 0.5 - cx) / rx) ** 2 + (min(0, y + 0.5 - cy) / ry) ** 2 <= 1 + 0.06 * math.sin(x * 0.5):
                    px.put(x, y, mix(c0, hx("3a6a98"), 0.5))
    return quantize(soften(px, hx(THEME_HAZE[3]), 1.0))


# ---- mid layers (static parts; the kelp clumps sway in frames)

def mid_kelp_rocks():
    px = Px()
    for cx, cy, rx, ry, seed in [(12, 326, 22, 30, 1), (64, 336, 18, 14, 2), (150, 334, 24, 18, 3), (232, 322, 28, 36, 4),
                                 (300, 334, 20, 16, 5), (362, 326, 26, 28, 6)]:
        blob(px, cx, cy, rx, ry, R_KROCK, flat=WATER_BOT, rough=1, seed=seed, outline=False)
    r2 = random.Random(31)
    for (x, y) in sorted(px.d):  # turf: short red and olive algae on the rock tops
        if not px.has(x, y - 1) and r2.random() < 0.45:
            for k in range(r2.randint(1, 3)):
                px.put(x, y - 1 - k, r2.choice([hx("7a3a2a"), hx("9a4a30"), R_GKELP[3], R_GKELP[2]]))
    return quantize(soften(px, hx(THEME_HAZE[1]), 0.45))


KELP_MID = [(24, 330, 0.0, 41), (108, 338, 0.5, 42), (196, 334, -0.4, 43), (270, 340, 0.3, 44), (352, 332, -0.2, 45)]


def mid_kelp_clump(i, lean):
    bx, by, ph, seed = KELP_MID[i]
    px = Px()
    rmp = R_GKELP if i % 2 == 0 else R_GKELP2
    giant_kelp(px, bx + 9, by - 2, WATER_TOP + 3, R_GKELP2 if i % 2 == 0 else R_GKELP, seed + 50, s=0.95, sway=lean * 0.6 + ph * 0.2, canopy=1)
    giant_kelp(px, bx, by, WATER_TOP + 1, rmp, seed, s=1.15, sway=lean * 0.7 + ph * 0.2, canopy=1)
    return quantize(soften(px, hx(THEME_HAZE[1]), 0.35))


def sea_fan(px, cx, by, w, h, rmp, seed):
    """A gorgonian: a flat lattice fanning up from a short trunk, lit from the upper left."""
    r2 = random.Random(seed)
    n = len(rmp)
    for t in range(4):
        px.put(cx, by - t, rmp[1])
        px.put(cx + 1, by - t, rmp[0])
    top = by - 3
    for k in range(9):  # ribs
        a = -math.pi / 2 + (k - 4) / 4 * 1.15
        L = h * (0.75 + 0.25 * math.cos((k - 4) / 4 * 1.2))
        for st in range(int(L * 1.6)):
            u = st / (L * 1.6)
            x = cx + math.cos(a) * L * u * (w / h)
            y = top + math.sin(a) * L * u
            px.put(round(x), round(y), rmp[n - 2] if k < 4 else rmp[n - 3])
    for y in range(int(top - h), top):  # the mesh between the ribs
        for x in range(cx - w, cx + w + 1):
            d = ((x + 0.5 - cx) / w) ** 2 + ((y + 0.5 - top) / h) ** 2
            if d <= 1 and not px.has(x, y) and (x + y) % 2 == 0 and r2.random() < 0.75:
                px.put(x, y, rmp[n - 3] if x < cx else rmp[2])
    for x, y in list(px.d):  # the rim of the fan catches the light
        if y < top - 2 and not px.has(x, y - 1) and x < cx:
            px.put(x, y, rmp[n - 1])


def mid_coral():
    px = Px()
    r2 = random.Random(61)
    rocks = [(12, 312, 26, 46, 1), (84, 326, 24, 30, 2), (158, 306, 28, 50, 3), (240, 300, 28, 58, 4), (314, 320, 24, 36, 5), (376, 306, 24, 50, 6)]
    for cx, cy, rx, ry, seed in rocks:
        blob(px, cx, cy, rx, ry, R_CROCK, flat=WATER_BOT, rough=1, seed=seed, outline=False)
    tops = {}
    for (x, y) in px.d:
        if x not in tops or y < tops[x]:
            tops[x] = y
    # on the bommies: staghorn in pink and gold, purple fans, brain and table corals, tube sponges
    for bx, rmp, ang in [(8, R_CORAL, -1.8), (24, R_YCORAL, -1.4), (150, R_PCORAL, -1.7), (172, R_CORAL, -1.3), (232, R_YCORAL, -1.9),
                         (252, R_CORAL, -1.5), (318, R_PCORAL, -1.6), (370, R_YCORAL, -1.5), (384, R_CORAL, -1.8)]:
        if bx in tops:
            branch_coral(px, bx, tops[bx] + 1, ang, r2.randint(12, 16), 2.8, 3, rmp, r2)
    for fx, w, h, rmp in [(46, 15, 34, R_FAN), (200, 17, 42, R_PCORAL), (284, 13, 30, R_FAN), (346, 15, 36, R_PCORAL), (120, 11, 26, R_FAN)]:
        sea_fan(px, fx, tops.get(fx, 330) + 1, w, h, rmp, fx)
    for x, w in [(92, 7), (262, 6)]:
        table_coral(px, x, tops.get(x, 330) - 7, w)
    brain_coral(px, 130, tops.get(130, 330) + 4, 10, 7)
    brain_coral(px, 338, tops.get(338, 330) + 4, 9, 7)
    tube_sponge(px, 66, tops.get(66, 330) + 1, [7, 10, 6], R_SPONGE)
    tube_sponge(px, 222, tops.get(222, 330) + 1, [8, 5], R_SPONGE)
    return quantize(soften(px, hx(THEME_HAZE[2]), 0.42))


def mid_arctic():
    px = Px()
    # ice keels hanging from the shelf, nearer: faceted, lit from above, glowing at the edges
    keels = [(36, 30, 64), (150, 22, 44), (232, 34, 82), (338, 26, 58)]
    for kx, kw, kd in keels:
        for x in range(kx - kw, kx + kw + 1):
            u = (x - kx) / kw
            rag = (fbm(x * 0.18, kx * 0.1, 13, 2) - 0.5) * 16 * (1 - abs(u)) + (5 if _hash2(x, kx, 3) > 0.82 else 0)
            bot = WATER_TOP + max(2, round(kd * (1 - abs(u)) ** 1.25 + rag))
            for y in range(WATER_TOP, bot + 1):
                facet = math.sin(x * 0.45 + y * 0.12 + kx) > 0.3
                d = bot - y
                if d == 0:
                    c = R_ICE[5]
                elif d <= 2:
                    c = R_ICE[4]
                else:
                    t = 0.55 + (0.2 if facet else -0.05) - 0.25 * u - 0.15 * (y - WATER_TOP) / max(1, kd)
                    c = R_ICE[1 + shade_index(t, 4, x, y, 0.7)]
                px.put(x, y, c)
        r2 = random.Random(kx)
        for _ in range(3):  # cracks
            x, y = kx + r2.randint(-kw // 2, kw // 2), WATER_TOP + r2.randint(2, 10)
            for _ in range(r2.randint(6, 14)):
                if not px.has(x, y + 1):
                    break
                px.put(x, y, R_ICE[1])
                px.put(x - 1, y, R_ICE[4])
                x += r2.choice([-1, 0, 1])
                y += 1
    for cx, cy, rx, ry, seed in [(10, 330, 20, 22, 1), (96, 338, 18, 12, 2), (176, 332, 22, 18, 3), (258, 328, 24, 26, 4), (340, 334, 22, 18, 5)]:
        blob(px, cx, cy, rx, ry, R_AROCK, flat=WATER_BOT, rough=1, seed=seed, outline=False)
    for (x, y) in list(px.d):  # snow settled on the boulders' tops
        if y > 250 and not px.has(x, y - 1):
            px.put(x, y, hx("eef6fc"))
            if (x * 7) % 3 == 0:
                px.put(x, y - 1, hx("ffffff"))
    return quantize(soften(px, hx(THEME_HAZE[3]), 0.42))


# ---- floors

def theme_sand(t):
    """The floor for theme t (1 rocky kelp floor, 2 white coral sand, 3 grey pebbles): the same shape as the reef's
    sand (the walkers and decor stand on sand_top), its own colour and texture, and the cave mouth's shadow."""
    px = Px()
    base = {1: R_KFLOOR, 2: R_SAND_W, 3: R_PEBBLE}[t]
    r2 = random.Random(100 + t)
    for x in range(GLASS_L, WLW):
        top = sand_top(x)
        for y in range(top, WATER_BOT + 1):
            depth_ = (y - top) / max(1, WATER_BOT - top)
            if y == top:
                c = base[5] if t != 1 else base[4]
            elif y == top + 1:
                c = base[4] if t != 1 else base[3]
            else:
                tt = 0.92 - depth_ * 0.42 + 0.05 * math.sin(x * 0.4 + y * 0.9)
                if t == 2:  # ripple marks in the white sand
                    tt += 0.08 * math.sin(x * 0.55 + 1.5 * math.sin(y * 0.3))
                c = base[shade_index(tt, 5, x, y, 0.5)]
            px.put(x, y, c)
    if t == 1:  # the kelp forest floor: cobbles and boulders, gravel between
        for _ in range(150):
            x = r2.randint(GLASS_L, WORLD_R)
            y = r2.randint(sand_top(x) + 1, WATER_BOT - 1)
            px.put(x, y, r2.choice([base[1], base[2], R_KROCK[3]]))
        for _ in range(70):
            x = r2.randint(GLASS_L + 3, WORLD_R - 3)
            y = r2.randint(sand_top(x) + 2, WATER_BOT - 2)
            cobble(px, x, y, r2.choice([2, 3, 3, 4, 5]), r2.choice([2, 2, 3]), R_KROCK, r2.random() * 9)
        for _ in range(26):  # a few red algae tufts
            x = r2.randint(GLASS_L + 2, WORLD_R - 2)
            y = sand_top(x)
            for k in range(r2.randint(1, 3)):
                px.put(x, y - 1 - k, r2.choice([hx("8a3a2c"), hx("b04c36")]))
    elif t == 2:  # coral rubble, shell bits and a few dark grains in the white sand
        for _ in range(110):
            x = r2.randint(GLASS_L, WORLD_R)
            y = r2.randint(sand_top(x) + 2, WATER_BOT - 1)
            px.put(x, y, r2.choice([base[1], base[2], hx("f2b8b0"), hx("f6d2a0")]))
        for _ in range(16):
            x = r2.randint(GLASS_L + 4, WORLD_R - 4)
            y = r2.randint(sand_top(x) + 3, WATER_BOT - 3)
            blob(px, x, y, r2.choice([1.5, 2]), 1.2, ramp("8a6a70", "c4a0a0", "f0d0c8", "fff0ea"), seed=r2.random() * 9)
    else:  # grey pebbles: lots of little stones, lit on top, a dusting of snow
        for _ in range(240):
            x = r2.randint(GLASS_L + 1, WORLD_R - 1)
            y = r2.randint(sand_top(x) + 1, WATER_BOT - 1)
            rr = r2.choice([1.2, 1.5, 2, 2, 2.5])
            blob(px, x, y, rr + 0.4, rr, R_AROCK[1:] if r2.random() < 0.5 else R_PEBBLE[:5], seed=r2.random() * 9)
        for x in range(GLASS_L, WLW):  # snow on the top
            if r2.random() < 0.6:
                px.put(x, sand_top(x), hx("f6fbff"))
    # the cave mouth: the floor falls into shadow toward the back of the arch
    for (x, y), c in list(px.d.items()):
        u = abs(x + 0.5 - CAVE_C) / (CAVE_A + 4)
        k = 0.86 * (1 - smoothstep((u - 0.78) / 0.42)) + 0.3 * smoothstep((x - CAVE_C - CAVE_A + 6) / 14)
        k *= 1 - 0.3 * (y - sand_top(x)) / max(1, WATER_BOT - sand_top(x))
        if k > 0.02:
            px.put(x, y, mix(c, hx("0b0e28"), min(0.86, k)))
    return quantize(px)


# ---- the kelp forest's dappled light: soft patches of sun drifting through the canopy (screen, bilinear)

DAPPLE_W, DAPPLE_H, DAPPLE_PERIOD = 160, 120, 80


def dapple_art():
    px = Px()
    for y in range(DAPPLE_H):
        for x in range(DAPPLE_W):
            v = fbm(x / 13.0, y / 11.0, 7, 3) * (0.55 + 0.45 * math.sin(x * 2 * math.pi / DAPPLE_PERIOD + y * 0.05))
            fade = smoothstep(min(1, y / 18)) * (1 - smoothstep((y - DAPPLE_H + 40) / 40))
            a = max(0.0, (v - 0.48) * 3.0) * fade
            if a > 0.04:
                px.put(x, y, hx("fff6b8", min(255, round(150 * a))))
    return px


def theme_icon(t):
    """Shop icon for theme t: a little aquarium on a stand, its water, floor and one signature thing."""
    px = Px()
    w, h = 36, 26
    x0 = -w // 2
    stand_top = -5
    y0 = stand_top - h
    for x in range(x0 + 1, x0 + w - 1):  # stand
        for y in range(stand_top, 0):
            px.put(x, y, R_WOOD[0] if y == -1 or x in (x0 + 1, x0 + w - 2) else R_WOOD[4] if y == stand_top else R_WOOD[2 if (x + y) % 4 else 3])
    stops = THEME_WATER[t]
    floor = {0: R_SAND, 1: R_KFLOOR, 2: R_SAND_W, 3: R_PEBBLE}[t]

    def water(u):
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= u <= p1:
                return mix(hx(c0), hx(c1), (u - p0) / max(1e-6, p1 - p0))
        return hx(stops[-1][1])
    for y in range(y0, stand_top):
        for x in range(x0, x0 + w):
            edge = x in (x0, x0 + w - 1) or y in (y0, y0 + 1, stand_top - 1)
            if edge:
                c = METAL[4] if y == y0 else METAL[3] if y == y0 + 1 else METAL[2] if x == x0 else METAL[1]
            else:
                u = (y - y0 - 2) / (h - 3)
                c = water(u * 0.85)
                if y >= stand_top - 4:
                    c = floor[5] if y == stand_top - 4 else floor[3] if (x + y) % 3 else floor[2]
            px.put(x, y, c)
    sb = stand_top - 4
    ins = lambda x, y: x0 < x < x0 + w - 1 and y0 + 1 < y < stand_top - 1
    put = lambda x, y, c: ins(x, y) and px.put(x, y, c)
    if t == 0:  # coral and a rock
        for x in range(x0 + 3, x0 + 12):
            for yy in range(3 - abs(x - (x0 + 7)) // 2):
                put(x, sb - 1 - yy, R_ROCK[3] if x < x0 + 7 else R_ROCK[2])
        for k, (dx, ln) in enumerate(((x0 + 6, 6), (x0 + 9, 5))):
            for t_ in range(ln):
                put(dx + (t_ > 2) * (1 if k else -1), sb - 3 - t_, R_CORAL[3 + (t_ == ln - 1)])
        for x in range(x0 + w - 10, x0 + w - 4):
            put(x, sb - 1, R_FAN[2])
            put(x - 1, sb - 2 - (x % 3), R_FAN[3])
    elif t == 1:  # golden kelp to the surface
        for k, kx in enumerate((x0 + 6, x0 + 15, x0 + 26)):
            for t_ in range(sb - (y0 + 3)):
                x = kx + round(1.2 * math.sin(t_ * 0.35 + k))
                put(x, sb - 1 - t_, R_GKELP[4 if k % 2 == 0 else 3])
                if t_ % 4 == 2:
                    put(x + (1 if t_ % 8 == 2 else -1), sb - 1 - t_, R_GKELP[5])
                    put(x + (2 if t_ % 8 == 2 else -2), sb - t_, R_GKELP[3])
        for x in range(x0 + 2, x0 + w - 2):
            if x % 5 < 3:
                put(x, y0 + 2, R_GKELP[3])
    elif t == 2:  # bright corals on white sand
        for k, (cx, rmp) in enumerate(((x0 + 7, R_CORAL), (x0 + 16, R_YCORAL), (x0 + 26, R_PCORAL))):
            for t_ in range(5 + k % 2 * 2):
                put(cx + (t_ > 2) * (1 if k % 2 else -1), sb - 1 - t_, rmp[3 + (t_ >= 4)])
                if t_ in (3, 5):
                    put(cx + 2, sb - t_, rmp[3])
        for y in range(sb - 9, sb - 1):
            for x in range(x0 + w - 8, x0 + w - 3):
                if (x + y) % 2 == 0 and ((x - (x0 + w - 5.5)) / 3) ** 2 + ((y - (sb - 5)) / 4.5) ** 2 <= 1:
                    put(x, y, R_FAN[3])
    else:  # the ice shelf above, snow falling, grey stones
        for x in range(x0 + 1, x0 + w - 1):
            bot = y0 + 4 + round(2 * math.sin(x * 0.7)) + (4 if abs(x - (x0 + 12)) < 4 else 0) + (3 if abs(x - (x0 + 26)) < 3 else 0)
            for y in range(y0 + 2, bot + 1):
                put(x, y, R_ICE[5] if y == bot else R_ICE[4] if y >= bot - 1 else R_ICE[3])
        for fx, fy in ((x0 + 5, y0 + 14), (x0 + 13, y0 + 18), (x0 + 20, y0 + 11), (x0 + 29, y0 + 16), (x0 + 24, y0 + 21), (x0 + 9, y0 + 9)):
            put(fx, fy, hx("ffffff"))
        for cx in (x0 + 8, x0 + 20, x0 + 28):
            put(cx, sb - 1, R_AROCK[3])
            put(cx + 1, sb - 1, R_AROCK[2])
            put(cx, sb - 2, R_AROCK[4])
    return px


# ---------------------------------------------------------------- build the scene (back to front)

btf = []    # screen space, back to front
world = []  # world space (x from 0 to 1440), back to front: becomes the World node, x bound to camX
water_y, water_h = WATER_TOP * P, (WATER_BOT - WATER_TOP + 1) * P
water_x, water_w = 0, W            # screen-fixed overlays cover the whole viewport's water
wwater_x, wwater_w = 0, WLW * P    # world layers run the full width of the large tank


def cam_bind():
    # pan (camX) plus the jelly-card close-up: y offset and a uniform scale of 4/3 at most
    return [bind(prop("camX"), 13), bind(prop("camY"), 14), bind(prop("camZ", default=1), 16), bind(prop("camZ", default=1), 17)]


# parallax: a depth group inside World gets x = camX * (f - 1) through a range mapper, so it moves at f times
# the camera. f = 1 is everything interactive (sand, reef, decor, jellies, walls). Converters are appended at
# the tail of the file's converter list, in this order (the list is positional).
CAM_MIN = -(WLW - LW) * P  # -720: the camera's furthest pan (large tank)
PARALLAX = {"Far": 0.35, "Mid": 0.6, "Shafts": 0.8, "Fore": 1.15}
parallax_conv = {k: nid() for k in PARALLAX}


def depth(name, kids):
    return node(f"{name}Depth", list(reversed(kids)), binds=[bind(prop("camX"), 13, parallax_conv[name])])


def themed(t):
    """v11: show only while theme t is in use (theme{t}, one-hot; the Reef by default)."""
    return dict(opacity=1 if t == 0 else 0, binds=[bind(prop(f"theme{t}", default=1 if t == 0 else 0), 18)])


def theme_rects(name, stops_of):
    return node(name, list(reversed([rect_shape(f"{name}{THEMES[t]}", wwater_x, water_y, wwater_w, water_h,
                                                lin_grad(0, 0, 0, water_h, stops_of(t)), **themed(t)) for t in range(len(THEMES))])))


world.append(theme_rects("Water", lambda t: [(p_, hx(c)) for p_, c in THEME_WATER[t]]))

far_kids = [node("FarThemes", list(reversed([image("Far", far_layer(), **themed(0)), image("FarKelp", far_kelp(), **themed(1)),
                                             image("FarCoral", far_coral(), **themed(2)), image("FarArctic", far_arctic(), **themed(3))])))]
# fish schools swim the far depth (its visible span is 0..324 at f = 0.35); `phase` starts each one part-way
for school, (y0, flip, dur, n, x_from, x_to, phase) in enumerate([(160, False, 3100, 6, -40, 360, 0.0), (225, True, 2700, 4, 360, -40, 0.4),
                                                                   (96, True, 3700, 5, 360, -40, 0.75), (272, False, 2400, 3, -40, 360, 0.55)]):
    sid = nid()
    f_ids = [nid(), nid()]
    fish_frames = []
    for f in (0, 1):
        sp = Px()
        for k in range(n):
            ox, oy = (k % 3) * 13 - k // 3 * 6, (k // 3) * 8 + (k % 2) * 3
            for (x, y), c in fish_art(f, flip, hx("2a76b0")).d.items():
                sp.put(x + (-ox if flip else ox), y + oy, c)
        fish_frames.append(image(f"School{school}F{f}", soften(sp, hx("1f78b8"), 0.8), opacity=1 - f, node_id=f_ids[f]))
    x_mid = round(x_from + (x_to - x_from) * phase)
    far_kids.append(node(f"School{school}", fish_frames, x=x_mid * P, y=y0 * P, node_id=sid))
    if phase:
        f_wrap = round(dur * (1 - phase))
        xk = [(0, x_mid * P), (f_wrap, x_to * P), (f_wrap + 1, x_from * P), (dur, x_mid * P)]
    else:
        xk = [(0, x_from * P), (dur, x_to * P)]
    add_anim(f"School{school}", dur, [
        keys(sid, 13, xk, "linear"),
        keys(sid, 14, [(0, y0 * P), (dur // 4, (y0 - 8) * P), (dur // 2, (y0 + 4) * P), (3 * dur // 4, (y0 - 5) * P), (dur, y0 * P)], "cubic"),
    ])
    frame_cycle(f"School{school}Tail", f_ids, [0, 1], 14 + school * 3)

world.append(depth("Far", far_kids))

world.append(theme_rects("FogFar", lambda t: [(0, hx(THEME_FOG_FAR[t][0], 0)), (0.55, hx(THEME_FOG_FAR[t][1], 0)),
                                              (1, hx(THEME_FOG_FAR[t][2], THEME_FOG_FAR[t][3]))]))
mid_kids = [image("Mid", mid_layer())]


def kelp_clump(name, base_x, base_y, heights, rmp, seed, step):
    ids = [nid() for _ in range(5)]
    frames = []
    for i, lean in enumerate((-1, -0.5, 0, 0.5, 1)):
        px = Px()
        kelp(px, base_x, base_y, heights, lean, rmp, seed)
        frames.append(image(f"{name}F{i}", px, opacity=1 if i == 2 else 0, node_id=ids[i]))
    frame_cycle(name, ids, [0, 1, 2, 3, 4, 3, 2, 1], step)
    return node(name, frames)


mid_kids.append(kelp_clump("KelpMid", 196, 330, [110, 140, 90], R_KELP_MID + R_KELP_MID[-1:], 0.4, 16))
mid_kids.append(kelp_clump("KelpMid2", 316, 332, [124, 92], R_KELP_MID + R_KELP_MID[-1:], 1.3, 17))
# v11: the other themes' mid layers. Kelp Forest: rocks, and giant kelp in clumps that sway (3 lean frames each)
kelp_mid = [image("MidKelpRocks", mid_kelp_rocks())]
for i in range(len(KELP_MID)):
    ids = [nid() for _ in range(3)]
    kelp_mid.append(node(f"KelpTall{i}", list(reversed([image(f"KelpTall{i}F{f}", lambda i=i, f=f: mid_kelp_clump(i, (-1, 0, 1)[f]),
                                                              opacity=1 if f == 1 else 0, node_id=ids[f]) for f in range(3)]))))
    frame_cycle(f"KelpTall{i}", ids, [0, 1, 2, 1] if i % 2 else [2, 1, 0, 1], 44 + i * 5)
world.append(depth("Mid", [node("MidThemes", list(reversed([
    node("MidReef", list(reversed(mid_kids)), **themed(0)),
    node("MidKelp", list(reversed(kelp_mid)), **themed(1)),
    image("MidCoral", mid_coral(), **themed(2)),
    image("MidArctic", mid_arctic(), **themed(3)),
])))]))
world.append(theme_rects("FogMid", lambda t: [(0, hx(THEME_FOG_MID[t][0], 0)), (0.6, hx(THEME_FOG_MID[t][1], 0)),
                                              (1, hx(THEME_FOG_MID[t][2], THEME_FOG_MID[t][3]))]))

# light shafts: smooth, screen-blended; the parent fades out at night. v11: tinted per theme; the kelp forest's
# come through gaps in the canopy (more of them, narrower), with dappled light drifting under it.
SHAFT_SETS = {
    0: [(40, 16, 70, 260), (95, 26, 85, 300), (150, 12, 60, 220), (190, 22, 80, 280), (225, 10, 55, 200),
        (262, 18, 70, 280), (306, 24, 82, 300), (352, 12, 62, 220), (408, 16, 50, 120)],
    1: [(22, 8, 40, 240), (58, 14, 52, 300), (92, 6, 36, 200), (126, 12, 48, 280), (160, 7, 40, 230), (196, 14, 50, 300),
        (232, 6, 34, 200), (266, 12, 46, 270), (300, 8, 40, 240), (336, 14, 50, 290), (374, 7, 36, 220), (412, 10, 44, 150)],
    2: [(36, 20, 66, 300), (92, 30, 84, 320), (150, 14, 58, 240), (196, 26, 80, 300), (250, 18, 70, 280), (306, 28, 84, 320),
        (360, 14, 60, 240), (408, 18, 50, 140)],
    3: [(30, 12, 40, 220), (88, 20, 52, 260), (150, 10, 36, 200), (206, 18, 50, 250), (262, 12, 40, 230), (318, 20, 52, 260),
        (372, 10, 34, 200), (412, 14, 40, 130)],
}
shaft_groups = []
for t, specs in SHAFT_SETS.items():
    shaft_ids, shafts = [], []
    top_c, mid_c = THEME_SHAFT[t]
    for i, (tx, tw, lean, ln) in enumerate(specs):
        sid = nid()
        shaft_ids.append(sid)
        x0, y0 = tx * P, WATER_TOP * P
        pts = [(x0, y0), (x0 + tw * P, y0), (x0 + (tw + 20 - lean) * P, y0 + ln * P), (x0 - lean * P, y0 + ln * P)]
        shafts.append(poly_shape(f"Shaft{i}", pts, lin_grad(0, y0, 0, y0 + ln * P, [
            (0, hx(*top_c)), (0.45, hx(*mid_c)), (1, hx(mid_c[0], 0))]), blend="screen", sid=sid))
    if t == 1:
        dap = []
        for k, (dx, dy, dur, sgn) in enumerate(((0, 60, 1500, 1), (210, 150, 1900, -1), (120, 230, 1700, 1))):
            did = nid()
            aid, ax0, ay0, _, _ = sprite("Dapple", dapple_art)
            dap.append(f'<Image x="{dx * P}" y="{dy * P}" scaleX="{P}" scaleY="{P}" originX="0" originY="0" samplerFilter="bilinear"'
                       f' assetId="{aid}" blendModeValue="screen" opacity="0.8" name="Dapple{k}" id="{did}"/>')
            add_anim(f"Dapple{k}", dur, [keys(did, 13, [(0, dx * P), (dur, (dx + sgn * DAPPLE_PERIOD) * P)], "linear"),
                                         keys(did, 18, [(0, 0.55), (dur // 2, 0.95), (dur, 0.55)], "cubic")])
        shafts += dap
    shaft_groups.append(node(f"Shafts{THEMES[t]}", list(reversed(shafts)), **themed(t)))
    tracks = []
    for i, sid in enumerate(shaft_ids):
        tracks.append(keys(sid, 18, [(0, 0.55), (150 + i * 40 % 300, 1), (300 + i * 30 % 200, 0.35), (600, 0.55)], "cubic"))
        tracks.append(keys(sid, 13, [(0, 0), (300, (6 if i % 2 else -6) * P), (600, 0)], "cubic"))
    add_anim("Shafts" if t == 0 else f"Shafts{THEMES[t]}", 600, tracks)
world.append(depth("Shafts", [node("Shafts", list(reversed(shaft_groups)), binds=[bind(prop("daylight", default=1), 18)])]))

world.append(image("CaveBack", cave_back_art()))
world.append(node("Floor", list(reversed([image("Sand", sand(), **themed(0))]
                                          + [image(f"Sand{THEMES[t]}", theme_sand(t), **themed(t)) for t in (1, 2, 3)]))))
c_ids = [nid() for _ in range(4)]
world.append(node("Caustics", [image(f"Caustic{f}", caustics(f), opacity=1 if f == 0 else 0, node_id=c_ids[f], blend="screen") for f in range(4)],
                  binds=[bind(prop("daylight", default=1), 18)]))
frame_cycle("Caustics", c_ids, [0, 1, 2, 3], 9)


def seagrass_clump(name, x0, x1, seed, step):
    ids = [nid() for _ in range(5)]
    frames = [image(f"{name}F{i}", seagrass(lean, x0, x1, seed), opacity=1 if i == 2 else 0, node_id=ids[i])
              for i, lean in enumerate((-1, -0.5, 0, 0.5, 1))]
    frame_cycle(name, ids, [0, 1, 2, 3, 4, 3, 2, 1], step)
    return node(name, frames)


world.append(seagrass_clump("Seagrass", 238, 318, 7, 14))
ARCH_PX, CAVE_DOTS, CAVE_BEADS = arch_art()
ANEM_BACK = len(world)  # the back anemones go here once drawn (after the walkers' sand, before decor and helpers)

# decorations: fixed spots (logical, base centre on the sand). dec{n} = owned (0/1)
DECOR = [  # name, x, base y, art
    ("Castle", 113, 321, castle_art),
    ("Anchor", 17, 349, anchor_art),
    ("Helmet", 197, 349, helmet_art),
    ("Clam", 116, 349, None),
    ("GlowCoral", 70, 349, mushroom_art),
    ("Bubbler", 140, BUB_BASE, bubbler_art),  # ---- bubbler ---- (v13)
]


LIFT = 6  # logical px a picked-up decoration rises (18 artboard units)
LIFT_CONV = nid()  # DataConverterRangeMapper: dec{n}lift 0..1 -> y 0..-LIFT*P
PEARL_DY, PEARL_R = -10, 9  # pearl centre above the clam's base point; tap radius (logical)
decor_box = {}  # n -> (w, h) logical, symmetric about the base point


def pearl_art():
    px = Px()
    disc(px, 0, 0, 3.1, (hx("6a5a8e"), hx("d4c8ea"), hx("f6f0ff"), hx("ffffff")))
    px.put(1, 1, hx("f6c0e0"))
    px.put(-2, 1, hx("bcd8f4"))
    return px


def decor_node(n):
    """Dec{n}: x/y bound to dec{n}x / dec{n}y (base point), opacity to dec{n} (owned).
    Inside: a soft shadow (dec{n}lift) and the art, raised by LIFT when dec{n}lift = 1."""
    name, x, y, art = DECOR[n]
    if name == "Clam":
        ids = [nid() for _ in range(4)]
        frames = [image(f"Clam{f}", lambda f=f: clam_art(f), opacity=1 if f == 0 else 0, node_id=ids[f]) for f in range(4)]
        frame_cycle("Clam", ids, [0] * 8 + [1, 2] + [3] * 14 + [2, 1], 20)
        pg = nid()
        pearl = node("Pearl", [image("Pearl", pearl_art()),
                               node("PearlGlow", [ellipse_shape("PearlHalo", 0, 0, 22 * P, 18 * P,
                                                                rad_grad(0, 0, 11 * P, [(0, hx("fff6ff", 120)), (0.25, hx("fff0ff", 110)), (0.6, hx("f0d8ff", 50)), (1, hx("e0c8ff", 0))]),
                                                                blend="screen")], node_id=pg)],
                     y=PEARL_DY * P, opacity=0, binds=[bind(prop("pearl"), 18)])
        add_anim("PearlGlow", 180, [keys(pg, 18, [(0, 0.55), (90, 1), (180, 0.55)], "cubic")])
        inner = [pearl] + list(reversed(frames))
        boxes = [sprites[f"Clam{f}"] for f in range(4)]
    elif name == "Bubbler":  # ---- bubbler ---- the volcano and its column (bubbles left out of the hit box)
        inner = bubbler_inner()
        boxes = [sprites[name]]
    else:
        inner = [image(name, art)]
        boxes = [sprites[name]]
    x0, y0 = min(b[1] for b in boxes), min(b[2] for b in boxes)
    x1 = max(b[3] for b in boxes)
    hw = max(-x0, x1 + 1)
    decor_box[n] = (2 * hw, -y0)
    shadow = ellipse_shape("LiftShadow", 0, -2 * P, round(hw * 1.7) * P, 7 * P,
                           rad_grad(0, 0, round(hw * 0.85) * P, [(0, hx("1a0e08", 150)), (0.6, hx("1a0e08", 70)), (1, hx("1a0e08", 0))]),
                           opacity=0, binds=[bind(prop(f"dec{n}lift"), 18)])
    lift = node("Lift", inner, binds=[bind(prop(f"dec{n}lift"), 14, LIFT_CONV)])
    return node(f"Dec{n}{name}", [lift, shadow], x=x * P, y=y * P, opacity=0,
                binds=[bind(prop(f"dec{n}"), 18), bind(prop(f"dec{n}x", default=x * P), 13), bind(prop(f"dec{n}y", default=y * P), 14)])


world.append(decor_node(0))

# helpers that walk the sand top: same depth as the castle, so drawn over it and behind the reef, chest,
# front kelp and front decor (which all sit nearer the glass)
helper_box = {}


def helper_node(key, title, art, nframes, x, y, extra=()):
    """`{key}On` opacity, `{key}X/Y` origin, `{key}SX` scaleX (faces right at +1), frames one-hot `{key}F{f}`."""
    frames = [image(f"{title}{f}", lambda f=f: art(f), opacity=1 if f == 0 else 0, node_name=f"{title}F{f}",
                    binds=[bind(prop(f"{key}F{f}", default=1 if f == 0 else 0), 18)]) for f in range(nframes)]
    # hit box: the walk frames, body only (no antennae, no flying sand)
    boxes = [(0,) + (art(f, antennae=False) if key == "shrimp" else art(f)).bbox() for f in range(2)]
    helper_box[key] = (min(b[1] for b in boxes), min(b[2] for b in boxes), max(b[3] for b in boxes), max(b[4] for b in boxes))
    return node(title, list(extra) + list(reversed(frames)), x=x, y=y, opacity=0,
                binds=[bind(prop(f"{key}On"), 18), bind(prop(f"{key}X", default=x), 13), bind(prop(f"{key}Y", default=y), 14),
                       bind(prop(f"{key}SX", default=1), 16)])


world.append(helper_node("crab", "Crab", crab_art, 4, 162 * P, sand_top(162) * P))

# v7 visitors: one at a time, every few minutes. `{key}On` opacity (eased by the logic), `{key}X/Y` origin
# (world), `{key}SX` facing (art faces right at +1), frames one-hot `{key}F0..3`.
visitor_box = {}


def visitor_node(key, title, art, x, y, extra=()):
    frames = [image(f"{title}{f}", lambda f=f: art(f), opacity=1 if f == 0 else 0, node_name=f"{title}F{f}",
                    binds=[bind(prop(f"{key}F{f}", default=1 if f == 0 else 0), 18)]) for f in range(4)]
    bx = [sprites[f"{title}{f}"] for f in range(4)]
    visitor_box[key] = (min(b[1] for b in bx), min(b[2] for b in bx), max(b[3] for b in bx) + 1, max(b[4] for b in bx) + 1)
    return node(title, list(extra) + list(reversed(frames)), x=x, y=y, opacity=0,
                binds=[bind(prop(f"{key}On"), 18), bind(prop(f"{key}X", default=x), 13), bind(prop(f"{key}Y", default=y), 14),
                       bind(prop(f"{key}SX", default=1), 16)])
world.append(helper_node("shrimp", "Shrimp", shrimp_art, 4, 105 * P, sand_top(105) * P))


reef = Px()
for cx, cy, rx, ry, seed in [(40, 324, 22, 16, 1), (58, 330, 12, 9, 2), (24, 334, 10, 7, 3), (206, 326, 18, 13, 4), (222, 333, 10, 7, 5)]:
    blob(reef, cx, cy, rx, ry, R_ROCK, flat=sand_top(int(cx)) + 14, rough=1, seed=seed)
brain_coral(reef, 72, 336, 11, 8)
r2 = random.Random(9)
for bx, by, ang, ln, th, rmp in [(36, 312, -1.75, 15, 3.4, R_CORAL), (48, 316, -1.25, 12, 3.0, R_CORAL),
                                 (212, 316, -1.6, 14, 3.2, R_FAN), (200, 318, -2.0, 10, 2.8, R_FAN)]:
    branch_coral(reef, bx, by, ang, ln, th, 2, rmp, r2)
starfish(reef, 140, 345, 4)
starfish(reef, 178, 344, 3)
# v5 medium stretch: a small rock with tube sponges at the meadow's edge, then the coral garden
MED_ROCKS = [(339, 325, 18, 15, 13), (326, 337, 6, 5, 15)]
for cx, cy, rx, ry, seed in MED_ROCKS:
    blob(reef, cx, cy, rx, ry, R_ROCK, flat=sand_top(int(cx)) + 14, rough=1, seed=seed)
r7 = random.Random(17)
tube_sponge(reef, 330, 333, [6, 9, 5], R_SPONGE)
branch_coral(reef, 333, 313, -1.95, 12, 3.0, 2, R_CORAL, r7)
branch_coral(reef, 345, 312, -1.5, 13, 2.0, 3, R_FAN, r7)
table_coral(reef, 349, 320, 4)
urchin(reef, 322, 345, 2)
starfish(reef, 270, 346, 3)
shell(reef, 282, 345)
world.append(image("CaveArch", ARCH_PX))
world.append(image("Reef", reef))

# v5 large stretch: the arch was drawn before the reef; now its floor (a boulder) and the anemones
CAVE_BOULDERS = [(367, 338, 8, 8, 21)]
cave_floor = Px()
for cx, cy, rx, ry, seed in CAVE_BOULDERS:
    blob(cave_floor, cx, cy, rx, ry, R_CAVE, flat=WATER_BOT, rough=1, seed=seed)
for (x, y), c in list(cave_floor.d.items()):  # the cave's glow catches their inner sides
    if not cave_floor.has(x + 1, y) or not cave_floor.has(x, y - 1):
        cave_floor.put(x, y, mix(c, hx("2fa6a0"), 0.45))
r8 = random.Random(88)
for _ in range(9):
    x, y = r8.choice(sorted(cave_floor.d))
    CAVE_DOTS.append(((x, y), r8.choice([GLOW_C, GLOW_T, GLOW_V])))
    cave_floor.put(x, y, mix(R_CAVE[2], GLOW_C, 0.45))
world.append(image("CaveFloor", cave_floor))
anem_ids = {k: [nid() for _ in range(4)] for k in ("back", "arch", "glow")}
anem = {k: [] for k in anem_ids}
for f in range(4):
    px_ = {k: Px() for k in anem_ids}
    for ax, s_, A, where in ANEMONES:
        base = sand_top(ax) + 2 if where == "back" else ARCH_TOPS[ax] + 1
        anemone(px_[where], ax, base, f, s_, A, glow=px_["glow"])
    for k in anem_ids:
        anem[k].append(image(f"Anemones{k.capitalize()}{f}", px_[k], opacity=1 if f == 0 else 0, node_id=anem_ids[k][f],
                             blend="screen" if k == "glow" else None))
life_glow = anem["glow"]
_seq = [0, 1, 2, 3, 2, 1]
add_anim("Anemones", len(_seq) * 22, [keys(fid, 18, [(n * 22, 1 if s == i else 0) for n, s in enumerate(_seq)])
                                      for ids in anem_ids.values() for i, fid in enumerate(ids)])
world.append(node("AnemonesArch", anem["arch"]))
world.insert(ANEM_BACK, node("AnemonesBack", anem["back"]))
world.append(kelp_clump("KelpArch", 421, ARCH_TOPS[421] + 2, [46, 62, 38], R_KELP, 3.3, 18))

# polyp anchors: base of stalk on the actual rock tops (rock pixels only, no coral)
rocks = Px()
for cx, cy, rx, ry, seed in [(40, 324, 22, 16, 1), (58, 330, 12, 9, 2), (24, 334, 10, 7, 3), (206, 326, 18, 13, 4), (222, 333, 10, 7, 5)] + MED_ROCKS:
    blob(rocks, cx, cy, rx, ry, R_ROCK, flat=sand_top(int(cx)) + 14, rough=1, seed=seed)
for cx, cy, rx, ry, seed in CAVE_BOULDERS:
    blob(rocks, cx, cy, rx, ry, R_CAVE, flat=WATER_BOT, rough=1, seed=seed)


def rock_top(x):
    return min(y for (xx, y) in rocks.d if xx == x)


def clutter(x):
    t = rock_top(x)
    return sum(1 for xx in range(x - 6, x + 7) for yy in range(t - 24, t) if reef.has(xx, yy) and not rocks.has(xx, yy))


POLYP_ANCHORS = []  # (x, y, tier): the tier whose tank first holds the anchor
for want, tier, span in ((28, 0, 8), (54, 0, 8), (222, 0, 8), (325, 1, 3), (342, 1, 4), (367, 2, 3)):
    cols = [x for x in range(want - span, want + span + 1) if any(xx == x for xx, _ in rocks.d)
            and rock_top(x) <= SAND_BASE + (4 if tier == 0 else 12)]
    best = min(cols, key=lambda x: (clutter(x), abs(x - want)))
    POLYP_ANCHORS.append((best, rock_top(best), tier))
POLYP_ANCHORS.append((397, ARCH_TOPS[397], 2))  # on the lit back of the arch, in the sun
# (sand x, tier) for settled upside-down jellies: on open sand, a bell's width (~40) apart
SETTLE = [(74, 0), (128, 0), (198, 0), (254, 1), (298, 1), (404, 2), (442, 2)]
OPEN_SAND = [(62, 150, 0), (233, 318, 1), (380, 464, 2)]  # (x0, x1, tier): sand no scenery hides

CHEST_X, CHEST_Y = 150, 338
world.append(image("Chest", chest_art(), lx=CHEST_X, ly=CHEST_Y))
glow_id = nid()
world.append(ellipse_shape("ChestGlow", (CHEST_X + 17) * P, (CHEST_Y - 22) * P, 70 * P, 34 * P,
                         rad_grad(0, 0, 35 * P, [(0, hx("ffd76a", 150)), (1, hx("ffd76a", 0))]), blend="screen", sid=glow_id))
add_anim("ChestGlow", 240, [keys(glow_id, 18, [(0, 0.55), (120, 1), (240, 0.55)], "cubic")])

# ---- Halloween event ---- pumpkins and the cauldron on the sand, behind the front kelp (evHalloween)
world.append(hw_decor_node())
world.append(kelp_clump("KelpFrontL", 92, 344, [70, 96, 58], R_KELP, 2.1, 13))
world.append(kelp_clump("KelpFrontR", 228, 348, [84, 60], R_KELP, 4.3, 15))
world.append(kelp_clump("KelpFrontM", 324, 347, [70, 94], R_KELP, 5.2, 14))
# the seahorse holds on to a front kelp stalk, so it is drawn just in front of them
world.append(visitor_node("horse", "Seahorse", seahorse_art, 87 * P, 320 * P))
for n in (1, 2, 3, 4):
    world.append(decor_node(n))
world.append(decor_node(5))  # ---- bubbler ---- in front of the other decorations, behind the jellies
# the sea turtle swims across at mid depth: in front of the scenery, behind the jellies (WorldMid)
world.append(visitor_node("turtle", "Turtle", turtle_art, 120 * P, 170 * P))


def kelp_grips():
    """Where the seahorse can hold a front kelp stalk: the outer stalk on each side of a clump, ~30% up it
    (low, where the sway is smallest), at the neutral lean. (x, y, side, tier); side -1 = it hangs left."""
    out = []
    for base_x, base_y, heights, seed in ((92, 344, [70, 96, 58], 2.1), (228, 348, [84, 60], 4.3), (324, 347, [70, 94], 5.2),
                                         (421, ARCH_TOPS[421] + 2, [46, 62, 38], 3.3)):
        n = len(heights)
        for k, side in ((0, -1), (n - 1, 1)):
            h = heights[k]
            bx = base_x + k * 6 - n * 3
            t = max(16, round(0.4 * h))
            x = round(bx + 2.2 * math.sin(t * 0.12 + k * 1.7 + seed) * (t / h))
            tier = 0 if x < TIER_W[0] - GLASS_L else 1 if x < TIER_W[1] - GLASS_L else 2
            out.append((x, base_y - t, side, tier))
    return out


KELP_GRIPS = kelp_grips()

def bubble_stream(first, y_from, y_to, specs):
    """Bubbles rising from (x0, y_from) to y_to, each its own timeline (they loop at different lengths)."""
    for j, (dur, x0, r) in enumerate(specs):
        i = first + j
        bid = nid()
        world.append(image(f"Bubble{i}", bubble_art(r), node_id=bid, opacity=0))
        rise = min(dur, round((y_from - y_to) / (CHEST_Y - 24 - WATER_TOP - 3) * (240 + j * 20)))
        add_anim(f"Bubble{i}", dur, [
            keys(bid, 14, [(0, y_from * P), (rise, y_to * P)], "linear"),
            keys(bid, 13, [(f, (x0 + round(math.sin(f / 40 + i) * 3)) * P) for f in range(0, rise + 1, 40)], "cubic"),
            keys(bid, 18, [(0, 0), (6, 1), (rise - 4, 1), (rise, 0)], "linear"),
        ])


bubble_stream(0, CHEST_Y - 24, WATER_TOP + 3, [(300, 165, 2), (380, 168, 3), (450, 163, 2), (520, 167, 1), (600, 166, 2)])
bubble_stream(5, 343, WATER_TOP + 3, [(340, 300, 2), (430, 302, 1), (520, 299, 2)])      # a vent in the meadow sand
bubble_stream(8, 314, WATER_TOP + 3, [(380, 338, 2), (490, 340, 3)])                   # the coral garden
bubble_stream(10, 344, CAVE_TOP + 12, [(260, 424, 1), (330, 422, 2), (410, 425, 1)])     # up into the cave's crown

# marine snow: one-pixel motes drifting down
snow_tracks, snow = [], []
r3 = random.Random(21)
SNOW_DUR = 1800
for i in range(26):
    sid = nid()
    x = r3.randint(GLASS_L + 3, GLASS_R - 3)
    snow.append(rect_shape(f"Mote{i}", x * P, 0, P, P, solid(hx("eaf8ff", r3.choice([60, 90, 130]))), sid=sid))
    y_top, y_bot = (WATER_TOP + 2) * P, (SAND_BASE - 4) * P
    phase = r3.random()
    y_start = round(y_top + (y_bot - y_top) * phase)
    f_wrap = max(1, round(SNOW_DUR * (1 - phase)))
    kv = [(0, y_start), (f_wrap, y_bot)]
    if f_wrap < SNOW_DUR - 1:
        kv += [(f_wrap + 1, y_top), (SNOW_DUR, y_start)]
    snow_tracks.append(keys(sid, 14, kv, "linear"))
    snow_tracks.append(keys(sid, 13, [(0, x * P), (SNOW_DUR // 2, (x + r3.choice([-4, 4])) * P), (SNOW_DUR, x * P)], "cubic"))
r4 = random.Random(23)  # v5: more motes for the new stretches (the first 26 are the small tank's, as before)
for i in range(26, 62):
    sid = nid()
    x = r4.randint(GLASS_R + 1, WORLD_R - 3)
    snow.append(rect_shape(f"Mote{i}", x * P, 0, P, P, solid(hx("eaf8ff", r4.choice([60, 90, 130]))), sid=sid))
    phase = r4.random()
    y_start = round(y_top + (y_bot - y_top) * phase)
    f_wrap = max(1, round(SNOW_DUR * (1 - phase)))
    kv = [(0, y_start), (f_wrap, y_bot)]
    if f_wrap < SNOW_DUR - 1:
        kv += [(f_wrap + 1, y_top), (SNOW_DUR, y_start)]
    snow_tracks.append(keys(sid, 14, kv, "linear"))
    snow_tracks.append(keys(sid, 13, [(0, x * P), (SNOW_DUR // 2, (x + r4.choice([-4, 4])) * P), (SNOW_DUR, x * P)], "cubic"))
world.append(node("Snow", snow))
add_anim("Snow", SNOW_DUR, snow_tracks)
# v11: the Arctic's snowfall: denser, whiter marine snow, some flakes 2 px, drifting more
r9 = random.Random(91)
flakes, flake_tracks = [], []
FLAKE_DUR = 1500
for i in range(70):
    sid = nid()
    x = r9.randint(GLASS_L + 2, WORLD_R - 3)
    sz = P * (2 if r9.random() < 0.3 else 1)
    flakes.append(rect_shape(f"Flake{i}", x * P, 0, sz, sz, solid(hx("ffffff", r9.choice([110, 160, 210]))), sid=sid))
    y_top, y_bot = (WATER_TOP + 2) * P, (SAND_BASE - 2) * P
    phase = r9.random()
    y_start = round(y_top + (y_bot - y_top) * phase)
    f_wrap = max(1, round(FLAKE_DUR * (1 - phase)))
    kv = [(0, y_start), (f_wrap, y_bot)]
    if f_wrap < FLAKE_DUR - 1:
        kv += [(f_wrap + 1, y_top), (FLAKE_DUR, y_start)]
    flake_tracks.append(keys(sid, 14, kv, "linear"))
    sw = r9.choice([-7, -5, 5, 7])
    flake_tracks.append(keys(sid, 13, [(0, x * P), (FLAKE_DUR // 4, (x + sw) * P), (3 * FLAKE_DUR // 4, (x - sw) * P), (FLAKE_DUR, x * P)], "cubic"))
world.append(node("Snowfall", flakes, **themed(3)))
add_anim("Snowfall", FLAKE_DUR, flake_tracks)

btf.append(node("World", list(reversed(world)), binds=cam_bind()))

btf.append(rect_shape("Night", water_x, water_y, water_w, water_h, lin_grad(0, 0, 0, water_h, [
    (0, hx("0a1440", 150)), (1, hx("040a24", 215))]), opacity=0, binds=[bind(prop("nightShade"), 18)]))

# glow coral's night light: shown when owned (dec4) x host-driven dec4glow
_, gx_, gy_, _ = DECOR[4]
gpulse = nid()
mid = []  # world space again, over the Night layer: what glows, the food, the jellies, fx
mid.append(node("Dec4Glow", [node("Dec4GlowOn", [
    node("Dec4GlowPulse", [ellipse_shape("CoralHalo", 0, -7 * P, 64 * P, 38 * P,
                                         rad_grad(0, 0, 32 * P, [(0, hx("7affd8", 220)), (0.5, hx("b08aff", 90)), (1, hx("b08aff", 0))]), blend="screen")],
         node_id=gpulse),
    image("GlowCoralTips", mushroom_glow_art(), blend="screen")], opacity=0,
    binds=[bind(prop("dec4glow"), 18), bind(prop("dec4lift"), 14, LIFT_CONV)])],
    x=gx_ * P, y=gy_ * P, opacity=0, binds=[bind(prop("dec4"), 18), bind(prop("dec4x", default=gx_ * P), 13), bind(prop("dec4y", default=gy_ * P), 14)]))
# the pearl at night: the clam sits under the Night layer, so a copy of the pearl and its halo is drawn
# above it, following the clam (dec3x/dec3y/dec3lift) and shown only when pearl x nightShade.
_, cx3_, cy3_, _ = DECOR[3]
mid.append(node("Dec3PearlNight", [node("Lift", [node("PearlOn", [node("PearlNightShade", [
    image("Pearl", pearl_art()),
    ellipse_shape("PearlNightHalo", 0, 0, 30 * P, 24 * P,
                  rad_grad(0, 0, 15 * P, [(0, hx("fff6ff", 150)), (0.35, hx("f0d8ff", 70)), (1, hx("d0b8ff", 0))]), blend="screen")],
    opacity=0, binds=[bind(prop("nightShade"), 18)])], y=PEARL_DY * P, opacity=0, binds=[bind(prop("pearl"), 18)])],
    binds=[bind(prop("dec3lift"), 14, LIFT_CONV)])],
    x=cx3_ * P, y=cy3_ * P, opacity=0, binds=[bind(prop("dec3"), 18), bind(prop("dec3x", default=cx3_ * P), 13), bind(prop("dec3y", default=cy3_ * P), 14)]))
add_anim("CoralGlow", 300, [keys(gpulse, 18, [(0, 0.6), (150, 1), (300, 0.6)], "cubic")])

# the cave's light: over the Night layer, screen-blended. Always on softly; at night (nightShade) it comes
# up to full through a range mapper (0.45 -> 1). Dots twinkle in three groups; the heart of the cave breathes.
NIGHT_GLOW_CONV = nid()


def glow_dots(pts, core):
    px = Px()
    for (x, y), col in pts:
        for a2, b2 in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            px.over(x + a2, y + b2, col[:3] + (90,))
        px.put(x, y, mix(col, hx("ffffff"), core)[:3] + (255,))
    return px


tw_ids = [nid() for _ in range(3)]
dot_groups = [image(f"CaveDots{g}", glow_dots([d for k, d in enumerate(CAVE_DOTS + CAVE_BEADS) if k % 3 == g], 0.45),
                    node_id=tw_ids[g], blend="screen") for g in range(3)]
add_anim("CaveTwinkle", 360, [keys(tw_ids[g], 18, [(0, (1, 0.35, 0.7)[g]), (60 + g * 50, (0.3, 1, 0.4)[g]), (200 + g * 30, (0.9, 0.5, 1)[g]),
                                                   (360, (1, 0.35, 0.7)[g])], "cubic") for g in range(3)])
rim_glow = Px()
_arch = arch_mask()
for x, y in _arch:
    if any((x + a, y + b) not in _arch and cave_open(x + a, y + b) and y + b >= CAVE_TOP - 8 for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
        rim_glow.put(x, y, hx("4ff0d0", 75))
        for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + a, y + b) not in _arch:
                rim_glow.over(x + a, y + b, hx("4ff0d0", 40))
            elif (x + 2 * a, y + 2 * b) in _arch:
                rim_glow.over(x + a, y + b, hx("2fb8b0", 35))
heart = nid()
cave_halos = [ellipse_shape("CaveHeart", (CAVE_C + 2) * P, 286 * P, 104 * P, 160 * P,
                            rad_grad(0, 0, 52 * P, [(0, hx("4ad8d0", 150)), (0.45, hx("6a5ad8", 70)), (1, hx("6a5ad8", 0))]), blend="screen", sid=heart),
              ellipse_shape("CaveFloorLight", CAVE_C * P, (sand_top(CAVE_C) + 5) * P, 84 * P, 22 * P,
                            rad_grad(0, 0, 42 * P, [(0, hx("5ae8d8", 110)), (0.6, hx("4a8ad8", 40)), (1, hx("4a8ad8", 0))]), blend="screen")]
for ax, s_, A, _ in ANEMONES:
    if A[3] is not None:
        cave_halos.append(ellipse_shape("AnemoneHalo", ax * P, (sand_top(ax) - round(12 * s_)) * P, round(40 * s_) * P, round(30 * s_) * P,
                                        rad_grad(0, 0, round(20 * s_) * P, [(0, A[3][:3] + (120,)), (0.5, A[3][:3] + (45,)), (1, A[3][:3] + (0,))]),
                                        blend="screen"))
add_anim("CaveBreath", 420, [keys(heart, 18, [(0, 0.55), (210, 1), (420, 0.55)], "cubic")])
mid.append(node("CaveGlow", list(reversed(cave_halos + [image("CaveRimGlow", rim_glow, blend="screen")] + dot_groups
                                          + [node("AnemoneGlow", life_glow)])),
                binds=[bind(prop("nightShade"), 18, NIGHT_GLOW_CONV)]))
# ---- Halloween event ---- the pumpkins' candles and the brew's glow, over the Night layer
mid.append(hw_glow_node())

FOOD_N = 16  # v8: the pool grows for sprinkling
FOOD_KINDS = ["Flakes", "BrineShrimp", "Plankton"]
# v11: each pellet shows as its kind (food{i}k0..2, one-hot): a flake, a brine shrimp or a plankton speck. The
# pool is drawn over the Night layer; at night a plankton speck glows (a soft green screen-blended halo).
for i in range(FOOD_N):
    k0 = image("FoodFlake", food_art(), node_name=f"Flake{i}", binds=[bind(prop(f"food{i}k0", default=1), 18)])
    k1 = image("FoodShrimp", food_shrimp_art(), node_name=f"BrineShrimp{i}", opacity=0, binds=[bind(prop(f"food{i}k1"), 18)])
    k2 = node(f"Plankton{i}", [
        image("FoodPlankton", food_plankton_art()),
        ellipse_shape("PlanktonGlow", round(1.5 * P), round(1.5 * P), 11 * P, 11 * P,
                      rad_grad(0, 0, round(5.5 * P), [(0, hx("b4ff8a", 170)), (0.4, hx("6af07a", 70)), (1, hx("40e070", 0))]),
                      blend="screen", opacity=0, binds=[bind(prop("nightShade"), 18)]),
    ], opacity=0, binds=[bind(prop(f"food{i}k2"), 18)])
    mid.append(node(f"Food{i}", [k2, k1, k0], opacity=0,
                    binds=[bind(prop(f"food{i}x"), 13), bind(prop(f"food{i}y"), 14), bind(prop(f"food{i}o"), 18)]))

# the jellies: seven slots (v5; three before). Slot node (x, y, on) > species k > stage g > tentacles (tf) + palettes (bf).
# Origins: swimmers = centre of the bell rim; polyp = base of stalk; settled upside-down = underside centre;
# comb = body centre. Sprites are shared between slots (one ImageAsset each).
SLOT_XY = [(360, 540), (204, 420), (516, 690), (870, 600), (1020, 450), (1269, 630), (780, 780)]
# palette groups, back to front: flush is drawn over the others. v7 adds Morph (j{s}morph): the logic writes
# healthy = 0, morph = 1 for a morph that is neither pale nor flushed.
PAL_NAMES = (("h", "Healthy", "healthy"), ("p", "Pale", "pale"), ("m", "Morph", "morph"), ("g", "Ghost", "ghost"), ("r", "Flush", "flush"))
# (Ghost: the Halloween ghost-pale morph, j{s}ghost; its sprites are hw_*, see the Halloween event block)
INVERT_CONV = nid()  # DataConverterRangeMapper 0..1 -> 1..0: "not a morph" (the usual tentacles, the green ring)
bodies = [[None] * 4 for _ in range(len(SPECIES))]


def sprite_name(k, g, part):
    if part == "Ghost":  # Halloween event art: hw_ prefix
        return f"hw_{SPECIES[k].capitalize()}{STAGES[g].capitalize()}Ghost"
    if k == 0 and g == 3:  # the v1 moon jelly keeps its asset names
        return {"Tent": "Tent", "Healthy": "BellHealthy", "Pale": "BellPale", "Flush": "BellFlush", "Morph": "BellMorph",
                "MorphTent": "TentMorph", "Glint": "BellGlint"}[part]
    return f"{SPECIES[k].capitalize()}{STAGES[g].capitalize()}{part}"


# ---- v10 caustic sheen: a soft net of light drifting across each bell (screen blend). One sprite shared by every
# stage of every slot, sampled bilinear so it reads as light rather than pixels, slid by one looping timeline
# ("Sheen") and clipped to an ellipse inside the bell's smallest pulse frame. It stops 1 px above the rim.
CAUSTIC_PERIOD = 32  # logical px: the pattern repeats across x, so sliding it one period loops seamlessly
CAUSTIC_W, CAUSTIC_H = 104, 46
SHEEN_DUR = 330  # frames at 60 fps for one period
sheen_keys = []  # (image id, x start) for the timeline


def caustic_art():
    px = Px()
    tau = 2 * math.pi / CAUSTIC_PERIOD
    for y in range(-CAUSTIC_H, 0):
        for x in range(CAUSTIC_W):
            v = (math.sin(3 * tau * x + 0.31 * y) + math.sin(2 * tau * x - 0.47 * y + 1.3)
                 + math.sin(4 * tau * x + 0.2 * y + 2.1) * 0.6)
            a = math.exp(-(v / 0.42) ** 2) * smoothstep(-y / 7)
            if a > 0.04:
                px.put(x, y, hx("e6fcff", round(125 * a)))
    return px


def sheen_clip(k, g):
    """(cx, cy, half width, half height) of the clip ellipse in logical px, inside the smallest pulse frame."""
    s = 1.0 if g == 3 else 0.6
    if k == 3:
        return 0, 0, COMB_R[0] * s * 0.8, COMB_R[1] * s * 0.82
    if k == 2:
        return 0, -3.2 * s, 19 * s * 0.85, 4.2 * s
    bw, bh = {0: (62, 32), 1: (50, 30)}.get(k, NEW_BELL.get(k, (0, 0, 0))[:2])
    hw = bw * s * 0.5 * min(f[0] * pinched(0, -0.35, f[2]) for f in PULSE8) - 2
    hh = bh * s * min(f[1] for f in PULSE8) - 2
    if k == FRIED:  # the disc is thin: let the light play over the yolk dome too
        hw, hh = 13 * s, bh * s * 0.55 + 9 * s
    return 0, 0, hw, hh


def sheen_node(k, g):
    cx, cy, hw, hh = sheen_clip(k, g)
    clip_id, img_id = nid(), nid()
    aid, x0, y0, _, _ = sprite("Caustic", caustic_art)
    bottom = cy + (hh * 0.85 if k == 3 else 0)  # the sprite's last row sits 1 px above this
    xs = round((cx - hw - CAUSTIC_PERIOD) * P)
    sheen_keys.append((img_id, xs))
    clip = (f'<Shape x="{round(cx * P)}" y="{round(cy * P)}" name="SheenClip" id="{clip_id}">'
            f'<Ellipse width="{round(2 * hw * P)}" height="{round(2 * hh * P)}" name="e"/></Shape>')
    img = (f'<Image x="{xs}" y="{round((bottom + y0) * P)}" scaleX="{P}" scaleY="{P}" originX="0" originY="0" samplerFilter="bilinear"'
           f' assetId="{aid}" blendModeValue="screen" name="Caustic" id="{img_id}"/>')
    return node("Sheen", [clip, node("SheenLight", [f'<ClippingShape sourceId="{clip_id}" name="Clip"/>', img], opacity=0.75)])


def glint_art(k, g, f):
    """A morph's sparkle: a few tiny gold-white glints around the bell, a different set lit in each pulse frame."""
    b = species_body(k, g, 0, "m")
    x0, y0, x1, y1 = b.bbox()
    r2 = random.Random(900 + k * 10 + g)
    px = Px()
    n = 3 if g >= 2 else 2
    for i in range(n * 4):
        if i % 4 != f:
            continue
        gx = r2.randint(x0 - 2, x1 + 2)
        gy = r2.randint(y0 - 3, max(y0, min(y1, 0)))
        big = (i // 4) % 2 == 0 and g >= 2
        arm = 2 if big else 1
        for d in range(-arm, arm + 1):
            c = hx("ffffff") if abs(d) < arm else hx("ffd86a", 220)
            px.put(gx + d, gy, c)
            px.put(gx, gy + d, c)
    if not px.d:
        px.put(x0, y0, hx("ffffff", 1))
    return px


# ---- quiet nights: the bell's own soft light. A small screen-blended glow inside the bell in the species' colour,
# on j{s}nglow (the logic writes 0 by day; at night it swells with each squeeze of the bell, strongest for the
# crystal and the comb, faint for the rest).
def night_bell_glow(k, g, gcy, gw, gh):
    gc = GLOW[k]
    return ellipse_shape("NightBellGlow", 0, gcy, round(gw * 0.6), round(gh * 0.55),
                         rad_grad(0, 0, round(gw * 0.3), [(0, hx(gc, 150)), (0.55, hx(gc, 55)), (1, hx(gc, 0))]),
                         blend="screen", opacity=0, binds=[bind(jprop("nglow"), 18)])


def stage_node(k, g):
    on = lambda key, d: dict(opacity=d, binds=[bind(jprop(key, default=d), 18)])
    morph = jprop("morph")

    NB, NT = nbf(k, g), (8 if g >= 2 else 4)  # body frames; tf props the stage listens to

    def tent_set(name, part, p, **kw):
        def tent_frames(tr):
            # one image per tf prop; a 4-frame pose shows each of its sprites for two of the 8 (same phase)
            n = ntf(g, tr)
            return [frame_image(f"{sprite_name(k, g, part)}{TRAIL_SUFFIX[tr]}{f * n // NT}",
                                lambda f=f * n // NT, tr=tr: species_tent(k, g, f, tr, p),
                                **on(f"tf{f}", 1 if f == 0 else 0)) for f in range(NT)]
        if trails(k, g):
            # trail pose (tr, one-hot) wraps the sway frames (tf, one-hot): 5 x 4 images, sprites shared by all slots
            poses = [node(f"Trail{TRAIL_SUFFIX[tr] or 'Neutral'}", list(reversed(tent_frames(tr))),
                          **on(f"tr{tr}", 1 if tr == TR_NEUTRAL else 0), **SCALED) for tr in range(len(TRAIL))]
            return node(name, list(reversed(poses)), **kw)
        return node(name, list(reversed(tent_frames(TR_NEUTRAL))), **kw, **SCALED)

    if has_morph_tent(k, g):
        tents = [tent_set("Tentacles", "Tent", "h", binds=[bind(morph, 18, INVERT_CONV)]),
                 tent_set("MorphTentacles", "MorphTent", "m", opacity=0, binds=[bind(morph, 18)])]
    else:
        tents = [tent_set("Tentacles", "Tent", "h")]
    tents = hw_ghost_tents(tents)  # Halloween: they fade back under a ghost bell
    parts = [None, None] + tents  # [glow, morph halo] + tentacles, then the palettes (back to front)
    for pk, pn, pprop in PAL_NAMES:
        # v10: 8 pulse frames for juvenile/adult bells; the pale palette keeps 4 drawn ones (PALE_OF)
        fmap = PALE_OF if (NB == 8 and pk == "p") else list(range(NB))
        frames = [frame_image(f"{sprite_name(k, g, pn)}{fmap[f]}", lambda f=fmap[f], pk=pk: species_body(k, g, f, pk),
                              **on(f"bf{f}", 1 if f == 0 else 0)) for f in range(NB)]
        if pk == "m":  # the morph's glints twinkle with the pulse frames (4 sets, cycling)
            frames += [frame_image(f"{sprite_name(k, g, 'Glint')}{f % 4}", lambda f=f % 4: glint_art(k, g, f), blend="screen",
                                   **on(f"bf{f}", 1 if f == 0 else 0)) for f in range(NB)]
        parts.append(node(pn, list(reversed(frames)), **on(pprop, 1 if pk == "h" else 0), **SCALED))
    # v10: a drifting caustic sheen over the bell, clipped to it (shared sprite, one timeline for every slot)
    if g >= 2:
        parts.append(sheen_node(k, g))
    # measure from the art (logical px relative to the origin)
    bx = [sprites[f"{sprite_name(k, g, 'Healthy')}{f}"] for f in range(NB)]
    tx = [sprites[f"{sprite_name(k, g, 'Tent')}{f}"] for f in range(ntf(g, TR_NEUTRAL))]
    half = max(max(-b[1], b[3] + 1) for b in bx)
    top = -min(b[2] for b in bx + (tx if (k in (2, FLOWER) and g >= 2) else []))
    reach = max(0, max(b[4] + 1 for b in (tx if g != 0 else bx)))
    if g == 1:
        half = max(half, max(max(-b[1], b[3] + 1) for b in tx))
    bodies[k][g] = {"halfW": half * P, "top": top * P, "reach": reach * P}
    gc = GLOW[k]
    if k == 0 and g == 3:
        gcy, gw, gh = -18 * P, 130 * P, 120 * P
        glow = ellipse_shape("Glow", 0, gcy, gw, gh,
                             rad_grad(0, 0, 65 * P, [(0, hx("ffb8ea", 170)), (0.5, hx("ff9ade", 60)), (1, hx("ff9ade", 0))]),
                             blend="screen", **on("glow", 0.3))
        parts.append(ellipse_shape("BellSheen", -6 * P, -22 * P, 34 * P, 20 * P,
                                   rad_grad(0, 0, 17 * P, [(0, hx("ffffff", 70)), (1, hx("ffffff", 0))]), blend="screen"))
    else:
        y0 = -top
        y1 = max(b[4] + 1 for b in bx) if g != 3 or k != 3 else COMB_R[1]
        cy = (y0 + y1) / 2 if g != 0 else -POLYP_H * 0.7
        w = max(2.4 * half, 26)
        h = max(2.0 * (y1 - y0), 26)
        if k in (0, 1) and g >= 2:
            cy, h = y0 * 0.4, max(h, 2.0 * half)
        gcy, gw, gh = round(cy * P), round(w * P), round(h * P)
        glow = ellipse_shape("Glow", 0, gcy, gw, gh,
                             rad_grad(0, 0, round(w * P / 2), [(0, hx(gc, 170)), (0.5, hx(gc, 60)), (1, hx(gc, 0))]),
                             blend="screen", **on("glow", 0.3))
        if k in (0, 1) and g >= 2:
            parts.append(ellipse_shape("BellSheen", round(-0.1 * half * 2 * P), round(y0 * 0.62 * P), round(half * 1.1 * P), round(-y0 * 0.6 * P),
                                       rad_grad(0, 0, round(half * 0.55 * P), [(0, hx("ffffff", 60)), (1, hx("ffffff", 0))]), blend="screen"))
    # a morph's halo is tinted gold/white (faint, over the species' own glow)
    parts[1] = ellipse_shape("MorphGlow", 0, gcy, round(gw * 0.9), round(gh * 0.9),
                             rad_grad(0, 0, round(gw * 0.45), [(0, hx("fff6d0", 110)), (0.45, hx("ffd86a", 45)), (1, hx("ffd86a", 0))]),
                             blend="screen", opacity=0, binds=[bind(morph, 18)])
    parts.insert(2, hw_ghost_halo(gcy, gw, gh))  # Halloween: the ghost's pale halo, behind the tentacles
    parts.append(night_bell_glow(k, g, gcy, gw, gh))  # quiet nights: the bell's own soft light
    if k == CRYSTAL and g >= 2:
        sc = 1.0 if g == 3 else 0.6
        rings = []
        for nm, part, cols, kw in (("RingUsual", "Ring", ("b8ffd8", "5dffa0"), dict(binds=[bind(morph, 18, INVERT_CONV)])),
                                   ("RingMorph", "RingMorph", ("c8e4ff", "4a9cff"), dict(opacity=0, binds=[bind(morph, 18)]))):
            ring = [frame_image(f"{sprite_name(k, g, part)}{f}", lambda f=f, cols=cols: crystal_glow(f, sc, *cols), blend="screen",
                                **on(f"bf{f}", 1 if f == 0 else 0)) for f in range(NB)]
            rings.append(node(nm, [node("NightRing", list(reversed(ring)), opacity=0, binds=[bind(prop("nightShade"), 18)], **SCALED)], **kw))
        parts.append(node("Rings", rings))
    parts[0] = glow
    return node(STAGES[g].capitalize(), list(reversed(parts)), **on(f"g{g}", 1 if g == 3 else 0))


def jelly_comp():
    """The jelly, drawn once: species k > stage g > tentacles (tf) + palettes (bf), leaning on rot. Its origin is
    the slot origin; each placement (a NestedArtboard in WorldMid) carries the slot's x, y and on."""
    kids = [node(SPECIES[k].capitalize(), [stage_node(k, g) for g in range(4)],
                 opacity=1 if k == 0 else 0, binds=[bind(jprop(f"k{k}", default=1 if k == 0 else 0), 18)]) for k in range(len(SPECIES))]
    # v10: the whole jelly leans into its travel. Tilt rotates about the slot origin (the rim centre for swimmers),
    # so the bell tips toward the heading and the tentacles swing out behind it. rot is in radians.
    return node("Tilt", kids, binds=[bind(jprop("rot"), 15)])


JAB, JSM, JSTYLE, JSHEEN = nid(), nid(), nid(), nid()
jelly_art = jelly_comp()
for key in ("on", "x", "y"):  # placement props, written by the host like the rest (bound on the NestedArtboard)
    jprop(key)
# Tank: one nested Jelly property per slot, and one Jelly instance per slot (its defaults: slot 0 on, at SLOT_XY)
jslot_pid = [nid() for _ in range(SLOTS)]
jslot_vmi = [nid() for _ in range(SLOTS)]
JVMI = nid()  # the Jelly view model's own default instance (what JellyComp shows on its own)
for s_ in range(SLOTS):
    for key in _jorder:  # the host still writes flat names (j3k5): keep them in the contract, in the old order
        props[f"j{s_}{key}"] = (None, "jelly", jprops[key][1])
        _order.append(f"j{s_}{key}")


def jelly_slot(s_):
    x, y = SLOT_XY[s_]
    via = lambda key: f"{VM}-{jslot_pid[s_]}-{jprops[key][0]}"  # Tank > j{s} > key
    return (f'<NestedArtboard artboardId="{JAB}" dataBindPathIds="{VM}-{jslot_pid[s_]}" x="{x}" y="{y}"'
            f' opacity="{1 if s_ == 0 else 0}" name="Jelly{s_}">'
            f'{bind(via("on"), 18)}{bind(via("x"), 13)}{bind(via("y"), 14)}'
            f'<NestedSimpleAnimation animationId="{JSHEEN}" isPlaying="true" name="Sheen"/></NestedArtboard>')


for s_ in range(SLOTS):
    mid.append(jelly_slot(s_))
sheen_anim = (f'<LinearAnimation loopValue="loop" duration="{SHEEN_DUR}" name="Sheen" id="{JSHEEN}">'
              + "".join(keys(i, 13, [(0, x), (SHEEN_DUR, x + CAUSTIC_PERIOD * P)], "linear") for i, x in sheen_keys)
              + "</LinearAnimation>")

# ---- shop panel: covers the tank; slides on shopY (closed = 1500, off the artboard).
# Three tabs (JELLIES / DECOR / HELPERS). Each tab's cards live in a group whose y is bound to
# tab{t}Y: 0 when active, 3000 when not (moved away, so hidden cards can't be clicked).
SHOP_CLOSED = 1500
TAB_AWAY = 3000
PANEL = (7, 16, 226, 332)
CARD_W, CARD_H = 101, 67
ITEMS = [("BLUE BLUBBER", "POLYP", 40), ("UPSIDE-DOWN", "POLYP", 70), ("COMB JELLY", "POLYP", 110), ("CASTLE", "", 25),
         ("ANCHOR", "", 20), ("DIVE HELMET", "", 35), ("GIANT CLAM", "", 30), ("GLOW CORAL", "", 45),
         ("SNAIL", "EATS ALGAE", 30), ("CLEANER SHRIMP", "EATS SCRAPS", 40), ("HERMIT CRAB", "DIGS UP LOOT", 50),
         ("MEDIUM TANK", "CORAL REEF|+2 JELLIES", TIER_PRICE[1]), ("LARGE TANK", "GLOW CAVE|+2 JELLIES", TIER_PRICE[2]),
         ("FRIED EGG", "POLYP", 60), ("SEA NETTLE", "POLYP", 90), ("CRYSTAL JELLY", "POLYP", 130),
         ("FLOWER HAT", "POLYP", 160), ("LION'S MANE", "POLYP", 250),
         # v11: foods for the tool shelf, and tank themes
         ("BRINE SHRIMP", "FOOD|5 KINDS|LOVE IT", 40), ("PLANKTON", "FOOD|4 KINDS|LOVE IT", 70),
         ("REEF", "THEME|THE CLASSIC", 0), ("KELP FOREST", "THEME|GOLDEN|KELP", 140),
         ("CORAL GARDEN", "THEME|TROPICAL|CORALS", 170), ("ARCTIC", "THEME|ICE AND|SNOW", 200),
         ("BUBBLER", "BUBBLES|TO RIDE", 80)]  # ---- bubbler ---- (v13: item 24, decoration 5)
# shop item -> the species it sells (polyps)
JELLY_ITEM = {0: 1, 1: 2, 2: 3, 13: 4, 14: 5, 15: 6, 16: 7, 17: 8}
TANK_ITEMS, HELPER_ITEMS = (11, 12), (8, 9, 10)
FOOD_ITEM = {1: 18, 2: 19}            # v11: food kind -> the shop item that sells it
THEME_ITEM0 = 20                      # v11: theme n is shop item 20 + n (0 Reef, free and owned)
FOOD_ITEMS = tuple(FOOD_ITEM.values())
THEME_ITEMS = tuple(range(THEME_ITEM0, THEME_ITEM0 + len(THEMES)))
# a card locked because of the tank size: (item, prop, note lines)
NEEDS = [(12, "needs12", ["NEEDS", "MEDIUM"]), (15, "needs15", ["NEEDS", "MEDIUM"]), (17, "needs17", ["NEEDS", "LARGE"])]
TABS = [("JELLIES", [0, 13, 1, 14, 2, 15, 16, 17], "DRAG TO SEE MORE JELLIES"),
        ("DECOR", [3, 4, 5, 6, 7, 24], "HOLD A DECORATION TO MOVE IT"),
        ("SUPPLIES", [8, 9, 10, 18, 19], "NEW FOOD WAITS ON THE SHELF"),
        ("TANK", [11, 12, 20, 21, 22, 23], "TAP AN OWNED THEME TO USE IT")]
TAB_W, TAB_H, TAB_GAP, TAB_Y, TAB_LIFT = 50, 15, 4, 55, 3
TAB_X = [14 + t * (TAB_W + TAB_GAP) for t in range(len(TABS))]
RULE_Y = TAB_Y + TAB_H  # the shelf line the tabs stand on
CARD_Y0, CARD_PITCH = RULE_Y + 9, 73
CARD_POS = {}
for _t, (_, _items, _) in enumerate(TABS):
    for _k, _i in enumerate(_items):
        _x = 15 + (_k % 2) * 107
        if _k == len(_items) - 1 and _k % 2 == 0:
            _x = 15 + (107 + CARD_W - CARD_W) // 2  # a lone last card sits centred
        CARD_POS[_i] = (_t, _x, CARD_Y0 + (_k // 2) * CARD_PITCH)
HINT_Y = PANEL[1] + PANEL[3] - 18
# the JELLIES tab scrolls: its cards live in a group clipped to this window (logical px) and moved by shopScroll
VIEW_TOP, VIEW_BOT = RULE_Y + 2, HINT_Y - 5
_last = max(CARD_POS[i][2] for i in TABS[0][1]) + CARD_H + 2
SCROLL_MAX = max(0, _last + 3 - VIEW_BOT)
TRACK_X, TRACK_W = PANEL[0] + PANEL[2] - 8, 3
CLOSE = (PANEL[0] + PANEL[2] - 25, PANEL[1] + 8, 17, 17)
shop_hits = []
INK, INK2 = hx("4a2a18"), hx("8a6444")


def standing(art, cx, base_y):
    """Re-anchor an item sprite so its bounding box stands centred on (cx, base_y)."""
    x0, y0, x1, y1 = art.bbox()
    out = Px()
    for (x, y), c in art.d.items():
        out.put(x - (x0 + x1) // 2 + cx, y - y1 - 1 + base_y, c)
    return out


def wrap(text, width):
    lines, cur = [], ""
    for word in text.replace("-", "- ").split(" "):
        cand = (cur + ("" if cur.endswith("-") or not cur else " ") + word) if cur else word
        if text_width(cand) <= width:
            cur = cand
        else:
            lines.append(cur)
            cur = word
    return lines + [cur]


def item_icon(i):
    """Mini sprite for shop item i, origin = where it sits in its window (centre x, y)."""
    if i in TANK_ITEMS:
        return tank_icon(i - 10), 14
    if i in THEME_ITEMS:
        return theme_icon(i - THEME_ITEM0), 14
    if i in FOOD_ITEMS:  # the jar or the bottle on the sand, a few of its pellets drifting down past it
        m = standing(jar_art(False) if i == FOOD_ITEM[1] else bottle_art(False), 0, -1)
        x0, y0, x1, _ = m.bbox()
        for k, (fx, fy) in enumerate(((x1 + 3, y0 + 4), (x1 + 5, y0 + 13), (x0 - 7, y0 + 9), (x1 + 2, y0 + 22))):
            if i == FOOD_ITEM[1]:
                shrimp_pellet(m, fx, fy, k % 2 == 1)
            else:
                plankton_pellet(m, fx, fy)
        return m, 14
    if i in JELLY_ITEM:
        k = JELLY_ITEM[i]
        m = Px()
        for src in (species_tent(k, 2, 0), species_body(k, 2, 0, "h")):
            for (x, y), c in src.d.items():
                m.over(x, y, c)
        return m, {1: -2, 2: 8, 3: -6}.get(k, 0)
    if i in HELPER_ITEMS:
        art = [snail_art, shrimp_art, crab_art][i - 8](0)
        if i == 8:  # the snail's origin is its shell; stand it on its sole
            m = Px()
            for (x, y), c in art.d.items():
                m.put(x, y - 6, c)
            art = m
        elif i == 9:  # trim the antenna tips so the body centres in the window
            m = Px()
            for (x, y), c in art.d.items():
                if x <= 18:
                    m.put(x, y, c)
            art = m
        return art, 14
    if i == 24:  # ---- bubbler ----
        return bubbler_icon(), 14
    name, _, _, art = DECOR[i - 3]
    return (clam_art(3, pearl=True) if name == "Clam" else art()), 14


def edge4(m, x, y):
    return any((x + a, y + c) not in m for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def shop_panel_art():
    px = Px()
    X, Y, W_, H_ = PANEL
    m = round_rect_mask(W_, H_, 6)
    for x, y in m:  # wooden frame + parchment
        b = min(x, y, W_ - 1 - x, H_ - 1 - y)
        if edge4(m, x, y):
            col = R_WOOD[0]
        elif b < 6:
            grain = math.sin((x + y) * 0.35 + math.sin(x * 0.07) * 2)
            col = R_WOOD[4] if b == 1 else R_WOOD[1] if b == 5 else R_WOOD[2 + shade_index(0.55 + 0.25 * grain, 2, x, y, 0.5)]
        elif b == 6:
            col = R_CREAM[1]
        else:
            t = 0.8 - y / H_ * 0.25 + 0.04 * math.sin(x * 0.3 + y * 0.17)
            col = R_CREAM[3] if t > 0.66 or bay(x, y) < -0.35 else R_CREAM[2]
        px.put(X + x, Y + y, col)
    for bx, by in ((3, 3), (W_ - 4, 3), (3, H_ - 4), (W_ - 4, H_ - 4)):  # brass bolts
        px.put(X + bx, Y + by, R_GOLD[3])
        px.put(X + bx + 1, Y + by + 1, R_GOLD[1])
    # title plate
    tw = text_width("SHOP", 3)
    pw, ph = tw + 40, 25
    px0, py0 = X + (W_ - pw) // 2, Y + 7
    pm = round_rect_mask(pw, ph, 4)
    for x, y in pm:
        px.put(px0 + x, py0 + y, R_WOOD[0] if edge4(pm, x, y) else R_WOOD[4] if y == 1 else R_WOOD[1] if y >= ph - 3 else R_WOOD[3])
    tx, ty = px0 + 20, py0 + 5
    for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 1), (2, 2), (0, 2), (2, 1)):
        draw_text(px, "SHOP", tx + ox, ty + oy, R_WOOD[0], scale=3)
    draw_text(px, "SHOP", tx, ty, R_GOLD[4], scale=3)
    for row in range(ty + 8, ty + 15):
        for x in range(tx, tx + tw):
            if px.get(x, row) == R_GOLD[4]:
                px.put(x, row, R_GOLD[3])
    sand_dollar(px, px0 + 10, py0 + 12.5, 5.5)
    sand_dollar(px, px0 + pw - 10, py0 + 12.5, 5.5)
    # close button
    cx, cy, cw, ch = CLOSE
    cm = round_rect_mask(cw, ch, 4)
    for x, y in cm:
        px.put(cx + x, cy + y, hx("4a1418") if edge4(cm, x, y) else hx("ff8a7a") if y <= 2 else hx("8a2026") if y >= ch - 3 else hx("d84a44"))
    for d in range(-4, 5):
        for o in (0, 1):
            px.put(cx + 8 + d + o, cy + 8 + d, hx("fff2e0"))
            px.put(cx + 8 - d + o, cy + 8 + d, hx("fff2e0"))
    # the shelf the tabs stand on
    for x in range(X + 7, X + W_ - 7):
        px.put(x, RULE_Y, R_CREAM[1])
        px.put(x, RULE_Y + 1, R_CREAM[4])
    return px


def tab_art(t, active):
    """Folder tab, local origin = its top-left. Inactive: recessed, standing on the shelf.
    Active: raised TAB_LIFT, parchment-coloured, and it breaks the shelf line so it joins the page."""
    px = Px()
    label = TABS[t][0]
    h = TAB_H + (TAB_LIFT + 2 if active else 0)
    r = 3
    full = round_rect_mask(TAB_W, h + r, r)
    m = {(x, y) for x, y in full if y < h}
    for x, y in m:
        side = x in (0, TAB_W - 1) or (x, y - 1) not in m or ((x - 1, y) not in m or (x + 1, y) not in m)
        if active:
            if side and y < h - 2:
                c = R_WOOD[2]
            elif y <= 1 + (1 if (x - 1, y - 1) not in m else 0):
                c = R_CREAM[4]
            else:
                c = R_CREAM[3]
            if y >= h - 2 and x in (0, TAB_W - 1):
                c = R_CREAM[1] if y == h - 2 else R_CREAM[4]
        else:
            c = R_CREAM[1] if side else R_CREAM[3] if y <= 1 else R_CREAM[2]
        px.put(x, y, c)
    tw = tall_width(label)
    lx = (TAB_W - tw) // 2
    if active:
        draw_tall(px, label, lx, 4, INK, shadow=R_CREAM[4])
        for x in range(lx, lx + tw):  # a gold underline marks the open tab
            px.put(x, 4 + 10 + 2, R_GOLD[2] if x % 2 else R_GOLD[3])
    else:
        draw_tall(px, label, lx, 3, INK2)
    return px


def tall_width(s):
    return sum(len(FONT[ch].split("|")[0]) + 2 for ch in s) - 2


def draw_tall(px, s, x, y, col, shadow=None):
    """The pixel font drawn 2 tall (condensed, 2 px between letters), so four shop tabs fit."""
    for ch in s:
        rows = FONT[ch].split("|")
        for pass_, (dy, c_) in enumerate(((1, shadow), (0, col))):
            if c_ is None:
                continue
            for j, row in enumerate(rows):
                for i, b in enumerate(row):
                    if b == "#":
                        px.put(x + i, y + j * 2 + dy, c_)
                        px.put(x + i, y + j * 2 + 1 + dy, c_)
        x += len(rows[0]) + 2
    return x


def card_art(i):
    """One shop card, local origin = its top-left (drop shadow included)."""
    px = Px()
    cmask = round_rect_mask(CARD_W, CARD_H, 4)
    for x in range(2, CARD_W - 1):  # drop shadow
        px.put(x, CARD_H, hx("a78560"))
    for x, y in cmask:
        px.put(x, y, R_WOOD[2] if edge4(cmask, x, y) else R_CREAM[4] if y <= 2 else R_CREAM[3])
    wx, wy, ww, wh = 5, 5, 40, CARD_H - 10  # icon window: a little tank
    wm = round_rect_mask(ww, wh, 3)
    for x, y in wm:
        edge = edge4(wm, x, y)
        t = y / wh
        jelly = i in JELLY_ITEM
        col = R_WOOD[1] if edge else hx("8fe0f0") if y == 1 else mix(hx("3ab4e0"), hx("125fa6"), t) if bay(x, y) * 0.2 + t < 0.85 or jelly else R_SAND[3]
        if not edge and not jelly and y >= wh - 7:
            col = R_SAND[4] if y == wh - 7 else R_SAND[3]
        if not edge and (i in TANK_ITEMS or i in THEME_ITEMS):  # tanks sit in a room: papered wall, a wooden floor
            col = (R_WOOD[4] if y == wh - 7 else R_WOOD[2] if (x + (y // 3) * 5) % 9 else R_WOOD[1]) if y >= wh - 7 else \
                (R_CREAM[2] if x % 6 == 0 else R_CREAM[3]) if y > 1 else R_CREAM[4]
        px.put(wx + x, wy + y, col)
    icon, oy = item_icon(i)
    bx0, by0, bx1, by1 = icon.bbox()
    ix = wx + ww // 2 - (bx0 + bx1 + 1) // 2
    iy = wy + (wh - 3 if i not in JELLY_ITEM else (wh - (by1 - by0 + 1)) // 2 - by0 if i == 1 else 6 - by0)
    if i == 1:
        iy = wy + wh - 12
    for (x, y), c in icon.d.items():
        X2, Y2 = ix + x, iy + y
        if (X2 - wx, Y2 - wy) in wm and not edge4(wm, X2 - wx, Y2 - wy):
            px.over(X2, Y2, c)
    name, sub, price = ITEMS[i]
    ty = 7
    for line in wrap(name, CARD_W - 54):
        draw_text(px, line, 50, ty, INK, shadow=R_CREAM[4])
        ty += 7
    for k, line in enumerate(sub.split("|") if sub else []):
        draw_text(px, line, 50, ty + 1 + k * 7, INK2)
    pm2 = round_rect_mask(46, 14, 3)  # price plate
    for x, y in pm2:
        px.put(50 + x, 48 + y, R_CREAM[1] if edge4(pm2, x, y) else R_CREAM[2])
    if price == 0:  # the Reef theme
        draw_text(px, "FREE", 50 + (46 - text_width("FREE")) // 2, 53, INK, shadow=R_CREAM[3])
        return px
    sand_dollar(px, 57.5, 55, 4)
    dx = 65
    for ch_ in str(price):
        for (x, y), c in big_digit(int(ch_)).d.items():
            px.put(dx + x, 51 + y, INK if c != hx("2a140c") else R_CREAM[3])
        dx += 5
    return px


def hint_art(t):
    px = Px()
    text = TABS[t][2]
    x0 = PANEL[0] + (PANEL[2] - text_width(text)) // 2
    draw_text(px, text, x0, HINT_Y, INK2, shadow=R_CREAM[4])
    sand_dollar(px, x0 - 7, HINT_Y + 2.5, 2.6)
    sand_dollar(px, x0 + text_width(text) + 6, HINT_Y + 2.5, 2.6)
    return px


def own_badge():
    px = Px()
    m = round_rect_mask(46, 14, 3)
    for x, y in m:
        edge = any((x + a, y + c) not in m for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        px.put(x, y, hx("14402a") if edge else hx("7ee08a") if y <= 1 else hx("2a8a4a") if y >= 11 else hx("3cae5a"))
    for (x, y) in ((4, 7), (5, 8), (6, 9), (7, 8), (8, 7), (9, 6), (10, 5)):
        px.put(x, y, hx("ffffff"))
        px.put(x, y + 1, hx("1e5a34"))
    draw_text(px, "OWNED", 14, 5, hx("ffffff"), shadow=hx("1e5a34"))
    return px


def in_use_badge():
    """v11: the active theme's card: a gold plate with a star and IN USE."""
    px = Px()
    m = round_rect_mask(46, 14, 3)
    for x, y in m:
        edge = any((x + a, y + c) not in m for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        px.put(x, y, R_GOLD[0] if edge else R_GOLD[4] if y <= 1 else R_GOLD[1] if y >= 11 else R_GOLD[2])
    for dx, dy in ((0, -2), (0, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (-1, 1), (1, 1), (-1, 2), (1, 2), (0, 1)):
        px.put(8 + dx, 6 + dy, hx("fffbe0"))
    px.put(7, 9, R_GOLD[0])
    px.put(9, 9, R_GOLD[0])
    tw = text_width("IN USE")
    draw_text(px, "IN USE", 14 + (30 - tw) // 2, 5, hx("fffbe0"), shadow=R_GOLD[0])
    return px


def needs_note(lines):
    """A small red tag with a padlock and two lines of text, centred on its origin."""
    px = Px()
    tw = max(text_width(t) for t in lines)
    w, h = tw + 17, 19
    x0, y0 = -w // 2, -h // 2
    m = round_rect_mask(w, h, 3)
    for x, y in m:
        px.put(x0 + x, y0 + y, hx("4a1418") if edge4(m, x, y) else hx("ff8a7a") if y == 1 else hx("8a2026") if y >= h - 3 else hx("c83a3a"))
    lx, ly = x0 + 4, y0 + 6  # padlock
    for x in range(lx, lx + 6):
        for y in range(ly + 3, ly + 8):
            px.put(x, y, R_GOLD[3] if y == ly + 3 else R_GOLD[2] if x < lx + 5 else R_GOLD[1])
    for y in range(ly, ly + 3):
        px.put(lx + 1, y, R_IRON[4])
        px.put(lx + 4, y, R_IRON[4])
    px.put(lx + 2, ly - 1, R_IRON[4])
    px.put(lx + 3, ly - 1, R_IRON[4])
    px.put(lx + 2, ly + 5, R_WOOD[0])
    for k, t in enumerate(lines):
        draw_text(px, t, x0 + 13 + (tw - text_width(t)) // 2, y0 + 3 + k * 7, hx("fff2e0"), shadow=hx("4a1418"))
    return px


def lock_overlay():
    px = Px()
    for x, y in round_rect_mask(CARD_W, CARD_H, 4):
        px.put(x, y, hx("2a1a2a", 140))
    return px


def shop_node():
    kids = [image("ShopPanel", shop_panel_art())]  # back to front
    for t in range(len(TABS)):
        kids.append(image(f"TabOff{t}", tab_art(t, False), lx=TAB_X[t], ly=TAB_Y))
        kids.append(image(f"TabOn{t}", tab_art(t, True), lx=TAB_X[t], ly=TAB_Y - TAB_LIFT, opacity=1 if t == 0 else 0,
                          binds=[bind(prop(f"shopTab{t}", default=1 if t == 0 else 0), 18)]))
        hid = nid()
        shop_hits.append((hid, f"tab{t}"))
        kids.append(rect_shape(f"Tab{t}Hit", TAB_X[t] * P, (TAB_Y - TAB_LIFT) * P, TAB_W * P, (TAB_H + TAB_LIFT + 2) * P,
                               solid(hx("ffffff", 1)), sid=hid))
    for t, (label, items, _) in enumerate(TABS):
        g = [image(f"TabHint{t}", hint_art(t))]
        for i in items:
            _, x0, y0 = CARD_POS[i]
            g.append(image(f"Card{i}", card_art(i), lx=x0, ly=y0))
            g.append(image("CardLock", lock_overlay(), lx=x0, ly=y0, node_name=f"Lock{i}", opacity=0, binds=[bind(prop(f"lock{i}"), 18)]))
            g.append(image("OwnBadge", own_badge(), lx=x0 + 50, ly=y0 + 48, node_name=f"Own{i}", opacity=0, binds=[bind(prop(f"own{i}"), 18)]))
            if i in THEME_ITEMS:  # v11: the theme in use
                g.append(image("InUseBadge", in_use_badge(), lx=x0 + 50, ly=y0 + 48, node_name=f"Use{i}", opacity=0,
                               binds=[bind(prop(f"use{i}", default=1 if i == THEME_ITEM0 else 0), 18)]))
            for ni, nprop, nlines in NEEDS:  # locked because of the tank size (written by the logic alongside lock{i})
                if i == ni:
                    g.append(image(f"Needs{nlines[1].capitalize()}", needs_note(nlines), lx=x0 + 73, ly=y0 + 38, opacity=0,
                                   binds=[bind(prop(nprop), 18)]))
            hid = nid()
            shop_hits.append((hid, f"buy{i}"))
            g.append(rect_shape(f"Buy{i}Hit", x0 * P, y0 * P, CARD_W * P, CARD_H * P, solid(hx("ffffff", 1)), sid=hid))
        d = 0 if t == 0 else TAB_AWAY
        if t == 0 and SCROLL_MAX > 0:
            # cards scroll (shopScroll, ≤ 0) inside a clip window; the hint and the scrollbar stay put
            hint, cards = g[0], g[1:]
            clip_id = nid()
            view = (f'<Shape name="JelliesView" id="{clip_id}"><Rectangle x="{PANEL[0] * P}" y="{VIEW_TOP * P}" '
                    f'width="{PANEL[2] * P}" height="{(VIEW_BOT - VIEW_TOP) * P}" originX="0" originY="0" name="r"/></Shape>')
            scroll = node("JelliesScroll", [f'<ClippingShape sourceId="{clip_id}" name="Clip"/>'] + list(reversed(cards)),
                          binds=[bind(prop("shopScroll"), 14)])
            track_h = (VIEW_BOT - VIEW_TOP) * P
            thumb_h = round(track_h * (VIEW_BOT - VIEW_TOP) / (VIEW_BOT - VIEW_TOP + SCROLL_MAX))
            bar = [rect_shape("ScrollTrack", TRACK_X * P, VIEW_TOP * P, TRACK_W * P, track_h, solid(hx("d9bf94"))),
                   rect_shape("ScrollThumb", TRACK_X * P, VIEW_TOP * P, TRACK_W * P, thumb_h, solid(R_WOOD[2]),
                              binds=[bind(prop("shopScrollBar"), 14)])]
            g = [hint, view, scroll] + bar
        kids.append(node(f"Tab{t}Cards", list(reversed(g)), y=d, binds=[bind(prop(f"tab{t}Y", default=d), 14)]))
    hid = nid()
    shop_hits.append((hid, "shopClose"))
    cx, cy, cw, ch = CLOSE
    kids.append(rect_shape("CloseHit", (cx - 3) * P, (cy - 3) * P, (cw + 6) * P, (ch + 6) * P, solid(hx("ffffff", 1)), sid=hid))
    return node("Shop", list(reversed(kids)), y=SHOP_CLOSED, binds=[bind(prop("shopY", default=SHOP_CLOSED), 14)])


# sparkle burst (growth, purchase): positioned / scaled / faded by the host
spk = [nid(), nid()]
mid.append(node("Sparkle", [
    ellipse_shape("SparkleGlow", 0, 0, 60 * P, 60 * P, rad_grad(0, 0, 30 * P, [(0, hx("fff2b0", 200)), (0.4, hx("ffd86a", 70)), (1, hx("ffd86a", 0))]), blend="screen"),
    *[image(f"Sparkle{f}", sparkle_art(f), opacity=1 if f == 0 else 0, node_id=spk[f], blend="screen") for f in range(2)]][::-1],
    opacity=0, binds=[bind(prop("fxX", default=360), 13), bind(prop("fxY", default=540), 14), bind(prop("fxS", default=1), 16),
                      bind(prop("fxS", default=1), 17), bind(prop("fxO"), 18)]))
frame_cycle("Sparkle", spk, [0, 1], 8)

mid.append(node("Ripple", [ellipse_shape("Ring", 0, 0, 40 * P, 40 * P, None,
                                         stroke=f'<Stroke thickness="{P}" name="s">{solid(hx("e8fbff", 220))}</Stroke>')],
                opacity=0, binds=[bind(prop("rx"), 13), bind(prop("ry"), 14), bind(prop("rs", default=1), 16),
                                  bind(prop("rs", default=1), 17), bind(prop("ro"), 18)]))

btf.append(node("WorldMid", list(reversed(mid)), binds=cam_bind()))

# out-of-focus foreground: a few soft dark rocks along the bottom edge, nearer than the tank's contents
# (f = 1.15). Smooth gradients, low and sparse, so they never reach a jelly or a control.
fore = []
for i, (fx, fw, fh) in enumerate([(26, 96, 40), (178, 70, 30), (318, 104, 44), (470, 80, 34)]):
    fore.append(ellipse_shape(f"ForeRock{i}", fx * P, (WATER_BOT + 9) * P, fw * P, fh * P,
                              rad_grad(0, 0, fw * P // 2, [(0, hx("06122a", 205)), (0.55, hx("081830", 150)), (1, hx("0a1c38", 0))])))
btf.append(node("WorldFore", [node("ForeDepth", fore, binds=[bind(prop("camX"), 13, parallax_conv["Fore"])])], binds=cam_bind()))

btf.append(rect_shape("Murk", water_x, water_y, water_w, water_h, lin_grad(0, 0, 0, water_h, [
    (0, hx("7d9a52", 160)), (1, hx("4e6a32", 220))]), opacity=0, binds=[bind(prop("murkShade"), 18)]))
glass = []  # world space: what lives on the front glass, back to front
# v8: up to 12 dirt spots on the glass (world x/y = the spot's middle), each one of three kinds of grime
# (spot{i}v0..2, one-hot), faded by spot{i}o. Like the snail they sit after the Night layer, so each carries
# a night tint of its own. Sprites are shared by all twelve.
SPOT_N = 12
SPOT_NIGHT = hx("08103a", 150)
for i in range(SPOT_N):
    sx_, sy_ = (40 + (i % 4) * 50) * P, (90 + (i // 4) * 80) * P
    kinds = [image(nm, art, node_name=f"{nm}{i}", opacity=1 if v == 0 else 0,
                   binds=[bind(prop(f"spot{i}v{v}", default=1 if v == 0 else 0), 18)]) for v, (nm, art) in enumerate(SPOT_ART)]
    night = node("SpotNight", list(reversed([
        image(f"{nm}Night", lambda art=art: silhouette(art(), SPOT_NIGHT), opacity=1 if v == 0 else 0,
              binds=[bind(prop(f"spot{i}v{v}", default=1 if v == 0 else 0), 18)]) for v, (nm, art) in enumerate(SPOT_ART)])),
        opacity=0, binds=[bind(prop("nightShade"), 18)])
    glass.append(node(f"Spot{i}", [night] + list(reversed(kinds)), x=sx_, y=sy_, opacity=0,
                      binds=[bind(prop(f"spot{i}x", default=sx_), 13), bind(prop(f"spot{i}y", default=sy_), 14), bind(prop(f"spot{i}o"), 18)]))

# the snail lives on the front glass: over the jellies and the grime, under the glass streaks.
# It sits after the Night layer, so it carries its own night tint (same frames as dark silhouettes).
SNAIL_NIGHT = hx("08103a", 165)
snail_tint = node("SnailNight", list(reversed([
    image(f"SnailNight{f}", lambda f=f: silhouette(snail_art(f), SNAIL_NIGHT), opacity=1 if f == 0 else 0,
          binds=[bind(prop(f"snailF{f}", default=1 if f == 0 else 0), 18)]) for f in range(2)])),
    opacity=0, binds=[bind(prop("nightShade"), 18)])
# the mini diver works on the inside of the front glass: like the snail it is drawn after the Night layer,
# so it carries its own night tint, plus a headlamp that comes on in the dark
DIVER_NIGHT = hx("08103a", 150)
diver_tint = node("DiverNight", list(reversed([
    image(f"DiverNight{f}", lambda f=f: silhouette(diver_art(f), DIVER_NIGHT), opacity=1 if f == 0 else 0,
          binds=[bind(prop(f"diverF{f}", default=1 if f == 0 else 0), 18)]) for f in range(4)])),
    opacity=0, binds=[bind(prop("nightShade"), 18)])
diver_lamp = node("Headlamp", [
    ellipse_shape("LampHalo", 0, -19 * P, 24 * P, 16 * P, rad_grad(0, 0, 12 * P, [(0, hx("fff6c0", 170)), (0.35, hx("ffe890", 80)), (1, hx("ffe890", 0))]), blend="screen"),
    rect_shape("LampLens", 0, -16 * P, P, P, solid(hx("fffbe0")))], opacity=0, binds=[bind(prop("nightShade"), 18)])
glass.append(visitor_node("diver", "Diver", diver_art, 120 * P, 160 * P, extra=[diver_lamp, diver_tint]))
glass.append(helper_node("snail", "Snail", snail_art, 2, 192 * P, 120 * P, extra=[snail_tint]))
# ---- Halloween event ---- the bat visitor, hanging from the hood's front lip (in front of the glass)
glass.append(hw_bat_node())
btf.append(node("WorldGlass", list(reversed(glass)), binds=cam_bind()))

btf.append(rect_shape("Vignette", water_x, water_y, water_w, water_h,
                      rad_grad(water_w / 2, water_h * 0.45, water_h * 0.62, [(0, hx("061a3a", 0)), (0.6, hx("061a3a", 0)), (1, hx("061a3a", 150))])))
btf.append(poly_shape("GlassStreak1", [(30 * P, 20 * P), (44 * P, 20 * P), (14 * P, 120 * P), (6 * P, 120 * P)],
                      lin_grad(0, 20 * P, 0, 120 * P, [(0, hx("ffffff", 40)), (1, hx("ffffff", 0))])))
btf.append(poly_shape("GlassStreak2", [(50 * P, 20 * P), (54 * P, 20 * P), (26 * P, 100 * P), (24 * P, 100 * P)],
                      lin_grad(0, 20 * P, 0, 100 * P, [(0, hx("ffffff", 30)), (1, hx("ffffff", 0))])))

# the tank's walls, over the screen overlays: the left glass wall at world x 0, the right one at wallX
# (720 / 1080 / 1440 by tier) carrying an opaque "outside" panel so nothing past it ever shows.
OUTSIDE_W = 1500
right_wall = node("RightWall", [
    image("WallR", side_wall_art(True)),
    rect_shape("Outside", 0, 0, OUTSIDE_W, CAB_TOP * P, lin_grad(0, 0, 60 * P, 0, [(0, hx("0b0c14")), (1, hx("15161f"))])),
], x=TIER_W[0] * P, binds=[bind(prop("wallX", default=TIER_W[0] * P), 13)])
btf.append(node("WorldFront", [right_wall, image("WallL", side_wall_art(False))], binds=cam_bind()))

# pan hints: screen-fixed chevrons at the water's edges, shown (panL / panR) when there's more tank that way
HINT_CY = 182
chev = chevron_art()
bob_l, bob_r = nid(), nid()
btf.append(node("PanHints", [
    node("PanL", [node("PanLBob", [image("ChevronL", mirror(chev))], node_id=bob_l)], x=17 * P, y=HINT_CY * P, opacity=0,
         binds=[bind(prop("panL"), 18)]),
    node("PanR", [node("PanRBob", [image("ChevronR", chev)], node_id=bob_r)], x=219 * P, y=HINT_CY * P, opacity=0,
         binds=[bind(prop("panR"), 18)]),
]))
add_anim("PanHints", 96, [keys(bob_l, 13, [(0, 0), (48, -3 * P), (96, 0)], "cubic"), keys(bob_r, 13, [(0, 0), (48, 3 * P), (96, 0)], "cubic")])

# v8: the held item follows the pointer in SCREEN space. It is drawn on top of everything (appended after
# the buttons below), so it never hides behind the wood or the hood; the shop opening puts it down anyway. The food can's origin is its spout; the sponge's is its middle. canF0 / spongeF0 at
# rest, canF1 tipped and pouring (flakes falling, the can shaking) / spongeF1 squished and sudsy.
pour_ids = [nid() for _ in range(3)]
shake_id = nid()
can_node = node("Can", [
    node("CanPour", [
        node("PourFlakes", list(reversed([image(f"PourFlakes{f}", lambda f=f: pour_flakes(f), opacity=1 if f == 0 else 0, node_id=pour_ids[f])
                                          for f in range(3)]))),
        node("CanShake", [image("CanTipped", can_art(True))], node_id=shake_id),
    ], opacity=0, binds=[bind(prop("canF1"), 18)]),
    image("CanUpright", can_art(False), node_name="CanRest", opacity=1, binds=[bind(prop("canF0", default=1), 18)]),
], x=-300, y=-300, opacity=0, binds=[bind(prop("canX", default=-300), 13), bind(prop("canY", default=-300), 14), bind(prop("canO"), 18)])
frame_cycle("PourFlakes", pour_ids, [0, 1, 2], 5)
add_anim("CanShake", 16, [keys(shake_id, 13, [(0, 0), (4, P), (8, 0), (12, -P)]), keys(shake_id, 14, [(0, 0), (4, -P), (8, 0), (12, P)])])
suds_ids = [nid() for _ in range(3)]
sponge_node = node("Sponge", [
    node("SpongeScrub", [
        node("Suds", list(reversed([image(f"Suds{f}", lambda f=f: sponge_suds(f), opacity=1 if f == 0 else 0, node_id=suds_ids[f]) for f in range(3)]))),
        image("SpongeSquish", sponge_art_v8(True)),
    ], opacity=0, binds=[bind(prop("spongeF1"), 18)]),
    image("SpongeRest", sponge_art_v8(False), opacity=1, binds=[bind(prop("spongeF0", default=1), 18)]),
], x=-300, y=-300, opacity=0, binds=[bind(prop("spongeX", default=-300), 13), bind(prop("spongeY", default=-300), 14), bind(prop("spongeO"), 18)])
frame_cycle("Suds", suds_ids, [0, 1, 2, 1], 6)


def pour_cursor(key, title, art, stream):
    """v11: a food held like the can: `{key}X/Y` the mouth at the pointer, `{key}O` shown, `{key}F0` upright
    (lid on), `{key}F1` tipped and pouring (lid off, its food streaming out, shaking)."""
    ids = [nid() for _ in range(3)]
    shake = nid()
    n = node(title, [
        node(f"{title}Pour", [
            node(f"{title}Stream", list(reversed([image(f"{title}Stream{f}", lambda f=f: stream(f), opacity=1 if f == 0 else 0, node_id=ids[f])
                                                   for f in range(3)]))),
            node(f"{title}Shake", [image(f"{title}Tipped", art(True))], node_id=shake),
        ], opacity=0, binds=[bind(prop(f"{key}F1"), 18)]),
        image(f"{title}Upright", art(False), node_name=f"{title}Rest", opacity=1, binds=[bind(prop(f"{key}F0", default=1), 18)]),
    ], x=-300, y=-300, opacity=0, binds=[bind(prop(f"{key}X", default=-300), 13), bind(prop(f"{key}Y", default=-300), 14), bind(prop(f"{key}O"), 18)])
    frame_cycle(f"{title}Stream", ids, [0, 1, 2], 5)
    add_anim(f"{title}Shake", 16, [keys(shake, 13, [(0, 0), (4, P), (8, 0), (12, -P)]), keys(shake, 14, [(0, 0), (4, -P), (8, 0), (12, P)])])
    return n


jar_node = pour_cursor("jar", "Jar", jar_art, pour_shrimp)
bottle_node = pour_cursor("bottle", "Bottle", bottle_art, pour_plankton)
btf.append(shop_node())
btf.append(image("Frame", frame_art()))
lamp = Px()
for x in range(20, LW - 20):
    lamp.put(x, HOOD - 2, hx("fff6c8"))
    lamp.put(x, HOOD - 1, hx("ffe48a"))
btf.append(node("Lamp", [image("LampStrip", lamp),
                         rect_shape("LampGlow", water_x, water_y, water_w, 40 * P,
                                    lin_grad(0, 0, 0, 40 * P, [(0, hx("fff2b0", 90)), (1, hx("fff2b0", 0))]), blend="screen")],
                binds=[bind(prop("daylight", default=1), 18)]))

btf.append(image("Cabinet", cabinet_art()))
# v9: the meters live in the hood strip (logical x 50..166, y 1..11), between the counter and the HTML hood buttons
BAR_W = 21
METER_X0, METER_PITCH = 52, 38
meter_plate = Px()
for y in range(1, 12):
    for x in range(METER_X0 - 3, METER_X0 + 3 * METER_PITCH - 1):
        edge = y in (1, 11) or x in (METER_X0 - 3, METER_X0 + 3 * METER_PITCH - 2)
        meter_plate.put(x, y, hx("0d0e16") if edge else hx("181a28") if y > 2 else hx("10111c"))
for x in range(METER_X0 - 2, METER_X0 + 3 * METER_PITCH - 2):
    meter_plate.put(x, 11, hx("4c5070"))
btf.append(image("MeterPlate", meter_plate))
for i, (kind, pname, col) in enumerate([("food", "barFood", "ff9f43"), ("water", "barWater", "4cc3e0"), ("mood", "barMood", "ff6fa8")]):
    gx = METER_X0 + i * METER_PITCH
    icon = mini_icon(kind)
    ix0, iy0, ix1, iy1 = icon.bbox()
    btf.append(image(f"MeterIcon{i}", icon, lx=gx - ix0, ly=6 - (iy0 + iy1 + 1) // 2))
    track = Px()
    for x in range(BAR_W + 2):
        for y in range(6):
            track.put(x, y, hx("070810") if x in (0, BAR_W + 1) or y in (0, 5) else hx("262a40"))
    btf.append(image(f"MeterTrack{i}", track, lx=gx + 12, ly=3))
    bx, by = (gx + 13) * P, 4 * P
    btf.append(rect_shape(f"MeterFill{i}", bx, by, BAR_W * P, 4 * P, solid(hx(col)), rect_binds=bind(prop(pname, default=BAR_W * P), 20)))
    btf.append(rect_shape(f"MeterShine{i}", bx, by, BAR_W * P, P, solid(hx("ffffff", 90)), rect_binds=bind(prop(pname, default=BAR_W * P), 20)))

# hood counter: sand-dollar icon + 4 digit positions (p=0 = ones, rightmost), one-hot glyphs cd{p}n{d}
plate = Px()
for y in range(1, 12):
    for x in range(7, 47):
        edge = y in (1, 11) or x in (7, 46)
        plate.put(x, y, hx("0d0e16") if edge else hx("181a28") if y > 2 else hx("10111c"))
for x in range(8, 46):
    plate.put(x, 11, hx("4c5070"))
sand_dollar(plate, 14, 6.5, 4.6)
counter = [image("CounterPlate", plate)]
CD_X = [41, 36, 31, 26]
for p_ in range(4):
    for d in range(10):
        counter.append(image(f"Digit{d}", lambda d=d: big_digit(d), lx=CD_X[p_] - 4, ly=3, node_name=f"cd{p_}n{d}",
                             opacity=1 if (p_, d) == (0, 0) else 0,
                             binds=[bind(prop(f"cd{p_}n{d}", default=1 if (p_, d) == (0, 0) else 0), 18)]))
btf.append(node("Counter", list(reversed(counter))))

BTN_Y = 366
BTN_GAP = 8
# v9: the food can and the sponge stand on a shelf on the left of the cabinet; Lamp and Shop stay buttons on the right.
# v11: the shelf is wider and holds four things: the can (flakes), the brine shrimp jar and the plankton bottle
# (bought in the shop; until then an empty spot), and the sponge. The light switch moves a little left, the
# Shop button a little right and narrower.
SHELF = (30, 364, 151, 60)          # x, y, w, h of the recess (logical)
SWITCH = (7, 376, 18, 32)           # the light switch plate, on the wall left of the cubby
SHELF_TOP = SHELF[1] + SHELF[3] - 8  # the plank the items stand on
# (label, plate text, centre x, tool prop, press prop, trigger, owned prop or None)
SHELF_ITEMS = [
    ("Feed", "FLAKES", 47, "toolFood", "b0y", "feed", None),
    ("Shrimp", "SHRIMP", 82, "toolShrimp", "b4y", "shrimp", "haveShrimp"),
    ("Plankton", "PLANKTON", 120, "toolPlankton", "b5y", "plankton", "havePlankton"),
    ("Clean", "SPONGE", 158, "toolSponge", "b1y", "clean", None),
]
SHELF_SLOTS = {label: cx for label, _, cx, *_ in SHELF_ITEMS}  # item centre x on the shelf
SHELF_R = SHELF[0] + SHELF[2]
BTN_X = [0, 0, 0, (SHELF_R + LW - BTN_W) // 2]  # only Shop is a button now: centred in the space right of the cubby
AWAY_CONV = nid()  # DataConverterRangeMapper 0..1 -> 3000..0: an unbought shelf item's hit box is moved away


def switch_art(on):
    """A brass light switch: plate, two screws, a rocker lever up (lights on) or down (off), sun and moon engraved."""
    px = Px()
    x0, y0, w, h = SWITCH
    m = round_rect_mask(w, h, 3)
    for x, y in m:
        X, Y = x0 + x, y0 + y
        edge = any((x + a, y + b) not in m for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        t = 0.8 - y / h * 0.35 - x / w * 0.15
        px.put(X, Y, R_GOLD[0] if edge else R_GOLD[4] if (x <= 1 or y <= 1) else R_GOLD[1 + shade_index(t, 3, X, Y, 0.5)])
    for sy in (y0 + 3, y0 + h - 4):  # screws
        cx = x0 + w // 2
        px.put(cx - 1, sy, R_GOLD[0]); px.put(cx, sy, R_GOLD[0]); px.put(cx - 1, sy - 1, R_GOLD[4])
    # the slot the lever rides in
    sx0, sx1, sy0, sy1 = x0 + w // 2 - 3, x0 + w // 2 + 2, y0 + 8, y0 + h - 9
    for y in range(sy0, sy1 + 1):
        for x in range(sx0, sx1 + 1):
            px.put(x, y, hx("2b1a0a") if x in (sx0, sx1) or y in (sy0, sy1) else hx("4a2c12"))
    # the lever: a cream rocker, tipped up (on) or down (off), lit from above
    ly = sy0 + 1 if on else sy1 - 6
    for y in range(ly, ly + 6):
        for x in range(sx0 + 1, sx1):
            top = y == ly if on else y == ly + 5
            px.put(x, y, R_CREAM[4] if (on and y < ly + 2) or (not on and y > ly + 3) else R_CREAM[2] if not top else R_CREAM[3])
        px.put(sx0 + 1, y, R_CREAM[1])
    # engraved sun (top) and moon (bottom) on the plate
    cx = x0 + w // 2 - 1
    for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1), (0, 0)):
        px.put(cx + dx, y0 + 6 + dy, R_GOLD[0] if not on else hx("fff2a0"))
    for dx, dy in ((0, 0), (-1, 1), (0, 2), (1, 2)):
        px.put(cx + dx, y0 + h - 7 + dy, R_GOLD[0] if on else hx("fff8d0"))
    return px


def centred(name, px, binds=(), opacity=None, ly=None):
    x0, y0, x1, y1 = px.bbox()
    lx = (BTN_W - (x1 - x0 + 1)) // 2 - x0
    if ly is None:
        ly = (BTN_H - 4 - (y1 - y0 + 1)) // 2 - y0
    return image(name, px, lx=lx, ly=ly, binds=binds, opacity=opacity)


def shelf_art():
    """A recessed wooden cubby with a plank: the home of the foods and the sponge, a brass plate under each."""
    px = Px()
    x0, y0, w, h = SHELF
    m = round_rect_mask(w, h, 4)
    for x, y in m:
        X, Y = x0 + x, y0 + y
        if any((x + a, y + b) not in m for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c = R_WOOD[0]
        elif Y >= SHELF_TOP:  # the plank
            c = R_WOOD[5] if Y == SHELF_TOP else R_WOOD[4] if Y < SHELF_TOP + 4 else R_WOOD[2] if Y < SHELF_TOP + 6 else R_WOOD[1]
        else:  # the dark back panel, shadowed under the top and in the corners
            t = 0.35 - 0.25 * (1 - min(1, (Y - y0) / 10)) - 0.1 * (1 - min(1, x / 6, (w - x) / 6))
            grain = 0.06 * math.sin(X * 0.9 + math.sin(Y * 0.2) * 2)
            c = R_WOOD[shade_index(t + grain, 3, X, Y, 0.6)]
        px.put(X, Y, c)
    for _, text, cx, *_ in SHELF_ITEMS:  # little brass label plates on the plank's front edge
        tw = text_width(text)
        for x in range(cx - tw // 2 - 2, cx - tw // 2 + tw + 2):
            for y in range(SHELF_TOP + 3, SHELF_TOP + 10):
                edge = x in (cx - tw // 2 - 2, cx - tw // 2 + tw + 1) or y in (SHELF_TOP + 3, SHELF_TOP + 9)
                px.put(x, y, R_GOLD[1] if edge else R_GOLD[3] if y == SHELF_TOP + 4 else R_GOLD[2])
        draw_text(px, text, cx - tw // 2, SHELF_TOP + 4, hx("4a2a10"))
    return px


def dust_outline(art):
    """Where an item usually stands: a faint dusty outline of it."""
    out = Px()
    for (x, y), c in art.d.items():
        if any((x + a, y + b) not in art.d for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            out.put(x, y, hx("f1e2c4", 70))
    return out


def empty_spot(art):
    """v11: a food not bought yet: an empty place on the shelf, a faint dark ghost of it with a dashed rim."""
    out = Px()
    for (x, y), c in art.d.items():
        edge = any((x + a, y + b) not in art.d for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            if (x + y) % 3:
                out.put(x, y, hx("f1e2c4", 46))
        else:
            out.put(x, y, hx("0e0604", 70))
    return out


SHELF_ART = {"Feed": lambda: can_art(False), "Shrimp": lambda: jar_art(False), "Plankton": lambda: bottle_art(False),
             "Clean": lambda: sponge_art_v8(False)}
shelf_hits = []
shelf_items = [image("Shelf", shelf_art())]
_arts = {label: standing(SHELF_ART[label](), cx, SHELF_TOP) for label, _, cx, *_ in SHELF_ITEMS}
_bx = [(_arts[label].bbox()[0], _arts[label].bbox()[2]) for label, *_ in SHELF_ITEMS]
shelf_glow_ids = []
for n, (label, _, cx, tool, press, trig, have) in enumerate(SHELF_ITEMS):
    art = _arts[label]
    bx0, by0, bx1, by1 = art.bbox()
    # hit box: the item plus a margin, never past halfway to its neighbours
    hx0 = bx0 - 4 if n == 0 else max(bx0 - 4, (_bx[n - 1][1] + bx0) // 2 + 1)
    hx1 = bx1 + 5 if n == len(SHELF_ITEMS) - 1 else min(bx1 + 5, (bx1 + _bx[n + 1][0]) // 2 + 1)
    rect = (hx0, SHELF[1] + 2, hx1 - hx0, SHELF_TOP + 10 - SHELF[1] - 2)
    gid = nid()
    shelf_glow_ids.append(gid)
    kids = [node(f"{label}Spot", [
        node("Pulse", [ellipse_shape("Glow", cx * P, (by0 + by1) // 2 * P, (bx1 - bx0 + 26) * P, (by1 - by0 + 22) * P,
                                     rad_grad(0, 0, ((bx1 - bx0) // 2 + 13) * P, [(0, hx("ffd860", 130)), (0.55, hx("ffb030", 60)), (1, hx("ffb030", 0))]),
                                     blend="screen")], node_id=gid),
        image(f"{label}Dust", dust_outline(art)),
    ], opacity=0, binds=[bind(prop(tool), 18)])]
    # the item itself: hidden while it's in your hand (Invert of the tool flag); b{i}y bobs it when tapped
    kids.append(node(f"{label}Item", [image(f"{label}OnShelf", art)], binds=[bind(prop(tool), 18, INVERT_CONV), bind(prop(press), 14)]))
    hid = nid()
    hit = rect_shape(f"{label}Hit", rect[0] * P, rect[1] * P, rect[2] * P, rect[3] * P, solid(hx("ffffff", 1)), sid=hid)
    shelf_hits.append((hid, trig, rect))
    if have:
        # bought foods: shown when owned; until then an empty spot, and the hit box is moved away (not faded)
        shelf_items.append(image(f"{label}Empty", empty_spot(art), opacity=0, binds=[bind(prop(have), 18, INVERT_CONV)]))
        shelf_items.append(node(f"{label}Slot", kids, opacity=0, binds=[bind(prop(have), 18)]))
        shelf_items.append(node(f"{label}HitBox", [hit], y=3000, binds=[bind(prop(have), 14, AWAY_CONV)]))
    else:
        shelf_items.extend(kids + [hit])
btf.append(node("ToolShelf", list(reversed(shelf_items))))

switch_hit = nid()
btf.append(node("LightSwitch", [
    rect_shape("SwitchHit", (SWITCH[0] - 3) * P, (SWITCH[1] - 3) * P, (SWITCH[2] + 6) * P, (SWITCH[3] + 6) * P, solid(hx("ffffff", 1)), sid=switch_hit),
    node("SwitchPress", [
        image("SwitchOn", switch_art(True), binds=[bind(prop("sunO", default=1), 18)]),
        image("SwitchOff", switch_art(False), opacity=0, binds=[bind(prop("moonO"), 18)]),
    ], binds=[bind(prop("b2y"), 14)]),
]))

hit_ids = [(hid, trig) for hid, trig, _ in shelf_hits] + [(switch_hit, "lamp")]
TRIGGERS = ["feed", "clean", "lamp", "shop", "shrimp", "plankton"]
SHOP_BTN = 3
inner = [image("BtnBase", button_art(), node_name="ShopBase"), centred("ShopIcon", icon_shop())]
press = node("ShopPress", list(reversed(inner)), binds=[bind(prop(f"b{SHOP_BTN}y"), 14)])
hid = nid()
hit_ids.append((hid, "shop"))
hit = rect_shape("ShopHit", 0, 0, BTN_W * P, (BTN_H + 2) * P, solid(hx("ffffff", 1)), sid=hid)
btf.append(node("ShopButton", [hit, press, image("BtnShadow", button_shadow(), node_name="ShopShadow")], x=BTN_X[SHOP_BTN] * P, y=BTN_Y * P))
add_anim("HeldGlow", 120, [keys(g, 18, [(0, 0.6), (60, 1), (120, 0.6)], "cubic") for g in shelf_glow_ids])
btf.append(node("Cursor", [sponge_node, can_node, jar_node, bottle_node]))  # topmost: the held can / jar / bottle / sponge

# ---------------------------------------------------------------- assemble

SM, AB, STYLE = nid(), nid(), nid()
layers = []
for _, aid, name in anims:
    sid = nid()
    layers.append(f'<StateMachineLayer name="{name}" id="{nid()}"><AnyState x="0" y="-100"/><ExitState x="200" y="-100"/>'
                  f'<EntryState><StateTransition stateToId="{sid}"/></EntryState><AnimationState x="100" y="100" animationId="{aid}" id="{sid}"/></StateMachineLayer>')
listeners = []
for t in TRIGGERS + ["shopClose"] + [f"buy{i}" for i in range(len(ITEMS))] + [f"tab{t}" for t in range(len(TABS))]:
    prop(t, kind="trigger")
for hid, t in hit_ids + shop_hits:
    listeners.append(f'<StateMachineListenerSingle targetId="{hid}" listenerTypeValue="click" name="{t}"><ListenerViewModelChange>'
                     f'<BindablePropertyTrigger propertyValue="1"><DataBindContext sourcePathIds="{prop(t)}" propertyKey="686" direction="true"/>'
                     f'</BindablePropertyTrigger></ListenerViewModelChange></StateMachineListenerSingle>')
sm = f'<StateMachine name="Tank" id="{SM}">{"".join(listeners)}{"".join(layers)}</StateMachine>'

vm_props, vm_vals = [], []
for name in _order:
    pid, kind, default = props[name]
    if kind == "jelly":  # lives in the slot's nested Jelly instance (below)
        continue
    if kind == "trigger":
        vm_props.append(f'<ViewModelPropertyTrigger name="{name}" id="{pid}"/>')
        vm_vals.append(f'<ViewModelInstanceTrigger viewModelPropertyId="{pid}"/>')
    else:
        vm_props.append(f'<ViewModelPropertyNumber name="{name}" id="{pid}"/>')
        vm_vals.append(f'<ViewModelInstanceNumber propertyValue="{default}" viewModelPropertyId="{pid}"/>')
for s_ in range(SLOTS):
    vm_props.append(f'<ViewModelPropertyViewModel viewModelReferenceId="{JVM}" name="j{s_}" id="{jslot_pid[s_]}"/>')
    vm_vals.append(f'<ViewModelInstanceViewModel propertyValue="{jslot_vmi[s_]}" viewModelPropertyId="{jslot_pid[s_]}"/>')
vm = (f'<ViewModel defaultInstanceId="{VMI}" name="Tank" id="{VM}">{"".join(vm_props)}'
      f'<ViewModelInstance exports="true" name="Default" id="{VMI}">{"".join(vm_vals)}</ViewModelInstance></ViewModel>')


def jelly_instance(name, iid, over):
    vals = "".join(f'<ViewModelInstanceNumber propertyValue="{over.get(key, d)}" viewModelPropertyId="{pid}"/>'
                   for key, (pid, d) in ((key, jprops[key]) for key in _jorder))
    return f'<ViewModelInstance exports="true" name="{name}" id="{iid}">{vals}</ViewModelInstance>'


jvm = (f'<ViewModel defaultInstanceId="{JVMI}" name="Jelly" id="{JVM}">'
       + "".join(f'<ViewModelPropertyNumber name="{key}" id="{jprops[key][0]}"/>' for key in _jorder)
       + jelly_instance("Default", JVMI, {"on": 1})
       + "".join(jelly_instance(f"j{s_}", jslot_vmi[s_], {"on": 1 if s_ == 0 else 0, "x": SLOT_XY[s_][0], "y": SLOT_XY[s_][1]})
                 for s_ in range(SLOTS))
       + "</ViewModel>")
jsheen_layer = (f'<StateMachineLayer name="Sheen" id="{nid()}"><AnyState x="0" y="-100"/><ExitState x="200" y="-100"/>'
                f'<EntryState><StateTransition stateToId="{(_jst := nid())}"/></EntryState>'
                f'<AnimationState x="100" y="100" animationId="{JSHEEN}" id="{_jst}"/></StateMachineLayer>')
# the jelly component: drawn about its origin (the slot origin), never clipped; 160x160 logical is only its frame
jelly_ab = (f'<Artboard isComponent="true" clip="false" defaultStateMachineId="{JSM}" viewModelId="{JVM}" viewModelInstanceId="{JVMI}"'
            f' styleId="{JSTYLE}" x="{W + 120}" y="0" width="{160 * P}" height="{160 * P}" originX="0.5" originY="0.5" name="JellyComp" id="{JAB}">'
            f'<LayoutComponentStyle name="JellyComp Style" id="{JSTYLE}"/>{jelly_art}'
            f'<StateMachine name="Jelly" id="{JSM}">{jsheen_layer}</StateMachine>{sheen_anim}</Artboard>'
            f'<ComponentAsset artboardId="{JAB}" name="JellyComp"/>')

nl = "\n"
doc = f'''<Rive version="1" kind="fragment">
<Artboard clip="true" defaultStateMachineId="{SM}" viewModelId="{VM}" viewModelInstanceId="{VMI}" styleId="{STYLE}" width="{W}" height="{H}" name="Tank" id="{AB}">
<LayoutComponentStyle name="Tank Style" id="{STYLE}"/>
<Fill name="Background">{solid(hx("15161f"))}</Fill>
{nl.join(reversed(btf))}
{sm}
{nl.join(a for a, _, _ in anims)}
</Artboard>
{jelly_ab}
<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="0" maxOutput="{-LIFT * P}" clampLower="true" clampUpper="true" name="Lift" id="{LIFT_CONV}"/>
<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="0.45" maxOutput="1" clampLower="true" clampUpper="true" name="NightGlow" id="{NIGHT_GLOW_CONV}"/>
{nl.join(f'<DataConverterRangeMapper minInput="{CAM_MIN}" maxInput="0" minOutput="{round(CAM_MIN * (f - 1))}" maxOutput="0" clampLower="true" clampUpper="true" name="Parallax{k}" id="{parallax_conv[k]}"/>' for k, f in PARALLAX.items())}
<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="1" maxOutput="0" clampLower="true" clampUpper="true" name="Invert" id="{INVERT_CONV}"/>
<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="3000" maxOutput="0" clampLower="true" clampUpper="true" name="Away" id="{AWAY_CONV}"/>
<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="1" maxOutput="{HW_GHOST_FADE}" clampLower="true" clampUpper="true" name="hw_GhostFade" id="{HW_FADE_CONV}"/>
{jvm}
{vm}
{nl.join(assets)}
</Rive>
'''
(RIVE / "tank.rml").write_text(doc)

contract = {
    "P": P, "LW": LW, "LH": LH, "W": W, "H": H,
    "waterTop": WATER_TOP * P, "waterBot": WATER_BOT * P, "glassL": GLASS_L * P, "glassR": (GLASS_R + 1) * P,
    "sandTop": [sand_top(x) * P for x in range(WLW)], "cabTop": CAB_TOP * P,
    "worldLW": WLW, "worldW": WLW * P, "slots": SLOTS, "wallW": GLASS_L * P,
    "tiers": [{"worldW": TIER_W[t] * P, "maxJellies": TIER_JELLIES[t], "price": TIER_PRICE[t], "glassR": (TIER_W[t] - GLASS_L) * P}
              for t in range(3)],
    "openSand": [{"x0": a * P, "x1": b * P, "tier": t} for a, b, t in OPEN_SAND],
    "decorRange": [{"x0": (GLASS_L if t == 0 else TIER_W[t - 1] - GLASS_L) * P, "x1": (TIER_W[t] - GLASS_L) * P, "tier": t} for t in range(3)],
    "tierRule": "polypAnchors, settleSpots, openSand and decorRange entries are available when s.tier >= their tier",
    "parallax": {k: f for k, f in PARALLAX.items()},
    "foodN": FOOD_N, "barW": BAR_W,
    # v8: dirt spots on the glass (world, origin = the spot's middle) and the held items (screen)
    "spotN": SPOT_N, "spotR": SPOT_R * P, "spotKinds": [nm for nm, _ in SPOT_ART],
    "cursorOrigin": {"can": "the spout (middle of the cap's top face)", "sponge": "the sponge's middle",
                     "jar": "the jar's mouth", "bottle": "the bottle's mouth"},
    # v11: foods. Pellet kinds (food{i}k0..2), the shelf tool of each, and the shop item that sells it
    "foodKinds": ["flakes", "brineShrimp", "plankton"],
    "foodTools": {"flakes": {"tool": "food", "trigger": "feed", "cursor": "can"},
                  "brineShrimp": {"tool": "shrimp", "trigger": "shrimp", "cursor": "jar", "shopItem": FOOD_ITEM[1], "owned": "haveShrimp"},
                  "plankton": {"tool": "plankton", "trigger": "plankton", "cursor": "bottle", "shopItem": FOOD_ITEM[2], "owned": "havePlankton"}},
    "polypAnchors": [{"x": x * P, "y": y * P, "tier": t} for x, y, t in POLYP_ANCHORS],
    "settleSpots": [{"x": x * P, "y": sand_top(x) * P, "tier": t} for x, t in SETTLE],
    "bodies": bodies,
    "shopOpenY": 0, "shopClosedY": SHOP_CLOSED,
    "buttons": [{"name": trig, "x": r[0] * P, "y": r[1] * P, "w": r[2] * P, "h": r[3] * P} for _, trig, r in shelf_hits]
               + [{"name": "lamp", "x": (SWITCH[0] - 3) * P, "y": (SWITCH[1] - 3) * P, "w": (SWITCH[2] + 6) * P, "h": (SWITCH[3] + 6) * P}]
               + [{"name": "shop", "x": BTN_X[SHOP_BTN] * P, "y": BTN_Y * P, "w": BTN_W * P, "h": (BTN_H + 2) * P}],
    "shopCards": [{"x": CARD_POS[i][1] * P, "y": CARD_POS[i][2] * P, "w": CARD_W * P, "h": CARD_H * P, "tab": CARD_POS[i][0]}
                  for i in range(len(ITEMS))],
    "shopScroll": {"max": SCROLL_MAX * P, "viewTop": VIEW_TOP * P, "viewBottom": VIEW_BOT * P,
                   "trackTop": VIEW_TOP * P, "trackH": (VIEW_BOT - VIEW_TOP) * P},
    "shopTabs": [{"name": TABS[t][0], "x": TAB_X[t] * P, "y": (TAB_Y - TAB_LIFT) * P, "w": TAB_W * P, "h": (TAB_H + TAB_LIFT + 2) * P}
                 for t in range(len(TABS))],
    "tabAwayY": TAB_AWAY,
    "shopClose": {"x": (CLOSE[0] - 3) * P, "y": (CLOSE[1] - 3) * P, "w": (CLOSE[2] + 6) * P, "h": (CLOSE[3] + 6) * P},
    "decor": [{"name": nm, "x": x * P, "y": y * P, "w": decor_box[n][0] * P, "h": decor_box[n][1] * P}
              for n, (nm, x, y, _) in enumerate(DECOR)],
    "decorLift": LIFT * P,
    "pearl": {"dx": 0, "dy": PEARL_DY * P, "r": PEARL_R * P},
    **{f"{k}Size": {"w": 2 * max(-b[0], b[2] + 1) * P,
                    "h": (2 * max(-b[1], b[3] + 1) if k == "snail" else -b[1]) * P} for k, b in helper_box.items()},
    "helperOrigin": {"snail": "shell centre; box centred on it", "shrimp": "bottom-centre; box x-w/2..x+w/2, y-h..y",
                     "crab": "bottom-centre; box x-w/2..x+w/2, y-h..y"},
    "trailPoses": TRAIL_POSES,
    # v10: juvenile/adult bells pulse in 8 frames (bf0..7, the pale palette draws 4 and maps them), tentacles
    # ripple in 8 (tf0..7; stream/trail poses draw 4, each shown for two tf props); polyps, ephyrae and the
    # comb's shimmer keep bf0..3 / tf0..3. j{s}rot leans the whole jelly about its slot origin, radians.
    "pulseFrames": PULSE_NAMES, "paleOf": PALE_OF, "tilt": {"prop": "j{s}rot", "units": "radians", "pivot": "slot origin"},
    "trails": [[trails(k, g) for g in range(4)] for k in range(len(SPECIES))],
    "species": SPECIES, "stages": STAGES,
    # v7 visitors: hit box relative to the origin at scaleX +1 (mirror x for -1), artboard units
    "visitors": {k: {"x0": b[0] * P, "y0": b[1] * P, "x1": b[2] * P, "y1": b[3] * P} for k, b in visitor_box.items()},
    "visitorOrigin": {"turtle": "middle of the shell", "horse": "the tail's grip on the kelp stalk",
                      "diver": "middle of the belly, on the front glass"},
    # where the seahorse can curl its tail round a front kelp stalk (world), side = which way it hangs and faces
    "kelpGrips": [{"x": x * P, "y": y * P, "side": sd, "tier": t} for x, y, sd, t in KELP_GRIPS],
    "triggers": [n for n in _order if props[n][1] == "trigger"],
    "props": [n for n in _order if props[n][1] in ("number", "jelly")],
    # v12: the jelly is one component (JellyComp, view model Jelly) placed seven times. A flat slot name the host
    # writes, j{s}{key}, lives at the nested path j{s}/{key} of the Tank instance (vmi.number("j3/k5")).
    "nested": {"pattern": "^j([0-6])(.+)$", "path": "j{s}/{key}", "viewModel": "Jelly", "keys": list(_jorder)},
}
hw_contract(contract)  # ---- Halloween event ----
# ---- asset groups: each group's PNGs packed into one file (base64 in JSON, a type every host serves and
# compresses); the contract lists them with a content hash the host adds to the URL so a new build busts caches
SPRITE_DIR = ROOT / "public" / "sprites"
SPRITE_DIR.mkdir(parents=True, exist_ok=True)
for old in SPRITE_DIR.glob("*.json"):
    old.unlink()
packs = {}
for name in sorted(sprites):
    if asset_group(name):
        packs.setdefault(asset_group(name), {})[name] = base64.b64encode((IMG / f"{name}.png").read_bytes()).decode()
contract["assetGroups"] = {}
for group, members in sorted(packs.items()):
    data = json.dumps({"group": group, "sprites": members}, separators=(",", ":")).encode()
    (SPRITE_DIR / f"{group}.json").write_bytes(data)
    contract["assetGroups"][group] = {"file": f"sprites/{group}.json", "v": hashlib.sha1(data).hexdigest()[:10],
                                      "sprites": len(members), "bytes": len(data)}
print("groups: " + ", ".join(f"{g} {a['sprites']} ({a['bytes'] // 1024} KB)" for g, a in contract["assetGroups"].items()))
(ROOT / "src" / "contract.json").write_text(json.dumps(contract, indent=1))


def journal_portrait(k, p):
    """Adult, frame 0, neutral tentacles, body over tentacles, trimmed to the art."""
    m = Px()
    for src in (species_tent(k, 3, 0, TR_NEUTRAL, p), species_body(k, 3, 0, p)):
        for (x, y), c in src.d.items():
            m.over(x, y, c)
    return m


def hw_ghost_portrait(k):
    """The ghost morph as the tank draws it: the usual tentacles faded back (HW_GHOST_FADE) under the Ghost bell."""
    m = Px()
    for (x, y), c in species_tent(k, 3, 0, TR_NEUTRAL, "h").d.items():
        m.over(x, y, (*c[:3], round(c[3] * HW_GHOST_FADE)))
    for (x, y), c in species_body(k, 3, 0, "g").d.items():
        m.over(x, y, c)
    return m


def data_url(px):
    import base64
    x0, y0, x1, y1 = px.bbox()
    data = png_bytes(x1 - x0 + 1, y1 - y0 + 1, {(x - x0, y - y0): c for (x, y), c in px.d.items()})
    return "data:image/png;base64," + base64.b64encode(data).decode()


journal_art = {}
for k in range(len(SPECIES)):
    port = journal_portrait(k, "h")
    journal_art[str(k)] = data_url(port)
    journal_art[f"{k}m"] = data_url(journal_portrait(k, "m"))
    journal_art[f"{k}g"] = data_url(hw_ghost_portrait(k))  # ---- Halloween event ---- the journal's ghost row
    sil = Px()  # a dark silhouette: the body solid (even glassy ones), strands as they are, a touch firmer
    body = species_body(k, 3, 0, "h")
    for (x, y), c in port.d.items():
        sil.put(x, y, hx("141a33", 255 if body.has(x, y) or c[3] >= 110 else round(70 + c[3])))
    journal_art[f"{k}s"] = data_url(sil)
(ROOT / "src" / "journal-art.json").write_text(json.dumps(journal_art, indent=1))


# ---- home-screen icons (public/manifest.webmanifest): the moon jelly over deep water, whole pixels, inside the
# maskable safe zone (the middle 80%)
def app_icon(size):
    port = journal_portrait(0, "h")
    x0, y0, x1, y1 = port.bbox()
    w, h = x1 - x0 + 1, y1 - y0 + 1
    s = max(1, int(size * 0.62 // max(w, h)))
    ox, oy = (size - w * s) // 2, (size - h * s) // 2
    top, bot = hx("2c82c2"), hx("15264f")
    px = {(x, y): mix(top, bot, y / (size - 1)) for y in range(size) for x in range(size)}
    for (x, y), c in port.d.items():
        a = c[3] / 255
        for dy in range(s):
            for dx in range(s):
                q = (ox + (x - x0) * s + dx, oy + (y - y0) * s + dy)
                b = px[q]
                px[q] = (*(round(c[i] * a + b[i] * (1 - a)) for i in range(3)), 255)
    return png_bytes(size, size, px)


ICON_DIR = ROOT / "public" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    (ICON_DIR / f"jelly-{size}.png").write_bytes(app_icon(size))
total =sum(f.stat().st_size for f in IMG.glob("*.png"))
print(f"wrote tank.rml ({len(doc) // 1024} KB), {len(assets)} images ({total // 1024} KB), {len(_order)} props, {len(anims)} animations")
