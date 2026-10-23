// "Dunes": an original desert map with two bomb sites, a mid lane, tunnels and a long lane.
// The layout is a grid of 2m cells. Open areas are carved out of solid rock; leftover solid
// areas become buildings of varying height.
import * as THREE from 'three';
import { letterTexture, surfaceMaterial } from './textures.js';
import { solidDistance, mergeBands, blockHash, addEdgeTrims, buildContactShadows } from './mapkit.js';

export const CELL = 2;
export const GW = 60, GH = 60;
export const WORLD = GW * CELL;

// [x0, z0, x1, z1] in cells, end exclusive
const OPEN = [
  [20, 48, 40, 58], // T spawn
  [24, 2, 37, 10],  // CT spawn
  [42, 4, 57, 18],  // A site
  [3, 4, 17, 20],   // B site
  [28, 10, 32, 48], // mid
  [40, 49, 57, 53], // T -> long A
  [52, 18, 57, 53], // long A
  [32, 28, 44, 31], // catwalk
  [41, 18, 44, 31], // short A
  [8, 50, 20, 54],  // T -> B tunnels
  [7, 20, 12, 54],  // B tunnels
  [17, 5, 24, 9],   // CT -> B
  [37, 5, 42, 9],   // CT -> A
  [17, 16, 28, 20], // mid -> B
];
const FILL = [
  [28, 20, 29, 22], [31, 20, 32, 22], // mid doors
  [28, 44, 31, 45], [30, 38, 32, 39], // mid walls (break the spawn-to-spawn sightline)
  [52, 36, 54, 38], [56, 36, 57, 38], // long doors
  [7, 34, 10, 35], [9, 28, 12, 29],   // B tunnel zigzag
  [9, 9, 11, 11],   // B pillar
  [48, 8, 50, 9],   // A pillar
];
// crates in meters: x, z, w, d, h, y
const CRATES = [
  [94, 12, 2.5, 2.5, 1.6, 0], [94, 12, 1.5, 1.5, 1.0, 1.6],
  [104, 26, 2, 2, 1, 0], [106, 26, 2, 2, 2, 0],
  [90, 30, 1.8, 1.8, 0.9, 0], [110, 10, 2.4, 2.4, 1.6, 0],
  [14, 12, 2.5, 2.5, 1.6, 0], [26, 14, 2, 2, 2, 0],
  [28, 30, 2.4, 2.4, 1.6, 0], [28, 30, 1.4, 1.4, 1.0, 1.6],
  [12, 32, 1.8, 1.8, 0.9, 0], [30, 24, 2, 2, 1, 0],
  [58, 60, 1.8, 1.8, 1.6, 0], [61, 34, 1.6, 1.6, 1.0, 0],
  [50, 104, 2, 2, 1.6, 0], [70, 108, 2.4, 2.4, 1.6, 0],
  [50, 6, 2, 2, 1.6, 0], [72, 18, 2, 2, 1, 0],
  [106, 80, 2, 2, 1.6, 0], [112, 60, 1.8, 1.8, 1.0, 0], [108, 44, 2, 2, 2, 0],
  [21, 88, 1.6, 1.6, 1.0, 0], [80, 58, 1.6, 1.6, 0.9, 0],
];
// overhead beams / roofs: x0, y0, z0, x1, y1, z1
const BEAMS = [
  [58, 3.4, 40, 62, 4.6, 44],     // mid doors
  [108, 3.4, 72, 112, 4.6, 76],   // long doors
  [14, 3.6, 56, 24, 4.3, 80],     // tunnel roof
];

