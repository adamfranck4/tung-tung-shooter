// Anticheat, run by the host in online matches. Each joining player's browser reports where it
// is, its ammo, its shots and its hits. The host checks every report against what the game
// allows and ignores the impossible ones. Each failed check adds suspicion points, which are
// slowly forgiven; a player who reaches KICK_AT is kicked from the room.
//
// It can't see inside a player's browser, so it only catches what a cheat has to tell the host:
// moving too fast or through walls, flying, guns or ammo the host never gave, firing too fast,
// and hits that weren't possible (no shot, too far, through a wall, not aimed that way).
//
// It also watches where each player looks (sent 30 times a second) for what aim cheats do:
// aim that stays locked on a moving target, one-update snaps that land exactly on a target,
// shots fired the instant a target walks into a still crosshair (triggerbot), spinning faster
// than a mouse can (spinbot), shots that don't go where the player looks, and aim that follows
// someone through a wall. In 5v5 it also stops sending each player the positions of enemies
// they can't see, so a wallhack has nothing to draw.
import * as THREE from 'three';
import { raycast, wrapAngle } from './physics.js';
import { dirFrom } from './combatant.js';
import { F } from './avatar.js';

const KICK_AT = 12;                   // suspicion points
const FORGIVE = 0.2;                  // points forgiven per second
const FORGIVE_AIM = 1 / 60;           // aim cheat points forgiven per second (one a minute)
const AIM_CHEATS = new Set(['aimlock', 'snap', 'trigger', 'spin', 'pitch', 'silent', 'esp']);
const COOLDOWN = 1;                   // s: the same check adds points at most once a second
const KEEP = 2;                       // s of past positions kept for every fighter and zombie
const MAX_RUN = 10;                   // m/s sideways (running is 6.35; bunny hops go a bit faster)
const RUN_SLACK = 3;                  // m, for updates that arrive bunched up
const MAX_RISE = 8, RISE_SLACK = 2;   // m/s and m upwards (a jump starts at 7.7 m/s)
const MAX_GAP = 8;                    // m between where a player says they are and where the host has them
const HELD_LIMIT = 2.5;               // s in a row of being held back by the speed limit
const AIR_LIMIT = 3;                  // s off the ground (a jump lasts under a second)
const AIM_SLACK = 0.7;                // rad between where a player looks and what they hit (recoil, spread, lag)

// aim (angles in radians; 1 degree = 0.0175)
const DEG = Math.PI / 180;
const LOOK_KEEP = 1.5;                // s of view updates kept per player
const MAX_PITCH = 89 * DEG + 0.01;    // the game never lets you look further up or down
const SPIN_WIN = 1.5, SPIN_RATE = 25; // s, rad/s: about 4 full turns a second, kept up for 1.5 s
const LOCK_WIN = 1;                   // s of tracking looked at for a locked aim
const LOCK_RMS = 0.45 * DEG;          // locked: average error under this...
const LOCK_MAX = 1.2 * DEG;           // ...and never off by more than this, for a whole second
const SWEEP = 12 * DEG;               // the target crossed at least this much of their view meanwhile
const ESP_RMS = 1.5 * DEG;            // following someone behind a wall this closely
const SNAP_MIN = 25 * DEG;            // a snap: the view turns this much in one update...
const SNAP_ON = 1 * DEG;              // ...and stops this close to the middle of a head or chest...
const SNAP_SHOT = 0.25;               // ...and they fire within this many seconds
const TRIG_KEEP = 6, TRIG_AT = 4;     // triggerbot: of the last 6 reaction shots, 4 were instant...
const TRIG_N = 2;                     // ...(fired within 2 updates, ~65 ms, of the target arriving)
const VIEW_DELAY = 0.1;               // s: players draw others this far behind the host's snapshots
const LAG0 = 0.05;                    // s: round trip time until it's measured
const LAG_FIT = 0.06;                 // s either side of that delay tried (timing jitter)

// what each player is sent in 5v5
const VIS_EVERY = 0.1;                // s between line of sight checks
const VIS_HOLD = 0.5;                 // s an enemy stays sent after they were last in sight
const NEAR = 4, HEAR = 26, GUNSHOT = 80, AHEAD = 0.25;   // m, m (footsteps), m, s (peeking)

