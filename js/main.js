/* Cupboard Stacker — stack kitchen units on a pallet.
 *
 * Units are centimetres. Data coordinates: the pallet's back-left corner is
 * (0, 0); x runs along the pallet width, z along its depth, y is height above
 * the pallet's top surface. Each box stores its back-left-bottom corner.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'cupboard-stacker-v1';
  const EPS = 0.01;
  const HOVER_GAP = 30;        // how high a lifted piece floats above where it would land
  const SUPPORT_MIN = 0.6;     // fraction of a box's base that must rest on something
  const DROP_MS = 160;

  const PALLET_PRESETS = [
    { name: 'EURO 120×80', w: 120, d: 80 },
    { name: 'UK 120×100', w: 120, d: 100 },
    { name: 'HALF 80×60', w: 80, d: 60 },
    { name: 'US 122×102', w: 122, d: 102 },
  ];

  const BOX_PRESETS = [
    { name: 'Base 600', w: 60, h: 72, d: 56, color: '#4f8cff' },
    { name: 'Base 400', w: 40, h: 72, d: 56, color: '#3fc1c9' },
    { name: 'Base 1000', w: 100, h: 72, d: 56, color: '#5b6cff' },
    { name: 'Drawer 500', w: 50, h: 72, d: 56, color: '#2ec4b6' },
    { name: 'Wall 600', w: 60, h: 72, d: 32, color: '#ffd23f' },
    { name: 'Wall 300', w: 30, h: 72, d: 32, color: '#f4a261' },
    { name: 'Tall 600', w: 60, h: 200, d: 56, color: '#9b5de5' },
    { name: 'Corner 900', w: 90, h: 72, d: 56, color: '#06d6a0' },
  ];

  const PALETTE = ['#4f8cff', '#3fc1c9', '#2ec4b6', '#06d6a0', '#a3e635', '#ffd23f',
                   '#f4a261', '#9b5de5', '#f15bb5', '#e0e0e0', '#8d6e63', '#607d8b'];

  // ---------------------------------------------------------------- state
  const state = {
    pallet: { w: 120, d: 80, t: 10, maxH: 200 },
    boxes: [],      // { id, name, w, h, d, color, x, z, y, placed }
    nextId: 1,
  };
  let selectedId = null;
  let step = 5;
  const draft = { ...BOX_PRESETS[0] };
  const undoStack = [];

  const getBox = (id) => state.boxes.find((b) => b.id === id) || null;
  const selected = () => (selectedId == null ? null : getBox(selectedId));
  const placedBoxes = () => state.boxes.filter((b) => b.placed);
  const round1 = (v) => Math.round(v * 10) / 10;
  const num = (v, fallback) => (Number.isFinite(+v) && +v > 0 ? +v : fallback);

  // ---------------------------------------------------------------- geometry
  function overlapLen(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }
  function footprintOverlap(a, b) {
    return overlapLen(a.x, a.x + a.w, b.x, b.x + b.w) * overlapLen(a.z, a.z + a.d, b.z, b.z + b.d);
  }
  // Height a box would come to rest at if dropped straight down onto `others`.
  function landingY(box, others) {
    let y = 0;
    for (const o of others) {
      if (o !== box && footprintOverlap(box, o) > EPS) y = Math.max(y, o.y + o.h);
    }
    return y;
  }
  function onPalletArea(b) {
    const P = state.pallet;
    return overlapLen(b.x, b.x + b.w, 0, P.w) * overlapLen(b.z, b.z + b.d, 0, P.d);
  }
  function supportRatio(b, others) {
    const area = b.w * b.d;
    if (b.y < EPS) return Math.min(1, onPalletArea(b) / area);
    let s = 0;
    for (const o of others) {
      if (o !== b && Math.abs(o.y + o.h - b.y) < EPS) s += footprintOverlap(b, o);
    }
    return Math.min(1, s / area);
  }

  // Gravity pass over every placed box. Boxes are processed bottom-up in their
  // current order, each landing on the highest box below its footprint, so the
  // stack can never interpenetrate. `slidId` (a box nudged sideways) sorts after
  // others at the same level, so it climbs onto them rather than pushing them up.
  function settle(slidId) {
    const list = placedBoxes();
    list.sort((a, b) => {
      if (Math.abs(a.y - b.y) > EPS) return a.y - b.y;
      if (a.id === slidId) return 1;
      if (b.id === slidId) return -1;
      return a.id - b.id;
    });
    const done = [];
    for (const b of list) {
      b.y = landingY(b, done);
      done.push(b);
    }
    // Floating pieces hover above wherever they would land.
    for (const b of state.boxes) if (!b.placed) b.y = landingY(b, done);
  }

  function clampBox(b) {
    const P = state.pallet;
    const margin = 100;
    b.x = Math.min(Math.max(b.x, -margin), P.w + margin - b.w);
    b.z = Math.min(Math.max(b.z, -margin), P.d + margin - b.d);
  }

  function analyse() {
    const P = state.pallet;
    const all = placedBoxes();
    // Boxes parked entirely off the pallet are "set aside" and not part of the load.
    for (const b of state.boxes) b.aside = b.placed && onPalletArea(b) < EPS;
    const placed = all.filter((b) => !b.aside);
    for (const b of state.boxes) b.overhang = b.unstable = b.tooTall = false;
    let vol = 0, top = 0, issues = 0;
    for (const b of placed) {
      b.overhang = onPalletArea(b) < b.w * b.d - EPS;
      b.support = supportRatio(b, all);
      b.unstable = b.support < SUPPORT_MIN;
      b.tooTall = b.y + b.h > P.maxH + EPS;
      if (b.overhang || b.unstable || b.tooTall) issues++;
      vol += b.w * b.h * b.d;
      top = Math.max(top, b.y + b.h);
    }

    // Floor coverage: rasterise footprints at 1 cm over the pallet.
    const cell = 1, nx = Math.ceil(P.w / cell), nz = Math.ceil(P.d / cell);
    const grid = new Uint8Array(nx * nz);
    for (const b of placed) {
      const x0 = Math.max(0, Math.floor(b.x / cell)), x1 = Math.min(nx, Math.ceil((b.x + b.w) / cell));
      const z0 = Math.max(0, Math.floor(b.z / cell)), z1 = Math.min(nz, Math.ceil((b.z + b.d) / cell));
      for (let z = z0; z < z1; z++) grid.fill(1, z * nx + x0, z * nx + Math.max(x0, x1));
    }
    let covered = 0;
    for (let i = 0; i < grid.length; i++) covered += grid[i];

    return {
      units: placed.length,
      vol,
      top,
      fill: vol / (P.w * P.d * P.maxH),
      floor: covered / grid.length,
      density: top > 0 ? vol / (P.w * P.d * top) : null,
      issues,
    };
  }

  // ---------------------------------------------------------------- persistence + undo
  const snapshot = () => JSON.stringify({ pallet: state.pallet, boxes: state.boxes, nextId: state.nextId });

  function restore(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || !Array.isArray(data.boxes)) throw new Error('Not a Cupboard Stacker file');
    const p = data.pallet || {};
    state.pallet = {
      w: num(p.w, 120), d: num(p.d, 80), t: num(p.t, 10), maxH: num(p.maxH, 200),
    };
    let maxId = 0;
    state.boxes = data.boxes.map((b) => {
      const id = Number.isInteger(b.id) ? b.id : ++maxId;
      maxId = Math.max(maxId, id);
      return {
        id,
        name: String(b.name || 'Box').slice(0, 24),
        w: num(b.w, 60), h: num(b.h, 72), d: num(b.d, 56),
        color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#4f8cff',
        x: +b.x || 0, z: +b.z || 0, y: +b.y || 0,
        placed: b.placed !== false,
      };
    });
    state.nextId = Math.max(maxId + 1, data.nextId | 0);
    if (!getBox(selectedId)) selectedId = null;
    settle();
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return setStatus('Nothing to undo.');
    restore(undoStack.pop());
    rebuildPallet();
    syncPalletInputs();
    refresh();
    setStatus('Undone.');
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) { restore(s); return true; }
    } catch (e) { /* ignore corrupt or unavailable storage */ }
    return false;
  }

  // ---------------------------------------------------------------- three.js scene
  const viewport = $('viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b16);
  scene.fog = new THREE.Fog(0x070b16, 900, 2200);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
  camera.position.set(220, 230, 300);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 60, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 60;
  controls.maxDistance = 2000;

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1f33, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(180, 400, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -350, right: 350, top: 350, bottom: -350, near: 10, far: 1200 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.25);
  fill.position.set(-250, 150, -200);
  scene.add(fill);

  const floorGrid = new THREE.GridHelper(1000, 50, 0x26315f, 0x161d3a);
  scene.add(floorGrid);

  const palletGroup = new THREE.Group();
  scene.add(palletGroup);
  const boxRoot = new THREE.Group();
  scene.add(boxRoot);

  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }

  function rebuildPallet() {
    const P = state.pallet;
    disposeTree(palletGroup);
    palletGroup.clear();

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(P.w, P.t, P.d),
      new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.75, metalness: 0.05 })
    );
    slab.position.y = -P.t / 2;
    slab.receiveShadow = true;
    slab.castShadow = true;
    palletGroup.add(slab);
    const slabEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(slab.geometry),
      new THREE.LineBasicMaterial({ color: 0x5a0a0a })
    );
    slabEdges.position.copy(slab.position);
    palletGroup.add(slabEdges);

    // 10 cm grid on the deck
    const pts = [];
    for (let x = 10; x < P.w; x += 10) pts.push(x - P.w / 2, 0.05, -P.d / 2, x - P.w / 2, 0.05, P.d / 2);
    for (let z = 10; z < P.d; z += 10) pts.push(-P.w / 2, 0.05, z - P.d / 2, P.w / 2, 0.05, z - P.d / 2);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    palletGroup.add(new THREE.LineSegments(gridGeo,
      new THREE.LineBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.35 })));

    // Allowed load envelope
    const env = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(P.w, P.maxH, P.d)),
      new THREE.LineDashedMaterial({ color: 0x3ff0ff, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.55 })
    );
    env.position.y = P.maxH / 2;
    env.computeLineDistances();
    palletGroup.add(env);

    floorGrid.position.y = -P.t - 0.05;
    for (const b of state.boxes) delete b._key;   // positions depend on pallet size
  }

  // --- box meshes
  const meshes = new Map();   // id -> { group, mesh, edges, key }
  const anim = new Map();     // id -> { from, start } drop animation

  function labelTexture(b) {
    const ratio = b.d / b.w;
    const cw = 256, ch = Math.max(32, Math.round(256 * ratio));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    const fs = Math.min(40, ch * 0.32, (cw * 0.9) / Math.max(4, b.name.length) * 1.7);
    g.font = `bold ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(b.name, cw / 2, ch / 2 - fs * 0.45);
    g.font = `${fs * 0.7}px ui-monospace, Menlo, Consolas, monospace`;
    g.fillText(`${round1(b.w)}×${round1(b.h)}×${round1(b.d)}`, cw / 2, ch / 2 + fs * 0.55);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function buildBoxMesh(b) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const side = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.6, metalness: 0.05 });
    const top = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.6, metalness: 0.05, map: labelTexture(b) });
    const mesh = new THREE.Mesh(geo, [side, side, top, side, side, side]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = b.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x05070f }));
    const group = new THREE.Group();
    group.add(mesh, edges);
    return { group, mesh, edges, mats: [side, top] };
  }

  const ghost = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
  );
  ghost.visible = false;
  scene.add(ghost);
  const dropLineGeo = new THREE.BufferGeometry();
  dropLineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
  const dropLine = new THREE.Line(dropLineGeo, new THREE.LineBasicMaterial({ color: 0xffe23f, transparent: true, opacity: 0.7 }));
  dropLine.visible = false;
  scene.add(dropLine);

  const worldX = (b) => b.x - state.pallet.w / 2 + b.w / 2;
  const worldZ = (b) => b.z - state.pallet.d / 2 + b.d / 2;
  const displayY = (b) => (b.placed ? b.y : b.y + HOVER_GAP);

  function syncMeshes() {
    const ids = new Set(state.boxes.map((b) => b.id));
    for (const [id, m] of meshes) {
      if (!ids.has(id)) { boxRoot.remove(m.group); disposeTree(m.group); meshes.delete(id); }
    }
    for (const b of state.boxes) {
      const key = `${b.w}|${b.h}|${b.d}|${b.color}|${b.name}`;
      let m = meshes.get(b.id);
      if (!m || m.key !== key) {
        if (m) { boxRoot.remove(m.group); disposeTree(m.group); }
        m = buildBoxMesh(b);
        m.key = key;
        meshes.set(b.id, m);
        boxRoot.add(m.group);
      }
      const isSel = b.id === selectedId;
      const warn = b.overhang || b.unstable || b.tooTall;
      m.edges.material.color.set(isSel ? 0xffffff : warn ? 0xff9f1c : 0x05070f);
      for (const mat of m.mats) {
        mat.emissive.set(isSel ? 0x333333 : warn ? 0x401800 : 0x000000);
        mat.transparent = !b.placed;
        mat.opacity = b.placed ? 1 : 0.72;
      }
      m.group.position.x = worldX(b);
      m.group.position.z = worldZ(b);
      if (!anim.has(b.id)) m.group.position.y = displayY(b) + b.h / 2;
    }

    const s = selected();
    if (s && !s.placed) {
      ghost.visible = dropLine.visible = true;
      ghost.scale.set(s.w, s.h, s.d);
      ghost.position.set(worldX(s), s.y + s.h / 2, worldZ(s));
      const p = dropLineGeo.attributes.position;
      p.setXYZ(0, worldX(s), s.y + s.h, worldZ(s));
      p.setXYZ(1, worldX(s), s.y + HOVER_GAP, worldZ(s));
      p.needsUpdate = true;
      dropLineGeo.computeBoundingSphere();
    } else {
      ghost.visible = dropLine.visible = false;
    }
  }

  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);

  // camera tween
  let camTween = null;
  function setView(view) {
    const P = state.pallet;
    const r = Math.max(P.w, P.d, P.maxH) * 1.55 + 60;
    const midY = P.maxH * 0.4;
    let pos, target;
    switch (view) {
      case 'top': pos = new THREE.Vector3(0, r * 2, 0.01); target = new THREE.Vector3(0, 0, 0); break;
      case 'front': pos = new THREE.Vector3(0, midY + 20, r * 1.7); target = new THREE.Vector3(0, midY, 0); break;
      case 'side': pos = new THREE.Vector3(r * 1.7, midY + 20, 0); target = new THREE.Vector3(0, midY, 0); break;
      default: pos = new THREE.Vector3(r * 0.85, r * 0.95, r * 1.15); target = new THREE.Vector3(0, P.maxH * 0.3, 0);
    }
    camTween = {
      p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(),
    };
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  }

  function tick(now) {
    if (camTween) {
      const k = Math.min(1, (now - camTween.start) / 350);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.t0, camTween.t1, e);
      if (k >= 1) camTween = null;
    }
    for (const [id, a] of anim) {
      const b = getBox(id), m = meshes.get(id);
      if (!b || !m) { anim.delete(id); continue; }
      const k = Math.min(1, (now - a.start) / DROP_MS);
      const y = a.from + (b.y - a.from) * k * k;
      m.group.position.y = y + b.h / 2;
      if (k >= 1) anim.delete(id);
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- actions
  function select(id) {
    const prev = selected();
    if (prev && prev.id !== id && !prev.placed) dropBox(prev, true);
    selectedId = id;
  }

  function spawn(spec, at) {
    const P = state.pallet;
    pushUndo();
    const b = {
      id: state.nextId++,
      name: (spec.name || 'Box').slice(0, 24),
      w: spec.w, h: spec.h, d: spec.d, color: spec.color,
      x: at ? at.x : Math.round((P.w - spec.w) / 2),
      z: at ? at.z : Math.round((P.d - spec.d) / 2),
      y: 0,
      placed: false,
    };
    clampBox(b);
    select(null);
    state.boxes.push(b);
    selectedId = b.id;
    settle();
    refresh();
    setStatus(`${b.name} is hovering — move it, then press Space to drop.`);
    return b;
  }

  function dropBox(b, quiet) {
    if (!b || b.placed) return;
    const from = b.y + HOVER_GAP;
    b.placed = true;
    b.y = landingY(b, placedBoxes());
    settle();
    anim.set(b.id, { from, start: performance.now() });
    if (!quiet) {
      refresh();
      const s = supportRatio(b, placedBoxes());
      if (onPalletArea(b) < b.w * b.d - EPS) setStatus(`${b.name} overhangs the pallet edge.`, true);
      else if (s < SUPPORT_MIN) setStatus(`${b.name} only ${Math.round(s * 100)}% supported — unstable.`, true);
      else if (b.y + b.h > state.pallet.maxH + EPS) setStatus(`${b.name} exceeds the max load height.`, true);
      else setStatus(`${b.name} placed at height ${round1(b.y)} cm.`);
    }
  }

  function liftBox(b) {
    if (!b || !b.placed) return;
    b.placed = false;
    settle();
  }

  function toggleDrop() {
    const b = selected();
    if (!b) return;
    pushUndo();
    if (b.placed) { liftBox(b); refresh(); setStatus(`${b.name} lifted — move it over the stack and drop.`); }
    else dropBox(b);
  }

  function moveSelected(dx, dz) {
    const b = selected();
    if (!b) return;
    pushUndo();
    b.x = round1(b.x + dx);
    b.z = round1(b.z + dz);
    clampBox(b);
    settle(b.id);
    refresh();
  }

  function rotateSelected() {
    const b = selected();
    if (!b) return;
    pushUndo();
    [b.w, b.d] = [b.d, b.w];
    clampBox(b);
    settle(b.id);
    refresh();
    setStatus(`${b.name} rotated: ${round1(b.w)} wide × ${round1(b.d)} deep.`);
  }

  function tipSelected() {
    const b = selected();
    if (!b) return;
    pushUndo();
    [b.h, b.d] = [b.d, b.h];
    clampBox(b);
    settle(b.id);
    refresh();
    setStatus(`${b.name} tipped over: now ${round1(b.h)} cm tall.`);
  }

  function deleteSelected() {
    const b = selected();
    if (!b) return;
    pushUndo();
    state.boxes = state.boxes.filter((o) => o !== b);
    selectedId = null;
    settle();
    refresh();
    setStatus(`${b.name} removed.`);
  }

  function duplicateSelected() {
    const b = selected();
    if (!b) return;
    spawn(b, { x: b.x, z: b.z });
  }

  function cycleSelection(dir) {
    if (!state.boxes.length) return;
    const i = state.boxes.findIndex((b) => b.id === selectedId);
    const n = state.boxes.length;
    const next = state.boxes[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + n) % n];
    select(next.id);
    refresh();
  }

  // Best resting spot for `b` among `others`: lowest, then furthest back, then
  // furthest left, fully on the pallet, well supported and under the height
  // limit. Tries both horizontal orientations. Returns null if nothing fits.
  function findSpot(b, others) {
    const P = state.pallet;
    let best = null;
    const orients = b.w === b.d ? [[b.w, b.d]] : [[b.w, b.d], [b.d, b.w]];
    for (const [w, d] of orients) {
      if (w > P.w + EPS || d > P.d + EPS) continue;
      const xs = new Set([0, P.w - w]);
      const zs = new Set([0, P.d - d]);
      for (const o of others) {
        xs.add(o.x + o.w); xs.add(o.x - w); xs.add(o.x); xs.add(o.x + o.w - w);
        zs.add(o.z + o.d); zs.add(o.z - d); zs.add(o.z); zs.add(o.z + o.d - d);
      }
      for (const x of xs) {
        if (x < -EPS || x + w > P.w + EPS) continue;
        for (const z of zs) {
          if (z < -EPS || z + d > P.d + EPS) continue;
          const c = { x, z, w, d, h: b.h, y: 0 };
          c.y = landingY(c, others);
          if (c.y + b.h > P.maxH + EPS) continue;
          if (supportRatio(c, others) < SUPPORT_MIN) continue;
          if (!best || c.y < best.y - EPS ||
              (Math.abs(c.y - best.y) < EPS && (c.z < best.z - EPS ||
              (Math.abs(c.z - best.z) < EPS && c.x < best.x)))) best = c;
        }
      }
    }
    return best;
  }

  function autoPlace(b) {
    const others = placedBoxes().filter((o) => o !== b);
    const spot = findSpot(b, others);
    if (!spot) return false;
    const from = displayY(b);
    b.x = round1(spot.x); b.z = round1(spot.z); b.w = spot.w; b.d = spot.d;
    b.placed = true;
    b.y = spot.y;
    anim.set(b.id, { from, start: performance.now() });
    return true;
  }

  function autoPlaceSelected() {
    const b = selected();
    if (!b) return;
    pushUndo();
    if (b.placed) liftBox(b);
    if (autoPlace(b)) {
      settle();
      refresh();
      setStatus(`${b.name} auto-placed at x ${b.x}, z ${b.z}, height ${round1(b.y)} cm.`);
    } else {
      refresh();
      setStatus(`No safe spot found for ${b.name} — it is left hovering.`, true);
    }
  }

  function autoPackAll() {
    if (!state.boxes.length) return setStatus('Nothing to pack.');
    pushUndo();
    const order = [...state.boxes].sort((a, b) =>
      b.w * b.d - a.w * a.d || b.h - a.h || a.id - b.id);
    for (const b of order) { b.placed = false; b.y = 0; }
    let failed = 0;
    for (const b of order) {
      if (!autoPlace(b)) { failed++; b.x = -b.w - 20; b.z = 0; b.placed = true; }
    }
    settle();
    refresh();
    setStatus(failed
      ? `Packed ${order.length - failed} pieces; ${failed} did not fit and were set beside the pallet.`
      : `Packed all ${order.length} pieces.`, failed > 0);
  }

  function updatePallet(key, value) {
    const v = num(value, state.pallet[key]);
    if (v === state.pallet[key]) return;
    pushUndo();
    state.pallet[key] = v;
    rebuildPallet();
    settle();
    refresh();
  }

  // ---------------------------------------------------------------- UI
  function setStatus(msg, warn) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
  }

  function fmt(v) { return `${round1(v)}`; }
  function pct(v) { return `${Math.round(v * 1000) / 10}%`; }

  function buildSwatches(container, onPick) {
    container.innerHTML = '';
    for (const c of PALETTE) {
      const btn = document.createElement('button');
      btn.style.background = c;
      btn.title = c;
      btn.dataset.color = c;
      btn.addEventListener('click', () => onPick(c));
      container.appendChild(btn);
    }
  }
  function markSwatch(container, color) {
    for (const btn of container.children) btn.classList.toggle('on', btn.dataset.color === color.toLowerCase());
  }

  function drawPreview() {
    const cv = $('preview');
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const { w, h, d, color } = draft;
    const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
    const proj = (x, y, z) => [(x - z) * c30, (x + z) * s30 - y];
    const corners = [];
    for (const x of [0, w]) for (const y of [0, h]) for (const z of [0, d]) corners.push(proj(x, y, z));
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((W - 40) / (maxX - minX), (H - 30) / (maxY - minY));
    const ox = (W - (maxX - minX) * s) / 2 - minX * s, oy = (H - (maxY - minY) * s) / 2 - minY * s;
    const P = (x, y, z) => { const p = proj(x, y, z); return [ox + p[0] * s, oy + p[1] * s]; };
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.min(255, ((n >> 16) & 255) * k), gg = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
      return `rgb(${r | 0},${gg | 0},${b | 0})`;
    };
    const face = (pts, fillStyle) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = fillStyle; g.fill();
      g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    };
    face([P(0, h, 0), P(w, h, 0), P(w, h, d), P(0, h, d)], shade(color, 1.15));
    face([P(w, 0, 0), P(w, h, 0), P(w, h, d), P(w, 0, d)], shade(color, 0.7));
    face([P(0, 0, d), P(w, 0, d), P(w, h, d), P(0, h, d)], shade(color, 0.9));
    g.fillStyle = '#8592c4';
    g.font = '11px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(`${fmt(w)} W × ${fmt(h)} H × ${fmt(d)} D`, W / 2, H - 6);
  }

  function syncDraftInputs() {
    $('dName').value = draft.name;
    $('dW').value = draft.w; $('dH').value = draft.h; $('dD').value = draft.d;
    $('dColor').value = draft.color;
    markSwatch($('dSwatches'), draft.color);
    drawPreview();
  }

  function syncPalletInputs() {
    const P = state.pallet;
    $('pW').value = P.w; $('pD').value = P.d; $('pT').value = P.t; $('pMax').value = P.maxH;
  }

  function renderSelected() {
    const b = selected();
    const card = $('selCard');
    card.classList.toggle('empty', !b);
    const tag = $('selTag');
    if (!b) { tag.textContent = ''; return; }
    tag.textContent = b.placed ? `#${b.id}` : `#${b.id} HOVER`;
    tag.classList.toggle('hover', !b.placed);
    const setIfIdle = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    setIfIdle('sName', b.name);
    setIfIdle('sW', b.w); setIfIdle('sH', b.h); setIfIdle('sD', b.d);
    setIfIdle('sX', b.x); setIfIdle('sZ', b.z);
    $('sY').value = round1(b.y);
    setIfIdle('sColor', b.color);
    markSwatch($('sSwatches'), b.color);
    $('btnDrop').textContent = b.placed ? 'LIFT' : 'DROP';

    const warns = [];
    if (b.aside) {
      warns.push('Set aside — not on the pallet');
    } else if (b.placed) {
      if (b.overhang) warns.push('⚠ Overhangs the pallet edge');
      if (b.unstable) warns.push(`⚠ Only ${Math.round(b.support * 100)}% of its base is supported`);
      if (b.tooTall) warns.push(`⚠ Top at ${fmt(b.y + b.h)} cm exceeds ${fmt(state.pallet.maxH)} cm limit`);
    } else {
      warns.push('Hovering — press Space / DROP to place');
    }
    $('selWarn').textContent = warns.join('\n');
    $('selWarn').style.whiteSpace = 'pre-line';
  }

  function renderList() {
    const ul = $('pieceList');
    ul.innerHTML = '';
    if (!state.boxes.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No pieces yet.';
      ul.appendChild(li);
      return;
    }
    for (const b of state.boxes) {
      const li = document.createElement('li');
      li.classList.toggle('sel', b.id === selectedId);
      const flags = [];
      if (!b.placed) flags.push('hover');
      if (b.aside) flags.push('set aside');
      if (b.overhang) flags.push('overhang');
      if (b.unstable) flags.push('unstable');
      if (b.tooTall) flags.push('tall');
      li.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="dm"></span>';
      li.children[0].style.background = b.color;
      li.children[1].textContent = `#${b.id} ${b.name}`;
      if (flags.length) {
        const f = document.createElement('span');
        f.className = 'fl';
        f.textContent = `⚠ ${flags.join(', ')}`;
        li.children[1].appendChild(f);
      }
      li.children[2].textContent = `${fmt(b.w)}×${fmt(b.h)}×${fmt(b.d)}`;
      li.addEventListener('click', () => { select(b.id); refresh(); });
      ul.appendChild(li);
    }
  }

  function renderStats(st) {
    const P = state.pallet;
    $('sUnits').textContent = st.units;
    $('sHeight').textContent = `${fmt(st.top)} / ${fmt(P.maxH)} cm`;
    $('sHeight').classList.toggle('bad', st.top > P.maxH + EPS);
    $('sVol').textContent = `${(st.vol / 1e6).toFixed(3)} m³`;
    $('sFloor').textContent = pct(st.floor);
    $('sDensity').textContent = st.density == null ? '–' : pct(st.density);
    $('sIssues').textContent = st.issues;
    $('sIssues').classList.toggle('bad', st.issues > 0);
    $('sIssues').classList.toggle('good', st.issues === 0 && st.units > 0);
    $('sFill').textContent = pct(st.fill);
    $('meterFill').style.height = `${Math.min(100, st.fill * 100)}%`;
  }

  function renderHud(st) {
    const b = selected();
    const P = state.pallet;
    let s = `PALLET ${fmt(P.w)}×${fmt(P.d)}  UNITS ${st.units}  HEIGHT ${fmt(st.top)}`;
    if (b) s += `\n▶ ${b.name.toUpperCase()}  X${fmt(b.x)} Z${fmt(b.z)} Y${fmt(b.y)}${b.placed ? '' : '  [SPACE=DROP]'}`;
    $('hud').textContent = s;
  }

  function refresh() {
    const st = analyse();
    syncMeshes();
    renderSelected();
    renderList();
    renderStats(st);
    renderHud(st);
    save();
  }

  // ---------------------------------------------------------------- input wiring
  function wireUI() {
    // pallet
    const pp = $('palletPresets');
    for (const p of PALLET_PRESETS) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        pushUndo();
        state.pallet.w = p.w; state.pallet.d = p.d;
        rebuildPallet(); settle(); syncPalletInputs(); refresh();
        setStatus(`Pallet set to ${p.w} × ${p.d} cm.`);
      });
      pp.appendChild(btn);
    }
    [['pW', 'w'], ['pD', 'd'], ['pT', 't'], ['pMax', 'maxH']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => { updatePallet(key, e.target.value); syncPalletInputs(); });
    });

    // draft / next piece
    const bp = $('boxPresets');
    for (const p of BOX_PRESETS) {
      const btn = document.createElement('button');
      btn.innerHTML = '<span class="sw"></span>';
      btn.firstChild.style.background = p.color;
      btn.appendChild(document.createTextNode(p.name.toUpperCase()));
      btn.title = `${p.w} W × ${p.h} H × ${p.d} D cm`;
      btn.addEventListener('click', () => { Object.assign(draft, p); syncDraftInputs(); });
      bp.appendChild(btn);
    }
    $('dName').addEventListener('input', (e) => { draft.name = e.target.value || 'Box'; });
    [['dW', 'w'], ['dH', 'h'], ['dD', 'd']].forEach(([id, key]) => {
      $(id).addEventListener('input', (e) => { draft[key] = num(e.target.value, draft[key]); drawPreview(); });
      $(id).addEventListener('change', () => syncDraftInputs());
    });
    $('dColor').addEventListener('input', (e) => { draft.color = e.target.value; markSwatch($('dSwatches'), draft.color); drawPreview(); });
    buildSwatches($('dSwatches'), (c) => { draft.color = c; syncDraftInputs(); });
    $('btnAdd').addEventListener('click', () => spawn(draft));

    // selected piece
    buildSwatches($('sSwatches'), (c) => {
      const b = selected(); if (!b) return;
      pushUndo(); b.color = c; refresh();
    });
    let colorEditing = false;
    $('sColor').addEventListener('input', (e) => {
      const b = selected(); if (!b) return;
      if (!colorEditing) { pushUndo(); colorEditing = true; }
      b.color = e.target.value; refresh();
    });
    $('sColor').addEventListener('change', () => { colorEditing = false; });
    $('sName').addEventListener('change', (e) => {
      const b = selected(); if (!b) return;
      pushUndo(); b.name = (e.target.value || 'Box').slice(0, 24); refresh();
    });
    [['sW', 'w'], ['sH', 'h'], ['sD', 'd']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => {
        const b = selected(); if (!b) return;
        const v = num(e.target.value, b[key]);
        if (v !== b[key]) { pushUndo(); b[key] = v; clampBox(b); settle(b.id); }
        e.target.value = b[key];
        refresh();
      });
    });
    [['sX', 'x'], ['sZ', 'z']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => {
        const b = selected(); if (!b) return;
        const v = Number.isFinite(+e.target.value) ? round1(+e.target.value) : b[key];
        if (v !== b[key]) { pushUndo(); b[key] = v; clampBox(b); settle(b.id); }
        e.target.value = b[key];
        refresh();
      });
    });
    document.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => moveRelative(btn.dataset.move, false));
    });
    $('btnDrop').addEventListener('click', toggleDrop);
    $('btnRotate').addEventListener('click', rotateSelected);
    $('btnTip').addEventListener('click', tipSelected);
    $('btnAuto').addEventListener('click', autoPlaceSelected);
    $('btnDup').addEventListener('click', duplicateSelected);
    $('btnDelete').addEventListener('click', deleteSelected);
    $('stepSel').addEventListener('change', (e) => { step = +e.target.value; });

    // toolbar
    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $('btnUndo').addEventListener('click', undo);
    $('btnAutoAll').addEventListener('click', autoPackAll);
    $('btnClear').addEventListener('click', () => {
      if (!state.boxes.length) return;
      if (!confirm('Remove every piece from the pallet?')) return;
      pushUndo(); state.boxes = []; selectedId = null; refresh();
      setStatus('Pallet cleared. (Ctrl+Z to undo)');
    });
    $('btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(JSON.parse(snapshot()), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pallet-${state.pallet.w}x${state.pallet.d}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('btnImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const before = snapshot();
      try {
        restore(await f.text());
        undoStack.push(before);
        rebuildPallet(); syncPalletInputs(); refresh();
        setStatus(`Loaded ${f.name}.`);
      } catch (err) {
        restore(before);
        setStatus(`Could not load ${f.name}: ${err.message}`, true);
      }
    });
  }

  // Arrow keys move relative to the camera: "up" pushes the piece away from you.
  function moveRelative(dir, fine) {
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    let fx = f.x, fz = f.z;
    if (Math.abs(fx) < 1e-4 && Math.abs(fz) < 1e-4) { fx = 0; fz = -1; }
    const fwd = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    const right = [-fwd[1], fwd[0]];
    const s = fine ? 1 : step;
    const v = { up: fwd, down: [-fwd[0], -fwd[1]], right, left: [-right[0], -right[1]] }[dir];
    moveSelected(v[0] * s, v[1] * s);
  }

  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (arrows[k]) { e.preventDefault(); moveRelative(arrows[k], e.shiftKey); return; }
      switch (k.toLowerCase()) {
        case ' ': e.preventDefault(); toggleDrop(); break;
        case 'enter': case 'n': spawn(draft); break;
        case 'r': rotateSelected(); break;
        case 't': tipSelected(); break;
        case 'd': duplicateSelected(); break;
        case 'a': autoPlaceSelected(); break;
        case 'delete': case 'backspace': e.preventDefault(); deleteSelected(); break;
        case 'tab': e.preventDefault(); cycleSelection(e.shiftKey ? -1 : 1); break;
        case 'escape': select(null); refresh(); break;
        case '1': setView('3d'); break;
        case '2': setView('top'); break;
        case '3': setView('front'); break;
        case '4': setView('side'); break;
        default: return;
      }
    });
  }

  // Mouse: click selects; dragging a box lifts it and carries it across the
  // pallet; releasing drops it onto whatever is beneath.
  function wirePointer() {
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let ptr = null;

    function setRay(e) {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    }
    function pick(e) {
      setRay(e);
      const hits = ray.intersectObjects([...meshes.values()].map((m) => m.mesh), false);
      return hits.length ? { id: hits[0].object.userData.id, point: hits[0].point } : null;
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const hit = pick(e);
      ptr = { sx: e.clientX, sy: e.clientY, hit, dragging: false };
      if (hit) controls.enabled = false;
    });

    window.addEventListener('pointermove', (e) => {
      if (!ptr || !ptr.hit) return;
      const b = getBox(ptr.hit.id);
      if (!b) return;
      if (!ptr.dragging) {
        if (Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) < 5) return;
        ptr.dragging = true;
        pushUndo();
        select(b.id);
        liftBox(b);
        const P = state.pallet;
        ptr.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ptr.hit.point.y);
        ptr.off = { x: b.x - (ptr.hit.point.x + P.w / 2), z: b.z - (ptr.hit.point.z + P.d / 2) };
        el.style.cursor = 'grabbing';
      }
      setRay(e);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(ptr.plane, p)) return;
      const P = state.pallet;
      const snap = e.shiftKey ? 1 : step;
      const nx = Math.round((p.x + P.w / 2 + ptr.off.x) / snap) * snap;
      const nz = Math.round((p.z + P.d / 2 + ptr.off.z) / snap) * snap;
      if (nx !== b.x || nz !== b.z) {
        b.x = nx; b.z = nz;
        clampBox(b);
        settle();
        refresh();
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (!ptr) return;
      const p = ptr;
      ptr = null;
      controls.enabled = true;
      el.style.cursor = '';
      if (p.dragging) {
        dropBox(getBox(p.hit.id));
        return;
      }
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (e.target !== el || moved > 5) return;   // orbiting, not clicking
      select(p.hit ? p.hit.id : null);
      refresh();
    });
  }

  // ---------------------------------------------------------------- boot
  load();
  rebuildPallet();
  syncPalletInputs();
  syncDraftInputs();
  wireUI();
  wireKeys();
  wirePointer();
  resize();
  setView('3d');
  camera.position.copy(camTween.p1);
  controls.target.copy(camTween.t1);
  camTween = null;
  refresh();
  if (state.boxes.length) setStatus(`Restored ${state.boxes.length} pieces from your last session.`);
  requestAnimationFrame(tick);

  // exposed for debugging / tests
  window.stacker = { state, spawn, autoPackAll, analyse, findSpot, settle, refresh, select, draft };
})();
