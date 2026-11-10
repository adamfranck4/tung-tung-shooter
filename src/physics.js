// Axis-aligned box collision and ray casting. The whole map is made of boxes.
export const GRAVITY = 800 * 0.0254; // CS2 sv_gravity 800 u/s²
const EPS = 1e-4;
const STEP = 18 * 0.0254;            // CS2 step height: 18 units

function overlap(p, hw, h, c) {
  return p.x + hw > c.x0 && p.x - hw < c.x1 &&
         p.z + hw > c.z0 && p.z - hw < c.z1 &&
         p.y + h > c.y0 && p.y < c.y1;
}

export function overlapsAny(b, cols) {
  for (const c of cols) if (overlap(b.pos, b.halfW, b.height, c)) return true;
  return false;
}

// ---------- nearby boxes ----------
// A map has hundreds of boxes and a body only ever touches the few around it, so each list of boxes
// gets a grid (4 m cells, built the first time it's used) that hands moveBody just the boxes near
// the body, in their original order (the order decides how overlaps are resolved, so the result is
// the same as checking them all). Lists are told apart by identity; one that changes (a door
// opening, the statue moving) must be reported with collidersChanged().
const GRID = 4, PAD = 2, WIDE = 400, SMALL = 48;
const INDEX = new WeakMap();
export function collidersChanged(cols) { INDEX.delete(cols); }

function buildIndex(cols) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of cols) {
    if (c.x0 > -1e4 && c.x0 < x0) x0 = c.x0;
    if (c.z0 > -1e4 && c.z0 < z0) z0 = c.z0;
    if (c.x1 < 1e4 && c.x1 > x1) x1 = c.x1;
    if (c.z1 < 1e4 && c.z1 > z1) z1 = c.z1;
  }
  if (!(x1 > x0) || !(z1 > z0)) { x0 = z0 = 0; x1 = z1 = GRID; }
  const w = Math.max(1, Math.min(512, Math.ceil((x1 - x0) / GRID)));
  const h = Math.max(1, Math.min(512, Math.ceil((z1 - z0) / GRID)));
  const ix = { n: cols.length, x0, z0, w, h, cells: new Array(w * h), wide: [],
    stamp: new Uint32Array(cols.length), tick: 0, found: new Int32Array(64), out: [] };
  cols.forEach((c, i) => {
    const a = cellRange(ix, c.x0, c.x1, c.z0, c.z1);
    if ((a[1] - a[0] + 1) * (a[3] - a[2] + 1) > WIDE) { ix.wide.push(i); return; }   // (a wall around the whole map)
    for (let cz = a[2]; cz <= a[3]; cz++) for (let cx = a[0]; cx <= a[1]; cx++) (ix.cells[cz * w + cx] ||= []).push(i);
  });
  return ix;
}
const _range = [0, 0, 0, 0];
function cellRange(ix, x0, x1, z0, z1) {
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  _range[0] = cl(Math.floor((x0 - ix.x0) / GRID) || 0, ix.w - 1); _range[1] = cl(Math.floor((x1 - ix.x0) / GRID) || 0, ix.w - 1);
  _range[2] = cl(Math.floor((z0 - ix.z0) / GRID) || 0, ix.h - 1); _range[3] = cl(Math.floor((z1 - ix.z0) / GRID) || 0, ix.h - 1);
  return _range;
}
// the boxes within PAD of a body at (x, z), in list order (the returned array is reused: don't keep it)
function nearby(cols, x, z, hw) {
  if (cols.length < SMALL) return cols;
  let ix = INDEX.get(cols);
  if (!ix || ix.n !== cols.length) INDEX.set(cols, ix = buildIndex(cols));
  const r = hw + PAD, a = cellRange(ix, x - r, x + r, z - r, z + r);
  const tick = ++ix.tick, stamp = ix.stamp;
  let found = ix.found, n = 0;
  const add = (i) => {
    if (stamp[i] === tick) return;
    stamp[i] = tick;
    if (n === found.length) { const f = new Int32Array(n * 2); f.set(found); found = ix.found = f; }
    let k = n++;                                   // (kept sorted as it fills: the lists are short)
    while (k > 0 && found[k - 1] > i) { found[k] = found[k - 1]; k--; }
    found[k] = i;
  };
  for (const i of ix.wide) add(i);
  for (let cz = a[2]; cz <= a[3]; cz++) for (let cx = a[0]; cx <= a[1]; cx++) {
    const cell = ix.cells[cz * ix.w + cx];
    if (cell) for (const i of cell) add(i);
  }
  const out = ix.out;
  out.length = n;
  for (let k = 0; k < n; k++) out[k] = cols[found[k]];
  return out;
}

