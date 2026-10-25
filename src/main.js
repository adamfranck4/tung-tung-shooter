import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { GameMap, WORLD } from './map.js';
import { ZMap, ZW, ZH } from './zmap.js';
import { Input } from './input.js';
import { Hud, esc } from './hud.js';
import { Sound } from './audio.js';
import { Effects } from './effects.js';
import { ViewModel, KNIFE_SKINS } from './viewmodel.js';
import { Game } from './game.js';
import { ZombiesGame } from './zombies.js';
import { ClassicClient } from './netclassic.js';
import { ZombiesClient } from './netzombies.js';
import { Session, NetLink, MAX_PLAYERS, TEAM_SIZE, cleanName, normalizeCode } from './net.js';
import { CROSSHAIRS, getCrosshair, drawCrosshair } from './crosshair.js';
import { CS_DEG_PER_COUNT } from './player.js';
import { ZMenu } from './zui.js';

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
// Zombies: the Gun Shop, inventory and case opening menus (they take the mouse while open)
const zmenu = new ZMenu({ sound, onClose: () => closeZMenu() });
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
  const ctx = { scene, camera, map, hud, sound, fx, input, vm, settings };
  // solo and hosting use Game; joining someone else's match uses ClassicClient
  const solo = new Game(ctx), client = new ClassicClient(ctx);
  for (const game of [solo, client]) {
    game.onMatchOver = (winner) => showEnd(winner === game.player.team ? 'VICTORY' : 'DEFEAT',
      `Counter-Terrorists ${game.score.CT} — ${game.score.T} Terrorists`);
  }
  return { scene, sky, fx, game: solo, solo, client, map, exposure: 1.05, orbit: { cx: WORLD / 2, cz: WORLD / 2, r: 75, h: 38 } };
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
  const ctx = { scene, camera, map, hud, sound, fx, input, vm, settings };
  const solo = new ZombiesGame(ctx), client = new ZombiesClient(ctx);
  const onGameOver = (s) => {
    const rounds = `${s.round} round${s.round === 1 ? '' : 's'}`;
    const why = s.why === 'statue' ? `The Golden Tung Tung was smashed in the ${s.room} · ` : '';
    if (!s.coop) { showEnd('GAME OVER', `${why}You reached round ${s.round} · ${s.kills} kills · ${s.headshots} headshots`); return; }
    const rows = s.players.slice().sort((a, b) => b.points - a.points).map((q) => `<tr class="${q.me ? 'me' : ''}"><td>${esc(q.name)}</td>`
      + `<td class="num">${q.kills}</td><td class="num">${q.headshots}</td><td class="num">${q.downs}</td><td class="num">${q.points}</td></tr>`).join('');
    showEnd('GAME OVER', `${why}Your team survived ${rounds}`,
      `<table><tr><th>Player</th><th class="num">Kills</th><th class="num">HS</th><th class="num">Downs</th><th class="num">Points</th></tr>${rows}</table>`);
  };
  solo.onGameOver = client.onGameOver = onGameOver;
  for (const game of [solo, client]) {
    game.onMenu = (tab) => openZMenu(game, tab);
    game.onCaseResult = (ev) => zmenu.caseResult(ev);
  }
  return { scene, sky, fx, game: solo, solo, client, map, exposure: 1.3, orbit: { cx: ZW / 2, cz: ZH / 2, r: 58, h: 34 } };
}

// compile every shader up front so the first shot / first zombie doesn't cause a hitch
const precompile = (w) => { try { renderer.compile(w.scene, camera); } catch (_) { /* best effort */ } return w; };
const classic = precompile(buildClassicWorld());
let zombies = null;
const getZombies = () => (zombies = zombies || precompile(buildZombiesWorld()));
let world = classic;
let session = null;   // the online room you're in, if any
Object.defineProperty(window, '__game', { get: () => world.game }); // handy for debugging in the console
Object.defineProperty(window, '__session', { get: () => session });
window.__worlds = { classic, getZombies };

