// The human player: reads keyboard/mouse input and drives a Combatant.
import { Combatant } from './combatant.js';
import { BUY_ITEMS, adsOf } from './weapons.js';

// CS2's m_yaw / m_pitch: 0.022 degrees per mouse count, times the sensitivity setting.
export const CS_DEG_PER_COUNT = 0.022 * Math.PI / 180;
const MAX_PITCH = 89 * Math.PI / 180;
const NOISY_SPEED = 3.6; // m/s; shift-walking stays below this and is silent, like CS2

export class Player extends Combatant {
  constructor(game, team) {
    super(game, 'You', team);
    this.stepT = 0;
    this.buyOpen = false;
    this.jumpBuffer = 0;
  }

  // Aim. Called once per rendered frame (not per physics tick) so the view never lags the mouse.
  look() {
    const g = this.game, inp = g.input;
    if (!this.alive) return;
    // zoomed in (scope, or aiming down sights): the mouse turns you slower, by the same amount
    const zoom = this.scoped ? (this.weapon?.def.zoomFov || g.scopeFov) / g.baseFov : this.adsFov();
    const k = CS_DEG_PER_COUNT * g.settings.sens * zoom;
    this.yaw -= inp.dx * k;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - inp.dy * k));
  }

  // Zombies: hold right click to aim down sights (any gun without a scope). The gun comes up over
  // the gun's own time and drops while reloading or switching. Once per physics tick.
  updateAim(dt, want) {
    const g = this.game, w = this.weapon, a = g.mode === 'zombies' ? adsOf(w?.def) : null;
    const up = !!a && want && !this.reloading && g.time >= this.deployUntil;
    const rate = dt / (a ? a.time : 0.15);
    this.adsT = up ? Math.min(1, this.adsT + rate) : Math.max(0, this.adsT - rate * 1.4);
  }

  // Downed in Zombies (last stand): stuck on the ground, but you can still aim, shoot and reload
  // your pistol. Nothing else: no moving, switching weapons or buying. Once per physics tick.
  lastStand(dt) {
    const g = this.game, inp = g.input, w = this.weapon;
    if (!this.alive) return;
    this.buyOpen = false; this.wantsUse = false;
    this.updateAim(dt, w?.def.slot === 2 && inp.mouseDown(2));
    if (w?.def.slot !== 2) return;   // online, the pistol can take a moment to arrive from the host
    if (inp.pressed('KeyR')) this.startReload();
    if (inp.mouseDown(0)) this.tryFire(inp.mouseHit(0));
  }

  // Everything else. Called once per physics tick.
  update(dt) {
    const g = this.game, inp = g.input;
    if (!this.alive) return;

    // ----- buy menu (Zombies: B is the ammo menu; the Gun Shop counter opens its own with E) -----
    if (inp.pressed('KeyB') && g.mode === 'zombies') g.hud.center('Buy ammo at the Gun Shop counter (E)', 1.5);
    else if (inp.pressed('KeyB')) {
      if (this.buyOpen) this.buyOpen = false;
      else {
        this.gunShop = false;
        if (g.canBuy(this)) this.buyOpen = true;
        else if (g.mode !== 'zombies') g.hud.center('You can only buy in your spawn during buy time', 1.5);
      }
    }
    if (this.buyOpen && !g.canBuy(this)) this.buyOpen = false;
    if (this.buyOpen) {
      // keys 1-9, then 0 for a tenth item
      const n = g.buyCount?.(this) ?? BUY_ITEMS.length;
      for (let i = 1; i <= n; i++) if (inp.pressed('Digit' + (i % 10))) g.buy(this, i - 1);
      if (inp.pressed('Escape')) this.buyOpen = false;
    } else {
      // ----- weapon switching -----
      if (inp.pressed('Digit1')) this.selectSlot(1);
      if (inp.pressed('Digit2')) this.selectSlot(2);
      if (inp.pressed('Digit3')) this.selectSlot(3);
      if (inp.pressed('KeyQ')) this.selectSlot(this.lastSlot);
      if (inp.wheel) {
        const order = [1, 2, 3].filter((s) => this.slots[s]);
        let i = order.indexOf(this.slot);
        i = (i + (inp.wheel > 0 ? 1 : -1) + order.length) % order.length;
        this.selectSlot(order[i]);
      }
    }
    if (inp.pressed('KeyR')) this.startReload();
    if (inp.pressed('KeyF') && !this.reloading) g.vm.inspect();

    // ----- use (plant / defuse) -----
    this.wantsUse = inp.down('KeyE');
    const using = this.wantsUse && this.useProgress > 0;

    // ----- movement -----
    const frozen = g.phase === 'freeze';
    let fwd = 0, side = 0;
    if (inp.down('KeyW')) fwd += 1;
    if (inp.down('KeyS')) fwd -= 1;
    if (inp.down('KeyD')) side += 1;
    if (inp.down('KeyA')) side -= 1;
    if (frozen || using) { fwd = 0; side = 0; }
    let wx = 0, wz = 0;
    if (fwd || side) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      wx = -sy * fwd + cy * side;
      wz = -cy * fwd - sy * side;
      const l = Math.hypot(wx, wz); wx /= l; wz /= l;
    }
    this.setCrouch(inp.down('KeyC') || inp.down('ControlLeft') || inp.down('ControlRight'), dt);
    const walking = inp.down('ShiftLeft') || inp.down('ShiftRight');
    // press to jump (holding doesn't auto-hop); a short buffer catches presses just before landing
    if (inp.pressed('Space')) this.jumpBuffer = 0.1;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const ladder = !frozen && g.map.ladderAt ? g.map.ladderAt(this.body.pos) : null;
    if (ladder) {
      // ladders work like CS2: W climbs the way you're looking (look down to go down), S the opposite
      if (this.jumpBuffer > 0) {          // jump off, away from the wall
        this.jumpBuffer = 0;
        this.body.vel.set(ladder.out[0] * 3, 3, ladder.out[1] * 3);
        this.applyMovement(dt, 0, 0, 1, false);
      } else {
        // stay on the ladder: only sideways movement along the wall, except stepping off
        // at the bottom (walking away while standing) or at the top (onto the platform)
        const [ox, oz] = ladder.out;
        const along = wx * ox + wz * oz;
        let hx = wx - along * ox, hz = wz - along * oz;
        const atTop = this.body.pos.y > ladder.top - 0.3;
        const stepOff = (this.body.onGround && along > 0) || (atTop && along < 0);
        if (stepOff) { hx = wx; hz = wz; }
        else {
          // grabbing the ladder cancels momentum that would carry you away from the wall
          const v = this.body.vel, vAlong = v.x * ox + v.z * oz;
          if (vAlong > 0) { v.x -= vAlong * ox; v.z -= vAlong * oz; }
        }
        const climb = fwd ? (this.pitch > -0.35 ? fwd : -fwd) * 3.2 : 0;
        this.applyMovement(dt, hx, hz, 1, false, atTop && along < 0 ? Math.max(climb, 0) : climb);
        if (climb) { this.ladderStepT = (this.ladderStepT || 0) - dt; if (this.ladderStepT <= 0) { this.ladderStepT = 0.32; g.sound.step(null, true); } }
      }
    } else {
      const jump = !frozen && this.jumpBuffer > 0 && this.body.onGround;
      if (jump) this.jumpBuffer = 0;
      const wasAir = !this.body.onGround;
      this.applyMovement(dt, wx, wz, walking ? 0.52 : 1, jump);
      if (wasAir && this.body.onGround) g.sound.land();
    }

    // footsteps (only when running, like CS2)
    const sp = this.horizSpeed();
    if (this.body.onGround && sp > NOISY_SPEED && !this.crouching) {
      this.stepT -= dt * sp / 6;
      if (this.stepT <= 0) { this.stepT = 0.36; g.sound.step(null, true); g.emitNoise(this.body.pos, 14, this); }
    }

    // ----- shooting -----
    const w = this.weapon;
    // a minigun spins up while you hold the trigger (and winds down when you let go)
    if (w?.def.spin) {
      const spinning = !this.buyOpen && !frozen && !using && !this.reloading && inp.mouseDown(0) && g.time >= this.deployUntil;
      this.spinK = spinning ? Math.min(1, this.spinK + dt / w.def.spin.time) : Math.max(0, this.spinK - dt / 0.7);
    } else this.spinK = 0;
    this.updateAim(dt, !this.buyOpen && !frozen && inp.mouseDown(2));
    if (!this.buyOpen && w) {
      if (w.def.scope && inp.mouseHit(2) && !this.reloading && g.time >= this.deployUntil) {
        this.scoped = !this.scoped; g.sound.zoom();
      }
      if (!frozen && !using) {
        const edge = inp.mouseHit(0);
        if (inp.mouseDown(0)) this.tryFire(edge);
      }
    }
  }
}
