// Online play. One player hosts: their browser runs the match for everyone, and friends join
// with a 5-letter room code. Browsers talk to each other directly over WebRTC (PeerJS); the
// free public PeerJS server is only used to find each other, so there is no game server to run.
//
// Test option: add ?net=local to the URL to connect tabs of the same browser without the
// internet (and &lag=150 to fake a 150 ms round trip).

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const ID_PREFIX = 'tungtung-shooter-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROTOCOL = 4;   // bump when host and players must run the same version (4: bigger Zombies map)
export const MAX_PLAYERS = { classic: 10, zombies: 4 };
export const TEAM_SIZE = 5;
export const BOT_NAMES = {
  T: ['Viper', 'Rook', 'Jackal', 'Nomad', 'Brick'],
  CT: ['Falcon', 'Ghost', 'Atlas', 'Hawk', 'Mason'],
};
const TIMEOUT_MS = 10000;   // silence before a connection counts as lost

export class NetError extends Error {}

export function cleanName(s) {
  const n = String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return n || 'Player';
}
export function normalizeCode(s) { return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
function randomCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

function friendly(e) {
  if (e instanceof NetError) return e;
  switch (e?.type) {
    case 'browser-incompatible': return new NetError('This browser does not support online play.');
    case 'peer-unavailable': return new NetError('Room not found. Check the code and try again.');
    case 'unavailable-id': return new NetError('Could not create a room. Try again.');
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': case 'ssl-unavailable':
      return new NetError('Could not reach the matchmaking server. Check your internet connection and try again.');
    default: return new NetError(e?.message || 'Connection failed. Try again.');
  }
}

// ---------------------------------------------------------------- transports
// One open connection to another browser.
class Conn {
  constructor(send, close) { this._send = send; this._close = close; this.closed = false; this.onmessage = null; this.onclose = null; }
  send(m) { if (!this.closed) this._send(m); }
  close() { if (this.closed) return; this.closed = true; this._close(); }
  _recv(m) { if (!this.closed) this.onmessage?.(m); }
  _ended() { if (this.closed) return; this.closed = true; this.onclose?.(); }
}

let peerLib = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new NetError('Online play failed to load.')));
      s.onerror = () => { peerLib = null; s.remove(); reject(new NetError('Could not load online play. Check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return peerLib;
}

class PeerTransport {
  async open(id) {
    const Peer = await loadPeerJS();
    await new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      const fail = (e) => { try { peer.destroy(); } catch (_) { /* already gone */ } reject(e); };
      peer.once('error', fail);
      peer.once('open', () => { peer.off('error', fail); this.peer = peer; resolve(); });
    });
    this.peer.on('error', (e) => this.onError?.(e));
    // lost the matchmaking server: games in progress keep working, but try to get back for new joins
    this.peer.on('disconnected', () => { setTimeout(() => { try { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); } catch (_) { /* ignored */ } }, 1500); });
  }

  listen(onConn) {
    this.peer.on('connection', (raw) => raw.on('open', () => onConn(this.wrap(raw))));
  }

  connect(id) {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      const raw = peer.connect(id, { reliable: true, serialization: 'json' });
      const done = () => { clearTimeout(timer); peer.off('error', onErr); };
      const fail = (e) => { done(); try { raw.close(); } catch (_) { /* ignored */ } reject(e); };
      const onErr = (e) => { if (e?.type === 'peer-unavailable') fail(e); };
      const timer = setTimeout(() => fail(new NetError('Could not connect to that room. Check the code, or try again.')), 15000);
      peer.on('error', onErr);
      raw.on('open', () => { done(); resolve(this.wrap(raw)); });
    });
  }

  wrap(raw) {
    const c = new Conn((m) => { try { raw.send(m); } catch (_) { c._ended(); } }, () => { try { raw.close(); } catch (_) { /* ignored */ } });
    raw.on('data', (m) => c._recv(m));
    raw.on('close', () => c._ended());
    raw.on('error', () => c._ended());
    return c;
  }

  close() { try { this.peer?.destroy(); } catch (_) { /* ignored */ } this.peer = null; }
}

// Same-browser stand-in for testing: tabs talk over a BroadcastChannel.
class LocalTransport {
  constructor(lag = 0) { this.lag = lag; this.conns = new Map(); this.lastAt = 0; }

