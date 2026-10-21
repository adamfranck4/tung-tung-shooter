// Shared logic for the player and bots: health, weapons, recoil, movement and hitboxes.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { moveBody, overlapsAny, raySphere, rayBox } from './physics.js';

export const RUN_SPEED = 5.4;
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
let nextId = 1;

export function dirFrom(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

function accelerate(vel, wx, wz, wishSpeed, accel, dt) {
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  vel.x += wx * a; vel.z += wz * a;
}

export class Combatant {
  constructor(game, name, team) {
    this.id = nextId++;
    this.game = game; this.name = name; this.team = team; this.isBot = false;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), halfW: 0.35, height: 1.8, onGround: true };
    this.yaw = 0; this.pitch = 0; this.crouching = false; this.eyeH = 1.65;
    this.health = 100; this.armor = 0; this.alive = true; this.money = 800;
    this.slots = { 1: null, 2: null, 3: null }; this.slot = 2; this.lastSlot = 3;
    this.kills = 0; this.deaths = 0; this.hasBomb = false;
    this.recoil = 0; this.lastShot = -10; this.nextFire = 0; this.deployUntil = 0;
    this.reloading = false; this.reloadEnd = 0; this.autoReloadAt = 0; this.scoped = false;
    this.punch = 0; this.useProgress = 0; this.wantsUse = false; this.spottedUntil = 0;
    this.lastAttacker = null;
    this.meleeName = 'Knife';
  }

  give(key, slot) {
    const def = WEAPONS[key];
    this.slots[slot ?? def.slot] = { key, def, mag: def.mag || 0, reserve: def.reserve || 0 };
  }
  get weapon() { return this.slots[this.slot]; }

  selectSlot(slot, instant = false) {
    if (!this.slots[slot]) return false;
    if (slot === this.slot && !instant) return false;
    if (slot !== this.slot) this.lastSlot = this.slot;
    this.slot = slot;
    this.reloading = false; this.autoReloadAt = 0; this.scoped = false; this.recoil = 0;
    this.deployUntil = this.game.time + (instant ? 0 : (this.weapon.def.deploy || 0.5));
    this.onSwitch?.();
    return true;
  }

  spawn(pos, yaw) {
    const b = this.body;
    b.pos.copy(pos); b.vel.set(0, 0, 0); b.height = 1.8; b.onGround = true;
    this.crouching = false; this.eyeH = 1.65;
    this.yaw = yaw; this.pitch = 0;
    if (!this.alive) { this.slots[1] = null; this.armor = 0; }
    if (!this.slots[2]) this.give('pistol');
    if (!this.slots[3]) this.give('knife');
    for (const s of [1, 2]) { const w = this.slots[s]; if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; } }
    this.health = 100; this.alive = true; this.hasBomb = false;
    this.useProgress = 0; this.wantsUse = false; this.recoil = 0; this.punch = 0;
    this.reloading = false; this.scoped = false; this.nextFire = 0; this.lastAttacker = null;
    this.selectSlot(this.slots[1] ? 1 : 2, true);
  }

  eyePos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.eyeH, this.body.pos.z); }
  headPos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.body.height - 0.17, this.body.pos.z); }
  chestPos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.68, this.body.pos.z); }
  horizSpeed() { return Math.hypot(this.body.vel.x, this.body.vel.z); }

  recoilPitch() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const n = this.recoil, k = w.def.kick;
    return Math.min(n, 7) * k + Math.max(0, n - 7) * k * 0.2;
  }
  recoilYaw() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const n = this.recoil;
    return n > 3 ? Math.sin(n * 0.8) * w.def.kick * 1.6 : 0;
  }

  spread() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const d = w.def, b = this.body;
    let s = (d.scope && this.scoped) ? d.scopedSpread : d.spread;
    const sp = this.horizSpeed();
    s += (d.moveSpread || 0) * Math.min(1, Math.max(0, (sp - 1.4) / 3.6));
    if (!b.onGround) s += d.airSpread ?? 0.1;
    if (this.crouching && b.onGround) s *= 0.75;
    s += this.recoil * (d.recoilSpread || 0);
    return s;
  }

  // Returns true if a shot was fired. `edge` = trigger was just pressed.
  tryFire(edge) {
    const g = this.game, w = this.weapon;
    if (!w || !this.alive) return false;
    if (g.time < this.nextFire || g.time < this.deployUntil || this.reloading) return false;
    const d = w.def;
    if (!d.melee && w.mag <= 0) {
      if (edge) g.sound.dryFire();
      this.startReload();
      return false;
    }
    if (!d.auto && !d.melee && !edge) return false;
    this.nextFire = g.time + d.rate * (this.rateMul || 1);
    this.lastShot = g.time;
    if (d.melee) { g.melee(this); this.onFire?.(); return true; }

    w.mag--;
    const pOff = this.recoilPitch(), yOff = this.recoilYaw();
    const spread = this.spread();
    const eye = this.eyePos(_eye);
    for (let i = 0; i < (d.pellets || 1); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const dir = dirFrom(this.yaw + yOff + Math.cos(a) * r, this.pitch + pOff + Math.sin(a) * r, _dir);
      g.fireBullet(this, eye, dir, d, i > 0);
    }
    this.recoil = Math.min(this.recoil + 1, 30);
    this.punch += d.kick * 0.6;
    if (d.scope) this.scoped = false; // bolt cycles: unscope after each shot
    g.onShot(this, d);
    this.onFire?.();
    if (w.mag === 0 && w.reserve > 0) this.autoReloadAt = g.time + 0.4;
    return true;
  }

  startReload() {
    const w = this.weapon;
    if (!w || w.def.melee || this.reloading || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloading = true;
    this.reloadDur = w.def.reload * (this.reloadMul || 1);
    this.reloadEnd = this.game.time + this.reloadDur;
    this.scoped = false;
    this.onReload?.();
    return true;
  }

  updateWeapon(dt) {
    const g = this.game, w = this.weapon;
    if (!w) return;
    if (this.reloading && g.time >= this.reloadEnd) {
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take; w.reserve -= take;
      this.reloading = false;
    }
    if (this.autoReloadAt && g.time >= this.autoReloadAt) { this.autoReloadAt = 0; this.startReload(); }
    if (g.time - this.lastShot > (w.def.rate || 0.1) + 0.06) this.recoil = Math.max(0, this.recoil - dt * 14);
    const target = this.recoilPitch() * 0.45;
    this.punch += (target - this.punch) * Math.min(1, dt * 14);
  }

  setCrouch(want, dt) {
    const b = this.body, cols = this.colliders || this.game.map.colliders;
    if (want && !this.crouching) {
      this.crouching = true;
      if (!b.onGround) { b.pos.y += 0.5; this.eyeH -= 0.5; if (overlapsAny({ ...b, height: 1.3 }, cols)) b.pos.y -= 0.5; }
      b.height = 1.3;
    } else if (!want && this.crouching) {
      b.height = 1.8;
      if (overlapsAny(b, cols)) b.height = 1.3;
      else this.crouching = false;
    }
    const targetEye = this.crouching ? 1.15 : 1.65;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 14);
  }

  // wx, wz: unit direction of desired movement (or 0,0)
  applyMovement(dt, wx, wz, speedMul, jump) {
    const b = this.body;
    let maxSpeed = RUN_SPEED * (this.weapon?.def.speed || 1) * speedMul;
    if (this.scoped) maxSpeed *= 0.55;
    if (this.crouching) maxSpeed *= 0.36;
    if (b.onGround) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, 1.6) * 7 * dt;
        const ns = Math.max(sp - drop, 0);
        b.vel.x *= ns / sp; b.vel.z *= ns / sp;
      }
      if (wx || wz) accelerate(b.vel, wx, wz, maxSpeed, 9, dt);
      if (jump) { b.vel.y = 6.4; b.onGround = false; this.onJump?.(); }
    } else if (wx || wz) {
      accelerate(b.vel, wx, wz, Math.min(maxSpeed, 0.9), 12, dt);
    }
    moveBody(b, dt, this.colliders || this.game.map.colliders);
  }

  // Bullet vs this combatant's hitboxes. Returns {t, part} or null.
  rayHit(o, d, maxT) {
    const p = this.body.pos, h = this.body.height;
    let best = null;
    const tHead = raySphere(o, d, p.x, p.y + h - 0.17, p.z, 0.19);
    if (tHead !== null && tHead < maxT) best = { t: tHead, part: 'head' };
    const tBody = rayBox(o, d, p.x - 0.28, p.y, p.z - 0.28, p.x + 0.28, p.y + h - 0.33, p.z + 0.28);
    if (tBody !== null && tBody < (best ? best.t : maxT)) {
      const y = o.y + d.y * tBody;
      best = { t: tBody, part: y < p.y + (this.crouching ? 0.45 : 0.62) ? 'leg' : 'body' };
    }
    return best;
  }
}
