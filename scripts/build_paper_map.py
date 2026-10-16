#!/usr/bin/env python3
"""
Erzeugt die Papierkarte von Nasdara aus den offenen Central-Economy-Missionsdateien.

Die Karte wird nicht aus dem (verschlüsselten) Terrain gelesen, sondern aus dem,
was in den Missionsdateien offen vorliegt:

- Höhe:     ~200.000 Objekte mit Höhenangabe (Bäume, Wegstücke, Gebäude) aus
            mapgroupcluster*.xml und mapgrouppos.xml werden zu einem Höhenraster
            interpoliert. Dicht belegte Gegenden sind genau, leere Flächen grob.
- Wege:     Wegstücke (Pathdirt*, PathD*) aus mapgroupcluster*.xml mit Position,
            Richtung und Länge werden zu Linien zusammengesetzt.
- Gebäude:  Positionen und Ausrichtung aus mapgrouppos.xml.
- Siedlungen: Gebäudehäufungen werden automatisch erkannt und mit den Ortsnamen
            aus data/places.json beschriftet.

Ergebnis:
    data/paper/{z}/{x}/{y}.webp   Papierkarte: Höhenstufen, Schummerung, Höhenlinien
    data/tiers.png                Tier-Zonen als transparente Ebene
    data/paper.json               Wege, Gebäude, Siedlungen, Höhenpunkte

Aufruf:
    python3 scripts/build_paper_map.py <pfad/zu/dayzOffline.nasdara>

Benötigt: numpy, scipy, scikit-image, pillow
"""
import argparse
import json
import math
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from skimage import measure

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RX = re.compile(r'<group name="([^"]+)" pos="([\d.\-]+) ([\d.\-]+) ([\d.\-]+)"(?: rpy="[^"]*")? a="([\d.\-]+)"')

CELL = 16          # Meter je Zelle des Höhenrasters
TILE = 256
MAX_Z = 3          # Kachel-Ebenen 0..3, Ebene 3 = 4 m je Pixel


def load_objects(mission):
    files = sorted(f for f in os.listdir(mission) if re.match(r"mapgroupcluster\d*\.xml$", f))
    files.append("mapgrouppos.xml")
    objs = []
    for fn in files:
        with open(os.path.join(mission, fn), encoding="utf-8") as f:
            for n, x, y, z, a in RX.findall(f.read()):
                objs.append((n, float(x), float(y), float(z), float(a), fn))
    return objs