// Push the body out of the boxes it overlaps along one axis, from box `from` of the list on. Stops and
// returns the index of the box that left it more than `far` from `start` (-1: went through them all).
function resolveFrom(b, cols, from, axis, wasGround, start, far) {
  const p = b.pos, hw = b.halfW;
  for (let k = from; k < cols.length; k++) {
    const c = cols[k];
    if (!overlap(p, hw, b.height, c)) continue;
    // small ledges: step up instead of stopping
    if (wasGround && c.y1 > p.y && c.y1 - p.y <= STEP) {
      const oy = p.y;
      p.y = c.y1;
      if (!overlapsAny(b, cols)) continue;
      p.y = oy;
    }
    if (axis === 0) {
      p.x = p.x < (c.x0 + c.x1) / 2 ? c.x0 - hw - EPS : c.x1 + hw + EPS;
      b.vel.x = 0;
    } else {
      p.z = p.z < (c.z0 + c.z1) / 2 ? c.z0 - hw - EPS : c.z1 + hw + EPS;
      b.vel.z = 0;
    }
    if (Math.abs((axis === 0 ? p.x : p.z) - start) > far) return k;
  }
  return -1;
}
// cols: the boxes near the body (or all of them). Returns the list to go on with: if the body gets
// thrown clear of the nearby ones (it was inside something big), the rest of the move checks them all.
function resolveHorizontal(b, cols, all, axis, wasGround, start) {
  if (cols === all) { resolveFrom(b, all, 0, axis, wasGround, start, Infinity); return all; }
  const k = resolveFrom(b, cols, 0, axis, wasGround, start, PAD - 0.5);
  if (k < 0) return cols;
  resolveFrom(b, all, INDEX.get(all).found[k] + 1, axis, wasGround, start, Infinity);
  return all;
}

// b: { pos, vel, halfW, height, onGround }   pos = feet position
// groundAt(x, z): optional terrain height (hills); flat ground at y = 0 otherwise.
// noGravity: used while climbing a ladder.
export function moveBody(b, dt, all, groundAt = null, noGravity = false) {
  const p = b.pos;
  const wasGround = b.onGround;
  const sx = p.x, sz = p.z;
  let cols = nearby(all, sx, sz, b.halfW);

  p.x += b.vel.x * dt;
  cols = resolveHorizontal(b, cols, all, 0, wasGround, sx);
  p.z += b.vel.z * dt;
  cols = resolveHorizontal(b, cols, all, 2, wasGround, sz);

  if (!noGravity) b.vel.y -= GRAVITY * dt;
  const prevY = p.y;
  p.y += b.vel.y * dt;
  b.onGround = false;
  const gy = groundAt ? groundAt(p.x, p.z) : 0;
  if (p.y <= gy) { p.y = gy; if (b.vel.y < 0) b.vel.y = 0; b.onGround = true; }
  // walking down a slope: stay glued to the ground instead of bouncing off it
  else if (wasGround && !noGravity && b.vel.y <= 0 && p.y - gy < 0.3 && gy > 0.001) { p.y = gy; b.vel.y = 0; b.onGround = true; }
  for (const c of cols) {
    if (!overlap(p, b.halfW, b.height, c)) continue;
    if (prevY >= c.y1 - 0.06 || (b.vel.y <= 0 && c.y1 - p.y < 0.3)) {
      p.y = c.y1; if (b.vel.y < 0) b.vel.y = 0; b.onGround = true;
    } else if (b.vel.y > 0) {
      p.y = c.y0 - b.height - EPS; b.vel.y = 0;
    }
  }
}

// Ray vs all boxes + ground plane. Returns {t, nx, ny, nz} or null.
export function raycast(o, d, maxT, cols, out = {}) {
  let best = maxT, ax = -1, sign = 0;
  if (d.y < 0) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) { best = t; ax = 1; sign = 1; }
  }
  const ix = 1 / (d.x || 1e-9), iy = 1 / (d.y || 1e-9), iz = 1 / (d.z || 1e-9);
  for (const c of cols) {
    let t0 = (c.x0 - o.x) * ix, t1 = (c.x1 - o.x) * ix;
    let tmin, tmax, a = 0, s;
    if (t0 > t1) { tmin = t1; tmax = t0; s = 1; } else { tmin = t0; tmax = t1; s = -1; }
    t0 = (c.y0 - o.y) * iy; t1 = (c.y1 - o.y) * iy;
    let lo, hi, sy;
    if (t0 > t1) { lo = t1; hi = t0; sy = 1; } else { lo = t0; hi = t1; sy = -1; }
    if (lo > tmin) { tmin = lo; a = 1; s = sy; }
    if (hi < tmax) tmax = hi;
    if (tmin > tmax) continue;
    t0 = (c.z0 - o.z) * iz; t1 = (c.z1 - o.z) * iz;
    if (t0 > t1) { lo = t1; hi = t0; sy = 1; } else { lo = t0; hi = t1; sy = -1; }
    if (lo > tmin) { tmin = lo; a = 2; s = sy; }
    if (hi < tmax) tmax = hi;
    if (tmin > tmax || tmin < 0 || tmin >= best) continue;
    best = tmin; ax = a; sign = s;
  }
  if (ax < 0) return null;
  out.t = best;
  out.nx = ax === 0 ? sign : 0;
  out.ny = ax === 1 ? sign : 0;
  out.nz = ax === 2 ? sign : 0;
  return out;
}

export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : null;
}

export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  const ix = 1 / (d.x || 1e-9), iy = 1 / (d.y || 1e-9), iz = 1 / (d.z || 1e-9);
  let t0 = (x0 - o.x) * ix, t1 = (x1 - o.x) * ix;
  let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
  t0 = (y0 - o.y) * iy; t1 = (y1 - o.y) * iy;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  t0 = (z0 - o.z) * iz; t1 = (z1 - o.z) * iz;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  if (tmax < tmin || tmax < 0) return null;
  return tmin >= 0 ? tmin : null;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
