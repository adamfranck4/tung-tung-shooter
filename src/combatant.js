// Shared logic for the player and bots: health, weapons, recoil, movement and hitboxes.
import * as THREE from 'three';
import { WEAPONS, adsOf } from './weapons.js';
import { moveBody, overlapsAny, raySphere, rayBox, raycast } from './physics.js';

// CS2 movement values, converted from Source units (1 unit = 1 inch = 0.0254 m).
const U = 0.0254;
export const RUN_SPEED = 250 * U;      // knife-out max speed: 250 u/s = 6.35 m/s
const ACCELERATE = 5.5;                // sv_accelerate
const FRICTION = 5.2;                  // sv_friction
const STOP_SPEED = 80 * U;             // sv_stopspeed
const AIR_ACCELERATE = 12;             // sv_airaccelerate
const AIR_WISH_CAP = 30 * U;           // air strafing cap (30 u/s)
export const JUMP_SPEED = 301.993 * U; // sv_jump_impulse: ~57 units (1.45 m) high
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
let nextId = 1;

// aiming down sights eases in and out (smoothstep of 0..1)
export const easeAds = (t) => t * t * (3 - 2 * t);

export function dirFrom(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// Third-person camera behind a fighter, pulled in when a wall is in the way (spectating).
const _cv = new THREE.Vector3(), _cd = new THREE.Vector3(), _ch = {};
export function chaseCamera(cam, s, alpha, colliders) {
  s.renderEye(_cv, alpha);
  dirFrom(s.yaw, s.pitch * 0.5, _cd).negate();
  _cd.y += 0.25; _cd.normalize();
  const hit = raycast(_cv, _cd, 3.2, colliders, _ch);
  const dist = hit ? Math.max(0.3, hit.t - 0.3) : 3.2;
  cam.position.copy(_cv).addScaledVector(_cd, dist);
  cam.rotation.set(s.pitch * 0.5 - 0.08, s.yaw, 0);
}

// Source-engine acceleration: gain up to accel * base * dt per step, but never push the
// speed along the wish direction past wishSpeed. `base` is the full (unscaled) speed, so
// walking, crouching and air-strafing get CS2's brisk acceleration even though their
// target speed is low.
function accelerate(vel, wx, wz, wishSpeed, accel, dt, base = wishSpeed) {
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * base, add);
  vel.x += wx * a; vel.z += wz * a;
}

