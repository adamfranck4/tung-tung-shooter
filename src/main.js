import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { GameMap, WORLD } from './map.js';
import { ZMap, ZW, ZH } from './zmap.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { Effects } from './effects.js';
import { ViewModel, KNIFE_SKINS } from './viewmodel.js';
import { Game } from './game.js';
import { ZombiesGame } from './zombies.js';
import { CROSSHAIRS, getCrosshair, drawCrosshair } from './crosshair.js';
import { CS_DEG_PER_COUNT } from './player.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const load = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable */ } };
// Graphics: 'high' = detailed surfaces + soft environment light; 'low' = performance mode
const quality = params.has('low') || load('defuse.quality') === 'low' ? 'low' : 'high';
const lowShadows = quality === 'low';
const TICK = 1 / 128; // physics rate (CS2 runs 64 tick + sub-tick input; 128 keeps input tight)

// ---------- renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 800);
camera.rotation.order = 'YXZ';

// gradient sky dome that follows the camera
function makeSky(top, horizon) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
    }),
  );
  sky.renderOrder = -1;
  return sky;
}

// Soft sky lighting for physically based materials (high quality only).
const pmrem = new THREE.PMREMGenerator(renderer);
function makeEnvironment(top, horizon, ground) {
  const s = new THREE.Scene();
  s.add(makeSky(top, horizon));
  const g = new THREE.Mesh(new THREE.CircleGeometry(400, 32), new THREE.MeshBasicMaterial({ color: ground }));
  g.rotation.x = -Math.PI / 2; g.position.y = -5;
  s.add(g);
  return pmrem.fromScene(s, 0.04, 0.1, 1000).texture;
}

const tex = makeTextures(quality);
const input = new Input(canvas);
const hud = new Hud();
const sound = new Sound();
const vm = new ViewModel();
// Sensitivity uses the CS2 scale (0.022° per mouse count × sens), so your CS2 number works here.
// Older saves used a different scale and are converted so aim feels the same.
const settings = { sens: parseFloat(load('defuse.sens2')) };
if (!(settings.sens > 0)) {
  const old = parseFloat(load('defuse.sens'));
  settings.sens = old > 0 ? Math.min(8, Math.max(0.2, Math.round(old * 0.0022 / CS_DEG_PER_COUNT * 20) / 20)) : 2;
  save('defuse.sens2', String(settings.sens));
}

// ---------- world 1: Dunes (5v5 Classic), daytime ----------
function buildClassicWorld() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe6d2ad, 70, 280);
  const sky = makeSky(0x4d8fd6, 0xf0dcb6);
  scene.add(sky);
  if (quality === 'high') scene.environment = makeEnvironment(0x5b8fcf, 0xe9d6b3, 0x9a8160);
  scene.add(new THREE.HemisphereLight(0xd8e8ff, 0xb08a5c, quality === 'high' ? 0.6 : 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.2);
  sun.position.set(WORLD / 2 + 55, 95, WORLD / 2 + 35);
  sun.target.position.set(WORLD / 2, 0, WORLD / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowShadows ? 1024 : 4096, lowShadows ? 1024 : 4096);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const map = new GameMap(scene, tex);
  const fx = new Effects(scene);
  const game = new Game({ scene, camera, map, hud, sound, fx, input, vm, settings });
  game.onMatchOver = (winner) => {
    input.unlock();
    $('end-title').textContent = winner === game.player.team ? 'VICTORY' : 'DEFEAT';
    $('end-score').textContent = `Counter-Terrorists ${game.score.CT} — ${game.score.T} Terrorists`;
    setState('over');
  };
  return { scene, sky, fx, game, map, exposure: 1.05, orbit: { cx: WORLD / 2, cz: WORLD / 2, r: 75, h: 38 } };
}

