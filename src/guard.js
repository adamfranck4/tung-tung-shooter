// The guard: the part of the anticheat that runs in every player's own browser. It is aimed at
// cheats that live in the page itself (browser extensions, userscripts, pasted console code).
// Such a cheat can't change the game's files, so it has to reach into the running game:
//  - through handles left on the page (window.__game): gone now; the names are tripwires,
//  - by importing the game's own modules again and replacing methods on their classes: every
//    class is sealed (seal()), the tables of numbers are frozen (frozen()),
//  - with traps on Object.prototype that catch game objects as they are built: closed,
//  - by replacing the browser's own functions (Array.prototype.push, performance.now,
//    RTCDataChannel.send...) to catch objects, speed up time or read the connection: checked,
//    both for ones replaced before the game loaded and for ones replaced later,
//  - with made-up mouse and key events: only real ones count (see input.js).
// What it finds is reported with a level: 'ban' (only a cheat does this), 'kick' (the game has
// been tampered with: can't play online until it's turned off) or 'warn' (something a privacy
// extension might also do: the host is told and gets stricter). main.js and net.js act on it.
//
// It can't stop someone who replaces the game's files outright (their own copy of the game):
// that's what the host's checks in anticheat.js are for.
//
// This file must stay the first import of main.js and import nothing itself: it has to run
// before any other code of the game.

// ---------- the browser's own functions, taken before anything else runs ----------
const W = window;
const { defineProperty, getOwnPropertyDescriptor: gOPD, getOwnPropertyNames: gOPN, getPrototypeOf, preventExtensions } = Object;
const objFreeze = Object.freeze, objIsFrozen = Object.isFrozen;
const { apply, ownKeys } = Reflect;
const fnToString = Function.prototype.toString;
const strIncludes = String.prototype.includes, strReplace = String.prototype.replace, strSplit = String.prototype.split, strTrim = String.prototype.trim;
const reTest = RegExp.prototype.test, reExec = RegExp.prototype.exec;
const sealed = new WeakSet(), wsHas = WeakSet.prototype.has, wsAdd = WeakSet.prototype.add;
const SELF = apply(strSplit, import.meta.url, ['?'])[0];   // this file, as error traces name it

// Test builds: on your own computer with ?dev in the URL the debug handles (window.__game...)
// work, made-up input counts and nothing is enforced. Hosts that aren't test builds turn these away.
export const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).has('dev');

// ---------- what was found ----------
const LEVELS = { warn: 1, kick: 2, ban: 3 };
const found = [], subs = [];
// level: 'warn' | 'kick' | 'ban'; kind: a short code (see WHY); detail: what exactly
export function report(level, kind, detail = '') {
  const id = kind + ':' + detail;
  for (let i = 0; i < found.length; i++) if (found[i].id === id) return;
  if (found.length >= 40) return;
  const f = objFreeze({ id, level, kind, detail: String(detail).slice(0, 80) });
  found[found.length] = f;
  if (DEV) console.warn(`[guard] ${level}: ${kind} ${detail}`);
  for (let i = 0; i < subs.length; i++) { try { subs[i](f); } catch (_) { /* a listener's problem */ } }
}
// cb({level, kind, detail}) for everything found so far and from now on
export function onTamper(cb) { subs[subs.length] = cb; for (let i = 0; i < found.length; i++) cb(found[i]); }
// the worst thing found: {level, kind, detail}, or null (minLevel: only this bad or worse)
export function worst(minLevel = 'warn') {
  let w = null;
  for (let i = 0; i < found.length; i++) if (LEVELS[found[i].level] >= LEVELS[minLevel] && (!w || LEVELS[found[i].level] > LEVELS[w.level])) w = found[i];
  return w;
}
// what the host is sent: [[level, kind, detail], ...]
export function findings() { const out = []; for (let i = 0; !DEV && i < found.length && i < 12; i++) out[i] = [found[i].level, found[i].kind, found[i].detail]; return out; }