# ---------------------------------------------------------------- Höhenraster
def build_heightmap(objs, world):
    n = world // CELL
    pts = np.array([(o[1], o[3], o[2]) for o in objs], dtype=np.float64)
    ix = np.clip((pts[:, 0] // CELL).astype(int), 0, n - 1)
    iz = np.clip((pts[:, 1] // CELL).astype(int), 0, n - 1)

    # Median je Zelle (robust gegen einzelne Ausreißer)
    key = iz * n + ix
    order = np.lexsort((pts[:, 2], key))
    key_s, y_s = key[order], pts[order, 2]
    uniq, start, counts = np.unique(key_s, return_index=True, return_counts=True)
    med = y_s[start + counts // 2]
    H = np.zeros((n, n))
    W = np.zeros((n, n))
    H.flat[uniq] = med
    W.flat[uniq] = 1.0

    # Ausreißer entfernen: Zellen, die stark vom Median der Umgebung abweichen
    num = ndimage.uniform_filter(H * W, 9)
    den = ndimage.uniform_filter(W, 9)
    local = np.divide(num, den, out=np.zeros_like(num), where=den > 0)
    bad = (W > 0) & (np.abs(H - local) > 60)
    W[bad] = 0
    H[bad] = 0

    # Lineare Interpolation zwischen den Messzellen (Dreiecksnetz), danach leicht glätten.
    # Keine "Beulen" um einzelne Punkte, große Lücken werden flach überbrückt.
    from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
    rr, cc = np.nonzero(W)
    vals = H[rr, cc]
    xy = np.column_stack([cc, rr]).astype(float)
    # Kartenrand mit dem Median der Randzone festhalten, damit die Interpolation überall definiert ist
    edge = np.linspace(0, n - 1, 33)
    border = np.array([(e, 0) for e in edge] + [(e, n - 1) for e in edge] + [(0, e) for e in edge] + [(n - 1, e) for e in edge])
    near = NearestNDInterpolator(xy, vals)
    bvals = ndimage.median_filter(near(border), size=5)
    lin = LinearNDInterpolator(np.vstack([xy, border]), np.concatenate([vals, bvals]))
    gx, gz = np.meshgrid(np.arange(n), np.arange(n))
    result = lin(gx, gz)
    result = np.where(np.isnan(result), near(gx, gz), result)
    result = ndimage.gaussian_filter(result, 2.0)

    confidence = np.clip(ndimage.gaussian_filter(W, 6) / 0.05, 0, 1) ** 1.5
    return result, confidence   # Zeile 0 = Süden


# ---------------------------------------------------------------- Wege
def seg_length(name):
    """Länge eines Wegstücks aus dem Modellnamen (z. B. _12, _25, _7100 = 7,5° r100)."""
    m = re.search(r"_(\d+)(k|ko|konec)?$", name)
    if not m:
        return 8.0
    s, suffix = m.group(1), m.group(2)
    if suffix == "k":                      # PathD_11k, PathD_02k
        s = s + "000"
    if s in ("6", "12", "25"):
        return float(s)
    curves = {"1025": (10, 25), "1050": (10, 50), "1075": (10, 75), "10100": (10, 100), "1575": (15, 75),
              "2250": (22.5, 50), "3025": (30, 25), "6010": (60, 10), "7100": (7.5, 100), "11000": (1, 1000),
              "02000": (0.5, 2000)}
    if s in curves:
        deg, r = curves[s]
        return max(4.0, math.radians(deg) * r)
    return 8.0


def road_class(name):
    n = name.lower()
    if n.startswith("pathdirt1"):
        return 1
    if n.startswith("pathdirt2"):
        return 2
    return 3   # pathdirt3 und PathD = schmale Pfade


def build_roads(objs):
    segs = []
    for n, x, y, z, a, fn in objs:
        if not n.lower().startswith("path"):
            continue
        L = seg_length(n)
        r = math.radians(90 - a)       # 'a' in den CE-Dateien = 90° − Kurswinkel
        dx, dz = math.sin(r) * L / 2, math.cos(r) * L / 2
        segs.append((road_class(n), x - dx, z - dz, x + dx, z + dz))
    return chain_segments(segs)


def chain_segments(segs, tol=3.0):
    """Verbindet Segmente, deren Enden sich berühren, zu Linienzügen (je Klasse)."""
    lines = []
    by_class = {}
    for s in segs:
        by_class.setdefault(s[0], []).append(s[1:])
    for cls, items in by_class.items():
        endpoints = {}
        def k(x, z):
            return (round(x / tol), round(z / tol))
        for i, (x1, z1, x2, z2) in enumerate(items):
            endpoints.setdefault(k(x1, z1), []).append((i, 0))
            endpoints.setdefault(k(x2, z2), []).append((i, 1))
        used = [False] * len(items)

        def neighbours(x, z):
            kx, kz = k(x, z)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for e in endpoints.get((kx + dx, kz + dz), ()):
                        yield e

        for i in range(len(items)):
            if used[i]:
                continue
            used[i] = True
            x1, z1, x2, z2 = items[i]
            line = [(x1, z1), (x2, z2)]
            for direction in (1, 0):
                while True:
                    tx, tz = line[-1] if direction else line[0]
                    nxt = None
                    for j, end in neighbours(tx, tz):
                        if used[j]:
                            continue
                        ex, ez = (items[j][0], items[j][1]) if end == 0 else (items[j][2], items[j][3])
                        if (ex - tx) ** 2 + (ez - tz) ** 2 <= (tol * 1.5) ** 2:
                            nxt = (j, end)
                            break
                    if not nxt:
                        break
                    j, end = nxt
                    used[j] = True
                    a = (items[j][0], items[j][1])
                    b = (items[j][2], items[j][3])
                    far = b if end == 0 else a
                    if direction:
                        line.append(far)
                    else:
                        line.insert(0, far)
            lines.append((cls, simplify(line, 1.5)))
    return lines


def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    a = np.array(pts)
    keep = np.zeros(len(a), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        d = q - p
        nrm = math.hypot(*d) or 1e-9
        v = a[i + 1:j] - p
        dist = np.abs(d[0] * v[:, 1] - d[1] * v[:, 0]) / nrm
        m = int(np.argmax(dist))
        if dist[m] > eps:
            keep[i + 1 + m] = True
            stack += [(i, i + 1 + m), (i + 1 + m, j)]
    return [tuple(x) for x in a[keep]]


# ---------------------------------------------------------------- Siedlungen
def find_settlements(objs, world):
    blds = np.array([(o[1], o[3]) for o in objs
                     if o[5] == "mapgrouppos.xml" and not re.search(r"Wreck|Misc_|Container_1|Tent|Pallet|Crate|Bag", o[0])])
    n = world // 50
    grid = np.zeros((n, n))
    np.add.at(grid, (np.clip((blds[:, 1] // 50).astype(int), 0, n - 1),
                     np.clip((blds[:, 0] // 50).astype(int), 0, n - 1)), 1)
    dens = ndimage.gaussian_filter(grid, 2.0)
    mask = dens > 0.35
    lab, cnt = ndimage.label(mask)
    out = []
    for i in range(1, cnt + 1):
        cells = np.argwhere(lab == i)
        rmin, cmin = cells.min(0)
        rmax, cmax = cells.max(0)
        sel = (blds[:, 0] >= cmin * 50) & (blds[:, 0] < (cmax + 1) * 50) & (blds[:, 1] >= rmin * 50) & (blds[:, 1] < (rmax + 1) * 50)
        sel &= lab[np.clip((blds[:, 1] // 50).astype(int), 0, n - 1), np.clip((blds[:, 0] // 50).astype(int), 0, n - 1)] == i
        count = int(sel.sum())
        if count < 12:
            continue
        cx, cz = blds[sel].mean(0)
        out.append({"x": round(cx), "z": round(cz), "buildings": count})
    out.sort(key=lambda s: -s["buildings"])
    return out


# ---------------------------------------------------------------- Rendering
PALETTE = {
    "paper": (238, 230, 210),
    "low": (232, 222, 196),
    "high": (205, 186, 150),
    "contour": (150, 112, 70),
    "contour_idx": (122, 84, 46),
}


def render_base(height, conf, world):
    """Gelände bei 4 m/px: Höhenstufen, Schummerung, Höhenlinien."""
    px = world // 4
    zoom = CELL / 4
    h = ndimage.zoom(height, zoom, order=3)[:px, :px]
    c = ndimage.zoom(conf, zoom, order=1)[:px, :px]
    h = h[::-1]          # Bildzeile 0 = Norden
    c = c[::-1]

    lo, hi = np.percentile(h, [2, 99.5])
    t = np.clip((h - lo) / (hi - lo), 0, 1) ** 0.8
    low, high = np.array(PALETTE["low"]), np.array(PALETTE["high"])
    base = low[None, None, :] * (1 - t[..., None]) + high[None, None, :] * t[..., None]

    # Schummerung (Licht von Nordwest)
    gy, gx = np.gradient(h, 4.0)
    slope = np.arctan(np.hypot(gx, gy) * 1.25)
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(42)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    flat = np.sin(alt)
    rel = (shade - flat) * c
    paper = np.array(PALETTE["paper"])[None, None, :]
    base = paper * (1 - c[..., None] * 0.85) + base * (c[..., None] * 0.85)
    img = base * (1 + rel[..., None] * 0.7)
    img = np.clip(img, 0, 255).astype(np.uint8)
    im = Image.fromarray(img, "RGB")

    # Höhenlinien
    d = ImageDraw.Draw(im, "RGBA")
    step = 20
    levels = np.arange(math.ceil(h.min() / step) * step, h.max(), step)
    hs = ndimage.gaussian_filter(h, 2)
    for lv in levels:
        idx = int(round(lv)) % 100 == 0
        for cont in measure.find_contours(hs, lv):
            if len(cont) < 12:
                continue
            ys, xs = cont[:, 0], cont[:, 1]
            cc = c[np.clip(ys.astype(int), 0, px - 1), np.clip(xs.astype(int), 0, px - 1)]
            # nur dort zeichnen, wo die Höhe gut belegt ist
            run = []
            for (yy, xx), ok in zip(cont, cc > 0.35):
                if ok:
                    run.append((xx, yy))
                elif len(run) > 4:
                    draw_line(d, run, idx)
                    run = []
                else:
                    run = []
            if len(run) > 4:
                draw_line(d, run, idx)
    return im, h


def draw_line(d, pts, idx):
    col = PALETTE["contour_idx"] + ((150,) if idx else (90,))
    d.line(pts, fill=col, width=2 if idx else 1)


# ---------------------------------------------------------------- Tier-Zonen
TIER_COLORS = {1: (46, 160, 67), 2: (232, 196, 46), 3: (236, 124, 34), 4: (208, 42, 42)}


def render_tiers(mission, world, out_path, alpha=105):
    """Transparente Ebene: Tier 1 grün bis Tier 4 rot, Militärgebiete schraffiert."""
    path = os.path.join(mission, "areaflags.map")
    hdr = np.fromfile(path, dtype="<u4", count=6)
    w, hgt = int(hdr[0]), int(hdr[1])
    raw = np.fromfile(path, dtype=np.uint8, offset=24)
    n = w * hgt
    usage = raw[: n * 4].view("<u4").reshape(hgt, w)[::-1]
    value = raw[n * 4: n * 5].reshape(hgt, w)[::-1]
    tier = np.zeros((hgt, w), np.uint8)
    for i in range(4):
        tier = np.where(value & (1 << i), i + 1, tier)
    mil = (usage & ((1 << 0) | (1 << 17) | (1 << 18))) != 0
    yy, xx = np.mgrid[0:hgt, 0:w]
    hatch = ((xx + yy) % 10) < 2
    idx = tier.copy()                        # 0 = durchsichtig, 1..4 Tier
    idx = np.where(mil & hatch & (tier > 0), tier + 4, idx)   # 5..8 = Schraffur
    pal = [0, 0, 0]
    trans = [0]
    for t in range(1, 5):
        pal += list(TIER_COLORS[t]); trans.append(alpha)
    for t in range(1, 5):
        pal += [int(c * 0.45) for c in TIER_COLORS[t]]; trans.append(210)
    im = Image.fromarray(idx.astype(np.uint8), "P")
    im.putpalette(pal + [0] * (768 - len(pal)))
    im.save(out_path, transparency=bytes(trans), optimize=True)


def write_tiles(im, out_dir):
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    size = im.size[0]
    count = 0
    for z in range(MAX_Z + 1):
        n = 2 ** z
        scaled = im.resize((TILE * n, TILE * n), Image.LANCZOS) if TILE * n != size else im
        for x in range(n):
            os.makedirs(os.path.join(out_dir, str(z), str(x)), exist_ok=True)
            for y in range(n):
                tile = scaled.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE))
                tile.save(os.path.join(out_dir, str(z), str(x), f"{y}.webp"), "WEBP", quality=82, method=6)
                count += 1
    return count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mission")
    ap.add_argument("--preview", help="Vorschaubild schreiben")
    args = ap.parse_args()

    with open(os.path.join(ROOT, "data", "nasdara.json"), encoding="utf-8") as f:
        world = json.load(f)["meta"]["world"]

    objs = load_objects(args.mission)
    print("Objekte:", len(objs))
    height, conf = build_heightmap(objs, world)
    print("Höhe:", round(float(height.min())), "bis", round(float(height.max())), "m")
    roads = build_roads(objs)
    print("Wege:", len(roads), "Linienzüge")
    settlements = find_settlements(objs, world)
    print("Siedlungen:", len(settlements))

    im, h4 = render_base(height, conf, world)
    tiles = write_tiles(im, os.path.join(ROOT, "data", "paper"))
    print("Kacheln Papierkarte:", tiles)
    render_tiers(args.mission, world, os.path.join(ROOT, "data", "tiers.png"))
    if args.preview:
        im.resize((2048, 2048), Image.LANCZOS).save(args.preview)

    buildings = [[round(o[1]), round(o[3]), round(90 - o[4]) % 360] for o in objs
                 if o[5] == "mapgrouppos.xml" and not re.search(r"Wreck|Misc_|Pallet|Crate|Bag", o[0])]

    # Höhenpunkte: markante Gipfel aus dem Raster (nur gut belegte Stellen)
    peaks = []
    hmax = ndimage.maximum_filter(height, size=int(1200 / CELL))
    cand = np.argwhere((height == hmax) & (conf > 0.5))
    for r, c in cand:
        peaks.append([int(c * CELL + CELL / 2), int(r * CELL + CELL / 2), int(round(height[r, c]))])
    peaks.sort(key=lambda p: -p[2])

    out = {
        "roads": [[cls, [[round(x, 1), round(z, 1)] for x, z in pts]] for cls, pts in roads],
        "buildings": buildings,
        "settlements": settlements,
        "peaks": peaks[:120],
        "tiles": {"maxZoom": MAX_Z, "tileSize": TILE, "metersPerPixelAtMax": 4},
    }
    with open(os.path.join(ROOT, "data", "paper.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print("paper.json:", os.path.getsize(os.path.join(ROOT, "data", "paper.json")) // 1024, "KB")

    # Höhe als kleines Raster für die Höhenanzeige unter dem Mauszeiger (64 m je Pixel).
    # Kodierung: Wert = Höhe in halben Metern, R = Wert >> 8, G = Wert & 255
    hs = ndimage.zoom(height, CELL / 64, order=1)[::-1]
    v = np.clip(np.round(hs * 2), 0, 65535).astype(np.uint32)
    rgb = np.stack([(v >> 8) & 255, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(os.path.join(ROOT, "data", "height64.png"))


if __name__ == "__main__":
    sys.exit(main())
