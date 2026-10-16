// 3D-Ansicht eines 4 × 4 km großen Ausschnitts um die Kartenmitte.
// Gelände aus dem berechneten Höhenraster, Boden aus den eigenen Geländekacheln,
// Bäume und Gebäude an ihren echten Positionen. Wird erst beim Öffnen geladen.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

const SIZE = 4096;          // Kantenlänge des Ausschnitts in Metern
const SEG = 256;            // Gitter des Geländes (16 m)
const TEX_MPP = 2;          // Bodentextur 2 m je Pixel (Kachelebene 5)
const TILE_M = 512;         // Meter je Kachel auf Ebene 5

let heightCache = null;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function loadHeights(url) {
  if (heightCache) return heightCache;
  const img = await loadImage(url);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const h = new Float32Array(img.width * img.height);
  for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 4;
  heightCache = { n: img.width, h };
  return heightCache;
}

function makeHeightFn(H, world) {
  const n = H.n, cell = world / n;
  return (X, Z) => {
    const fx = Math.min(n - 1.001, Math.max(0, X / cell - 0.5));
    const fy = Math.min(n - 1.001, Math.max(0, (world - Z) / cell - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = H.h[y0 * n + x0], b = H.h[y0 * n + x0 + 1], c = H.h[(y0 + 1) * n + x0], d = H.h[(y0 + 1) * n + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

async function buildTexture(cfg, world, x0, zTop, roads) {
  const px = SIZE / TEX_MPP;
  const canvas = document.createElement("canvas");
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d8c49c";
  ctx.fillRect(0, 0, px, px);
  const level = cfg.realMaxLevel;
  const n = 2 ** level;
  const jobs = [];
  for (let tx = Math.floor(x0 / TILE_M); tx <= Math.floor((x0 + SIZE - 1) / TILE_M); tx++) {
    for (let ty = Math.floor((world - zTop) / TILE_M); ty <= Math.floor((world - zTop + SIZE - 1) / TILE_M); ty++) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const url = cfg.realTiles.replace("{z}", level).replace("{x}", tx).replace("{y}", ty);
      jobs.push(loadImage(url).then((img) => {
        const dx = (tx * TILE_M - x0) / TEX_MPP;
        const dy = (zTop - (world - ty * TILE_M)) / TEX_MPP;
        ctx.drawImage(img, dx, dy, TILE_M / TEX_MPP, TILE_M / TEX_MPP);
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);

  // Wege als staubige Pisten auf den Boden zeichnen
  if (roads) {
    const W = { 1: 4.5, 2: 3.2, 3: 1.6 }, C = { 1: "#e4d5b0", 2: "#dac9a3", 3: "rgba(198,178,140,.85)" };
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const pass of ["casing", "fill"]) {
      for (const [cls, pts] of roads) {
        if (pass === "casing" && cls === 3) continue;
        ctx.beginPath();
        pts.forEach(([X, Z], k) => {
          const sx = (X - x0) / TEX_MPP, sy = (zTop - Z) / TEX_MPP;
          k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.strokeStyle = pass === "casing" ? "rgba(96,78,52,.35)" : C[cls];
        ctx.lineWidth = (W[cls] + (pass === "casing" ? 1.6 : 0)) / TEX_MPP;
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const MAT = {
  mud: 0xc9b28a, stone: 0xbeb6a6, metal: 0x929084, wood: 0x8a6c4c, military: 0xa8a080, tent: 0x76704e, wreck: 0x9a9a96,
};
const RUST = 0x9c6a48;
const CARS = [0xe2e2dc, 0x46608c, 0xc47832, 0x78825c, 0x96282a, 0xc8be78];
const TREE = {
  fig_s: { r: 2.1, h: 3.2, c: 0x68743a }, fig_m: { r: 2.7, h: 4, c: 0x606e34 }, fig_l: { r: 3.3, h: 4.8, c: 0x58662f },
  conifer: { r: 2.4, h: 9, c: 0x3a4c2c, cone: true }, broadleaf: { r: 3.6, h: 8, c: 0x52642e },
};
const rnd = (i) => { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h & 0xffff) / 65535; };

function overlayMarkup() {
  const el = document.createElement("div");
  el.className = "v3d";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "3D-Ansicht");
  el.innerHTML = `
    <div class="v3d-bar">
      <div class="v3d-title"><strong>3D-Ansicht</strong><span class="v3d-where"></span></div>
      <label class="v3d-ex">Überhöhung <input type="range" min="1" max="3" step="0.25" value="1.5"> <output>1,5×</output></label>
      <button type="button" class="btn v3d-close">Schließen</button>
    </div>
    <div class="v3d-stage"></div>
    <p class="v3d-hint">Ziehen dreht die Ansicht, mit rechter Maustaste oder zwei Fingern verschieben, Mausrad zoomt. Das Gelände ist aus Objekthöhen berechnet und in leeren Gegenden nur grob.</p>
    <div class="v3d-status" role="status">3D-Ansicht wird aufgebaut …</div>`;
  document.body.appendChild(el);
  return el;
}

export async function open3D({ cfg, world, center, paper, objects, onClose }) {
  const el = overlayMarkup();
  const stage = el.querySelector(".v3d-stage");
  const status = el.querySelector(".v3d-status");
  const slider = el.querySelector("input[type=range]");
  const out = el.querySelector("output");

  const cx = Math.min(world - SIZE / 2, Math.max(SIZE / 2, center.x));
  const cz = Math.min(world - SIZE / 2, Math.max(SIZE / 2, center.z));
  const x0 = cx - SIZE / 2, zTop = cz + SIZE / 2;
  el.querySelector(".v3d-where").textContent = `Ausschnitt 4 × 4 km um ${Math.round(cx)} / ${Math.round(cz)}`;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xd9cfb9);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 1800, 5200);
  const camera = new THREE.PerspectiveCamera(50, 1, 2, 12000);
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x7d6a4c, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1d4, 1.6);
  sun.position.set(-1, 1.6, -0.8);
  scene.add(sun);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.47;
  controls.minDistance = 25;
  controls.maxDistance = 5000;

  let running = true;
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  const loop = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };

  const close = () => {
    running = false;
    window.removeEventListener("resize", resize);
    document.removeEventListener("keydown", onKey);
    controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
    renderer.dispose();
    el.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelector(".v3d-close").addEventListener("click", close);
  el.querySelector(".v3d-close").focus();

  try {
    const H = await loadHeights(cfg.height3dUrl);
    const hAt = makeHeightFn(H, world);
    let hmin = Infinity;
    for (let i = 0; i <= SEG; i++) for (let j = 0; j <= SEG; j++) hmin = Math.min(hmin, hAt(x0 + (i / SEG) * SIZE, zTop - (j / SEG) * SIZE));
    const tex = await buildTexture(cfg, world, x0, zTop, paper && paper.roads);

    // Gelände
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const base = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) base[i] = hAt(cx + pos.getX(i), cz - pos.getZ(i)) - hmin;
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    scene.add(ground);

    // Objekte im Ausschnitt sammeln
    const inBox = (X, Z) => X >= x0 && X < x0 + SIZE && Z <= zTop && Z > zTop - SIZE;
    const trees = { round: [], cone: [] }, houses = [];
    if (objects) {
      const T = objects.trees, K = objects.treeKinds;
      for (let i = 0; i < T.length; i += 4) {
        const def = TREE[K[T[i + 2]]];
        if (def && inBox(T[i], T[i + 1])) (def.cone ? trees.cone : trees.round).push(i);
      }
      const Hs = objects.houses;
      for (let i = 0; i < Hs.length; i += 4) if (inBox(Hs[i], Hs[i + 1])) houses.push(i);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 5); trunkGeo.translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7); coneGeo.translate(0, 0.5, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
    const lam = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const nTrees = trees.round.length + trees.cone.length;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6a5238 }), Math.max(1, nTrees));
    const crowns = new THREE.InstancedMesh(crownGeo, lam(), Math.max(1, trees.round.length));
    const cones = new THREE.InstancedMesh(coneGeo, lam(), Math.max(1, trees.cone.length));
    const boxes = new THREE.InstancedMesh(boxGeo, lam(), Math.max(1, houses.length));
    [trunks, crowns, cones, boxes].forEach((m) => scene.add(m));

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const place = (ex) => {
      for (let i = 0; i < pos.count; i++) pos.setY(i, base[i] * ex);
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      const gy = (X, Z) => (hAt(X, Z) - hmin) * ex;
      const T = objects ? objects.trees : [], K = objects ? objects.treeKinds : [];
      let t = 0;
      trees.round.forEach((i, k) => {
        const d = TREE[K[T[i + 2]]], v = rnd(i), X = T[i], Z = T[i + 1], y = gy(X, Z), r = d.r * (0.85 + v * 0.3);
        const trunkH = d.h * 0.45;
        q.setFromAxisAngle(up, v * 6.28);
        m4.compose(p.set(X - cx, y - 0.2, -(Z - cz)), q, s.set(1, trunkH, 1)); trunks.setMatrixAt(t++, m4);
        m4.compose(p.set(X - cx, y + trunkH + r * 0.55, -(Z - cz)), q, s.set(r, r * 0.78, r)); crowns.setMatrixAt(k, m4);
        crowns.setColorAt(k, col.setHex(d.c).multiplyScalar(0.85 + v * 0.3));
      });
      trees.cone.forEach((i, k) => {
        const d = TREE[K[T[i + 2]]], v = rnd(i), X = T[i], Z = T[i + 1], y = gy(X, Z), hh = d.h * (0.8 + v * 0.4);
        q.setFromAxisAngle(up, v * 6.28);
        m4.compose(p.set(X - cx, y - 0.2, -(Z - cz)), q, s.set(1, hh * 0.25, 1)); trunks.setMatrixAt(t++, m4);
        m4.compose(p.set(X - cx, y + hh * 0.18, -(Z - cz)), q, s.set(d.r, hh, d.r)); cones.setMatrixAt(k, m4);
        cones.setColorAt(k, col.setHex(d.c).multiplyScalar(0.85 + v * 0.3));
      });
      const Hs = objects ? objects.houses : [], HT = objects ? objects.houseTypes : [];
      houses.forEach((i, k) => {
        const [w, l, floors, mat] = HT[Hs[i + 3]], v = rnd(i), X = Hs[i], Z = Hs[i + 1];
        const hh = mat === "wreck" ? 1.6 : 1 + floors * 3.1;
        q.setFromAxisAngle(up, (-Hs[i + 2] * Math.PI) / 180);
        m4.compose(p.set(X - cx, gy(X, Z) - 1, -(Z - cz)), q, s.set(w, hh + 1, l));
        boxes.setMatrixAt(k, m4);
        let c = MAT[mat] || MAT.stone;
        if (mat === "metal" && v > 0.55) c = RUST;
        if (mat === "wreck") c = CARS[Math.floor(v * CARS.length)];
        boxes.setColorAt(k, col.setHex(c).multiplyScalar(0.92 + v * 0.14));
      });
      [trunks, crowns, cones, boxes].forEach((m) => {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      });
      trunks.count = t; crowns.count = trees.round.length; cones.count = trees.cone.length; boxes.count = houses.length;
      return gy(cx, cz);
    };

    const ex0 = parseFloat(slider.value);
    const gc = place(ex0);
    controls.target.set(0, gc, 0);
    camera.position.set(-350, gc + 650, 900);
    slider.addEventListener("input", () => {
      const ex = parseFloat(slider.value);
      out.textContent = ex.toLocaleString("de-DE") + "×";
      const g = place(ex);
      const dy = g - controls.target.y;
      controls.target.y += dy; camera.position.y += dy;
    });
    status.remove();
    loop();
  } catch (e) {
    status.textContent = "Die 3D-Ansicht konnte nicht geladen werden. Dein Browser braucht WebGL.";
    console.error(e);
  }
  return close;
}
