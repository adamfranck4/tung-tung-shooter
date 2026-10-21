// "Sahur Village": the Zombies map. A night-time village built on a grid of 2m cells.
// Five areas are unlocked with doors; zombies climb in through boarded windows
// (spawning in small pockets outside) or rise out of the ground.
import * as THREE from 'three';
import { BoxBuilder } from './map.js';
import { surfaceMaterial } from './textures.js';
import { solidDistance, mergeBands, blockHash, addEdgeTrims, buildContactShadows } from './mapkit.js';
import { WEAPONS } from './weapons.js';

const C = 2;                 // cell size in meters
const GW = 60, GH = 40;
export const ZW = GW * C, ZH = GH * C;   // 120 m x 80 m
export const ZWORLD = ZW;

// [x0, z0, x1, z1] in cells, end exclusive
export const AREAS = {
  A: { name: 'Spawn Room', rect: [15, 27, 25, 35], indoor: true },
  B: { name: 'Courtyard', rect: [10, 11, 30, 24] },
  C: { name: 'Kitchen', rect: [27, 25, 37, 37], indoor: true },
  D: { name: 'Drum Tower', rect: [14, 2, 26, 8], indoor: true },
  E: { name: 'Garden', rect: [4, 13, 9, 27] },
  F: { name: 'Sahur Hill', rect: [40, 4, 56, 22] },
};
const CORRIDORS = [[19, 24, 21, 27], [25, 30, 27, 32], [27, 24, 29, 25], [19, 8, 21, 11], [9, 17, 10, 19],
  [30, 18, 40, 20],               // Courtyard -> Sahur Hill
  [37, 33, 44, 35], [42, 22, 44, 35]]; // Kitchen -> Sahur Hill (alley)
const DOORS = [
  { id: 'd1', cells: [19, 25, 21, 26], cost: 750, areas: ['A', 'B'] },
  { id: 'd2', cells: [26, 30, 27, 32], cost: 1000, areas: ['A', 'C'] },
  { id: 'd3', cells: [27, 24, 29, 25], cost: 1000, areas: ['B', 'C'] },
  { id: 'd4', cells: [19, 9, 21, 10], cost: 1250, areas: ['B', 'D'] },
  { id: 'd5', cells: [9, 17, 10, 19], cost: 1000, areas: ['B', 'E'] },
  { id: 'd6', cells: [39, 18, 40, 20], cost: 1250, areas: ['B', 'F'] },
  { id: 'd7', cells: [37, 33, 38, 35], cost: 1000, areas: ['C', 'F'] },
];
// Smooth hills (cosine bumps): [x, z, radius, height] in meters
const HILLS = [[104, 15, 7.5, 2.6], [88, 39, 6, 1.8]];
// Walk-in huts with thin walls. rect = world meters on cell lines; `skip` = sides that already
// are map walls; doors/windows = [side, cell index along that side].
const HUTS = [
  { rect: [80, 8, 88, 16], skip: ['n', 'w'], doors: [['e', 6]], windows: [['s', 41]], h: 3.2, lantern: [84, 2.6, 12] },
  { rect: [48, 36, 56, 44], skip: [], doors: [['w', 19], ['e', 20]], windows: [['n', 25], ['s', 26]], h: 3.2, lantern: [52, 2.6, 40] },
];
// Watchtower ("pos ronda") with a hanging kentongan: stairs on the west, ladder on the east.
const TOWER = {
  x0: 96, z0: 30, x1: 102, z1: 36, top: 4.0,
  stairs: { x0: 90, x1: 96, z0: 32, z1: 34, steps: 10 },
  ladder: { x0: 102, x1: 103, z0: 32.4, z1: 33.6, y0: -0.2, y1: 4.6, top: 4.0, out: [1, 0] },
};
// boarded windows: wall cell, outward direction, and the spawn pocket carved outside
const WINDOWS = [
  { cell: [14, 30], dir: [-1, 0], pocket: [11, 29, 14, 32], area: 'A' },
  { cell: [20, 35], dir: [0, 1], pocket: [19, 36, 22, 39], area: 'A' },
  { cell: [16, 26], dir: [0, -1], pocket: [15, 25, 18, 26], area: 'A' },
  { cell: [11, 10], dir: [0, -1], pocket: [10, 7, 13, 10], area: 'B' },
  { cell: [30, 15], dir: [1, 0], pocket: [31, 14, 34, 17], area: 'B' },
  { cell: [28, 10], dir: [0, -1], pocket: [27, 7, 30, 10], area: 'B' },
  { cell: [37, 30], dir: [1, 0], pocket: [38, 29, 39, 32], area: 'C' },
  { cell: [32, 37], dir: [0, 1], pocket: [31, 38, 34, 39], area: 'C' },
  { cell: [34, 24], dir: [0, -1], pocket: [33, 21, 36, 24], area: 'C' },
  { cell: [13, 4], dir: [-1, 0], pocket: [10, 3, 13, 6], area: 'D' },
  { cell: [26, 4], dir: [1, 0], pocket: [27, 3, 30, 6], area: 'D' },
  { cell: [3, 20], dir: [-1, 0], pocket: [1, 19, 3, 22], area: 'E' },
  { cell: [6, 27], dir: [0, 1], pocket: [5, 28, 8, 31], area: 'E' },
  { cell: [6, 12], dir: [0, -1], pocket: [5, 9, 8, 12], area: 'E' },
  { cell: [47, 3], dir: [0, -1], pocket: [46, 1, 49, 3], area: 'F' },
  { cell: [56, 12], dir: [1, 0], pocket: [57, 11, 59, 14], area: 'F' },
  { cell: [50, 22], dir: [0, 1], pocket: [49, 23, 52, 26], area: 'F' },
];
// world-space obstacles [x0, y0, z0, x1, y1, z1]
const OBSTACLES = [
  [36, 0, 30, 44, 0.9, 38],          // fountain basin
  [39, 0, 33, 41, 3.2, 35],          // fountain pillar
  [27.2, 0, 25.2, 28.8, 1.2, 26.8],  // courtyard crates
  [51, 0, 29, 53, 1.2, 31],
  [10, 0, 40, 12, 0.8, 44],          // garden planter
  [62, 0, 62, 66, 0.9, 64],          // kitchen table
  [60, 0, 50.2, 66, 1.0, 51.4],      // kitchen counter
  [46, 0, 12, 48, 1.2, 14],          // tower crate
];
export const WALLBUYS = [
  { weapon: 'smg', cost: 1000, pos: [34, 1.5, 70], n: [0, 0, -1], area: 'A' },
  { weapon: 'shotgun', cost: 1500, pos: [20, 1.5, 28], n: [1, 0, 0], area: 'B' },
  { weapon: 'ak', cost: 1800, pos: [74, 1.5, 68], n: [-1, 0, 0], area: 'C' },
  { weapon: 'm4', cost: 1800, pos: [32, 1.5, 16], n: [0, 0, -1], area: 'D' },
  { weapon: 'sniper', cost: 2000, pos: [18, 1.5, 46], n: [-1, 0, 0], area: 'E' },
  { weapon: 'lmg', cost: 3000, pos: [112, 1.5, 38], n: [-1, 0, 0], area: 'F' },
];
export const PERKS = [
  { id: 'quick', name: 'Quick Revive', short: 'QR', cost: 500, color: 0x3aa8ff, pos: [49.5, 0, 57], face: [-1, 0, 0], area: 'A' },
  { id: 'speed', name: 'Speed Cola', short: 'SC', cost: 3000, color: 0x3ad16b, pos: [58, 0, 73.5], face: [0, 0, -1], area: 'C' },
  { id: 'dtap', name: 'Double Tap', short: 'DT', cost: 2000, color: 0xf2c230, pos: [17.5, 0, 29], face: [-1, 0, 0], area: 'E' },
  { id: 'jugg', name: 'Juggernog', short: 'JN', cost: 2500, color: 0xe03a2a, pos: [28.5, 0, 13], face: [1, 0, 0], area: 'D' },
];
export const PAP = { pos: [44, 0, 4.7], cost: 5000, area: 'D' };
export const BOX = { pos: [24, 0, 45.5], cost: 950, area: 'B' };
const GROUND_SPAWNS = [
  { pos: [26, 0, 29], area: 'B' }, { pos: [44, 0, 26], area: 'B' }, { pos: [30, 0, 41], area: 'B' },
  { pos: [34, 0, 8], area: 'D' }, { pos: [48, 0, 8], area: 'D' },
  { pos: [13, 0, 34], area: 'E' }, { pos: [66, 0, 70], area: 'C' }, { pos: [58, 0, 56], area: 'C' },
  { pos: [108, 0, 40], area: 'F' }, { pos: [93, 0, 24], area: 'F' }, { pos: [84, 0, 22], area: 'F' }, { pos: [104, 0, 15], area: 'F' },
];
export const PLAYER_START = new THREE.Vector3(40, 0, 62);
const LIGHTS = [
  { pos: [40, 3.6, 62], color: 0xffb36b, intensity: 110, dist: 28 },
  { pos: [30, 3.4, 34], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [52, 3.4, 25], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [64, 3.6, 62], color: 0xffb36b, intensity: 110, dist: 28 },
  { pos: [36, 3.6, 10], color: 0xffb36b, intensity: 100, dist: 26 },
  { pos: [44, 1.8, 6.6], color: 0xb050ff, intensity: 30, dist: 9 },
  { pos: [13, 3.4, 39], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [92, 3.4, 22], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [99, 6.1, 33], color: 0xffb36b, intensity: 80, dist: 22 },          // tower lantern
];