export const SITES = {
  A: { x0: 86, z0: 9, x1: 112, z1: 34, center: new THREE.Vector3(99, 0, 21) },
  B: { x0: 8, z0: 9, x1: 32, z1: 38, center: new THREE.Vector3(20, 0, 24) },
};
export const SPAWNS = {
  T: [[54, 108], [58, 103], [62, 108], [66, 103], [74, 104]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  CT: [[56, 8], [60, 12], [64, 8], [68, 12], [60, 16]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
};
export const SPAWN_CENTER = { T: new THREE.Vector3(60, 0, 106), CT: new THREE.Vector3(61, 0, 11) };
const v = (x, z, y = 1.4) => new THREE.Vector3(x, y, z);
export const ENTRANCES = {
  A: [v(78, 12), v(85, 40), v(109, 40)],
  B: [v(36, 12), v(19, 44), v(38, 36)],
};
export const PLANT_SPOTS = {
  A: [v(98, 24, 0), v(92, 20, 0), v(106, 16, 0)],
  B: [v(24, 28, 0), v(14, 24, 0), v(29, 11, 0)],
};
// The ways the Terrorists can attack each site.
//   via:   waypoints from T spawn (so bots don't all take the single shortest path)
//   stage: a spot just out of sight of the site, where a group gathers before the hit
//   look:  where to watch while waiting at the stage
//   entry: the doorway into the site that the final push goes through
export const T_ROUTES = {
  A: {
    long:  { via: [v(92, 102, 0), v(109, 99, 0)], stage: v(106, 85, 0), look: v(110, 70), entry: v(110, 47, 0) },
    short: { via: [v(61, 82, 0), v(60, 66, 0)], stage: v(75, 59, 0), look: v(86, 58), entry: v(85, 42, 0) },
  },
  B: {
    tunnels: { via: [v(28, 104, 0), v(19, 92, 0)], stage: v(21, 63, 0), look: v(19, 46), entry: v(19, 44, 0) },
    // waits in upper mid beside the doors (out of sight of the connector), then goes through
    mid:     { via: [v(61, 82, 0), v(60, 62, 0)], stage: v(57, 48, 0), look: v(60, 42), entry: v(37, 36, 0) },
  },
};
// Map-control spots the Terrorists spread out to on a "default" round, by which half of the map
// they cover. None of them look straight up the mid lane, so defaults don't turn into mid duels.
export const T_CONTROL = [
  { pos: v(106, 85, 0), look: v(110, 70), side: 'A' },   // long, behind the doors
  { pos: v(110, 90, 0), look: v(110, 76), side: 'A' },   // long, further back
  { pos: v(74, 59, 0), look: v(86, 58), side: 'A' },     // catwalk, next to short
  { pos: v(21, 63, 0), look: v(19, 46), side: 'B' },     // tunnels, between the zigzags
  { pos: v(19, 82, 0), look: v(21, 64), side: 'B' },     // lower tunnels
  { pos: v(58, 93, 0), look: v(60, 78), side: 'mid' },   // bottom of mid, behind the zigzag
];
export const CT_HOLDS = {
  A: [{ pos: v(100, 24, 0), look: v(109, 44) }, { pos: v(90, 14, 0), look: v(85, 44) }, { pos: v(108, 15, 0), look: v(109, 44) }],
  B: [{ pos: v(22, 30, 0), look: v(19, 46) }, { pos: v(12, 15, 0), look: v(38, 36) }, { pos: v(28, 10, 0), look: v(19, 46) }],
  // the mid player sits back in the B connector, watching the mid doors up close instead of the
  // whole mid lane, and helps whichever site gets hit
  MID: [{ pos: v(50, 37, 0), look: v(60, 42) }, { pos: v(46, 33, 0), look: v(58, 38) }],
};

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const absDot = (a, h) => Math.abs(a[0]) * h[0] + Math.abs(a[1]) * h[1] + Math.abs(a[2]) * h[2];

// Builds one merged geometry out of many boxes.
export class BoxBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  box(x0, y0, z0, x1, y1, z1, opt = {}) {
    const scale = opt.uvScale || 4, tint = opt.tint || [1, 1, 1];
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const h = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
    for (const f of FACES) {
      if (opt.noBottom && f.n[1] === -1) continue;
      const base = this.p.length / 3;
      const hn = absDot(f.n, h), hu = absDot(f.u, h), hv = absDot(f.v, h);
      for (const [su, sv] of CORNERS) {
        const x = c[0] + f.n[0] * hn + f.u[0] * hu * su + f.v[0] * hv * sv;
        const y = c[1] + f.n[1] * hn + f.u[1] * hu * su + f.v[1] * hv * sv;
        const z = c[2] + f.n[2] * hn + f.u[2] * hu * su + f.v[2] * hv * sv;
        this.p.push(x, y, z);
        this.n.push(f.n[0], f.n[1], f.n[2]);
        if (opt.faceUV) this.uv.push((su + 1) / 2, (sv + 1) / 2);
        else this.uv.push((x * f.u[0] + y * f.u[1] + z * f.u[2]) / scale, (x * f.v[0] + y * f.v[1] + z * f.v[2]) / scale);
        let shade = 1;
        if (opt.ao && f.n[1] === 0 && sv < 0 && y < 0.5) shade = 0.7;
        if (f.n[1] === -1) shade = 0.6;
        this.c.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// tiny binary heap for A*
class Heap {
  constructor() { this.ids = []; this.f = []; }
  get size() { return this.ids.length; }
  push(id, f) {
    const a = this.ids, fs = this.f;
    a.push(id); fs.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p] <= fs[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [fs[p], fs[i]] = [fs[i], fs[p]];
      i = p;
    }
  }
  pop() {
    const a = this.ids, fs = this.f;
    const top = a[0];
    const lastId = a.pop(), lastF = fs.pop();
    if (a.length) {
      a[0] = lastId; fs[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && fs[l] < fs[m]) m = l;
        if (r < a.length && fs[r] < fs[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [fs[m], fs[i]] = [fs[i], fs[m]];
        i = m;
      }
    }
    return top;
  }
}

export class GameMap {
  constructor(scene, tex) {
    this.grid = new Uint8Array(GW * GH).fill(1);
    for (const [x0, z0, x1, z1] of OPEN) this.setRect(x0, z0, x1, z1, 0);
    for (const [x0, z0, x1, z1] of FILL) this.setRect(x0, z0, x1, z1, 1);
    this.colliders = [];
    this.crates = CRATES.map(([x, z, w, d, h, y]) => ({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y0: y, y1: y + h }));
    // Layered skyline: street-facing walls share one height per block, with taller
    // buildings stepping up behind them, instead of random heights everywhere.
    const isSolid = (x, z) => this.solid(x, z);
    const dist = solidDistance(isSolid, GW, GH);
    const band = (x, z) => Math.min(3, dist[z * GW + x]);
    const rects = mergeBands(isSolid, band, GW, GH);
    const bandH = [0, 5.5, 7.2, 8.8];
    const tints = [[1, 1, 1], [0.96, 0.92, 0.85], [0.9, 0.87, 0.82], [1, 0.95, 0.87]];
    this.cellH = new Float32Array(GW * GH);
    for (const rc of rects) {
      const cx = rc.x + rc.w / 2, cz = rc.z + rc.d / 2;
      rc.h = bandH[rc.band] + Math.floor(blockHash(cx, cz, 6) * 3) * 0.5;
      rc.tint = tints[Math.floor(blockHash(cx + 100, cz, 8) * tints.length)];
      for (let z = rc.z; z < rc.z + rc.d; z++) for (let x = rc.x; x < rc.x + rc.w; x++) this.cellH[z * GW + x] = rc.h;
      this.colliders.push({ x0: rc.x * CELL, z0: rc.z * CELL, x1: (rc.x + rc.w) * CELL, z1: (rc.z + rc.d) * CELL, y0: 0, y1: rc.h });
    }
    for (const c of this.crates) this.colliders.push(c);
    for (const [x0, y0, z0, x1, y1, z1] of BEAMS) this.colliders.push({ x0, y0, z0, x1, y1, z1 });
    this.buildNav();
    this.buildMeshes(scene, tex, rects);
    this.radarImage = this.drawRadar(220);
  }

  setRect(x0, z0, x1, z1, val) {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.grid[z * GW + x] = val;
  }
  solid(x, z) { return x < 0 || z < 0 || x >= GW || z >= GH || this.grid[z * GW + x] === 1; }

  buildMeshes(scene, tex, rects) {
    const walls = new BoxBuilder(), trims = new BoxBuilder(), bases = new BoxBuilder();
    for (const rc of rects) {
      const x0 = rc.x * CELL, z0 = rc.z * CELL, x1 = (rc.x + rc.w) * CELL, z1 = (rc.z + rc.d) * CELL;
      walls.box(x0, 0, z0, x1, rc.h, z1, { uvScale: 4, tint: rc.tint, ao: true, noBottom: true });
    }
    for (const [x0, y0, z0, x1, y1, z1] of BEAMS) walls.box(x0, y0, z0, x1, y1, z1, { uvScale: 4, tint: [0.75, 0.68, 0.6] });
    // cornice + baseboard along street-facing walls
    addEdgeTrims(trims, bases, {
      isSolid: (x, z) => this.solid(x, z), isOpen: (x, z) => !this.solid(x, z),
      cellH: this.cellH, gw: GW, gh: GH, cell: CELL, topTint: [0.8, 0.76, 0.7], baseTint: [0.6, 0.52, 0.44],
    });

    const wallMat = surfaceMaterial(tex, 'wall');
    for (const b of [walls, trims, bases]) {
      const m = new THREE.Mesh(b.geometry(), wallMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }

    const crates = new BoxBuilder();
    for (const c of this.crates) crates.box(c.x0, c.y0, c.z0, c.x1, c.y1, c.z1, { faceUV: true, noBottom: true });
    const crateMesh = new THREE.Mesh(crates.geometry(), surfaceMaterial(tex, 'crate', { roughness: 0.9 }));
    crateMesh.castShadow = crateMesh.receiveShadow = true;
    scene.add(crateMesh);

    const floor = new BoxBuilder();
    floor.box(-40, -1, -40, WORLD + 40, 0, WORLD + 40, { uvScale: 8, noBottom: true });
    const floorMesh = new THREE.Mesh(floor.geometry(), surfaceMaterial(tex, 'sand', { roughness: 0.97 }));
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const tiles = new BoxBuilder();
    for (const s of Object.values(SITES)) tiles.box(s.x0, 0, s.z0, s.x1, 0.02, s.z1, { uvScale: 4, noBottom: true });
    const tileMesh = new THREE.Mesh(tiles.geometry(), surfaceMaterial(tex, 'tile', { roughness: 0.93 }));
    tileMesh.receiveShadow = true;
    scene.add(tileMesh);

    // soft contact shadows where the floor meets walls and crates
    buildContactShadows(scene, { isSolid: (x, z) => this.solid(x, z), gw: GW, gh: GH, cell: CELL, boxes: this.crates, strength: 0.42 });

    for (const [k, s] of Object.entries(SITES)) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
        new THREE.MeshLambertMaterial({ map: letterTexture(k), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.center.x, 0.04, s.center.z);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ---------- navigation ----------
  buildNav() {
    this.walk = new Uint8Array(GW * GH);
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      if (this.solid(x, z)) continue;
      const cx0 = x * CELL + 0.4, cx1 = x * CELL + 1.6, cz0 = z * CELL + 0.4, cz1 = z * CELL + 1.6;
      let blocked = false;
      for (const c of this.crates) {
        if (c.y0 > 0.5) continue;
        if (c.x1 + 0.4 > cx0 && c.x0 - 0.4 < cx1 && c.z1 + 0.4 > cz0 && c.z0 - 0.4 < cz1) { blocked = true; break; }
      }
      this.walk[z * GW + x] = blocked ? 0 : 1;
    }
    this.gScore = new Float32Array(GW * GH);
    this.came = new Int32Array(GW * GH);
    this.stamp = new Uint32Array(GW * GH);
    this.closed = new Uint32Array(GW * GH);
    this.searchId = 0;
  }
  walkable(x, z) { return x >= 0 && z >= 0 && x < GW && z < GH && this.walk[z * GW + x] === 1; }
  walkablePoint(x, z) { return this.walkable(Math.floor(x / CELL), Math.floor(z / CELL)); }

  nearestWalkable(cx, cz) {
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!this.walkable(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
      if (best) return best;
    }
    return null;
  }

  findPath(from, to) {
    const s = this.nearestWalkable(Math.floor(from.x / CELL), Math.floor(from.z / CELL));
    const t = this.nearestWalkable(Math.floor(to.x / CELL), Math.floor(to.z / CELL));
    if (!s || !t) return null;
    const id = ++this.searchId;
    const start = s[1] * GW + s[0], goal = t[1] * GW + t[0];
    const g = this.gScore, came = this.came, stamp = this.stamp, closed = this.closed;
    const heap = new Heap();
    const hfun = (n) => {
      const dx = Math.abs((n % GW) - t[0]), dz = Math.abs(((n / GW) | 0) - t[1]);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    stamp[start] = id; g[start] = 0; came[start] = -1;
    heap.push(start, hfun(start));
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === goal) { found = true; break; }
      const cx = cur % GW, cz = (cur / GW) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.walkable(nx, nz)) continue;
        if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz))) continue;
        const n = nz * GW + nx;
        if (closed[n] === id) continue;
        const ng = g[cur] + (dx && dz ? 1.414 : 1);
        if (stamp[n] !== id || ng < g[n]) {
          stamp[n] = id; g[n] = ng; came[n] = cur;
          heap.push(n, ng + hfun(n));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let n = goal; n !== -1; n = came[n]) cells.push(n);
    cells.reverse();
    const pts = cells.map((n) => new THREE.Vector3((n % GW) * CELL + CELL / 2, 0, ((n / GW) | 0) * CELL + CELL / 2));
    pts[0] = new THREE.Vector3(from.x, 0, from.z);
    if (this.walkablePoint(to.x, to.z)) pts[pts.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    else if (pts.length === 1) pts.push(new THREE.Vector3(to.x, 0, to.z));
    return this.smooth(pts);
  }

  clearLine(a, b, rad = 0.45) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const px = -dz / len * rad, pz = dx / len * rad;
    const steps = Math.ceil(len / 0.35);
    for (let i = 0; i <= steps; i++) {
      const x = a.x + dx * i / steps, z = a.z + dz * i / steps;
      if (!this.walkablePoint(x, z) || !this.walkablePoint(x + px, z + pz) || !this.walkablePoint(x - px, z - pz)) return false;
    }
    return true;
  }

  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clearLine(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  inSite(p) {
    for (const [k, s] of Object.entries(SITES)) if (p.x > s.x0 && p.x < s.x1 && p.z > s.z0 && p.z < s.z1) return k;
    return null;
  }
  siteNear(p, margin) {
    for (const [k, s] of Object.entries(SITES)) {
      if (p.x > s.x0 - margin && p.x < s.x1 + margin && p.z > s.z0 - margin && p.z < s.z1 + margin) return k;
    }
    return null;
  }
  randomPointInSite(site, near = null, radius = 8) {
    const s = SITES[site];
    for (let tries = 0; tries < 60; tries++) {
      const x = s.x0 + 1 + Math.random() * (s.x1 - s.x0 - 2);
      const z = s.z0 + 1 + Math.random() * (s.z1 - s.z0 - 2);
      if (near && Math.hypot(x - near.x, z - near.z) > radius) continue;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (this.walkable(cx, cz)) return new THREE.Vector3(cx * CELL + 1, 0, cz * CELL + 1);
    }
    return s.center.clone();
  }

  drawRadar(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const k = size / WORLD;
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, size, size);
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      if (this.solid(x, z)) continue;
      ctx.fillStyle = 'rgba(205,190,160,0.55)';
      ctx.fillRect(x * CELL * k, z * CELL * k, CELL * k + 0.6, CELL * k + 0.6);
    }
    ctx.fillStyle = 'rgba(120,90,50,0.8)';
    for (const cr of this.crates) ctx.fillRect(cr.x0 * k, cr.z0 * k, (cr.x1 - cr.x0) * k, (cr.z1 - cr.z0) * k);
    ctx.font = '700 22px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(230,70,50,0.9)';
    for (const [key, s] of Object.entries(SITES)) ctx.fillText(key, s.center.x * k, s.center.z * k);
    return c;
  }
}
