(function () {
  "use strict";

  const CFG = window.MAP_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const KEYS = {
    layers: "nasdara.layers.v1",
    tier: "nasdara.tier.v1",
    grid: "nasdara.grid.v1",
    overlay: "nasdara.overlay.v1",
    open: "nasdara.open.v1",
    markers: "nasdara.markers.v1",
    style: "nasdara.style.v1",
    base: "nasdara.base.v1",
    me: "nasdara.me.v1",
    name: "nasdara.name.v1",
    color: "nasdara.color.v1",
    lastRoom: "nasdara.lastroom.v1",
    drawings: "nasdara.drawings.v1",
    shape: "nasdara.shape.v1",
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat-Modus */ } },
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Math.round(n).toLocaleString("de-DE");
  const coordText = (x, z) => `${Math.round(x)} / ${Math.round(z)}`;

  // Ebenen-Definitionen nachschlagbar machen
  const defs = {};
  CFG.groups.forEach((g) => g.layers.forEach((l) => { l.group = g.id; defs[l.id] = l; }));

  let data, W, map, bounds, paper = null, places = [], heightGrid = null;
  let tierMin = store.get(KEYS.tier, 0);
  const savedLayers = store.get(KEYS.layers, {});
  const active = {};
  Object.values(defs).forEach((d) => { active[d.id] = d.id in savedLayers ? !!savedLayers[d.id] : !!d.on; });

  const items = {};        // id -> [{rec, obj}]
  const groupsLL = {};     // id -> L.LayerGroup
  const buildingCats = new Map();
  let dotRenderer, zoneRenderer, gridLayer, overlayLayer, gridLevel = -1;

  // ---------- Symbole ----------
  function symHtml(def, extraClass = "") {
    const glyph = def.style === "box" || def.style === "round" ? esc(def.glyph || "") : "";
    return `<span class="sym ${def.style} ${extraClass}" style="--c:${def.color}">${glyph}</span>`;
  }
  const iconCache = {};
  function iconFor(def) {
    if (!iconCache[def.id]) {
      const size = def.style === "ring" ? 26 : 24;
      iconCache[def.id] = L.divIcon({ className: "mk", html: symHtml(def), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }
    return iconCache[def.id];
  }
  const typeOf = (id) => CFG.markerTypes.find((t) => t.id === id) || CFG.markerTypes[CFG.markerTypes.length - 1];
  function mineIcon(m) {
    return L.divIcon({
      className: "mk mk-mine",
      html: `<span class="sym mine"><span>${esc(typeOf(m.type).glyph)}</span></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 29],
      popupAnchor: [0, -26],
    });
  }

  // ---------- Daten laden ----------
  const getJson = (u, optional) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch((e) => { if (optional) return null; throw e; });
  Promise.all([getJson(CFG.dataUrl), getJson(CFG.paperDataUrl, true), getJson(CFG.placesUrl, true)])
    .then(([d, p, pl]) => { data = d; paper = p; places = (pl && pl.places) || []; init(); })
    .catch(() => {
      document.body.insertAdjacentHTML("beforeend",
        '<div class="toast" style="top:40%;bottom:auto">Die Kartendaten konnten nicht geladen werden. Öffne die Seite über einen Webserver (z. B. GitHub Pages), nicht direkt als Datei.</div>');
    });

  function init() {
    W = data.meta.world;
    bounds = L.latLngBounds([0, 0], [W, W]);

    map = L.map("map", {
      crs: L.CRS.Simple,
      minZoom: -6,
      maxZoom: 3,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      zoomControl: false,
      attributionControl: false,
      boxZoom: false,
      tapHold: true,
    });
    map.createPane("tierPane").style.zIndex = 402;
    map.createPane("gridPane").style.zIndex = 405;
    map.createPane("objectPane").style.zIndex = 407;
    map.createPane("zonePane").style.zIndex = 410;
    map.createPane("dotPane").style.zIndex = 420;
    map.createPane("labelPane").style.zIndex = 615;
    map.createPane("drawPane").style.zIndex = 630;
    map.createPane("measurePane").style.zIndex = 640;
    map.createPane("minePane").style.zIndex = 660;

    if (CFG.overlayImage) {
      $("#overlay-row").hidden = false;
      overlayLayer = L.imageOverlay(CFG.overlayImage, bounds, { opacity: 0.92, interactive: false });
      const on = store.get(KEYS.overlay, true);
      $("#opt-overlay").checked = on;
      if (on) overlayLayer.addTo(map);
      $("#opt-overlay").addEventListener("change", (e) => {
        store.set(KEYS.overlay, e.target.checked);
        e.target.checked ? overlayLayer.addTo(map) : overlayLayer.remove();
      });
    }

    dotRenderer = L.canvas({ pane: "dotPane", padding: 0.3, tolerance: 4 });
    zoneRenderer = L.canvas({ pane: "zonePane", padding: 0.3 });

    gridLayer = new GridLayer({ pane: "gridPane", bounds: bounds, tileSize: 256, noWrap: true, updateWhenZooming: false, minZoom: -10, maxZoom: 10 });
    const gridOn = store.get(KEYS.grid, true);
    $("#opt-grid").checked = gridOn;
    if (gridOn) gridLayer.addTo(map);
    $("#opt-grid").addEventListener("change", (e) => {
      store.set(KEYS.grid, e.target.checked);
      e.target.checked ? gridLayer.addTo(map) : gridLayer.remove();
    });

    L.control.scale({ position: "bottomleft", metric: true, imperial: false, maxWidth: 140 }).addTo(map);

    fitInitialView();
    initBasemaps();
    buildLayers();
    renderLegend();
    applyAll();
    initTierSeg();
    initReadout();
    initGoto();
    initTools();
    initMarkers();
    initPanel();
    initDraw();
    initRoom();

    map.on("popupopen", () => { if (mode) map.closePopup(); });
    map.on("zoomend", onZoom);
    map.on("moveend", saveHash);
    window.addEventListener("hashchange", () => {
      const m = /^#(-?[\d.]+)\/(\d+)\/(\d+)$/.exec(location.hash);
      if (m) map.setView([+m[3], +m[2]], +m[1]);
    });
    onZoom();
    loadHeights();

    const c = data.meta.commit ? `, Stand ${esc(data.meta.commit)}` : "";
    $("#data-stamp").innerHTML = `Daten erzeugt am ${new Date(data.meta.generated).toLocaleDateString("de-DE")}${c}.`;
  }


  // ---------- Grundkarten ----------
  let paperBase, realBase, tierLayer, roadCasing, roadFill, roadRenderer, objectLayer, labelLayer, peakLayer;
  let objects = null, objectsLoading = null;
  let style = store.get(KEYS.style, "paper");
  if (style === "loot") style = "paper";
  const baseOpts = Object.assign({ names: true, roads: true, buildings: true, tiers: false }, store.get(KEYS.base, {}));

  // Kachel-Pyramiden: Ebene 0 entspricht Leaflet-Zoom -6, Kachelzeile 0 liegt im Norden
  const PyramidTiles = L.TileLayer.extend({
    getTileUrl(c) {
      const t = c.z + 6;
      return L.Util.template(this._url, { z: t, x: c.x, y: c.y + Math.pow(2, t) });
    },
  });
  const pyramid = (url, maxLevel, cls) => new PyramidTiles(url, {
    tileSize: 256, minZoom: -10, maxZoom: 10, minNativeZoom: -6, maxNativeZoom: maxLevel - 6,
    bounds: bounds, noWrap: true, keepBuffer: 4, className: cls,
  });

  function initBasemaps() {
    if (!paper) { $(".styleswitch").hidden = true; return; }
    paperBase = pyramid(CFG.paperTiles, paper.tiles.maxZoom, "paper-tiles");
    realBase = pyramid(CFG.realTiles, CFG.realMaxLevel, "real-tiles");
    tierLayer = L.imageOverlay(CFG.tiersImage, bounds, { pane: "tierPane", interactive: false, className: "tier-overlay" });
    roadRenderer = L.canvas({ pane: "gridPane", padding: 0.4 });
    buildRoads();
    objectLayer = new ObjectLayer({ pane: "objectPane", bounds: bounds, tileSize: 256, noWrap: true, minZoom: -10, maxZoom: 10, updateWhenZooming: false, keepBuffer: 2 });
    buildLabels();

    $(".styleswitch").addEventListener("click", (e) => {
      const b = e.target.closest("[data-style]");
      if (b) setStyle(b.dataset.style);
      const t = e.target.closest("#tier-toggle");
      if (t) setOpt("tiers", !baseOpts.tiers);
    });
    ["names", "roads", "buildings", "tiers"].forEach((k) => {
      const cb = $("#opt-" + k);
      if (!cb) return;
      cb.checked = baseOpts[k];
      cb.addEventListener("change", () => setOpt(k, cb.checked));
    });
    setStyle(style);
  }

  function setOpt(k, v) {
    baseOpts[k] = v;
    store.set(KEYS.base, baseOpts);
    const cb = $("#opt-" + k);
    if (cb) cb.checked = v;
    applyBase();
  }

  function setStyle(s) {
    style = s;
    store.set(KEYS.style, s);
    document.body.dataset.style = s;
    document.querySelectorAll(".style-btn[data-style]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === s)));
    const base = s === "real" ? realBase : paperBase;
    [paperBase, realBase].forEach((l) => { if (l !== base && map.hasLayer(l)) l.remove(); });
    if (!map.hasLayer(base)) base.addTo(map);
    base.bringToBack();
    restyleRoads();
    if (objectLayer && map.hasLayer(objectLayer)) objectLayer.redraw();
    applyBase();
  }

  function applyBase() {
    if (!map || !paper) return;
    const z = map.getZoom();
    document.body.dataset.tiers = baseOpts.tiers ? "on" : "off";
    $("#tier-toggle").setAttribute("aria-pressed", String(baseOpts.tiers));
    toggle(tierLayer, baseOpts.tiers);
    toggle(labelLayer, baseOpts.names);
    toggle(peakLayer, baseOpts.names && style === "paper" && z >= -3.5);
    toggle(roadCasing, baseOpts.roads);
    toggle(roadFill, baseOpts.roads);
    if (baseOpts.roads && map.hasLayer(roadFill)) roadFill.eachLayer((l) => l.bringToFront());
    const objMin = style === "real" ? -4 : -2.25;
    const wantObjects = baseOpts.buildings && z >= objMin;
    if (wantObjects && !objects) loadObjects();
    toggle(objectLayer, wantObjects && !!objects);
    styleRoads();
  }
  function toggle(layer, on) {
    if (!layer) return;
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) layer.remove();
  }

  // Wege: Papierkarte farbig mit Umrandung, Geländeansicht als staubige Pisten
  const ROAD = {
    paper: {
      1: { casing: "#4A2A12", fill: "#E58A2E", w: 3.6 },
      2: { casing: "#6B4A2A", fill: "#F4E2A8", w: 2.5 },
      3: { casing: null, fill: "#7E5A38", w: 1.3, dash: true },
    },
    real: {
      1: { casing: "rgba(96,78,52,0.45)", fill: "#E2D2AC", w: 3.4 },
      2: { casing: "rgba(96,78,52,0.35)", fill: "#D8C7A0", w: 2.4 },
      3: { casing: null, fill: "rgba(196,176,138,0.85)", w: 1.3 },
    },
  };
  function buildRoads() {
    roadCasing = L.layerGroup();
    roadFill = L.layerGroup();
    const sorted = [...paper.roads].sort((a, b) => b[0] - a[0]);   // Hauptwege zuletzt, also oben
    sorted.forEach(([cls, pts]) => {
      const ll = pts.map(([x, z]) => [z, x]);
      const opts = { renderer: roadRenderer, lineCap: "round", lineJoin: "round", interactive: false, smoothFactor: 1.2 };
      const c = L.polyline(ll, opts); c._cls = cls; roadCasing.addLayer(c);
      const f = L.polyline(ll, opts); f._cls = cls; roadFill.addLayer(f);
    });
  }
  let roadKey = "";
  function restyleRoads() { roadKey = ""; styleRoads(); }
  function styleRoads() {
    if (!roadFill || !map) return;
    const z = map.getZoom();
    const k = Math.max(0.4, Math.min(2.4, 0.6 + (z + 3) * 0.34));
    const key = style + ":" + k.toFixed(2) + ":" + (z < -3.5);
    if (key === roadKey) return;
    roadKey = key;
    const S = ROAD[style] || ROAD.paper;
    const set = (group, casing) => group.eachLayer((l) => {
      const st = S[l._cls] || S[3];
      const hidden = (l._cls === 3 && z < -3.5) || (casing && !st.casing);
      l.setStyle({
        color: casing ? st.casing || "transparent" : st.fill,
        weight: casing ? st.w * k + 2 : st.w * k,
        opacity: hidden ? 0 : 1,
        dashArray: !casing && st.dash && z >= -1.5 ? `${4 * k} ${3 * k}` : null,
      });
    });
    set(roadCasing, true);
    set(roadFill, false);
  }

  // ---------- Bäume und Gebäude ----------
  const BUCKET = 256;
  function loadObjects() {
    if (objectsLoading) return;
    objectsLoading = fetch(CFG.objectsUrl).then((r) => r.json()).then((d) => {
      const nb = Math.ceil(W / BUCKET);
      const buckets = new Map();
      const add = (kind, i, x, z) => {
        const key = Math.min(nb - 1, Math.max(0, Math.floor(x / BUCKET))) * nb + Math.min(nb - 1, Math.max(0, Math.floor(z / BUCKET)));
        let b = buckets.get(key);
        if (!b) { b = { t: [], h: [] }; buckets.set(key, b); }
        b[kind].push(i);
      };
      for (let i = 0; i < d.trees.length; i += 4) add("t", i, d.trees[i], d.trees[i + 1]);
      for (let i = 0; i < d.houses.length; i += 4) add("h", i, d.houses[i], d.houses[i + 1]);
      objects = Object.assign(d, { nb, buckets });
      applyBase();
    }).catch(() => { objectsLoading = null; });
  }

  // Größe der Baumkronen in Metern und Farben je Art
  const TREE = {
    fig_s: { r: 2.1, c: [104, 116, 52] }, fig_m: { r: 2.7, c: [96, 110, 48] }, fig_l: { r: 3.3, c: [88, 102, 44] },
    conifer: { r: 2.6, c: [58, 76, 44] }, broadleaf: { r: 3.6, c: [82, 100, 46] },
  };
  const MAT = {
    mud: [201, 178, 138], stone: [190, 182, 166], metal: [146, 142, 132], wood: [138, 108, 76],
    military: [168, 160, 128], tent: [118, 112, 78], wreck: [150, 150, 150],
  };
  const RUST = [156, 106, 72];
  const CARS = [[226, 226, 220], [70, 96, 140], [196, 120, 50], [120, 130, 92], [150, 40, 36], [200, 190, 120]];
  const rnd = (i) => { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h & 0xffff) / 65535; };
  const rgb = (c, f = 1, a = 1) => `rgba(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)},${a})`;

  const ObjectLayer = L.GridLayer.extend({
    createTile(coords) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      tile.width = size.x * dpr; tile.height = size.y * dpr;
      tile.style.width = size.x + "px"; tile.style.height = size.y + "px";
      if (objects) drawObjects(tile.getContext("2d"), coords, size.x, dpr);
      return tile;
    },
  });

  function drawObjects(ctx, coords, size, dpr) {
    ctx.scale(dpr, dpr);
    const s = Math.pow(2, coords.z);
    const x0 = (coords.x * size) / s, x1 = x0 + size / s;
    const zTop = (-coords.y * size) / s, zBot = zTop - size / s;
    const m = 30;
    const { nb, buckets, trees, houses, houseTypes, treeKinds } = objects;
    const tIdx = [], hIdx = [];
    for (let bx = Math.max(0, Math.floor((x0 - m) / BUCKET)); bx <= Math.min(nb - 1, Math.floor((x1 + m) / BUCKET)); bx++) {
      for (let bz = Math.max(0, Math.floor((zBot - m) / BUCKET)); bz <= Math.min(nb - 1, Math.floor((zTop + m) / BUCKET)); bz++) {
        const b = buckets.get(bx * nb + bz);
        if (b) { tIdx.push(...b.t); hIdx.push(...b.h); }
      }
    }
    const px = (X) => (X - x0) * s, py = (Z) => (zTop - Z) * s;
    const real = style === "real";

    const housePoly = (i, dx = 0, dy = 0) => {
      const [w, l] = houseTypes[houses[i + 3]];
      const r = (houses[i + 2] * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
      const X = houses[i], Z = houses[i + 1];
      ctx.beginPath();
      [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]].forEach(([a, b], k) => {
        const wx = X + a * c + b * n, wz = Z - a * n + b * c;
        const sx = px(wx) + dx, sy = py(wz) + dy;
        k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.closePath();
    };

    if (!real) {
      // Papierkarte: flache Grundrisse, Bäume als Punkte
      ctx.fillStyle = "rgba(108,140,74,0.85)";
      const tr = Math.max(1.2, 2.4 * s);
      for (const i of tIdx) {
        const k = treeKinds[trees[i + 2]];
        if (!TREE[k]) continue;
        ctx.beginPath(); ctx.arc(px(trees[i]), py(trees[i + 1]), tr * (TREE[k].r / 3), 0, 6.283); ctx.fill();
      }
      ctx.fillStyle = "#4E4236";
      for (const i of hIdx) { if (houseTypes[houses[i + 3]][3] === "wreck") continue; housePoly(i); ctx.fill(); }
      return;
    }

    // Schatten (Licht von Nordwest)
    ctx.fillStyle = "rgba(48,34,18,0.26)";
    for (const i of hIdx) {
      const t = houseTypes[houses[i + 3]];
      const hgt = t[3] === "wreck" ? 1.5 : 1.5 + t[2] * 3;
      const off = hgt * 0.55 * s;
      housePoly(i, off, off); ctx.fill();
    }
    if (s >= 0.18) {
      for (const i of tIdx) {
        const k = treeKinds[trees[i + 2]], T = TREE[k];
        if (!T) continue;
        const R = T.r * s;
        ctx.beginPath();
        ctx.ellipse(px(trees[i]) + R * 0.7, py(trees[i + 1]) + R * 0.6, R * 1.05, R * 0.85, 0.6, 0, 6.283);
        ctx.fill();
      }
    }

    // Dächer
    for (const i of hIdx) {
      const t = houseTypes[houses[i + 3]], mat = t[3], v = rnd(i);
      let c = MAT[mat] || MAT.stone;
      if (mat === "metal" && v > 0.55) c = RUST;
      if (mat === "wreck") c = CARS[Math.floor(v * CARS.length)];
      housePoly(i);
      ctx.fillStyle = rgb(c, 0.92 + v * 0.14);
      ctx.fill();
      if (s >= 0.7) {
        ctx.lineWidth = Math.max(0.6, 0.35 * s);
        ctx.strokeStyle = rgb(c, 0.66);
        ctx.stroke();
      }
      if (s >= 1.5 && mat === "mud") {
        // Brüstung am Flachdach
        const [w, l] = t;
        const r = (houses[i + 2] * Math.PI) / 180, cc = Math.cos(r), nn = Math.sin(r);
        const X = houses[i], Z = houses[i + 1], ins = 0.6;
        ctx.beginPath();
        [[-w / 2 + ins, -l / 2 + ins], [w / 2 - ins, -l / 2 + ins], [w / 2 - ins, l / 2 - ins], [-w / 2 + ins, l / 2 - ins]].forEach(([a, b], k) => {
          const sx = px(X + a * cc + b * nn), sy = py(Z - a * nn + b * cc);
          k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = rgb(c, 0.9);
        ctx.fill();
      }
    }

    // Kleinteile: Stümpfe, Stämme, Heuballen
    if (s >= 0.7) {
      for (const i of tIdx) {
        const k = treeKinds[trees[i + 2]];
        const X = px(trees[i]), Y = py(trees[i + 1]);
        if (k === "log") {
          const r = (trees[i + 3] * Math.PI) / 180, L2 = 3 * s;
          ctx.strokeStyle = "rgba(92,70,46,0.9)"; ctx.lineWidth = Math.max(1, 0.5 * s);
          ctx.beginPath(); ctx.moveTo(X - Math.sin(r) * L2, Y + Math.cos(r) * L2); ctx.lineTo(X + Math.sin(r) * L2, Y - Math.cos(r) * L2); ctx.stroke();
        } else if (k === "stump") {
          ctx.fillStyle = "rgba(96,74,50,0.9)"; ctx.beginPath(); ctx.arc(X, Y, Math.max(0.8, 0.4 * s), 0, 6.283); ctx.fill();
        } else if (k === "hay") {
          ctx.fillStyle = "rgba(206,182,104,0.95)"; ctx.beginPath(); ctx.arc(X, Y, Math.max(1, 0.8 * s), 0, 6.283); ctx.fill();
        }
      }
    }

    // Baumkronen
    for (const i of tIdx) {
      const k = treeKinds[trees[i + 2]], T = TREE[k];
      if (!T) continue;
      const v = rnd(i), X = px(trees[i]), Y = py(trees[i + 1]);
      const R = T.r * s * (0.85 + v * 0.3);
      const c = T.c, f = 0.9 + v * 0.2;
      if (R < 1.1) { ctx.fillStyle = rgb(c, f * 0.85); ctx.fillRect(X - 0.8, Y - 0.8, 1.6, 1.6); continue; }
      if (R < 4) {
        ctx.fillStyle = rgb(c, f * 0.85); ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.fill();
        ctx.fillStyle = rgb(c, f * 1.18); ctx.beginPath(); ctx.arc(X - R * 0.3, Y - R * 0.3, R * 0.5, 0, 6.283); ctx.fill();
        continue;
      }
      // Krone aus mehreren Blattbüscheln mit Licht von Nordwest
      const lobes = k === "conifer" ? 1 : 5;
      for (let j = 0; j < lobes; j++) {
        const a = v * 6.283 + j * 1.256, d = lobes === 1 ? 0 : R * 0.42;
        const cx = X + Math.cos(a) * d, cy = Y + Math.sin(a) * d, rr = lobes === 1 ? R : R * 0.62;
        const g = ctx.createRadialGradient(cx - rr * 0.35, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
        g.addColorStop(0, rgb(c, f * 1.35));
        g.addColorStop(0.6, rgb(c, f));
        g.addColorStop(1, rgb(c, f * 0.62));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.283); ctx.fill();
      }
    }
  }

  function placeClass(p) {
    if (p.type === "region") return "t-region";
    if (p.type === "poi") return "t-poi";
    if (p.type === "city" || (p.size || 0) >= 250) return "t-big";
    if (p.type === "town" || (p.size || 0) >= 80) return "t-mid";
    return "t-small";
  }
  function buildLabels() {
    labelLayer = L.layerGroup();
    places.forEach((p) => {
      const text = (p.approx ? "≈ " : "") + p.name;
      const m = L.marker([p.z, p.x], {
        icon: L.divIcon({ className: "place-label " + placeClass(p), html: `<span>${esc(text)}</span>`, iconSize: [0, 0] }),
        keyboard: false, pane: "labelPane",
      });
      m.bindPopup(() =>
        `<div class="pop-title"><span>${esc(p.name)}</span></div>` +
        `<div class="pop-sub">${p.approx ? "Lage ungefähr, bitte im Spiel prüfen" : "Lage aus den Spieldaten"}</div>` +
        `<dl class="pop-meta"><dt>Quelle</dt><dd>${esc(p.source || "")}</dd><dt>Koordinate</dt><dd>${coordText(p.x, p.z)}</dd></dl>` +
        `<div class="pop-actions"><button type="button" class="btn" data-act="copy" data-x="${p.x}" data-z="${p.z}">Koordinate kopieren</button>` +
        `<button type="button" class="btn ghost" data-act="measure" data-x="${p.x}" data-z="${p.z}">Von hier messen</button></div>`,
        { maxWidth: 280 });
      labelLayer.addLayer(m);
    });
    peakLayer = L.layerGroup();
    ((paper && paper.peaks) || []).slice(0, 80).forEach(([x, z, h]) => {
      peakLayer.addLayer(L.marker([z, x], {
        icon: L.divIcon({ className: "peak-label", html: `<span>${h}</span>`, iconSize: [0, 0] }),
        interactive: false, keyboard: false, pane: "labelPane",
      }));
    });
  }

  // Höhenraster (64 m) für die Anzeige unter dem Mauszeiger
  function loadHeights() {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        heightGrid = { w: img.width, h: img.height, px: ctx.getImageData(0, 0, img.width, img.height).data };
      } catch (e) { heightGrid = null; }
    };
    img.src = CFG.heightUrl;
  }
  function heightAt(x, z) {
    if (!heightGrid || x < 0 || z < 0 || x >= W || z >= W) return null;
    const { w, h, px } = heightGrid;
    const col = Math.min(w - 1, Math.floor((x / W) * w));
    const row = Math.min(h - 1, Math.floor(((W - z) / W) * h));
    const i = (row * w + col) * 4;
    return (px[i] * 256 + px[i + 1]) / 2;
  }

  function fitInitialView() {
    const fit = map.getBoundsZoom(bounds, false);
    map.setMinZoom(Math.floor(fit * 4) / 4 - 0.5);
    map.setMaxBounds(bounds.pad(0.25));
    const m = /^#(-?[\d.]+)\/(\d+)\/(\d+)$/.exec(location.hash);
    if (m) map.setView([+m[3], +m[2]], +m[1]);
    else map.fitBounds(bounds.pad(0.02));
  }

  function saveHash() {
    const c = map.getCenter();
    history.replaceState(null, "", `#${map.getZoom()}/${Math.round(c.lng)}/${Math.round(c.lat)}`);
  }

  // ---------- Ebenen ----------
  function dotRadius(z) { return Math.max(2.2, Math.min(7, 3 + (z + 3) * 0.9)); }

  function buildLayers() {
    // Gebäude, die in mehreren Kategorien vorkommen, für die Popups merken
    CFG.groups.forEach((g) => g.layers.forEach((def) => {
      if (def.style !== "dot") return;
      (data.layers[def.id] || []).forEach((rec) => {
        const k = rec[0] + "," + rec[1] + "," + rec[2];
        if (!buildingCats.has(k)) buildingCats.set(k, []);
        buildingCats.get(k).push(def.label);
      });
    }));

    Object.values(defs).forEach((def) => {
      const list = [];
      groupsLL[def.id] = L.layerGroup();
      if (def.source === "circles") {
        (data.circles[def.id] || []).forEach((rec) => {
          const isGas = def.id === "gas";
          const obj = L.circle([rec[1], rec[0]], {
            radius: rec[2], renderer: zoneRenderer, color: def.color, weight: isGas ? 2 : 1.5,
            dashArray: isGas ? null : "6 5", fillColor: def.color, fillOpacity: isGas ? 0.3 : 0.12,
          });
          obj.bindPopup(() => popupHtml(def, rec), { maxWidth: 260 });
          list.push({ rec, obj });
        });
      } else {
        (data.layers[def.id] || []).forEach((rec) => {
          let obj;
          if (def.style === "dot") {
            obj = L.circleMarker([rec[1], rec[0]], {
              renderer: dotRenderer, radius: 3, color: "#FFFDF6", weight: 1, opacity: 0.9,
              fillColor: def.color, fillOpacity: 1,
            });
          } else {
            obj = L.marker([rec[1], rec[0]], { icon: iconFor(def), keyboard: false, riseOnHover: true });
          }
          obj.bindPopup(() => popupHtml(def, rec), { maxWidth: 260 });
          list.push({ rec, obj });
        });
      }
      items[def.id] = list;
    });
  }

  const passesTier = (def, rec) => def.source === "circles" || !rec[3] || rec[3] >= tierMin;

  function applyLayer(id) {
    const def = defs[id];
    const g = groupsLL[id];
    g.clearLayers();
    if (active[id]) {
      const r = dotRadius(map.getZoom());
      items[id].forEach((it) => {
        if (!passesTier(def, it.rec)) return;
        if (def.style === "dot") it.obj.setRadius(r);
        g.addLayer(it.obj);
      });
      if (!map.hasLayer(g)) g.addTo(map);
    } else if (map.hasLayer(g)) {
      g.remove();
    }
  }

  function applyAll() {
    Object.keys(defs).forEach(applyLayer);
    updateCounts();
  }

  function onZoom() {
    const z = map.getZoom();
    const el = map.getContainer();
    el.classList.toggle("map-far", z < -3.5);
    el.classList.toggle("map-veryfar", z < -4.75);
    el.classList.toggle("map-mid", z >= -3.5 && z < -1.5);
    el.classList.toggle("map-zoomed-in", z >= 1);
    applyBase();
    const level = (z >= -5.06) + (z >= -3.64) + (z >= -2.06);
    if (gridLayer && map.hasLayer(gridLayer) && level !== gridLevel) { gridLevel = level; gridLayer.redraw(); }
    const r = dotRadius(z);
    Object.values(defs).forEach((def) => {
      if (def.style !== "dot" || !active[def.id]) return;
      groupsLL[def.id].eachLayer((l) => l.setRadius(r));
    });
  }

  // ---------- Legende ----------
  function renderLegend() {
    const openState = store.get(KEYS.open, { loot: true, events: true, danger: true });
    const host = $("#groups");
    host.innerHTML = "";
    CFG.groups.forEach((g) => {
      const det = document.createElement("details");
      det.className = "group";
      det.dataset.group = g.id;
      det.open = !!openState[g.id];
      det.innerHTML =
        `<summary><span class="group-title">${esc(g.title)}</span>` +
        `<span class="group-count" data-gcount="${g.id}"></span>` +
        `<button type="button" class="group-toggle" data-gtoggle="${g.id}"></button></summary>` +
        (g.hint ? `<p class="group-hint">${esc(g.hint)}</p>` : "") +
        g.layers.map((l) =>
          `<label class="row" data-row="${l.id}"><input type="checkbox" data-layer="${l.id}">` +
          `${symHtml(l)}<span class="row-label">${esc(l.label)}</span><span class="row-count" data-count="${l.id}"></span></label>`
        ).join("");
      det.addEventListener("toggle", () => {
        const s = store.get(KEYS.open, {});
        s[g.id] = det.open;
        store.set(KEYS.open, s);
      });
      host.appendChild(det);
    });

    host.addEventListener("change", (e) => {
      const id = e.target.dataset.layer;
      if (!id) return;
      active[id] = e.target.checked;
      persistLayers();
      applyLayer(id);
      updateCounts();
    });
    host.addEventListener("click", (e) => {
      const gid = e.target.dataset && e.target.dataset.gtoggle;
      if (!gid) return;
      e.preventDefault();
      const g = CFG.groups.find((x) => x.id === gid);
      const anyOn = g.layers.some((l) => active[l.id]);
      g.layers.forEach((l) => { active[l.id] = !anyOn; applyLayer(l.id); });
      persistLayers();
      updateCounts();
    });
  }

  function persistLayers() { store.set(KEYS.layers, active); }

  function updateCounts() {
    Object.values(defs).forEach((def) => {
      const n = items[def.id].filter((it) => passesTier(def, it.rec)).length;
      const cnt = $(`[data-count="${def.id}"]`);
      if (cnt) cnt.textContent = num(n);
      const cb = $(`[data-layer="${def.id}"]`);
      if (cb) cb.checked = active[def.id];
      const row = $(`[data-row="${def.id}"]`);
      if (row) row.classList.toggle("off", !active[def.id]);
    });
    CFG.groups.forEach((g) => {
      const on = g.layers.filter((l) => active[l.id]).length;
      $(`[data-gcount="${g.id}"]`).textContent = `${on} von ${g.layers.length}`;
      $(`[data-gtoggle="${g.id}"]`).textContent = on ? "keine" : "alle";
    });
  }

  function initTierSeg() {
    const seg = $("#tier-seg");
    const sync = () => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.tier === tierMin)));
    sync();
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      tierMin = +b.dataset.tier;
      store.set(KEYS.tier, tierMin);
      sync();
      applyAll();
    });
  }

  // ---------- Popups ----------
  function prettyType(name) {
    return name.replace(/^Land_/, "").replace(/_/g, " ");
  }

  function popupHtml(def, rec) {
    const isCircle = def.source === "circles";
    const x = rec[0], z = rec[1];
    let sub = "";
    const meta = [];
    if (isCircle) {
      const zoneNames = { HuntingGround: "Jagdgebiet", Rest: "Ruheplatz", Graze: "Weidegebiet" };
      sub = def.id === "gas" ? "Dauerhafte Gaszone, Schutzausrüstung nötig" : (zoneNames[rec[3]] || rec[3] || "");
      meta.push(["Radius", `${num(rec[2])} m`]);
    } else if (def.style === "dot" || def.id === "fuel" || def.id === "bunker") {
      sub = prettyType(data.types[rec[2]] || "");
      const cats = buildingCats.get(rec[0] + "," + rec[1] + "," + rec[2]);
      if (cats && cats.length > 1) meta.push(["Loot", cats.join(", ")]);
    } else if (def.id === "convoy" && rec[4]) {
      sub = `Spawngruppe „${esc(rec[4])}“`;
    } else if (def.id === "radio_bunker") {
      sub = "Sendet nachts den Zugangscode per Morsezeichen";
    } else if (def.group === "events" || def.group === "vehicles") {
      sub = "Möglicher Spawnpunkt";
    }
    if (!isCircle && rec[3]) meta.push(["Zone", `Tier ${rec[3]}`]);
    meta.push(["Koordinate", coordText(x, z)]);
    return (
      `<div class="pop-title">${symHtml(def)}<span>${esc(def.label)}</span></div>` +
      (sub ? `<div class="pop-sub">${sub}</div>` : "") +
      `<dl class="pop-meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
      `<div class="pop-actions"><button type="button" class="btn" data-act="copy" data-x="${x}" data-z="${z}">Koordinate kopieren</button>` +
      `<button type="button" class="btn ghost" data-act="measure" data-x="${x}" data-z="${z}">Von hier messen</button></div>`
    );
  }

  // Aktionen in Popups
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const x = +b.dataset.x, z = +b.dataset.z;
    if (b.dataset.act === "copy") copyCoord(x, z);
    if (b.dataset.act === "measure") { map.closePopup(); setMode("measure"); measureStart(L.latLng(z, x)); }
    if (b.dataset.act === "edit") { map.closePopup(); openMarkerDialog(markers.find((m) => m.id === b.dataset.id)); }
    if (b.dataset.act === "del-draw") { map.closePopup(); deleteDrawings([b.dataset.id]); toast("Zeichnung gelöscht"); }
  });

  // ---------- Raster ----------
  const GridLayer = L.GridLayer.extend({
    createTile(coords) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize();
      const dpr = window.devicePixelRatio || 1;
      tile.width = size.x * dpr;
      tile.height = size.y * dpr;
      tile.style.width = size.x + "px";
      tile.style.height = size.y + "px";
      const ctx = tile.getContext("2d");
      ctx.scale(dpr, dpr);
      const scale = Math.pow(2, coords.z);
      const ox = coords.x * size.x, oy = coords.y * size.y;
      const x0 = ox / scale, x1 = (ox + size.x) / scale;
      const zTop = -oy / scale, zBot = -(oy + size.y) / scale;
      const toPx = (mx, mz) => [mx * scale - ox, -mz * scale - oy];

      const lines = (step, style, width) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) {
          if (gx < 0 || gx > W) continue;
          const [px] = toPx(gx, 0);
          const [, pyA] = toPx(0, Math.min(zTop, W));
          const [, pyB] = toPx(0, Math.max(zBot, 0));
          ctx.moveTo(Math.round(px) + 0.5, pyA);
          ctx.lineTo(Math.round(px) + 0.5, pyB);
        }
        for (let gz = Math.ceil(zBot / step) * step; gz <= zTop; gz += step) {
          if (gz < 0 || gz > W) continue;
          const [, py] = toPx(0, gz);
          const [pxA] = toPx(Math.max(x0, 0), 0);
          const [pxB] = toPx(Math.min(x1, W), 0);
          ctx.moveTo(pxA, Math.round(py) + 0.5);
          ctx.lineTo(pxB, Math.round(py) + 0.5);
        }
        ctx.stroke();
      };
      // Sichtbarkeit nach tatsächlichem Zoom, nicht nach Kachel-Zoom
      const view = Math.pow(2, this._map ? this._map.getZoom() : coords.z);
      if (100 * view >= 24) lines(100, "rgba(70, 58, 40, .13)", 1);
      if (1000 * view >= 30) lines(1000, view >= 0.06 ? "rgba(70, 58, 40, .38)" : "rgba(70, 58, 40, .2)", 1);

      if (1000 * view >= 80) {
        ctx.fillStyle = "rgba(60, 50, 36, .7)";
        ctx.font = "600 12px 'Barlow SC', sans-serif";
        for (let gx = Math.floor(x0 / 1000) * 1000; gx <= x1; gx += 1000) {
          for (let gz = Math.ceil(zBot / 1000) * 1000; gz <= zTop + 1000; gz += 1000) {
            if (gx < 0 || gx >= W || gz <= 0 || gz > W) continue;
            const [px, py] = toPx(gx, gz);
            const label = String(gx / 1000).padStart(2, "0") + " " + String((gz - 1000) / 1000).padStart(2, "0");
            ctx.fillText(label, px + 4, py + 13);
          }
        }
      }
      return tile;
    },
  });

  // ---------- Koordinaten ----------
  let cursor = null;
  function initReadout() {
    const rx = $("#rx"), ry = $("#ry");
    const rh = $("#rh");
    const show = (ll) => {
      rx.textContent = Math.round(ll.lng);
      ry.textContent = Math.round(ll.lat);
      const h = heightAt(ll.lng, ll.lat);
      rh.textContent = h == null ? "–" : `≈${Math.round(h / 5) * 5} m`;
    };
    show(map.getCenter());
    map.on("mousemove", (e) => { cursor = e.latlng; show(e.latlng); });
    map.on("mouseout", () => { cursor = null; });
    map.on("move", () => { if (!cursor) show(map.getCenter()); });
    $("#readout").addEventListener("click", () => {
      const ll = cursor || map.getCenter();
      copyCoord(ll.lng, ll.lat);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && cursor && !isTyping(e) && !String(window.getSelection())) {
        e.preventDefault();
        copyCoord(cursor.lng, cursor.lat);
      }
    });
  }
  const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

  function copyCoord(x, z) {
    const t = coordText(x, z);
    const done = () => toast(`Koordinate ${t} kopiert`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => toast(t));
    else toast(t);
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function goTo(latlng, zoom) {
    const z = Math.max(map.getZoom(), zoom);
    reducedMotion ? map.setView(latlng, z) : map.flyTo(latlng, z, { duration: 0.8 });
  }

  function ping(latlng) {
    const m = L.marker(latlng, { icon: L.divIcon({ className: "mk-ping", html: '<div class="ping"></div>', iconSize: [44, 44] }), interactive: false, pane: "measurePane" }).addTo(map);
    setTimeout(() => m.remove(), 3000);
  }

  function initGoto() {
    $("#goto").addEventListener("submit", (e) => {
      e.preventDefault();
      const nums = ($("#goto-input").value.match(/\d+(?:[.,]\d+)?/g) || []).map((s) => parseFloat(s.replace(",", ".")));
      if (nums.length < 2) { toast("Bitte X und Y eingeben, z. B. 11460 7396"); return; }
      const [x, z] = nums;
      if (x < 0 || x > W || z < 0 || z > W) { toast(`Die Karte reicht von 0 bis ${W} in beide Richtungen`); return; }
      const ll = L.latLng(z, x);
      goTo(ll, -1);
      ping(ll);
      closePanelMobile();
    });
  }

  // ---------- Werkzeuge ----------
  let mode = null;
  const measure = { a: null, b: null, layer: null, line: null };

  function setMode(m) {
    const prev = mode;
    mode = mode === m ? null : m;
    if (prev === "draw" || mode === "draw") setDrawInteractions(mode === "draw");
    $("#tool-measure").setAttribute("aria-pressed", String(mode === "measure"));
    $("#tool-marker").setAttribute("aria-pressed", String(mode === "place"));
    const el = map.getContainer();
    el.classList.toggle("measuring", mode === "measure");
    el.classList.toggle("placing", mode === "place");
    if (mode !== "measure") clearMeasure();
    status();
  }

  function status() {
    const el = $("#status");
    if (mode === "measure") {
      el.innerHTML = (measure.a && !measure.b ? "Klicke auf den Zielpunkt."
        : measure.b ? "Ein neuer Klick startet die nächste Messung." : "Klicke auf den Startpunkt.")
        + " <kbd>Esc</kbd> beendet das Messen.";
    } else if (mode === "place") {
      el.innerHTML = "Klicke auf die Stelle für deinen Marker. <kbd>Esc</kbd> bricht ab.";
    } else if (mode === "draw") {
      el.innerHTML = "";
    }
    el.hidden = !mode || mode === "draw";
  }

  function bearing(a, b) {
    const deg = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
    const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
    return { deg: Math.round(deg) % 360, dir: dirs[Math.round(deg / 45) % 8] };
  }
  function distText(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} km`;
  }

  function clearMeasure() {
    if (measure.layer) measure.layer.remove();
    measure.a = measure.b = measure.layer = measure.line = null;
  }

  function measureStart(ll) {
    clearMeasure();
    measure.a = ll;
    measure.layer = L.layerGroup().addTo(map);
    const pt = (p) => L.circleMarker(p, { pane: "measurePane", radius: 5, color: "#fff", weight: 2, fillColor: "#6B2D8F", fillOpacity: 1, interactive: false });
    measure.layer.addLayer(pt(ll));
    measure.line = L.polyline([ll, ll], { pane: "measurePane", color: "#6B2D8F", weight: 3, dashArray: "8 6", interactive: false });
    measure.layer.addLayer(measure.line);
    measure.line.bindTooltip("", { permanent: true, direction: "right", offset: [12, 0], className: "measure-label", pane: "measurePane" });
    measure.pt = pt;
    status();
  }

  function measureUpdate(ll, final) {
    measure.line.setLatLngs([measure.a, ll]);
    const d = map.distance(measure.a, ll);
    const br = bearing(measure.a, ll);
    measure.line.setTooltipContent(`${distText(d)}, ${br.deg}° ${br.dir}`);
    measure.line.openTooltip(ll);
    if (final) {
      measure.b = ll;
      measure.layer.addLayer(measure.pt(ll));
      status();
    }
  }

  function initTools() {
    $("#tool-measure").addEventListener("click", () => setMode("measure"));
    $("#tool-3d").addEventListener("click", async () => {
      if (mode) setMode(null);
      const btn = $("#tool-3d");
      btn.disabled = true;
      try {
        loadObjects();
        if (objectsLoading) await objectsLoading;
        const c = map.getCenter();
        const m = await import("./view3d.js");
        await m.open3D({ cfg: CFG, world: W, center: { x: c.lng, z: c.lat }, paper, objects, onClose: () => btn.focus() });
      } catch (e) {
        toast("Die 3D-Ansicht konnte nicht geladen werden");
      } finally {
        btn.disabled = false;
      }
    });
    $("#tool-marker").addEventListener("click", () => setMode("place"));
    $("#zoom-in").addEventListener("click", () => map.zoomIn());
    $("#zoom-out").addEventListener("click", () => map.zoomOut());

    map.on("click", (e) => {
      if (mode === "measure") {
        if (!measure.a || measure.b) measureStart(e.latlng);
        else measureUpdate(e.latlng, true);
      } else if (mode === "place") {
        setMode(null);
        openMarkerDialog(null, e.latlng);
      }
    });
    map.on("mousemove", (e) => {
      if (mode === "measure" && measure.a && !measure.b) measureUpdate(e.latlng, false);
    });
    map.on("contextmenu", (e) => {
      if (mode === "draw" || !bounds.contains(e.latlng)) return;
      openMarkerDialog(null, e.latlng);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mode && !$("#marker-dialog").open && !document.querySelector(".v3d")) setMode(null);
    });
  }

  // ---------- Eigene Marker ----------
  let markers = store.get(KEYS.markers, []);
  const mineGroup = L.layerGroup();
  let editing = null;

  function initMarkers() {
    mineGroup.addTo(map);
    $("#m-types").innerHTML = CFG.markerTypes.map((t, i) =>
      `<label><input type="radio" name="type" value="${t.id}"${i === 0 ? " checked" : ""}><span><b aria-hidden="true">${esc(t.glyph)}</b>${esc(t.label)}</span></label>`
    ).join("");

    const dlg = $("#marker-dialog");
    $("#marker-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#m-name").value.trim();
      if (!name) { $("#m-name").focus(); return; }
      const type = (new FormData(e.target)).get("type");
      const note = $("#m-note").value.trim();
      const now = Date.now();
      if (editing.id) {
        Object.assign(markers.find((m) => m.id === editing.id), { name, type, note, updated: now });
      } else {
        markers.push({ id: "m" + now.toString(36) + Math.random().toString(36).slice(2, 6), x: editing.x, z: editing.z, name, type, note, created: now, updated: now, by: me.id, byName: me.name });
      }
      saveMarkers();
      dlg.close();
      toast("Marker gespeichert");
    });
    $("#m-cancel").addEventListener("click", () => dlg.close());
    $("#m-delete").addEventListener("click", () => {
      if (!editing.id || !confirm(`Marker „${editing.name}“ löschen?`)) return;
      markers = markers.filter((m) => m.id !== editing.id);
      saveMarkers();
      dlg.close();
      toast("Marker gelöscht");
    });

    $("#export-btn").addEventListener("click", () => {
      if (!markers.length) { toast("Noch keine Marker zum Exportieren"); return; }
      const blob = new Blob([JSON.stringify({ app: "nasdara-feldkarte", version: 1, markers }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nasdara-marker-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("#import-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        const parsed = JSON.parse(txt);
        const list = Array.isArray(parsed) ? parsed : parsed.markers;
        if (!Array.isArray(list)) throw new Error();
        let added = 0;
        list.forEach((m) => {
          if (typeof m.x !== "number" || typeof m.z !== "number" || !m.name) return;
          const cur = markers.find((c) => c.id === m.id);
          if (!cur) { markers.push(m); added++; }
          else if ((m.updated || 0) > (cur.updated || 0)) Object.assign(cur, m);
        });
        saveMarkers();
        toast(added ? `${added} Marker importiert` : "Keine neuen Marker in der Datei");
      }).catch(() => toast("Die Datei konnte nicht gelesen werden")).finally(() => { e.target.value = ""; });
    });

    $("#mine-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mid]");
      if (!b) return;
      const m = markers.find((x) => x.id === b.dataset.mid);
      closePanelMobile();
      goTo(L.latLng(m.z, m.x), 0);
      setTimeout(() => m._ll && m._ll.openPopup(), reducedMotion ? 0 : 850);
    });

    renderMarkers();
  }

  function saveMarkers() {
    if (!syncMarkers()) store.set(KEYS.markers, markers.map(({ _ll, ...m }) => m));
    renderMarkers();
  }

  function renderMarkers() {
    mineGroup.clearLayers();
    markers.forEach((m) => {
      const ll = L.marker([m.z, m.x], { icon: mineIcon(m), pane: "minePane", riseOnHover: true });
      ll.bindPopup(() =>
        `<div class="pop-title"><span class="sym mine" style="--s:16px"><span>${esc(typeOf(m.type).glyph)}</span></span><span>${esc(m.name)}</span></div>` +
        `<div class="pop-sub">${esc(typeOf(m.type).label)}${room && m.byName ? `, von ${esc(m.by === me.id ? "dir" : m.byName)}` : ""}</div>` +
        (m.note ? `<p class="pop-note">${esc(m.note)}</p>` : "") +
        `<dl class="pop-meta"><dt>Koordinate</dt><dd>${coordText(m.x, m.z)}</dd></dl>` +
        `<div class="pop-actions"><button type="button" class="btn" data-act="edit" data-id="${m.id}">Bearbeiten</button>` +
        `<button type="button" class="btn ghost" data-act="copy" data-x="${m.x}" data-z="${m.z}">Kopieren</button>` +
        `<button type="button" class="btn ghost" data-act="measure" data-x="${m.x}" data-z="${m.z}">Messen</button></div>`,
        { maxWidth: 260 });
      Object.defineProperty(m, "_ll", { value: ll, enumerable: false, configurable: true, writable: true });
      mineGroup.addLayer(ll);
    });
    $("#mine-count").textContent = markers.length;
    const sorted = [...markers].sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $("#mine-list").innerHTML = sorted.length
      ? sorted.map((m) =>
        `<li><button type="button" data-mid="${m.id}"><span class="sym mine"><span>${esc(typeOf(m.type).glyph)}</span></span>` +
        `<span class="row-label">${esc(m.name)}</span><span class="mine-xy">${coordText(m.x, m.z)}</span></button></li>`).join("")
      : '<li class="mine-empty">Noch keine Marker gesetzt.</li>';
  }

  function openMarkerDialog(existing, latlng) {
    const dlg = $("#marker-dialog");
    editing = existing ? { ...existing } : { x: Math.round(latlng.lng), z: Math.round(latlng.lat) };
    $("#marker-dialog-title").textContent = existing ? "Marker bearbeiten" : "Marker setzen";
    $("#marker-coords").textContent = `Koordinate ${coordText(editing.x, editing.z)}`;
    $("#m-name").value = existing ? existing.name : "";
    $("#m-note").value = existing ? existing.note || "" : "";
    const type = existing ? existing.type : CFG.markerTypes[0].id;
    dlg.querySelectorAll('input[name="type"]').forEach((r) => { r.checked = r.value === type; });
    $("#m-delete").hidden = !existing;
    dlg.showModal();
    $("#m-name").focus();
  }

  // ---------- Live-Raum ----------
  const R = window.NasdaraRoom;
  let room = null;                       // aktive Verbindung oder null
  const me = (() => {
    let id = store.get(KEYS.me, null);
    if (!id) { id = "u" + Math.random().toString(36).slice(2, 10); store.set(KEYS.me, id); }
    const name = store.get(KEYS.name, "");
    const colors = CFG.drawColors;
    const color = store.get(KEYS.color, colors[Math.floor(Math.random() * 6)]);
    return { id, name, color };
  })();
  let localMarkers = markers;            // Marker ohne Raum (localStorage)
  const published = new Map();           // id -> JSON des zuletzt gesendeten Markers

  function brokerUrl() {
    // Testserver nur bei lokal geöffneter Seite per ?broker= überschreibbar
    const q = new URLSearchParams(location.search).get("broker");
    if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return q;
    return CFG.room.broker;
  }

  function setRoomUrl(code) {
    const u = new URL(location.href);
    if (code) u.searchParams.set("raum", code); else u.searchParams.delete("raum");
    history.replaceState(null, "", u.pathname + u.search + location.hash);
  }

  function enterRoom(code) {
    if (room) leaveRoom(true);
    if (!window.mqtt) { toast("Die Live-Verbindung konnte nicht geladen werden"); return; }
    if (!me.name) me.name = "Spieler";
    localMarkers = markers;
    markers = [];
    published.clear();
    clearDrawings();
    room = R.join({
      broker: brokerUrl(), namespace: CFG.room.namespace, code, me,
      onObject: onRemoteObject, onPresence: renderPeople, onStatus: renderRoomStatus,
    });
    store.set(KEYS.lastRoom, code);
    setRoomUrl(code);
    document.body.classList.add("has-room");
    $("#room-off").hidden = true;
    $("#room-on").hidden = false;
    $("#room-code").textContent = code;
    $("#room-badge").hidden = false;
    $("#mine-title").textContent = "Marker im Raum";
    $("#mine-help").textContent = "Rechtsklick auf die Karte (am Handy lange drücken) setzt einen Marker. Alle im Raum sehen und bearbeiten ihn sofort.";
    renderMarkers();
    renderRoomStatus("connecting");
  }

  function leaveRoom(silent) {
    if (!room) return;
    room.leave();
    room = null;
    markers = localMarkers;
    published.clear();
    clearDrawings();
    loadLocalDrawings();
    setRoomUrl(null);
    document.body.classList.remove("has-room");
    $("#room-off").hidden = false;
    $("#room-on").hidden = true;
    $("#room-badge").hidden = true;
    $("#mine-title").textContent = "Eigene Marker";
    $("#mine-help").textContent = "Rechtsklick auf die Karte (am Handy lange drücken) setzt einen Marker. Ohne Raum wird nur in diesem Browser gespeichert.";
    renderMarkers();
    if (!silent) toast("Raum verlassen");
  }

  function renderRoomStatus(st) {
    const el = $("#room-status"), badge = $("#room-badge");
    const text = { online: "verbunden", connecting: "verbinde …", offline: "keine Verbindung, versuche erneut …", error: "keine Verbindung, versuche erneut …" }[st] || st;
    el.textContent = text;
    el.className = "room-status " + (st === "online" ? "ok" : st === "connecting" ? "" : "bad");
    badge.classList.toggle("ok", st === "online");
    badge.classList.toggle("bad", st === "offline" || st === "error");
    badge.dataset.status = text;
    renderBadge();
  }
  let people = [];
  function renderPeople(list) {
    people = list;
    $("#room-people").innerHTML = list
      .sort((a, b) => (b.self - a.self) || a.name.localeCompare(b.name))
      .map((p) => `<li class="${p.self ? "self" : ""}" style="--c:${esc(p.color)}">${esc(p.name)}${p.self ? " (du)" : ""}</li>`).join("");
    renderBadge();
  }
  function renderBadge() {
    if (!room) return;
    const n = people.length || 1;
    $("#room-badge-text").innerHTML = `<b>${esc(room.code)}</b> ${n} online`;
    $("#room-badge").title = `Raum ${room.code}, ${$("#room-badge").dataset.status || ""}`;
  }

  function onRemoteObject(id, obj) {
    if (obj && obj.k === "marker") {
      published.set(id, JSON.stringify(obj.m));
      const cur = markers.findIndex((m) => m.id === id);
      if (cur >= 0) markers[cur] = obj.m; else markers.push(obj.m);
      renderMarkers();
    } else if (obj && obj.k === "draw") {
      if (drawing && drawing.id === id) return;     // eigene laufende Zeichnung nicht überschreiben
      upsertDrawing(obj);
    } else if (!obj) {
      if (published.has(id) || markers.some((m) => m.id === id)) {
        published.delete(id);
        markers = markers.filter((m) => m.id !== id);
        renderMarkers();
      }
      removeDrawingLayer(id);
    }
  }

  // Marker im Raum: Änderungen ermitteln und senden
  function syncMarkers() {
    if (!room) return false;
    const ids = new Set();
    markers.forEach((m) => {
      ids.add(m.id);
      const clean = { ...m };
      delete clean._ll;
      if (!clean.by) { clean.by = me.id; clean.byName = me.name; }
      const json = JSON.stringify(clean);
      if (published.get(m.id) !== json) {
        published.set(m.id, json);
        room.publish(m.id, { k: "marker", m: clean });
      }
    });
    for (const id of [...published.keys()]) {
      if (!ids.has(id)) { published.delete(id); room.remove(id); }
    }
    return true;
  }

  function initRoom() {
    const nameIn = $("#start-name"), codeIn = $("#start-code"), err = $("#start-error");
    const dlg = $("#start-dialog");
    nameIn.value = me.name;
    const setName = () => {
      const n = nameIn.value.trim().slice(0, 20);
      if (!n) { err.textContent = "Bitte gib einen Namen ein, damit die anderen sehen, wer zeichnet."; err.hidden = false; nameIn.focus(); return false; }
      me.name = n; store.set(KEYS.name, n); err.hidden = true;
      return true;
    };
    const urlCode = R.normalizeCode(new URLSearchParams(location.search).get("raum"));
    const last = store.get(KEYS.lastRoom, null);
    if (last && last !== urlCode) {
      const b = $("#start-rejoin");
      b.hidden = false;
      b.textContent = `Zurück in Raum ${last}`;
      b.addEventListener("click", () => { if (setName()) { dlg.close(); enterRoom(last); } });
    }
    if (urlCode) codeIn.value = urlCode;
    $("#start-create").addEventListener("click", () => { if (setName()) { dlg.close(); enterRoom(R.newCode()); } });
    const joinFromDialog = () => {
      const c = R.normalizeCode(codeIn.value);
      if (!c) { err.textContent = "Der Code hat 4 Zeichen, zum Beispiel K7QD."; err.hidden = false; codeIn.focus(); return; }
      if (setName()) { dlg.close(); enterRoom(c); }
    };
    $("#start-join").addEventListener("click", joinFromDialog);
    codeIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinFromDialog(); } });
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); urlCode ? joinFromDialog() : $("#start-create").click(); } });
    $("#start-skip").addEventListener("click", () => dlg.close());
    dlg.addEventListener("cancel", () => {});

    // Seitenleiste
    $("#room-create").addEventListener("click", () => openStart());
    $("#room-join").addEventListener("submit", (e) => {
      e.preventDefault();
      const c = R.normalizeCode($("#room-code-input").value);
      if (!c) { toast("Der Code hat 4 Zeichen, zum Beispiel K7QD"); return; }
      if (!me.name) { codeIn.value = c; openStart(); return; }
      enterRoom(c);
      closePanelMobile();
    });
    $("#room-leave").addEventListener("click", () => leaveRoom());
    $("#room-copy").addEventListener("click", () => {
      const u = new URL(location.href);
      u.hash = "";
      u.searchParams.set("raum", room.code);
      u.searchParams.delete("broker");
      const text = `Komm in meinen Nasdara-Raum ${room.code}: ${u.toString()}`;
      const done = () => toast("Einladung kopiert");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text));
      else toast(text);
    });
    $("#room-badge").addEventListener("click", () => {
      $("#panel").classList.add("open");
      $("#room").scrollIntoView({ block: "nearest" });
    });

    function openStart() {
      err.hidden = true;
      dlg.showModal();
      (me.name ? (codeIn.value ? codeIn : $("#start-create")) : nameIn).focus();
    }

    loadLocalDrawings();
    if (urlCode && me.name) enterRoom(urlCode);
    else openStart();
  }

  // ---------- Zeichnen ----------
  const drawGroup = L.layerGroup();
  const drawLayers = new Map();          // id -> { obj, layer }
  let drawRenderer = null;
  let shape = store.get(KEYS.shape, "pen");
  let drawing = null;                    // laufende eigene Zeichnung
  let lastSent = 0, sendTimer = null;

  function loadLocalDrawings() {
    store.get(KEYS.drawings, []).forEach(upsertDrawing);
  }
  function saveLocalDrawings() {
    if (room) return;
    store.set(KEYS.drawings, [...drawLayers.values()].map((d) => d.obj));
  }
  function clearDrawings() {
    drawGroup.clearLayers();
    drawLayers.clear();
  }

  function shapeLayer(obj) {
    const style = { renderer: drawRenderer, color: obj.c, weight: obj.w || 4, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: true };
    const ll = (p) => [p[1], p[0]];
    if (obj.s === "circle" && obj.p.length) {
      return L.circle(ll(obj.p[0]), Object.assign({ radius: Math.max(1, obj.r || 1), fillColor: obj.c, fillOpacity: 0.14 }, style));
    }
    if (obj.s === "arrow" && obj.p.length >= 2) {
      const [a, b] = [obj.p[0], obj.p[obj.p.length - 1]];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
      const head = Math.min(len * 0.35, Math.max(len * 0.18, 25));
      const ang = Math.atan2(dz, dx);
      const wing = (s) => [b[0] - head * Math.cos(ang + s * 0.45), b[1] - head * Math.sin(ang + s * 0.45)];
      return L.featureGroup([
        L.polyline([ll(a), ll(b)], style),
        L.polyline([ll(wing(1)), ll(b), ll(wing(-1))], style),
      ]);
    }
    return L.polyline(obj.p.map(ll), Object.assign({ smoothFactor: 0.6 }, style));
  }

  function upsertDrawing(obj) {
    if (!obj || !obj.id || !Array.isArray(obj.p)) return;
    removeDrawingLayer(obj.id);
    const layer = shapeLayer(obj);
    layer.bindPopup(() => drawPopup(obj.id), { maxWidth: 260, className: "draw-pop" });
    drawGroup.addLayer(layer);
    drawLayers.set(obj.id, { obj, layer });
  }
  function removeDrawingLayer(id) {
    const d = drawLayers.get(id);
    if (d) { drawGroup.removeLayer(d.layer); drawLayers.delete(id); }
  }

  function drawPopup(id) {
    const d = drawLayers.get(id);
    if (!d) return "";
    const o = d.obj;
    const mine = o.by === me.id;
    const label = { pen: "Freihand-Zeichnung", arrow: "Pfeil", circle: "Kreis" }[o.s] || "Zeichnung";
    const ago = o.t ? Math.max(0, Math.round((Date.now() - o.t) / 60000)) : null;
    const when = ago == null ? "" : ago < 1 ? ", gerade eben" : ago < 60 ? `, vor ${ago} Min.` : `, vor ${Math.round(ago / 60)} Std.`;
    const extra = o.s === "circle" ? `<dl class="pop-meta"><dt>Radius</dt><dd>${num(o.r)} m</dd></dl>` :
      o.s === "arrow" ? `<dl class="pop-meta"><dt>Länge</dt><dd>${num(Math.hypot(o.p[1][0] - o.p[0][0], o.p[1][1] - o.p[0][1]))} m</dd></dl>` : "";
    return `<div class="pop-title"><span class="swatch" style="--c:${esc(o.c)}"></span><span>${label}</span></div>` +
      `<div class="pop-sub">von ${esc(mine ? "dir" : o.n || "unbekannt")}${when}</div>` + extra +
      (mine ? `<div class="pop-actions"><button type="button" class="btn danger" data-act="del-draw" data-id="${esc(id)}">Löschen</button></div>` : "");
  }

  function persistDrawing(obj, final) {
    if (room) {
      const now = Date.now();
      clearTimeout(sendTimer);
      if (final || now - lastSent > 120) { lastSent = now; room.publish(obj.id, obj); }
      else sendTimer = setTimeout(() => { lastSent = Date.now(); room.publish(obj.id, obj); }, 120 - (now - lastSent));
    } else if (final) {
      saveLocalDrawings();
    }
  }

  function deleteDrawings(ids) {
    ids.forEach((id) => {
      removeDrawingLayer(id);
      if (room) room.remove(id);
    });
    saveLocalDrawings();
  }

  const round1 = (v) => Math.round(v * 10) / 10;
  function simplifyPts(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      if (j <= i + 1) continue;
      const [x1, z1] = pts[i], [x2, z2] = pts[j];
      const dx = x2 - x1, dz = z2 - z1, n = Math.hypot(dx, dz) || 1e-9;
      let best = -1, bi = -1;
      for (let k = i + 1; k < j; k++) {
        const d = Math.abs(dx * (pts[k][1] - z1) - dz * (pts[k][0] - x1)) / n;
        if (d > best) { best = d; bi = k; }
      }
      if (best > eps) { keep[bi] = true; stack.push([i, bi], [bi, j]); }
    }
    return pts.filter((_, k) => keep[k]);
  }

  function initDraw() {
    drawRenderer = L.canvas({ pane: "drawPane", padding: 0.3, tolerance: 6 });
    drawGroup.addTo(map);

    $("#draw-colors").innerHTML = CFG.drawColors.map((c) =>
      `<button type="button" role="radio" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-checked="${c === me.color}"></button>`).join("");
    const syncBar = () => {
      document.querySelectorAll("[data-shape]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.shape === shape)));
      document.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.color === me.color)));
    };
    syncBar();
    $("#drawbar").addEventListener("click", (e) => {
      const s = e.target.closest("[data-shape]");
      if (s) { shape = s.dataset.shape; store.set(KEYS.shape, shape); syncBar(); }
      const c = e.target.closest("[data-color]");
      if (c) { me.color = c.dataset.color; store.set(KEYS.color, me.color); syncBar(); if (room) room.rename(me.name, me.color); }
    });
    $("#tool-draw").addEventListener("click", () => setMode("draw"));
    $("#draw-done").addEventListener("click", () => setMode(null));
    $("#draw-clear").addEventListener("click", () => {
      const mine = [...drawLayers.values()].filter((d) => d.obj.by === me.id).map((d) => d.obj.id);
      if (!mine.length) { toast("Du hast noch nichts gezeichnet"); return; }
      if (!confirm(`Alle ${mine.length} Zeichnungen von dir löschen? Die Zeichnungen der anderen bleiben.`)) return;
      deleteDrawings(mine);
      toast(mine.length === 1 ? "Zeichnung gelöscht" : `${mine.length} Zeichnungen gelöscht`);
    });

    const el = map.getContainer();
    const toLL = (e) => map.mouseEventToLatLng(e);
    const inMap = (ll) => ll.lng >= 0 && ll.lat >= 0 && ll.lng <= W && ll.lat <= W;
    el.addEventListener("pointerdown", (e) => {
      if (mode !== "draw" || e.button > 0) return;
      if (e.target.closest(".leaflet-control, .leaflet-popup, .drawbar, .tools, .styleswitch, .readout, .room-badge")) return;
      const ll = toLL(e);
      if (!inMap(ll)) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const now = Date.now();
      drawing = {
        id: "d" + now.toString(36) + Math.random().toString(36).slice(2, 6),
        k: "draw", s: shape, c: me.color, w: 4, by: me.id, n: me.name, t: now,
        p: [[round1(ll.lng), round1(ll.lat)]], r: 0,
        _px: [e.clientX, e.clientY],
      };
      if (shape !== "pen") drawing.p.push(drawing.p[0]);
      upsertDrawing(drawing);
    });
    el.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const ll = toLL(e);
      const pt = [round1(Math.min(W, Math.max(0, ll.lng))), round1(Math.min(W, Math.max(0, ll.lat)))];
      if (drawing.s === "pen") {
        if (Math.hypot(e.clientX - drawing._px[0], e.clientY - drawing._px[1]) < 3) return;
        drawing._px = [e.clientX, e.clientY];
        drawing.p.push(pt);
      } else if (drawing.s === "arrow") {
        drawing.p[1] = pt;
      } else {
        drawing.r = Math.round(Math.hypot(pt[0] - drawing.p[0][0], pt[1] - drawing.p[0][1]));
      }
      upsertDrawing(drawing);
      persistDrawing(clean(drawing), false);
    });
    const finish = () => {
      if (!drawing) return;
      const d = drawing;
      drawing = null;
      const tooSmall = d.s === "pen" ? d.p.length < 2 : d.s === "arrow" ? Math.hypot(d.p[1][0] - d.p[0][0], d.p[1][1] - d.p[0][1]) < 5 : d.r < 5;
      if (tooSmall) { removeDrawingLayer(d.id); if (room) room.remove(d.id); return; }
      if (d.s === "pen") {
        const metersPerPx = 1 / Math.pow(2, map.getZoom());
        d.p = simplifyPts(d.p, Math.max(0.3, metersPerPx * 1.2));
      }
      const obj = clean(d);
      upsertDrawing(obj);
      persistDrawing(obj, true);
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
  }
  const clean = (d) => { const o = { ...d }; delete o._px; return o; };

  function setDrawInteractions(on) {
    const fns = [map.dragging, map.touchZoom, map.doubleClickZoom, map.boxZoom];
    fns.forEach((h) => h && (on ? h.disable() : h.enable()));
    if (map.tapHold) on ? map.tapHold.disable() : map.tapHold.enable();
    map.getContainer().classList.toggle("drawing", on);
    $("#drawbar").hidden = !on;
    $("#tool-draw").setAttribute("aria-pressed", String(on));
  }

  // ---------- Mobile Seitenleiste ----------
  function initPanel() {
    $("#panel-open").addEventListener("click", () => { $("#panel").classList.add("open"); });
    $("#panel-close").addEventListener("click", closePanelMobile);
  }
  function closePanelMobile() { $("#panel").classList.remove("open"); }
})();
