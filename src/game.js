// Match rules: rounds, economy, bomb, shooting resolution, spectating and camera.
import * as THREE from 'three';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Director } from './director.js';
import { SPAWNS, SPAWN_CENTER } from './map.js';
import { WEAPONS, ARMOR_PRICE, BUY_ITEMS } from './weapons.js';
import { raycast } from './physics.js';
import { dirFrom } from './combatant.js';
import { knifeName } from './viewmodel.js';

const FREEZE_TIME = 5;
const ROUND_TIME = 115;
const BUY_TIME = 20;
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const END_DELAY = 5;
const NAMES = {
  T: ['Viper', 'Rook', 'Jackal', 'Nomad', 'Brick'],
  CT: ['Falcon', 'Ghost', 'Atlas', 'Hawk', 'Mason'],
};

const _hit = {}, _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _end = new THREE.Vector3(), _d = new THREE.Vector3();

export class Game {
  constructor({ scene, camera, map, hud, sound, fx, input, vm, settings }) {
    Object.assign(this, { scene, camera, map, hud, sound, fx, input, vm, settings });
    this.time = 0;
    this.baseFov = 74; this.scopeFov = 22;
    this.combatants = []; this.bots = []; this.player = null;
    this.director = new Director(this);
    this.bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), explodeAt: 0, site: null, nextBeep: 0 };
    this.bombMesh = this.makeBombMesh();
    this.running = false;
    this.spectating = null;
  }

  makeBombMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.24), new THREE.MeshLambertMaterial({ color: 0x3b3a30 }));
    body.position.y = 0.06; body.castShadow = true; g.add(body);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    pad.position.set(-0.05, 0.13, 0); g.add(pad);
    this.bombLed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
    this.bombLed.position.set(0.1, 0.135, 0.05); g.add(this.bombLed);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // ---------- setup ----------
  start({ team, difficulty, roundsToWin, knife = 'knife' }) {
    this.stop();
    this.time = 0;
    this.roundsToWin = roundsToWin;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.player = new Player(this, team);
    this.player.meleeName = knifeName(knife);
    this.vm.setKnife(knife);
    this.player.onFire = () => this.vm.fire(this.player.weapon.def.melee);
    this.player.onReload = () => this.sound.reload();
    this.player.onSwitch = () => this.sound.deploy();
    this.combatants = [this.player];
    this.bots = [];
    for (const t of ['T', 'CT']) {
      const names = NAMES[t].slice();
      const count = t === team ? 4 : 5;
      for (let i = 0; i < count; i++) {
        // your teammates are green, the enemy team is red
        const b = new Bot(this, names[i], t, difficulty, t === team ? 'friend' : 'enemy');
        if (t === team) b.addMarker('#7ddf5a');
        this.bots.push(b); this.combatants.push(b);
      }
    }
    this.vm.setTeam(team);
    this.matchOver = false;
    this.running = true;
    this.hud.clearFeed();
    this.startRound();
  }

  stop() {
    for (const b of this.bots) b.dispose();
    this.bots = []; this.combatants = [];
    this.running = false;
    this.bombMesh.visible = false;
  }

  startRound() {
    this.round++;
    this.fx.clear();
    const spawnList = { T: SPAWNS.T.slice().sort(() => Math.random() - 0.5), CT: SPAWNS.CT.slice().sort(() => Math.random() - 0.5) };
    const idx = { T: 0, CT: 0 };
    for (const c of this.combatants) {
      const pos = spawnList[c.team][idx[c.team]++ % 5];
      c.spawn(pos, c.team === 'T' ? 0 : Math.PI);
    }
    // bot purchases
    for (const b of this.bots) this.botBuy(b);
    // bomb
    const ts = this.combatants.filter((c) => c.team === 'T');
    const carrier = ts[Math.floor(Math.random() * ts.length)];
    carrier.hasBomb = true;
    Object.assign(this.bomb, { state: 'carried', carrier, site: null, defuser: null });
    this.bombMesh.visible = false;
    this.phase = 'freeze';
    this.phaseEnd = this.time + FREEZE_TIME;
    this.liveStart = this.phaseEnd;
    this.roundEnd = this.phaseEnd + ROUND_TIME;
    this.spectating = null;
    this.player.buyOpen = false;
    this.director.planRound();
    this.hud.banner(`Round ${this.round}`, carrier === this.player ? 'You have the bomb. Plant it at A or B.' : 'Buy time. Press B to buy.', this.player.team, 2.5);
    this.sound.roundStart();
  }

  botBuy(b) {
    const rifle = b.team === 'T' ? 'ak' : 'm4';
    const hasPrimary = !!b.slots[1];
    let m = b.money;
    if (!hasPrimary) {
      const snipers = this.bots.filter((o) => o.team === b.team && o.slots[1]?.key === 'sniper').length;
      if (m >= WEAPONS.sniper.price + ARMOR_PRICE && snipers === 0 && Math.random() < 0.3) { b.give('sniper'); m -= WEAPONS.sniper.price; }
      else if (m >= WEAPONS[rifle].price + ARMOR_PRICE || (m >= WEAPONS[rifle].price && b.armor > 0)) { b.give(rifle); m -= WEAPONS[rifle].price; }
      else if (m >= 2000 && Math.random() < 0.6) { b.give('smg'); m -= WEAPONS.smg.price; }
    }
    if (b.armor < 50 && m >= ARMOR_PRICE + 200) { b.armor = 100; m -= ARMOR_PRICE; }
    b.money = m;
    b.selectSlot(b.slots[1] ? 1 : 2, true);
  }

  canBuy(c) {
    if (!c.alive) return false;
    if (this.phase !== 'freeze' && !(this.phase === 'live' && this.time < this.buyEnd())) return false;
    return c.body.pos.distanceTo(SPAWN_CENTER[c.team]) < 18;
  }
  buyEnd() { return this.liveStart + BUY_TIME; }

  buy(c, index) {
    const item = BUY_ITEMS[index];
    if (!item || !this.canBuy(c)) return;
    const price = item.price(c.team);
    if (item.id === 'armor') {
      if (c.armor >= 100) return;
      if (c.money < price) { this.hud.center('Not enough money', 1); return; }
      c.money -= price; c.armor = 100; this.sound.buy(); return;
    }
    const key = item.id === 'rifle' ? (c.team === 'T' ? 'ak' : 'm4') : item.id;
    if (c.slots[1]?.key === key) return;
    if (c.money < price) { this.hud.center('Not enough money', 1); return; }
    c.money -= price;
    c.give(key);
    c.selectSlot(1, false);
    this.sound.buy();
  }

  aliveCount(team) { let n = 0; for (const c of this.combatants) if (c.alive && c.team === team) n++; return n; }

  // ---------- shooting ----------
  lineClear(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    _d.divideScalar(len);
    return !raycast(a, _d, len, this.map.colliders, _hit);
  }

  fireBullet(shooter, origin, dir, def) {
    const range = 300;
    const wall = raycast(origin, dir, range, this.map.colliders, _hit);
    let hitT = wall ? wall.t : range;
    const wallInfo = wall ? { nx: wall.nx, ny: wall.ny, nz: wall.nz } : null;
    let victim = null, part = null;
    for (const c of this.combatants) {
      if (c === shooter || !c.alive || c.team === shooter.team) continue;
      const r = c.rayHit(origin, dir, hitT);
      if (r && r.t < hitT) { hitT = r.t; victim = c; part = r.part; }
    }
    _end.copy(origin).addScaledVector(dir, hitT);
    if (victim) {
      const mult = part === 'head' ? (def.headMult || 4) : part === 'leg' ? 0.75 : 1;
      const dmg = def.damage * mult * Math.pow(def.falloff || 1, hitT / 10);
      this.applyDamage(victim, shooter, dmg, def, part === 'head', dir);
      this.fx.blood(_end, dir);
    } else if (wallInfo) {
      this.fx.impact(_end, wallInfo);
    }
    // tracer from roughly where the gun is
    if (shooter === this.player) {
      if (Math.random() < 0.4) {
        _v.set(0.18, -0.15, 0).applyEuler(this.camera.rotation).add(origin);
        this.fx.tracer(_v, _end);
      }
    } else {
      this.fx.tracer(origin, _end);
      // bullet passing close to the player's head
      const p = this.player;
      if (p.alive && shooter.team !== p.team && victim !== p) {
        p.eyePos(_v2);
        const t = _v.subVectors(_v2, origin).dot(dir);
        if (t > 0 && t < hitT) {
          const closest = _v.copy(origin).addScaledVector(dir, t);
          if (closest.distanceTo(_v2) < 1.2) this.sound.whiz(closest);
        }
      }
    }
  }

  melee(att) {
    att.eyePos(_v);
    dirFrom(att.yaw, att.pitch, _d);
    this.sound.knife(att.body.pos);
    let best = null, bd = 2.3;
    for (const c of this.combatants) {
      if (!c.alive || c.team === att.team) continue;
      c.chestPos(_v2);
      const to = _v2.sub(_v);
      const d = to.length();
      if (d > bd) continue;
      if (to.normalize().dot(_d) < 0.75) continue;
      best = c; bd = d;
    }
    if (best) {
      // backstab if the attacker is behind the victim
      const fx = -Math.sin(best.yaw), fz = -Math.cos(best.yaw);
      const dx = best.body.pos.x - att.body.pos.x, dz = best.body.pos.z - att.body.pos.z;
      const behind = (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1) > 0.5;
      this.applyDamage(best, att, behind ? 180 : WEAPONS.knife.damage, WEAPONS.knife, false, _d);
      best.chestPos(_v2); this.fx.blood(_v2, _d);
    }
  }

  applyDamage(victim, attacker, raw, def, headshot, dir) {
    if (!victim.alive) return;
    let dmg = raw;
    if (victim.armor > 0 && !def.melee) {
      const pen = def.armorPen ?? 0.75;
      const absorbed = dmg * (1 - pen);
      victim.armor = Math.max(0, victim.armor - absorbed * 0.5);
      dmg -= absorbed;
    }
    dmg = Math.max(1, Math.round(dmg));
    victim.health -= dmg;
    victim.lastAttacker = attacker;
    victim.onDamaged?.(attacker, dmg, dir);
    if (attacker === this.player) { this.hud.hit(headshot); this.sound.hit(headshot); }
    if (victim === this.player) {
      this.hud.damage(); this.sound.hurt();
      victim.punch += 0.02; // aim punch
    }
    // slow down on hit (tagging)
    victim.body.vel.x *= 0.5; victim.body.vel.z *= 0.5;
    if (victim.health <= 0) this.kill(victim, attacker, def, headshot);
  }

  kill(victim, attacker, def, headshot) {
    victim.health = 0; victim.alive = false; victim.deaths++;
    victim.useProgress = 0; victim.scoped = false;
    victim.onDeath?.();
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + (def.reward ?? 300));
    }
    if (victim.hasBomb) this.dropBomb(victim);
    const mine = attacker === this.player || victim === this.player;
    const wname = def.key === 'knife' && attacker ? attacker.meleeName : def.name;
    this.hud.killfeed(attacker, victim, wname, headshot, mine);
    if (victim === this.player) {
      this.hud.center(attacker ? `Killed by ${attacker.name}${headshot ? ' (headshot)' : ''}` : 'You died', 3);
      this.player.buyOpen = false;
      this.spectating = this.nextSpectate(null);
    } else if (this.spectating === victim) {
      this.spectateSwitchAt = this.time + 1.5;
    }
  }

  onShot(c, def) {
    this.sound.shot(def.sound, c === this.player ? null : c.body.pos);
    this.emitNoise(c.body.pos, 45, c);
    if (c === this.player) {
      this.camera.getWorldPosition(_v);
      this.fx.flash(_v);
    }
  }

  emitNoise(pos, radius, src) {
    for (const b of this.bots) {
      if (b === src || !b.alive) continue;
      if (b.body.pos.distanceTo(pos) < radius) b.hear(pos, src);
    }
  }

  // ---------- bomb ----------
  dropBomb(c) {
    c.hasBomb = false;
    const b = this.bomb;
    b.state = 'dropped'; b.carrier = null;
    b.pos.set(c.body.pos.x, c.body.pos.y, c.body.pos.z);
    this.bombMesh.position.copy(b.pos);
    this.bombMesh.visible = true;
    this.director.onDropped(b.pos);
  }

  plant(c) {
    const b = this.bomb;
    c.hasBomb = false; c.useProgress = 0;
    b.state = 'planted'; b.carrier = null;
    b.pos.set(c.body.pos.x, c.body.pos.y, c.body.pos.z);
    b.site = this.map.inSite(b.pos);
    b.explodeAt = this.time + BOMB_TIME;
    b.nextBeep = this.time;
    this.bombMesh.position.copy(b.pos);
    this.bombMesh.rotation.y = Math.random() * Math.PI;
    this.bombMesh.visible = true;
    c.money = Math.min(16000, c.money + 300);
    this.hud.banner('The bomb has been planted', `Site ${b.site}`, 'T', 3);
    this.director.onPlanted(b.site, b.pos);
  }

  defuse(c) {
    const b = this.bomb;
    b.state = 'defused';
    c.money = Math.min(16000, c.money + 300);
    this.endRound('CT', 'Bomb defused');
  }

  explode() {
    const b = this.bomb;
    b.state = 'exploded';
    this.bombMesh.visible = false;
    this.fx.explosion(_v.copy(b.pos).setY(b.pos.y + 0.5));
    this.sound.explosion(b.pos);
    for (const c of this.combatants) {
      if (!c.alive) continue;
      const d = c.body.pos.distanceTo(b.pos);
      if (d < 26) {
        const dmg = 500 * Math.pow(1 - d / 26, 1.6);
        if (dmg > 1) this.applyDamage(c, null, dmg, { name: 'Bomb', melee: true, reward: 0 }, false, _d.set(0, 1, 0));
      }
    }
    this.endRound('T', 'Target destroyed');
  }

  updateBomb(dt) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      for (const c of this.combatants) {
        if (!c.alive || c.team !== 'T') continue;
        if (Math.hypot(c.body.pos.x - b.pos.x, c.body.pos.z - b.pos.z) < 1.0 && Math.abs(c.body.pos.y - b.pos.y) < 1.5) {
          c.hasBomb = true; b.state = 'carried'; b.carrier = c;
          this.bombMesh.visible = false;
          if (c === this.player) { this.sound.pickup(); this.hud.center('You picked up the bomb', 2); }
          this.director.onPickedUp(c);
          break;
        }
      }
    }
    // plant / defuse progress
    for (const c of this.combatants) {
      if (!c.alive) { c.useProgress = 0; continue; }
      let ok = false;
      if (c.wantsUse && this.phase === 'live') {
        if (c.team === 'T' && c.hasBomb && c.body.onGround && this.map.inSite(c.body.pos)) ok = 'plant';
        else if (c.team === 'CT' && b.state === 'planted' && c.body.pos.distanceTo(b.pos) < 1.6) ok = 'defuse';
      }
      if (!ok) { c.useProgress = 0; continue; }
      const prev = c.useProgress;
      c.useProgress += dt;
      if (c === this.player && Math.floor(prev * 3) !== Math.floor(c.useProgress * 3)) this.sound.plantTick();
      if (ok === 'plant' && c.useProgress >= PLANT_TIME) this.plant(c);
      if (ok === 'defuse' && c.useProgress >= DEFUSE_TIME) { c.useProgress = 0; this.defuse(c); }
    }
    if (b.state === 'planted') {
      const left = b.explodeAt - this.time;
      const blink = Math.floor(this.time * (left < 10 ? 6 : 2)) % 2 === 0;
      this.bombLed.visible = blink;
      if (this.time >= b.nextBeep && this.phase === 'live') {
        this.sound.beep(b.pos);
        b.nextBeep = this.time + Math.max(0.12, Math.min(1, left / 30));
      }
      if (left <= 0 && this.phase === 'live') this.explode();
    }
  }

  useInfo() {
    const p = this.player;
    if (!p.alive || p.useProgress <= 0) return null;
    if (p.team === 'T') return { label: 'PLANTING', frac: p.useProgress / PLANT_TIME };
    return { label: 'DEFUSING', frac: p.useProgress / DEFUSE_TIME };
  }

  hintText() {
    const p = this.player, b = this.bomb;
    if (!p.alive) return '';
    if (p.team === 'T' && p.hasBomb && this.phase === 'live' && this.map.inSite(p.body.pos) && p.useProgress === 0) return 'Hold E to plant the bomb';
    if (p.team === 'CT' && b.state === 'planted' && p.body.pos.distanceTo(b.pos) < 1.6 && p.useProgress === 0) return 'Hold E to defuse';
    if (this.canBuy(p) && !p.buyOpen && this.phase === 'freeze') return 'Press B to buy';
    return '';
  }

  // ---------- rounds ----------
  endRound(winner, reason) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.phaseEnd = this.time + END_DELAY;
    this.score[winner]++;
    const loser = winner === 'T' ? 'CT' : 'T';
    const bonus = reason === 'Bomb defused' || reason === 'Target destroyed' ? 3500 : 3250;
    const lossBonus = Math.min(3400, 1400 + 500 * this.lossStreak[loser]);
    this.lossStreak[winner] = 0; this.lossStreak[loser]++;
    for (const c of this.combatants) {
      let add = c.team === winner ? bonus : lossBonus;
      if (c.team === 'T' && loser === 'T' && this.bomb.state === 'planted') add += 800;
      c.money = Math.min(16000, c.money + add);
    }
    const title = winner === 'CT' ? 'Counter-Terrorists Win' : 'Terrorists Win';
    this.hud.banner(title, reason, winner, END_DELAY);
    this.sound.roundEnd(winner === this.player.team);
    this.player.buyOpen = false;
    if (this.score[winner] >= this.roundsToWin) this.matchOver = winner;
  }

  checkWin() {
    if (this.phase !== 'live') return;
    const t = this.aliveCount('T'), ct = this.aliveCount('CT');
    const planted = this.bomb.state === 'planted';
    if (ct === 0) return this.endRound('T', 'All enemies eliminated');
    if (t === 0 && !planted) return this.endRound('CT', 'All enemies eliminated');
    if (!planted && this.time >= this.roundEnd) return this.endRound('CT', 'Time ran out');
  }

  // ---------- spectating & camera ----------
  nextSpectate(current) {
    const p = this.player;
    const mates = this.combatants.filter((c) => c.alive && c !== p && c.team === p.team);
    const pool = mates.length ? mates : this.combatants.filter((c) => c.alive && c !== p);
    if (!pool.length) return null;
    const i = pool.indexOf(current);
    return pool[(i + 1) % pool.length];
  }

  updateSpectate() {
    if (this.player.alive) return;
    if (this.input.mouseHit(0) || (this.spectateSwitchAt && this.time >= this.spectateSwitchAt) || (this.spectating && !this.spectating.alive && !this.spectateSwitchAt)) {
      this.spectating = this.nextSpectate(this.spectating);
      this.spectateSwitchAt = 0;
    }
  }

  // Per rendered frame: aim with the mouse.
  frame() { this.player?.look(); }

  // Per rendered frame: place the camera and models between the last two physics ticks.
  interpolate(alpha) {
    for (const b of this.bots) if (b.alive) b.renderPos(b.model.root.position, alpha);
    this.updateCamera(alpha);
    this.sound.setListener(this.camera.position, this.player.alive ? this.player.yaw : this.camera.rotation.y);
  }

  updateCamera(alpha = 1) {
    const p = this.player, cam = this.camera;
    if (p.alive) {
      p.renderEye(cam.position, alpha);
      cam.rotation.set(p.pitch + p.punch, p.yaw, 0);
      const fov = p.scoped ? this.scopeFov : this.baseFov;
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      return;
    }
    if (cam.fov !== this.baseFov) { cam.fov = this.baseFov; cam.updateProjectionMatrix(); }
    const s = this.spectating;
    if (!s) return;
    // third-person chase camera
    s.renderEye(_v, alpha);
    dirFrom(s.yaw, s.pitch * 0.5, _d);
    const back = _v2.copy(_d).negate();
    back.y += 0.25; back.normalize();
    const hit = raycast(_v, back, 3.2, this.map.colliders, _hit);
    const dist = hit ? Math.max(0.3, hit.t - 0.3) : 3.2;
    cam.position.copy(_v).addScaledVector(back, dist);
    cam.rotation.set(s.pitch * 0.5 - 0.08, s.yaw, 0);
  }

  // ---------- main update ----------
  // One physics tick.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    for (const c of this.combatants) c.prevPos.copy(c.body.pos);
    if (this.phase === 'freeze' && this.time >= this.phaseEnd) {
      this.phase = 'live';
      this.hud.center('GO GO GO', 1.2);
    } else if (this.phase === 'end' && this.time >= this.phaseEnd) {
      if (this.matchOver) { this.running = false; this.onMatchOver?.(this.matchOver); return; }
      this.startRound();
    }

    this.player.update(dt);
    for (const b of this.bots) b.update(dt);
    this.separate();
    this.updateBomb(dt);
    this.checkWin();
    this.updateSpectate();
    this.player.updateWeapon(dt);
  }

  separate() {
    const cs = this.combatants;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]; if (!b.alive) continue;
        const dx = b.body.pos.x - a.body.pos.x, dz = b.body.pos.z - a.body.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.7 && Math.abs(a.body.pos.y - b.body.pos.y) < 1.5) {
          const push = (0.7 - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.body.pos.x -= nx * push; a.body.pos.z -= nz * push;
          b.body.pos.x += nx * push; b.body.pos.z += nz * push;
        }
      }
    }
  }
}