const WHY = {
  'debug-handle': 'reading the game through its debug handles', 'debug-write': 'changing the game through its debug handles',
  patched: 'replacing part of the game\'s code', table: 'changing the game\'s numbers',
  trap: 'a trap that catches the game\'s objects', proto: 'changed JavaScript basics',
  hook: 'a replaced browser function', 'late-hook': 'a browser function replaced while playing',
  'fake-input': 'made-up mouse or keyboard input', 'aim-write': 'aim that didn\'t come from the mouse',
  'pos-write': 'movement that didn\'t come from the game', 'vel-write': 'speed that didn\'t come from the game',
  'time-warp': 'a sped-up clock', 'no-guard': 'the anticheat isn\'t running',
};
export const tamperText = (kind, detail = '') => (WHY[kind] || kind) + (detail ? ` (${detail})` : '');

// ---------- a second, untouched copy of the browser's functions ----------
// A cheat that was on the page before the game can have replaced Function.prototype.toString
// (so its replacements print as "native code") or the event getters. A fresh, empty frame has
// its own untouched copies.
let clean = null;
try {
  const f = document.createElement('iframe');
  f.style.display = 'none'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
  (document.documentElement || document.body).appendChild(f);
  clean = f.contentWindow || null;
  if (clean && (clean === W || typeof clean.Function !== 'function')) clean = null;
} catch (_) { clean = null; }
const cleanToString = clean ? clean.Function.prototype.toString : fnToString;
const getter = (proto, key) => { try { return gOPD(proto, key)?.get || null; } catch (_) { return null; } };
const C = clean || W;
const trustedGet = (() => { try { return gOPD(new C.Event('x'), 'isTrusted')?.get || null; } catch (_) { return null; } })();
const moveXGet = getter(C.MouseEvent.prototype, 'movementX'), moveYGet = getter(C.MouseEvent.prototype, 'movementY');

// was this event made by the browser (a real key or mouse), not by a script?
export function trusted(e) {
  if (DEV) return true;
  try { return trustedGet ? apply(trustedGet, e, []) === true : e.isTrusted === true; } catch (_) { return false; }
}
// a mouse event's movement, read with the browser's own getters: [dx, dy]
const _mv = [0, 0];
export function mouseMove(e) {
  try {
    _mv[0] = moveXGet ? apply(moveXGet, e, []) : e.movementX;
    _mv[1] = moveYGet ? apply(moveYGet, e, []) : e.movementY;
  } catch (_) { _mv[0] = _mv[1] = 0; }
  return _mv;
}
// made-up input is ignored (input.js); a stream of made-up aiming or shooting is an aimbot
let fakeAim = 0, fakeKeys = 0;
export function fakeInput(kind) {
  if (kind === 'aim') { if (++fakeAim === 12) report('ban', 'fake-input', 'mouse'); } else if (++fakeKeys === 40) report('kick', 'fake-input', 'keys');
}

// ---------- Object.prototype and Array.prototype ----------
// A setter on Object.prototype named like one of the game's fields ("combatants") is called
// with every object the game gives that field: the classic way in. Nothing may be added.
const OBJ_OK = ['constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__', '__lookupSetter__',
  'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', '__proto__', 'toLocaleString'];
function scanProto(P, label, ok) {
  let names; try { names = gOPN(P); } catch (_) { return 0; }
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    if (ok && ok.indexOf(k) >= 0) continue;
    const d = gOPD(P, k);
    const isTrap = !!d && (typeof d.get === 'function' || typeof d.set === 'function');
    const index = apply(reTest, /^\d+$/, [k]);
    if (!ok && !isTrap && !index) continue;                 // (Array.prototype: only traps and numbered slots)
    if (!ok && k === 'length') continue;
    report(isTrap || index ? 'ban' : 'kick', isTrap || index ? 'trap' : 'proto', label + '.' + k);
    try { delete P[k]; } catch (_) { /* can't be removed */ }
  }
  return names.length;
}
scanProto(Object.prototype, 'Object.prototype', OBJ_OK);
try { preventExtensions(Object.prototype); } catch (_) { /* older browsers */ }
let arrKeys = scanProto(Array.prototype, 'Array.prototype', null);

