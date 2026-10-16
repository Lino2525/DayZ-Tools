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
    map.createPane("gridPane").style.zIndex = 405;
    map.createPane("zonePane").style.zIndex = 410;
    map.createPane("dotPane").style.zIndex = 420;
    map.createPane("labelPane").style.zIndex = 615;
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
  let lootBase, paperBase, roadLayer, roadRenderer, buildingLayer, buildingRenderer, labelLayer, peakLayer;
  let style = store.get(KEYS.style, "paper");
  const baseOpts = Object.assign({ names: true, roads: true, buildings: true }, store.get(KEYS.base, {}));

  // Kacheln der Papierkarte: Ebene 0 entspricht Leaflet-Zoom -6, Kachelzeile 0 liegt im Norden
  const PaperTiles = L.TileLayer.extend({
    getTileUrl(c) {
      const t = c.z + 6;
      return L.Util.template(this._url, { z: t, x: c.x, y: c.y + Math.pow(2, t) });
    },
  });

  function initBasemaps() {
    lootBase = L.imageOverlay(CFG.baseImage, bounds, { className: "base-image", interactive: false });
    if (paper) {
      paperBase = new PaperTiles(CFG.paperTiles, {
        tileSize: paper.tiles.tileSize, minZoom: -10, maxZoom: 10, minNativeZoom: -6, maxNativeZoom: paper.tiles.maxZoom - 6,
        bounds: bounds, noWrap: true, keepBuffer: 4, className: "paper-tiles",
      });
      roadRenderer = L.canvas({ pane: "gridPane", padding: 0.4 });
      buildingRenderer = L.canvas({ pane: "gridPane", padding: 0.3 });
      buildRoads();
      buildBuildings();
    } else {
      style = "loot";
      $(".styleswitch").hidden = true;
    }
    buildLabels();

    const sw = $(".styleswitch");
    sw.addEventListener("click", (e) => {
      const b = e.target.closest("[data-style]");
      if (b) setStyle(b.dataset.style);
    });
    ["names", "roads", "buildings"].forEach((k) => {
      const cb = $("#opt-" + k);
      cb.checked = baseOpts[k];
      cb.addEventListener("change", () => { baseOpts[k] = cb.checked; store.set(KEYS.base, baseOpts); applyBase(); });
    });
    setStyle(style);
  }

  function setStyle(s) {
    style = s;
    store.set(KEYS.style, s);
    document.body.dataset.style = s;
    document.querySelectorAll(".style-btn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === s)));
    if (s === "paper" && paperBase) { lootBase.remove(); paperBase.addTo(map); paperBase.bringToBack(); }
    else { if (paperBase) paperBase.remove(); lootBase.addTo(map); lootBase.bringToBack(); }
    applyBase();
  }

  function applyBase() {
    if (!map) return;
    const z = map.getZoom();
    toggle(labelLayer, baseOpts.names);
    toggle(peakLayer, baseOpts.names && style === "paper" && z >= -3.5);
    toggle(roadLayer, baseOpts.roads);
    toggle(buildingLayer, baseOpts.buildings && style === "paper" && z >= -2.25);
    styleRoads();
  }
  function toggle(layer, on) {
    if (!layer) return;
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) layer.remove();
  }

  const ROAD = {
    1: { color: "#7E4F25", w: 3.4 },
    2: { color: "#93653A", w: 2.4 },
    3: { color: "#A88460", w: 1.4, dash: true },
  };
  function buildRoads() {
    roadLayer = L.layerGroup();
    paper.roads.forEach(([cls, pts]) => {
      const st = ROAD[cls] || ROAD[3];
      const line = L.polyline(pts.map(([x, z]) => [z, x]), {
        renderer: roadRenderer, color: st.color, weight: st.w, opacity: 0.9, lineCap: "round", lineJoin: "round",
        interactive: false, smoothFactor: 1.2,
      });
      line._cls = cls;
      roadLayer.addLayer(line);
    });
  }
  function styleRoads() {
    if (!roadLayer || !map) return;
    const z = map.getZoom();
    const k = Math.max(0.35, Math.min(2.2, 0.55 + (z + 3) * 0.32));
    const onLoot = style === "loot";
    roadLayer.eachLayer((l) => {
      const st = ROAD[l._cls] || ROAD[3];
      if (l._cls === 3 && z < -3.5) { l.setStyle({ opacity: 0 }); return; }
      l.setStyle({
        weight: st.w * k,
        opacity: onLoot ? 0.55 : 0.9,
        dashArray: st.dash && z >= -1.5 ? `${4 * k} ${3 * k}` : null,
      });
    });
  }

  function buildBuildings() {
    buildingLayer = L.layerGroup();
    const s = 5;  // halbe Kantenlänge in Metern (ungefähre Gebäudegröße)
    paper.buildings.forEach(([x, z, yaw]) => {
      const r = (yaw * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
      const pts = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([dx, dz]) => [z + (-dx * n + dz * c), x + (dx * c + dz * n)]);
      buildingLayer.addLayer(L.polygon(pts, { renderer: buildingRenderer, stroke: false, fillColor: "#4E4236", fillOpacity: 0.85, interactive: false }));
    });
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
    mode = mode === m ? null : m;
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
    }
    el.hidden = !mode;
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
      if (!bounds.contains(e.latlng)) return;
      openMarkerDialog(null, e.latlng);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mode && !$("#marker-dialog").open) setMode(null);
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
        markers.push({ id: "m" + now.toString(36) + Math.random().toString(36).slice(2, 6), x: editing.x, z: editing.z, name, type, note, created: now, updated: now });
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
    store.set(KEYS.markers, markers.map(({ _ll, ...m }) => m));
    renderMarkers();
  }

  function renderMarkers() {
    mineGroup.clearLayers();
    markers.forEach((m) => {
      const ll = L.marker([m.z, m.x], { icon: mineIcon(m), pane: "minePane", riseOnHover: true });
      ll.bindPopup(() =>
        `<div class="pop-title"><span class="sym mine" style="--s:16px"><span>${esc(typeOf(m.type).glyph)}</span></span><span>${esc(m.name)}</span></div>` +
        `<div class="pop-sub">${esc(typeOf(m.type).label)}</div>` +
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

  // ---------- Mobile Seitenleiste ----------
  function initPanel() {
    $("#panel-open").addEventListener("click", () => { $("#panel").classList.add("open"); });
    $("#panel-close").addEventListener("click", closePanelMobile);
  }
  function closePanelMobile() { $("#panel").classList.remove("open"); }
})();
