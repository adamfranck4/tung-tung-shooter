// Zombies co-op on a joining player's browser. The host runs the zombies, doors, windows and
// power-ups; this side moves its own player, reports hits and button presses, and draws the
// shared world from the host's snapshots.
import * as THREE from 'three';
import { ZombiesGame, Zombie, unpackStash } from './zombies.js';
import { START_AREA, AREAS } from './zmap.js';
import { F, r1, r2, r3, packSlots, applyInventory, showShot } from './avatar.js';

const _v = new THREE.Vector3();
const PERK_IDS = new Set(['quick', 'speed', 'dtap', 'jugg']);

export class ZombiesClient extends ZombiesGame {
  startNet({ knife = 'knife', net, roster }) {
    this.stop();
    this.net = net; this.netDelay = 0.1;
    this.running = true; this.phase = 'live'; this.time = 0; this.synced = false;
    this.map.resetDoors();
    this.activeAreas = new Set([START_AREA]);
    this.round = 0;
    this.effects = { instakill: 0, double: 0 };
    this.interaction = null; this.spectating = null; this.mapOpen = false;
    this.setupPlayers(roster, net.myId, knife);
    this.player.spawnEpoch = 0; this.player.invVer = 0;
    this.betweenRounds = true; this.nextRoundAt = 0;
    this.ready = new Set(); this.statue.room = null; this.overWhy = null;
    this.syncUnlocks(0);
    this.hud.zReset(this);
    this.introBanner();
  }