// ---------- sealing the game's own classes and tables ----------
// A cheat can import any of the game's modules again and gets the very same classes. So every
// method is locked in place: reading it gives the original, writing it on the class does
// nothing but report the attempt (writing it on one object still works, as before).
function lock(obj, label) {
  if (apply(wsHas, sealed, [obj])) return;
  apply(wsAdd, sealed, [obj]);
  const keys = ownKeys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], d = gOPD(obj, key);
    if (!d || !d.configurable) continue;
    if ('value' in d && typeof d.value === 'function' && key !== 'constructor') {
      const fn = d.value, name = label + '.' + String(key);
      defineProperty(obj, key, {
        get() { return fn; },
        set(v) {
          if (this === obj || apply(wsHas, sealed, [this])) { report('ban', 'patched', name); return; }
          defineProperty(this, key, { value: v, writable: true, configurable: true, enumerable: true });
        },
        enumerable: d.enumerable, configurable: false,
      });
    } else if ('value' in d) defineProperty(obj, key, { writable: false, configurable: false });
    else defineProperty(obj, key, { configurable: false });
  }
  preventExtensions(obj);
}
// seal(ClassA, ClassB...): call right after the classes are defined, in their own module
export function seal(...classes) {
  for (const K of classes) { lock(K.prototype, K.name + '.prototype'); lock(K, K.name); }
}
// frozen(table): a table of plain numbers and lists that nothing may change (returns it)
export function frozen(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || objIsFrozen(obj) || depth > 6) return obj;
  const p = getPrototypeOf(obj);
  if (p !== Object.prototype && p !== Array.prototype && p !== null) return obj;   // (not a plain table: a vector, a texture...)
  const keys = ownKeys(obj);
  for (let i = 0; i < keys.length; i++) { const d = gOPD(obj, keys[i]); if (d && 'value' in d) frozen(d.value, depth + 1); }
  return objFreeze(obj);
}

// ---------- the debug handles are tripwires ----------
// The game used to leave window.__game (and friends) for testing. A fair player never touches
// them; a cheat written for the game does. They now lead nowhere: looking inside one gets you
// removed from online play, writing through one gets you banned.
const SKIP = ['then', 'toJSON', 'constructor', 'prototype', 'name', 'length', 'caller', 'arguments', 'apply', 'call', 'bind', 'toString', 'valueOf'];
function tripwire(name, depth = 0) {
  return new Proxy(function () {}, {
    get(t, k) {
      if (typeof k === 'symbol' || SKIP.indexOf(k) >= 0) return undefined;
      report('kick', 'debug-handle', name + '.' + k);
      return depth < 4 ? tripwire(name + '.' + k, depth + 1) : undefined;
    },
    set(t, k) { report('ban', 'debug-write', name + '.' + String(k)); return true; },
    defineProperty(t, k) { report('ban', 'debug-write', name + '.' + String(k)); return true; },
    deleteProperty() { return true; },
    apply() { report('ban', 'debug-write', name + '()'); return undefined; },
    construct() { report('ban', 'debug-write', 'new ' + name); return {}; },
  });
}
const HANDLES = ['__game', '__session', '__worlds', '__sim', '__renderer', '__post', '__bench'];
if (!DEV) {
  for (const n of HANDLES) {
    const t = tripwire(n);
    try { defineProperty(W, n, { get() { return t; }, set() { /* ignored */ }, enumerable: false, configurable: false }); } catch (_) { report('kick', 'hook', 'window.' + n); }
  }
}
// main.js: the real handles, for test builds only
export function debugHandles(make) {
  if (!DEV) return;
  for (const n of Object.keys(make)) defineProperty(W, n, { ...make[n], configurable: true });
}

