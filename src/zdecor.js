// Decoration for Sahur Village (Zombies): the fountain on its ramped mound, dead trees, fallen logs,
// Night Market stalls, bunting with paper lanterns, and painted shutters / boarded-up doors on the
// walls. Looks only: the colliders live in zmap.js. Each kind of prop is merged into one mesh.
import * as THREE from 'three';
import { BoxBuilder } from './map.js';
import { surfaceMaterial, rng } from './textures.js';
import { matte } from './gfx.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _d = new THREE.Vector3(),
  _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const rgb = (hex) => new THREE.Color(hex).toArray();
const pick = (list, r) => list[Math.floor(r() * list.length) % list.length];

// Collects many small pieces into one mesh: each piece gets one color, or one per geometry group
// (e.g. a cylinder's side and its two end caps).
class Merger {
  constructor() { this.pos = []; this.nrm = []; this.col = []; }
  add(geo, matrix, color) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array, cols = Array.isArray(color) ? color : [color];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: p.length / 3, materialIndex: 0 }];
    for (const gr of groups) {
      _c.set(cols[gr.materialIndex] ?? cols[0]);
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        this.nrm.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        this.col.push(_c.r, _c.g, _c.b);
      }
    }
    g.dispose();
  }
  mesh(material, shadow = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}

// a tapered round limb from a to b (radius ra at a, rb at b)
function limb(mg, a, b, ra, rb, color, sides = 6) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(rb, ra, len, sides, 1, true);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  mg.add(geo, _m, color);
  geo.dispose();
}

// ---------------------------------------------------------------- the fountain mound
// A stone-paved mound with a ramp all the way round (so it can't be camped), a ring of water
// round the pillar, and a bowl on top of the pillar.
export function buildMound(scene, tex, map, [mx, mz, rTop, rFoot, height]) {
  const step = 0.2, rings = Math.ceil((rFoot + 0.3) / step), seg = 56;
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = Math.min(rFoot + 0.3, i * step);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, x = mx + Math.cos(a) * r, z = mz + Math.sin(a) * r;
      pos.push(x, map.groundAt(x, z) + 0.012, z);
      uv.push(x / 3, z / 3);
      const k = r <= rTop ? 1 : 0.88;   // the ramp a shade darker than the top
      col.push(0.8 * k, 0.77 * k, 0.74 * k);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);   // counter-clockwise seen from above (faces up)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, surfaceMaterial(tex, 'tile', { roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const stone = new Merger(), top = height;
  // low rim round the top, the pillar and the bowl on it
  const rim = new THREE.TorusGeometry(rTop - 0.12, 0.1, 6, 56);
  stone.add(rim, _m.compose(_p.set(mx, top + 0.03, mz), _q.setFromEuler(_e.set(Math.PI / 2, 0, 0)), _s.set(1, 1, 1)), 0xcfc9be);
  const pillar = new THREE.CylinderGeometry(0.78, 0.9, 3.2 - top, 18);
  stone.add(pillar, _m.compose(_p.set(mx, top + (3.2 - top) / 2, mz), _q.identity(), _s.set(1, 1, 1)), 0xe2dccf);
  const collar = new THREE.CylinderGeometry(0.98, 0.98, 0.18, 18);
  stone.add(collar, _m.compose(_p.set(mx, top + 0.09, mz), _q.identity(), _s.set(1, 1, 1)), 0xbdb6aa);
  const bowl = new THREE.CylinderGeometry(1.15, 0.55, 0.4, 20);
  stone.add(bowl, _m.compose(_p.set(mx, 3.4, mz), _q.identity(), _s.set(1, 1, 1)), 0xe8e2d6);
  scene.add(stone.mesh(matte({ vertexColors: true })));
  for (const geo of [rim, pillar, collar, bowl]) geo.dispose();
  // the water: the "blue circle" round the pillar, and a little in the bowl
  const waterMat = matte({ color: 0x2a6a8c, emissive: 0x0c2a3c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { roughness: 0.12 });
  const pool = new THREE.Mesh(new THREE.RingGeometry(1.0, rTop - 0.22, 56), waterMat);
  pool.rotation.x = -Math.PI / 2; pool.position.set(mx, top + 0.02, mz);
  const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(1.05, 20), waterMat);
  bowlWater.rotation.x = -Math.PI / 2; bowlWater.position.set(mx, 3.56, mz);
  scene.add(pool, bowlWater);
}

