// Zombies mode: survive endless rounds of Tung Tung zombies in Sahur Village.
import * as THREE from 'three';
import { Combatant, RUN_SPEED, dirFrom } from './combatant.js';
import { Player } from './player.js';
import { buildTungModel } from './bots.js';
import { WEAPONS, papDef } from './weapons.js';
import { raycast, wrapAngle } from './physics.js';
import { PLAYER_START } from './zmap.js';
import { knifeName } from './viewmodel.js';

const MAX_ALIVE = 24;
const BOX_WEAPONS = [['smg', 3], ['shotgun', 3], ['ak', 3], ['m4', 3], ['sniper', 2], ['lmg', 2], ['raygun', 1]];
const POWERUPS = {
  maxammo: { label: 'MAX AMMO', short: 'AMMO', color: '#7dff6a' },
  instakill: { label: 'INSTA-KILL', short: 'KILL', color: '#ff5a5a' },
  double: { label: 'DOUBLE POINTS', short: 'x2', color: '#ffd84a' },
  nuke: { label: 'KABOOM', short: 'NUKE', color: '#ffa040' },
  carpenter: { label: 'CARPENTER', short: 'FIX', color: '#8ad0ff' },
};
const BASE_HEALTH = 150, JUGG_HEALTH = 250;
export const ZOMBIE_HP = 100;                            // regular zombies: same health as a player
export const bigZombieHealth = (r) => 400 + 80 * r;      // big zombies: a real bullet sponge
const BIG_SCALE = 1.7;
// chance that a spawn is a big zombie (from round 3, up to 1 in 4), max 3 alive at once
const bigChance = (r) => (r < 3 ? 0 : clamp(0.06 + (r - 3) * 0.02, 0, 0.25));
export const zombieCount = (r) => (r <= 5 ? [6, 8, 13, 18, 24][r - 1] : Math.floor(24 + (r - 5) * 4.5));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _end = new THREE.Vector3();
const _hit = {};

// ---------------------------------------------------------------- zombie
class Zombie extends Combatant {
  constructor(game) {
    super(game, 'Zombie', 'Z');
    this.isZombie = true;
    this.model = buildTungModel('Z', { zombie: true });
    this.model.root.visible = false;
    game.scene.add(this.model.root);
    this.active = false; this.alive = false;
    this.body.halfW = 0.3;
  }

  spawn(sp, round, big = false) {
    this.active = true; this.alive = true; this.big = big;
    const s = this.scale = big ? BIG_SCALE : 1;
    this.health = big ? bigZombieHealth(round) : ZOMBIE_HP;
    const roll = Math.random();
    const sprint = clamp((round - 6) * 0.12, 0, 0.8), run = clamp((round - 2) * 0.2, 0, 0.95);
    // scaled to CS2 player speed (6.35 m/s with a knife): sprinters stay just slower than you
    if (big) this.speed = round >= 8 ? 3.4 : 1.8 + Math.random() * 0.3;
    else this.speed = roll < sprint ? 5.9 : roll < run ? 4.25 : 1.55 + Math.random() * 0.45;
    const b = this.body;
    b.vel.set(0, 0, 0); b.height = 1.8 * s; b.halfW = 0.3 * s; b.onGround = true;
    this.attackT = 0; this.attackCd = 0.6; this.stuckT = 0; this.deathT = 0; this.tearT = 0.8;
    this.soundT = 1 + Math.random() * 5; this.walkPhase = Math.random() * 6;
    this.win = sp.win || null;
    if (this.win) {
      b.pos.copy(this.win.spawn);
      this.prevPos.copy(b.pos);
      this.state = 'toWindow';
      this.yaw = Math.atan2(this.win.dir.x, this.win.dir.z); // face into the building
    } else {
      this.riseBase = this.game.map.groundAt(sp.pos.x, sp.pos.z); // rise out of hills too
      b.pos.set(sp.pos.x, this.riseBase - 1.9 * s, sp.pos.z);
      this.prevPos.copy(b.pos);
      this.state = 'rise'; this.riseT = 0;
      this.yaw = Math.random() * Math.PI * 2;
    }
    const m = this.model;
    m.root.visible = true;
    m.root.scale.setScalar(big ? BIG_SCALE : 0.95 + Math.random() * 0.1);
    this.animate(0);
  }

  deactivate() { this.active = false; this.alive = false; this.model.root.visible = false; }

  turnTo(yawT, dt, rate) { this.yaw += wrapAngle(yawT - this.yaw) * Math.min(1, dt * rate); }