// ---------- menu ----------
const choice = { mode: 'classic', net: 'solo', team: 'T', difficulty: 'normal', rounds: 8, knife: 'knife', crosshair: 'classic', gfx: quality };
choice.knife = load('defuse.knife') || choice.knife;
choice.crosshair = load('defuse.crosshair') || choice.crosshair;
choice.mode = load('defuse.mode') === 'zombies' ? 'zombies' : 'classic';
choice.net = load('defuse.net') === 'online' || params.has('join') ? 'online' : 'solo';

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
  const z = mode === 'zombies', online = choice.net === 'online';
  document.querySelectorAll('.cs-opt, .solo-opt').forEach((e) => {
    e.classList.toggle('hidden', (z && e.classList.contains('cs-opt')) || (online && e.classList.contains('solo-opt')));
  });
  $('online-opt').classList.toggle('hidden', !online);
  $('online-desc').innerHTML = z
    ? `Co-op for up to ${MAX_PLAYERS.zombies} players: share the zombies, doors and power-ups, and hold <b>E</b> next to a downed teammate to revive them.`
    : `Up to ${MAX_PLAYERS.classic} players. Pick teams in the lobby; bots can fill the empty slots.`;
  $('z-desc').classList.toggle('hidden', !z);
  world = z ? getZombies() : classic; // menu backdrop shows the selected map
  save('defuse.mode', mode);
}
segment('mode-seg', 'mode', String, showMode);
segment('net-seg', 'net', String, (v) => { save('defuse.net', v); netMsg(''); showMode(choice.mode); });
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

let state = 'menu'; // menu | lobby | playing | paused | over | zmenu (a Zombies menu: shop / inventory)
const noPause = params.has('nopause');

function setState(s) {
  state = s;
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('lobby').classList.toggle('hidden', s !== 'lobby');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('endscreen').classList.toggle('hidden', s !== 'over');
  hud.show(s === 'playing' || s === 'paused' || s === 'zmenu');
  if (s !== 'zmenu') zmenu.hide();
  input.active = s === 'playing';
  input.suspended = s !== 'playing';   // online matches keep running behind menus, without your input
  if (s === 'playing') { input.endTick(); tickAcc = 0; } // drop key presses made in menus
}

// Zombies menus: the mouse is let go so you can click (a solo game pauses meanwhile; online it
// keeps running, like the Esc menu). Closing one captures the mouse again.
function openZMenu(game, tab) {
  if (state !== 'playing' || world.game !== game) return;
  zmenu.open(game, tab, !!session);
  setState('zmenu');
  input.unlock();
}
function closeZMenu() {
  zmenu.hide();
  if (state !== 'zmenu') return;
  setState('playing');
  input.lock();
  // (if the browser doesn't give the mouse back, show the pause menu: a click there captures it)
  setTimeout(() => { if (state === 'playing' && !input.locked && !noPause) showPause(); }, 700);
}