// ---------------------------------------------------------------- dead trees
const BARK = [0x5e5048, 0x6a5a4c, 0x544840];
const LEAVES = [0x8a5a24, 0xa4692c, 0x6e6a2e, 0x7a4a22, 0x9a3a1e];
// trees: [x, groundY, z, size]. Bare, crooked trunks with forked branches and a few dry leaves.
export function buildTrees(scene, trees) {
  if (!trees.length) return;
  const mg = new Merger(), leafGeo = new THREE.IcosahedronGeometry(1, 0);
  for (const [x, y, z, s] of trees) {
    const r = rng(Math.floor(x * 73 + z * 191) + 5), bark = pick(BARK, r);
    // trunk: three bent segments, thinner toward the top
    const pts = [new THREE.Vector3(x, y - 0.2, z)];
    const lx = (r() - 0.5) * 0.5, lz = (r() - 0.5) * 0.5;
    let px = x, pz = z;
    for (let i = 1; i <= 3; i++) {
      px += lx * 0.5 + (r() - 0.5) * 0.3; pz += lz * 0.5 + (r() - 0.5) * 0.3;
      pts.push(new THREE.Vector3(px, y + i * 1.25 * s, pz));
    }
    const rad = (i) => (0.34 - i * 0.085) * s;
    for (let i = 0; i < 3; i++) limb(mg, pts[i], pts[i + 1], rad(i), rad(i + 1), bark, 7);
    // roots spreading over the ground
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + r();
      limb(mg, new THREE.Vector3(x, y + 0.35 * s, z), new THREE.Vector3(x + Math.cos(a) * 0.75 * s, y - 0.05, z + Math.sin(a) * 0.75 * s), 0.15 * s, 0.05 * s, bark, 5);
    }
    // branches reaching up and out, some forking, a few still holding dry leaves
    const nb = 4 + Math.floor(r() * 3);
    for (let k = 0; k < nb; k++) {
      const t = 0.35 + r() * 0.6, seg = Math.min(2, Math.floor(t * 3));
      const start = pts[seg].clone().lerp(pts[seg + 1], t * 3 - seg);
      const ang = (k / nb) * Math.PI * 2 + r() * 0.8;
      const dir = new THREE.Vector3(Math.cos(ang), 0.35 + r() * 0.9, Math.sin(ang)).normalize();
      const len = (1.0 + r() * 1.3) * s * (1.1 - t * 0.4);
      const end = start.clone().addScaledVector(dir, len);
      limb(mg, start, end, (0.13 - t * 0.05) * s, 0.03 * s, bark);
      for (let j = 0; j < 2; j++) {
        if (r() < 0.35) continue;
        const fork = start.clone().lerp(end, 0.45 + r() * 0.4), a2 = ang + (r() - 0.5) * 1.8;
        const d2 = new THREE.Vector3(Math.cos(a2), 0.4 + r() * 0.8, Math.sin(a2)).normalize();
        limb(mg, fork, fork.clone().addScaledVector(d2, len * (0.35 + r() * 0.3)), 0.045 * s, 0.015 * s, bark, 5);
      }
      if (r() < 0.5) {   // a small cluster of dry leaves near the tip
        for (let j = 0, n = 4 + Math.floor(r() * 5); j < n; j++) {
          _p.set(end.x + (r() - 0.5) * 0.6, end.y + (r() - 0.5) * 0.4, end.z + (r() - 0.5) * 0.6);
          _m.compose(_p, _q.setFromEuler(_e.set(r() * 3, r() * 3, 0)), _s.set(0.09 + r() * 0.06, 0.03, 0.06 + r() * 0.04).multiplyScalar(s));
          mg.add(leafGeo, _m, pick(LEAVES, r));
        }
      }
    }
  }
  leafGeo.dispose();
  scene.add(mg.mesh(matte({ vertexColors: true, flatShading: true })));
}