  update(dt) {
    const g = this.game, b = this.body;
    if (!this.alive) { this.updateDead(dt); return; }
    this.soundT -= dt;
    if (this.soundT <= 0) { this.soundT = 3 + Math.random() * 5; g.zombieSound(this); }

    if (this.state === 'rise') {
      this.riseT += dt;
      const k = Math.min(1, this.riseT / (this.big ? 2.2 : 1.5));
      b.pos.y = this.riseBase - 1.9 * this.scale * (1 - k);
      this.turnTo(Math.atan2(-(g.player.body.pos.x - b.pos.x), -(g.player.body.pos.z - b.pos.z)), dt, 3);
      if (k >= 1) { b.pos.y = this.riseBase; this.state = 'chase'; }
      this.animate(dt, 0.6);
      return;
    }
    if (this.state === 'toWindow') {
      const w = this.win, dx = w.outside.x - b.pos.x, dz = w.outside.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) { this.state = w.boards > 0 ? 'tear' : 'climb'; this.climbT = 0; this.climbFrom = b.pos.clone(); }
      else this.applyMovement(dt, dx / d, dz / d, Math.min(this.speed, 2.6) / RUN_SPEED, false);
      this.turnTo(Math.atan2(w.dir.x, w.dir.z), dt, 6);
    } else if (this.state === 'tear') {
      const w = this.win;
      this.applyMovement(dt, 0, 0, 1, false);
      this.turnTo(Math.atan2(w.dir.x, w.dir.z), dt, 6);
      if (w.boards <= 0) { this.state = 'climb'; this.climbT = 0; this.climbFrom = b.pos.clone(); }
      else {
        this.tearT -= dt;
        if (this.tearT <= 0) { g.tearBoard(w); this.tearT = 1.0 + Math.random() * 0.5; }
      }
    } else if (this.state === 'climb') {
      this.climbT += dt / 0.9;
      const k = Math.min(1, this.climbT);
      b.pos.lerpVectors(this.climbFrom, this.win.inside, k);
      b.pos.y = Math.sin(k * Math.PI) * 1.0;
      if (k >= 1) { b.pos.y = 0; b.vel.set(0, 0, 0); this.state = 'chase'; }
      this.animate(dt, 1.5);
      return;
    } else {
      this.chase(dt);
    }
    this.animate(dt);
  }

  chase(dt) {
    const g = this.game, b = this.body, p = g.player, map = g.map;
    const tp = p.body.pos;
    const dx = tp.x - b.pos.x, dz = tp.z - b.pos.z, dist = Math.hypot(dx, dz);
    const canAttack = p.alive && !p.downed && g.phase !== 'over';
    const dy = tp.y - b.pos.y;
    // big zombies reach further and hit harder
    const reach = this.big ? 1.9 : 1.3, hitReach = this.big ? 2.5 : 1.8, dmg = this.big ? 80 : 50;
    if (this.attackT > 0) {
      const prev = this.attackT;
      this.attackT -= dt;
      if (prev > 0.32 && this.attackT <= 0.32 && canAttack && dist < hitReach && dy > -0.5 && dy < 1.4 * this.scale) g.hurtPlayer(dmg, this);
    } else {
      this.attackCd -= dt;
      if (canAttack && dist < reach && dy > -0.5 && dy < 1.4 * this.scale && this.attackCd <= 0) {
        this.attackT = 0.75; this.attackCd = this.big ? 1.4 : 1.1; g.sound.swing(b.pos);
      }
    }
    let wx = 0, wz = 0, jump = false;
    if (canAttack && dist > 0.85 * this.scale) {
      // run straight at you only when you're on the same level and nothing is in the way
      if (dist < 14 && Math.abs(dy) < 1.2 && map.clearLine(b.pos, tp, 0.3 * this.scale)) { wx = dx / dist; wz = dz / dist; }
      else {
        const t = map.flowTarget(b.pos, _t);
        if (t) { const tx = t.x - b.pos.x, tz = t.z - b.pos.z, l = Math.hypot(tx, tz) || 1; wx = tx / l; wz = tz / l; }
        else { wx = dx / dist; wz = dz / dist; }
      }
    }
    let speed = this.speed;
    if (this.attackT > 0) speed *= 0.35;
    if (wx || wz) {
      if (this.horizSpeed() < speed * 0.25) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8 && b.onGround) { jump = true; this.stuckT = 0; }
    }
    this.applyMovement(dt, wx, wz, speed / RUN_SPEED, jump);
    if (dist < 2.5) this.turnTo(Math.atan2(-dx, -dz), dt, 10);
    else if (wx || wz) this.turnTo(Math.atan2(-wx, -wz), dt, 7);
  }

  animate(dt, phaseSpeed) {
    const m = this.model, b = this.body;
    m.root.position.copy(b.pos);
    m.root.rotation.set(0, this.yaw, 0);
    const sp = phaseSpeed ?? this.horizSpeed();
    this.walkPhase += dt * (sp * 1.9 + 0.8);
    const amp = Math.min(1, sp / 3.5) * 0.7 + 0.1;
    m.legL.rotation.x = Math.sin(this.walkPhase) * amp;
    m.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    m.torso.position.y = 0.6 + Math.abs(Math.cos(this.walkPhase)) * 0.04 * amp;
    m.torso.rotation.z = Math.sin(this.walkPhase) * 0.07 * amp;
    m.torso.rotation.x = this.speed > 4.5 ? -0.3 : -0.14; // hunched forward
    // bat held low at the side while walking (like the reference), raised over the shoulder to swing
    let armX = -0.35 + Math.sin(this.walkPhase * 0.5) * 0.08, batX = 0.35 + Math.sin(this.walkPhase) * 0.12;
    if (this.attackT > 0) {
      const k = 1 - this.attackT / 0.75;
      if (k < 0.55) { const e = k / 0.55; armX = -0.35 + e * 1.25; batX = 0.35 - e * 2.6; }
      else { const e = (k - 0.55) / 0.45; armX = 0.9 - e * 1.35; batX = -2.25 + e * 3.2; }
    } else if (this.state === 'tear') {
      armX = 0.5 + Math.sin(this.game.time * 9 + this.walkPhase) * 0.6;
      batX = -0.6 + Math.sin(this.game.time * 9 + this.walkPhase) * 0.9;
    }
    m.arms.rotation.x = armX;
    m.bat.rotation.x = batX;
  }

  updateDead(dt) {
    const m = this.model;
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 0.45), e = k * k;
    m.root.rotation.set(e * Math.PI / 2 * 0.97, this.yaw, e * this.deathTilt);
    let y = this.body.pos.y + e * 0.15;
    if (this.deathT > 2.2) y -= (this.deathT - 2.2) * 0.7; // sink into the ground
    m.root.position.set(this.body.pos.x, y, this.body.pos.z);
    if (this.deathT > 3.8) this.deactivate();
  }
}

