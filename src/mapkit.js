// Shared helpers that make the grid-built maps look smoother and more cohesive:
// layered building heights, wall trims and soft contact shadows on the floor.
import * as THREE from 'three';

// Distance (in cells, 4-neighbour steps) from every solid cell to the nearest open cell.
export function solidDistance(isSolid, gw, gh) {
  const d = new Uint8Array(gw * gh).fill(255);
  const q = [];
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) if (!isSolid(x, z)) { d[z * gw + x] = 0; q.push(z * gw + x); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % gw, z = (i / gw) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
      const n = nz * gw + nx;
      if (d[n] > d[i] + 1) { d[n] = d[i] + 1; q.push(n); }
    }
  }
  return d;
}

// Greedy-merge solid cells into rectangles, never mixing different height bands.
export function mergeBands(isSolid, band, gw, gh, maxSize = 12) {
  const used = new Uint8Array(gw * gh), rects = [];
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (!isSolid(x, z) || used[z * gw + x]) continue;
    const b = band(x, z);
    const ok = (cx, cz) => cx < gw && cz < gh && isSolid(cx, cz) && !used[cz * gw + cx] && band(cx, cz) === b;
    let w = 1;
    while (ok(x + w, z) && w < maxSize) w++;
    let d = 1;
    outer: while (d < maxSize) {
      for (let i = 0; i < w; i++) if (!ok(x + i, z + d)) break outer;
      d++;
    }
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used[(z + j) * gw + x + i] = 1;
    rects.push({ x, z, w, d, band: b });
  }
  return rects;
}

// Small deterministic hash so neighbouring rectangles in the same "block" share height/tint.
export function blockHash(x, z, size = 5) {
  const bx = Math.floor(x / size), bz = Math.floor(z / size);
  let h = (bx * 374761393 + bz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A cornice along the top and a baseboard along the bottom of every wall face that looks
// onto open ground. One straight segment per cell edge, so nothing overlaps or flickers.
export function addEdgeTrims(top, base, { isSolid, isOpen, cellH, gw, gh, cell, topTint, baseTint }) {
  const O = 0.13, OB = 0.05, TH = 0.24, BH = 0.34;
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (!isSolid(x, z)) continue;
    const h = cellH[z * gw + x];
    const x0 = x * cell, x1 = x0 + cell, z0 = z * cell, z1 = z0 + cell;
    if (x + 1 < gw && isOpen(x + 1, z)) { top.box(x1, h - 0.02, z0, x1 + O, h + TH, z1, { uvScale: 2, tint: topTint }); base.box(x1, 0, z0, x1 + OB, BH, z1, { uvScale: 2, tint: baseTint }); }
    if (x - 1 >= 0 && isOpen(x - 1, z)) { top.box(x0 - O, h - 0.02, z0, x0, h + TH, z1, { uvScale: 2, tint: topTint }); base.box(x0 - OB, 0, z0, x0, BH, z1, { uvScale: 2, tint: baseTint }); }
    if (z + 1 < gh && isOpen(x, z + 1)) { top.box(x0, h - 0.02, z1, x1, h + TH, z1 + O, { uvScale: 2, tint: topTint }); base.box(x0, 0, z1, x1, BH, z1 + OB, { uvScale: 2, tint: baseTint }); }
    if (z - 1 >= 0 && isOpen(x, z - 1)) { top.box(x0, h - 0.02, z0 - O, x1, h + TH, z0, { uvScale: 2, tint: topTint }); base.box(x0, 0, z0 - OB, x1, BH, z0, { uvScale: 2, tint: baseTint }); }
  }
}

let aoTex = null;
function contactTexture() {
  if (aoTex) return aoTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 4;
  const ctx = c.getContext('2d'), img = ctx.createImageData(128, 4);
  for (let x = 0; x < 128; x++) {
    const t = x / 127, a = Math.pow(1 - t, 2.2) * 255;
    for (let y = 0; y < 4; y++) { const i = (y * 128 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = a; }
  }
  ctx.putImageData(img, 0, 0);
  aoTex = new THREE.CanvasTexture(c);
  aoTex.wrapS = aoTex.wrapT = THREE.ClampToEdgeWrapping;
  return aoTex;
}

// Soft dark gradients on the floor where it meets walls and crates (cheap ambient occlusion).
// Inside corners get two overlapping strips and come out darker, like real contact shadows.
export function buildContactShadows(scene, { isSolid, gw, gh, cell, boxes = [], strength = 0.5, width = 1.3, y = 0.026 }) {
  const pos = [], uv = [], idx = [];
  // quad from the dark edge (a0-a1) extending `w` along direction (dx, dz)
  const strip = (ax, az, bx, bz, dx, dz, w) => {
    const i = pos.length / 3;
    pos.push(ax, y, az, bx, y, bz, bx + dx * w, y, bz + dz * w, ax + dx * w, y, az + dz * w);
    uv.push(0, 0, 0, 1, 1, 1, 1, 0);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (isSolid(x, z)) continue;
    const x0 = x * cell, x1 = x0 + cell, z0 = z * cell, z1 = z0 + cell;
    if (isSolid(x - 1, z)) strip(x0, z0, x0, z1, 1, 0, width);
    if (isSolid(x + 1, z)) strip(x1, z0, x1, z1, -1, 0, width);
    if (isSolid(x, z - 1)) strip(x0, z0, x1, z0, 0, 1, width);
    if (isSolid(x, z + 1)) strip(x0, z1, x1, z1, 0, -1, width);
  }
  const bw = width * 0.55;
  for (const b of boxes) {
    if (b.y0 > 0.1) continue;
    strip(b.x0, b.z0, b.x0, b.z1, -1, 0, bw);
    strip(b.x1, b.z0, b.x1, b.z1, 1, 0, bw);
    strip(b.x0, b.z0, b.x1, b.z0, 0, -1, bw);
    strip(b.x0, b.z1, b.x1, b.z1, 0, 1, bw);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    map: contactTexture(), transparent: true, opacity: strength, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.renderOrder = 1;
  scene.add(m);
  return m;
}
