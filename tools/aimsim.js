// Simulated aim for training the aim classifier (src/aimml.js): people and aimbots following a
// strafing enemy, sent to the host the way a real player's browser sends its view (30 times a
// second, from whatever frame rate they run at), and timed the way the host times them.
//
// simulate(R, kind, opts) returns windows of samples [{t, yaw, pitch, ty, tp}] (see aimml.js).
// kind: 'human' or one of CHEATS.

export const CHEATS = ['lock', 'smooth', 'humanized', 'assist', 'constspeed', 'lead'];

// small seeded random number generator, so a training run can be repeated
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const U = (R, a, b) => a + (b - a) * R();
const N = (R) => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
const DEG = Math.PI / 180;
const DT = 1 / 480;                     // simulation step
const RUN = 6.35, ACC = 35, G = 20.3;   // m/s, m/s² (CS2's accelerate 5.5 at 250 u/s), gravity

// The enemy, as the player sees them: angles (rad) from the player's eyes, per step.
// Both of them strafe (ADAD, runs, stops); the enemy sometimes jumps or walks closer.
function makeTarget(R, steps) {
  const ty = new Float64Array(steps), tp = new Float64Array(steps);
  let D = U(R, 4, 40);
  const V = R() < 0.12 ? U(R, 0, 1) : U(R, 1.5, RUN), Vp = R() < 0.5 ? 0 : U(R, 0, RUN);
  const vr = R() < 0.3 ? U(R, -3, 3) : 0;
  const boneY = (R() < 0.6 ? -0.02 : -0.45) + (R() < 0.3 ? U(R, -1.5, 1.5) : 0);
  const yaw0 = U(R, -3, 3);
  let x = 0, vx = 0, want = 0, sw = 0, xp = 0, vpx = 0, wantP = 0, swP = 0, h = 0, vh = 0;
  const jumpAt = R() < 0.15 ? U(R, 0, steps * DT) : -1;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    if (t >= sw) { const r = R(); want = r < 0.15 ? 0 : (r < 0.575 ? -V : V); sw = t + U(R, 0.12, 1.1); }
    if (t >= swP) { const r = R(); wantP = r < 0.3 ? 0 : (r < 0.65 ? -Vp : Vp); swP = t + U(R, 0.15, 1.2); }
    vx += Math.max(-ACC * DT, Math.min(ACC * DT, want - vx));
    vpx += Math.max(-ACC * DT, Math.min(ACC * DT, wantP - vpx));
    x += vx * DT; xp += vpx * DT;
    D = Math.max(3, Math.min(50, D + vr * DT));
    if (jumpAt >= 0 && t >= jumpAt && t < jumpAt + DT) vh = 7.7;
    if (vh || h > 0) { h += vh * DT; vh -= G * DT; if (h <= 0) { h = 0; vh = 0; } }
    ty[i] = yaw0 - Math.atan2(x - xp, D);
    tp[i] = Math.atan2(boneY + h, D);
  }
  return { ty, tp };
}

// value of a per-step series at time t (clamped to the ends)
function at(arr, t) {
  const f = Math.max(0, Math.min(arr.length - 1.001, t / DT)), i = f | 0, k = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * k;
}

