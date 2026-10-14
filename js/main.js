/* Cupboard Stacker — stack kitchen units on pallets.
 *
 * Units are centimetres. Data coordinates are a flat floor plan: x runs left to
 * right, z runs back to front, y is height above the pallet deck. Pallets and
 * pieces store their back-left(-bottom) corner. Every pallet deck sits at y = 0.
 *
 * Piece shapes:
 *   'cab' — a hollow cabinet carcass: two sides, a back, a base and an optional
 *           lid, all `board` thick, with an open front. Units can sit inside it.
 *   'box' — a solid block.   'cyl' — a solid cylinder (diameter = w = d).
 *   'L'   — a solid L-shaped corner unit whose arms are `arm` deep.
 * A piece is placed by `tip` (0 upright, 1 lying on its back) then `rot`
 * (quarter turns in plan). w/h/d always hold the placed bounding size;
 * origDims() recovers the unit's own width/height/depth.
 *
 * Every piece reduces to "parts": rectangles or circles in plan, each with a
 * local height range. Gravity, collision, support and coverage all work on
 * parts, which is what lets a unit drop into an open cabinet.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'cupboard-stacker-v1';
  const CLIP_TAG = 'cupboard-stacker/clip';
  const EPS = 0.01;
  const HOVER_GAP = 30;        // how high a lifted piece floats above where it would land
  const DROP_MS = 160;
  const SAMPLES = 16;          // grid resolution for curved-footprint overlap estimates
  const MARGIN = 150;          // how far off the pallets a piece may wander
  const BOARD = 1.8;           // default carcass board thickness (18 mm)

  const SHAPES = [
    { key: 'cab', label: 'CABINET' },
    { key: 'box', label: 'SOLID BOX' },
    { key: 'cyl', label: 'CYLINDER' },
    { key: 'L', label: 'L-CORNER' },
  ];

  const PALLET_PRESETS = [
    { name: 'EURO 120×80', w: 120, d: 80 },
    { name: 'UK 120×100', w: 120, d: 100 },
    { name: 'HALF 80×60', w: 80, d: 60 },
    { name: 'US 122×102', w: 122, d: 102 },
  ];

  const BOX_PRESETS = [
    { name: 'Base 600', shape: 'cab', w: 60, h: 72, d: 56, board: BOARD, lid: false, color: '#4f8cff' },
    { name: 'Base 400', shape: 'cab', w: 40, h: 72, d: 56, board: BOARD, lid: false, color: '#3fc1c9' },
    { name: 'Base 1000', shape: 'cab', w: 100, h: 72, d: 56, board: BOARD, lid: false, color: '#5b6cff' },
    { name: 'Drawer 500', shape: 'cab', w: 50, h: 72, d: 56, board: BOARD, lid: false, color: '#2ec4b6' },
    { name: 'Wall 600', shape: 'cab', w: 60, h: 72, d: 32, board: BOARD, lid: true, color: '#ffd23f' },
    { name: 'Wall 300', shape: 'cab', w: 30, h: 72, d: 32, board: BOARD, lid: true, color: '#f4a261' },
    { name: 'Tall 600', shape: 'cab', w: 60, h: 200, d: 56, board: BOARD, lid: true, color: '#9b5de5' },
    { name: 'Carton 600', shape: 'box', w: 60, h: 40, d: 60, color: '#8d6e63' },
    { name: 'Corner L 900', shape: 'L', w: 90, h: 72, d: 90, arm: 56, color: '#06d6a0' },
    { name: 'Drum Ø60', shape: 'cyl', w: 60, h: 90, d: 60, color: '#e0e0e0' },
    { name: 'Tube Ø30', shape: 'cyl', w: 30, h: 120, d: 30, color: '#607d8b' },
  ];

  const PALETTE = ['#4f8cff', '#3fc1c9', '#2ec4b6', '#06d6a0', '#a3e635', '#ffd23f',
                   '#f4a261', '#9b5de5', '#f15bb5', '#e0e0e0', '#8d6e63', '#607d8b'];

  // ---------------------------------------------------------------- state
  const state = {
    pallets: [{ id: 1, x: 0, z: 0, w: 120, d: 80, t: 10 }],
    maxH: 200,
    gap: 0,
    noPallet: false,  // size a load on the open floor, with no pallet
    boxes: [],      // { id, name, shape, w, h, d, arm, rot, color, x, z, y, placed, hy }
    nextId: 1,
    nextPalletId: 2,
  };
  let sel = new Set();          // selected piece ids
  let primaryId = null;         // the piece whose values the panel shows
  let palletSelId = 1;
  let step = 5;
  let clipboard = null;         // array of piece specs (internal copy/paste buffer)
  const undoStack = [];

  const getBox = (id) => state.boxes.find((b) => b.id === id) || null;
  const getPallet = (id) => state.pallets.find((p) => p.id === id) || null;
  const selPallet = () => getPallet(palletSelId) || state.pallets[0];
  const selectedBoxes = () => state.boxes.filter((b) => sel.has(b.id));
  const primary = () => (primaryId == null ? null : getBox(primaryId));
  const placedBoxes = () => state.boxes.filter((b) => b.placed);
  const round1 = (v) => Math.round(v * 10) / 10;
  const num = (v, fallback) => (Number.isFinite(+v) && +v > 0 ? +v : fallback);
  const fmt = (v) => `${round1(v)}`;
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;

  // The unit's own [width, height, depth], undoing tip and rotation.
  function origDims(b) {
    const W = b.rot % 2 ? b.d : b.w, D = b.rot % 2 ? b.w : b.d;
    return b.tip ? [W, D, b.h] : [W, b.h, D];
  }
  // Set the placed bounding size from the unit's own dimensions.
  function applyDims(b, W0, H0, D0) {
    const [W1, H1, D1] = b.tip ? [W0, D0, H0] : [W0, H0, D0];
    if (b.rot % 2) { b.w = D1; b.d = W1; } else { b.w = W1; b.d = D1; }
    b.h = H1;
  }

  // Fill in / repair the shape-related fields of a piece or spec.
  function normalizeShape(s) {
    if (!SHAPES.some((x) => x.key === s.shape)) s.shape = 'box';
    s.w = num(s.w, 60); s.h = num(s.h, 72); s.d = num(s.d, 56);
    s.rot = ((s.rot | 0) % 4 + 4) % 4;
    s.tip = s.tip ? 1 : 0;
    const o = origDims(s);
    if (s.shape === 'cyl') { s.rot = 0; s.tip = 0; o[2] = o[0]; }
    if (s.shape === 'L') s.tip = 0;
    applyDims(s, o[0], o[1], o[2]);
    const lim = Math.min(s.w, s.d);
    s.arm = s.shape === 'L'
      ? Math.min(Math.max(num(s.arm, Math.round(lim * 0.6)), 1), Math.max(1, lim - 1))
      : undefined;
    if (s.shape === 'cab') {
      const maxB = Math.max(0.1, Math.min(o[0] / 2, o[1] / 2, o[2]) - 0.5);
      s.board = Math.min(Math.max(num(s.board, BOARD), 0.1), maxB);
      s.lid = s.lid !== false;
    } else {
      s.board = undefined;
      s.lid = undefined;
    }
    return s;
  }

  function makeBox(raw, id) {
    return normalizeShape({
      id,
      name: String(raw.name || 'Box').slice(0, 24),
      shape: raw.shape,
      w: raw.w, h: raw.h, d: raw.d, arm: raw.arm, rot: raw.rot, tip: raw.tip, board: raw.board, lid: raw.lid,
      color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : '#4f8cff',
      x: round1(+raw.x || 0), z: round1(+raw.z || 0), y: +raw.y || 0,
      placed: raw.placed !== false,
      hy: +raw.hy || 0,
    });
  }

  const draft = normalizeShape({ ...BOX_PRESETS[0] });

  // ---------------------------------------------------------------- geometry
  function overlapLen(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }

  // L outline + rectangles in the piece's own bounding box (0..w, 0..d).
  function localL(b) {
    const k = b.rot & 3;
    let W = k % 2 ? b.d : b.w, D = k % 2 ? b.w : b.d;
    const a = b.arm;
    let rects = [{ x0: 0, x1: W, z0: 0, z1: a }, { x0: 0, x1: a, z0: a, z1: D }];
    let poly = [[0, 0], [W, 0], [W, a], [a, a], [a, D], [0, D]];
    for (let i = 0; i < k; i++) {   // rotate 90° clockwise in plan: (x, z) -> (D - z, x)
      const DD = D;
      rects = rects.map((r) => ({ x0: DD - r.z1, x1: DD - r.z0, z0: r.x0, z1: r.x1 }));
      poly = poly.map(([x, z]) => [DD - z, x]);
      [W, D] = [D, W];
    }
    return { rects, poly };
  }

  // Boards of a box / cabinet as local boxes inside the placed bounding box.
  function panelsLocal(b) {
    const [W0, H0, D0] = origDims(b);
    let list;
    if (b.shape === 'cab') {
      const t = b.board;
      list = [
        [0, t, 0, H0, 0, D0],                 // left side
        [W0 - t, W0, 0, H0, 0, D0],           // right side
        [t, W0 - t, 0, H0, 0, t],             // back
        [t, W0 - t, 0, t, t, D0],             // base
      ];
      if (b.lid) list.push([t, W0 - t, H0 - t, H0, t, D0]);
    } else {
      list = [[0, W0, 0, H0, 0, D0]];
    }
    list = list.map(([x0, x1, y0, y1, z0, z1]) => ({ x0, x1, y0, y1, z0, z1 }));
    let H = H0, D = D0, W = W0;
    if (b.tip) {   // lie on its back: (y, z) -> (z, H - y); the open front faces up
      list = list.map((p) => ({ x0: p.x0, x1: p.x1, y0: p.z0, y1: p.z1, z0: H - p.y1, z1: H - p.y0 }));
      [H, D] = [D, H];
    }
    for (let i = 0; i < b.rot; i++) {
      const DD = D;
      list = list.map((p) => ({ x0: DD - p.z1, x1: DD - p.z0, y0: p.y0, y1: p.y1, z0: p.x0, z1: p.x1 }));
      [W, D] = [D, W];
    }
    return list;
  }

  function localOutline(b) {
    if (b.shape === 'cyl') {
      const r = b.w / 2, pts = [];
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        pts.push([r + r * Math.cos(t), r + r * Math.sin(t)]);
      }
      return pts;
    }
    if (b.shape === 'L') return localL(b).poly;
    return [[0, 0], [b.w, 0], [b.w, b.d], [0, b.d]];
  }

  // World-space parts: plan primitive + local height range, memoised on the piece.
  function parts(b) {
    const key = `${b.shape}|${b.x}|${b.z}|${b.w}|${b.h}|${b.d}|${b.rot}|${b.tip}|${b.arm}|${b.board}|${b.lid}`;
    if (b._pk === key) return b._parts;
    let p;
    if (b.shape === 'cyl') {
      p = [{ c: 1, cx: b.x + b.w / 2, cz: b.z + b.d / 2, r: b.w / 2, x0: b.x, x1: b.x + b.w, z0: b.z, z1: b.z + b.d, y0: 0, y1: b.h }];
    } else if (b.shape === 'L') {
      p = localL(b).rects.map((r) => ({ c: 0, x0: b.x + r.x0, x1: b.x + r.x1, z0: b.z + r.z0, z1: b.z + r.z1, y0: 0, y1: b.h }));
    } else {
      p = panelsLocal(b).map((q) => ({ c: 0, x0: b.x + q.x0, x1: b.x + q.x1, z0: b.z + q.z0, z1: b.z + q.z1, y0: q.y0, y1: q.y1 }));
    }
    Object.defineProperty(b, '_pk', { value: key, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(b, '_parts', { value: p, writable: true, configurable: true, enumerable: false });
    return p;
  }
  const palletPrim = (P) => ({ c: 0, x0: P.x, x1: P.x + P.w, z0: P.z, z1: P.z + P.d });

  const primArea = (p) => (p.c ? Math.PI * p.r * p.r : (p.x1 - p.x0) * (p.z1 - p.z0));
  const inPrim = (p, x, z) => (p.c
    ? (x - p.cx) ** 2 + (z - p.cz) ** 2 <= p.r * p.r
    : x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);

  function primIntersects(p, q) {
    if (overlapLen(p.x0, p.x1, q.x0, q.x1) <= EPS || overlapLen(p.z0, p.z1, q.z0, q.z1) <= EPS) return false;
    if (!p.c && !q.c) return true;
    if (p.c && q.c) return Math.hypot(p.cx - q.cx, p.cz - q.cz) < p.r + q.r - EPS;
    const c = p.c ? p : q, r = p.c ? q : p;
    const dx = Math.min(Math.max(c.cx, r.x0), r.x1) - c.cx;
    const dz = Math.min(Math.max(c.cz, r.z0), r.z1) - c.cz;
    return Math.hypot(dx, dz) < c.r - EPS;
  }

  function primOverlap(p, q) {
    const ox = overlapLen(p.x0, p.x1, q.x0, q.x1), oz = overlapLen(p.z0, p.z1, q.z0, q.z1);
    if (ox <= EPS || oz <= EPS) return 0;
    if (!p.c && !q.c) return ox * oz;
    // Sample the shared bounding rectangle and count points inside both shapes.
    const x0 = Math.max(p.x0, q.x0), z0 = Math.max(p.z0, q.z0);
    let n = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const x = x0 + ((i + 0.5) / SAMPLES) * ox;
      for (let j = 0; j < SAMPLES; j++) {
        const z = z0 + ((j + 0.5) / SAMPLES) * oz;
        if (inPrim(p, x, z) && inPrim(q, x, z)) n++;
      }
    }
    return (n / (SAMPLES * SAMPLES)) * ox * oz;
  }

  // True footprint area in plan (the outline, not the sum of boards).
  function planArea(b) {
    if (b.shape === 'cyl') return Math.PI * (b.w / 2) ** 2;
    if (b.shape === 'L') return localL(b).rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    return b.w * b.d;
  }
  const envelopeVolume = (b) => planArea(b) * b.h;
  const partsArea = (b) => parts(b).reduce((s, p) => s + primArea(p), 0);

  const bboxOverlap = (a, b) => overlapLen(a.x, a.x + a.w, b.x, b.x + b.w) > EPS && overlapLen(a.z, a.z + a.d, b.z, b.z + b.d) > EPS;

  function onPalletArea(b, P) {
    const pp = palletPrim(P);
    return parts(b).reduce((s, p) => s + primOverlap(p, pp), 0);
  }

  // Lowest height <= start that `b` can fall to: it stops on the first board
  // below each of its own boards. Boards above `start` are ignored, so a unit
  // inside a lidded cabinet stays under the lid.
  function fallY(b, others, start) {
    let y = 0;
    for (const o of others) {
      if (o === b || !bboxOverlap(b, o)) continue;
      for (const p of parts(b)) {
        for (const q of parts(o)) {
          const top = o.y + q.y1;
          if (top - p.y0 > y && top <= start + p.y0 + EPS && primIntersects(p, q)) y = top - p.y0;
        }
      }
    }
    return y;
  }

  // If `b` at height y cuts through another piece, step it up onto the
  // obstruction, repeating until it is clear. This is how a unit slid against
  // a cabinet's base climbs in through the open front, or onto a piece it hits.
  function climbY(b, others, y) {
    for (let iter = 0; iter < 100; iter++) {
      let next = Infinity;
      for (const o of others) {
        if (o === b || !bboxOverlap(b, o)) continue;
        for (const p of parts(b)) {
          for (const q of parts(o)) {
            if (y + p.y0 < o.y + q.y1 - EPS && o.y + q.y0 < y + p.y1 - EPS && primIntersects(p, q)) {
              next = Math.min(next, o.y + q.y1 - p.y0);
            }
          }
        }
      }
      if (next === Infinity) return y;
      y = next;
    }
    return y;
  }

  // Where `b` touches what is under it: contact area, the bounding box of the
  // contact patches, and whether its centre of weight sits over them.
  function contact(b, others) {
    let area = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (p, q) => {
      const a = primOverlap(p, q);
      if (a <= EPS) return;
      area += a;
      x0 = Math.min(x0, Math.max(p.x0, q.x0)); x1 = Math.max(x1, Math.min(p.x1, q.x1));
      z0 = Math.min(z0, Math.max(p.z0, q.z0)); z1 = Math.max(z1, Math.min(p.z1, q.z1));
    };
    for (const p of parts(b)) {
      const bottom = b.y + p.y0;
      if (bottom < EPS) {
        if (state.noPallet) add(p, p);   // the floor holds the whole board
        else for (const P of state.pallets) add(p, palletPrim(P));
        continue;
      }
      for (const o of others) {
        if (o === b || !bboxOverlap(b, o)) continue;
        for (const q of parts(o)) if (Math.abs(o.y + q.y1 - bottom) < EPS) add(p, q);
      }
    }
    // Centre of weight: area-weighted centre of the plan outline.
    let cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    if (b.shape === 'L') {
      let s = 0; cx = 0; cz = 0;
      for (const r of localL(b).rects) {
        const a = (r.x1 - r.x0) * (r.z1 - r.z0);
        cx += a * (b.x + (r.x0 + r.x1) / 2); cz += a * (b.z + (r.z0 + r.z1) / 2); s += a;
      }
      cx /= s; cz /= s;
    }
    const stable = area > EPS && cx >= x0 - 0.5 && cx <= x1 + 0.5 && cz >= z0 - 0.5 && cz <= z1 + 0.5;
    const spread = area > EPS ? Math.min((x1 - x0) / b.w, (z1 - z0) / b.d) : 0;
    return { area, support: Math.min(1, area / planArea(b)), stable, spread };
  }

  // Gravity. Placed pieces are processed bottom-up; each first climbs out of
  // anything it overlaps, then falls onto whatever is below. Pieces in `slid`
  // sort after others at the same level. A few passes let the order settle.
  // Hovering pieces are then dropped from above, in their own stacking order.
  function settle(slid) {
    let done = [];
    for (let pass = 0; pass < 6; pass++) {
      const list = placedBoxes();
      list.sort((a, b) => {
        if (Math.abs(a.y - b.y) > EPS) return a.y - b.y;
        const sa = !!(slid && slid.has(a.id)), sb = !!(slid && slid.has(b.id));
        if (sa !== sb) return sa ? 1 : -1;
        return a.id - b.id;
      });
      done = [];
      let changed = false;
      for (const b of list) {
        const y = fallY(b, done, climbY(b, done, b.y));
        if (Math.abs(y - b.y) > EPS) changed = true;
        b.y = y;
        done.push(b);
      }
      if (!changed) break;
    }
    const hov = state.boxes.filter((b) => !b.placed).sort((a, b) => a.hy - b.hy || a.id - b.id);
    for (const b of hov) { b.y = fallY(b, done, Infinity); done.push(b); }
  }

  // Height a piece would land at if dropped from above onto `others`.
  const landingY = (b, others) => fallY(b, others, Infinity);

  // Bounds of the placed load, or null when nothing is placed.
  function loadBounds() {
    const list = placedBoxes();
    if (!list.length) return null;
    return { ...groupBounds(list), y1: Math.max(...list.map((b) => b.y + b.h)) };
  }

  // The area the scene is framed around: the pallets, or in no-pallet mode
  // the load itself (with a sensible minimum).
  function palletBounds() {
    if (state.noPallet) {
      const L = loadBounds() || { x0: 0, x1: 120, z0: 0, z1: 80 };
      const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
      const w = Math.max(120, L.x1 - L.x0), d = Math.max(80, L.z1 - L.z0);
      return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
    }
    const P = state.pallets;
    return {
      x0: Math.min(...P.map((p) => p.x)), x1: Math.max(...P.map((p) => p.x + p.w)),
      z0: Math.min(...P.map((p) => p.z)), z1: Math.max(...P.map((p) => p.z + p.d)),
    };
  }

  function groupBounds(list) {
    return {
      x0: Math.min(...list.map((b) => b.x)), x1: Math.max(...list.map((b) => b.x + b.w)),
      z0: Math.min(...list.map((b) => b.z)), z1: Math.max(...list.map((b) => b.z + b.d)),
    };
  }

  // Limit a proposed (dx, dz) shift of a group so it stays near the pallets.
  function clampDelta(list, dx, dz) {
    const B = state.noPallet ? { x0: -1000, x1: 1000, z0: -1000, z1: 1000 } : palletBounds(), G = groupBounds(list);
    const lo = (v, min) => Math.max(v, min), hi = (v, max) => Math.min(v, max);
    dx = hi(lo(dx, B.x0 - MARGIN - G.x0), B.x1 + MARGIN - G.x1);
    dz = hi(lo(dz, B.z0 - MARGIN - G.z0), B.z1 + MARGIN - G.z1);
    return [dx, dz];
  }
  function shiftGroup(list, dx, dz) {
    [dx, dz] = clampDelta(list, dx, dz);
    for (const b of list) { b.x = round1(b.x + dx); b.z = round1(b.z + dz); }
  }

  function analyse() {
    const all = placedBoxes();
    for (const b of state.boxes) {
      b.overhang = b.unstable = b.tooTall = b.aside = false;
      b.palId = null;
      b.inside = null;
    }
    const per = new Map(state.pallets.map((P) => [P.id, { units: 0, vol: 0, covered: 0 }]));
    for (const b of all) {
      if (state.noPallet) continue;
      let best = 0;
      for (const P of state.pallets) {
        const a = onPalletArea(b, P);
        if (a > best + EPS) { best = a; b.palId = P.id; }
      }
      b.aside = best < EPS;   // parked entirely off the pallets: not part of the load
    }
    const load = all.filter((b) => !b.aside);
    // A unit whose whole envelope sits inside a cabinet's envelope is nested:
    // it takes up no extra load space.
    const within = (b, o) => o !== b && o.shape === 'cab' &&
      b.x >= o.x - EPS && b.x + b.w <= o.x + o.w + EPS && b.z >= o.z - EPS && b.z + b.d <= o.z + o.d + EPS &&
      b.y >= o.y - EPS && b.y + b.h <= o.y + o.h + EPS;
    for (const b of load) {
      const hosts = load.filter((o) => within(b, o));
      // the innermost host is the smallest one
      if (hosts.length) b.inside = hosts.sort((p, q) => p.w * p.h * p.d - q.w * q.h * q.d)[0].id;
    }
    let vol = 0, top = 0, issues = 0, nested = 0;
    for (const b of load) {
      b.overhang = !state.noPallet && onPalletArea(b, getPallet(b.palId)) < partsArea(b) - 0.5;
      const c = contact(b, all);
      b.support = c.support;
      b.unstable = !c.stable;
      b.tooTall = b.y + b.h > state.maxH + EPS;
      if (b.overhang || b.unstable || b.tooTall) issues++;
      if (b.inside != null) { nested++; top = Math.max(top, b.y + b.h); continue; }
      const v = envelopeVolume(b);
      vol += v;
      top = Math.max(top, b.y + b.h);
      const s = per.get(b.palId);
      if (s) { s.units++; s.vol += v; }
    }

    // Floor coverage: rasterise footprints at 1 cm over each pallet (or, with
    // no pallet, over the load's own footprint rectangle).
    const L = loadBounds();
    const floors = state.noPallet
      ? (L ? [{ id: 0, x: L.x0, z: L.z0, w: L.x1 - L.x0, d: L.z1 - L.z0 }] : [])
      : state.pallets;
    if (state.noPallet) per.set(0, { units: 0, vol: 0, covered: 0 });
    let covered = 0, cells = 0, area = 0;
    for (const P of floors) {
      const nx = Math.ceil(P.w), nz = Math.ceil(P.d);
      const grid = new Uint8Array(nx * nz);
      for (const b of load) {
        for (const p of parts(b)) {
          const x0 = Math.max(0, Math.floor(p.x0 - P.x)), x1 = Math.min(nx, Math.ceil(p.x1 - P.x));
          const z0 = Math.max(0, Math.floor(p.z0 - P.z)), z1 = Math.min(nz, Math.ceil(p.z1 - P.z));
          for (let z = z0; z < z1; z++) {
            if (!p.c) { if (x1 > x0) grid.fill(1, z * nx + x0, z * nx + x1); continue; }
            for (let x = x0; x < x1; x++) if (inPrim(p, P.x + x + 0.5, P.z + z + 0.5)) grid[z * nx + x] = 1;
          }
        }
      }
      let c = 0;
      for (let i = 0; i < grid.length; i++) c += grid[i];
      per.get(P.id).covered = c / grid.length;
      covered += c; cells += grid.length; area += P.w * P.d;
    }

    return {
      units: load.length,
      vol,
      top,
      fill: area ? vol / (area * state.maxH) : 0,
      floor: cells ? covered / cells : 0,
      density: top > 0 && area ? vol / (area * top) : null,
      size: L ? { w: L.x1 - L.x0, d: L.z1 - L.z0, h: L.y1 } : null,
      issues,
      nested,
      per,
    };
  }

  // ---------------------------------------------------------------- persistence + undo
  const cleanBox = (b) => ({
    id: b.id, name: b.name, shape: b.shape, w: b.w, h: b.h, d: b.d, arm: b.arm, rot: b.rot, tip: b.tip,
    board: b.board, lid: b.lid,
    color: b.color, x: b.x, z: b.z, y: b.y, placed: b.placed, hy: b.hy,
  });
  const snapshot = () => JSON.stringify({
    pallets: state.pallets, maxH: state.maxH, gap: state.gap, noPallet: state.noPallet,
    boxes: state.boxes.map(cleanBox), nextId: state.nextId, nextPalletId: state.nextPalletId,
  });

  function restore(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || !Array.isArray(data.boxes)) throw new Error('Not a Cupboard Stacker file');
    // v1 files had a single `pallet` with maxH on it.
    const rawPallets = Array.isArray(data.pallets) && data.pallets.length ? data.pallets : [data.pallet || {}];
    let pid = 0;
    state.pallets = rawPallets.map((p) => {
      const id = Number.isInteger(p.id) ? p.id : ++pid;
      pid = Math.max(pid, id);
      return { id, x: +p.x || 0, z: +p.z || 0, w: num(p.w, 120), d: num(p.d, 80), t: num(p.t, 10) };
    });
    state.nextPalletId = Math.max(pid + 1, data.nextPalletId | 0);
    state.maxH = num(data.maxH, num(data.pallet && data.pallet.maxH, 200));
    state.gap = Math.max(0, +data.gap || 0);
    state.noPallet = !!data.noPallet;
    let maxId = 0;
    state.boxes = data.boxes.map((b) => {
      const id = Number.isInteger(b.id) ? b.id : ++maxId;
      maxId = Math.max(maxId, id);
      return makeBox(b, id);
    });
    state.nextId = Math.max(maxId + 1, data.nextId | 0);
    sel = new Set([...sel].filter((id) => getBox(id)));
    if (!getBox(primaryId)) primaryId = sel.size ? [...sel].pop() : null;
    if (!getPallet(palletSelId)) palletSelId = state.pallets[0].id;
    settle();
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return setStatus('Nothing to undo.');
    restore(undoStack.pop());
    rebuildPallets();
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
  const fog = new THREE.Fog(0x070b16, 1200, 3000);
  scene.fog = fog;

  // 3D view: perspective camera you can orbit.
  const persp = new THREE.PerspectiveCamera(40, 1, 1, 8000);
  persp.position.set(220, 230, 300);
  const perspCtl = new THREE.OrbitControls(persp, renderer.domElement);
  perspCtl.target.set(0, 60, 0);
  perspCtl.enableDamping = true;
  perspCtl.dampingFactor = 0.12;
  perspCtl.maxPolarAngle = Math.PI * 0.495;
  perspCtl.minDistance = 60;
  perspCtl.maxDistance = 3000;

  // Plan / elevation views: true-scale orthographic camera that only pans and zooms.
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -10000, 10000);
  const orthoCtl = new THREE.OrbitControls(ortho, renderer.domElement);
  orthoCtl.enableRotate = false;
  orthoCtl.screenSpacePanning = true;
  orthoCtl.minZoom = 0.2;
  orthoCtl.maxZoom = 20;
  orthoCtl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  orthoCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  orthoCtl.enabled = false;
  let orthoFit = { w: 200, h: 200 };

  let view = '3d';
  const activeCam = () => (view === '3d' ? persp : ortho);
  const activeCtl = () => (view === '3d' ? perspCtl : orthoCtl);

  // Data -> world offset: the pallet layout is centred on the origin. Only
  // recomputed when a view is (re)framed so the scene never jumps mid-drag.
  const origin = { x: 0, z: 0 };

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1f33, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(180, 400, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, near: 10, far: 1500 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.25);
  fill.position.set(-250, 150, -200);
  scene.add(fill);

  const floorGrid = new THREE.GridHelper(2000, 100, 0x26315f, 0x161d3a);
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

  function textTexture(lines, w, h, color) {
    const ratio = h / w;
    const cw = 256, ch = Math.min(512, Math.max(32, Math.round(256 * ratio)));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const longest = Math.max(4, ...lines.map((l) => l.length));
    const fs = Math.min(40, ch * 0.32, ((cw * 0.92) / longest) * 1.7);
    g.font = `bold ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    g.fillText(lines[0], cw / 2, lines[1] ? ch / 2 - fs * 0.45 : ch / 2);
    if (lines[1]) {
      g.font = `${fs * 0.7}px ui-monospace, Menlo, Consolas, monospace`;
      g.fillText(lines[1], cw / 2, ch / 2 + fs * 0.55);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function rebuildPallets() {
    disposeTree(palletGroup);
    palletGroup.clear();
    if (state.noPallet) { buildLoadOutline(); return; }
    const maxT = Math.max(...state.pallets.map((p) => p.t));
    state.pallets.forEach((P, i) => {
      const isSel = P.id === palletSelId;
      const cx = P.x + P.w / 2 - origin.x, cz = P.z + P.d / 2 - origin.z;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(P.w, P.t, P.d),
        new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.75, metalness: 0.05 })
      );
      slab.position.set(cx, -P.t / 2, cz);
      slab.receiveShadow = true;
      slab.castShadow = true;
      slab.userData.palletId = P.id;
      palletGroup.add(slab);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(slab.geometry),
        new THREE.LineBasicMaterial({ color: isSel ? 0xffe23f : 0x5a0a0a })
      );
      edges.position.copy(slab.position);
      palletGroup.add(edges);

      // 10 cm grid on the deck
      const pts = [];
      const x0 = P.x - origin.x, z0 = P.z - origin.z;
      for (let x = 10; x < P.w; x += 10) pts.push(x0 + x, 0.05, z0, x0 + x, 0.05, z0 + P.d);
      for (let z = 10; z < P.d; z += 10) pts.push(x0, 0.05, z0 + z, x0 + P.w, 0.05, z0 + z);
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      palletGroup.add(new THREE.LineSegments(gridGeo,
        new THREE.LineBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.35 })));

      // Allowed load envelope
      const env = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(P.w, state.maxH, P.d)),
        new THREE.LineDashedMaterial({ color: 0x3ff0ff, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.45 })
      );
      env.position.set(cx, state.maxH / 2, cz);
      env.computeLineDistances();
      palletGroup.add(env);

      // Name tag on the floor in front of the pallet
      const lw = Math.min(P.w, 70), lh = 12;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(lw, lh),
        new THREE.MeshBasicMaterial({
          map: textTexture([`P${i + 1}  ${fmt(P.w)}×${fmt(P.d)}`], lw, lh, isSel ? '#ffe23f' : '#ff6b6b'),
          transparent: true, depthWrite: false,
        })
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(cx, -maxT + 0.3, z0 + P.d + lh / 2 + 3);
      palletGroup.add(label);
    });
    floorGrid.position.set(0, -maxT - 0.05, 0);
  }

  // No-pallet mode: the pieces stand on the floor, wrapped in a dashed box
  // showing the space the load takes up, with its size written in front.
  function buildLoadOutline() {
    floorGrid.position.set(0, -0.05, 0);
    const L = loadBounds();
    if (!L) return;
    const w = L.x1 - L.x0, d = L.z1 - L.z0, h = L.y1;
    const cx = (L.x0 + L.x1) / 2 - origin.x, cz = (L.z0 + L.z1) / 2 - origin.z;
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineDashedMaterial({ color: 0x3ff0ff, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.8 })
    );
    box.position.set(cx, h / 2, cz);
    box.computeLineDistances();
    palletGroup.add(box);
    const lw = Math.max(60, Math.min(w, 140)), lh = 14;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(lw, lh),
      new THREE.MeshBasicMaterial({
        map: textTexture([`${fmt(w)} × ${fmt(d)} × ${fmt(h)} cm`], lw, lh, '#3ff0ff'),
        transparent: true, depthWrite: false,
      })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(cx, 0.2, cz + d / 2 + lh / 2 + 4);
    palletGroup.add(label);
  }

  // --- piece meshes
  const meshes = new Map();   // id -> { group, mesh, label, edges, ghost, mats, key }
  const anim = new Map();     // id -> { from, start } drop animation
  const ghostMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  // The unit's own size (as built, not as placed).
  function dimsText(b) {
    if (b.shape === 'cyl') return `Ø${fmt(b.w)}×${fmt(b.h)}`;
    const [W, H, D] = origDims(b);
    return `${fmt(W)}×${fmt(H)}×${fmt(D)}`;
  }

  // Merge several (indexed) geometries into one non-indexed geometry.
  function mergeGeos(geos) {
    const pos = [], nor = [], uv = [];
    for (const g of geos) {
      const n = g.toNonIndexed();
      pos.push(...n.attributes.position.array);
      nor.push(...n.attributes.normal.array);
      uv.push(...n.attributes.uv.array);
      g.dispose(); n.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }

  function buildGeometry(b) {
    if (b.shape === 'cyl') return new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 48);
    if (b.shape === 'L') {
      const shape = new THREE.Shape(localL(b).poly.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);                 // extrude upwards; shape y becomes world z
      geo.translate(-b.w / 2, b.h / 2, -b.d / 2);
      return geo;
    }
    const geos = panelsLocal(b).map((p) => {
      const g = new THREE.BoxGeometry(p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0);
      g.translate((p.x0 + p.x1 - b.w) / 2, (p.y0 + p.y1 - b.h) / 2, (p.z0 + p.z1 - b.d) / 2);
      return g;
    });
    return geos.length === 1 ? geos[0] : mergeGeos(geos);
  }

  function buildBoxMesh(b) {
    const geo = buildGeometry(b);
    const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = b.id;
    const edgeGeo = new THREE.EdgesGeometry(geo, 25);
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x05070f }));
    const ghost = new THREE.LineSegments(edgeGeo, ghostMat);
    ghost.position.y = -HOVER_GAP;

    // Label on the top face: across the box, inside the circle, on the L's
    // longer arm, or on a cabinet's highest flat board (its lid, or the base inside).
    let lx = 0, lz = 0, lw = b.w * 0.92, ld = b.d * 0.92, ly = b.h / 2;
    if (b.shape === 'cab') {
      const flat = panelsLocal(b).filter((p) => p.y1 - p.y0 < Math.min(p.x1 - p.x0, p.z1 - p.z0));
      const top = flat.sort((p, q) => q.y1 - p.y1 || (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0];
      if (top) {
        lx = (top.x0 + top.x1 - b.w) / 2; lz = (top.z0 + top.z1 - b.d) / 2;
        lw = (top.x1 - top.x0) * 0.92; ld = (top.z1 - top.z0) * 0.92;
        ly = top.y1 - b.h / 2;
      }
    }
    if (b.shape === 'cyl') { lw = ld = b.w * 0.68; }
    if (b.shape === 'L') {
      const r = localL(b).rects.slice().sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0];
      lx = (r.x0 + r.x1) / 2 - b.w / 2; lz = (r.z0 + r.z1) / 2 - b.d / 2;
      lw = (r.x1 - r.x0) * 0.92; ld = (r.z1 - r.z0) * 0.92;
    }
    const ink = luminance(b.color) > 0.55 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(lw, ld),
      new THREE.MeshBasicMaterial({ map: textTexture([b.name, dimsText(b)], lw, ld, ink), transparent: true, depthWrite: false })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(lx, ly + 0.1, lz);
    label.userData.id = b.id;

    const group = new THREE.Group();
    group.add(mesh, edges, label, ghost);
    return { group, mesh, label, edges, ghost, mat };
  }

  const worldX = (b) => b.x + b.w / 2 - origin.x;
  const worldZ = (b) => b.z + b.d / 2 - origin.z;
  const displayY = (b) => (b.placed ? b.y : b.y + HOVER_GAP);

  function syncMeshes() {
    const ids = new Set(state.boxes.map((b) => b.id));
    for (const [id, m] of meshes) {
      if (!ids.has(id)) { boxRoot.remove(m.group); disposeTree(m.group); meshes.delete(id); }
    }
    for (const b of state.boxes) {
      const key = `${b.shape}|${b.w}|${b.h}|${b.d}|${b.arm}|${b.rot}|${b.tip}|${b.board}|${b.lid}|${b.color}|${b.name}`;
      let m = meshes.get(b.id);
      if (!m || m.key !== key) {
        if (m) { boxRoot.remove(m.group); disposeTree(m.group); }
        m = buildBoxMesh(b);
        m.key = key;
        meshes.set(b.id, m);
        boxRoot.add(m.group);
      }
      const isSel = sel.has(b.id);
      const warn = b.overhang || b.unstable || b.tooTall;
      m.edges.material.color.set(isSel ? 0xffffff : warn ? 0xff9f1c : 0x05070f);
      m.mat.emissive.set(isSel ? 0x1c1c1c : warn ? 0x401800 : 0x000000);
      m.mat.transparent = !b.placed;
      m.mat.opacity = b.placed ? 1 : 0.72;
      m.ghost.visible = !b.placed;
      m.ghost.position.y = -HOVER_GAP;
      m.group.position.x = worldX(b);
      m.group.position.z = worldZ(b);
      if (!anim.has(b.id)) m.group.position.y = displayY(b) + b.h / 2;
    }
  }

  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    const aspect = w / h;
    let hw, hh;
    if (orthoFit.w / orthoFit.h > aspect) { hw = orthoFit.w / 2; hh = hw / aspect; }
    else { hh = orthoFit.h / 2; hw = hh * aspect; }
    Object.assign(ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
    ortho.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);

  // Frame the chosen view around all pallets.
  let camTween = null;
  const VIEW_NAMES = { '3d': '3D', top: 'PLAN', front: 'FRONT', side: 'SIDE' };
  function setView(v, instant) {
    view = v;
    const B = palletBounds();
    origin.x = (B.x0 + B.x1) / 2;
    origin.z = (B.z0 + B.z1) / 2;
    rebuildPallets();
    syncMeshes();
    const W = B.x1 - B.x0, D = B.z1 - B.z0, H = state.maxH;
    perspCtl.enabled = v === '3d';
    orthoCtl.enabled = v !== '3d';
    scene.fog = v === '3d' ? fog : null;
    sun.castShadow = v === '3d';   // shadows only muddy a flat drawing
    if (v === '3d') {
      const r = Math.max(W, D, H) * 1.55 + 60;
      const pos = new THREE.Vector3(r * 0.85, r * 0.95, r * 1.15);
      const target = new THREE.Vector3(0, H * 0.3, 0);
      camTween = { p0: persp.position.clone(), t0: perspCtl.target.clone(), p1: pos, t1: target, start: performance.now() };
      if (instant) { persp.position.copy(pos); perspCtl.target.copy(target); camTween = null; }
    } else {
      const far = 4000, pad = 50;
      ortho.zoom = 1;
      if (v === 'top') {
        ortho.position.set(0, far, 0.01);
        orthoCtl.target.set(0, 0, 0);
        orthoFit = { w: W + pad * 2, h: D + pad * 2 + 20 };
      } else if (v === 'front') {
        ortho.position.set(0, H / 2, far);
        orthoCtl.target.set(0, H / 2, 0);
        orthoFit = { w: W + pad * 2, h: H + pad * 2 };
      } else {
        ortho.position.set(far, H / 2, 0);
        orthoCtl.target.set(0, H / 2, 0);
        orthoFit = { w: D + pad * 2, h: H + pad * 2 };
      }
      resize();
      orthoCtl.update();
    }
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === v));
    renderHud();
  }

  function tick(now) {
    if (camTween) {
      const k = Math.min(1, (now - camTween.start) / 350);
      const e = 1 - Math.pow(1 - k, 3);
      persp.position.lerpVectors(camTween.p0, camTween.p1, e);
      perspCtl.target.lerpVectors(camTween.t0, camTween.t1, e);
      if (k >= 1) camTween = null;
    }
    for (const [id, a] of anim) {
      const b = getBox(id), m = meshes.get(id);
      if (!b || !m) { anim.delete(id); continue; }
      const k = Math.min(1, (now - a.start) / DROP_MS);
      m.group.position.y = a.from + (b.y - a.from) * k * k + b.h / 2;
      if (k >= 1) anim.delete(id);
    }
    activeCtl().update();
    renderer.render(scene, activeCam());
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- actions
  // Change the selection. Hovering pieces that leave the selection drop in place.
  function setSelection(ids, primaryHint) {
    const next = new Set(ids);
    const leaving = state.boxes.filter((b) => !b.placed && !next.has(b.id));
    if (leaving.length) dropGroup(leaving, true);
    sel = next;
    primaryId = primaryHint != null && next.has(primaryHint) ? primaryHint : (ids.length ? ids[ids.length - 1] : null);
  }
  function toggleSelected(id) {
    const ids = [...sel];
    setSelection(sel.has(id) ? ids.filter((x) => x !== id) : [...ids, id], sel.has(id) ? undefined : id);
  }

  function spawn(spec) {
    pushUndo();
    const P = state.noPallet ? (() => { const B = palletBounds(); return { x: B.x0, z: B.z0, w: B.x1 - B.x0, d: B.z1 - B.z0 }; })() : selPallet();
    const s = normalizeShape({ ...spec });
    const b = makeBox({
      ...s,
      x: Math.round(P.x + (P.w - s.w) / 2),
      z: Math.round(P.z + (P.d - s.d) / 2),
      placed: false, hy: 0,
    }, state.nextId++);
    setSelection([]);
    state.boxes.push(b);
    setSelection([b.id], b.id);
    settle();
    refresh();
    setStatus(`${b.name} is hovering — move it, then press Space to drop.`);
  }

  function warnFor(b) {
    if (b.aside) return null;
    if (b.overhang) return `${b.name} overhangs its pallet.`;
    if (b.unstable) return `${b.name} is not supported under its centre — it would tip.`;
    if (b.y + b.h > state.maxH + EPS) return `${b.name} exceeds the max load height.`;
    return null;
  }

  // Land hovering pieces. Their y already holds the simulated landing height.
  function dropGroup(list, quiet) {
    const hov = list.filter((b) => !b.placed);
    if (!hov.length) return;
    for (const b of hov) {
      anim.set(b.id, { from: b.y + HOVER_GAP, start: performance.now() });
      b.placed = true;
    }
    settle();
    if (quiet) return;
    refresh();
    const warning = hov.map(warnFor).find(Boolean);
    if (warning) setStatus(warning, true);
    else if (hov.length === 1 && hov[0].inside != null) setStatus(`${hov[0].name} placed inside #${hov[0].inside}.`);
    else if (hov.length === 1) setStatus(`${hov[0].name} placed at height ${fmt(hov[0].y)} cm.`);
    else setStatus(`${hov.length} pieces placed.`);
  }

  function liftGroup(list) {
    for (const b of list) if (b.placed) { b.placed = false; b.hy = b.y; }
    settle();
  }

  function toggleDrop() {
    const list = selectedBoxes();
    if (!list.length) return;
    pushUndo();
    if (list.some((b) => !b.placed)) return dropGroup(list);
    liftGroup(list);
    refresh();
    setStatus(list.length === 1
      ? `${list[0].name} lifted — move it over the stack and drop.`
      : `${list.length} pieces lifted — move them and drop.`);
  }

  function moveSelected(dx, dz) {
    const list = selectedBoxes();
    if (!list.length) return;
    pushUndo();
    shiftGroup(list, dx, dz);
    settle(new Set(list.map((b) => b.id)));
    refresh();
  }

  // Rotate the selection 90° in plan about its own footprint, keeping the
  // group's back-left corner where it was so pieces stay aligned to edges.
  function rotateSelected() {
    const list = selectedBoxes();
    if (!list.length) return;
    pushUndo();
    const G = groupBounds(list);
    for (const b of list) {
      const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
      [b.w, b.d] = [b.d, b.w];
      if (b.shape !== 'cyl') b.rot = (b.rot + 1) & 3;
      b.x = -cz - b.w / 2;          // (x, z) -> (-z, x)
      b.z = cx - b.d / 2;
    }
    const N = groupBounds(list);
    for (const b of list) { b.x = round1(b.x - N.x0 + G.x0); b.z = round1(b.z - N.z0 + G.z0); }
    shiftGroup(list, 0, 0);
    settle(new Set(list.map((b) => b.id)));
    refresh();
    setStatus(list.length === 1 ? `${list[0].name} rotated 90°.` : `${list.length} pieces rotated 90°.`);
  }

  function tipSelected() {
    const list = selectedBoxes();
    if (!list.length) return;
    const boxes = list.filter((b) => b.shape === 'box' || b.shape === 'cab');
    if (!boxes.length) return setStatus('Cylinders and L-corners stay upright; only cabinets and boxes tip.', true);
    pushUndo();
    for (const b of boxes) {
      const o = origDims(b);
      b.tip ^= 1;
      applyDims(b, o[0], o[1], o[2]);
    }
    shiftGroup(boxes, 0, 0);
    settle(new Set(boxes.map((b) => b.id)));
    refresh();
    const one = boxes[0];
    setStatus(boxes.length < list.length
      ? `Tipped ${boxes.length} piece(s); cylinders and L-corners stay upright.`
      : boxes.length > 1 ? `${boxes.length} pieces tipped.`
      : one.tip ? `${one.name} laid on its back${one.shape === 'cab' ? ' — open side up' : ''}: now ${fmt(one.h)} cm tall.`
      : `${one.name} stood upright: now ${fmt(one.h)} cm tall.`);
  }

  function deleteSelected() {
    const list = selectedBoxes();
    if (!list.length) return;
    pushUndo();
    state.boxes = state.boxes.filter((b) => !sel.has(b.id));
    sel = new Set();
    primaryId = null;
    settle();
    refresh();
    setStatus(list.length === 1 ? `${list[0].name} removed.` : `${list.length} pieces removed.`);
  }

  // --- copy / paste
  const specOf = (b) => {
    const c = cleanBox(b);
    delete c.id;
    return c;
  };
  function copySelected(quiet) {
    const list = selectedBoxes();
    if (!list.length) { if (!quiet) setStatus('Select pieces to copy first.'); return null; }
    clipboard = list.map(specOf);
    if (!quiet) setStatus(`Copied ${list.length} piece${list.length > 1 ? 's' : ''}. Ctrl+V to paste.`);
    return clipboard;
  }
  const clipText = (list) => JSON.stringify({ tag: CLIP_TAG, boxes: list });

  // Pasted pieces arrive hovering in the same spot, keeping their arrangement.
  function pasteBoxes(list) {
    if (!list || !list.length) return setStatus('Clipboard is empty — select pieces and press Ctrl+C first.');
    pushUndo();
    const minY = Math.min(...list.map((s) => +s.y || 0));
    const added = list.map((s) => makeBox({ ...s, placed: false, hy: (+s.y || 0) - minY }, state.nextId++));
    shiftGroup(added, 0, 0);
    state.boxes.push(...added);
    setSelection(added.map((b) => b.id));
    settle();
    refresh();
    setStatus(`Pasted ${added.length} piece${added.length > 1 ? 's' : ''} — move, then Space to drop.`);
  }
  function duplicateSelected() {
    const list = selectedBoxes();
    if (list.length) pasteBoxes(list.map(specOf));
  }

  function cycleSelection(dir) {
    if (!state.boxes.length) return;
    const i = state.boxes.findIndex((b) => b.id === primaryId);
    const n = state.boxes.length;
    const next = state.boxes[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + n) % n];
    setSelection([next.id], next.id);
    refresh();
  }

  // --- auto placement
  // Placements auto-place may try for a piece: quarter turns in plan, keeping
  // its current tip (a cabinet the user laid on its back stays on its back).
  function orientations(b) {
    const o = origDims(b);
    const rots = b.shape === 'cyl' ? [0] : b.shape === 'box' && !b.tip && o[0] === o[2] ? [0] : b.shape === 'box' ? [0, 1] : [0, 1, 2, 3];
    return rots.map((rot) => {
      const c = { shape: b.shape, tip: b.tip, rot, arm: b.arm, board: b.board, lid: b.lid, w: 0, h: 0, d: 0 };
      applyDims(c, o[0], o[1], o[2]);
      return c;
    });
  }

  function better(a, b) {
    if (Math.abs(a.y - b.y) > EPS) return a.y < b.y;
    if (a.pi !== b.pi) return a.pi < b.pi;
    if (Math.abs(a.z - b.z) > EPS) return a.z < b.z;
    return a.x < b.x - EPS;
  }

  // Best resting spot for `b`: lowest, then earliest pallet, then furthest
  // back, then furthest left; fully on one pallet, balanced, broadly supported
  // and under the height limit. Candidate positions line up with every board
  // edge, so units are tried inside open cabinets too. Returns null if none.
  function findSpot(b, others) {
    let best = null;
    state.pallets.forEach((P, pi) => {
      for (const c of orientations(b)) {
        const { w, d } = c;
        if (w > P.w + EPS || d > P.d + EPS) continue;
        const xs = new Set([P.x, round1(P.x + P.w - w)]);
        const zs = new Set([P.z, round1(P.z + P.d - d)]);
        for (const q of others) {
          for (const r of parts(q)) {
            xs.add(round1(r.x1)); xs.add(round1(r.x0 - w)); xs.add(round1(r.x0));
            zs.add(round1(r.z1)); zs.add(round1(r.z0 - d)); zs.add(round1(r.z0));
          }
        }
        const xl = [...xs].filter((x) => x >= P.x - EPS && x + w <= P.x + P.w + EPS);
        const zl = [...zs].filter((z) => z >= P.z - EPS && z + d <= P.z + P.d + EPS);
        for (const x of xl) {
          for (const z of zl) {
            const t = { ...c, x, z, y: 0, pi };
            t.y = landingY(t, others);
            if (t.y + t.h > state.maxH + EPS) continue;
            if (best && !better(t, best)) continue;
            const k = contact(t, others);
            if (!k.stable || k.spread < 0.7) continue;
            best = t;
          }
        }
      }
    });
    return best;
  }

  // --- packing without a pallet
  function betterFree(a, b) {
    if (Math.abs(a.area - b.area) > 1) return a.area < b.area;
    if (Math.abs(a.y - b.y) > EPS) return a.y < b.y;
    if (Math.abs(a.z - b.z) > EPS) return a.z < b.z;
    return a.x < b.x - EPS;
  }

  // Free-floor spot for `b` next to / on top of / inside `others`: the one
  // that grows the load's footprint least, then the lowest, back-most,
  // left-most. `limitD` (if set) caps how deep the load may get.
  function findSpotFree(b, others, limitD) {
    const G = others.length ? groupBounds(others) : null;
    const ox = G ? G.x0 : 0, oz = G ? G.z0 : 0;
    let best = null;
    for (const c of orientations(b)) {
      const { w, d } = c;
      if (limitD && d > limitD + EPS) continue;
      const xs = new Set([ox]), zs = new Set([oz]);
      for (const q of others) {
        for (const r of parts(q)) {
          xs.add(round1(r.x1)); xs.add(round1(r.x0 - w)); xs.add(round1(r.x0));
          zs.add(round1(r.z1)); zs.add(round1(r.z0 - d)); zs.add(round1(r.z0));
        }
      }
      const xl = [...xs].filter((x) => x >= ox - EPS);
      const zl = [...zs].filter((z) => z >= oz - EPS && (!limitD || z + d <= oz + limitD + EPS));
      for (const x of xl) {
        for (const z of zl) {
          const t = { ...c, x, z, y: 0 };
          const W = G ? Math.max(G.x1, x + w) - Math.min(G.x0, x) : w;
          const D = G ? Math.max(G.z1, z + d) - Math.min(G.z0, z) : d;
          t.area = W * D;
          if (best && t.area > best.area + 1) continue;
          t.y = landingY(t, others);
          if (t.y + t.h > state.maxH + EPS) continue;
          if (best && !betterFree(t, best)) continue;
          if (others.length) {
            const k = contact(t, others);
            if (!k.stable || k.spread < 0.7) continue;
          }
          best = t;
        }
      }
    }
    return best;
  }

  // Pack `list` from scratch on an empty floor, trying several load depths,
  // and keep the layout with the smallest footprint (then lowest, then
  // squarest). Returns { boxes: [{id, x, z, y, w, h, d, rot}], w, d, h } or null.
  function packFree(list) {
    const order = packOrder(list);
    const depths = new Set([0]);
    let need = 0, maxD = 0;
    for (const b of order) {
      const ds = orientations(b).map((c) => c.d);
      need = Math.max(need, Math.min(...ds));
      for (const d of ds) { depths.add(d); maxD = Math.max(maxD, d); }
    }
    depths.add(maxD * 2); depths.add(maxD * 3);
    const limits = [...depths].filter((d) => d === 0 || d >= need - EPS).sort((a, b) => a - b).slice(0, 12);
    let best = null;
    for (const limit of limits) {
      const done = [];
      let ok = true;
      for (const b of order) {
        const c = makeBox(cleanBox(b), b.id);
        const spot = findSpotFree(c, done, limit);
        if (!spot) { ok = false; break; }
        Object.assign(c, { x: round1(spot.x), z: round1(spot.z), w: spot.w, h: spot.h, d: spot.d, rot: spot.rot, y: spot.y, placed: true });
        done.push(c);
      }
      if (!ok) continue;
      const G = groupBounds(done);
      const r = {
        boxes: done, w: G.x1 - G.x0, d: G.z1 - G.z0, h: Math.max(...done.map((b) => b.y + b.h)),
      };
      r.area = r.w * r.d;
      if (!best || r.area < best.area - 1 ||
          (Math.abs(r.area - best.area) <= 1 && (r.h < best.h - EPS ||
          (Math.abs(r.h - best.h) <= EPS && Math.abs(r.w - r.d) < Math.abs(best.w - best.d))))) best = r;
    }
    return best;
  }

  // Move real pieces to a packed layout, shifted by (dx, dz).
  function applyPacked(result, dx, dz) {
    for (const c of result.boxes) {
      const b = getBox(c.id);
      const from = displayY(b);
      Object.assign(b, { x: round1(c.x + dx), z: round1(c.z + dz), w: c.w, h: c.h, d: c.d, rot: c.rot, y: c.y, placed: true });
      anim.set(b.id, { from, start: performance.now() });
    }
  }

  const sizeText = (r) => `${fmt(r.w)} W × ${fmt(r.d)} D × ${fmt(r.h)} H cm`;
  const tooTallFor = (list) => list.find((b) => Math.min(...orientations(b).map((c) => c.h)) > state.maxH + EPS);

  function autoPlace(b) {
    const others = placedBoxes().filter((o) => o !== b);
    const spot = state.noPallet ? findSpotFree(b, others, 0) : findSpot(b, others);
    if (!spot) return false;
    const from = displayY(b);
    Object.assign(b, { x: round1(spot.x), z: round1(spot.z), w: spot.w, h: spot.h, d: spot.d, rot: spot.rot, y: spot.y, placed: true });
    anim.set(b.id, { from, start: performance.now() });
    return true;
  }

  const packOrder = (list) => [...list].sort((a, b) => envelopeVolume(b) - envelopeVolume(a) || b.h - a.h || a.id - b.id);

  function autoPlaceSelected() {
    const list = selectedBoxes();
    if (!list.length) return;
    if (state.noPallet && list.length > 1) return packSelectionFree(list);
    pushUndo();
    liftGroup(list);
    let failed = 0;
    for (const b of packOrder(list)) if (!autoPlace(b)) failed++;
    settle();
    refresh();
    if (failed) setStatus(`No safe spot for ${failed} piece${failed > 1 ? 's' : ''} — left hovering.`, true);
    else if (list.length === 1) setStatus(`${list[0].name} auto-placed at x ${list[0].x}, z ${list[0].z}, height ${fmt(list[0].y)} cm.`);
    else setStatus(`Auto-placed ${list.length} pieces.`);
  }

  // No pallet: pack the selected pieces as tightly as possible, set to the
  // right of everything else, and report the space they need.
  function packSelectionFree(list) {
    const tall = tooTallFor(list);
    if (tall) return setStatus(`${tall.name} is taller than the ${fmt(state.maxH)} cm max load height in every orientation.`, true);
    const r = packFree(list);
    if (!r) return setStatus('Could not pack those pieces under the max load height.', true);
    pushUndo();
    const ids = new Set(list.map((b) => b.id));
    for (const b of list) b.placed = false;
    settle();
    const rest = placedBoxes().filter((b) => !ids.has(b.id));
    const G = rest.length ? groupBounds(rest) : null;
    applyPacked(r, G ? G.x1 + 30 : 0, G ? G.z0 : 0);
    settle();
    setView(view, true);
    refresh();
    setStatus(`Packed ${list.length} pieces into ${sizeText(r)}.`);
  }

  function autoPackAll() {
    if (!state.boxes.length) return setStatus('Nothing to pack.');
    if (state.noPallet) {
      const tall = tooTallFor(state.boxes);
      if (tall) return setStatus(`${tall.name} is taller than the ${fmt(state.maxH)} cm max load height in every orientation.`, true);
      const r = packFree(state.boxes);
      if (!r) return setStatus('Could not pack the pieces under the max load height.', true);
      pushUndo();
      applyPacked(r, 0, 0);
      settle();
      setView(view, true);
      refresh();
      return setStatus(`Packed all ${state.boxes.length} pieces into ${sizeText(r)}. Use MAKE PALLET THIS SIZE to get a matching pallet.`);
    }
    pushUndo();
    const order = packOrder(state.boxes);
    for (const b of order) { b.placed = false; b.y = 0; }
    const B = palletBounds();
    let failed = 0;
    for (const b of order) {
      if (!autoPlace(b)) { failed++; b.x = B.x0 - b.w - 20; b.z = B.z0; b.placed = true; }
    }
    settle();
    refresh();
    setStatus(failed
      ? `Packed ${order.length - failed} pieces; ${failed} did not fit and were set beside the pallets.`
      : `Packed all ${order.length} pieces.`, failed > 0);
  }

  // --- pallets
  function setNoPallet(on) {
    if (state.noPallet === on) return;
    pushUndo();
    state.noPallet = on;
    settle();
    setView(view, true);
    refresh();
    setStatus(on
      ? 'No pallet: pieces stand on the floor. AUTO-PACK ALL packs them tightly and the dashed box shows the space they need.'
      : 'Pallets back on.');
  }

  // Replace the pallets with one sized to the load's footprint.
  function fitPalletToLoad() {
    const L = loadBounds();
    if (!L) return setStatus('Place some pieces first.');
    pushUndo();
    const t = selPallet().t;
    const P = { id: state.nextPalletId++, x: L.x0, z: L.z0, w: Math.ceil(L.x1 - L.x0 - EPS), d: Math.ceil(L.z1 - L.z0 - EPS), t };
    state.pallets = [P];
    palletSelId = P.id;
    state.noPallet = false;
    settle();
    setView(view, true);
    refresh();
    setStatus(`Pallet sized to ${P.w} × ${P.d} cm to fit the load.`);
  }

  function selectSameColour() {
    const p = primary();
    if (!p) return;
    const ids = state.boxes.filter((b) => b.color === p.color).map((b) => b.id);
    setSelection(ids, p.id);
    refresh();
    setStatus(`Selected ${ids.length} piece${ids.length > 1 ? 's' : ''} of this colour.${state.noPallet ? ' AUTO packs just these.' : ''}`);
  }

  function addPallet(dir) {
    pushUndo();
    const base = selPallet(), B = palletBounds(), gap = state.gap;
    const P = {
      id: state.nextPalletId++, w: base.w, d: base.d, t: base.t,
      x: dir === 'right' ? B.x1 + gap : base.x,
      z: dir === 'right' ? base.z : B.z1 + gap,
    };
    state.pallets.push(P);
    palletSelId = P.id;
    settle();
    setView(view, true);
    refresh();
    setStatus(`Pallet P${state.pallets.length} added ${dir === 'right' ? 'to the right' : 'in front'}.`);
  }

  function removePallet(id) {
    if (state.pallets.length < 2) return;
    pushUndo();
    const i = state.pallets.findIndex((p) => p.id === id);
    state.pallets.splice(i, 1);
    if (palletSelId === id) palletSelId = state.pallets[Math.max(0, i - 1)].id;
    settle();
    setView(view, true);
    refresh();
    setStatus(`Pallet removed. Its pieces stay where they were.`);
  }

  // Move a pallet together with the pieces resting on it.
  function movePallet(P, dx, dz, load) {
    P.x = round1(P.x + dx); P.z = round1(P.z + dz);
    for (const b of load) { b.x = round1(b.x + dx); b.z = round1(b.z + dz); }
  }
  const loadOf = (P) => { analyse(); return state.boxes.filter((b) => b.palId === P.id); };

  function updatePallet(key, value) {
    const P = selPallet();
    if (key === 'x' || key === 'z') {
      const v = Number.isFinite(+value) ? round1(+value) : P[key];
      if (v === P[key]) return;
      pushUndo();
      const load = loadOf(P);
      movePallet(P, key === 'x' ? v - P.x : 0, key === 'z' ? v - P.z : 0, load);
    } else {
      const v = num(value, P[key]);
      if (v === P[key]) return;
      pushUndo();
      P[key] = v;
    }
    settle();
    rebuildPallets();
    refresh();
  }

  // ---------------------------------------------------------------- UI
  function setStatus(msg, warn) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
  }

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

  function buildShapeSeg(container, onPick) {
    container.innerHTML = '';
    for (const s of SHAPES) {
      const btn = document.createElement('button');
      btn.textContent = s.label;
      btn.dataset.shape = s.key;
      btn.addEventListener('click', () => onPick(s.key));
      container.appendChild(btn);
    }
  }
  function markShape(container, shape) {
    for (const btn of container.children) btn.classList.toggle('on', btn.dataset.shape === shape);
  }
  // Show the dimension fields that make sense for a shape.
  function shapeFields(prefix, shape) {
    $(`${prefix}WLabel`).textContent = shape === 'cyl' ? 'Ø (cm)' : prefix === 'd' ? 'W (cm)' : 'W';
    $(`${prefix}DWrap`).hidden = shape === 'cyl';
    $(`${prefix}ArmWrap`).hidden = shape !== 'L';
    $(`${prefix}BoardWrap`).hidden = shape !== 'cab';
    $(`${prefix}LidWrap`).hidden = shape !== 'cab';
  }

  // Isometric drawing of a box / cabinet as its boards, back to front.
  function drawPanelsPreview(g, W, H) {
    const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
    const proj = (x, y, z) => [(x - z) * c30, (x + z) * s30 - y];
    const { w, h, d, color } = draft;
    const all = [];
    for (const x of [0, w]) for (const y of [0, h]) for (const z of [0, d]) all.push(proj(x, y, z));
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((W - 40) / (maxX - minX), (H - 30) / (maxY - minY));
    const ox = (W - (maxX - minX) * s) / 2 - minX * s, oy = (H - 14 - (maxY - minY) * s) / 2 - minY * s;
    const P = (x, y, z) => { const p = proj(x, y, z); return [ox + p[0] * s, oy + p[1] * s]; };
    const n = parseInt(color.slice(1), 16);
    const shade = (k) => {
      const f = (v) => Math.min(255, v * k) | 0;
      return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    };
    const face = (pts, k) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = shade(k); g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#000'; g.stroke();
    };
    const panels = panelsLocal(draft).sort((a, b) => a.x0 + a.y0 + a.z0 - (b.x0 + b.y0 + b.z0));
    for (const p of panels) {
      face([P(p.x1, p.y0, p.z0), P(p.x1, p.y1, p.z0), P(p.x1, p.y1, p.z1), P(p.x1, p.y0, p.z1)], 0.62);
      face([P(p.x0, p.y0, p.z1), P(p.x1, p.y0, p.z1), P(p.x1, p.y1, p.z1), P(p.x0, p.y1, p.z1)], 0.85);
      face([P(p.x0, p.y1, p.z0), P(p.x1, p.y1, p.z0), P(p.x1, p.y1, p.z1), P(p.x0, p.y1, p.z1)], 1.15);
    }
  }

  // Isometric drawing of the next piece: extruded outline, painter-sorted faces.
  function drawPreview() {
    const cv = $('preview');
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const caption = draft.shape === 'cyl' ? `Ø${fmt(draft.w)} × ${fmt(draft.h)} H`
      : draft.shape === 'L' ? `${fmt(draft.w)} W × ${fmt(draft.h)} H × ${fmt(draft.d)} D · arm ${fmt(draft.arm)}`
      : draft.shape === 'cab' ? `${fmt(draft.w)}×${fmt(draft.h)}×${fmt(draft.d)} · ${fmt(draft.board)} board · ${draft.lid ? 'lid' : 'open top'}`
      : `${fmt(draft.w)} W × ${fmt(draft.h)} H × ${fmt(draft.d)} D`;
    const writeCaption = () => {
      g.fillStyle = '#8592c4';
      g.font = '11px ui-monospace, Menlo, Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(caption, W / 2, H - 6);
    };
    if (draft.shape === 'box' || draft.shape === 'cab') { drawPanelsPreview(g, W, H); writeCaption(); return; }
    const { h, color } = draft;
    const outline = localOutline(draft);
    const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
    const proj = (x, y, z) => [(x - z) * c30, (x + z) * s30 - y];
    const all = [];
    for (const [x, z] of outline) { all.push(proj(x, 0, z)); all.push(proj(x, h, z)); }
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((W - 40) / (maxX - minX), (H - 30) / (maxY - minY));
    const ox = (W - (maxX - minX) * s) / 2 - minX * s, oy = (H - 14 - (maxY - minY) * s) / 2 - minY * s;
    const P = (x, y, z) => { const p = proj(x, y, z); return [ox + p[0] * s, oy + p[1] * s]; };
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (v) => Math.min(255, v * k) | 0;
      return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    };
    const face = (pts, fillStyle, stroke) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = fillStyle; g.fill();
      if (stroke) { g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); }
    };
    let area = 0;
    for (let i = 0; i < outline.length; i++) {
      const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % outline.length];
      area += x0 * z1 - x1 * z0;
    }
    const sides = [];
    for (let i = 0; i < outline.length; i++) {
      const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % outline.length];
      let nx = z1 - z0, nz = -(x1 - x0);
      if (area < 0) { nx = -nx; nz = -nz; }
      const len = Math.hypot(nx, nz) || 1;
      nx /= len; nz /= len;
      if (nx + nz <= 0) continue;   // faces away from the viewer
      sides.push({ depth: x0 + x1 + z0 + z1, nx, nz, pts: [P(x0, 0, z0), P(x1, 0, z1), P(x1, h, z1), P(x0, h, z0)] });
    }
    sides.sort((a, b) => a.depth - b.depth);
    const curved = draft.shape === 'cyl';
    for (const f of sides) face(f.pts, shade(color, 0.62 + 0.3 * Math.max(0, f.nz)), !curved);
    if (curved) {   // outline the silhouette once instead of every facet
      const px = outline.map(([x, z]) => P(x, 0, z));
      const iL = px.reduce((m, p, i) => (p[0] < px[m][0] ? i : m), 0);
      const iR = px.reduce((m, p, i) => (p[0] > px[m][0] ? i : m), 0);
      g.lineWidth = 2; g.strokeStyle = '#000';
      g.beginPath();
      for (const i of [iL, iR]) { g.moveTo(px[i][0], px[i][1]); g.lineTo(px[i][0], px[i][1] - h * s); }
      for (const f of sides) { g.moveTo(f.pts[0][0], f.pts[0][1]); g.lineTo(f.pts[1][0], f.pts[1][1]); }
      g.stroke();
    }
    face(outline.map(([x, z]) => P(x, h, z)), shade(color, 1.15), true);
    writeCaption();
  }

  function syncDraftInputs() {
    normalizeShape(draft);
    $('dName').value = draft.name;
    $('dW').value = draft.w; $('dH').value = draft.h; $('dD').value = draft.d;
    $('dArm').value = draft.arm || '';
    $('dBoard').value = draft.board || '';
    $('dLid').checked = !!draft.lid;
    $('dColor').value = draft.color;
    markSwatch($('dSwatches'), draft.color);
    markShape($('dShape'), draft.shape);
    shapeFields('d', draft.shape);
    drawPreview();
  }

  function renderPallets(st) {
    $('usePallets').checked = !state.noPallet;
    $('palletEdit').hidden = state.noPallet;
    $('noPalletBox').hidden = !state.noPallet;
    $('loadSize').textContent = st.size ? `${fmt(st.size.w)} × ${fmt(st.size.d)} × ${fmt(st.size.h)} cm` : 'nothing placed';
    if (document.activeElement !== $('pMax')) $('pMax').value = state.maxH;
    const ul = $('palletList');
    ul.innerHTML = '';
    state.pallets.forEach((P, i) => {
      const s = st.per.get(P.id);
      const li = document.createElement('li');
      li.classList.toggle('sel', P.id === palletSelId);
      li.innerHTML = '<span class="pid"></span><span class="nm"></span><button class="x" title="Remove pallet">✕</button>';
      li.children[0].textContent = `P${i + 1}`;
      li.children[1].textContent = `${fmt(P.w)} × ${fmt(P.d)} cm`;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = `${s.units} unit${s.units === 1 ? '' : 's'} · ${pct(s.covered)} floor`;
      li.children[1].appendChild(sub);
      li.children[2].disabled = state.pallets.length < 2;
      li.children[2].addEventListener('click', (e) => { e.stopPropagation(); removePallet(P.id); });
      li.addEventListener('click', () => { palletSelId = P.id; rebuildPallets(); refresh(); });
      ul.appendChild(li);
    });
    const P = selPallet();
    $('palTag').textContent = `P${state.pallets.indexOf(P) + 1}`;
    const setIfIdle = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    setIfIdle('pW', P.w); setIfIdle('pD', P.d); setIfIdle('pT', P.t);
    setIfIdle('pX', P.x); setIfIdle('pZ', P.z);
    setIfIdle('pMax', state.maxH); setIfIdle('pGap', state.gap);
  }

  function renderSelected() {
    const b = primary();
    const n = sel.size;
    $('selCard').classList.toggle('empty', !b);
    const tag = $('selTag');
    if (!b) { tag.textContent = ''; return; }
    const anyHover = selectedBoxes().some((x) => !x.placed);
    tag.textContent = n > 1 ? `${n} PIECES${anyHover ? ' HOVER' : ''}` : `#${b.id}${anyHover ? ' HOVER' : ''}`;
    tag.classList.toggle('hover', anyHover);
    const setIfIdle = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    setIfIdle('sName', b.name);
    const [W0, H0, D0] = origDims(b);
    setIfIdle('sW', W0); setIfIdle('sH', H0); setIfIdle('sD', D0); setIfIdle('sArm', b.arm || '');
    setIfIdle('sBoard', b.board || '');
    $('sLid').checked = !!b.lid;
    setIfIdle('sX', b.x); setIfIdle('sZ', b.z);
    $('sY').value = round1(b.y);
    setIfIdle('sColor', b.color);
    markSwatch($('sSwatches'), b.color);
    markShape($('sShape'), b.shape);
    shapeFields('s', b.shape);
    $('btnDrop').textContent = anyHover ? 'DROP' : 'LIFT';
    $('btnTip').disabled = !selectedBoxes().some((x) => x.shape === 'box' || x.shape === 'cab');

    const warns = [];
    if (n > 1) warns.push(`${n} pieces selected — changes apply to all. Showing #${b.id}.`);
    if (b.aside) warns.push('Set aside — not on a pallet');
    else if (b.placed) {
      if (b.overhang) warns.push('⚠ Overhangs its pallet');
      if (b.unstable) warns.push(`⚠ Nothing under its centre (${Math.round(b.support * 100)}% contact) — it would tip`);
      if (b.tooTall) warns.push(`⚠ Top at ${fmt(b.y + b.h)} cm exceeds ${fmt(state.maxH)} cm limit`);
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
    const palIndex = new Map(state.pallets.map((P, i) => [P.id, i + 1]));
    for (const b of state.boxes) {
      const li = document.createElement('li');
      li.classList.toggle('sel', sel.has(b.id));
      const flags = [];
      if (!b.placed) flags.push('hover');
      if (b.aside) flags.push('set aside');
      if (b.overhang) flags.push('overhang');
      if (b.unstable) flags.push('unstable');
      if (b.tooTall) flags.push('tall');
      li.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="dm"></span>';
      li.children[0].style.background = b.color;
      if (b.shape === 'cyl') li.children[0].style.borderRadius = '50%';
      li.children[1].textContent = `#${b.id} ${b.name}`;
      if (flags.length) {
        const f = document.createElement('span');
        f.className = 'fl';
        f.textContent = `⚠ ${flags.join(', ')}`;
        li.children[1].appendChild(f);
      }
      li.children[2].textContent = `${dimsText(b)}${b.inside != null ? ` · in #${b.inside}` : ''}${b.palId && state.pallets.length > 1 ? ` · P${palIndex.get(b.palId)}` : ''}`;
      li.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) toggleSelected(b.id);
        else setSelection([b.id], b.id);
        refresh();
      });
      ul.appendChild(li);
    }
  }

  function renderStats(st) {
    $('sPallets').textContent = state.noPallet ? 'none' : state.pallets.length;
    $('sSize').textContent = st.size ? `${fmt(st.size.w)}×${fmt(st.size.d)}×${fmt(st.size.h)}` : '–';
    $('sUnits').textContent = st.units;
    $('sHeight').textContent = `${fmt(st.top)} / ${fmt(state.maxH)} cm`;
    $('sHeight').classList.toggle('bad', st.top > state.maxH + EPS);
    $('sVol').textContent = `${(st.vol / 1e6).toFixed(3)} m³`;
    $('sFloor').textContent = pct(st.floor);
    $('sDensity').textContent = st.density == null ? '–' : pct(st.density);
    $('sIssues').textContent = st.issues;
    $('sNested').textContent = st.nested;
    $('sIssues').classList.toggle('bad', st.issues > 0);
    $('sIssues').classList.toggle('good', st.issues === 0 && st.units > 0);
    $('sFill').textContent = pct(st.fill);
    $('meterFill').style.height = `${Math.min(100, st.fill * 100)}%`;
  }

  let lastStats = null;
  function renderHud() {
    const st = lastStats;
    if (!st) return;
    const b = primary();
    let s = `${VIEW_NAMES[view]}  ${state.noPallet ? 'NO PALLET' : `PALLETS ${state.pallets.length}`}  UNITS ${st.units}  HEIGHT ${fmt(st.top)}`;
    if (b) {
      s += sel.size > 1
        ? `\n▶ ${sel.size} PIECES SELECTED${selectedBoxes().some((x) => !x.placed) ? '  [SPACE=DROP]' : ''}`
        : `\n▶ ${b.name.toUpperCase()}  X${fmt(b.x)} Z${fmt(b.z)} Y${fmt(b.y)}${b.placed ? '' : '  [SPACE=DROP]'}`;
    }
    $('hud').textContent = s;
  }

  function refresh() {
    const st = analyse();
    lastStats = st;
    if (state.noPallet) rebuildPallets();   // the load outline follows the pieces
    syncMeshes();
    renderPallets(st);
    renderSelected();
    renderList();
    renderStats(st);
    renderHud();
    save();
  }

  // ---------------------------------------------------------------- input wiring
  // Apply an edit to every selected piece (one undo step).
  function editSelected(fn) {
    const list = selectedBoxes();
    if (!list.length) return;
    pushUndo();
    for (const b of list) { fn(b); normalizeShape(b); }
    shiftGroup(list, 0, 0);
    settle(new Set(list.map((b) => b.id)));
    refresh();
  }

  function wireUI() {
    // pallets
    const pp = $('palletPresets');
    for (const p of PALLET_PRESETS) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        pushUndo();
        const P = selPallet();
        P.w = p.w; P.d = p.d;
        settle(); rebuildPallets(); refresh();
        setStatus(`P${state.pallets.indexOf(P) + 1} set to ${p.w} × ${p.d} cm.`);
      });
      pp.appendChild(btn);
    }
    [['pW', 'w'], ['pD', 'd'], ['pT', 't'], ['pX', 'x'], ['pZ', 'z']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => { updatePallet(key, e.target.value); e.target.value = selPallet()[key]; });
    });
    $('pMax').addEventListener('change', (e) => {
      const v = num(e.target.value, state.maxH);
      if (v !== state.maxH) { pushUndo(); state.maxH = v; rebuildPallets(); refresh(); }
      e.target.value = state.maxH;
    });
    $('pGap').addEventListener('change', (e) => {
      state.gap = Math.max(0, Number.isFinite(+e.target.value) ? +e.target.value : 0);
      e.target.value = state.gap;
      save();
    });
    $('usePallets').addEventListener('change', (e) => setNoPallet(!e.target.checked));
    $('btnFitPallet').addEventListener('click', fitPalletToLoad);
    $('btnSameColour').addEventListener('click', selectSameColour);
    $('btnAddRight').addEventListener('click', () => addPallet('right'));
    $('btnAddBelow').addEventListener('click', () => addPallet('front'));

    // draft / next piece
    const bp = $('boxPresets');
    for (const p of BOX_PRESETS) {
      const btn = document.createElement('button');
      btn.innerHTML = '<span class="sw"></span>';
      btn.firstChild.style.background = p.color;
      if (p.shape === 'cyl') btn.firstChild.style.borderRadius = '50%';
      btn.appendChild(document.createTextNode(p.name.toUpperCase()));
      btn.title = p.shape === 'cyl' ? `Ø${p.w} × ${p.h} H cm` : `${p.w} W × ${p.h} H × ${p.d} D cm`;
      btn.addEventListener('click', () => { Object.assign(draft, p, { rot: 0, tip: 0 }); syncDraftInputs(); });
      bp.appendChild(btn);
    }
    buildShapeSeg($('dShape'), (shape) => { draft.shape = shape; draft.arm = undefined; syncDraftInputs(); });
    $('dName').addEventListener('input', (e) => { draft.name = e.target.value || 'Box'; });
    $('dLid').addEventListener('change', (e) => { draft.lid = e.target.checked; drawPreview(); });
    [['dW', 'w'], ['dH', 'h'], ['dD', 'd'], ['dArm', 'arm'], ['dBoard', 'board']].forEach(([id, key]) => {
      $(id).addEventListener('input', (e) => {
        draft[key] = num(e.target.value, draft[key]);
        if (draft.shape === 'cyl') draft.d = draft.w;
        normalizeShape(draft);
        drawPreview();
      });
      $(id).addEventListener('change', () => syncDraftInputs());
    });
    $('dColor').addEventListener('input', (e) => { draft.color = e.target.value; markSwatch($('dSwatches'), draft.color); drawPreview(); });
    buildSwatches($('dSwatches'), (c) => { draft.color = c; syncDraftInputs(); });
    $('btnAdd').addEventListener('click', () => spawn(draft));

    // selected pieces
    buildShapeSeg($('sShape'), (shape) => editSelected((b) => {
      if (b.shape === shape) return;
      const o = origDims(b);
      b.shape = shape; b.arm = undefined; b.rot = 0; b.tip = 0;
      applyDims(b, o[0], o[1], o[2]);
      if (shape === 'cyl') b.d = b.w;
    }));
    $('sLid').addEventListener('change', (e) => editSelected((b) => { if (b.shape === 'cab') b.lid = e.target.checked; }));
    buildSwatches($('sSwatches'), (c) => editSelected((b) => { b.color = c; }));
    let colorEditing = false;
    $('sColor').addEventListener('input', (e) => {
      if (!sel.size) return;
      if (!colorEditing) { pushUndo(); colorEditing = true; }
      for (const b of selectedBoxes()) b.color = e.target.value;
      refresh();
    });
    $('sColor').addEventListener('change', () => { colorEditing = false; });
    $('sName').addEventListener('change', (e) => editSelected((b) => { b.name = (e.target.value || 'Box').slice(0, 24); }));
    // W/H/D edit the unit's own size; the placed size follows its tip and rotation.
    const DIM = { w: 0, h: 1, d: 2 };
    [['sW', 'w'], ['sH', 'h'], ['sD', 'd'], ['sArm', 'arm'], ['sBoard', 'board']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => {
        const v = num(e.target.value, null);
        if (v != null) {
          editSelected((b) => {
            if (key === 'arm') { if (b.shape === 'L') b.arm = v; return; }
            if (key === 'board') { if (b.shape === 'cab') b.board = v; return; }
            if (key === 'd' && b.shape === 'cyl') return;
            const o = origDims(b);
            o[DIM[key]] = v;
            if (b.shape === 'cyl' && key === 'w') o[2] = v;
            applyDims(b, o[0], o[1], o[2]);
          });
        }
        const p = primary();
        if (p) e.target.value = key in DIM ? origDims(p)[DIM[key]] : p[key] || '';
      });
    });
    [['sX', 'x'], ['sZ', 'z']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => {
        const p = primary(); if (!p) return;
        const v = Number.isFinite(+e.target.value) ? round1(+e.target.value) : p[key];
        if (v !== p[key]) moveSelected(key === 'x' ? v - p.x : 0, key === 'z' ? v - p.z : 0);
        e.target.value = p[key];
      });
    });
    document.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => moveRelative(btn.dataset.move, false));
    });
    $('btnDrop').addEventListener('click', toggleDrop);
    $('btnRotate').addEventListener('click', rotateSelected);
    $('btnTip').addEventListener('click', tipSelected);
    $('btnAuto').addEventListener('click', autoPlaceSelected);
    $('btnCopy').addEventListener('click', () => {
      const c = copySelected();
      if (c && navigator.clipboard) navigator.clipboard.writeText(clipText(c)).catch(() => {});
    });
    $('btnPaste').addEventListener('click', () => pasteBoxes(clipboard));
    $('btnDup').addEventListener('click', duplicateSelected);
    $('btnDelete').addEventListener('click', deleteSelected);
    $('stepSel').addEventListener('change', (e) => { step = +e.target.value; });

    // toolbar
    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $('btnUndo').addEventListener('click', undo);
    $('btnAutoAll').addEventListener('click', autoPackAll);
    // Two-step clear: the first click arms the button, a second click within 3 s clears.
    let clearArmed = null;
    $('btnClear').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!state.boxes.length) return;
      if (!clearArmed) {
        btn.textContent = 'SURE?';
        clearArmed = setTimeout(() => { clearArmed = null; btn.textContent = 'CLEAR'; }, 3000);
        return;
      }
      clearTimeout(clearArmed); clearArmed = null; btn.textContent = 'CLEAR';
      pushUndo(); state.boxes = []; sel = new Set(); primaryId = null; refresh();
      setStatus('All pieces cleared. (Ctrl+Z to undo)');
    });
    $('btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(JSON.parse(snapshot()), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pallet-load-${state.pallets.length}p.json`;
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
        setView(view, true); refresh();
        setStatus(`Loaded ${f.name}.`);
      } catch (err) {
        restore(before);
        setStatus(`Could not load ${f.name}: ${err.message}`, true);
      }
    });
  }

  // Arrow keys move relative to the camera: "up" pushes the selection away from you.
  function moveRelative(dir, fine) {
    const f = new THREE.Vector3();
    activeCam().getWorldDirection(f);
    let fx = f.x, fz = f.z;
    if (Math.abs(fx) < 1e-3 && Math.abs(fz) < 1e-3) { fx = 0; fz = -1; }   // plan view: up = back
    const fwd = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    const right = [-fwd[1], fwd[0]];
    const s = fine ? 1 : step;
    const v = { up: fwd, down: [-fwd[0], -fwd[1]], right, left: [-right[0], -right[1]] }[dir];
    moveSelected(v[0] * s, v[1] * s);
  }

  const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

  function wireKeys() {
    let pasteFallback = null;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); undo(); }
        else if (k === 'a') { e.preventDefault(); setSelection(state.boxes.map((b) => b.id), primaryId); refresh(); }
        else if (k === 'c') copySelected();            // the copy event also fills the system clipboard
        else if (k === 'x') { if (copySelected(true)) { const n = sel.size; deleteSelected(); setStatus(`Cut ${n} piece${n > 1 ? 's' : ''}. Ctrl+V to paste.`); } }
        else if (k === 'v') {
          // Prefer the paste event (system clipboard); fall back to the internal buffer.
          clearTimeout(pasteFallback);
          pasteFallback = setTimeout(() => pasteBoxes(clipboard), 40);
        } else if (k === 'd') { e.preventDefault(); duplicateSelected(); }
        return;
      }
      if (e.altKey) return;
      const arrows = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
      if (arrows[k]) { e.preventDefault(); moveRelative(arrows[k], e.shiftKey); return; }
      switch (k) {
        case ' ': e.preventDefault(); toggleDrop(); break;
        case 'enter': case 'n': spawn(draft); break;
        case 'r': rotateSelected(); break;
        case 't': tipSelected(); break;
        case 'd': duplicateSelected(); break;
        case 'a': autoPlaceSelected(); break;
        case 'delete': case 'backspace': e.preventDefault(); deleteSelected(); break;
        case 'tab': e.preventDefault(); cycleSelection(e.shiftKey ? -1 : 1); break;
        case 'escape': setSelection([]); refresh(); break;
        case '1': setView('3d'); break;
        case '2': setView('top'); break;
        case '3': setView('front'); break;
        case '4': setView('side'); break;
        default: break;
      }
    });

    const onCopy = (e) => {
      if (isTyping(e.target) || !clipboard) return;
      e.clipboardData.setData('text/plain', clipText(clipboard));
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', (e) => {
      if (isTyping(e.target)) return;
      clearTimeout(pasteFallback);
      e.preventDefault();
      let list = clipboard;
      try {
        const data = JSON.parse(e.clipboardData.getData('text/plain'));
        if (data && data.tag === CLIP_TAG && Array.isArray(data.boxes)) list = data.boxes;
      } catch (err) { /* not ours: use the internal buffer */ }
      pasteBoxes(list);
    });
  }

  // Mouse: click selects (Ctrl+click toggles); dragging a piece lifts the whole
  // selection and carries it; dragging a pallet moves it with its load.
  function wirePointer() {
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let ptr = null;

    function setRay(e) {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, activeCam());
    }
    function pick(e) {
      setRay(e);
      const targets = [];
      for (const m of meshes.values()) targets.push(m.mesh, m.label);
      for (const o of palletGroup.children) if (o.userData.palletId) targets.push(o);
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return null;
      const o = hit.object;
      return o.userData.palletId
        ? { kind: 'pallet', id: o.userData.palletId, point: hit.point }
        : { kind: 'box', id: o.userData.id, point: hit.point };
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const hit = pick(e);
      ptr = { sx: e.clientX, sy: e.clientY, hit, dragging: false, ctrl: e.ctrlKey || e.metaKey };
      if (hit) activeCtl().enabled = false;
    });

    function startDrag() {
      const { hit } = ptr;
      pushUndo();
      if (hit.kind === 'box') {
        if (!sel.has(hit.id)) {
          if (ptr.ctrl) setSelection([...sel, hit.id], hit.id);
          else setSelection([hit.id], hit.id);
        }
        ptr.group = selectedBoxes();
        liftGroup(ptr.group);
      } else {
        palletSelId = hit.id;
        ptr.pallet = getPallet(hit.id);
        ptr.group = loadOf(ptr.pallet);
        ptr.pStart = { x: ptr.pallet.x, z: ptr.pallet.z };
      }
      ptr.start = new Map(ptr.group.map((b) => [b.id, { x: b.x, z: b.z }]));
      // Drag across a horizontal plane, or a vertical one in the elevations.
      const dir = ray.ray.direction;
      ptr.plane = Math.abs(dir.y) > 0.25
        ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y)
        : new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(dir.x, 0, dir.z).normalize(), hit.point);
      el.style.cursor = 'grabbing';
    }

    window.addEventListener('pointermove', (e) => {
      if (!ptr || !ptr.hit) return;
      if (!ptr.dragging) {
        if (Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) < 5) return;
        ptr.dragging = true;
        startDrag();
      }
      setRay(e);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(ptr.plane, p)) return;
      const snap = e.shiftKey ? 1 : step;
      let dx = Math.round((p.x - ptr.hit.point.x) / snap) * snap;
      let dz = Math.round((p.z - ptr.hit.point.z) / snap) * snap;
      if (ptr.pallet) {
        const P = ptr.pallet;
        dx -= P.x - ptr.pStart.x; dz -= P.z - ptr.pStart.z;   // delta since the last move
        if (!dx && !dz) return;
        movePallet(P, dx, dz, ptr.group);
        settle();
        rebuildPallets();
        refresh();
        return;
      }
      // Re-apply the total delta from each piece's start position.
      for (const b of ptr.group) { const s = ptr.start.get(b.id); b.x = s.x; b.z = s.z; }
      shiftGroup(ptr.group, dx, dz);
      settle();
      refresh();
    });

    window.addEventListener('pointerup', (e) => {
      if (!ptr) return;
      const p = ptr;
      ptr = null;
      activeCtl().enabled = true;
      el.style.cursor = '';
      if (p.dragging) {
        if (p.pallet) setStatus(`Pallet moved to x ${p.pallet.x}, z ${p.pallet.z} with ${p.group.length} piece(s).`);
        else dropGroup(p.group);
        return;
      }
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (e.target !== el || moved > 5) return;   // orbiting / panning, not clicking
      if (p.hit && p.hit.kind === 'box') {
        if (p.ctrl) toggleSelected(p.hit.id);
        else setSelection([p.hit.id], p.hit.id);
      } else if (p.hit && p.hit.kind === 'pallet') {
        palletSelId = p.hit.id;
        if (!p.ctrl) setSelection([]);
        rebuildPallets();
      } else if (!p.ctrl) {
        setSelection([]);
      }
      refresh();
    });
  }

  // ---------------------------------------------------------------- boot
  load();
  syncDraftInputs();
  wireUI();
  wireKeys();
  wirePointer();
  resize();
  setView('3d', true);
  refresh();
  if (state.boxes.length) setStatus(`Restored ${state.boxes.length} pieces from your last session.`);
  requestAnimationFrame(tick);

  // exposed for debugging / tests
  window.stacker = { state, spawn, autoPackAll, analyse, findSpot, settle, refresh, setSelection, setView, pasteBoxes, draft, get sel() { return sel; }, camera: () => activeCam(), origin, canvas: renderer.domElement };
})();