// ---------------------------------------------------------------- game
export class ZombiesGame {
  constructor({ scene, camera, map, hud, sound, fx, input, vm, settings }) {
    Object.assign(this, { scene, camera, map, hud, sound, fx, input, vm, settings });
    this.mode = 'zombies';
    this.time = 0; this.baseFov = 74; this.scopeFov = 22;
    this.zombies = []; this.combatants = []; this.powerups = [];
    this.running = false; this.phase = 'live';
    this.bomb = { state: 'none' };
    this.lastZSound = 0;
    this.puTex = {};
  }

  // ----- lifecycle -----
  start({ knife = 'knife' } = {}) {
    this.stop();
    this.running = true; this.phase = 'live'; this.time = 0;
    this.map.resetDoors();
    this.activeAreas = new Set(['A']);
    this.points = 500; this.kills = 0; this.headshots = 0; this.round = 0;
    this.perks = new Set(); this.effects = { instakill: 0, double: 0 };
    this.powerupsThisRound = 0; this.killsSinceDrop = 0;
    this.interaction = null; this.rebuildT = 0; this.flowT = 0;
    const p = this.player = new Player(this, 'P');
    p.colliders = this.map.playerColliders;
    p.meleeName = knifeName(knife);
    p.spawn(PLAYER_START, 0);
    p.slots[2].reserve = 84;
    p.maxHealth = BASE_HEALTH; p.health = BASE_HEALTH; p.lastHurt = -10; p.downed = false;
    p.onFire = () => this.vm.fire(p.weapon.def.melee);
    p.onReload = () => this.sound.reload();
    p.onSwitch = () => this.sound.deploy();
    this.combatants = [p];
    this.vm.setTeam('P'); this.vm.setKnife(knife);
    const box = this.map.box;
    Object.assign(box, { state: 'idle', t: 0, open: 0, weapon: null });
    box.label.visible = false;
    this.betweenRounds = true; this.nextRoundAt = 2.5; this.toSpawn = 0;
    this.hud.zReset(this);
    this.hud.banner('TUNG TUNG ZOMBIES', 'Survive the night. Board the windows. Spend points to open doors.', 'T', 4);
  }

  stop() {
    this.running = false;
    for (const z of this.zombies) z.deactivate();
    for (const pu of this.powerups) this.scene.remove(pu.sprite, pu.glow);
    this.powerups = [];
  }