// ---------- the browser's functions: were any replaced? ----------
// Each one checked is [where it lives, its name, value / getter / setter, the original, level].
// core: plain JavaScript the game hands its objects to (no extension has a reason to replace
// these); aim / net: the mouse and the connection; env: clocks, drawing, events (privacy
// extensions replace some of these, so on their own they only warn).
const N = [];
function watch(level, label, obj, keys) {
  if (!obj) return;
  if (!keys) { try { keys = gOPN(obj); } catch (_) { return; } }
  for (let i = 0; i < keys.length; i++) {
    let d; try { d = gOPD(obj, keys[i]); } catch (_) { continue; }
    if (!d || keys[i] === 'constructor') continue;
    for (const t of ['value', 'get', 'set']) {
      const v = d[t];
      if (typeof v === 'function' || (t === 'value' && v && typeof v === 'object' && obj === W)) N[N.length] = { obj, key: keys[i], t, v, level, name: label + '.' + String(keys[i]) };
    }
  }
}
const P = (name) => W[name]?.prototype;
watch('kick', 'window', W, ['Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Math', 'JSON', 'Reflect', 'Proxy', 'Function', 'Promise', 'Symbol', 'Float32Array', 'Uint32Array', 'Int32Array']);
watch('kick', 'Object', Object, ['assign', 'keys', 'values', 'entries', 'fromEntries', 'defineProperty', 'defineProperties', 'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'getOwnPropertySymbols', 'getPrototypeOf', 'setPrototypeOf', 'create', 'freeze', 'isFrozen', 'preventExtensions']);
watch('kick', 'Object.prototype', Object.prototype, ['hasOwnProperty', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', '__proto__']);
watch('kick', 'Function.prototype', Function.prototype, ['call', 'apply', 'bind', 'toString']);
watch('kick', 'Array', Array, ['isArray', 'from', 'of']);
watch('kick', 'Array.prototype', Array.prototype);
for (const n of ['Map', 'Set', 'WeakMap', 'WeakSet']) watch('kick', n + '.prototype', P(n));
watch('kick', 'Math', Math); watch('kick', 'Reflect', Reflect); watch('kick', 'JSON', JSON, ['parse', 'stringify']);
watch('kick', 'Promise.prototype', P('Promise'), ['then']);
watch('kick', 'Number.prototype', Number.prototype, ['toFixed']); watch('kick', 'Number', Number, ['isFinite']);
// the mouse
watch('kick', 'MouseEvent', P('MouseEvent'), ['movementX', 'movementY', 'button', 'buttons']);
watch('kick', 'KeyboardEvent', P('KeyboardEvent'), ['code', 'repeat']);
watch('kick', 'Element', P('Element'), ['requestPointerLock']);
watch('kick', 'Document', P('Document'), ['pointerLockElement', 'exitPointerLock']);
// the connection (see rebase(): PeerJS replaces a few of RTCPeerConnection's itself)
watch('kick', 'RTCDataChannel', P('RTCDataChannel'), ['send', 'onmessage', 'close']);
watch('kick', 'BroadcastChannel', P('BroadcastChannel'), ['postMessage', 'onmessage']);
watch('warn', 'RTCPeerConnection', P('RTCPeerConnection'), ['createDataChannel']);
watch('warn', 'window', W, ['RTCPeerConnection', 'RTCDataChannel', 'WebSocket', 'BroadcastChannel', 'Worker', 'Blob']);
// clocks, events, drawing
watch('warn', 'Performance', P('Performance'), ['now']);
watch('warn', 'Date', Date, ['now']);
watch('warn', 'window', W, ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'fetch', 'Date', 'performance']);
watch('warn', 'EventTarget', P('EventTarget'), ['addEventListener', 'removeEventListener', 'dispatchEvent']);
watch('warn', 'Event', P('Event'), ['type', 'timeStamp', 'preventDefault', 'target']);
watch('warn', 'Document', P('Document'), ['createElement', 'hidden', 'visibilityState']);
watch('warn', 'HTMLIFrameElement', P('HTMLIFrameElement'), ['contentWindow', 'contentDocument']);
watch('warn', 'Node', P('Node'), ['appendChild', 'insertBefore']);
watch('warn', 'HTMLCanvasElement', P('HTMLCanvasElement'), ['getContext']);
const GL = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'uniformMatrix4fv', 'uniformMatrix3fv', 'uniform3fv',
  'shaderSource', 'useProgram', 'enable', 'disable', 'depthFunc', 'depthMask', 'depthRange', 'clear', 'clearDepth', 'bufferData', 'bufferSubData', 'readPixels',
  'viewport', 'blendFunc', 'colorMask', 'bindFramebuffer'];
watch('warn', 'WebGL2', P('WebGL2RenderingContext'), GL); watch('warn', 'WebGL', P('WebGLRenderingContext'), GL);

// Does a function still look like the browser's own? Three things a replacement gets wrong:
//  - its text (read with the untouched frame's toString) isn't "function name() { [native code] }",
//  - it has a .prototype of its own (plain functions do; the browser's methods don't),
//  - when it fails, its own code shows up in the error's trace before ours.
const V8 = typeof Error.captureStackTrace === 'function';
const JUNK = { __proto__: null };
function looksNative(e) {
  const fn = e.v;
  if (typeof fn !== 'function') return true;
  let text;
  try { text = apply(strReplace, apply(cleanToString, fn, []), [/\s+/g, ' ']); } catch (_) { return false; }
  const m = apply(reExec, /^function (?:get |set )?([\w$.[\]]+)\(\) \{ \[native code\] \}$/, [text]);
  if (!m) return false;                                    // (a wrapped or bound function prints with no name)
  if (typeof e.key !== 'symbol' && m[1] !== e.key) {       // another name is fine if it's the same function (Set's keys = values)
    try { if (e.obj[m[1]] !== fn) return false; } catch (_) { return false; }
  }
  // called on nonsense, most of the browser's functions fail at once: who shows up in the trace?
  if (V8 && e.obj !== W) {
    try { const r = apply(fn, JUNK, []); if (r && typeof r.then === 'function') r.then(null, () => {}); } catch (err) {
      const lines = apply(strSplit, String(err?.stack || ''), ['\n']);
      for (let i = 1; i < lines.length; i++) {
        const l = apply(strTrim, lines[i], []);
        if (apply(strIncludes, l, [SELF])) break;
        if (!apply(reTest, /\(<anonymous>\)$/, [l])) return false;       // someone else's code, between the browser's and ours
      }
    }
  }
  return true;
}
function checkLoaded() {
  for (let i = 0; i < N.length; i++) { const e = N[i]; let ok = true; try { ok = looksNative(e); } catch (_) { ok = false; } if (!ok) report(e.level, 'hook', e.name); }
}
// replaced since the game loaded? (a few each call)
let at = 0;
function checkLater(n) {
  for (let i = 0; i < n && N.length; i++) {
    const e = N[at = (at + 1) % N.length];
    let d; try { d = gOPD(e.obj, e.key); } catch (_) { d = null; }
    if (!d || d[e.t] !== e.v) { report(e.level === 'warn' ? 'warn' : 'kick', 'late-hook', e.name); e.v = d ? d[e.t] : undefined; }
  }
}
// a library loaded later (PeerJS): from now on its functions may not be replaced either
export function watchLib(label, obj, keys) { if (!DEV) watch('kick', label, obj, keys); }
// PeerJS (loaded when you first go online) wraps a few connection functions itself: start over for those
export function rebase() {
  for (let i = 0; i < N.length; i++) {
    const e = N[i];
    if (e.level !== 'warn' || e.name.indexOf('RTC') < 0) continue;
    try { const d = gOPD(e.obj, e.key); if (d) e.v = d[e.t]; } catch (_) { /* gone */ }
  }
}

// ---------- the clock ----------
// The game never runs ahead of real time (a frame's step is at most the time since the last
// one). A speed hack feeds it a faster clock. A worker has its own, which the page can't reach:
// if the game's time gains a second on it, the clock is being pushed.
let simT = 0, base = Infinity, baseT = 0, clockW = null;
export function simAdvance(dt) { if (dt > 0 && dt <= 0.1001) simT += dt; }   // (can only ever add: calling it from outside can't hide anything)
try {
  const src = 'const t0=performance.now();setInterval(()=>postMessage(performance.now()-t0),500);';
  clockW = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  clockW.onmessage = (ev) => {
    const real = +ev.data / 1000;
    if (!(real >= 0)) return;
    if (DEV) return;
    const e = simT - real;
    // (start over every 30 s: switching between drawn frames and the background ticker costs a few ms each time)
    if (e < base || real - baseT > 30) { base = e; baseT = real; }
    else if (e - base > 1) { report('ban', 'time-warp', ''); base = e; baseT = real; }
  };
} catch (_) { clockW = null; }

// ---------- every frame ----------
if (!DEV) checkLoaded();   // (right now, before any of the game's own code has run)
let tickN = 0;
export function tick() {
  if (DEV) return;
  tickN++;
  if (tickN % 6 === 0) checkLater(24);
  if (tickN % 120 === 0) {
    try { if (gOPN(Array.prototype).length !== arrKeys) arrKeys = scanProto(Array.prototype, 'Array.prototype', null); } catch (_) { /* ignored */ }
    for (const n of HANDLES) { const d = gOPD(W, n); if (!d || d.configurable) report('kick', 'late-hook', 'window.' + n); }
  }
}
