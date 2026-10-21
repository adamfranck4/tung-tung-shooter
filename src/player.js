// The human player: reads keyboard/mouse input and drives a Combatant.
import { Combatant } from './combatant.js';

export class Player extends Combatant {
  constructor(game, team) {
    super(game, 'You', team);
    this.stepT = 0;
    this.buyOpen = false;
  }

  update(dt) {
    const g = this.game, inp = g.input;
    if (!this.alive) return;

    // ----- look -----
    const fovScale = this.scoped ? g.scopeFov / g.baseFov : 1;
    const sens = 0.0022 * g.settings.sens * fovScale;
    this.yaw -= inp.dx * sens;
    this.pitch -= inp.dy * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));

    // ----- buy menu -----
    if (inp.pressed('KeyB')) {
      if (this.buyOpen) this.buyOpen = false;
      else if (g.canBuy(this)) this.buyOpen = true;
      else if (g.mode !== 'zombies') g.hud.center('You can only buy in your spawn during buy time', 1.5);
    }
    if (this.buyOpen && !g.canBuy(this)) this.buyOpen = false;
    if (this.buyOpen) {
      for (let i = 1; i <= 4; i++) if (inp.pressed('Digit' + i)) g.buy(this, i - 1);
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
    const jump = !frozen && inp.down('Space') && this.body.onGround;
    const wasAir = !this.body.onGround;
    this.applyMovement(dt, wx, wz, walking ? 0.52 : 1, jump);
    if (wasAir && this.body.onGround) g.sound.land();

    // footsteps
    const sp = this.horizSpeed();
    if (this.body.onGround && sp > 3.0 && !this.crouching) {
      this.stepT -= dt * sp / 5;
      if (this.stepT <= 0) { this.stepT = 0.38; g.sound.step(null, true); g.emitNoise(this.body.pos, 14, this); }
    }

    // ----- shooting -----
    const w = this.weapon;
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