  // ----- interface used by Player / Combatant / HUD -----
  canBuy() { return false; }
  buy() {}
  emitNoise() {}
  useInfo() { return null; }
  aliveZombies() { let n = 0; for (const z of this.zombies) if (z.active && z.alive) n++; return n; }

  // ----- rounds -----
  startRound(r) {
    this.round = r;
    this.betweenRounds = false;
    this.toSpawn = zombieCount(r);
    this.spawnT = 1.5;
    this.powerupsThisRound = 0;
    this.hud.zRound(r, true);
    this.sound.zRoundStart();
  }

  endRound() {
    this.betweenRounds = true;
    this.nextRoundAt = this.time + 10;
    this.sound.zRoundEnd();
    this.hud.zRound(this.round, true);
    this.hud.center(`Round ${this.round} survived`, 3);
  }

  pickSpawn(big = false) {
    const p = this.player.body.pos;
    const all = [];
    if (!big) for (const w of this.map.windows) if (this.activeAreas.has(w.area)) all.push({ win: w, pos: w.spawn, weight: 2 });
    if (this.round >= 2 || big) for (const s of this.map.groundSpawns) if (this.activeAreas.has(s.area)) all.push({ pos: s.pos, weight: 1 });
    if (!all.length) return null;
    let pool = all.filter((s) => { const d = flat(s.pos, p); return d > 7 && d < 42; });
    if (!pool.length) pool = all.filter((s) => flat(s.pos, p) > 5);
    if (!pool.length) pool = all;
    const total = pool.reduce((a, s) => a + s.weight, 0);
    let r = Math.random() * total;
    for (const s of pool) { r -= s.weight; if (r <= 0) return s; }
    return pool[0];
  }

  getZombie() {
    let z = this.zombies.find((q) => !q.active);
    if (!z) { z = new Zombie(this); this.zombies.push(z); }
    return z;
  }

