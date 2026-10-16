#!/usr/bin/env python3
"""
Erzeugt die realistische Geländeansicht und die Daten für die 3D-Ansicht.

Alles wird aus den offenen Missionsdateien berechnet und selbst gezeichnet,
es werden keine Texturen oder Bilder aus dem Spiel oder von anderen Karten verwendet:

- Boden:   prozedurale Texturen für Sand, Dünenrippel, Schotter, Fels an Hängen,
           Gartenerde unter Baumgruppen und festgetretenen Boden in Siedlungen,
           mit Relief aus dem interpolierten Höhenraster.
- Objekte: Bäume (Art und Position) und Gebäude (Position, Ausrichtung, geschätzte
           Grundfläche aus den Loot-Punkten in mapgroupproto.xml) für die Darstellung
           im Browser und in 3D.

Ergebnis:
    data/real/{z}/{x}/{y}.webp   Bodenkacheln, Ebene 5 = 2 m je Pixel
    data/objects.json            Bäume und Gebäude
    data/height16.png            Höhenraster 16 m für 3D (Wert = Höhe·4, R = hi, G = lo)

Aufruf:
    python3 scripts/build_realistic.py <pfad/zu/dayzOffline.nasdara>
"""
import argparse
import json
import math
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_paper_map as bpm  # noqa: E402

ROOT = bpm.ROOT
TILE = 256
MAX_Z = 5                 # Ebene 5 = 2 m je Pixel
FIELD = 4                 # Auflösung der Hilfsfelder in Metern


