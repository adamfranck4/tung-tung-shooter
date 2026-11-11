// Keyboard + mouse state with pointer lock.
// Only real key presses and mouse movement count: events made up by a script (an aimbot or a
// bunny-hop script in a browser extension) are ignored and reported to the guard. The state is
// private to this class, so nothing outside it can write mouse movement or key presses into it.
import { DEV, seal, trusted, mouseMove, fakeInput } from './guard.js';

const GAME_KEYS = new Set(['Tab', 'Space', 'KeyB', 'KeyQ', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Digit7', 'Digit8', 'Digit9', 'Digit0', 'ControlLeft', 'KeyC', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class Input {
  #keys = new Set(); #hits = new Set(); #buttons = new Set(); #clicks = new Set();
  #dx = 0; #dy = 0; #wheel = 0; #locked = false; #force = false;

  constructor(el) {
    this.el = el;
    this.active = false; this.suspended = false;

    addEventListener('keydown', (e) => {
      if (!trusted(e)) { if (this.active) fakeInput('key'); return; }
      if (this.active && GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.#hits.add(e.code);
      this.#keys.add(e.code);
    });
    addEventListener('keyup', (e) => { if (trusted(e)) this.#keys.delete(e.code); });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (!trusted(e)) { fakeInput('aim'); return; }
      this.#buttons.add(e.button); this.#clicks.add(e.button);
    });
    addEventListener('mouseup', (e) => { if (trusted(e)) this.#buttons.delete(e.button); });
    addEventListener('mousemove', (e) => {
      const [mx, my] = mouseMove(e);
      if (!trusted(e)) { if (this.active && (mx || my)) fakeInput('aim'); return; }
      if (!this.locked) return;
      // some browsers report occasional huge spikes; ignore them
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.#dx += mx; this.#dy += my;
    });
    addEventListener('wheel', (e) => { if (this.locked && trusted(e)) this.#wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    addEventListener('blur', () => { this.#keys.clear(); this.#buttons.clear(); });
    document.addEventListener('pointerlockchange', () => {
      this.#locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.#keys.clear(); this.#buttons.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  // the mouse is captured (test builds can pretend it is: see forceLock)
  get locked() { return this.#locked || this.#force; }
  // this frame's mouse movement, in counts
  get dx() { return this.#dx; }
  get dy() { return this.#dy; }
  get wheel() { return this.#wheel; }
  // test builds only (?dev on your own computer): take mouse input without capturing the mouse
  forceLock(on = true) { if (DEV) this.#force = !!on; }

  // Ask for raw mouse input (no OS pointer acceleration), like CS2's raw input; fall back if unsupported.
  lock() {
    const plain = () => { try { const r = this.el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* ignored */ } };
    try {
      const r = this.el.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(plain);
    } catch (_) { plain(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // suspended: a menu is open but the match keeps running (online), so the game sees no input
  down(code) { return !this.suspended && this.#keys.has(code); }
  pressed(code) { return !this.suspended && this.#hits.has(code); }
  mouseDown(b) { return !this.suspended && this.#buttons.has(b); }
  mouseHit(b) { return !this.suspended && this.#clicks.has(b); }

  // Mouse movement is used once per rendered frame (aim); key/click presses are used once per
  // physics tick, so a press is never handled twice or lost when frames and ticks don't line up.
  endFrame() { this.#dx = 0; this.#dy = 0; }
  endTick() { this.#hits.clear(); this.#clicks.clear(); this.#wheel = 0; }
}
seal(Input);