export class Combatant {
  constructor(game, name, team) {
    this.id = nextId++;
    this.game = game; this.name = name; this.team = team; this.isBot = false;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), halfW: 0.38, height: 1.8, onGround: true };
    this.scale = 1;                     // body size multiplier (big zombies); scales the hitboxes
    this.prevPos = new THREE.Vector3(); // position at the previous physics tick (for smooth rendering)
    this.viewOffset = 0;                // eases the camera over steps instead of snapping
    this.yaw = 0; this.pitch = 0; this.crouching = false; this.eyeH = 1.65;
    this.health = 100; this.armor = 0; this.alive = true; this.money = 800;
    this.slots = { 1: null, 2: null, 3: null }; this.slot = 2; this.lastSlot = 3;
    this.kills = 0; this.deaths = 0; this.hasBomb = false;
    this.recoil = 0; this.lastShot = -10; this.nextFire = 0; this.deployUntil = 0;
    this.burstLeft = 0; this.burstAt = 0;   // shots still to come in a burst (M16)
    this.reloading = false; this.reloadEnd = 0; this.autoReloadAt = 0; this.scoped = false;
    this.adsT = 0;                      // aiming down sights: 0 = from the hip, 1 = fully aimed (Zombies)
    this.spinK = 0;                     // how far a minigun has spun up (0..1)
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
    if (slot !== this.slot) {
      // quick-switch, like CS: putting a bolt-action away skips the rest of its bolt cycle
      // (you still wait for the next weapon to be drawn)
      if (this.weapon?.def.scope) this.nextFire = 0;
      this.lastSlot = this.slot;
    }
    this.slot = slot;
    this.reloading = false; this.autoReloadAt = 0; this.scoped = false; this.recoil = 0; this.burstLeft = 0;
    this.deployUntil = this.game.time + (instant ? 0 : (this.weapon.def.deploy || 0.5));
    this.onSwitch?.();
    return true;
  }

  spawn(pos, yaw) {
    const b = this.body;
    b.pos.copy(pos); b.vel.set(0, 0, 0); b.height = 1.8; b.onGround = true;
    this.prevPos.copy(pos); this.viewOffset = 0;
    this.crouching = false; this.eyeH = 1.65;
    this.yaw = yaw; this.pitch = 0;
    // dying loses everything you bought, including a pistol upgrade
    if (!this.alive) { this.slots[1] = null; this.slots[2] = null; this.armor = 0; }
    if (!this.slots[2]) this.give('pistol');
    if (!this.slots[3]) this.give('knife');
    for (const s of [1, 2]) { const w = this.slots[s]; if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; } }
    this.health = 100; this.alive = true; this.hasBomb = false;
    this.useProgress = 0; this.wantsUse = false; this.recoil = 0; this.punch = 0;
    this.reloading = false; this.scoped = false; this.adsT = 0; this.nextFire = 0; this.lastAttacker = null; this.burstLeft = 0;
    this.selectSlot(this.slots[1] ? 1 : 2, true);
  }

  // how far the gun is raised to the eye (eased), and the field-of-view multiplier that goes with it
  adsK() { return this.adsT > 0 ? easeAds(this.adsT) : 0; }
  adsFov() {
    const a = this.adsT > 0 && adsOf(this.weapon?.def);
    return a ? 1 / (1 + (a.zoom - 1) * this.adsK()) : 1;
  }

  eyePos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.eyeH, this.body.pos.z); }
  // where to draw this combatant between two physics ticks (alpha 0..1)
  renderPos(out, alpha) { return out.lerpVectors(this.prevPos, this.body.pos, alpha); }
  renderEye(out, alpha) { this.renderPos(out, alpha); out.y += this.eyeH + this.viewOffset; return out; }
  headPos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.body.height - 0.17 * this.scale, this.body.pos.z); }
  chestPos(out) { return out.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.68, this.body.pos.z); }
  horizSpeed() { return Math.hypot(this.body.vel.x, this.body.vel.z); }

  // aiming down sights steadies the gun: a quarter less kick
  recoilPitch() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const n = this.recoil, k = w.def.kick * (1 - 0.25 * this.adsK());
    return Math.min(n, 7) * k + Math.max(0, n - 7) * k * 0.2;
  }
  recoilYaw() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const n = this.recoil;
    return n > 3 ? Math.sin(n * 0.8) * w.def.kick * 1.6 * (1 - 0.25 * this.adsK()) : 0;
  }

  spread() {
    const w = this.weapon; if (!w || w.def.melee) return 0;
    const d = w.def, b = this.body, ads = this.adsK();
    // aiming down sights halves the base spread (pellets too) and the spread from moving
    let s = (d.scope && this.scoped) ? d.scopedSpread : d.spread * (1 - 0.5 * ads);
    // like CS2: accurate below ~34% of the weapon's max speed, fully inaccurate near full speed
    const frac = this.horizSpeed() / (RUN_SPEED * (d.speed || 1));
    s += (d.moveSpread || 0) * Math.min(1, Math.max(0, (frac - 0.34) / 0.5)) * (1 - 0.5 * ads);
    if (!b.onGround) s += d.airSpread ?? 0.1;
    if (this.crouching && b.onGround) s *= 0.75;
    s += this.recoil * (d.recoilSpread || 0) * (1 - 0.3 * ads);
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
    this.nextFire = g.time + this.fireRate(d);
    this.lastShot = g.time;
    if (d.melee) { g.melee(this); this.onFire?.(); return true; }
    this.shoot(w);
    // burst weapons fire the rest of the burst on their own (see updateWeapon)
    if (d.burst) { this.burstLeft = Math.min(d.burst - 1, w.mag); this.burstAt = g.time + d.burstGap; }
    return true;
  }

  // seconds between shots: a minigun fires slowly until it has spun up
  fireRate(d) {
    const r = d.spin ? d.spin.from + (d.rate - d.spin.from) * this.spinK : d.rate;
    return r * (this.rateMul || 1);
  }

  // one shot of a gun: spends a round, fires its bullet(s), adds recoil
  shoot(w) {
    const g = this.game, d = w.def;
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
  }

  startReload() {
    const w = this.weapon;
    if (!w || w.def.melee || this.reloading || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloading = true; this.burstLeft = 0;
    this.reloadDur = w.def.reload * (this.reloadMul || 1);
    this.reloadEnd = this.game.time + this.reloadDur;
    this.scoped = false;
    this.onReload?.();
    return true;
  }

  updateWeapon(dt) {
    const g = this.game, w = this.weapon;
    if (!w) return;
    if (this.burstLeft > 0 && g.time >= this.burstAt) {
      if (this.alive && w.def.burst && !this.reloading && w.mag > 0) {
        this.burstLeft--; this.burstAt += w.def.burstGap; this.lastShot = g.time;
        this.shoot(w);
      } else this.burstLeft = 0;
    }
    if (this.reloading && g.time >= this.reloadEnd) {
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take; w.reserve -= take;
      this.reloading = false;
    }
    if (this.autoReloadAt && g.time >= this.autoReloadAt) { this.autoReloadAt = 0; this.startReload(); }
    // bolt-action kick settles right away, so it's gone by the time the bolt is ready
    const settleAfter = w.def.scope ? 0.2 : (w.def.rate || 0.1) + 0.06;
    if (g.time - this.lastShot > settleAfter) this.recoil = Math.max(0, this.recoil - dt * 14);
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
  // climbVel: when set, the body is on a ladder: vertical speed is fixed and gravity is off
  applyMovement(dt, wx, wz, speedMul, jump, climbVel = null) {
    const b = this.body;
    const map = this.game.map;
    const groundAt = map.groundAt ? (map.groundAtFn ||= map.groundAt.bind(map)) : null;   // (made once, not every tick)
    if (climbVel !== null) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0) { const ns = Math.max(sp - Math.max(sp, STOP_SPEED) * FRICTION * dt, 0); b.vel.x *= ns / sp; b.vel.z *= ns / sp; }
      if (wx || wz) accelerate(b.vel, wx, wz, RUN_SPEED * 0.4, ACCELERATE, dt, RUN_SPEED);
      b.vel.y = climbVel;
      moveBody(b, dt, this.colliders || map.colliders, groundAt, true);
      return;
    }
    const runSpeed = RUN_SPEED * (this.weapon?.def.speed || 1);
    let maxSpeed = runSpeed * speedMul;
    if (this.scoped) maxSpeed *= 0.55;
    if (this.adsT > 0) maxSpeed *= 1 - 0.3 * this.adsK();   // walking pace while aiming down sights
    if (this.crouching) maxSpeed *= 0.34;
    const startY = b.pos.y, wasGround = b.onGround;
    if (b.onGround) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt;
        const ns = Math.max(sp - drop, 0);
        b.vel.x *= ns / sp; b.vel.z *= ns / sp;
      }
      if (wx || wz) accelerate(b.vel, wx, wz, maxSpeed, ACCELERATE, dt, Math.max(maxSpeed, runSpeed));
      if (jump) { b.vel.y = JUMP_SPEED; b.onGround = false; this.onJump?.(); }
    } else if (wx || wz) {
      // air strafing: strong acceleration toward a tiny (30 u/s) wish speed, so turning in the air bends your path
      accelerate(b.vel, wx, wz, Math.min(maxSpeed, AIR_WISH_CAP), AIR_ACCELERATE, dt, maxSpeed);
    }
    moveBody(b, dt, this.colliders || map.colliders, groundAt);
    // stepping up a ledge moves the body instantly; let the camera catch up smoothly instead
    const rise = b.pos.y - startY;
    if (wasGround && b.onGround && rise > 0.02 && rise < 0.6) this.viewOffset -= rise;
    this.viewOffset *= Math.exp(-dt * 16);
    if (Math.abs(this.viewOffset) < 0.001) this.viewOffset = 0;
  }

  // Bullet vs this combatant's hitboxes. Returns {t, part} or null.
  rayHit(o, d, maxT) {
    const p = this.body.pos, h = this.body.height, s = this.scale;
    let best = null;
    const tHead = raySphere(o, d, p.x, p.y + h - 0.17 * s, p.z, 0.19 * s);
    if (tHead !== null && tHead < maxT) best = { t: tHead, part: 'head' };
    const w = 0.28 * s;
    const tBody = rayBox(o, d, p.x - w, p.y, p.z - w, p.x + w, p.y + h - 0.33 * s, p.z + w);
    if (tBody !== null && tBody < (best ? best.t : maxT)) {
      const y = o.y + d.y * tBody;
      best = { t: tBody, part: y < p.y + (this.crouching ? 0.45 : 0.62 * s) ? 'leg' : 'body' };
    }
    return best;
  }
}