// ---------- small canvas helpers for signs ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function chalkGun(name, cost) {
  return canvasTex(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(245,245,235,0.92)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.5)'; ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(30, 40); ctx.lineTo(160, 40); ctx.lineTo(160, 34); ctx.lineTo(228, 34); ctx.lineTo(228, 46);
    ctx.lineTo(160, 46); ctx.lineTo(150, 56); ctx.lineTo(118, 56); ctx.lineTo(110, 86); ctx.lineTo(96, 86);
    ctx.lineTo(100, 56); ctx.lineTo(70, 56); ctx.lineTo(58, 74); ctx.lineTo(24, 74); ctx.lineTo(30, 40);
    ctx.stroke();
    ctx.font = '700 22px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(245,245,235,0.95)';
    ctx.fillText(`${name} — ${cost}`, w / 2, 116);
  });
}
function signTex(lines, bg, fg = '#fff', w = 256, h = 96) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = `700 ${i === 0 ? 34 : 24}px Rajdhani, sans-serif`;
      ctx.fillText(l, w / 2, h / (lines.length + 1) * (i + 1) + (i === 0 ? 2 : 0));
    });
  });
}

class Heap {
  constructor() { this.ids = []; this.f = []; }
  get size() { return this.ids.length; }
  push(id, f) {
    const a = this.ids, fs = this.f; a.push(id); fs.push(f);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (fs[p] <= fs[i]) break; [a[p], a[i]] = [a[i], a[p]]; [fs[p], fs[i]] = [fs[i], fs[p]]; i = p; }
  }
  pop() {
    const a = this.ids, fs = this.f, top = a[0], li = a.pop(), lf = fs.pop();
    if (a.length) {
      a[0] = li; fs[0] = lf; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && fs[l] < fs[m]) m = l;
        if (r < a.length && fs[r] < fs[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [fs[m], fs[i]] = [fs[i], fs[m]]; i = m;
      }
    }
    return top;
  }
}

