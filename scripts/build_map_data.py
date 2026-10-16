#!/usr/bin/env python3
"""
Erzeugt die Kartendaten für die Nasdara-Karte aus Bohemias offiziellen
Central-Economy-Missionsdateien (dayzOffline.nasdara).

Quelle: https://github.com/BohemiaInteractive/DayZ-Central-Economy
Lizenz der Quelldaten: Arma and DayZ Public License Share Alike (ADPL-SA)

Aufruf:
    python3 tools/build_map_data.py <pfad/zu/dayzOffline.nasdara> [--out data]

Benötigt: numpy, pillow
"""
import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date

import numpy as np
from PIL import Image

# Reihenfolge der Bits entspricht cfglimitsdefinition.xml
USAGE_BITS = [
    "Military", "Police", "Medic", "Firefighter", "Industrial", "Farm", "Coast",
    "Town", "Village", "Hunting", "Office", "School", "Prison", "Lunapark",
    "SeasonalEvent", "ContaminatedArea", "Historical", "MilitaryEast", "MilitaryWest",
]
TIER_BITS = ["Tier1", "Tier2", "Tier3", "Tier4", "Unique"]

# Loot-Kategorien der Gebäude (Schlüssel -> Usage-Flags aus mapgroupproto.xml)
BUILDING_LAYERS = {
    "military":    {"Military", "MilitaryEast", "MilitaryWest"},
    "police":      {"Police"},
    "medic":       {"Medic"},
    "firefighter": {"Firefighter"},
    "industrial":  {"Industrial"},
    "farm":        {"Farm"},
    "hunting":     {"Hunting"},
    "town":        {"Town"},
    "village":     {"Village"},
    "office":      {"Office"},
    "school":      {"School"},
    "prison":      {"Prison"},
    "historical":  {"Historical"},
}

# Ereignisse aus cfgeventspawns.xml
EVENT_LAYERS = {
    "heli":        ["StaticHeliCrash"],
    "heli_big":    ["StaticHeliCrashBig"],
    "police_car":  ["StaticPoliceCar"],
    "convoy":      ["StaticMilitaryConvoy"],
    "water_truck": ["StaticWaterTruck"],
    "locked":      ["StaticContainerLocked"],
    "v_olga":      ["VehicleCivilianSedan"],
    "v_sarka":     ["VehicleSedan02"],
    "v_gunter":    ["VehicleHatchback02"],
    "v_ada":       ["VehicleOffroadHatchback"],
    "v_m1025":     ["VehicleOffroad02"],
    "v_truck":     ["VehicleTruck01"],
    "v_moto":      ["VehicleMotorbike"],
}

# Besondere Orte nach Gebäudenamen aus mapgrouppos.xml
NAMED_LAYERS = {
    "fuel":   re.compile(r"FuelStation", re.I),
    "bunker": re.compile(r"^Land_Bunker_", re.I),
}

TERRITORIES = {
    "wolf": "wolf_territories.xml",
    "bear": "bear_territories.xml",
}


def r1(v):
    return int(round(float(v)))


def load_areaflags(path):
    hdr = np.fromfile(path, dtype="<u4", count=6)
    w, h, world_w, world_h = (int(x) for x in hdr[:4])
    raw = np.fromfile(path, dtype=np.uint8, offset=24)
    n = w * h
    usage = raw[: n * 4].view("<u4").reshape(h, w)   # Zeile 0 = Süden (z = 0)
    value = raw[n * 4: n * 5].reshape(h, w)
    return usage, value, world_w / w