// what the kicked player is told
const REASONS = {
  teleport: 'teleporting', speed: 'moving too fast', wall: 'walking through walls', fly: 'flying',
  gun: 'using a gun the host never gave you', ammo: 'giving yourself ammo', rate: 'firing too fast',
  empty: 'firing without ammo', noshot: 'hits without shots', through: 'shooting through walls',
  range: 'hitting from too far away', aim: 'hitting what you were not aiming at', damage: 'too much damage',
  aimlock: 'aimbot (aim locked onto targets)', snap: 'aimbot (snapping onto targets)',
  trigger: 'triggerbot (firing the instant a target is under the crosshair)', spin: 'spinbot',
  pitch: 'impossible view angles', silent: 'shots that don\'t go where you look',
  esp: 'wallhack (following players through walls)',
};

const _e = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _hit = {};
const _q = { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, cx: 0, cy: 0, cz: 0 };
const _o = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

// angle between a unit direction (dx, dy, dz) and the line from (ex, ey, ez) to (px, py, pz)
function angleTo(dx, dy, dz, ex, ey, ez, px, py, pz) {
  const vx = px - ex, vy = py - ey, vz = pz - ez, len = Math.hypot(vx, vy, vz);
  if (len < 1e-6) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (dx * vx + dy * vy + dz * vz) / len)));
}
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dy * b.dy + a.dz * b.dz)));

// how many things one shot of this gun can hit (pellets, piercing, lightning, explosions)
const hitsPerShot = (d) => (d.pellets || 1) * (d.pierce ? 8 : 1) + (d.chain ? d.chain.jumps : 0) + (d.splash ? 24 : 0) + 1;

export class Anticheat {
  constructor(game) {
    this.game = game;
    this.hist = new WeakMap();   // fighter or zombie -> [{t, x, y, z, yaw, pitch}], oldest first
    this.recT = -1;
  }

  // ---------- bookkeeping ----------
  // per-player state, made on first use
  st(av) {
    if (!av.ac) {
      const p = av.body.pos;
      av.ac = {
        pts: 0, ptsT: this.game.time, apts: 0, aptsT: this.game.time, cool: {},
        pos: { x: p.x, y: p.y, z: p.z }, rep: { x: p.x, y: p.y, z: p.z }, t: this.game.time,
        run: RUN_SLACK, rise: RISE_SLACK, air: 0, held: 0,
        credit: 3, creditT: this.game.time, tokens: 0, tokT: -9, mtok: 0, mT: -9,
        // aim: view updates [{t, x, y, z (eyes), yaw, pitch, dx, dy, dz (view direction)}], oldest first
        aim: [], lag: LAG0 + VIEW_DELAY, evalT: -9, spin: [], snapT: -9, snapOn: false, lastShotT: -9, react: [],
      };
    }
    return av.ac;
  }

  // the host placed this player (round start, respawn): positions start over from here
  spawned(av) {
    const s = this.st(av), p = av.body.pos;
    Object.assign(s.pos, { x: p.x, y: p.y, z: p.z }); Object.assign(s.rep, s.pos);
    s.t = this.game.time; s.run = RUN_SLACK; s.rise = RISE_SLACK; s.air = 0; s.held = 0;
    s.aim.length = 0; s.spin.length = 0; s.snapOn = false;
  }

  // every host tick: remember where everyone was (as other players are sent it), for checking
  // hits and aim a moment later
  record(...lists) {
    const now = this.game.time;
    if (now - this.recT < 1 / 40) return;
    this.recT = now;
    for (const list of lists) for (const c of list) {
      if (!c.alive || c.active === false) continue;
      let h = this.hist.get(c);
      if (!h) this.hist.set(c, (h = []));
      const p = (c.isAvatar && c.interp?.latest) || c.body.pos;
      const bp = c.body.pos, hd = c.headPos ? c.headPos(_a) : _a.set(bp.x, bp.y + 1.63, bp.z), ch = c.chestPos(_b);
      h.push({
        t: now, x: p.x, y: p.y, z: p.z, yaw: c.yaw, pitch: c.pitch || 0,
        hx: hd.x - bp.x, hy: hd.y - bp.y, hz: hd.z - bp.z, cx: ch.x - bp.x, cy: ch.y - bp.y, cz: ch.z - bp.z,
      });
      while (h.length && h[0].t < now - KEEP) h.shift();
    }
  }