// A person: they see the enemy a reaction time late, follow its speed (partly), and every
// 70-200 ms plan a quick movement toward where they think it will be. Those movements follow
// Fitts' law (bigger ones take longer), have a bell-shaped speed, and miss by a share of their
// size, so big flicks over- or undershoot and get corrected. On top: hand tremor, a slow drift
// in where they aim, and noise that grows with speed.
function makeHuman(R, opt = {}) {
  const k = R();   // skill
  const P = {
    tau: U(R, 0.13, 0.26) - 0.05 * k, Kv: U(R, 0.5, 0.95) + 0.12 * k, tauV: U(R, 0.04, 0.14),
    dec: U(R, 0.07, 0.2), fA: U(R, 0.03, 0.08), fB: U(R, 0.07, 0.13) - 0.02 * k,
    amp: U(R, 0.05, 0.15) * (1.2 - 0.5 * k), perp: U(R, 0.02, 0.07), cg: U(R, 0.55, 1),
    vn: U(R, 0.04, 0.2), tremA: U(R, 0.005, 0.07), tremF: U(R, 6, 12), driftSd: U(R, 0.05, 0.6),
    driftTau: U(R, 0.2, 1), bx: N(R) * U(R, 0, 0.4), by: N(R) * U(R, 0, 0.8), lead: R(), wait: R() < 0.2 ? U(R, 0.15, 0.7) : 0,
    weber: U(R, 0.08, 0.3),
  };
  const st = { wx: 0, wy: 0, subs: [], next: 0, dx: 0, dy: 0, nx: 0, ny: 0, ph: R() * 6.28, ph2: R() * 6.28, ux: 0, uy: 0 };
  // step(t, view, tgt): view = current aim [x, y] (deg), tgt(t) = the enemy's [x, y] (deg) as seen
  // at time t. Returns the aim's velocity (deg/s) for this step; tremor() is added to what's sent.
  return {
    P,
    step(t, view, tgt) {
      if (t < (opt.start || 0) + P.wait) return [0, 0];
      const a = tgt(t - P.tau), b = tgt(t - P.tau - 0.05);
      let ux = (a[0] - b[0]) / 0.05, uy = (a[1] - b[1]) / 0.05;
      // drift in where they aim
      const dk = DT / P.driftTau, ds = P.driftSd * Math.sqrt(2 * dk);
      st.dx += -st.dx * dk + ds * N(R); st.dy += -st.dy * dk + ds * N(R);
      if (t >= st.next) {
        // a new look at the target: how fast it's going (roughly), and where it will be
        st.ux = ux * (1 + N(R) * P.weber); st.uy = uy * (1 + N(R) * P.weber);
        const lead = P.lead * P.tau;
        const gx = a[0] + st.ux * lead + P.bx + st.dx, gy = a[1] + st.uy * lead + P.by + st.dy;
        // where the movements already under way will take the aim
        let rx = view[0], ry = view[1];
        for (const s of st.subs) { const f = 1 - mj(Math.min(1, (t - s.t0) / s.dur)); rx += s.ax * f; ry += s.ay * f; }
        const ex = gx - rx, ey = gy - ry, e = Math.hypot(ex, ey);
        if (e > 0.25) {
          const g = e > 3 ? 1 : P.cg, n = 1 + N(R) * P.amp, pp = N(R) * P.perp;
          const ax = (ex * n - ey * pp) * g, ay = (ey * n + ex * pp) * g;
          const dur = Math.max(0.06, P.fA + P.fB * Math.log2(1 + e / 1));
          st.subs.push({ t0: t, dur, ax, ay });
        }
        st.next = t + P.dec * U(R, 0.7, 1.3);
      }
      // following the target's speed
      st.wx += (P.Kv * st.ux - st.wx) * DT / P.tauV; st.wy += (P.Kv * st.uy - st.wy) * DT / P.tauV;
      let vx = st.wx, vy = st.wy;
      st.subs = st.subs.filter((s) => t - s.t0 < s.dur);
      for (const s of st.subs) { const d = mjv((t - s.t0) / s.dur) / s.dur; vx += s.ax * d; vy += s.ay * d; }
      // noise that grows with speed (colored)
      const sp = Math.hypot(vx, vy), nk = DT / 0.03;
      st.nx += -st.nx * nk + Math.sqrt(2 * nk) * N(R); st.ny += -st.ny * nk + Math.sqrt(2 * nk) * N(R);
      return [vx + st.nx * P.vn * sp, vy + st.ny * P.vn * sp];
    },
    tremor(t) {
      const a = P.tremA;
      return [a * Math.sin(2 * Math.PI * P.tremF * t + st.ph), a * 0.8 * Math.sin(2 * Math.PI * P.tremF * 1.13 * t + st.ph2)];
    },
  };
}
// minimum-jerk position (0..1) and speed at progress s (0..1)
const mj = (s) => s * s * s * (10 - 15 * s + 6 * s * s);
const mjv = (s) => (s <= 0 || s >= 1 ? 0 : 30 * s * s * (1 - s) * (1 - s));

