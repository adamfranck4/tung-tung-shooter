// Axis-aligned box collision and ray casting. The whole map is made of boxes.
export const GRAVITY = 20;
const EPS = 1e-4;
const STEP = 0.55;

function overlap(p, hw, h, c) {
  return p.x + hw > c.x0 && p.x - hw < c.x1 &&
         p.z + hw > c.z0 && p.z - hw < c.z1 &&
         p.y + h > c.y0 && p.y < c.y1;
}

export function overlapsAny(b, cols) {
  for (const c of cols) if (overlap(b.pos, b.halfW, b.height, c)) return true;
  return false;
}

function resolveHorizontal(b, cols, axis, wasGround) {
  const p = b.pos, hw = b.halfW;
  for (const c of cols) {
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
  }
}

// b: { pos, vel, halfW, height, onGround }   pos = feet position
export function moveBody(b, dt, cols) {
  const p = b.pos;
  const wasGround = b.onGround;

  p.x += b.vel.x * dt;
  resolveHorizontal(b, cols, 0, wasGround);
  p.z += b.vel.z * dt;
  resolveHorizontal(b, cols, 2, wasGround);

  b.vel.y -= GRAVITY * dt;
  const prevY = p.y;
  p.y += b.vel.y * dt;
  b.onGround = false;
  if (p.y <= 0) { p.y = 0; if (b.vel.y < 0) b.vel.y = 0; b.onGround = true; }
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