# ---------------------------------------------------------------- Rauschen ohne Kachelkanten
def _hash(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(np.float32) / 65535.0


def value_noise(X, Y, scale, seed):
    gx, gy = X / scale, Y / scale
    ix, iy = np.floor(gx), np.floor(gy)
    fx, fy = gx - ix, gy - iy
    ix, iy = ix.astype(np.int64), iy.astype(np.int64)
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(X, Y, scale, seed, octaves=4):
    out = np.zeros_like(X, dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(X, Y, scale / (2 ** o), seed + o * 17)
        tot += amp
        amp *= 0.5
    return out / tot


# ---------------------------------------------------------------- Objekte
TREE_KINDS = [
    ("fig_s", re.compile(r"^FigTree1$")),
    ("fig_m", re.compile(r"^FigTree2$")),
    ("fig_l", re.compile(r"^FigTree3$")),
    ("conifer", re.compile(r"^(PiceaAbies_[23]d|PinusSylvestris)")),
    ("broadleaf", re.compile(r"^FagusSylvatica_[23]d")),
    ("stump", re.compile(r"stump", re.I)),
    ("log", re.compile(r"fallen", re.I)),
    ("hay", re.compile(r"^(Haybale|HaybaleDecayed|Strawstack|Manurepile)$")),
]
STANDING = {"fig_s", "fig_m", "fig_l", "conifer", "broadleaf"}


def material_of(name):
    n = name.lower()
    if "wreck" in n:
        return "wreck"
    if "tent" in n:
        return "tent"
    if "container" in n or "slum" in n or "shed_m" in n or "workshop" in n or "garage" in n:
        return "metal"
    if "shed_w" in n or "wooden" in n:
        return "wood"
    if re.search(r"house_\d+m", n) or "mud" in n or "bazaar" in n:
        return "mud"
    if "mil_" in n or "barrack" in n or "bunker" in n or "hbarrier" in n or "tower" in n:
        return "military"
    return "stone"


def building_types(mission):
    """Grundfläche je Gebäudetyp aus der Ausdehnung der Loot-Punkte, mit Rand."""
    t = ET.parse(os.path.join(mission, "mapgroupproto.xml")).getroot()
    out = {}
    for g in t.iter("group"):
        pts = np.array([[float(v) for v in p.get("pos").split()] for p in g.iter("point")])
        if len(pts) == 0:
            continue
        x0, x1 = pts[:, 0].min(), pts[:, 0].max()
        z0, z1 = pts[:, 2].min(), pts[:, 2].max()
        floors = max(1, int(round((pts[:, 1].max() - pts[:, 1].min()) / 3.0)) + 1)
        out[g.get("name")] = (max(3.0, x1 - x0 + 3.0), max(3.0, z1 - z0 + 3.0),
                              (x0 + x1) / 2, (z0 + z1) / 2, floors)
    return out


def build_objects(objs, mission):
    btypes = building_types(mission)
    trees = []
    kinds = [k for k, _ in TREE_KINDS]
    for n, x, y, z, a, fn in objs:
        if fn == "mapgrouppos.xml" or n.lower().startswith("path"):
            continue
        for i, (k, rx) in enumerate(TREE_KINDS):
            if rx.search(n):
                yaw = (90 - a) % 360
                trees += [round(x, 1), round(z, 1), i, int(yaw)]
                break

    types, tindex, houses = [], {}, []
    for n, x, y, z, a, fn in objs:
        if fn != "mapgrouppos.xml" or re.search(r"Misc_|Pallet|Crate|Bag", n):
            continue
        mat = material_of(n)
        if n in btypes:
            w, l, cx, cz, floors = btypes[n]
        elif mat == "wreck":
            w, l, cx, cz, floors = (4.6 if "truck" not in n.lower() else 7.5), 2.0, 0, 0, 1
            w, l = l, w
        else:
            w, l, cx, cz, floors = 7.0, 7.0, 0, 0, 1
        if mat == "wreck":
            w, l = (2.2, 7.5) if "truck" in n.lower() or "trailer" in n.lower() else (2.0, 4.6)
            cx = cz = 0
            floors = 0
        key = (round(w, 1), round(l, 1), floors, mat)
        if key not in tindex:
            tindex[key] = len(types)
            types.append([key[0], key[1], floors, mat])
        yaw = (90 - a) % 360
        r = math.radians(yaw)
        # Mittelpunkt der Loot-Punkte ist nicht immer der Modellursprung
        ox = cx * math.cos(r) + cz * math.sin(r)
        oz = -cx * math.sin(r) + cz * math.cos(r)
        houses += [round(x + ox, 1), round(z + oz, 1), int(yaw), tindex[key]]
    return {"treeKinds": kinds, "trees": trees, "houseTypes": types, "houses": houses}


# ---------------------------------------------------------------- Hilfsfelder
def build_fields(height, conf, objs, world):
    n = world // FIELD
    z = bpm.CELL / FIELD
    h = ndimage.zoom(height, z, order=3)[:n, :n].astype(np.float32)       # Zeile 0 = Süden
    c = ndimage.zoom(conf, z, order=1)[:n, :n].astype(np.float32)
    gy, gx = np.gradient(h, float(FIELD))
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)

    def density(points, sigma):
        g = np.zeros((n, n), np.float32)
        if len(points):
            p = np.array(points)
            np.add.at(g, (np.clip((p[:, 1] // FIELD).astype(int), 0, n - 1),
                          np.clip((p[:, 0] // FIELD).astype(int), 0, n - 1)), 1)
        return ndimage.gaussian_filter(g, sigma)

    standing = [(o[1], o[3]) for o in objs if re.match(r"FigTree|PiceaAbies_[23]d|FagusSylvatica_[23]d|Pinus", o[0])]
    veg = np.clip(density(standing, 2.5) * 14, 0, 1)
    orchard = np.clip(density(standing, 7) * 40, 0, 1)
    houses = [(o[1], o[3]) for o in objs if o[5] == "mapgrouppos.xml" and "Wreck" not in o[0]]
    settle = np.clip(density(houses, 6) * 25, 0, 1)

    # Relief
    az, alt = math.radians(315), math.radians(38)
    sl = np.arctan(np.hypot(gx, gy) * 1.5)
    asp = np.arctan2(-gx, gy)
    shade = np.clip(np.sin(alt) * np.cos(sl) + np.cos(alt) * np.sin(sl) * np.cos(az - asp), 0, 1)
    rel = ((shade - np.sin(alt)) * (0.35 + 0.65 * c)).astype(np.float32)
    lo, hi = np.percentile(h, [2, 99])
    alt_t = np.clip((h - lo) / (hi - lo), 0, 1).astype(np.float32)
    return {"h": h, "slope": slope, "veg": veg.astype(np.float32), "orchard": orchard.astype(np.float32),
            "settle": settle.astype(np.float32), "rel": rel, "alt": alt_t, "conf": c}


def sample(field, X, Y):
    """Bilineares Abtasten eines 4-m-Feldes an Weltkoordinaten (Meter)."""
    n = field.shape[0]
    fx = np.clip(X / FIELD - 0.5, 0, n - 1.001)
    fy = np.clip(Y / FIELD - 0.5, 0, n - 1.001)
    return ndimage.map_coordinates(field, [fy.ravel(), fx.ravel()], order=1).reshape(X.shape)


C = {
    "sand_l": np.array([226, 205, 165], np.float32),
    "sand_d": np.array([200, 168, 120], np.float32),
    "ochre": np.array([188, 150, 102], np.float32),
    "gravel": np.array([170, 158, 138], np.float32),
    "rock_l": np.array([158, 142, 122], np.float32),
    "rock_d": np.array([112, 96, 80], np.float32),
    "soil": np.array([142, 116, 82], np.float32),
    "grass": np.array([124, 122, 74], np.float32),
    "yard": np.array([206, 190, 160], np.float32),
}


def render_tile(F, tx, ty, world):
    """Eine Kachel der Ebene MAX_Z (2 m/px). tx/ty wie in den Kachel-URLs, ty = 0 im Norden."""
    mpp = world / (TILE * 2 ** MAX_Z)
    xs = (tx * TILE + np.arange(TILE) + 0.5) * mpp
    ys = world - (ty * TILE + np.arange(TILE) + 0.5) * mpp
    X, Y = np.meshgrid(xs.astype(np.float32), ys.astype(np.float32))

    slope = sample(F["slope"], X, Y)
    veg = sample(F["veg"], X, Y)
    orch = sample(F["orchard"], X, Y)
    settle = sample(F["settle"], X, Y)
    rel = sample(F["rel"], X, Y)
    alt = sample(F["alt"], X, Y)
    h = sample(F["h"], X, Y)

    big = fbm(X, Y, 900, 1, 3)
    mid = fbm(X, Y, 120, 2, 3)
    fine = fbm(X, Y, 14, 3, 3)
    grain = value_noise(X, Y, 2.2, 4)

    # Sand mit großen, weichen Farbflächen
    t = np.clip(big * 1.1 + (mid - 0.5) * 0.35 - 0.3, 0, 1)[..., None]
    col = C["sand_l"] * (1 - t) + C["sand_d"] * t
    o = np.clip((fbm(X, Y, 350, 9, 3) - 0.55) * 1.6, 0, 0.45)[..., None]
    col = col * (1 - o) + C["ochre"] * o

    # Flache Dünenrippel im offenen Gelände
    ang = 0.6 + (big - 0.5) * 0.8
    warp = fbm(X, Y, 70, 5, 2) * 10
    rip = np.sin((X * np.cos(ang) + Y * np.sin(ang)) / 9.0 + warp)
    flat = np.clip(1 - slope / 4, 0, 1) * (1 - np.clip(veg + settle, 0, 1)) * np.clip(1 - alt * 1.5, 0, 1)
    col = col * (1 + (rip * 0.022 * flat)[..., None])

    # Schotter in höheren Lagen: weicher Farbwechsel plus Steinchen
    g = np.clip(alt * 1.1 - 0.2, 0, 0.6)[..., None] * (0.7 + mid[..., None] * 0.6)
    col = col * (1 - g) + C["gravel"] * g
    pebble = _hash(np.floor(X / 2).astype(np.int64), np.floor(Y / 2).astype(np.int64), 21)
    peb_amt = (0.25 + alt * 0.75)
    col = col * (1 - ((pebble > 0.9) * 0.12 * peb_amt)[..., None]) * (1 + ((pebble < 0.06) * 0.06 * peb_amt)[..., None])

    # Fels an steilen Hängen: unregelmäßige Schichten, Risse, gedämpfte Farben
    rock = np.clip((slope - 17 + (mid - 0.5) * 12) / 16, 0, 1) * 0.9
    warp2 = fbm(X, Y, 90, 7, 3)
    strata = 0.5 + 0.5 * np.sin(h / 5.0 + warp2 * 9)
    rc = C["rock_l"] * (1 - strata[..., None] * 0.35) + C["rock_d"] * (strata[..., None] * 0.35)
    rc = rc * (0.88 + fine[..., None] * 0.24)
    crack = np.clip(1 - np.abs(fbm(X, Y, 28, 8, 2) - 0.5) / 0.035, 0, 1)
    rc = rc * (1 - crack[..., None] * 0.25)
    col = col * (1 - rock[..., None]) + rc * rock[..., None]

    # Gartenerde und trockenes Gras um Baumgruppen
    soil = np.clip(orch * 1.1 + veg * 0.5, 0, 1) * np.clip(1 - rock, 0, 1)
    sc = C["soil"] * (1 - fine[..., None] * 0.4) + C["grass"] * (fine[..., None] * 0.4)
    soil = soil * (0.55 + 0.45 * value_noise(X, Y, 6, 41))
    col = col * (1 - soil[..., None] * 0.45) + sc * (soil[..., None] * 0.45)

    # Vereinzelte Dornbüsche im Halbwüstengürtel
    shrub_p = 0.004 + 0.02 * np.clip(veg * 2 + (1 - flat) * 0.3, 0, 1) * (1 - rock)
    shrub = _hash(np.floor(X / 2).astype(np.int64), np.floor(Y / 2).astype(np.int64), 33) < shrub_p
    col = np.where(shrub[..., None], col * 0.62 + np.array([60, 62, 36], np.float32) * 0.38, col)

    # Festgetretener Boden in Siedlungen
    st = (settle * 0.55)[..., None]
    col = col * (1 - st) + C["yard"] * st * (0.95 + grain[..., None] * 0.1)

    # Relief und Körnung
    col = col * (1 + np.clip(rel * 0.9, -0.28, 0.18)[..., None])
    col = col * (0.96 + grain[..., None] * 0.08)
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")


def write_pyramid(F, world, out_dir, quality=78):
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    n = 2 ** MAX_Z
    level = {}
    for tx in range(n):
        os.makedirs(os.path.join(out_dir, str(MAX_Z), str(tx)), exist_ok=True)
        for ty in range(n):
            im = render_tile(F, tx, ty, world)
            im.save(os.path.join(out_dir, str(MAX_Z), str(tx), f"{ty}.webp"), "WEBP", quality=quality, method=5)
            level[(tx, ty)] = im
        print(f"  Spalte {tx + 1}/{n}", end="\r", flush=True)
    print()
    for z in range(MAX_Z - 1, -1, -1):
        m = 2 ** z
        nxt = {}
        for tx in range(m):
            os.makedirs(os.path.join(out_dir, str(z), str(tx)), exist_ok=True)
            for ty in range(m):
                mosaic = Image.new("RGB", (TILE * 2, TILE * 2))
                for dx in range(2):
                    for dy in range(2):
                        mosaic.paste(level[(tx * 2 + dx, ty * 2 + dy)], (dx * TILE, dy * TILE))
                im = mosaic.resize((TILE, TILE), Image.LANCZOS)
                im.save(os.path.join(out_dir, str(z), str(tx), f"{ty}.webp"), "WEBP", quality=quality + 4, method=5)
                nxt[(tx, ty)] = im
        level = nxt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mission")
    ap.add_argument("--preview-tile", help="nur eine Kachel rendern: z/x/y, als Vorschau speichern")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    with open(os.path.join(ROOT, "data", "nasdara.json"), encoding="utf-8") as f:
        world = json.load(f)["meta"]["world"]
    objs = bpm.load_objects(args.mission)
    height, conf = bpm.build_heightmap(objs, world)
    F = build_fields(height, conf, objs, world)

    if args.preview_tile:
        z, x, y = (int(v) for v in args.preview_tile.split("/"))
        assert z == MAX_Z
        render_tile(F, x, y, world).save(args.out)
        return

    data = build_objects(objs, args.mission)
    with open(os.path.join(ROOT, "data", "objects.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print("Bäume:", len(data["trees"]) // 4, " Gebäude:", len(data["houses"]) // 4,
          " objects.json:", os.path.getsize(os.path.join(ROOT, "data", "objects.json")) // 1024, "KB")

    # Höhenraster 16 m für 3D, Zeile 0 = Norden
    v = np.clip(np.round(height[::-1] * 4), 0, 65535).astype(np.uint32)
    rgb = np.stack([(v >> 8) & 255, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(os.path.join(ROOT, "data", "height16.png"))

    write_pyramid(F, world, os.path.join(ROOT, "data", "real"))
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(ROOT, "data", "real")) for f in fs)
    print("Bodenkacheln:", size // (1024 * 1024), "MB")


if __name__ == "__main__":
    sys.exit(main())