def tier_at(value, cell, x, z):
    h, w = value.shape
    row = min(h - 1, max(0, int(z / cell)))
    col = min(w - 1, max(0, int(x / cell)))
    v = int(value[row, col])
    best = 0
    for i in range(4):
        if v & (1 << i):
            best = i + 1
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mission")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--commit", default="")
    args = ap.parse_args()
    m = args.mission
    os.makedirs(args.out, exist_ok=True)

    usage, value, cell = load_areaflags(os.path.join(m, "areaflags.map"))
    world = int(round(cell * value.shape[1]))

    # Usage-Flags je Gebäudetyp
    proto = ET.parse(os.path.join(m, "mapgroupproto.xml")).getroot()
    type_usage = {}
    for g in proto.iter("group"):
        us = {u.get("name") for u in g.findall("usage")}
        if us:
            type_usage[g.get("name")] = us

    pos_root = ET.parse(os.path.join(m, "mapgrouppos.xml")).getroot()
    types, type_index = [], {}
    layers = {k: [] for k in list(BUILDING_LAYERS) + list(NAMED_LAYERS)}
    all_buildings = []
    for g in pos_root.iter("group"):
        name = g.get("name")
        x, _, z = (float(v) for v in g.get("pos").split())
        all_buildings.append((x, z))
        us = type_usage.get(name, set())
        hits = [k for k, flags in BUILDING_LAYERS.items() if us & flags]
        hits += [k for k, rx in NAMED_LAYERS.items() if rx.search(name)]
        if not hits:
            continue
        if name not in type_index:
            type_index[name] = len(types)
            types.append(name)
        rec = [r1(x), r1(z), type_index[name], tier_at(value, cell, x, z)]
        for k in hits:
            layers[k].append(rec)

    # Ereignisse
    ev_root = ET.parse(os.path.join(m, "cfgeventspawns.xml")).getroot()
    events = {e.get("name"): e for e in ev_root.findall("event")}
    for key, names in EVENT_LAYERS.items():
        pts = []
        for n in names:
            e = events.get(n)
            if e is None:
                continue
            for p in e.iter("pos"):
                x, z = float(p.get("x")), float(p.get("z"))
                rec = [r1(x), r1(z), -1, tier_at(value, cell, x, z)]
                if p.get("group"):
                    rec.append(p.get("group"))
                pts.append(rec)
        layers[key] = pts

    # Spieler-Spawns (Zentren der Spawn-Bereiche für frische Charaktere)
    sp_root = ET.parse(os.path.join(m, "cfgplayerspawnpoints.xml")).getroot()
    fresh = sp_root.find("fresh")
    layers["spawn"] = [[r1(p.get("x")), r1(p.get("z")), -1, 0]
                       for p in fresh.find("generator_posbubbles").iter("pos")]

    # Funk-Bunker (Morsecode-Sender)
    with open(os.path.join(m, "cfgbunkerbroadcast.json"), encoding="utf-8") as f:
        bb = json.load(f)
    layers["radio_bunker"] = [[r1(p["position"][0]), r1(p["position"][2]), -1, 0] for p in bb.get("proxies", [])]

    # Kreisförmige Zonen
    circles = {}
    with open(os.path.join(m, "cfgeffectarea.json"), encoding="utf-8") as f:
        ea = json.load(f)
    circles["gas"] = [[r1(a["Data"]["Pos"][0]), r1(a["Data"]["Pos"][2]), r1(a["Data"]["Radius"]), a["AreaName"]]
                      for a in ea.get("Areas", []) if "Contaminated" in a.get("Type", "")]
    layers["oil_pit"] = [[r1(a["Data"]["Pos"][0]), r1(a["Data"]["Pos"][2]), -1, 0, a["AreaName"]]
                         for a in ea.get("Areas", []) if a.get("Type") == "OilPitArea"]
    for key, fn in TERRITORIES.items():
        root = ET.parse(os.path.join(m, "env", fn)).getroot()
        circles[key] = [[r1(z.get("x")), r1(z.get("z")), r1(z.get("r")), z.get("name")]
                        for z in root.iter("zone")]

    data = {
        "meta": {
            "map": "Nasdara",
            "world": world,
            "source": "BohemiaInteractive/DayZ-Central-Economy · dayzOffline.nasdara",
            "commit": args.commit,
            "license": "ADPL-SA",
            "generated": date.today().isoformat(),
        },
        "types": types,
        "layers": layers,
        "circles": circles,
    }
    with open(os.path.join(args.out, "nasdara.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)

    # Grundkarte: Tier-Zonen + Gebäude, 1 Pixel = 4 m
    tier = np.zeros(value.shape, dtype=np.uint8)
    for i in range(4):
        tier = np.where(value & (1 << i), i + 1, tier)
    img = tier.copy()                               # Index 0..4 = Tier
    mil = (usage & ((1 << 0) | (1 << 17) | (1 << 18))) != 0
    img = np.where(mil & (img > 0), img + 5, img)   # Index 6..9 = Tier mit Militärnutzung
    h, w = img.shape
    bmask = np.zeros_like(img, dtype=bool)
    for x, z in all_buildings:
        c, r = int(x / cell), int(z / cell)
        bmask[max(0, r - 1):min(h, r + 2), max(0, c - 1):min(w, c + 2)] = True
    img = np.where(bmask, 10, img)
    img = img[::-1]                                  # Bildzeile 0 = Norden

    palette = [
        (236, 226, 204),  # 0 ohne Tier
        (231, 219, 193),  # 1 Tier 1
        (221, 201, 160),  # 2 Tier 2
        (204, 172, 120),  # 3 Tier 3
        (178, 132, 82),   # 4 Tier 4
        (0, 0, 0),        # 5 frei
        (214, 207, 180),  # 6 Tier 1 militärisch
        (201, 190, 150),  # 7 Tier 2 militärisch
        (183, 165, 113),  # 8 Tier 3 militärisch
        (158, 128, 80),   # 9 Tier 4 militärisch
        (92, 72, 52),     # 10 Gebäude
    ]
    flat = [c for rgb in palette for c in rgb] + [0] * (768 - 3 * len(palette))
    pim = Image.fromarray(img.astype(np.uint8), mode="P")
    pim.putpalette(flat)
    pim.save(os.path.join(args.out, "nasdara-base.png"), optimize=True)

    counts = {k: len(v) for k, v in layers.items()}
    counts.update({"circle:" + k: len(v) for k, v in circles.items()})
    print(json.dumps(counts, indent=1))


if __name__ == "__main__":
    sys.exit(main())