  async open(id) {
    this.id = id || 'c' + Math.random().toString(36).slice(2, 10);
    this.bc = new BroadcastChannel('tungtung-local-net');
    this.bc.onmessage = (e) => this.route(e.data);
  }

  post(m) {
    if (!this.lag) { this.bc?.postMessage(m); return; }
    // fake latency, keeping messages in order like a real connection
    const now = performance.now();
    this.lastAt = Math.max(this.lastAt, now + this.lag / 2 * (0.8 + Math.random() * 0.4));
    setTimeout(() => this.bc?.postMessage(m), this.lastAt - now);
  }

  makeConn(other) {
    const c = new Conn((m) => this.post({ k: 'msg', from: this.id, to: other, d: JSON.stringify(m) }),
      () => { this.post({ k: 'close', from: this.id, to: other }); this.conns.delete(other); });
    this.conns.set(other, c);
    return c;
  }

  route(m) {
    if (!m || m.to !== this.id) return;
    if (m.k === 'open' && this.onConn) { const c = this.makeConn(m.from); this.post({ k: 'ack', from: this.id, to: m.from }); this.onConn(c); }
    else if (m.k === 'ack') this.pending?.(m.from);
    else if (m.k === 'msg') this.conns.get(m.from)?._recv(JSON.parse(m.d));
    else if (m.k === 'close') { const c = this.conns.get(m.from); this.conns.delete(m.from); c?._ended(); }
  }

  listen(onConn) { this.onConn = onConn; }

  connect(id) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending = null; reject(new NetError('Room not found. Check the code and try again.')); }, 3000);
      this.pending = (from) => { if (from !== id) return; clearTimeout(t); this.pending = null; resolve(this.makeConn(id)); };
      this.post({ k: 'open', from: this.id, to: id });
    });
  }

  close() { for (const c of [...this.conns.values()]) c.close(); this.bc?.close(); this.bc = null; }
}

// ---------------------------------------------------------------- session (room + lobby)
export class Session {
  constructor() {
    const q = new URLSearchParams(location.search);
    this.transport = q.get('net') === 'local' ? new LocalTransport(+q.get('lag') || 0) : new PeerTransport();
    this.role = null;          // 'host' | 'client'
    this.code = null; this.myId = null; this.lobby = null;
    this.peers = new Map();    // host: player id -> {conn, heard}; client: 'h' -> the host
    this.nextId = 1; this.pingT = 0; this.closed = false;
    // callbacks
    this.onLobby = null; this.onStart = null; this.onGame = null; this.onAbort = null; this.onClosed = null; this.onLeft = null;
  }

  get isHost() { return this.role === 'host'; }

  // ----- hosting -----
  async host(name, { mode = 'classic', difficulty = 'normal', rounds = 8 } = {}) {
    let err = null;
    for (let i = 0; i < 5 && !this.code; i++) {
      const code = randomCode();
      try { await this.transport.open(ID_PREFIX + code); this.code = code; } catch (e) { err = e; if (e?.type !== 'unavailable-id') break; }
    }
    if (!this.code) { this.close(); throw friendly(err); }
    this.role = 'host'; this.myId = 'h';
    this.lobby = {
      code: this.code, mode, difficulty, rounds, bots: true, inGame: false,
      players: [{ id: 'h', name: cleanName(name), team: 'T', host: true }],
    };
    this.transport.onError = (e) => console.warn('[net]', e?.type || e);
    this.transport.listen((conn) => this.accept(conn));
  }

  accept(conn) {
    const timer = setTimeout(() => conn.close(), 10000);
    conn.onclose = () => clearTimeout(timer);
    conn.onmessage = (m) => {
      if (m?.t !== 'hello') return;
      clearTimeout(timer);
      const L = this.lobby;
      const deny = (why) => { conn.send({ t: 'deny', why }); setTimeout(() => conn.close(), 500); };
      if (this.closed) return deny('That room was closed.');
      if (m.v !== PROTOCOL) return deny('That room is running a different version of the game. Both players should reload the page.');
      if (L.inGame) return deny('That match has already started. Ask the host to go back to the lobby, then join again.');
      if (L.players.length >= MAX_PLAYERS[L.mode]) return deny('That room is full.');
      const id = 'p' + this.nextId++;
      L.players.push({ id, name: this.uniqueName(cleanName(m.name)), team: this.openTeam() });
      const peer = { conn, heard: performance.now() };
      this.peers.set(id, peer);
      conn.onmessage = (msg) => { peer.heard = performance.now(); this.fromClient(id, msg); };
      conn.onclose = () => this.drop(id);
      conn.send({ t: 'welcome', id });
      this.pushLobby();
    };
  }