// ---------- world 2: Sahur Village (Zombies), night ----------
function buildZombiesWorld() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e1526, 16, 95);
  const sky = makeSky(0x03050d, 0x1c2742);
  scene.add(sky);
  // stars + moon live on the sky dome so they follow the camera
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08;
    starPos.push(Math.cos(u) * Math.cos(v) * 450, Math.sin(v) * 450, Math.sin(u) * Math.cos(v) * 450);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  sky.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
  const mc = document.createElement('canvas'); mc.width = mc.height = 128;
  const mctx = mc.getContext('2d'), mg = mctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  mg.addColorStop(0, 'rgba(255,255,240,1)'); mg.addColorStop(0.35, 'rgba(235,240,255,1)'); mg.addColorStop(0.42, 'rgba(180,200,255,0.35)'); mg.addColorStop(1, 'rgba(120,140,255,0)');
  mctx.fillStyle = mg; mctx.fillRect(0, 0, 128, 128);
  const moonTex = new THREE.CanvasTexture(mc); moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true }));
  moon.position.set(-40, 90, -30).normalize().multiplyScalar(440); moon.scale.set(70, 70, 1);
  sky.add(moon);

  if (quality === 'high') scene.environment = makeEnvironment(0x0a1020, 0x26324f, 0x1a1510);
  scene.add(new THREE.HemisphereLight(0x6a7cae, 0x2a1e14, quality === 'high' ? 0.75 : 1.15));
  const moonLight = new THREE.DirectionalLight(0xa8bcff, 1.4);
  moonLight.position.set(ZW / 2 - 40, 90, ZH / 2 - 30);
  moonLight.target.position.set(ZW / 2, 0, ZH / 2);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(lowShadows ? 1024 : 2048, lowShadows ? 1024 : 2048);
  Object.assign(moonLight.shadow.camera, { left: -78, right: 78, top: 78, bottom: -78, near: 10, far: 260 });
  moonLight.shadow.bias = -0.0005; moonLight.shadow.normalBias = 0.04;
  scene.add(moonLight, moonLight.target);

  const map = new ZMap(scene, tex);
  const fx = new Effects(scene);
  const game = new ZombiesGame({ scene, camera, map, hud, sound, fx, input, vm, settings });
  game.onGameOver = (s) => {
    input.unlock();
    $('end-title').textContent = 'GAME OVER';
    $('end-score').textContent = `You survived ${s.round} round${s.round === 1 ? '' : 's'} · ${s.kills} kills · ${s.headshots} headshots`;
    setState('over');
  };
  return { scene, sky, fx, game, map, exposure: 1.3, orbit: { cx: ZW / 2, cz: ZH / 2, r: 58, h: 34 } };
}

// compile every shader up front so the first shot / first zombie doesn't cause a hitch
const precompile = (w) => { try { renderer.compile(w.scene, camera); } catch (_) { /* best effort */ } return w; };
const classic = precompile(buildClassicWorld());
let zombies = null;
const getZombies = () => (zombies = zombies || precompile(buildZombiesWorld()));
let world = classic;
Object.defineProperty(window, '__game', { get: () => world.game }); // handy for debugging in the console
window.__worlds = { classic, getZombies };

// ---------- menu ----------
const choice = { mode: 'classic', team: 'T', difficulty: 'normal', rounds: 8, knife: 'knife', crosshair: 'classic', gfx: quality };
choice.knife = load('defuse.knife') || choice.knife;
choice.crosshair = load('defuse.crosshair') || choice.crosshair;
choice.mode = load('defuse.mode') === 'zombies' ? 'zombies' : 'classic';

// dropdown helper: fills a <select> from a list of {id, name}
function dropdown(id, items, key, onPick) {
  const el = $(id);
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id; o.textContent = it.name;
    el.appendChild(o);
  }
  if (!items.some((it) => it.id === choice[key])) choice[key] = items[0].id;
  el.value = choice[key];
  el.addEventListener('change', () => { choice[key] = el.value; save('defuse.' + key, el.value); onPick?.(el.value); });
  onPick?.(choice[key]);
}
dropdown('knife-select', KNIFE_SKINS, 'knife');
dropdown('crosshair-select', CROSSHAIRS, 'crosshair', (id) => {
  const preset = getCrosshair(id);
  drawCrosshair($('xh-preview'), preset, 1.5, 40, 36);
  hud.setCrosshair(preset);
});
function segment(id, key, parse = (v) => v, onPick = null) {
  const el = $(id);
  const mark = (b) => el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  const current = el.querySelector(`button[data-v="${choice[key]}"]`);
  if (current) mark(current);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mark(b);
    choice[key] = parse(b.dataset.v);
    onPick?.(choice[key]);
  });
}
function showMode(mode) {
  const z = mode === 'zombies';
  document.querySelectorAll('.cs-opt').forEach((e) => e.classList.toggle('hidden', z));
  $('z-desc').classList.toggle('hidden', !z);
  world = z ? getZombies() : classic; // menu backdrop shows the selected map
  save('defuse.mode', mode);
}
segment('mode-seg', 'mode', String, showMode);
segment('team-seg', 'team');
segment('diff-seg', 'difficulty');
segment('rounds-seg', 'rounds', Number);
// graphics quality is applied when the page loads, so changing it reloads the page
segment('gfx-seg', 'gfx', String, (q) => { if (q !== quality) { save('defuse.quality', q); location.reload(); } });
const sens = $('sens');
sens.value = settings.sens; $('sens-val').textContent = settings.sens.toFixed(2);
sens.addEventListener('input', () => {
  settings.sens = parseFloat(sens.value);
  $('sens-val').textContent = settings.sens.toFixed(2);
  save('defuse.sens2', String(settings.sens));
});
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('mobile-warn').classList.remove('hidden');

