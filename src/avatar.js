// Fighters driven over the network. On the host these are the other people in the room; on a
// joining player's screen they are everyone else (people and bots). They have no AI: they
// replay the positions they are sent a moment behind real time, so movement stays smooth.
import * as THREE from 'three';
import { Bot } from './bots.js';
import { WEAPONS, papDef, MAX_PAP } from './weapons.js';
import { wrapAngle } from './physics.js';

// bit flags used in state updates and snapshots
// HIDE (snapshots only): an enemy the host doesn't tell you the position of (out of sight)
export const F = { ALIVE: 1, CROUCH: 2, GROUND: 4, USE: 8, SCOPE: 16, BOMB: 32, SPOT: 64, DOWN: 128, HIDE: 256 };
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

// Timed positions; sample() gives the position at any moment in between.
export class Interp {
  constructor() { this.buf = []; }
  clear() { this.buf.length = 0; }
  get latest() { return this.buf[this.buf.length - 1] || null; }

  push(t, x, y, z, yaw, pitch = 0) {
    const b = this.buf, last = b[b.length - 1];
    if (last && t < last.t) return;
    if (last && t === last.t) b.pop();
    b.push({ t, x, y, z, yaw, pitch });
    if (b.length > 40) b.shift();
  }

  sample(rt, out) {
    const b = this.buf;
    if (!b.length) return false;
    while (b.length > 2 && b[1].t <= rt) b.shift();
    const a = b[0], c = b[1];
    if (!c || rt <= a.t) return set(out, a);
    if (rt >= c.t) return set(out, c);
    const k = (rt - a.t) / (c.t - a.t);
    out.x = a.x + (c.x - a.x) * k; out.y = a.y + (c.y - a.y) * k; out.z = a.z + (c.z - a.z) * k;
    out.yaw = a.yaw + wrapAngle(c.yaw - a.yaw) * k;
    out.pitch = a.pitch + (c.pitch - a.pitch) * k;
    return true;
  }
}
function set(out, s) { out.x = s.x; out.y = s.y; out.z = s.z; out.yaw = s.yaw; out.pitch = s.pitch; return true; }

// ---------------------------------------------------------------- inventory sync
// [key, upgrade level (0 = none), mag, reserve] for slots 1..3 (0 = empty)
export function packSlots(c) {
  return [1, 2, 3].map((s) => { const w = c.slots[s]; return w ? [w.key, w.def.pap || 0, w.mag, w.reserve] : 0; });
}
export function unpackSlots(c, arr) {
  [1, 2, 3].forEach((s, i) => {
    const a = arr[i];
    if (!Array.isArray(a) || !WEAPONS[a[0]]) { c.slots[s] = null; return; }
    const [key, , mag, reserve] = a, old = c.slots[s], pap = Math.max(0, Math.min(MAX_PAP, a[1] | 0));
    const def = pap ? (old?.key === key && old.def.pap === pap ? old.def : papDef(WEAPONS[key], pap)) : WEAPONS[key];
    c.slots[s] = { key, def, mag: Math.max(0, mag | 0), reserve: Math.max(0, reserve | 0) };
  });
}
// A player's browser takes the host's word for what it carries (after a purchase, a respawn...).
export function applyInventory(p, ev) {
  if (!Array.isArray(ev.s)) return;
  unpackSlots(p, ev.s);
  p.invVer = ev.ver;
  const g = p.game;
  let cur = ev.cur;
  if (!p.slots[cur]) cur = p.slots[1] ? 1 : p.slots[2] ? 2 : 3;
  if (ev.h === 'pap') { p.deployUntil = g.time + 1.0; p.reloading = false; }
  if (ev.h === 'switch') {
    if (p.slot === cur) { p.reloading = false; p.recoil = 0; p.deployUntil = g.time + (p.weapon.def.deploy || 0.5); p.onSwitch?.(); }
    else p.selectSlot(cur);
  } else if (!p.slots[p.slot]) p.selectSlot(cur, true);
}