// kind: 'pause', or 'ready' when the host has just started a match (a click captures the mouse)
function showPause(kind = 'pause') {
  const online = !!session;
  $('pause-title').textContent = kind === 'ready' ? 'MATCH STARTED' : online ? 'MENU' : 'PAUSED';
  $('pause-note').classList.toggle('hidden', !online || kind === 'ready');
  $('resume').textContent = kind === 'ready' ? 'PLAY' : 'RESUME';
  $('end-match').classList.toggle('hidden', !(online && session.isHost));
  $('quit').textContent = online ? (session.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM') : 'QUIT TO MENU';
  setState('paused');
}

function showEnd(title, score, list = '') {
  input.unlock();
  $('end-title').textContent = title;
  $('end-score').textContent = score;
  $('end-list').innerHTML = list;
  $('again').textContent = session ? 'BACK TO LOBBY' : 'BACK TO MENU';
  if (session?.isHost) session.matchOver();
  setState('over');
}

$('play').addEventListener('click', () => {
  sound.init();
  if (choice.mode === 'zombies') {
    world = getZombies();
    world.game = world.solo;
    world.game.start({ knife: choice.knife });
  } else {
    world = classic;
    world.game = world.solo;
    world.game.start({ team: choice.team, difficulty: choice.difficulty, roundsToWin: choice.rounds, knife: choice.knife });
  }
  setState('playing');
  input.lock();
});
const toMenu = () => { stopMatch(); setState('menu'); showMode(choice.mode); };
$('resume').addEventListener('click', () => { sound.init(); setState('playing'); input.lock(); });
$('quit').addEventListener('click', () => { if (session) leaveRoom(); else toMenu(); });
$('end-match').addEventListener('click', () => {
  if (!session?.isHost) return;
  session.abortMatch();
  backToLobby();
});
$('again').addEventListener('click', () => { if (session) backToLobby(); else toMenu(); });
canvas.addEventListener('click', () => { if (state === 'playing' && !input.locked) input.lock(); });
input.onLockChange = (locked) => {
  if (!locked && state === 'playing' && !noPause) showPause();
};
addEventListener('beforeunload', (e) => { if (state === 'playing' || session) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('pagehide', () => session?.leave());

// ---------- online: rooms and the lobby ----------
const nameEl = $('net-name'), codeEl = $('join-code');
nameEl.value = load('defuse.name') || '';
nameEl.addEventListener('input', () => save('defuse.name', nameEl.value));
codeEl.value = normalizeCode(params.get('join') || '');
codeEl.addEventListener('input', () => { codeEl.value = normalizeCode(codeEl.value); });
codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
function myName() {
  if (!nameEl.value.trim()) { nameEl.value = 'Player' + (10 + Math.floor(Math.random() * 90)); save('defuse.name', nameEl.value); }
  return cleanName(nameEl.value);
}
function netMsg(text, bad = false) { $('net-msg').textContent = text || ''; $('net-msg').classList.toggle('bad', !!bad); }
function lobbyMsg(text, bad = false) { $('lobby-msg').textContent = text || ''; $('lobby-msg').classList.toggle('bad', !!bad); }
function netBusy(on) { for (const id of ['host-btn', 'join-btn']) $(id).disabled = on; }

async function hostRoom() {
  sound.init();
  const s = new Session();
  netBusy(true); netMsg('Creating a room...');
  try { await s.host(myName(), { mode: choice.mode, difficulty: choice.difficulty, rounds: choice.rounds }); } catch (e) { netBusy(false); netMsg(e.message, true); return; }
  netBusy(false); netMsg('');
  enterRoom(s);
}

async function joinRoom() {
  const code = normalizeCode(codeEl.value);
  if (code.length !== 5) { netMsg('Type the 5-character room code from the host.', true); codeEl.focus(); return; }
  sound.init();
  const s = new Session();
  netBusy(true); netMsg(`Joining room ${code}...`);
  try { await s.join(code, myName()); } catch (e) { netBusy(false); netMsg(e.message, true); return; }
  netBusy(false); netMsg('');
  enterRoom(s);
}
$('host-btn').addEventListener('click', hostRoom);
$('join-btn').addEventListener('click', joinRoom);

function enterRoom(s) {
  session = s;
  s.onLobby = renderLobby;
  s.onStart = startOnline;
  s.onGame = (from, msg) => world.game.onNet?.(from, msg);
  s.onAbort = () => { backToLobby(); lobbyMsg('The host ended the match.'); };
  s.onClosed = (why) => leaveRoom(why);
  s.onLeft = (pid) => { if (world.game.running) world.game.removePlayer?.(pid); };
  lobbyMsg(''); $('copy-msg').textContent = '';
  setState('lobby');
  renderLobby(s.lobby);
  syncBackgroundTicker();
}

function leaveRoom(why = '') {
  const s = session;
  session = null;
  stopMatch();
  s?.leave();
  syncBackgroundTicker();
  input.unlock();
  setState('menu');
  showMode(choice.mode);
  netMsg(why, !!why);
}

// end whatever match is running (solo or online) and switch back to the solo games
function stopMatch() {
  for (const w of [classic, zombies]) {
    if (!w) continue;
    for (const g of [w.solo, w.client]) { if (g.running || g.net) g.stop(); g.net = null; }
    w.game = w.solo;
  }
}

function backToLobby() {
  stopMatch();
  input.unlock();
  setState('lobby');
  renderLobby(session?.lobby);
}

function startOnline(info) {
  if (!session) return;
  stopMatch();
  lobbyMsg('');
  const z = info.mode === 'zombies';
  const w = world = z ? getZombies() : classic;
  const net = new NetLink(session), st = info.settings || {};
  if (session.isHost) {
    w.game = w.solo;
    if (z) w.game.start({ knife: choice.knife, net, roster: info.roster });
    else w.game.start({ difficulty: st.difficulty, roundsToWin: st.rounds, knife: choice.knife, net, roster: info.roster });
    setState('playing');
    input.lock();
  } else {
    w.game = w.client;
    w.game.startNet({ knife: choice.knife, net, roster: info.roster, roundsToWin: st.rounds });
    showPause('ready');
  }
}

function markSeg(id, value, enabled = true) {
  for (const b of $(id).querySelectorAll('button')) { b.classList.toggle('on', b.dataset.v === String(value)); b.disabled = !enabled; }
}

function renderLobby(L) {
  if (!L || !session) return;
  const host = session.isHost, z = L.mode === 'zombies';
  $('room-code').textContent = L.code;
  markSeg('lobby-mode', L.mode, host && !L.inGame);
  document.querySelectorAll('.lb-classic').forEach((e) => e.classList.toggle('hidden', z));
  $('lobby-host-opts').classList.toggle('hidden', z || !host);
  markSeg('lobby-bots', L.bots ? '1' : '0'); markSeg('lobby-diff', L.difficulty); markSeg('lobby-rounds', L.rounds);
  const me = L.players.find((p) => p.id === session.myId);
  markSeg('lobby-team', me?.team, !L.inGame);
  const diff = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[L.difficulty] || L.difficulty;
  $('lobby-summary').textContent = z ? 'Survive Sahur Village together. Zombies, doors and power-ups are shared; points and perks are your own.'
    : host ? '' : `${L.bots ? `Bots (${diff}) fill the empty slots` : 'No bots'} · first to ${L.rounds} rounds`;
  // who's here
  const li = (p) => `<li class="${p.id === session.myId ? 'me' : ''}">${esc(p.name)}${p.host ? ' <em>HOST</em>' : ''}${p.id === session.myId ? ' <small>(you)</small>' : ''}</li>`;
  if (z) {
    $('lobby-players').innerHTML = `<div class="lb-teams one"><div class="lb-team z"><h4>Players <span>${L.players.length}/${MAX_PLAYERS.zombies}</span></h4><ul>${L.players.map(li).join('')}</ul></div></div>`;
  } else {
    const col = (t, label) => {
      const list = L.players.filter((p) => p.team === t);
      const bots = L.bots ? TEAM_SIZE - list.length : 0;
      return `<div class="lb-team ${t.toLowerCase()}"><h4>${label} <span>${list.length}/${TEAM_SIZE}</span></h4><ul>${list.map(li).join('')}`
        + `${bots > 0 ? `<li class="bot">+ ${bots} bot${bots === 1 ? '' : 's'}</li>` : ''}</ul></div>`;
    };
    $('lobby-players').innerHTML = `<div class="lb-teams">${col('T', 'Terrorists')}${col('CT', 'Counter-Terrorists')}</div>`;
  }
  $('lobby-start').classList.toggle('hidden', !host);
  $('lobby-start').disabled = L.inGame;
  $('lobby-wait').classList.toggle('hidden', host);
  $('lobby-wait').textContent = L.inGame ? 'A match is in progress. You can play in the next one.' : 'Waiting for the host to start the match...';
  $('lobby-leave').textContent = host ? 'CLOSE ROOM' : 'LEAVE ROOM';
  if (state === 'lobby') world = z ? getZombies() : classic;   // the backdrop shows the map you'll play
}

function lobbySeg(id, apply) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !session) return;
    lobbyMsg('');
    apply(b.dataset.v);
  });
}
lobbySeg('lobby-mode', (v) => { if (session.isHost) { const err = session.setSettings({ mode: v }); if (err) lobbyMsg(err, true); } });
lobbySeg('lobby-team', (v) => {
  const L = session.lobby, me = L.players.find((p) => p.id === session.myId);
  if (me?.team !== v && L.players.filter((p) => p.team === v).length >= TEAM_SIZE) { lobbyMsg('That team is full.', true); return; }
  session.pickTeam(v);
});
lobbySeg('lobby-bots', (v) => session.isHost && session.setSettings({ bots: v === '1' }));
lobbySeg('lobby-diff', (v) => session.isHost && session.setSettings({ difficulty: v }));
lobbySeg('lobby-rounds', (v) => session.isHost && session.setSettings({ rounds: Number(v) }));
$('lobby-start').addEventListener('click', () => { if (session?.isHost && !session.lobby.inGame) { sound.init(); session.start(); } });
$('lobby-leave').addEventListener('click', () => leaveRoom());
$('copy-link').addEventListener('click', () => {
  if (!session) return;
  const q = new URLSearchParams();
  q.set('join', session.code);
  if (params.get('net')) q.set('net', params.get('net'));   // keep the same-browser test mode
  const url = `${location.origin}${location.pathname}?${q}`;
  const done = (ok) => { $('copy-msg').textContent = ok ? 'Copied! Send it to your friends.' : url; };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
  else done(false);
});

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
  if ((state === 'playing' || state === 'paused' || state === 'zmenu' || state === 'test') && p?.alive && !p.scoped) {
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

// Run the game for dt seconds. Returns true if a match is running.
// Online matches keep running while a menu is open: nobody else can be paused.
function advance(dt) {
  const g = world.game;
  const live = state === 'playing' || (!!session && g.running && (state === 'paused' || state === 'over' || state === 'zmenu'));
  if (live) {
    step(dt);
    if (g.player?.alive) vm.update(dt, g.player, g, input.dx, input.dy);
    hud.update(dt, g);
  }
  if (session) {
    if (g.net && (g.running || g.net.pending())) g.netUpdate(dt);
    session?.update();
  }
  return live;
}

let lastFrameAt = 0;   // when the browser last drew a frame
function frame() {
  requestAnimationFrame(frame);
  const now = lastFrameAt = performance.now();
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  if (!advance(dt) && (state === 'menu' || state === 'lobby')) {
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

// Browsers stop drawing tabs and windows you can't see. While you're in a room, a small worker
// keeps the match (and the connection) ticking whenever drawing stops, so the host can switch
// tabs or windows without freezing the game for everyone.
const bgWorker = (() => {
  try {
    const src = 'let t=0;onmessage=(e)=>{clearInterval(t);t=e.data>0?setInterval(()=>postMessage(0),e.data):0;};';
    return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (_) { return null; }
})();
if (bgWorker) {
  bgWorker.onmessage = () => {
    const now = performance.now();
    if (!session || now - lastFrameAt < 250) return;   // frames are being drawn: the normal loop runs the game
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (dt > 0) { advance(dt); input.endFrame(); }
  };
}
function syncBackgroundTicker() { bgWorker?.postMessage(session ? 33 : 0); }

// debug helper: advance the simulation without relying on requestAnimationFrame
window.__sim = (seconds = 1, fps = 60) => {
  const g = world.game;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    step(1 / fps);
    if (g.player?.alive) vm.update(1 / fps, g.player, g, 0, 0);
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
if (params.has('join')) { netMsg('Type your name, then press JOIN.'); (nameEl.value ? $('join-btn') : nameEl).focus(); }
requestAnimationFrame(frame);