let state = 'menu'; // menu | playing | paused | over
const noPause = params.has('nopause');

function setState(s) {
  state = s;
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('endscreen').classList.toggle('hidden', s !== 'over');
  hud.show(s === 'playing' || s === 'paused');
  input.active = s === 'playing';
  if (s === 'playing') { input.endTick(); tickAcc = 0; } // drop key presses made in menus
}

$('play').addEventListener('click', () => {
  sound.init();
  if (choice.mode === 'zombies') {
    world = getZombies();
    world.game.start({ knife: choice.knife });
  } else {
    world = classic;
    world.game.start({ team: choice.team, difficulty: choice.difficulty, roundsToWin: choice.rounds, knife: choice.knife });
  }
  setState('playing');
  input.lock();
});
const toMenu = () => { world.game.stop(); setState('menu'); showMode(choice.mode); };
$('resume').addEventListener('click', () => { sound.init(); setState('playing'); input.lock(); });
$('quit').addEventListener('click', toMenu);
$('again').addEventListener('click', toMenu);
canvas.addEventListener('click', () => { if (state === 'playing' && !input.locked) input.lock(); });
input.onLockChange = (locked) => {
  if (!locked && state === 'playing' && !noPause) setState('paused');
};
addEventListener('beforeunload', (e) => { if (state === 'playing') { e.preventDefault(); e.returnValue = ''; } });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  vm.resize();
});

// ---------- loop ----------
function render() {
  const g = world.game, p = g.player;
  world.sky.position.copy(camera.position);
  renderer.toneMappingExposure = world.exposure;
  renderer.clear();
  renderer.render(world.scene, camera);
  if ((state === 'playing' || state === 'paused' || state === 'test') && p?.alive && !p.scoped && !p.downed) {
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
  }
}

let last = performance.now();
let menuT = 0;
let tickAcc = 0;
// Fixed-timestep physics + interpolated rendering: the game always simulates in exact
// 1/128 s steps (consistent movement at any frame rate), and each frame is drawn between
// the last two steps, so motion stays smooth on 60, 144 or 240 Hz screens.
function step(dt) {
  const g = world.game;
  g.frame?.();                      // aim with the mouse every frame
  tickAcc += dt;
  let n = 0;
  while (tickAcc >= TICK && n < 16) { g.update(TICK); input.endTick(); tickAcc -= TICK; n++; }
  if (n === 16) tickAcc = 0;        // fell far behind (e.g. tab was hidden): skip the backlog
  g.interpolate?.(tickAcc / TICK);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const g = world.game;
  if (state === 'playing') {
    step(dt);
    if (g.player?.alive && !g.player.downed) vm.update(dt, g.player, g, input.dx, input.dy);
    hud.update(dt, g);
  } else if (state === 'menu') {
    menuT += dt * 0.05;
    const o = world.orbit;
    camera.position.set(o.cx + Math.cos(menuT) * o.r, o.h, o.cz + Math.sin(menuT) * o.r);
    camera.fov = 60; camera.updateProjectionMatrix();
    camera.lookAt(o.cx, 0, o.cz);
  }
  input.endFrame();
  world.fx.update(dt);
  render();
}

// debug helper: advance the simulation without relying on requestAnimationFrame
window.__sim = (seconds = 1, fps = 60) => {
  const g = world.game;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    step(1 / fps);
    if (g.player?.alive && !g.player.downed) vm.update(1 / fps, g.player, g, 0, 0);
    world.fx.update(1 / fps);
    input.endFrame();
    if (!g.running) break;
  }
  g.interpolate?.(1);
  if (g.player) hud.update(1 / 60, g);
  render();
};

window.__renderer = renderer; // debug: lets test scripts render frames to a contact sheet
// debug helper: average milliseconds per frame (simulation + rendering, waiting for the GPU)
window.__bench = (frames = 120) => {
  const gl = renderer.getContext();
  const g = world.game;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (g.running) step(1 / 60);
    world.fx.update(1 / 60);
    render();
    gl.finish();
  }
  return +((performance.now() - t0) / frames).toFixed(2);
};

setState('menu');
showMode(choice.mode);
requestAnimationFrame(frame);