// ---------------------------------------------------------------- logs
const LOG_BARK = [0x5a4232, 0x4e3a2c, 0x624834], LOG_RING = 0xc19a64;
// logs: [x, groundY, z, length, radius, axis]; piles: [x0, z0, x1, z1] stacks of logs lying along z
export function buildLogs(scene, logs, piles = []) {
  const mg = new Merger();
  const put = (x, y, z, len, rad, axis, r, stub = true) => {
    const geo = new THREE.CylinderGeometry(rad, rad * 0.94, len, 11, 1);   // groups: bark, end, end
    _e.set(axis === 'z' ? Math.PI / 2 : 0, (r() - 0.5) * 0.16, axis === 'x' ? Math.PI / 2 : 0);
    mg.add(geo, _m.compose(_p.set(x, y + rad, z), _q.setFromEuler(_e), _s.set(1, 1, 1)), [pick(LOG_BARK, r), LOG_RING, LOG_RING]);
    geo.dispose();
    if (stub && r() < 0.8) {   // a broken-off branch
      const t = (r() - 0.5) * len * 0.7, a = new THREE.Vector3(x + (axis === 'x' ? t : 0), y + rad * 1.5, z + (axis === 'z' ? t : 0));
      const side = r() < 0.5 ? -1 : 1;
      const b = a.clone().add(new THREE.Vector3(axis === 'z' ? side * 0.5 : 0, 0.45, axis === 'x' ? side * 0.5 : 0));
      limb(mg, a, b, rad * 0.32, rad * 0.12, LOG_BARK[0], 5);
    }
  };
  for (const [x, y, z, len, rad, axis] of logs) put(x, y, z, len, rad, axis, rng(Math.floor(x * 31 + z * 17)));
  for (const [x0, z0, x1, z1] of piles) {
    const r = rng(Math.floor(x0 * 13 + z0)), n = 4, rad = (x1 - x0) / (2 * n), len = z1 - z0 - 0.15, zc = (z0 + z1) / 2;
    for (let i = 0; i < n; i++) put(x0 + rad + 2 * rad * i, 0, zc + (r() - 0.5) * 0.15, len, rad, 'z', r, false);
    for (let i = 0; i < n - 1; i++) put(x0 + 2 * rad + 2 * rad * i, rad * 0.73, zc + (r() - 0.5) * 0.15, len, rad, 'z', r, false);
  }
  scene.add(mg.mesh(matte({ vertexColors: true })));
}

// ---------------------------------------------------------------- Night Market stalls
const FRUIT = [0xe8452a, 0xf2a32a, 0x9ad24a, 0xf2d24a, 0x8a2a6a];
// stalls: { counter: [x0, z0, x1, z1], back: z of the wall behind, colors: canopy stripes }
export function buildStalls(scene, stalls) {
  const b = new BoxBuilder(), goods = new Merger(), fruitGeo = new THREE.IcosahedronGeometry(1, 1);
  const wood = [0.52, 0.36, 0.22], dark = [0.32, 0.22, 0.14], H = 4.0;
  for (const s of stalls) {
    const [x0, z0, x1, z1] = s.counter, toBack = s.back > z1 ? 1 : -1;
    const front = toBack > 0 ? z0 - 0.3 : z1 + 0.3, zm = (z0 + z1) / 2;
    const r = rng(Math.floor(x0 * 7 + z0));
    // counter with a lighter top, then the posts (front ones stand in the counter)
    b.box(x0, 0, z0, x1, 0.88, z1, { uvScale: 1, tint: wood, ao: true });
    b.box(x0 - 0.06, 0.88, z0 - 0.06, x1 + 0.06, 0.95, z1 + 0.06, { uvScale: 1, tint: [0.66, 0.5, 0.32] });
    for (const px of [x0 + 0.05, x1 - 0.15]) {
      b.box(px, 0.95, zm - 0.05, px + 0.1, H, zm + 0.05, { uvScale: 1, tint: dark });
      b.box(px, 0, s.back - 0.1 * toBack - 0.05, px + 0.1, H, s.back - 0.1 * toBack + 0.05, { uvScale: 1, tint: dark });
    }
    // striped canopy from the front edge back to the wall, with a scalloped valance at the front
    const za = Math.min(front, s.back), zb = Math.max(front, s.back), w = 0.5;
    for (let i = 0, x = x0 - 0.4; x < x1 + 0.4 - 1e-3; i++, x += w) {
      const tint = rgb(s.colors[i % 2]), xe = Math.min(x + w, x1 + 0.4);
      b.box(x, H, za, xe, H + 0.06, zb, { uvScale: 1, tint });
      b.box(x, H - (i % 2 ? 0.28 : 0.4), front - 0.03, xe, H, front + 0.03, { uvScale: 1, tint });
    }
    // goods on the counter: little crates of fruit
    for (let cx = x0 + 0.35; cx < x1 - 0.3; cx += 0.7) {
      b.box(cx - 0.25, 0.95, zm - 0.2, cx + 0.25, 1.15, zm + 0.2, { uvScale: 1, tint: [0.6, 0.45, 0.28] });
      const fc = pick(FRUIT, r);
      for (let k = 0; k < 4; k++) {
        _m.compose(_p.set(cx + (k % 2 - 0.5) * 0.22, 1.2, zm + (k < 2 ? -0.09 : 0.09)), _q.identity(), _s.setScalar(0.085 + r() * 0.02));
        goods.add(fruitGeo, _m, fc);
      }
    }
  }
  const m = new THREE.Mesh(b.geometry(), matte({ vertexColors: true }));
  m.castShadow = m.receiveShadow = true;
  scene.add(m, goods.mesh(matte({ vertexColors: true, flatShading: true }), false));
  fruitGeo.dispose();
}