const box = new THREE.BoxGeometry(1, 1, 1);
function mesh(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class ZMap {
  constructor(scene, tex) {
    this.scene = scene;
    this.grid = new Uint8Array(GW * GH).fill(1);
    this.navBlock = new Uint8Array(GW * GH);
    const carve = (r, block) => {
      for (let z = r[1]; z < r[3]; z++) for (let x = r[0]; x < r[2]; x++) {
        this.grid[z * GW + x] = 0;
        if (block) this.navBlock[z * GW + x] = 1;
      }
    };
    for (const a of Object.values(AREAS)) carve(a.rect, false);
    for (const r of CORRIDORS) carve(r, false);
    for (const w of WINDOWS) { carve(w.pocket, true); carve([w.cell[0], w.cell[1], w.cell[0] + 1, w.cell[1] + 1], true); }

    this.obstacles = OBSTACLES.map(([x0, y0, z0, x1, y1, z1]) => ({ x0, y0, z0, x1, y1, z1 }));
    for (const p of PERKS) this.obstacles.push(this.machineBox(p.pos, p.face, 1.1, 0.9, 2.1));
    this.obstacles.push(this.machineBox(PAP.pos, [0, 0, 1], 1.6, 1.2, 1.9));
    this.obstacles.push({ x0: BOX.pos[0] - 0.9, y0: 0, z0: BOX.pos[2] - 0.4, x1: BOX.pos[0] + 0.9, y1: 0.9, z1: BOX.pos[2] + 0.4 });
    for (const l of LIGHTS) if (l.post) this.obstacles.push({ x0: l.pos[0] - 0.15, y0: 0, z0: l.pos[2] - 0.15, x1: l.pos[0] + 0.15, y1: 3.3, z1: l.pos[2] + 0.15 });

    // walls: layered heights (street walls share a height per block, taller buildings behind)
    const isSolid = (x, z) => this.solid(x, z);
    const dist = solidDistance(isSolid, GW, GH);
    const rects = mergeBands(isSolid, (x, z) => Math.min(3, dist[z * GW + x]), GW, GH, 10);
    const bandH = [0, 5, 6.5, 8];
    const tints = [[0.95, 0.93, 0.88], [0.88, 0.86, 0.82], [0.93, 0.89, 0.82], [0.9, 0.87, 0.85]];
    this.cellH = new Float32Array(GW * GH);
    this.staticColliders = [];
    for (const rc of rects) {
      const cx = rc.x + rc.w / 2, cz = rc.z + rc.d / 2;
      rc.y = bandH[rc.band] + Math.floor(blockHash(cx, cz, 5) * 3) * 0.5;
      rc.tint = tints[Math.floor(blockHash(cx + 50, cz, 7) * tints.length)];
      for (let z = rc.z; z < rc.z + rc.d; z++) for (let x = rc.x; x < rc.x + rc.w; x++) this.cellH[z * GW + x] = rc.y;
      this.staticColliders.push({ x0: rc.x * C, z0: rc.z * C, x1: (rc.x + rc.w) * C, z1: (rc.z + rc.d) * C, y0: 0, y1: rc.y });
    }
    for (const o of this.obstacles) this.staticColliders.push(o);
    // roofs over the indoor areas
    this.roofs = [];
    for (const a of Object.values(AREAS)) {
      if (!a.indoor) continue;
      const [x0, z0, x1, z1] = a.rect;
      const roof = { x0: (x0 - 1) * C, z0: (z0 - 1) * C, x1: (x1 + 1) * C, z1: (z1 + 1) * C, y0: 4.3, y1: 4.6 };
      this.roofs.push(roof); this.staticColliders.push(roof);
    }

    // elevation + walk-in buildings
    this.hills = HILLS;
    this.hillTop = Math.max(...HILLS.map((h) => h[3]));
    this.edgeX = new Uint8Array(GW * GH);   // wall between cell (x,z) and (x+1,z)
    this.edgeZ = new Uint8Array(GW * GH);   // wall between cell (x,z) and (x,z+1)
    this.navHOverride = new Map();          // cells whose walkable surface isn't the ground (tower, stairs)
    this.ladders = [];
    this.struct = { walls: [], wood: [], stone: [], roofs: [], tiles: [], shadow: [] };
    for (const h of HUTS) this.buildHut(h);
    this.buildTower(TOWER);

    this.buildWindows(tex);
    this.buildDoors();
    this.colliders = [...this.staticColliders, ...this.windowFrames, ...this.doors.map((d) => d.collider)];
    this.playerColliders = [...this.colliders, ...this.windows.map((w) => w.blocker)];
    this.buildMeshes(tex, rects);
    this.buildStructureMeshes(tex);
    this.buildHillMeshes(tex);
    this.buildProps();
    this.buildNav();
    this.dist = new Float32Array(GW * GH).fill(Infinity);
    this.groundSpawns = GROUND_SPAWNS.map((s) => ({ pos: new THREE.Vector3(s.pos[0], this.groundAt(s.pos[0], s.pos[2]), s.pos[2]), area: s.area }));
  }

  // ---------- terrain ----------
  groundAt(x, z) {
    let h = 0;
    for (const [hx, hz, r, height] of this.hills) {
      const dx = x - hx, dz = z - hz;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      const d = Math.hypot(dx, dz) / r;
      if (d < 1) h += height * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    return h;
  }

  // Ray vs the hills (bullets). Returns distance or null.
  rayGround(o, d, maxT) {
    const stepLen = 0.35;
    let prevT = 0;
    for (let t = stepLen; t <= maxT + stepLen; t += stepLen) {
      const tt = Math.min(t, maxT);
      const y = o.y + d.y * tt;
      if (y > this.hillTop + 0.1 && d.y >= 0) return null;
      if (y < this.groundAt(o.x + d.x * tt, o.z + d.z * tt)) {
        let lo = prevT, hi = tt;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (o.y + d.y * mid < this.groundAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid; else lo = mid;
        }
        return hi > 0.05 ? hi : null;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return null;
  }

  ladderAt(p) {
    for (const l of this.ladders) {
      if (p.x >= l.x0 && p.x <= l.x1 && p.z >= l.z0 && p.z <= l.z1 && p.y >= l.y0 && p.y <= l.y1) return l;
    }
    return null;
  }

  // ---------- walk-in huts ----------
  buildHut(h) {
    const [x0, z0, x1, z1] = h.rect, T = 0.3, H = h.h;
    const S = this.struct;
    const add = (list, b, shadow) => { list.push(b); this.staticColliders.push(b); if (shadow) S.shadow.push(b); };
    const isDoor = (side, i) => h.doors.some(([s, c]) => s === side && c === i);
    const isWin = (side, i) => h.windows.some(([s, c]) => s === side && c === i);
    for (const side of ['n', 's', 'w', 'e']) {
      if (h.skip.includes(side)) continue;
      const horiz = side === 'n' || side === 's';
      const line = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      for (let i = a0 / C; i < a1 / C; i++) {
        const s0 = i * C - (i * C === a0 ? T / 2 : 0), s1 = (i + 1) * C + ((i + 1) * C === a1 ? T / 2 : 0);
        const box = (y0, y1) => (horiz
          ? { x0: s0, y0, z0: line - T / 2, x1: s1, y1, z1: line + T / 2 }
          : { x0: line - T / 2, y0, z0: s0, x1: line + T / 2, y1, z1: s1 });
        if (isDoor(side, i)) add(S.walls, box(2.4, H), false);
        else if (isWin(side, i)) { add(S.walls, box(0, 1.0), true); add(S.walls, box(2.1, H), false); }
        else add(S.walls, box(0, H), true);
        // block zombie pathing through this wall (doorways stay open)
        if (!isDoor(side, i)) {
          const l = line / C;
          if (horiz) this.edgeZ[(l - 1) * GW + i] = 1;
          else this.edgeX[i * GW + (l - 1)] = 1;
        }
      }
    }
    add(S.roofs, { x0: x0 - 0.35, y0: H, z0: z0 - 0.35, x1: x1 + 0.35, y1: H + 0.28, z1: z1 + 0.35 }, false);
    S.tiles.push({ x0, y0: 0, z0, x1, y1: 0.02, z1 });
    if (h.lantern) S.lanterns = [...(S.lanterns || []), h.lantern];
  }

  // ---------- watchtower with stairs and a ladder ----------
  buildTower(t) {
    const S = this.struct;
    const add = (list, b, shadow) => { list.push(b); this.staticColliders.push(b); if (shadow) S.shadow.push(b); };
    const { x0, z0, x1, z1, top } = t;
    add(S.stone, { x0, y0: 0, z0, x1, y1: top - 0.15, z1 }, true);
    add(S.wood, { x0, y0: top - 0.15, z0, x1, y1: top, z1 }, false); // flush deck: nothing to bump your head on from the ladder
    // railings with gaps for the stairs (west) and the ladder (east)
    const R = 0.12, RH = 1.0;
    const rail = (ax0, az0, ax1, az1) => add(S.wood, { x0: ax0, y0: top, z0: az0, x1: ax1, y1: top + RH, z1: az1 }, false);
    rail(x0, z0, x1, z0 + R); rail(x0, z1 - R, x1, z1);
    rail(x0, z0, x0 + R, t.stairs.z0); rail(x0, t.stairs.z1, x0 + R, z1);
    rail(x1 - R, z0, x1, t.ladder.z0 - 0.1); rail(x1 - R, t.ladder.z1 + 0.1, x1, z1);
    // corner posts + roof
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      add(S.wood, { x0: px - 0.14, y0: top, z0: pz - 0.14, x1: px + 0.14, y1: top + 2.6, z1: pz + 0.14 }, false);
    }
    add(S.roofs, { x0: x0 - 0.6, y0: top + 2.6, z0: z0 - 0.6, x1: x1 + 0.6, y1: top + 2.9, z1: z1 + 0.6 }, false);
    S.kentongan = [(x0 + x1) / 2, top + 1.7, (z0 + z1) / 2];
    // stairs: solid steps rising toward the tower
    const st = t.stairs, tread = (st.x1 - st.x0) / st.steps, rise = top / st.steps;
    for (let i = 0; i < st.steps; i++) add(S.stone, { x0: st.x0 + i * tread, y0: 0, z0: st.z0, x1: st.x1, y1: (i + 1) * rise, z1: st.z1 }, i === 0);
    // pathing: tower cells sit at the top height; stair cells step up 1 m each; no stepping off the stair sides
    for (let cz = z0 / C; cz < z1 / C; cz++) for (let cx = x0 / C; cx < x1 / C; cx++) this.navHOverride.set(cz * GW + cx, top);
    const scz = st.z0 / C, n = (st.x1 - st.x0) / C;
    for (let k = 0; k < n; k++) {
      const cx = st.x0 / C + k;
      this.navHOverride.set(scz * GW + cx, top * (k + 1) / (n + 1));
      this.edgeZ[(scz - 1) * GW + cx] = 1; this.edgeZ[scz * GW + cx] = 1;
    }
    this.ladders.push({ ...t.ladder });
  }

  machineBox(pos, face, width, depth, height) {
    const alongX = face[2] !== 0; // machine faces along z, so its width runs along x
    const hw = (alongX ? width : depth) / 2, hd = (alongX ? depth : width) / 2;
    return { x0: pos[0] - hw, y0: 0, z0: pos[2] - hd, x1: pos[0] + hw, y1: height, z1: pos[2] + hd };
  }

  solid(x, z) { return x < 0 || z < 0 || x >= GW || z >= GH || this.grid[z * GW + x] === 1; }

  // ---------- windows ----------
  buildWindows() {
    this.windows = []; this.windowFrames = [];
    const frameMat = lambert(0x4a3220), boardMat = lambert(0xa47a4c);
    this.boardMat = boardMat;
    for (const def of WINDOWS) {
      const [cx, cz] = def.cell, [dx, dz] = def.dir;
      const x0 = cx * C, z0 = cz * C, x1 = x0 + C, z1 = z0 + C;
      const center = new THREE.Vector3(x0 + C / 2, 0, z0 + C / 2);
      // lintel reaches the height of the wall on either side of the window
      const sideH = dx !== 0
        ? Math.max(this.cellH[(cz - 1) * GW + cx] || 5, this.cellH[(cz + 1) * GW + cx] || 5)
        : Math.max(this.cellH[cz * GW + cx - 1] || 5, this.cellH[cz * GW + cx + 1] || 5);
      const sill = { x0, z0, x1, z1, y0: 0, y1: 0.9 };
      const lintel = { x0, z0, x1, z1, y0: 2.3, y1: sideH };
      this.windowFrames.push(sill, lintel);
      const blocker = { x0, z0, x1, z1, y0: 0, y1: sideH };
      const w = {
        def, area: def.area, center, dir: new THREE.Vector3(dx, 0, dz),
        inside: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), -1.7),
        outside: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 1.25),
        spawn: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 2.1),
        boards: 6, max: 6, boardMeshes: [], blocker, sill, lintel, sideH,
      };
      // boards nailed across the inside face of the opening
      const g = new THREE.Group();
      const faceOff = -C / 2 + 0.06; // toward the inside
      for (let i = 0; i < 6; i++) {
        const y = 1.0 + i * 0.24;
        const m = new THREE.Mesh(box, boardMat);
        m.castShadow = true;
        if (dx !== 0) { m.scale.set(0.06, 0.17, 2.15); m.position.set(center.x + dx * faceOff, y, center.z); m.rotation.x = (Math.random() - 0.5) * 0.4; }
        else { m.scale.set(2.15, 0.17, 0.06); m.position.set(center.x, y, center.z + dz * faceOff); m.rotation.z = (Math.random() - 0.5) * 0.4; }
        m.userData.home = { p: m.position.clone(), r: m.rotation.clone() };
        g.add(m); w.boardMeshes.push(m);
      }
      // dark wood frame on the inside
      const fo = -C / 2 + 0.02;
      if (dx !== 0) {
        mesh(box, frameMat, center.x + dx * fo, 1.6, z0 + 0.06, 0.14, 1.5, 0.12, g);
        mesh(box, frameMat, center.x + dx * fo, 1.6, z1 - 0.06, 0.14, 1.5, 0.12, g);
      } else {
        mesh(box, frameMat, x0 + 0.06, 1.6, center.z + dz * fo, 0.12, 1.5, 0.14, g);
        mesh(box, frameMat, x1 - 0.06, 1.6, center.z + dz * fo, 0.12, 1.5, 0.14, g);
      }
      this.scene.add(g);
      w.group = g;
      this.windows.push(w);
    }
  }

  setBoards(w, n) {
    w.boards = Math.max(0, Math.min(w.max, n));
    w.boardMeshes.forEach((m, i) => {
      m.visible = i < w.boards;
      if (m.visible) { m.position.copy(m.userData.home.p); m.rotation.copy(m.userData.home.r); }
    });
  }

  // ---------- doors ----------
  buildDoors() {
    this.doors = [];
    const plank = lambert(0x6b4a2c), brace = lambert(0x3f2a18);
    for (const def of DOORS) {
      const [x0, z0, x1, z1] = def.cells;
      const wx0 = x0 * C, wz0 = z0 * C, wx1 = x1 * C, wz1 = z1 * C;
      const center = new THREE.Vector3((wx0 + wx1) / 2, 0, (wz0 + wz1) / 2);
      const spanX = (x1 - x0) >= (z1 - z0);
      const span = spanX ? wx1 - wx0 : wz1 - wz0;
      const g = new THREE.Group(); g.position.copy(center);
      const n = Math.round(span / 0.32);
      for (let i = 0; i < n; i++) {
        const off = -span / 2 + (i + 0.5) * (span / n);
        const h = 3.0 + (i % 3) * 0.12;
        if (spanX) mesh(box, plank, off, h / 2, 0, span / n - 0.03, h, 0.12, g);
        else mesh(box, plank, 0, h / 2, off, 0.12, h, span / n - 0.03, g);
      }
      for (const y of [0.8, 2.3]) {
        if (spanX) mesh(box, brace, 0, y, 0.1, span, 0.18, 0.06, g).rotation.z = 0.12;
        else mesh(box, brace, 0.1, y, 0, 0.06, 0.18, span, g).rotation.x = 0.12;
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), new THREE.MeshLambertMaterial({ map: signTex(['OPEN', String(def.cost)], '#2a1b10', '#f4e2b0') }));
      const sign2 = sign.clone();
      if (spanX) { sign.position.set(0, 1.6, 0.14); sign2.position.set(0, 1.6, -0.14); sign2.rotation.y = Math.PI; }
      else { sign.position.set(0.14, 1.6, 0); sign.rotation.y = Math.PI / 2; sign2.position.set(-0.14, 1.6, 0); sign2.rotation.y = -Math.PI / 2; }
      g.add(sign, sign2);
      this.scene.add(g);
      this.doors.push({
        ...def, center, group: g, open: false, anim: 0,
        collider: { x0: wx0, z0: wz0, x1: wx1, z1: wz1, y0: 0, y1: 3.4 },
      });
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.navBlock[z * GW + x] = 1;
    }
  }

  openDoor(d) {
    if (d.open) return;
    d.open = true;
    for (const list of [this.colliders, this.playerColliders]) {
      const i = list.indexOf(d.collider); if (i >= 0) list.splice(i, 1);
    }
    const [x0, z0, x1, z1] = d.cells;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { this.navBlock[z * GW + x] = 0; this.walk[z * GW + x] = 1; }
  }

  resetDoors() {
    for (const d of this.doors) {
      if (d.open) {
        d.open = false; d.anim = 0;
        d.group.visible = true; d.group.position.y = 0;
        this.colliders.push(d.collider); this.playerColliders.push(d.collider);
        const [x0, z0, x1, z1] = d.cells;
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { this.navBlock[z * GW + x] = 1; this.walk[z * GW + x] = 0; }
      }
    }
    for (const w of this.windows) this.setBoards(w, w.max);
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (!d.open || !d.group.visible) continue;
      d.anim += dt;
      d.group.position.y = d.anim * d.anim * 6;
      d.group.rotation.y = d.anim * 0.4;
      if (d.anim > 1.2) d.group.visible = false;
    }
  }

  // ---------- meshes ----------
  buildMeshes(tex, rects) {
    const walls = new BoxBuilder(), trims = new BoxBuilder(), bases = new BoxBuilder();
    for (const rc of rects) {
      const x0 = rc.x * C, z0 = rc.z * C, x1 = (rc.x + rc.w) * C, z1 = (rc.z + rc.d) * C;
      walls.box(x0, 0, z0, x1, rc.y, z1, { uvScale: 4, tint: rc.tint, ao: true, noBottom: true });
    }
    for (const w of this.windows) {
      const s = w.sill, l = w.lintel;
      walls.box(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, { uvScale: 4, tint: [0.88, 0.85, 0.8], ao: true });
      walls.box(l.x0, l.y0, l.z0, l.x1, l.y1, l.z1, { uvScale: 4, tint: [0.88, 0.85, 0.8] });
    }
    // dark-wood cornice + baseboard along walls facing walkable ground (not inside window openings)
    const windowCells = new Set(this.windows.map((w) => w.def.cell[1] * GW + w.def.cell[0]));
    addEdgeTrims(trims, bases, {
      isSolid: (x, z) => this.solid(x, z),
      isOpen: (x, z) => !this.solid(x, z) && !windowCells.has(z * GW + x),
      cellH: this.cellH, gw: GW, gh: GH, cell: C, topTint: [0.5, 0.38, 0.28], baseTint: [0.45, 0.36, 0.3],
    });
    const wallMat = surfaceMaterial(tex, 'wall');
    for (const b of [walls, trims, bases]) {
      const m = new THREE.Mesh(b.geometry(), wallMat);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    const roofs = new BoxBuilder();
    for (const r of this.roofs) roofs.box(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1, { uvScale: 3, tint: [0.42, 0.32, 0.26] });
    const roofMesh = new THREE.Mesh(roofs.geometry(), surfaceMaterial(tex, 'crate'));
    roofMesh.castShadow = roofMesh.receiveShadow = true;
    this.scene.add(roofMesh);

    const floor = new BoxBuilder();
    floor.box(-40, -1, -40, ZW + 40, 0, ZH + 40, { uvScale: 8, noBottom: true, tint: [0.75, 0.72, 0.68] });
    const floorMesh = new THREE.Mesh(floor.geometry(), surfaceMaterial(tex, 'sand', { roughness: 0.97 }));
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    const tiles = new BoxBuilder();
    for (const a of Object.values(AREAS)) {
      if (!a.indoor) continue;
      const [x0, z0, x1, z1] = a.rect;
      tiles.box(x0 * C, 0, z0 * C, x1 * C, 0.02, z1 * C, { uvScale: 4, noBottom: true });
    }
    const tileMesh = new THREE.Mesh(tiles.geometry(), surfaceMaterial(tex, 'tile', { roughness: 0.9 }));
    tileMesh.receiveShadow = true;
    this.scene.add(tileMesh);
    buildContactShadows(this.scene, {
      isSolid: (x, z) => this.solid(x, z) || windowCells.has(z * GW + x), gw: GW, gh: GH, cell: C,
      boxes: [...this.obstacles, ...this.struct.shadow], strength: 0.5,
    });

    // obstacles: crates / tables / fountain
    const crates = new BoxBuilder(), stone = new BoxBuilder();
    OBSTACLES.forEach(([x0, y0, z0, x1, y1, z1], i) => {
      if (i < 2) stone.box(x0, y0, z0, x1, y1, z1, { uvScale: 2, tint: [0.7, 0.7, 0.72] });
      else crates.box(x0, y0, z0, x1, y1, z1, { faceUV: true, noBottom: true });
    });
    const cm = new THREE.Mesh(crates.geometry(), surfaceMaterial(tex, 'crate', { roughness: 0.9 }));
    cm.castShadow = cm.receiveShadow = true; this.scene.add(cm);
    const sm = new THREE.Mesh(stone.geometry(), wallMat);
    sm.castShadow = sm.receiveShadow = true; this.scene.add(sm);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), new THREE.MeshLambertMaterial({ color: 0x1e4a66, emissive: 0x0a2233 }));
    water.rotation.x = -Math.PI / 2; water.position.set(40, 0.915, 34); this.scene.add(water);
  }

  buildStructureMeshes(tex) {
    const S = this.struct;
    const mk = (boxes, material, opt = {}) => {
      if (!boxes.length) return;
      const b = new BoxBuilder();
      for (const x of boxes) b.box(x.x0, x.y0, x.z0, x.x1, x.y1, x.z1, opt);
      const m = new THREE.Mesh(b.geometry(), material);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    };
    mk(S.walls, surfaceMaterial(tex, 'wall'), { uvScale: 4, tint: [0.97, 0.94, 0.88], ao: true });
    mk(S.stone, surfaceMaterial(tex, 'wall'), { uvScale: 3, tint: [0.72, 0.7, 0.68], ao: true });
    const plain = (color) => (tex.quality === 'high'
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, envMapIntensity: 0.45, vertexColors: true })
      : new THREE.MeshLambertMaterial({ color, vertexColors: true }));
    mk(S.wood, plain(0x7a5434), { uvScale: 2 });
    mk(S.roofs, plain(0x4e3627), { uvScale: 2 });
    mk(S.tiles, surfaceMaterial(tex, 'tile', { roughness: 0.9 }), { uvScale: 4, noBottom: true });
    // ladder: two rails and rungs on the tower's east face
    for (const l of this.ladders) {
      const lb = new BoxBuilder(), x = l.x0 + 0.06;
      lb.box(x - 0.04, 0, l.z0 + 0.06, x + 0.04, TOWER.top + 1.1, l.z0 + 0.14, { uvScale: 1 });
      lb.box(x - 0.04, 0, l.z1 - 0.14, x + 0.04, TOWER.top + 1.1, l.z1 - 0.06, { uvScale: 1 });
      for (let y = 0.3; y < TOWER.top + 1; y += 0.34) lb.box(x - 0.03, y, l.z0 + 0.1, x + 0.03, y + 0.05, l.z1 - 0.1, { uvScale: 1 });
      const m = new THREE.Mesh(lb.geometry(), plain(0x9a6a3c));
      m.castShadow = true; this.scene.add(m);
    }
    // the kentongan drum hanging under the watchtower roof
    if (S.kentongan) {
      const [kx, ky, kz] = S.kentongan;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.3, 16), lambert(0x8a5a30));
      drum.position.set(kx, ky, kz); drum.castShadow = true; this.scene.add(drum);
      const slit = new THREE.Mesh(box, lambert(0x24140a)); slit.scale.set(0.06, 0.8, 0.02); slit.position.set(kx, ky, kz + 0.3); this.scene.add(slit);
      const rope = new THREE.Mesh(box, lambert(0x3a2a1a)); rope.scale.set(0.04, 0.6, 0.04); rope.position.set(kx, ky + 0.95, kz); this.scene.add(rope);
    }
    // hut lanterns: a small warm light so you can see zombies that follow you inside
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc77a });
    for (const [lx, ly, lz] of S.lanterns || []) {
      mesh(box, glow, lx, ly, lz, 0.22, 0.3, 0.22, this.scene).castShadow = false;
      const light = new THREE.PointLight(0xffb36b, 18, 9, 2);
      light.position.set(lx, ly - 0.2, lz);
      this.scene.add(light);
    }
  }

  buildHillMeshes(tex) {
    const mat = surfaceMaterial(tex, 'sand', { roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const [hx, hz, r] of this.hills) {
      const step = 0.5, n = Math.ceil((r * 2) / step) + 1, x0 = hx - r, z0 = hz - r;
      const pos = [], uv = [], col = [], idx = [];
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const x = x0 + ix * step, z = z0 + iz * step, h = this.groundAt(x, z);
        pos.push(x, h + 0.01, z);
        uv.push(x / 8, -z / 8);
        const k = Math.min(1, h / 2.5);                    // a little greener toward the top
        col.push(0.75 - 0.12 * k, 0.72 - 0.02 * k, 0.68 - 0.2 * k);
      }
      for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix, b = a + n, c = a + 1, d = b + 1;
        idx.push(a, b, c, c, b, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildProps() {
    // lights + lanterns + lamp posts
    const lantern = new THREE.MeshBasicMaterial({ color: 0xffc77a });
    const pole = lambert(0x2a2622);
    for (const l of LIGHTS) {
      const light = new THREE.PointLight(l.color, l.intensity, l.dist, 2);
      light.position.set(...l.pos);
      this.scene.add(light);
      if (l.color === 0xb050ff) continue;
      mesh(box, lantern, l.pos[0], l.pos[1] + 0.05, l.pos[2], 0.28, 0.36, 0.28, this.scene).castShadow = false;
      if (l.post) mesh(box, pole, l.pos[0], 1.6, l.pos[2], 0.14, 3.2, 0.14, this.scene);
    }
    // wall buys: chalk outlines on the wall
    this.wallBuys = WALLBUYS.map((wb) => {
      const def = WEAPONS[wb.weapon];
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85),
        new THREE.MeshBasicMaterial({ map: chalkGun(def.name, wb.cost), transparent: true, depthWrite: false }));
      const [nx, , nz] = wb.n;
      plane.position.set(wb.pos[0] + nx * 0.03, wb.pos[1], wb.pos[2] + nz * 0.03);
      plane.lookAt(plane.position.x + nx, plane.position.y, plane.position.z + nz);
      this.scene.add(plane);
      return { ...wb, def, at: new THREE.Vector3(wb.pos[0] + nx * 0.9, 0, wb.pos[2] + nz * 0.9) };
    });
    // perk machines
    this.perkMachines = PERKS.map((p) => {
      const g = new THREE.Group();
      g.position.set(...p.pos);
      g.rotation.y = Math.atan2(p.face[0], p.face[2]);
      const dark = new THREE.Color(p.color).multiplyScalar(0.45).getHex();
      mesh(box, lambert(dark), 0, 1.05, 0, 1.1, 2.1, 0.9, g);
      mesh(box, new THREE.MeshBasicMaterial({ color: p.color }), 0, 1.15, 0.46, 0.8, 1.1, 0.02, g).castShadow = false;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36),
        new THREE.MeshBasicMaterial({ map: signTex([p.name, String(p.cost)], '#111', '#' + p.color.toString(16).padStart(6, '0')) }));
      sign.position.set(0, 1.9, 0.461); g.add(sign);
      this.scene.add(g);
      return { ...p, at: new THREE.Vector3(p.pos[0] + p.face[0] * 1.0, 0, p.pos[2] + p.face[2] * 1.0) };
    });
    // Pack-a-Punch
    {
      const g = new THREE.Group(); g.position.set(...PAP.pos);
      mesh(box, lambert(0x2c2a38), 0, 0.6, 0, 1.6, 1.2, 1.2, g);
      mesh(box, lambert(0x4a3f6a), 0, 1.45, 0, 1.3, 0.5, 1.0, g);
      const glow = new THREE.MeshBasicMaterial({ color: 0xc070ff });
      mesh(box, glow, 0, 0.9, 0.61, 1.3, 0.12, 0.02, g).castShadow = false;
      for (const x of [-0.4, 0, 0.4]) {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 12), glow);
        roll.rotation.x = Math.PI / 2; roll.position.set(x, 1.75, 0); g.add(roll);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.4),
        new THREE.MeshBasicMaterial({ map: signTex(['PACK-A-PUNCH', String(PAP.cost)], '#16121f', '#d9a6ff') }));
      sign.position.set(0, 0.45, 0.61); g.add(sign);
      this.scene.add(g);
      this.pap = { ...PAP, at: new THREE.Vector3(PAP.pos[0], 0, PAP.pos[2] + 1.4) };
    }
    // Mystery box with a light beam
    {
      const g = new THREE.Group(); g.position.set(...BOX.pos);
      const wood = new THREE.MeshLambertMaterial({ map: signTex(['?', ''], '#5a3b20', '#ffe08a', 128, 96) });
      mesh(box, wood, 0, 0.35, 0, 1.8, 0.7, 0.8, g);
      const lid = new THREE.Group(); lid.position.set(0, 0.7, -0.4); g.add(lid);
      mesh(box, lambert(0x4a2f18), 0, 0.08, 0.4, 1.84, 0.16, 0.84, lid);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x66b8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 7; g.add(beam);
      this.scene.add(g);
      // floating label that shows the cycling weapon
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const labelTex = new THREE.CanvasTexture(c); labelTex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
      label.scale.set(2.4, 0.6, 1); label.position.set(BOX.pos[0], 1.9, BOX.pos[2]); label.visible = false;
      this.scene.add(label);
      this.box = { ...BOX, group: g, lid, beam, label, labelCanvas: c, labelTex, at: new THREE.Vector3(BOX.pos[0], 0, BOX.pos[2] + 1.3) };
    }
  }

  setBoxLabel(text, color = '#ffe9a8') {
    const b = this.box, ctx = b.labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = '700 64px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10; ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    b.labelTex.needsUpdate = true;
  }

  // ---------- navigation (flow field toward the player) ----------
  buildNav() {
    this.walk = new Uint8Array(GW * GH);
    this.navH = new Float32Array(GW * GH);   // height of the walkable surface in each cell
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      const i = z * GW + x;
      this.navH[i] = this.navHOverride.has(i) ? this.navHOverride.get(i) : this.groundAt(x * C + 1, z * C + 1);
      if (this.grid[i] === 1 || this.navBlock[i]) continue;
      const cx0 = x * C + 0.4, cx1 = x * C + 1.6, cz0 = z * C + 0.4, cz1 = z * C + 1.6;
      let blocked = false;
      for (const o of this.obstacles) {
        if (o.y0 > 0.5) continue;
        if (o.x1 + 0.4 > cx0 && o.x0 - 0.4 < cx1 && o.z1 + 0.4 > cz0 && o.z0 - 0.4 < cz1) { blocked = true; break; }
      }
      this.walk[i] = blocked ? 0 : 1;
    }
  }
  walkable(x, z) { return x >= 0 && z >= 0 && x < GW && z < GH && this.walk[z * GW + x] === 1; }
  walkablePoint(x, z) { return this.walkable(Math.floor(x / C), Math.floor(z / C)); }
  heightAtCell(x, z) { return this.navH[z * GW + x]; }
  nearestWalkable(cx, cz) {
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r < 6; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.walkable(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
      if (best) return best;
    }
    return null;
  }

  // Can a zombie walk from cell a to its 4-neighbour b? (no wall between, small height change)
  passOrth(ax, az, bx, bz) {
    if (!this.walkable(bx, bz)) return false;
    if (az === bz) { if (this.edgeX[az * GW + Math.min(ax, bx)]) return false; }
    else if (this.edgeZ[Math.min(az, bz) * GW + ax]) return false;
    return Math.abs(this.navH[az * GW + ax] - this.navH[bz * GW + bx]) <= 1.5;
  }
  // Any of the 8 neighbours; diagonals need both L-shaped routes to be open.
  canStep(x, z, dx, dz) {
    if (!dx || !dz) return this.passOrth(x, z, x + dx, z + dz);
    return this.passOrth(x, z, x + dx, z) && this.passOrth(x + dx, z, x + dx, z + dz)
      && this.passOrth(x, z, x, z + dz) && this.passOrth(x, z + dz, x + dx, z + dz);
  }

  computeFlow(target) {
    const s = this.nearestWalkable(Math.floor(target.x / C), Math.floor(target.z / C));
    if (!s) return;
    const dist = this.dist; dist.fill(Infinity);
    const start = s[1] * GW + s[0];
    dist[start] = 0;
    const heap = new Heap(); heap.push(start, 0);
    while (heap.size) {
      const cur = heap.pop();
      const cd = dist[cur], cx = cur % GW, cz = (cur / GW) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        // the field spreads outward from the player, so check the step a zombie would take (back toward cur)
        if (!this.walkable(cx + dx, cz + dz) || !this.canStep(cx + dx, cz + dz, -dx, -dz)) continue;
        const n = (cz + dz) * GW + cx + dx, nd = cd + (dx && dz ? 1.414 : 1);
        if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
      }
    }
  }

  // Next point to walk to from `pos` following the flow field (or null if lost).
  flowTarget(pos, out) {
    const cx = Math.floor(pos.x / C), cz = Math.floor(pos.z / C);
    if (!this.walkable(cx, cz)) {
      const n = this.nearestWalkable(cx, cz);
      if (!n) return null;
      return out.set(n[0] * C + 1, 0, n[1] * C + 1);
    }
    const step = (x, z) => {
      let best = null, bd = this.dist[z * GW + x];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (!this.canStep(x, z, dx, dz)) continue;
        const d = this.dist[(z + dz) * GW + x + dx];
        if (d < bd) { bd = d; best = [x + dx, z + dz]; }
      }
      return best;
    };
    const a = step(cx, cz);
    if (!a) return null;
    out.set(a[0] * C + 1, 0, a[1] * C + 1);
    const b = step(a[0], a[1]);
    if (b) {
      const bx = b[0] * C + 1, bz = b[1] * C + 1;
      if (this.clearLine(pos, { x: bx, z: bz }, 0.35)) out.set(bx, 0, bz);
    }
    return out;
  }

  // Straight walkable line from a to b: no blocked cells, no walls crossed, no big height jumps.
  clearLine(a, b, rad = 0.4) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const px = -dz / len * rad, pz = dx / len * rad;
    const steps = Math.ceil(len / 0.4);
    let pcx = Math.floor(a.x / C), pcz = Math.floor(a.z / C);
    for (let i = 0; i <= steps; i++) {
      const x = a.x + dx * i / steps, z = a.z + dz * i / steps;
      if (!this.walkablePoint(x, z) || !this.walkablePoint(x + px, z + pz) || !this.walkablePoint(x - px, z - pz)) return false;
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      if (cx !== pcx || cz !== pcz) {
        if (Math.abs(cx - pcx) > 1 || Math.abs(cz - pcz) > 1) return false;
        if (!this.canStep(pcx, pcz, cx - pcx, cz - pcz)) return false;
        if (Math.abs(this.navH[cz * GW + cx] - this.navH[pcz * GW + pcx]) > 1.0) return false;
        pcx = cx; pcz = cz;
      }
    }
    return true;
  }
}