  // ----- combat -----
  fireBullet(shooter, origin, dir, def, extraPellet) {
    const range = 250;
    const wall = raycast(origin, dir, range, this.map.colliders, _hit);
    let hitT = wall ? wall.t : range;
    let wallInfo = wall ? { nx: wall.nx, ny: wall.ny, nz: wall.nz } : null;
    const gt = this.map.rayGround(origin, dir, hitT);
    if (gt !== null && gt < hitT) { hitT = gt; wallInfo = { nx: 0, ny: 1, nz: 0 }; }
    let victim = null, part = null;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      const r = z.rayHit(origin, dir, hitT);
      if (r && r.t < hitT) { hitT = r.t; victim = z; part = r.part; }
    }
    _end.copy(origin).addScaledVector(dir, hitT);
    if (victim) {
      const mult = part === 'head' ? (def.headMult || 4) : part === 'leg' ? 0.75 : 1;
      let dmg = def.damage * mult * Math.pow(def.falloff || 1, hitT / 10);
      if (this.perks.has('dtap')) dmg *= 1.33;
      this.damageZombie(victim, dmg, part === 'head', false, extraPellet);
      this.fx.burst(_end, 0xc9a06a, 5, 3); // wood splinters
    } else if (wallInfo) {
      this.fx.impact(_end, wallInfo);
    }
    if (def.splash) {
      for (const z of this.zombies) {
        if (!z.active || !z.alive || z === victim) continue;
        z.chestPos(_v2);
        const d = _v2.distanceTo(_end);
        if (d < def.splash.radius) this.damageZombie(z, def.splash.damage * (1 - d / def.splash.radius * 0.6), false, false, true);
      }
      this.fx.burst(_end, def.pap ? 0xff60ff : 0x50ff70, 22, 6);
    }
    _v.set(0.18, -0.15, 0).applyEuler(this.camera.rotation).add(origin);
    if (def.tracer) this.fx.tracer(_v, _end, def.tracer);
    else if (!extraPellet && Math.random() < 0.35) this.fx.tracer(_v, _end);
  }

  melee(att) {
    att.eyePos(_v);
    dirFrom(att.yaw, att.pitch, _d);
    this.sound.knife(att.body.pos);
    let best = null, bd = 2.4;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      z.chestPos(_v2);
      const to = _v2.sub(_v), d = to.length();
      if (d > bd || to.normalize().dot(_d) < 0.65) continue;
      best = z; bd = d;
    }
    if (best) {
      this.damageZombie(best, 150, false, true);
      best.chestPos(_v2); this.fx.burst(_v2, 0xc9a06a, 10, 4);
      best.body.vel.addScaledVector(_d.setY(0).normalize(), 4);
    }
  }

  onShot(c, def) {
    this.sound.shot(def.sound, null);
    this.camera.getWorldPosition(_v);
    this.fx.flash(_v);
  }

  damageZombie(z, dmg, head, melee, quiet) {
    if (!z.alive) return;
    if (this.effects.instakill > 0) dmg = z.health + 1;
    z.health -= dmg;
    if (!quiet || z.health <= 0) { this.hud.hit(head); this.sound.hit(head); }
    if (z.health <= 0) this.killZombie(z, head, melee, false);
    else if (!quiet) this.addPoints(10);
  }

  killZombie(z, head, melee, nuked) {
    z.alive = false; z.state = 'dead'; z.deathT = 0; z.deathTilt = (Math.random() - 0.5) * 0.6;
    z.attackT = 0;
    this.kills++;
    if (head) this.headshots++;
    if (!nuked) {
      this.addPoints(z.big ? 250 : melee ? 130 : head ? 100 : 60);
      this.maybeDropPowerup(z.body.pos);
    }
  }

  addPoints(n) {
    const v = n * (this.effects.double > 0 ? 2 : 1);
    this.points += v;
    this.hud.zPoints(v);
  }
  spend(cost) {
    if (this.points < cost) { this.sound.denied(); this.hud.center('Not enough points', 1.2); return false; }
    this.points -= cost;
    this.hud.zPoints(-cost);
    return true;
  }

  hurtPlayer(dmg, z) {
    const p = this.player;
    if (!p.alive || p.downed || this.phase === 'over') return;
    p.health -= dmg;
    p.lastHurt = this.time;
    p.punch += 0.05;
    _d.set(p.body.pos.x - z.body.pos.x, 0, p.body.pos.z - z.body.pos.z).normalize();
    p.body.vel.addScaledVector(_d, 3);
    this.hud.damage(); this.sound.batHit();
    if (p.health <= 0) {
      if (this.perks.has('quick')) this.goDown();
      else this.gameOver();
    }
  }

  goDown() {
    const p = this.player;
    p.downed = true; p.health = 1; p.scoped = false; p.reloading = false;
    this.downT = 4.5;
    this.clearPerks();
    this.hud.center('DOWNED! Quick Revive is getting you up...', 4);
  }

  gameOver() {
    const p = this.player;
    p.health = 0; p.alive = false; p.scoped = false;
    this.phase = 'over'; this.overT = 3.5;
    this.hud.center('GAME OVER', 3.5);
    this.sound.roundEnd(false);
  }

  clearPerks() {
    const p = this.player;
    this.perks.clear();
    p.maxHealth = BASE_HEALTH; p.health = Math.min(p.health, BASE_HEALTH);
    p.reloadMul = 1; p.rateMul = 1;
  }

  applyPerk(id) {
    const p = this.player;
    this.perks.add(id);
    if (id === 'jugg') { p.maxHealth = JUGG_HEALTH; p.health = JUGG_HEALTH; }
    if (id === 'speed') p.reloadMul = 0.5;
    if (id === 'dtap') p.rateMul = 0.75;
  }

  // ----- weapons -----
  ownedSlot(key) {
    const p = this.player;
    for (const s of [1, 2]) if (p.slots[s] && p.slots[s].key === key) return s;
    return 0;
  }

  givePlayerWeapon(key) {
    const p = this.player;
    let slot = [1, 2].find((s) => !p.slots[s]);
    if (!slot) slot = (p.slot === 1 || p.slot === 2) ? p.slot : 1;
    p.give(key, slot);
    if (p.slot === slot) { p.reloading = false; p.recoil = 0; p.deployUntil = this.time + (WEAPONS[key].deploy || 0.5); p.onSwitch?.(); }
    else p.selectSlot(slot);
  }

  // ----- windows -----
  tearBoard(w) {
    if (w.boards <= 0) return;
    const m = w.boardMeshes[w.boards - 1];
    this.map.setBoards(w, w.boards - 1);
    this.sound.boardBreak(w.center);
    this.fx.burst(m.position, 0xa47a4c, 8, 3);
  }

  // ----- interactions: doors, windows, wall buys, perks, box, Pack-a-Punch -----
  findInteraction() {
    const p = this.player;
    if (!p.alive || p.downed) return null;
    const pos = p.body.pos, map = this.map;
    let best = null, bd = Infinity;
    const consider = (d, max, obj) => { if (d < max && d < bd) { bd = d; best = obj; } };
    for (const d of map.doors) if (!d.open) consider(flat(pos, d.center), 2.8, { type: 'door', d });
    for (const w of map.windows) if (w.boards < w.max && this.activeAreas.has(w.area)) consider(flat(pos, w.inside), 2.2, { type: 'window', w });
    for (const wb of map.wallBuys) consider(flat(pos, wb.at), 1.7, { type: 'wallbuy', wb });
    for (const pm of map.perkMachines) if (!this.perks.has(pm.id)) consider(flat(pos, pm.at), 1.7, { type: 'perk', pm });
    consider(flat(pos, map.pap.at), 1.9, { type: 'pap' });
    consider(flat(pos, map.box.at), 2.0, { type: 'box' });
    return best;
  }

  hintText() {
    const it = this.interaction, p = this.player;
    if (!it) {
      if (this.betweenRounds && this.phase !== 'over') {
        const left = Math.max(0, Math.ceil(this.nextRoundAt - this.time));
        return `Next wave in ${left}s — press N to start it now`;
      }
      return '';
    }
    switch (it.type) {
      case 'door': return `Press E to open the door [${it.d.cost}]`;
      case 'window': return 'Hold E to rebuild the barrier';
      case 'wallbuy': {
        const s = this.ownedSlot(it.wb.weapon);
        if (s) return `Press E to buy ammo [${p.slots[s].def.pap ? 4500 : it.wb.cost / 2}]`;
        return `Press E to buy ${it.wb.def.name} [${it.wb.cost}]`;
      }
      case 'perk': return `Press E to drink ${it.pm.name} [${it.pm.cost}]`;
      case 'pap': {
        const w = p.weapon;
        if (!w || w.def.melee) return 'Pack-a-Punch: hold a gun to upgrade it';
        if (w.def.pap) return 'This weapon is already upgraded';
        return `Press E to Pack-a-Punch ${w.def.name} [${this.map.pap.cost}]`;
      }
      case 'box': {
        const b = this.map.box;
        if (b.state === 'idle') return `Press E for the Mystery Box [${b.cost}]`;
        if (b.state === 'ready') return `Press E to take ${WEAPONS[b.weapon].name}`;
        return '';
      }
    }
    return '';
  }

  use(it) {
    const p = this.player, map = this.map;
    switch (it.type) {
      case 'door':
        if (!this.spend(it.d.cost)) return;
        map.openDoor(it.d);
        for (const a of it.d.areas) this.activeAreas.add(a);
        this.sound.purchase(); this.sound.boardBreak(it.d.center);
        this.flowT = 0;
        break;
      case 'wallbuy': {
        const wb = it.wb, s = this.ownedSlot(wb.weapon);
        if (s) {
          const w = p.slots[s];
          if (w.reserve >= w.def.reserve) { this.hud.center('Ammo is already full', 1); return; }
          if (!this.spend(w.def.pap ? 4500 : wb.cost / 2)) return;
          w.reserve = w.def.reserve;
        } else {
          if (!this.spend(wb.cost)) return;
          this.givePlayerWeapon(wb.weapon);
        }
        this.sound.purchase();
        break;
      }
      case 'perk':
        if (!this.spend(it.pm.cost)) return;
        this.applyPerk(it.pm.id);
        this.sound.perk();
        this.hud.center(`${it.pm.name}!`, 2);
        break;
      case 'pap': {
        const w = p.weapon;
        if (!w || w.def.melee || w.def.pap) { this.sound.denied(); return; }
        if (!this.spend(map.pap.cost)) return;
        w.def = papDef(w.def); w.mag = w.def.mag; w.reserve = w.def.reserve;
        p.deployUntil = this.time + 1.0; p.reloading = false;
        this.sound.perk();
        this.hud.center(`${w.def.name}!`, 2.5);
        break;
      }
      case 'box': {
        const b = map.box;
        if (b.state === 'idle') {
          if (!this.spend(b.cost)) return;
          Object.assign(b, { state: 'rolling', t: 0, nextSwap: 0 });
          b.label.visible = true;
          this.sound.boxRoll();
        } else if (b.state === 'ready') {
          this.givePlayerWeapon(b.weapon);
          this.sound.purchase();
          b.state = 'idle'; b.label.visible = false;
        }
        break;
      }
    }
  }

  updateInteract(dt) {
    const inp = this.input;
    this.interaction = this.findInteraction();
    const it = this.interaction;
    if (!it) { this.rebuildT = 0; return; }
    if (it.type === 'window') {
      if (inp.down('KeyE')) {
        this.rebuildT += dt;
        if (this.rebuildT >= 0.55) {
          this.rebuildT = 0;
          this.map.setBoards(it.w, it.w.boards + 1);
          this.addPoints(10);
          this.sound.boardFix();
        }
      } else this.rebuildT = 0;
    } else if (inp.pressed('KeyE')) this.use(it);
  }

  updateBox(dt) {
    const b = this.map.box;
    const target = b.state === 'idle' ? 0 : 1;
    b.open += (target - b.open) * Math.min(1, dt * 6);
    b.lid.rotation.x = -b.open * 1.7;
    b.beam.material.opacity = 0.12 + Math.sin(this.time * 3) * 0.05;
    if (b.state === 'rolling') {
      b.t += dt;
      b.label.position.y = 1.0 + Math.min(1, b.t / 1.5) * 0.9;
      if (this.time >= b.nextSwap) {
        const k = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)][0];
        this.map.setBoxLabel(WEAPONS[k].name);
        b.nextSwap = this.time + 0.07 + b.t * 0.05;
      }
      if (b.t >= 3.6) {
        const pool = BOX_WEAPONS.filter(([k]) => !this.ownedSlot(k));
        const total = pool.reduce((a, [, w]) => a + w, 0);
        let r = Math.random() * total;
        b.weapon = pool[0][0];
        for (const [k, w] of pool) { r -= w; if (r <= 0) { b.weapon = k; break; } }
        this.map.setBoxLabel(WEAPONS[b.weapon].name, b.weapon === 'raygun' ? '#7dff8a' : '#ffd36a');
        b.state = 'ready'; b.t = 0;
      }
    } else if (b.state === 'ready') {
      b.t += dt;
      b.label.position.y = 1.9 + Math.sin(this.time * 3) * 0.05;
      if (b.t > 9) { b.state = 'idle'; b.label.visible = false; }
    }
  }

  // ----- power-ups -----
  powerTexture(type) {
    if (this.puTex[type]) return this.puTex[type];
    const info = POWERUPS[type];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16210f'; ctx.strokeStyle = info.color; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = info.color; ctx.font = '700 34px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.short, 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (this.puTex[type] = t);
  }

  glowTex() {
    if (this._glow) return this._glow;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return (this._glow = new THREE.CanvasTexture(c));
  }

  maybeDropPowerup(pos) {
    this.killsSinceDrop++;
    const chance = 0.02 + Math.min(0.06, this.killsSinceDrop * 0.0015);
    if (this.powerupsThisRound >= 4 || Math.random() > chance) return;
    this.killsSinceDrop = 0; this.powerupsThisRound++;
    const types = Object.keys(POWERUPS);
    const type = types[Math.floor(Math.random() * types.length)];
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.powerTexture(type), transparent: true, depthWrite: false }));
    sprite.scale.set(0.9, 0.9, 1);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: POWERUPS[type].color, map: this.glowTex(), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.8, 1.8, 1);
    const p = new THREE.Vector3(pos.x, pos.y + 1.1, pos.z);
    sprite.position.copy(p); glow.position.copy(p);
    this.scene.add(glow, sprite);
    this.powerups.push({ type, pos: p, sprite, glow, t: 0 });
    this.sound.powerSpawn(p);
  }

  applyPowerup(type) {
    const p = this.player, info = POWERUPS[type];
    this.sound.powerGrab();
    this.hud.banner(info.label, '', 'T', 2);
    if (type === 'maxammo') for (const s of [1, 2]) { const w = p.slots[s]; if (w) w.reserve = w.def.reserve; }
    if (type === 'instakill') this.effects.instakill = 30;
    if (type === 'double') this.effects.double = 30;
    if (type === 'carpenter') { for (const w of this.map.windows) this.map.setBoards(w, w.max); this.addPoints(200); }
    if (type === 'nuke') {
      this.sound.nuke(); this.hud.flash();
      for (const z of this.zombies) if (z.active && z.alive) this.killZombie(z, false, false, true);
      this.addPoints(400);
    }
  }

  updatePowerups(dt) {
    const p = this.player;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.t += dt;
      const y = pu.pos.y + Math.sin(pu.t * 3) * 0.12;
      pu.sprite.position.y = y; pu.glow.position.y = y;
      const blink = pu.t > 20 && Math.floor(pu.t * 6) % 2 === 0;
      pu.sprite.visible = pu.glow.visible = !blink;
      const take = p.alive && !p.downed && flat(pu.pos, p.body.pos) < 1.4 && Math.abs(pu.pos.y - 1.1 - p.body.pos.y) < 2;
      if (take || pu.t > 27) {
        if (take) this.applyPowerup(pu.type);
        this.scene.remove(pu.sprite, pu.glow);
        this.powerups.splice(i, 1);
      }
    }
    for (const k of ['instakill', 'double']) this.effects[k] = Math.max(0, this.effects[k] - dt);
  }

  zombieSound(z) {
    if (this.time - this.lastZSound < 0.35) return;
    if (flat(z.body.pos, this.player.body.pos) > 32) return;
    this.lastZSound = this.time;
    if (Math.random() < 0.35) this.sound.tung(z.body.pos, z.big ? 0.7 : 0.45); else this.sound.groan(z.body.pos, z.big ? 0.55 : 1);
  }

  separate() {
    const zs = this.zombies.filter((z) => z.active && z.alive && z.state === 'chase');
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i].body.pos;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j].body.pos;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const minD = 0.33 * (zs[i].scale + zs[j].scale);
        if (d > 0.001 && d < minD) {
          const push = (minD - d) / 2, nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        }
      }
    }
    const p = this.player;
    if (!p.alive) return;
    const pp = p.body.pos;
    for (const z of zs) {
      const zp = z.body.pos;
      const dx = zp.x - pp.x, dz = zp.z - pp.z, d = Math.hypot(dx, dz);
      const minD = 0.4 + 0.35 * z.scale;
      if (d > 0.001 && d < minD && Math.abs(zp.y - pp.y) < 1.5) {
        const push = minD - d, nx = dx / d, nz = dz / d;
        zp.x += nx * push * 0.7; zp.z += nz * push * 0.7;
        if (!p.downed) { pp.x -= nx * push * 0.3; pp.z -= nz * push * 0.3; }
      }
    }
  }

  // Per rendered frame: aim with the mouse (also while downed).
  frame() { if (this.player && this.phase !== 'over') this.player.look(); }

  // Per rendered frame: place the camera and zombie models between the last two physics ticks.
  interpolate(alpha) {
    for (const z of this.zombies) if (z.active && z.alive) z.renderPos(z.model.root.position, alpha);
    this.updateCamera(alpha);
    this.sound.setListener(this.camera.position, this.player.yaw);
  }

  updateCamera(alpha = 1) {
    const p = this.player, cam = this.camera;
    p.renderEye(cam.position, alpha);
    let roll = 0;
    if (this.phase === 'over') { cam.position.y = p.body.pos.y + 0.4; roll = 0.5; }
    cam.rotation.set(p.pitch + p.punch, p.yaw, roll);
    const fov = p.scoped && p.alive ? this.scopeFov : this.baseFov;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  updateDowned(dt) {
    const p = this.player;
    p.eyeH += (0.55 - p.eyeH) * Math.min(1, dt * 6);
    p.applyMovement(dt, 0, 0, 1, false);
    this.downT -= dt;
    if (this.downT <= 0) {
      p.downed = false; p.health = p.maxHealth; p.eyeH = 1.65; p.lastHurt = this.time;
      this.hud.center('Revived!', 1.5);
    }
  }

  // ----- main update -----
  // One physics tick.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    const p = this.player;
    p.prevPos.copy(p.body.pos);
    for (const z of this.zombies) if (z.active) z.prevPos.copy(z.body.pos);

    if (this.phase === 'over') {
      this.overT -= dt;
      for (const z of this.zombies) if (z.active) { if (z.alive) z.animate(dt, 0.4); else z.updateDead(dt); }
      if (this.overT <= 0) {
        this.running = false;
        this.onGameOver?.({ round: this.round, kills: this.kills, headshots: this.headshots, points: this.points });
      }
      return;
    }

    if (this.betweenRounds && this.input.pressed('KeyN') && this.time < this.nextRoundAt) this.nextRoundAt = this.time;
    if (this.betweenRounds && this.time >= this.nextRoundAt) this.startRound(this.round + 1);
    if (!this.betweenRounds) {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && this.spawnT <= 0 && this.aliveZombies() < MAX_ALIVE) {
        const bigAlive = this.zombies.reduce((n, z) => n + (z.active && z.alive && z.big ? 1 : 0), 0);
        const big = bigAlive < 3 && Math.random() < bigChance(this.round);
        const sp = this.pickSpawn(big) || this.pickSpawn(false);
        if (sp) { this.getZombie().spawn(sp, this.round, big && !sp.win); this.toSpawn--; }
        this.spawnT = Math.max(0.35, 2.0 - this.round * 0.12) * (0.6 + Math.random() * 0.8);
      }
    }

    if (p.downed) this.updateDowned(dt);
    else p.update(dt);
    p.updateWeapon(dt);
    if (!p.downed && p.health < p.maxHealth && this.time - p.lastHurt > 3.5) p.health = Math.min(p.maxHealth, p.health + 80 * dt);

    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.25; this.map.computeFlow(p.body.pos); }
    for (const z of this.zombies) if (z.active) z.update(dt);
    this.separate();
    this.updateInteract(dt);
    this.updatePowerups(dt);
    this.updateBox(dt);
    this.map.updateDoors(dt);

    if (!this.betweenRounds && this.toSpawn === 0 && this.aliveZombies() === 0) this.endRound();
  }
}