  // One physics tick: only your own player is simulated here.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    const p = this.player;
    p.prevPos.copy(p.body.pos);
    for (const z of this.zombies) if (z.active) z.prevPos.copy(z.body.pos);
    for (const a of this.remotes) a.update(dt);
    for (const z of this.zombies) if (z.active) z.puppetUpdate(dt);
    this.updateProjectiles(dt, false);   // coconuts: the host decides who gets hit
    this.toggleMap();
    if (this.input.pressed('KeyI')) this.requestMenu('inv');
    if (this.phase === 'over') {
      this.overT -= dt;
      if (this.overT <= 0) { this.running = false; this.onGameOver?.(this.finalStats()); }
      return;
    }
    if (this.betweenRounds && this.input.pressed('KeyN')) this.net.emit({ e: 'next' });   // ready / not ready
    if (p.alive) {
      if (p.downed) { p.eyeH += (0.55 - p.eyeH) * Math.min(1, dt * 6); p.applyMovement(dt, 0, 0, 1, false); p.lastStand(dt); }
      else p.update(dt);
      p.updateWeapon(dt);
    }
    this.separate();
    this.updateInteract();
    this.animatePowerups(dt);
    this.map.updateDoors(dt);
    this.statue.animate(dt, this.time, this.camera.position);
    this.updateSpectate();
  }

  // keep yourself out of the zombies (they are placed by the host)
  separate() {
    const p = this.player;
    if (!p.alive || p.downed) return;
    const pp = p.body.pos;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      const zp = z.body.pos;
      const dx = zp.x - pp.x, dz = zp.z - pp.z, d = Math.hypot(dx, dz);
      const minD = 0.4 + 0.35 * z.scale;
      if (d > 0.001 && d < minD && Math.abs(zp.y - pp.y) < 1.5) {
        const push = (minD - d) * 0.5;
        pp.x -= dx / d * push; pp.z -= dz / d * push;
      }
    }
  }

  // Pressing E asks the host; holding E (boards, reviving) is sent with every state update.
  // (The Gun Shop menu opens right here; doors aren't bought, they open with the rounds.)
  updateInteract() {
    const p = this.player;
    this.interaction = this.findInteraction(p);
    const it = this.interaction;
    if (!it || !this.input.pressed('KeyE') || it.type === 'window' || it.type === 'revive' || it.type === 'door') return;
    if (it.type === 'shop') { this.use(it, p); return; }
    const req = { e: 'use', k: it.type };
    if (it.type === 'perk') req.id = it.pm.id;
    else if (it.type === 'pap') req.id = this.map.papStations.indexOf(it.st);
    else if (it.type === 'case') req.id = this.map.caseMachines.indexOf(it.cm);
    this.net.emit(req);
  }

  // Gun Shop and inventory actions: the host checks them (round, points, what you have) and
  // sends back what you carry and store
  invAct(ev) { if (ev && typeof ev.a === 'string') this.net.emit({ ...ev, e: 'iv' }); }

  // doors open with the rounds (the host also says so): no need to tell anyone
  openDoor(d) {
    if (d.open) return;
    this.map.openDoor(d);
    for (const a of d.areas) this.activeAreas.add(a);
    this.sound.boardBreak(d.center);
  }

  hitZombie(z, dmg, head, melee, quiet, attacker, knock) {
    if (attacker !== this.player) return;
    const ev = { e: 'zh', z: z.netId, d: r1(dmg), h: head ? 1 : 0, m: melee ? 1 : 0, q: quiet ? 1 : 0 };
    if (melee && knock) ev.k = [r2(knock.x), r2(knock.z)];
    this.net.emit(ev);
    if (!quiet) { this.hud.hit(head); this.sound.hit(head); }
  }

  // ---------- network ----------
  netUpdate(dt) { this.net.update(dt, () => this.stateMsg()); }

  stateMsg() {
    const p = this.player;
    let f = 0;
    if (p.alive) f |= F.ALIVE;
    if (p.crouching) f |= F.CROUCH;
    if (p.body.onGround) f |= F.GROUND;
    if (this.input.down('KeyE')) f |= F.USE;
    if (p.scoped) f |= F.SCOPE;
    return {
      ep: p.spawnEpoch || 0, p: [r2(p.body.pos.x), r2(p.body.pos.y), r2(p.body.pos.z)], y: r3(p.yaw), pi: r3(p.pitch), f,
      iv: p.invVer || 0, cur: p.slot, s: packSlots(p),
    };
  }

  onNet(from, msg) {
    if (!this.running) return;
    if (Array.isArray(msg.ev)) for (const ev of msg.ev) this.onHostEvent(ev);
    if (msg.s && this.running) this.applySnapshot(msg.s);
  }

  puppet(id) {
    while (this.zombies.length <= id) { const z = new Zombie(this); z.netId = this.zombies.length; this.zombies.push(z); }
    return this.zombies[id];
  }

  applySnapshot(s) {
    if (!this.synced || Math.abs(s.T - this.time) > 0.5) { this.time = s.T; this.synced = true; }
    else this.time += (s.T - this.time) * 0.1;
    if (this.phase === 'over') return;
    this.round = s.r; this.betweenRounds = !!s.br; this.nextRoundAt = s.nr;
    this.syncUnlocks(this.cleared());   // (in case a round-end message went missing)
    this.effects.instakill = s.ef[0]; this.effects.double = s.ef[1];
    // players
    for (const e of s.p) {
      const q = this.byNid(e[0]);
      if (!q) continue;
      const f = e[6], wasDown = q.downed;
      q.health = e[7]; q.maxHealth = e[8]; q.points = e[9]; q.kills = e[11];
      q.downT = e[12]; q.reviveFrac = e[13];
      q.downed = !!(f & F.DOWN);
      q.perks = new Set(String(e[10]).split(',').filter((x) => PERK_IDS.has(x)));
      if (q === this.player) {
        q.reloadMul = q.perks.has('speed') ? 0.5 : 1;
        q.rateMul = q.perks.has('dtap') ? 0.75 : 1;
        if (!wasDown && q.downed) { q.scoped = false; q.reloading = false; q.buyOpen = false; }
        if (wasDown && !q.downed && q.alive) q.eyeH = 1.65;
        if (q.alive && !(f & F.ALIVE)) { q.alive = false; q.downed = false; this.spectating = this.nextSpectate(null); }
        continue;
      }
      q.interp.push(s.T, e[1], e[2], e[3], e[4], e[5]);
      q.netFlags = f;
      q.show(e[14], e[15]);
      if (q.alive && !(f & F.ALIVE)) { q.alive = false; q.downed = false; q.onDeath(); }
    }
    // zombies
    const seen = new Set();
    for (const e of s.z) {
      const z = this.puppet(e[0]);
      seen.add(z);
      z.netUpdate(s.T, e);
    }
    for (const z of this.zombies) if (z.active && !seen.has(z)) z.deactivate();
    // window boards (a lost board breaks with a crack)
    for (let i = 0; i < this.map.windows.length; i++) {
      const w = this.map.windows[i], n = +s.wb[i];
      if (!Number.isFinite(n) || n === w.boards) continue;
      if (n < w.boards) { this.sound.boardBreak(w.center); this.fx.burst(w.boardMeshes[w.boards - 1].position, 0xa47a4c, 8, 3); }
      this.map.setBoards(w, n);
    }
    // power-ups
    const keep = new Set();
    for (const [id, type, x, y, z, t] of s.pu) {
      let pu = this.powerups.find((q) => q.id === id);
      if (!pu) { pu = this.addPowerup(id, type, new THREE.Vector3(x, y, z)); pu.t = t; }
      keep.add(pu);
    }
    for (const pu of this.powerups.slice()) if (!keep.has(pu)) this.removePowerup(pu);
    // the Golden Tung Tung: where it is and how much health it has left
    const st = this.statue;
    if (Array.isArray(s.sa)) {
      const [room, x, y, z, hp, max] = s.sa;
      if (room !== st.room || !st.alive || Math.abs(st.body.pos.x - x) + Math.abs(st.body.pos.z - z) > 0.1) this.placeStatue(room, _v.set(x, y, z));
      if (hp < st.hp) st.hit();
      st.hp = hp; st.maxHp = max || 1;
    } else if (st.alive) { st.hide(); this.removeStatueCollider(); }
    this.ready = new Set(Array.isArray(s.rd) ? s.rd : []);
  }

  onHostEvent(ev) {
    const c = this.byNid(ev.n);
    switch (ev.e) {
      case 'round':
        this.round = ev.r; this.betweenRounds = false;
        this.hud.zRound(ev.r, true); this.sound.zRoundStart();
        if (AREAS[this.statue.room]) this.hud.banner(`ROUND ${ev.r}`, `Defend the Golden Tung Tung in the ${AREAS[this.statue.room].name}!`, 'T', 3.5);
        break;
      case 'rend':
        this.round = ev.r; this.betweenRounds = true;
        this.sound.zRoundEnd(); this.hud.zRound(ev.r, true);
        this.syncUnlocks(ev.r);
        this.roundBanner(ev.r, ev.st);
        break;
      case 'door': {
        const d = this.map.doors.find((x) => x.id === ev.id);
        if (d) this.openDoor(d);
        break;
      }
      case 'pu': this.powerupFx(ev.ty); break;
      case 'zt': {   // a pink zombie threw a coconut
        if (!Array.isArray(ev.p) || !Array.isArray(ev.v) || this.projectiles.some((q) => q.id === ev.i)) break;
        _v.set(+ev.p[0] || 0, +ev.p[1] || 0, +ev.p[2] || 0);
        this.addProjectile(ev.i, _v, new THREE.Vector3(+ev.v[0] || 0, +ev.v[1] || 0, +ev.v[2] || 0), 0, !!ev.b);
        this.sound.swing(_v);
        break;
      }
      case 'zx': {   // ...and it hit something
        const pj = this.projectiles.find((q) => q.id === ev.i);
        if (!pj) break;
        if (Array.isArray(ev.p)) pj.pos.set(+ev.p[0] || 0, +ev.p[1] || 0, +ev.p[2] || 0);
        this.popProjectile(pj, false);
        break;
      }
      case 'shot': if (c && c !== this.player) showShot(this, c, ev); break;
      case 'knife': if (c && c !== this.player) this.sound.knife(c.body.pos); break;
      case 'spawn':
        if (!c) break;
        _v.set(ev.x, ev.y, ev.z);
        if (c === this.player) {
          c.slots[2] = null;
          c.spawn(_v, ev.yaw);
          Object.assign(c, { spawnEpoch: ev.ep, eyeH: 1.65, downed: false });
          this.spectating = null;
        } else c.spawn(_v, ev.yaw);
        break;
      case 'over': this.onOver(ev); break;
      case 'left': this.removeRemote(ev.n, !!ev.k); break;
      case 'inv': applyInventory(this.player, ev); break;
      case 'stash': this.player.stash = unpackStash(ev.it); break;
      default: this.feedback(ev);
    }
  }

  onOver(ev) {
    this.phase = 'over'; this.overT = 3.5;
    if (ev.r) this.round = ev.r;
    for (const [nid, kills, headshots, points, downs] of ev.st || []) {
      const q = this.byNid(nid);
      if (q) Object.assign(q, { kills, headshots, points, downs });
    }
    for (const q of this.players) { if (q.isAvatar && q.alive) q.onDeath(); q.alive = false; q.downed = false; q.scoped = false; q.health = 0; }
    this.overWhy = ev.w === 'statue' ? 'statue' : null;
    if (this.overWhy) this.statueBreakFx();
    this.overMessage();
    this.sound.roundEnd(false);
  }

  removeRemote(nid, kicked = false) {
    const q = this.byNid(nid);
    if (!q || q === this.player) return;
    q.dispose();
    this.remotes = this.remotes.filter((a) => a !== q);
    this.players = this.players.filter((a) => a !== q);
    this.combatants = this.players.slice();
    if (this.spectating === q) this.spectating = this.nextSpectate(null);
    this.hud.center(`${q.name} ${kicked ? 'was kicked by the anticheat' : 'left the game'}`, 3);
  }
}