  openTeam() {
    const n = (t) => this.lobby.players.filter((p) => p.team === t).length;
    return n('CT') < n('T') ? 'CT' : 'T';
  }

  uniqueName(name) {
    const taken = new Set(this.lobby.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) { const n = name.slice(0, 12) + i; if (!taken.has(n.toLowerCase())) return n; }
  }

  fromClient(id, m) {
    switch (m?.t) {
      case 'g': this.onGame?.(id, m); break;
      case 'team': this.setTeam(id, m.team); break;
      case 'bye': this.drop(id); break;
    }
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.conn.close();
    const L = this.lobby, i = L.players.findIndex((p) => p.id === id);
    const name = i >= 0 ? L.players[i].name : 'A player';
    if (i >= 0) L.players.splice(i, 1);
    if (L.inGame) this.onLeft?.(id, name);
    this.pushLobby();
  }

  setTeam(id, team) {
    const L = this.lobby;
    if (L.inGame || (team !== 'T' && team !== 'CT')) return;
    const p = L.players.find((x) => x.id === id);
    if (!p || p.team === team || L.players.filter((x) => x.team === team).length >= TEAM_SIZE) return;
    p.team = team;
    this.pushLobby();
  }

  // host: change match settings. Returns an error message, or null.
  setSettings(patch) {
    const L = this.lobby;
    if (L.inGame) return null;
    if (patch.mode && patch.mode !== L.mode && L.players.length > MAX_PLAYERS[patch.mode]) {
      return `Zombies co-op is for up to ${MAX_PLAYERS.zombies} players.`;
    }
    for (const k of ['mode', 'difficulty', 'rounds', 'bots']) if (k in patch) L[k] = patch[k];
    this.pushLobby();
    return null;
  }

  pushLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.onLobby?.(this.lobby);
  }

  // who plays which fighter: network id (nid), name, team, and the player id for people
  roster() {
    const L = this.lobby, roster = [];
    if (L.mode === 'zombies') {
      for (const p of L.players) roster.push({ nid: roster.length, name: p.name, team: 'P', pid: p.id, kind: 'human' });
      return roster;
    }
    const taken = new Set(L.players.map((p) => p.name.toLowerCase()));
    for (const team of ['T', 'CT']) {
      const mine = L.players.filter((p) => p.team === team);
      for (const p of mine) roster.push({ nid: roster.length, name: p.name, team, pid: p.id, kind: 'human' });
      if (!L.bots) continue;
      const names = BOT_NAMES[team].filter((n) => !taken.has(n.toLowerCase()));
      for (let i = mine.length; i < TEAM_SIZE; i++) roster.push({ nid: roster.length, name: names[i - mine.length] || `Bot ${i + 1}`, team, kind: 'bot' });
    }
    return roster;
  }

  start() {
    const L = this.lobby;
    L.inGame = true;
    const info = { t: 'start', mode: L.mode, settings: { difficulty: L.difficulty, rounds: L.rounds, bots: L.bots }, roster: this.roster() };
    this.pushLobby();
    this.broadcast(info);
    this.onStart?.(info);
  }
  matchOver() { if (this.lobby.inGame) { this.lobby.inGame = false; this.pushLobby(); } }
  abortMatch() { this.lobby.inGame = false; this.broadcast({ t: 'abort' }); this.pushLobby(); }

  // ----- joining -----
  async join(code, name) {
    code = normalizeCode(code);
    if (code.length !== 5) throw new NetError('Room codes have 5 letters and numbers.');
    try {
      await this.transport.open(null);
      const conn = await this.transport.connect(ID_PREFIX + code);
      const peer = { conn, heard: performance.now() };
      this.peers.set('h', peer);
      this.code = code;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new NetError('The host did not answer. Try again.')), 10000);
        conn.onclose = () => { clearTimeout(t); reject(new NetError('The host closed the connection.')); };
        conn.onmessage = (m) => {
          peer.heard = performance.now();
          if (m?.t === 'welcome') { clearTimeout(t); this.myId = m.id; resolve(); }
          else if (m?.t === 'deny') { clearTimeout(t); reject(new NetError(m.why || 'The host refused the connection.')); }
          else if (m?.t === 'lobby') this.lobby = m.lobby;
        };
        conn.send({ t: 'hello', v: PROTOCOL, name: cleanName(name) });
      });
      this.role = 'client';
      conn.onmessage = (m) => { peer.heard = performance.now(); this.fromHost(m); };
      conn.onclose = () => this.lost('Lost the connection to the host.');
    } catch (e) {
      this.close();
      throw friendly(e);
    }
  }

  fromHost(m) {
    switch (m?.t) {
      case 'lobby': this.lobby = m.lobby; this.onLobby?.(m.lobby); break;
      case 'start': this.onStart?.(m); break;
      case 'g': this.onGame?.('h', m); break;
      case 'abort': this.onAbort?.(); break;
      case 'closed': this.lost(m.why || 'The host closed the room.'); break;
    }
  }

  lost(why) {
    if (this.closed) return;
    this.close();
    this.onClosed?.(why);
  }

  // ----- both -----
  pickTeam(team) {
    if (this.isHost) this.setTeam('h', team);
    else this.send('h', { t: 'team', team });
  }

  send(id, msg) { this.peers.get(id)?.conn.send(msg); }
  broadcast(msg) { for (const p of this.peers.values()) p.conn.send(msg); }

  // called every frame: keep-alive pings and dropped-connection checks
  update() {
    if (this.closed || !this.role) return;
    const now = performance.now();
    if (now - this.pingT > 1000) { this.pingT = now; this.broadcast({ t: 'ping' }); }
    for (const [id, p] of this.peers) {
      if (now - p.heard < TIMEOUT_MS) continue;
      if (this.isHost) this.drop(id);
      else { this.lost('Lost the connection to the host.'); return; }
    }
  }

  leave() {
    if (this.closed) return;
    if (this.isHost) this.broadcast({ t: 'closed', why: 'The host closed the room.' });
    else this.send('h', { t: 'bye' });
    this.closed = true;
    const tr = this.transport, peers = [...this.peers.values()];
    this.peers.clear();
    setTimeout(() => { for (const p of peers) p.conn.close(); tr.close(); }, 300); // let the goodbye go out first
  }

  close() {
    this.closed = true;
    for (const p of this.peers.values()) p.conn.close();
    this.peers.clear();
    this.transport.close();
  }
}

// ---------------------------------------------------------------- per-match message batching
// Game events are queued per receiver (keeping their order) and sent together with the
// regular state update: the host sends snapshots 25 times a second, players send their own
// state 30 times a second.
export class NetLink {
  constructor(session) {
    this.session = session;
    this.role = session.role;
    this.myId = session.myId;
    this.queues = new Map();
    this.acc = 0;
    this.interval = this.role === 'host' ? 1 / 25 : 1 / 30;
  }

  queue(id) { let q = this.queues.get(id); if (!q) this.queues.set(id, (q = [])); return q; }

  // host: to every player (except one); player: to the host
  emit(ev, except = null) {
    if (this.role !== 'host') { this.queue('h').push(ev); return; }
    for (const id of this.session.peers.keys()) if (id !== except) this.queue(id).push(ev);
  }
  emitTo(id, ev) { if (id && this.session.peers.has(id)) this.queue(id).push(ev); }

  // events still waiting to go out (e.g. "match over" after the match stopped)
  pending() { for (const q of this.queues.values()) if (q.length) return true; return false; }

  take(id) {
    const q = this.queues.get(id);
    if (!q || !q.length) return undefined;
    this.queues.set(id, []);
    return q;
  }

  update(dt, payload) {
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = Math.min(this.acc - this.interval, this.interval);
    const data = payload?.();
    if (this.role !== 'host') { this.session.send('h', { t: 'g', st: data, ev: this.take('h') }); return; }
    for (const id of this.session.peers.keys()) this.session.send(id, { t: 'g', s: data, ev: this.take(id) });
  }
}