// One simulated engagement. Returns `windows` windows of samples, the first one ending `warm` +
// 1 s in, each next one `step` s later.
export function simulate(R, kind, { windows = 1, step = 0.25, warm = 0.6 } = {}) {
  const T = warm + 1 + step * (windows - 1) + 0.05, steps = Math.ceil(T / DT) + 2;
  const tg = makeTarget(R, steps + 400);
  // the target as seen, in degrees, at time t
  const tgt = (t) => [at(tg.ty, t + 0.4) / DEG, at(tg.tp, t + 0.4) / DEG];   // (+0.4 s of history for delays)
  const fps = [60, 75, 120, 144, 165, 240][(R() * 6) | 0];
  const fdt = 1 / fps;
  // where the aim starts: on the target, or a flick away
  const t0 = tgt(0);
  const far = R() < 0.4, ang = R() * 6.28, mag = far ? U(R, 3, 30) : Math.abs(N(R)) * 1.5;
  let vx = t0[0] + Math.cos(ang) * mag, vy = t0[1] + Math.sin(ang) * mag * 0.5;
  const human = kind === 'human' || kind === 'assist' ? makeHuman(R) : null;
  // the cheat's settings
  const C = {
    delay: kind === 'humanized' ? U(R, 0.02, 0.12) : U(R, 0, 0.03),
    bx: N(R) * 0.15, by: N(R) * 0.15, noise: R() < 0.5 ? 0 : U(R, 0, kind === 'lock' ? 0.2 : 0.35),
    k: kind === 'humanized' ? U(R, 0.04, 0.3) : U(R, 0.03, 0.4), kj: kind === 'humanized' ? U(R, 0, 0.5) : 0,
    lead: kind === 'lead' ? U(R, -0.05, 0.12) : (R() < 0.3 ? U(R, 0, 0.08) : 0),
    ouSd: U(R, 0.2, 1.2), ouTau: U(R, 0.1, 0.6), over: U(R, 0, 0.15), speed: U(R, 40, 500),
    pull: U(R, 0.01, 0.12), fov: U(R, 3, 15), ox: 0, oy: 0,
  };
  if (kind === 'lead' && R() < 0.5) C.k = 1;   // a locked aimbot that leads its target
  const sends = [];
  let acc = 0, nextFrame = 0, sx = vx, sy = vy;   // sx, sy: the view as last drawn (cheats act per frame)
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    if (human) {
      const v = human.step(t, [vx, vy], tgt);
      vx += v[0] * DT; vy += v[1] * DT;
    }
    if (t + 1e-9 >= nextFrame) {
      nextFrame += fdt;
      if (kind !== 'human') {
        const a = tgt(t - C.delay), b = tgt(t - C.delay - 0.03);
        let gx = a[0] + (a[0] - b[0]) / 0.03 * C.lead + C.bx, gy = a[1] + (a[1] - b[1]) / 0.03 * C.lead + C.by;
        if (kind === 'humanized') {
          const dk = fdt / C.ouTau, ds = C.ouSd * Math.sqrt(2 * dk);
          C.ox += -C.ox * dk + ds * N(R); C.oy += -C.oy * dk + ds * N(R);
          gx += C.ox; gy += C.oy;
          const ex = gx - vx, ey = gy - vy, e = Math.hypot(ex, ey);
          if (e > 3) { gx += ex / e * C.over * e; gy += ey / e * C.over * e; }
        }
        const ex = gx - vx, ey = gy - vy, e = Math.hypot(ex, ey);
        if (kind === 'lock') { vx = gx; vy = gy; }
        else if (kind === 'constspeed') { const s = Math.min(1, C.speed * fdt / Math.max(e, 1e-6)); vx += ex * s; vy += ey * s; }
        else if (kind === 'assist') { if (e < C.fov) { vx += ex * C.pull; vy += ey * C.pull; } }
        else { const k = Math.min(1, C.k * (1 + (R() * 2 - 1) * C.kj)); vx += ex * k; vy += ey * k; }
        if (C.noise) { vx += N(R) * C.noise; vy += N(R) * C.noise; }
      }
      sx = vx; sy = vy;
      // the browser sends its state 30 times a second (see NetLink.update)
      acc += fdt;
      if (acc >= 1 / 30) {
        acc = Math.min(acc - 1 / 30, 1 / 30);
        let ox = 0, oy = 0;
        if (human) [ox, oy] = human.tremor(t);
        sends.push({ t, x: sx + ox, y: sy + oy });
      }
    }
  }
  // the host: it rounds the angles (3 decimals of a radian), times each update by when it arrives
  // (smoothed), and knows the player's delay only roughly
  const lagErr = N(R) * 0.025, jit = U(R, 0.002, 0.01);
  const out = [];
  for (let w = 0; w < windows; w++) {
    const end = warm + 1 + step * w, S = [];
    for (const s of sends) {
      if (s.t < end - 1 || s.t > end) continue;
      const ts = s.t + N(R) * jit, seen = tgt(ts + lagErr);
      const r3 = (v) => Math.round(v * 1000) / 1000;
      S.push({ t: ts, yaw: r3(s.x * DEG), pitch: r3(s.y * DEG), ty: seen[0] * DEG, tp: seen[1] * DEG });
    }
    S.sort((a, b) => a.t - b.t);
    out.push(S);
  }
  return out;
}