// ---------------------------------------------------------------- someone else's shot
const _o = new THREE.Vector3(), _e = new THREE.Vector3(), _dir = new THREE.Vector3(), _ey = new THREE.Vector3();
// ev.d: one entry per bullet: [x, y, z, kind, nx, ny, nz]; kind 1 = wall, 2 = blood, 3 = splinters
// ev.o: roughly where it came from, for a shooter out of your sight
export function showShot(g, c, ev) {
  const far = Array.isArray(ev.o) && ev.o.length === 3;
  if (far) _o.set(+ev.o[0] || 0, +ev.o[1] || 0, +ev.o[2] || 0); else c.eyePos(_o);
  g.sound.shot(ev.s, far ? _o : c.body.pos);
  c.lastShot = g.time;
  const ends = Array.isArray(ev.d) ? ev.d : [];
  const p = g.player;
  ends.forEach((d, i) => {
    _e.set(+d[0] || 0, +d[1] || 0, +d[2] || 0);
    _dir.subVectors(_e, _o);
    const len = _dir.length();
    if (len < 1e-3) return;
    _dir.divideScalar(len);
    if (i === 0 || Math.random() < 0.25) g.fx.tracer(_o, _e, ev.tc ?? undefined);
    if (d[3] === 1) g.fx.impact(_e, { nx: d[4], ny: d[5], nz: d[6] });
    else if (d[3] === 2) g.fx.blood(_e, _dir);
    else if (d[3] === 3) g.fx.burst(_e, 0xc9a06a, 5, 3);
    // bullet passing close to your head
    if (i === 0 && p?.alive && c.team !== p.team) {
      p.eyePos(_ey);
      const t = _ey.clone().sub(_o).dot(_dir);
      if (t > 0 && t < len && _o.clone().addScaledVector(_dir, t).distanceTo(_ey) < 1.2) g.sound.whiz(_ey);
    }
  });
  if (ev.sp != null && ends[0]) {
    g.fx.burst(_e.set(ends[0][0], ends[0][1], ends[0][2]), ev.sp, 22, 6);
    if (ev.s === 'thumper') g.sound.thumpBoom?.(_e);   // the Coconut Thumper's round going off
  }
}

// ---------------------------------------------------------------- sprites
function labelTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 36px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color; ctx.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let downTex = null;
function downTexture() {
  if (downTex) return downTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(32, 32, 27, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e8261a'; ctx.fillRect(26, 13, 12, 38); ctx.fillRect(13, 26, 38, 12);
  downTex = new THREE.CanvasTexture(c); downTex.colorSpace = THREE.SRGBColorSpace;
  return downTex;
}
const overlay = (map) => new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true });

// ---------------------------------------------------------------- avatar
const _s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
const _p = new THREE.Vector3();

export class Avatar extends Bot {
  // info: { nid, name, team, pid }
  constructor(game, info, look) {
    super(game, info.name, info.team, 'normal', look);
    this.isBot = false; this.isAvatar = true;
    this.nid = info.nid; this.pid = info.pid || null;
    this.botSeat = info.kind === 'bot';   // a bot, shown to joining players
    this.meleeName = this.botSeat ? 'Bat' : 'Knife';
    this.interp = new Interp();
    this.spawnEpoch = 0; this.invVer = 0;
    this.netFlags = F.ALIVE | F.GROUND;
    this.shown = null;        // joining players only: the weapon this fighter holds
    this.crouchK = 0; this.downed = false;
  }

  get weapon() { return this.shown || this.slots[this.slot]; }
  show(key, pap = 0) {
    if (!WEAPONS[key]) return;
    pap = Math.max(0, Math.min(MAX_PAP, pap | 0));
    if (this.shown?.key !== key || (this.shown.def.pap || 0) !== pap) this.shown = { key, def: pap ? papDef(WEAPONS[key], pap) : WEAPONS[key] };
  }