  // where a target was at time t (between two recorded moments), or null if that's too long ago
  posAt(target, t, out = _q) {
    const h = this.hist.get(target);
    if (!h || !h.length || t < h[0].t) return null;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t > t) i--;
    const b = h[i], a = i > 0 ? h[i - 1] : b;
    const k = t >= b.t || b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    for (const key of ['x', 'y', 'z', 'hx', 'hy', 'hz', 'cx', 'cy', 'cz']) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  }

  // a failed check: add points, kick at KICK_AT
  // Aim cheats show up once per gunfight, so their points are kept in a second pool that is
  // forgiven much more slowly.
  flag(av, why, pts) {
    if (!av?.isAvatar || av.kicked) return;
    const s = this.st(av), now = this.game.time, slow = AIM_CHEATS.has(why);
    s.pts = Math.max(0, s.pts - (now - s.ptsT) * FORGIVE); s.ptsT = now;
    s.apts = Math.max(0, s.apts - (now - s.aptsT) * FORGIVE_AIM); s.aptsT = now;
    if (now - (s.cool[why] ?? -9) < COOLDOWN) return;
    s.cool[why] = now;
    if (slow) s.apts += pts; else s.pts += pts;
    const total = slow ? s.apts : s.pts;
    console.warn(`[anticheat] ${av.name}: ${REASONS[why] || why} (+${pts}, now ${total.toFixed(1)} of ${KICK_AT})`);
    if (total >= KICK_AT) this.kick(av, why);
  }

  kick(av, why) {
    av.kicked = true;
    const g = this.game;
    console.warn(`[anticheat] kicked ${av.name} (${REASONS[why] || why})`);
    g.net?.session?.kick(av.pid, `You were kicked by the anticheat (${REASONS[why] || why}).`);
  }

  // shots and knife swings first: a hit is reported just before the shot that made it
  order(evs) {
    const fire = (ev) => ev?.e === 'shot' || ev?.e === 'knife';
    return [...evs.filter(fire), ...evs.filter((ev) => !fire(ev))];
  }

  // ---------- movement ----------
  // A position from a player's browser. Returns where the host puts them: the same place, or
  // as close to it as a legal move gets.
  move(av, x, y, z) {
    const s = this.st(av), g = this.game, now = g.time, dt = Math.min(1, Math.max(0, now - s.t));
    s.t = now;
    const out = s.pos, rep = s.rep;
    // updates come 30 times a second, so even a bad connection can't jump this far between two
    if (Math.hypot(x - rep.x, z - rep.z) > 6 || y - rep.y > 4) this.flag(av, 'teleport', 4);
    rep.x = x; rep.y = y; rep.z = z;

    s.run = Math.min(RUN_SLACK, s.run + dt * MAX_RUN);
    s.rise = Math.min(RISE_SLACK, s.rise + dt * MAX_RISE);
    let dx = x - out.x, dz = z - out.z, dy = y - out.y;
    const d = Math.hypot(dx, dz);
    // held back by the speed limit for a while: more than a bad connection explains
    s.held = d > s.run + 0.01 ? s.held + dt : Math.max(0, s.held - dt);
    if (s.held > HELD_LIMIT) { this.flag(av, 'speed', 2); s.held = 0; }
    if (d > s.run) { dx *= s.run / d; dz *= s.run / d; }
    s.run -= Math.min(d, s.run);
    if (dy > s.rise) dy = s.rise;
    if (dy > 0) s.rise -= dy;

    // walls: the line at waist height from the last position to the new one must be clear
    const len = Math.hypot(dx, dy, dz);
    if (len > 0.01) {
      _e.set(out.x, out.y + 0.9, out.z);
      _d.set(dx / len, dy / len, dz / len);
      const w = raycast(_e, _d, len, this.cols(true), _hit);
      if (w && w.t < len - 0.02 && (_hit.nx || _hit.nz)) { this.flag(av, 'wall', 2); dx = dz = 0; dy = Math.min(dy, 0); }
    }
    out.x += dx; out.y += dy; out.z += dz;

    // a player who keeps getting further from where the host has them is too fast
    if (Math.hypot(x - out.x, z - out.z) > MAX_GAP) this.flag(av, 'speed', 2);

    // flying: too long off the ground, and not on a ladder
    const map = g.map;
    if (out.y - this.floorBelow(out) > 0.6 && !map.ladderAt?.(_e.set(out.x, out.y, out.z))) {
      s.air += dt;
      if (s.air > AIR_LIMIT) { this.flag(av, 'fly', 3); s.air = 0; }
    } else s.air = 0;
    return out;
  }

  // what bullets hit, or (for movement) what players bump into
  cols(players = false) { const m = this.game.map; return (players && m.playerColliders) || m.colliders; }

  // the height of what's under a spot: terrain, or the top of a box (players are about 0.3 m wide)
  floorBelow(p) {
    const m = this.game.map;
    let f = m.groundAt ? m.groundAt(p.x, p.z) : 0;
    for (const c of this.cols(false)) {
      if (c.y1 <= p.y + 0.05 && c.y1 > f && p.x > c.x0 - 0.35 && p.x < c.x1 + 0.35 && p.z > c.z0 - 0.35 && p.z < c.z1 + 0.35) f = c.y1;
    }
    return f;
  }

  // ---------- guns and ammo ----------
  // The ammo in a player's update (after their shots were counted): only for the guns the
  // host gave them, and never more than they had.
  ammo(av, arr) {
    if (!Array.isArray(arr)) return;
    [1, 2, 3].forEach((slot, i) => {
      const a = arr[i], w = av.slots[slot];
      if (!Array.isArray(a)) return;               // nothing there: the host's list stands
      if (!w) { this.flag(av, 'gun', 4); return; }
      if (w.def.melee) return;                    // knives have no ammo
      if (a[0] !== w.key || (a[1] | 0) !== (w.def.pap || 0)) { this.flag(av, 'gun', 4); return; }
      const mag = Math.max(0, Math.min(w.def.mag, a[2] | 0)), reserve = Math.max(0, a[3] | 0);
      if (mag + reserve > w.mag + w.reserve) { this.flag(av, 'ammo', 2); return; }
      w.mag = mag; w.reserve = reserve;
    });
  }

  // A reported shot (ev.d: where its bullets ended). Returns false to ignore it.
  shot(av, ev) {
    const s = this.st(av), now = this.game.time, w = av.slots[av.slot];
    if (!w || w.def.melee) return false;
    const d = w.def;
    // the bullet has to leave roughly where they were looking (spinbots and silent aim don't)
    if (!this.alongView(s, d, ev)) { this.flag(av, 'silent', 3); return false; }
    // a snap onto a target just before the shot
    if (s.snapOn && now - s.snapT < SNAP_SHOT) { s.snapOn = false; this.flag(av, 'snap', 3); }
    // the first shot after a pause: how long the target had been under the crosshair
    if (now - s.lastShotT > 0.4) this.reaction(av, s);
    s.lastShotT = now;
    // fire rate: a little faster than the gun allows, with room for updates that arrive bunched up
    const gap = Math.min(d.rate || 0.1, d.burst ? d.burstGap : 9) * (av.rateMul || 1) * 0.8;
    s.credit = Math.min(Math.max(3, 1.2 / gap), s.credit + (now - s.creditT) / gap); s.creditT = now;
    if (s.credit < 1) { this.flag(av, 'rate', 2); return false; }
    s.credit--;
    // ammo: the host counts it too (the gun reloads from its spare ammo on their side)
    if (w.mag + w.reserve <= 0) { this.flag(av, 'empty', 2); return false; }
    if (w.mag > 0) w.mag--; else w.reserve--;
    s.tokens = (now - s.tokT > 1 ? 0 : s.tokens) + hitsPerShot(d); s.tokT = now;
    return true;
  }

  // A reported knife swing. Returns false to ignore it.
  melee(av) {
    const s = this.st(av), now = this.game.time;
    if (now - s.mT < 0.25) { this.flag(av, 'rate', 2); return false; }
    s.mtok = 2; s.mT = now;
    return true;
  }

  // ---------- aim ----------
  // A view update from a player's browser (after move() checked the position). eyeY: eye height.
  look(av, yaw, rawPitch, eyeY) {
    const s = this.st(av), now = this.game.time;
    // how far in the past they see others: there and back, plus their drawing delay
    s.lag = (this.game.net?.session?.rtt?.(av.pid) ?? LAG0) + VIEW_DELAY;
    if (Math.abs(rawPitch) > MAX_PITCH) this.flag(av, 'pitch', 2);   // anti-aim sends angles no mouse can reach
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rawPitch));
    dirFrom(yaw, pitch, _f);
    const p = s.pos, cur = { t: now, x: p.x, y: p.y + eyeY, z: p.z, yaw, pitch, dx: _f.x, dy: _f.y, dz: _f.z };
    const prev = s.aim[s.aim.length - 1];
    s.aim.push(cur);
    while (s.aim.length && s.aim[0].t < now - LOOK_KEEP) s.aim.shift();
    if (!prev) return;

    // spinbot: turning faster than a mouse can keep up
    s.spin.push({ t: now, a: Math.abs(wrapAngle(yaw - prev.yaw)) });
    while (s.spin.length && s.spin[0].t < now - SPIN_WIN) s.spin.shift();
    let turned = 0;
    for (const x of s.spin) turned += x.a;
    if (turned > SPIN_RATE * SPIN_WIN) { this.flag(av, 'spin', 4); s.spin.length = 0; }

    // a snap: a big turn in one update that stops dead on a target (checked if they then fire)
    if (now - prev.t < 0.1 && angleBetween(prev, cur) > SNAP_MIN) {
      const hit = this.pick(av, cur, s.lag, LAG_FIT);
      s.snapOn = !!hit && hit.err < SNAP_ON && this.seesAt(cur, hit.target, s.lag);
      s.snapT = now;
    }

    if (now - s.evalT >= 0.1) { s.evalT = now; this.tracking(av, s); }
  }

  // what this player can shoot at: enemy fighters, or zombies
  targets(av) {
    const g = this.game;
    return g.zombies ? g.zombies.filter((z) => z.active !== false && z.alive) : g.combatants.filter((c) => c.alive && c !== av && c.team !== av.team);
  }

  // how far (rad) a view update was from a target's head or chest, as the player saw it `lag` s
  // earlier (they see everyone a little in the past); null if that's too long ago
  errAt(a, target, lag) {
    const q = this.posAt(target, a.t - lag);
    if (!q) return null;
    return Math.min(
      angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, q.x + q.hx, q.y + q.hy, q.z + q.hz),
      angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, q.x + q.cx, q.y + q.cy, q.z + q.cz));
  }

  // the target closest to a view update's crosshair: {target, err, dist}. The delay the player
  // sees others with is only roughly known, so delays within `spread` of `lag` are tried too.
  pick(av, a, lag, spread = 0) {
    let best = null;
    for (const t of this.targets(av)) {
      const bp = t.body.pos;
      // most targets are nowhere near the crosshair: skip them quickly
      if (Math.hypot(bp.x - a.x, bp.z - a.z) > 10 && angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, bp.x, bp.y + 1, bp.z) > 0.5) continue;
      for (let l = Math.max(0, lag - spread); l <= lag + spread + 1e-9; l += 0.025) {
        const err = this.errAt(a, t, l);
        if (err !== null && (!best || err < best.err)) best = { target: t, err };
      }
    }
    return best;
  }

  // could the eyes of a view update see the target's head or chest (as the player saw it)?
  seesAt(a, target, lag) {
    const q = this.posAt(target, a.t - lag);
    if (!q) return false;
    _o.set(a.x, a.y, a.z);
    return this.clear(_o, _t.set(q.x + q.hx, q.y + q.hy, q.z + q.hz)) || this.clear(_o, _t.set(q.x + q.cx, q.y + q.cy, q.z + q.cz));
  }

  // nothing solid on the line between two points
  clear(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 0.3) return true;
    _d.divideScalar(len);
    return !raycast(a, _d, len - 0.05, this.cols(false), _hit);
  }

  // Ten times a second: did the last second of aim follow a moving target too closely?
  // Following one in sight = aimbot; following one behind a wall = wallhack.
  tracking(av, s) {
    const now = this.game.time, win = s.aim.filter((a) => a.t >= now - LOCK_WIN);
    if (win.length < 20) return;
    const first = win[0], last = win[win.length - 1];
    const on = this.pick(av, last, s.lag, LAG_FIT);
    if (!on || on.err > 8 * DEG) return;
    const tg = on.target;
    // the delay that fits their aim best
    let best = null;
    for (let lag = Math.max(0, s.lag - LAG_FIT); lag <= s.lag + LAG_FIT + 1e-9; lag += 0.02) {
      let sum = 0, max = 0, ok = true;
      for (const a of win) {
        const e = this.errAt(a, tg, lag);
        if (e === null) { ok = false; break; }
        sum += e * e; if (e > max) max = e;
      }
      if (!ok) continue;
      const rms = Math.sqrt(sum / win.length);
      if (!best || rms < best.rms) best = { lag, rms, max };
    }
    if (!best) return;
    // only aim that followed a target across their view counts (not holding still on a still
    // one): add up how far the target moved across it, and how far their view turned
    let sweep = 0, turned = 0;
    for (let i = 1; i < win.length; i++) {
      const a = win[i - 1], b = win[i], qa = this.posAt(tg, a.t - best.lag, {}), qb = this.posAt(tg, b.t - best.lag, {});
      if (!qa || !qb) return;
      _a.set(qa.x - a.x, qa.y + qa.cy - a.y, qa.z - a.z).normalize();
      _b.set(qb.x - b.x, qb.y + qb.cy - b.y, qb.z - b.z).normalize();
      sweep += _a.angleTo(_b); turned += angleBetween(a, b);
    }
    if (sweep < SWEEP || turned < SWEEP * 0.8) return;
    const mid = win[win.length >> 1];
    const seen = [first, mid, last].map((a) => this.seesAt(a, tg, best.lag));
    if (seen.every(Boolean) && best.rms < LOCK_RMS && best.max < LOCK_MAX) this.flag(av, 'aimlock', 3);
    else if (!seen.some(Boolean) && best.rms < ESP_RMS) this.flag(av, 'esp', 3);
  }

  // The first shot after a pause. A person needs a fifth of a second or so to fire once a target
  // walks into a still crosshair; a triggerbot fires on the same update. One instant shot is luck,
  // most of the recent ones is a cheat.
  reaction(av, s) {
    const A = s.aim, L = A.length - 1;
    if (L < 12) return;
    const hit = this.pick(av, A[L - 1], s.lag) || this.pick(av, A[L], s.lag);
    if (!hit) return;
    const tg = hit.target, r = (tg.body?.halfW || 0.3) + 0.05;
    const on = (a) => {
      const e = this.errAt(a, tg, s.lag), q = _q;
      if (e === null) return false;
      return e < Math.atan(r / Math.max(0.5, Math.hypot(q.x - a.x, q.z - a.z))) + 0.3 * DEG && this.seesAt(a, tg, s.lag);
    };
    if (!on(A[L - 1]) && !on(A[L])) return;   // not shooting at anyone
    let n = 0, k = L - 1;
    while (k >= 0 && on(A[k])) { n++; k--; }
    if (k < 4) return;                         // the crosshair was already on them: can't tell
    // the crosshair stood still and the target came to it (a flick and a click together is normal)
    if (angleBetween(A[k - 3], A[k + 1]) > 2 * DEG) return;
    s.react.push(n <= TRIG_N ? 1 : 0);
    if (s.react.length > TRIG_KEEP) s.react.shift();
    if (s.react.filter(Boolean).length >= TRIG_AT) { s.react.length = 0; this.flag(av, 'trigger', 6); }
  }

  // Did the first bullet of a shot leave along the view the player reported, somewhere between
  // their last update and this one? Recoil, spread and movement are allowed for.
  alongView(s, d, ev) {
    const end = Array.isArray(ev?.d) && Array.isArray(ev.d[0]) ? ev.d[0] : null;
    const A = s.aim, cur = A[A.length - 1];
    if (!end || !cur || d.splash) return true;
    const prev = A.length > 1 && cur.t - A[A.length - 2].t < 0.2 ? A[A.length - 2] : cur;
    const ex = +end[0], ey = +end[1], ez = +end[2];
    if (![ex, ey, ez].every(Number.isFinite) || Math.hypot(ex - cur.x, ey - cur.y, ez - cur.z) < 3) return true;
    const slack = 0.15 + (d.spread || 0) + (d.moveSpread || 0) + (d.airSpread ?? 0.1) + 30 * (d.recoilSpread || 0) + 14 * (d.kick || 0);
    for (let i = 0; i <= 4; i++) {
      const k = i / 4;
      dirFrom(prev.yaw + wrapAngle(cur.yaw - prev.yaw) * k, prev.pitch + (cur.pitch - prev.pitch) * k, _f);
      const x = prev.x + (cur.x - prev.x) * k, y = prev.y + (cur.y - prev.y) * k, z = prev.z + (cur.z - prev.z) * k;
      if (angleTo(_f.x, _f.y, _f.z, x, y, z, ex, ey, ez) < slack) return true;
    }
    return false;
  }

  // ---------- what each player is sent (5v5) ----------
  // The host's snapshot, trimmed for one player: enemies they can't see (or hear) are sent as
  // "hidden" with no position, so a wallhack has nothing to show.
  cull(snap, pid) {
    const g = this.game, r = g.avatars?.find((a) => a.pid === pid);
    if (!r || !Array.isArray(snap?.c)) return snap;
    let out = null;
    snap.c.forEach((e, i) => {
      const x = g.byNid.get(e[0]);
      if (!x || x === r || x.team === r.team || !x.alive || this.visibleTo(r, x)) return;
      out = out || snap.c.slice();
      out[i] = [e[0], 0, 0, 0, 0, 0, (e[6] & (F.ALIVE | F.BOMB)) | F.HIDE, e[7], e[8], '', 0];
    });
    return out ? { ...snap, c: out } : snap;
  }

  // should this player be sent where enemy x is? Dead players see what their living teammates see.
  visibleTo(r, x) {
    if (r.alive) return this.vis(r, x);
    const mates = this.game.combatants.filter((c) => c.alive && c.team === r.team);
    return !mates.length || mates.some((m) => this.vis(m, x));
  }

  // can v see x, or did lately? Checked at most every VIS_EVERY s per pair.
  vis(v, x) {
    const now = this.game.time;
    this.seen = this.seen || new Map();
    const key = v.nid + ':' + x.nid;
    let e = this.seen.get(key);
    if (!e) this.seen.set(key, (e = { t: -9, until: -9 }));
    if (now - e.t >= VIS_EVERY) {
      e.t = now;
      if (this.mightSee(v, x)) e.until = now + VIS_HOLD;
    }
    return now < e.until;
  }

  // close, heard, spotted, or in sight (also a moment from now, so someone peeking a corner
  // shows up on time)
  mightSee(v, x) {
    const now = this.game.time;
    const vp = (v.isAvatar && v.interp?.latest) || v.body.pos, xp = (x.isAvatar && x.interp?.latest) || x.body.pos;
    const dist = Math.hypot(xp.x - vp.x, xp.y - vp.y, xp.z - vp.z);
    if (dist < NEAR || now < (x.spottedUntil || 0)) return true;
    if (now - (x.lastShot ?? -9) < 1.5 && dist < GUNSHOT) return true;
    if (dist < HEAR && x.body.onGround && !x.crouching && x.horizSpeed() > 3.6) return true;   // footsteps
    // eyes: now, a moment ahead, and leaning out to either side
    const vv = v.body.vel, xv = x.body.vel;
    const sx = -(xp.z - vp.z) / Math.max(dist, 0.01), sz = (xp.x - vp.x) / Math.max(dist, 0.01);
    const eh = v.eyeH || 1.65;
    const eyes = [[0, 0], [vv.x * AHEAD, vv.z * AHEAD], [sx * 0.6, sz * 0.6], [-sx * 0.6, -sz * 0.6]];
    const pts = [[0, 0], [xv.x * AHEAD, xv.z * AHEAD], [sx * 0.45, sz * 0.45], [-sx * 0.45, -sz * 0.45]];
    const hs = [(x.body.height || 1.8) - 0.15, 0.8];   // head, and hips (legs under a gap)
    for (const [ex, ez] of eyes) {
      _o.set(vp.x + ex, vp.y + eh, vp.z + ez);
      for (const [px, pz] of pts) for (const h of hs) if (this.clear(_o, _e.set(xp.x + px, xp.y + h, xp.z + pz))) return true;
    }
    return false;
  }

  // ---------- hits ----------
  // A reported hit on `target` (a fighter or a zombie). Returns false to ignore it.
  // quiet: a zombie hit that gives no points (extra pellets, explosions, lightning jumps)
  hit(av, target, { melee = false, quiet = false } = {}) {
    const s = this.st(av), now = this.game.time;
    const eyes = this.eyes(av), spots = this.spots(target);
    if (!eyes.length || !spots.length) return false;
    if (melee) {
      if (now - s.mT > 1 || s.mtok <= 0) { this.flag(av, 'noshot', 2); return false; }
      s.mtok--;
      if (this.nearest(eyes, spots) > 4) { this.flag(av, 'range', 2); return false; }
      return true;
    }
    const w = av.slots[av.slot];
    if (!w || w.def.melee) return false;
    if (now - s.tokT > 1 || s.tokens <= 0) { this.flag(av, 'noshot', 2); return false; }
    s.tokens--;
    const d = w.def;
    // explosions and lightning jumps land away from the bullet's line
    const side = quiet && (d.splash || d.chain);
    const reach = (d.range || 250) + 3 + (side ? (d.splash?.radius || 0) + (d.chain ? d.chain.range * d.chain.jumps : 0) : 0);
    if (this.nearest(eyes, spots) > reach) { this.flag(av, 'range', 2); return false; }
    if (side) return true;
    if (!this.sees(eyes, spots)) { this.flag(av, 'through', 2); return false; }
    if (!this.facing(eyes, spots)) { this.flag(av, 'aim', 1.5); return false; }
    return true;
  }

  // the most damage one hit from what this player holds can do (zombies)
  maxDamage(av, melee) {
    if (melee) return 200;
    const d = av.slots[av.slot]?.def;
    if (!d || d.melee) return 0;
    return Math.max(d.damage * (d.headMult || 4), d.splash?.damage || 0) * (av.perks?.has('dtap') ? 1.33 : 1) + 1;
  }

  // where this player's eyes were lately (with where they looked): their newest updates first
  eyes(av) {
    const out = [], h = av.eyeH || 1.65, buf = av.interp?.buf || [];
    for (let i = buf.length - 1; i >= 0 && out.length < 4; i--) out.push({ x: buf[i].x, y: buf[i].y + h, z: buf[i].z, yaw: buf[i].yaw, pitch: buf[i].pitch });
    const hist = this.hist.get(av) || [], now = this.game.time;
    for (let i = hist.length - 1; i >= 0; i -= 2) {
      const e = hist[i];
      if (e.t < now - 0.5) break;
      out.push({ x: e.x, y: e.y + h, z: e.z, yaw: e.yaw, pitch: e.pitch });
    }
    return out;
  }

  // spots on the target (legs, chest, head) where it was lately, or is now
  spots(target) {
    const p = target.body.pos;
    const chest = target.chestPos(_t).y - p.y;
    const head = target.headPos ? target.headPos(_t).y - p.y : (target.body.height || 1.8) - 0.17;
    const out = [], add = (x, y, z) => { out.push({ x, y: y + chest, z }, { x, y: y + head, z }, { x, y: y + 0.4, z }); };
    add(p.x, p.y, p.z);
    const l = target.interp?.latest;
    if (l) add(l.x, l.y, l.z);
    const hist = this.hist.get(target) || [];
    for (let i = hist.length - 1; i >= 0; i -= 2) add(hist[i].x, hist[i].y, hist[i].z);
    return out;
  }

  nearest(eyes, spots) {
    let best = Infinity;
    for (const e of eyes) for (const s of spots) best = Math.min(best, Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z));
    return best;
  }

  // can any recent eye position see any recent spot on the target?
  sees(eyes, spots) {
    const cols = this.cols(false);
    for (const e of eyes) for (const s of spots) {
      _e.set(e.x, e.y, e.z);
      _d.set(s.x - e.x, s.y - e.y, s.z - e.z);
      const len = _d.length();
      if (len < 0.3) return true;
      _d.divideScalar(len);
      if (!raycast(_e, _d, len - 0.05, cols, _hit)) return true;
    }
    return false;
  }

  // was the player looking roughly toward the target?
  facing(eyes, spots) {
    for (const e of eyes) {
      if (!Number.isFinite(e.yaw)) continue;
      dirFrom(e.yaw, e.pitch || 0, _f);
      for (const s of spots) {
        _d.set(s.x - e.x, s.y - e.y, s.z - e.z);
        const len = _d.length();
        if (len < 1) return true;
        const slack = AIM_SLACK + Math.atan(0.8 / len);
        if (_f.dot(_d) / len > Math.cos(slack)) return true;
      }
    }
    return false;
  }
}
