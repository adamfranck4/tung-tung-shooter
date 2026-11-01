// Anticheat, run by the host in online matches. Each joining player's browser reports where it
// is, its ammo, its shots and its hits. The host checks every report against what the game
// allows and ignores the impossible ones. Each failed check adds suspicion points, which are
// slowly forgiven; a player who reaches KICK_AT is kicked from the room.
//
// It can't see inside a player's browser, so it only catches what a cheat has to tell the host:
// moving too fast or through walls, flying, guns or ammo the host never gave, firing too fast,
// and hits that weren't possible (no shot, too far, through a wall, not aimed that way).
import * as THREE from 'three';
import { raycast } from './physics.js';
import { dirFrom } from './combatant.js';

const KICK_AT = 12;                   // suspicion points
const FORGIVE = 0.2;                  // points forgiven per second
const COOLDOWN = 1;                   // s: the same check adds points at most once a second
const KEEP = 0.8;                     // s of past positions kept for every fighter and zombie
const MAX_RUN = 10;                   // m/s sideways (running is 6.35; bunny hops go a bit faster)
const RUN_SLACK = 3;                  // m, for updates that arrive bunched up
const MAX_RISE = 8, RISE_SLACK = 2;   // m/s and m upwards (a jump starts at 7.7 m/s)
const MAX_GAP = 8;                    // m between where a player says they are and where the host has them
const HELD_LIMIT = 2.5;               // s in a row of being held back by the speed limit
const AIR_LIMIT = 3;                  // s off the ground (a jump lasts under a second)
const AIM_SLACK = 0.7;                // rad between where a player looks and what they hit (recoil, spread, lag)

// what the kicked player is told
const REASONS = {
  teleport: 'teleporting', speed: 'moving too fast', wall: 'walking through walls', fly: 'flying',
  gun: 'using a gun the host never gave you', ammo: 'giving yourself ammo', rate: 'firing too fast',
  empty: 'firing without ammo', noshot: 'hits without shots', through: 'shooting through walls',
  range: 'hitting from too far away', aim: 'hitting what you were not aiming at', damage: 'too much damage',
};

const _e = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _hit = {};

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
        pts: 0, ptsT: this.game.time, cool: {},
        pos: { x: p.x, y: p.y, z: p.z }, rep: { x: p.x, y: p.y, z: p.z }, t: this.game.time,
        run: RUN_SLACK, rise: RISE_SLACK, air: 0, held: 0,
        credit: 3, creditT: this.game.time, tokens: 0, tokT: -9, mtok: 0, mT: -9,
      };
    }
    return av.ac;
  }

  // the host placed this player (round start, respawn): positions start over from here
  spawned(av) {
    const s = this.st(av), p = av.body.pos;
    Object.assign(s.pos, { x: p.x, y: p.y, z: p.z }); Object.assign(s.rep, s.pos);
    s.t = this.game.time; s.run = RUN_SLACK; s.rise = RISE_SLACK; s.air = 0; s.held = 0;
  }

  // every host tick: remember where everyone was, for checking hits a moment later
  record(...lists) {
    const now = this.game.time;
    if (now - this.recT < 0.05) return;
    this.recT = now;
    for (const list of lists) for (const c of list) {
      if (!c.alive || c.active === false) continue;
      let h = this.hist.get(c);
      if (!h) this.hist.set(c, (h = []));
      const p = c.body.pos;
      h.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: c.yaw, pitch: c.pitch || 0 });
      while (h.length && h[0].t < now - KEEP) h.shift();
    }
  }

  // a failed check: add points, kick at KICK_AT
  flag(av, why, pts) {
    if (!av?.isAvatar || av.kicked) return;
    const s = this.st(av), now = this.game.time;
    s.pts = Math.max(0, s.pts - (now - s.ptsT) * FORGIVE); s.ptsT = now;
    if (now - (s.cool[why] ?? -9) < COOLDOWN) return;
    s.cool[why] = now;
    s.pts += pts;
    console.warn(`[anticheat] ${av.name}: ${REASONS[why] || why} (+${pts}, now ${s.pts.toFixed(1)} of ${KICK_AT})`);
    if (s.pts >= KICK_AT) this.kick(av, why);
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

  // A reported shot. Returns false to ignore it.
  shot(av) {
    const s = this.st(av), now = this.game.time, w = av.slots[av.slot];
    if (!w || w.def.melee) return false;
    const d = w.def;
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