  // name floating over the head (seen through walls, like a teammate marker)
  addNameTag(text, color = '#bff5a0') {
    const s = new THREE.Sprite(overlay(labelTexture(text, color)));
    s.scale.set(1.5, 0.375, 1); s.position.set(0, 2.35, 0); s.renderOrder = 20;
    this.model.root.add(s);
    this.tag = s;
  }
  // red cross shown over a downed teammate (Zombies co-op)
  addDownIcon() {
    const s = new THREE.Sprite(overlay(downTexture()));
    s.scale.set(0.45, 0.45, 1); s.position.set(0, 1.9, 0); s.renderOrder = 21; s.visible = false;
    this.model.root.add(s);
    this.downIcon = s;
  }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.spawnEpoch++;
    this.interp.clear();
    this.downed = false; this.crouching = false; this.crouchK = 0;
    if (this.tag) this.tag.visible = true;
    this.game.ac?.spawned(this);
  }

  onDeath() {
    super.onDeath();
    if (this.tag) this.tag.visible = false;
    if (this.downIcon) this.downIcon.visible = false;
  }

  renderPos(out) { return out.copy(this.body.pos); }

  // host: a state update from this player's browser (the anticheat checks the position)
  netState(st, t) {
    if (!st || st.ep !== this.spawnEpoch || !Array.isArray(st.p)) return;
    let [x, y, z] = st.p;
    const pitch = +st.pi || 0;
    if (![x, y, z, st.y, pitch].every(Number.isFinite)) return;
    const ac = this.game.ac;
    if (ac) {
      if (!this.alive) return;   // the dead stay where they fell
      ({ x, y, z } = ac.move(this, x, y, z));
    }
    this.interp.push(t, x, y, z, st.y, Math.max(-1.6, Math.min(1.6, pitch)));
    this.netFlags = st.f | 0;
    this.wantsUse = !!(this.netFlags & F.USE);
    this.scoped = !!(this.netFlags & F.SCOPE);
    // where they look: checked for aimbots, triggerbots and spinbots
    ac?.look(this, st.y, pitch, this.downed ? 0.55 : (this.netFlags & F.CROUCH) ? 1.15 : 1.65);
    if (st.iv === this.invVer && Array.isArray(st.s)) {
      if (!ac) unpackSlots(this, st.s);
      if (this.slots[st.cur]) {
        if (ac && st.cur !== this.slot) ac.switched(this);
        this.slot = st.cur;
      }
    }
  }
  // host: the ammo in that update, once its shots were counted (see Anticheat.ammo)
  netAmmo(st) {
    if (st && st.ep === this.spawnEpoch && st.iv === this.invVer) this.game.ac?.ammo(this, st.s);
  }

  // move to where the network says this fighter was at time rt
  follow(dt, rt) {
    const b = this.body;
    _p.copy(b.pos);
    if (this.interp.sample(rt, _s)) { b.pos.set(_s.x, _s.y, _s.z); this.yaw = _s.yaw; this.pitch = _s.pitch; }
    this.prevPos.copy(b.pos);
    if (dt > 0) {
      let vx = (b.pos.x - _p.x) / dt, vz = (b.pos.z - _p.z) / dt;
      if (Math.hypot(vx, vz) > 15) vx = vz = 0;   // a teleport, not a run
      b.vel.x += (vx - b.vel.x) * 0.3; b.vel.z += (vz - b.vel.z) * 0.3;
    }
    const f = this.netFlags;
    this.crouching = !!(f & F.CROUCH) && !this.downed;
    b.height = this.crouching ? 1.3 : 1.8;
    b.onGround = !!(f & F.GROUND);
    const eye = this.downed ? 0.55 : this.crouching ? 1.15 : 1.65;
    this.eyeH += (eye - this.eyeH) * Math.min(1, dt * 14);
    if (this.alive) this.animate(dt); else this.animateDeath(dt);
    if (this.downIcon) this.downIcon.visible = this.alive && this.downed;
  }

  update(dt) {
    const g = this.game;
    this.follow(dt, g.time - (g.netDelay ?? 0.1));
    if (!this.alive || this.downed) return;
    const sp = this.horizSpeed();
    if (this.body.onGround && sp > 3.6 && !this.crouching) {
      this.stepT -= dt * sp / 5;
      if (this.stepT <= 0) { this.stepT = 0.38; g.sound.step(this.body.pos, false); g.emitNoise(this.body.pos, 14, this); }
    }
  }

  animate(dt) {
    super.animate(dt);
    const m = this.model;
    if (this.downed) {               // sitting on the ground, leaning back, aiming the pistol
      m.root.position.y -= 0.62;
      m.root.rotation.x = 0.5;
      m.legL.rotation.x = m.legR.rotation.x = 1.35;
      m.arms.rotation.x = this.pitch - 0.5;
      return;
    }
    this.crouchK += ((this.crouching ? 1 : 0) - this.crouchK) * Math.min(1, dt * 12);
    const k = this.crouchK;
    if (k > 0.01) {
      m.root.position.y -= 0.4 * k;
      m.legL.rotation.x = m.legL.rotation.x * (1 - k) + 0.95 * k;
      m.legR.rotation.x = m.legR.rotation.x * (1 - k) + 0.75 * k;
    }
  }
}