// ---------------------------------------------------------------- bunting
const FLAG_COLORS = [0xd8343a, 0xf2c230, 0x3aa45a, 0x2f6fd0, 0xf2f0ea, 0xf07a2a, 0xe85a9a];
const LANTERN_COLORS = [0xff5a3a, 0xffb040, 0xff7a2a, 0xffe08a];
// strings: [x0, y0, z0, x1, y1, z1, lanterns]. Little triangle flags on a sagging rope, and glowing
// paper lanterns on some strings.
export function buildBunting(scene, strings) {
  const flags = new Merger(), rope = new Merger(), glow = new Merger();
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, -0.3, 0], 3));
  flagGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const lanternGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8);
  for (const [x0, y0, z0, x1, y1, z1, lanterns] of strings) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), len = a.distanceTo(b);
    const sag = Math.min(0.9, len * 0.028);
    const at = (t) => a.clone().lerp(b, t).setY(y0 + (y1 - y0) * t - sag * 4 * t * (1 - t));
    const n = Math.max(2, Math.round(len / 0.55)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    _q.setFromAxisAngle(_up, Math.atan2(-dz, dx));   // flag's width along the string
    const yaw = _q.clone();
    for (let i = 0; i < n; i++) {
      limb(rope, at(i / n), at((i + 1) / n), 0.012, 0.012, 0x2a2420, 4);
      const p = at((i + 0.5) / n);
      flags.add(flagGeo, _m.compose(p, yaw, _s.set(1, 1, 1)), FLAG_COLORS[i % FLAG_COLORS.length]);
      if (lanterns && i % 6 === 3) {
        glow.add(lanternGeo, _m.compose(_p.set(p.x, p.y - 0.42, p.z), _q.identity(), _s.set(1, 1, 1)), LANTERN_COLORS[(i / 6 | 0) % LANTERN_COLORS.length]);
        limb(rope, p, new THREE.Vector3(p.x, p.y - 0.27, p.z), 0.008, 0.008, 0x2a2420, 3);
      }
    }
  }
  scene.add(flags.mesh(matte({ vertexColors: true, side: THREE.DoubleSide }), false));
  scene.add(rope.mesh(matte({ vertexColors: true }), false));
  if (glow.pos.length) scene.add(glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), false));
  flagGeo.dispose(); lanternGeo.dispose();
}

