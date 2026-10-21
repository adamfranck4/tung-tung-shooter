// Keyboard + mouse state with pointer lock.
const GAME_KEYS = new Set(['Tab', 'Space', 'KeyB', 'KeyQ', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'ControlLeft', 'KeyC', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set(); this.hits = new Set();
    this.buttons = new Set(); this.clicks = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false; this.active = false;

    addEventListener('keydown', (e) => {
      if (this.active && GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.hits.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button); this.clicks.add(e.button);
    });
    addEventListener('mouseup', (e) => { this.buttons.delete(e.button); });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // some browsers report occasional huge spikes; ignore them
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.keys.clear(); this.buttons.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  // Ask for raw mouse input (no OS pointer acceleration), like CS2's raw input; fall back if unsupported.
  lock() {
    const plain = () => { try { const r = this.el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* ignored */ } };
    try {
      const r = this.el.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(plain);
    } catch (_) { plain(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.hits.has(code); }
  mouseDown(b) { return this.buttons.has(b); }
  mouseHit(b) { return this.clicks.has(b); }

  // Mouse movement is used once per rendered frame (aim); key/click presses are used once per
  // physics tick, so a press is never handled twice or lost when frames and ticks don't line up.
  endFrame() { this.dx = 0; this.dy = 0; }
  endTick() { this.hits.clear(); this.clicks.clear(); this.wheel = 0; }
}