// ---------------------------------------------------------------- shutters and doors on the walls
const SHUTTERS = [0x2f8f8a, 0xb0402c, 0x3a6ab0, 0x4a8a3a, 0xd0a030, 0x7a4ab0, 0x2a7a5a];
const DOORS = [0x8a3a2a, 0x2f6a8a, 0x4a7a3a, 0x9a6a2a, 0x6a3a7a];
// faces: { x, z (center of the wall face), nx, nz (out of the wall), h (wall height), seed 0..1, indoor }.
// About half get something: a window with open painted shutters (some lit warm from inside), or
// (outdoors) a boarded-up door.
export function buildWallDecor(scene, faces) {
  const solid = new BoxBuilder(), lit = new BoxBuilder();
  const frame = [0.24, 0.17, 0.11];
  for (const f of faces) {
    if (f.seed < 0.48) continue;
    const r = rng(Math.floor(f.seed * 1e6));
    // a box in the face's frame: u along the wall, n out of it (0 = on the wall surface)
    const put = (bb, u0, u1, y0, y1, n0, n1, tint) => {
      const alongX = f.nz !== 0;
      const ax = alongX ? [f.x + u0, f.x + u1] : [f.x + f.nx * n0, f.x + f.nx * n1];
      const az = alongX ? [f.z + f.nz * n0, f.z + f.nz * n1] : [f.z + u0, f.z + u1];
      bb.box(Math.min(...ax), y0, Math.min(...az), Math.max(...ax), y1, Math.max(...az), { uvScale: 1, tint });
    };
    if (f.seed < 0.9 || f.indoor) {
      // window: dark (or lit) pane, frame, cross bars, open shutters and a sill
      const y0 = 2.0, y1 = 3.2, shut = rgb(pick(SHUTTERS, r)), glowing = !f.indoor && r() < 0.4;
      if (glowing) put(lit, -0.55, 0.55, y0, y1, 0, 0.02, [1, 0.74, 0.4]);
      else put(solid, -0.55, 0.55, y0, y1, 0, 0.02, [0.07, 0.09, 0.12]);
      put(solid, -0.65, -0.55, y0 - 0.08, y1 + 0.08, 0, 0.08, frame); put(solid, 0.55, 0.65, y0 - 0.08, y1 + 0.08, 0, 0.08, frame);
      put(solid, -0.65, 0.65, y1, y1 + 0.1, 0, 0.08, frame);
      put(solid, -0.03, 0.03, y0, y1, 0, 0.05, frame); put(solid, -0.55, 0.55, (y0 + y1) / 2 - 0.03, (y0 + y1) / 2 + 0.03, 0, 0.05, frame);
      put(solid, -1.2, -0.67, y0, y1, 0, 0.05, shut); put(solid, 0.67, 1.2, y0, y1, 0, 0.05, shut);
      put(solid, -0.78, 0.78, y0 - 0.12, y0, 0, 0.16, [0.6, 0.58, 0.55]);
      if (!f.indoor && r() < 0.35) {   // a flower box under it
        put(solid, -0.6, 0.6, y0 - 0.42, y0 - 0.12, 0, 0.26, [0.5, 0.32, 0.22]);
        put(solid, -0.55, 0.55, y0 - 0.12, y0 + 0.02, 0.03, 0.24, rgb(pick([0xd8343a, 0xe85a9a, 0xf2c230, 0xf2f0ea], r)));
      }
    } else {
      // boarded-up door
      put(solid, -0.6, 0.6, 0, 2.3, 0, 0.05, rgb(pick(DOORS, r)));
      put(solid, -0.72, -0.6, 0, 2.42, 0, 0.09, frame); put(solid, 0.6, 0.72, 0, 2.42, 0, 0.09, frame);
      put(solid, -0.72, 0.72, 2.3, 2.42, 0, 0.09, frame);
      put(solid, -0.8, 0.8, 0.75, 0.95, 0.05, 0.1, [0.56, 0.42, 0.28]); put(solid, -0.8, 0.8, 1.5, 1.7, 0.05, 0.1, [0.5, 0.37, 0.24]);
    }
  }
  const m = new THREE.Mesh(solid.geometry(), matte({ vertexColors: true }));
  m.receiveShadow = true;
  scene.add(m);
  if (lit.p.length) scene.add(new THREE.Mesh(lit.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })));
}
