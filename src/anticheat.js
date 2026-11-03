// Anticheat, run by the host in online matches. Each joining player's browser reports where it
// is, its ammo, its shots and its hits. The host checks every report against what the game
// allows and ignores the impossible ones. Each failed check adds suspicion points, which are
// slowly forgiven; a player who reaches KICK_AT (AIM_KICK_AT for aim cheats) is banned from the
// room (see Session.ban: their name and browser can't join again).
//
// It can't see inside a player's browser, so it only catches what a cheat has to tell the host:
// moving too fast or through walls, flying, guns or ammo the host never gave, firing too fast
// (or before the gun is out), reloading faster than the gun can, bullets that don't kick the
// way the gun kicks (no recoil), and hits that weren't possible (no shot, too far, through a
// wall, not aimed that way).
//
// It also watches where each player looks (sent 30 times a second) for what aim cheats do:
// aim that stays locked on a moving target, one-update snaps that land exactly on a target,
// shots fired the instant a target walks into a still crosshair (triggerbot), spinning faster
// than a mouse can (spinbot), shots that don't go where the player looks, and aim that follows
// someone through a wall. A small neural network (aimml.js) also scores every second of aim at
// an enemy for how human it moves: reaction delays, overshoots and corrections, shake. In 5v5
// it also stops sending each player the positions of enemies they can't see, so a wallhack has
// nothing to draw.
//
// Fakes (5v5): each living player is also sent made-up enemies. They are never where the player
// can see them, so a fair player never sees one, can't hit one and doesn't bump into one:
//  - a decoy: one hidden enemy at a fake spot, a "floating tung" just behind a wall near their
//    crosshair, drifting side to side (it's close to the crosshair and nearly dead, so an
//    aimbot picks it);
//  - walkers: the other hidden enemies, each shift-walking (silently) back and forth behind a wall
//    somewhere around them, looking just like a real enemy;
//  - phantoms: PHANTOMS more enemies, running around the map, that only exist in the network
//    messages. The game skips enemies it doesn't know, so it never draws them; a cheat that
//    reads the messages does.
// A wallhack fills up with them. Aim that follows one, lands on the decoy after it moves, shoots
// at the decoy, or hits any of them is a cheat.
import * as THREE from 'three';
import { raycast, wrapAngle } from './physics.js';
import { dirFrom, RUN_SPEED } from './combatant.js';
import { F, r1, r2, r3 } from './avatar.js';
import { WORLD } from './map.js';
import { aimScore, AIM_THRESHOLD } from './aimml.js';

const KICK_AT = 9;                    // suspicion points (movement, guns, hits)
const AIM_KICK_AT = 6;                // aim cheat points
const FORGIVE = 0.2;                  // points forgiven per second
const FORGIVE_AIM = 1 / 300;          // aim cheat points forgiven per second (one every 5 minutes)
const AIM_CHEATS = new Set(['aimlock', 'snap', 'trigger', 'spin', 'pitch', 'silent', 'esp', 'decoy', 'unseen', 'ml']);
const COOLDOWN = 1;                   // s: the same check adds points at most once a second
const KEEP = 2;                       // s of past positions kept for every fighter and zombie
const MAX_RUN = 10;                   // m/s sideways (running is 6.35; bunny hops go a bit faster)
const RUN_SLACK = 3;                  // m, for updates that arrive bunched up
const MAX_RISE = 8, RISE_SLACK = 2;   // m/s and m upwards (a jump starts at 7.7 m/s)
const MAX_GAP = 8;                    // m between where a player says they are and where the host has them
const HELD_LIMIT = 2.5;               // s in a row of being held back by the speed limit
const AIR_LIMIT = 3;                  // s off the ground (a jump lasts under a second)
const AIM_SLACK = 0.7;                // rad between where a player looks and what they hit (recoil, spread, lag)

// speed on the ground: no faster than their gun lets anyone run (+12% and 0.15 m/s); up to
// SPEED_BANK m saved up from walking slower, SPEED_DEBT m over is a speed hack (that's more
// than the steady clock can be off by: 0.3 s of running)
const SPEED_SLACK = 1.12, SPEED_ADD = 0.15, SPEED_BANK = 0.8, SPEED_DEBT = 1.6;
const PUSH_SKIP = 1;                  // s after the host pushed them (a zombie's hit) not checked

// guns
const RELOAD_SLACK = 0.8, RELOAD_LAG = 0.15;   // a reload takes at least 80% of its time (-0.15 s for timing)
const RATE_RUN = 30, RATE_MIN = 15;   // fire rate over a run of up to 30 shots (judged from 15)...
const RATE_SLACK = 0.94;              // ...at most 6% faster than the gun (see fireRate)
const DRAW_SLACK = 0.6, DRAW_N = 3, DRAW_WIN = 30;   // firing before 60% of the draw time, 3 times in 30 s
// recoil: from the 4th shot of a spray, bullets go above the crosshair by a set amount (see
// Combatant.recoilPitch). Over a spray (6+ such shots, 7+ degrees expected in all) they must
// have gone at least 35% as high as that.
const RECOIL_MIN = 6, RECOIL_SUM = 0.12, RECOIL_RATIO = 0.35, RECOIL_RUN = 12;

// aim (angles in radians; 1 degree = 0.0175)
const DEG = Math.PI / 180;
const LOOK_KEEP = 1.5;                // s of view updates kept per player
const MAX_PITCH = 89 * DEG + 0.01;    // the game never lets you look further up or down
const SPIN_WIN = 1.5, SPIN_RATE = 25; // s, rad/s: about 4 full turns a second, kept up for 1.5 s
const LOCK_WIN = 0.8;                 // s of tracking looked at for a locked aim
const LOCK_RMS = 0.7 * DEG;           // locked: average error under this...
const LOCK_MAX = 1.8 * DEG;           // ...and never off by more than this, the whole time
const SWEEP = 9 * DEG;                // the target crossed at least this much of their view meanwhile
const ESP_RMS = 2.5 * DEG;            // following someone behind a wall this closely
const SNAP_MIN = 20 * DEG;            // a snap: the view turns this much within SNAP_TIME...
const SNAP_TIME = 0.15;               // s (smoothed aimbots take a few updates)
const SNAP_ON = 0.1, SNAP_ON0 = 0.35 * DEG;   // ...and stops within 10 cm (+0.35 degrees) of the middle of a head or chest...
const SNAP_SHOT = 0.3;                // ...and they fire within this many seconds
const TRIG_KEEP = 5, TRIG_AT = 3;     // triggerbot: of the last 5 reaction shots, 3 were instant...
const TRIG_N = 2;                     // ...(fired within 2 updates, ~65 ms, of the target arriving)
const VIEW_DELAY = 0.1;               // s: players draw others this far behind the host's snapshots
const LAG0 = 0.05;                    // s: round trip time until it's measured
const LAG_FIT = 0.06;                 // s either side of that delay tried (timing jitter)

// the aim network: a window of ML_WIN s scored every ML_EVERY s while an enemy is near the
// crosshair. A fight's scores are averaged (judged once it has ML_MIN, or every ML_LONG); a
// fight over the threshold adds ML_PTS aim points, so 4 such fights ban.
const ML_EVERY = 0.25, ML_WIN = 1, ML_GAP = 0.6, ML_MIN = 3, ML_LONG = 8, ML_PTS = 1.5;

// what each player is sent in 5v5
const VIS_EVERY = 0.1;                // s between line of sight checks
const VIS_HOLD = 0.4;                 // s an enemy stays sent after they were last in sight
const NEAR = 4, HEAR = 20, AHEAD = 0.25;   // m, m (footsteps), s (peeking)
const GUNSHOT = 50, SHOT_SHOW = 0.8;  // m, s: someone who just fired nearby is sent (farther away, only roughly where the shot came from)
const SHOT_FUZZ = 2.5;                // m

// the decoy
const DECOY_MIN = 2.5, DECOY_MAX = 20;     // m from their eyes
const DECOY_STEP = 0.5, DECOY_THICK = 10;  // m: stepping through a wall to open space behind it, up to this thick
const DECOY_AMP = 0.9, DECOY_W = 1.7;      // m, rad/s: it drifts side to side along the wall
const DECOY_UP = 0.55;                     // m it floats above the floor
const DECOY_LIFE = 4, DECOY_LIFE_RAND = 4; // s before it moves somewhere new
const DECOY_TURN = 80 * DEG;               // moved when it's further than this from where they look (or than where it started, +30)
// tried in turn: a little off their crosshair (so a still crosshair isn't on it by chance), nearest
// first; out in the open, anywhere around them
const DECOY_OFF = [9, 14, 20, 28, 38, 50, 65, 80, 100, 125, 150, 175].map((d) => d * DEG);
const DECOY_KEEP = 2;                      // s of fake positions kept per player
const DTRACK_WIN = 0.6, DTRACK_RMS = 2 * DEG, DTRACK_MAX = 4 * DEG, DTRACK_MOVE = 3 * DEG;   // following a fake
const DSNAP_FROM = 10 * DEG, DSNAP_ON = 2 * DEG, DSNAP_TIME = 0.8, DSNAP_HOLD = 3;          // landing on the decoy after it moved
const DSHOT_ON = 1.2 * DEG;                // shooting at the decoy
const REAL_NEAR = 3 * DEG;                 // ...unless a real enemy is this close to the crosshair
// walkers
const WALKERS = 4;                         // at most this many (one per other hidden enemy)
const WALK_MIN = 3, WALK_MAX = 25;         // m from their eyes to the wall in front of it
const WALK_LEN = [1.5, 4], WALK_SPEED = [1.6, 3.2];   // m back and forth, m/s (shift-walking: silent)
const WALK_LIFE = [5, 10];                 // s before it moves somewhere new
const WALK_EVERY = 0.3, WALK_CHECK = 0.2, WALK_REST = 0.5;   // s between placements, sight checks, reusing an enemy
const WALK_OFF = 30 * DEG;                 // placed at least this far from their crosshair
// phantoms
const PHANTOMS = 8;                        // per player (each costs ~1 KB/s of the host's upload per player)
const PH_NEAR = 6, PH_FAR = 35, PH_LOST = 45;   // m: placed this far away, moved when further than PH_LOST
const PH_SPEED = [2.5, 6.3], PH_LEG = [3, 12], PH_PAUSE = 0.25;   // m/s, m between turns, chance to stop at each
const GUNS = { T: ['ak', 'ak', 'pistol', 'deagle', 'sniper', 'smg', 'm16'], CT: ['m4', 'm4', 'pistol', 'deagle', 'sniper', 'smg', 'scout'] };

// what the banned player is told
const REASONS = {
  teleport: 'teleporting', speed: 'moving too fast', wall: 'walking through walls', fly: 'flying',
  gun: 'using a gun the host never gave you', ammo: 'giving yourself ammo', rate: 'firing too fast',
  empty: 'firing without ammo', noshot: 'hits without shots', through: 'shooting through walls',
  range: 'hitting from too far away', aim: 'hitting what you were not aiming at', damage: 'too much damage',
  reload: 'reloading faster than the gun can', instafire: 'firing before the gun is out', recoil: 'no recoil',
  aimlock: 'aimbot (aim locked onto targets)', snap: 'aimbot (snapping onto targets)',
  trigger: 'triggerbot (firing the instant a target is under the crosshair)', spin: 'spinbot',
  pitch: 'impossible view angles', silent: 'shots that don\'t go where you look',
  esp: 'wallhack (following players through walls)', ml: 'aimbot (aim that doesn\'t move like a person\'s)',
  decoy: 'wallhack / aimbot (aiming at fake players only cheats can see)', unseen: 'hitting an enemy you could not see',
};

const _e = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _hit = {};
const _q = { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, cx: 0, cy: 0, cz: 0 };
const _o = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rand = (a, b) => a + (b - a) * Math.random();

// angle between a unit direction (dx, dy, dz) and the line from (ex, ey, ez) to (px, py, pz)
function angleTo(dx, dy, dz, ex, ey, ez, px, py, pz) {
  const vx = px - ex, vy = py - ey, vz = pz - ez, len = Math.hypot(vx, vy, vz);
  if (len < 1e-6) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (dx * vx + dy * vy + dz * vz) / len)));
}
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dy * b.dy + a.dz * b.dz)));

// how many things one shot of this gun can hit (pellets, piercing, lightning, explosions)
const hitsPerShot = (d) => (d.pellets || 1) * (d.pierce ? 8 : 1) + (d.chain ? d.chain.jumps : 0) + (d.splash ? 24 : 0) + 1;

export class Anticheat {
  constructor(game) {
    this.game = game;
    this.hist = new WeakMap();   // fighter or zombie -> [{t, x, y, z, yaw, pitch}], oldest first
    this.recT = -1;
    this.selfPs = [];            // the host's own fights, scored by the aim network (see mlThreshold)
  }

  // ---------- bookkeeping ----------
  // per-player state, made on first use
  st(av) {
    if (!av.ac) {
      const p = av.body.pos;
      av.ac = {
        pts: 0, ptsT: this.game.time, apts: 0, aptsT: this.game.time, cool: {},
        pos: { x: p.x, y: p.y, z: p.z }, rep: { x: p.x, y: p.y, z: p.z }, t: this.game.time,
        run: RUN_SLACK, rise: RISE_SLACK, air: 0, held: 0,
        credit: 3, creditT: this.game.time, tokens: 0, tokT: -9, mtok: 0, mT: -9,
        // aim: view updates [{t, ts, x, y, z (eyes), yaw, pitch, dx, dy, dz (view direction)}], oldest first
        // (t: when it arrived, ts: a steadier estimate of when it was sent, see clock())
        aim: [], lag: LAG0 + VIEW_DELAY, evalT: -9, spin: [], snapT: -9, snapOn: false, lastShotT: -9, react: [],
        clk: null, clkD: 0, gc: null, wc: null, mlT: -9, eng: null,
        // movement on the ground: metres still allowed (see groundSpeed), when last pushed
        bank: SPEED_BANK, pushT: -9,
        // guns: shot times per slot ({key, ts, since}), the current run of shots, recoil, draws
        wshots: {}, fire: { key: null, ts: [], same: 0 }, rc: { key: null, n: 0, t: -9, m: 0, e: 0, c: 0 }, swT: -9, draws: [],
        // 5v5: the fakes they're sent, what their view did around them, and when each enemy was
        // last sent to them for real (nid -> time)
        decoy: null, dview: [], dsnap: null, realT: null,
      };
    }
    return av.ac;
  }

  // the host placed this player (round start, respawn): positions start over from here
  spawned(av) {
    const s = this.st(av), p = av.body.pos;
    Object.assign(s.pos, { x: p.x, y: p.y, z: p.z }); Object.assign(s.rep, s.pos);
    s.t = this.game.time; s.run = RUN_SLACK; s.rise = RISE_SLACK; s.air = 0; s.held = 0;
    s.aim.length = 0; s.spin.length = 0; s.snapOn = false; s.eng = null;
    s.bank = SPEED_BANK; s.gx = undefined;
    s.wshots = {}; s.fire.ts.length = 0; s.rc.n = 0; s.rc.c = 0; s.rc.m = s.rc.e = 0; s.swT = -9;
    s.decoy = null; s.dview.length = 0; s.dsnap = null;
  }

  // the host pushed them (a zombie's hit): a burst of speed that isn't theirs
  pushed(av) { if (av?.isAvatar) this.st(av).pushT = this.game.time; }

  // they switched weapons (the new one takes its draw time to come out)
  switched(av) { this.st(av).swT = this.game.time; }

  // a new round: everyone moved, so line of sight is worked out again
  newRound() { this.seen?.clear(); }

  // every host tick: remember where everyone was (as other players are sent it), for checking
  // hits and aim a moment later
  record(...lists) {
    const now = this.game.time;
    this.selfAim();
    if (now - this.recT < 1 / 40) return;
    this.recT = now;
    for (const list of lists) for (const c of list) {
      if (!c.alive || c.active === false) continue;
      let h = this.hist.get(c);
      if (!h) this.hist.set(c, (h = []));
      const p = (c.isAvatar && c.interp?.latest) || c.body.pos;
      const bp = c.body.pos, hd = c.headPos ? c.headPos(_a) : _a.set(bp.x, bp.y + 1.63, bp.z), ch = c.chestPos(_b);
      h.push({
        t: now, x: p.x, y: p.y, z: p.z, yaw: c.yaw, pitch: c.pitch || 0,
        hx: hd.x - bp.x, hy: hd.y - bp.y, hz: hd.z - bp.z, cx: ch.x - bp.x, cy: ch.y - bp.y, cz: ch.z - bp.z,
      });
      while (h.length && h[0].t < now - KEEP) h.shift();
    }
  }

  // where a target was at time t (between two recorded moments), or null if that's too long ago
  posAt(target, t, out = _q) {
    const h = this.hist.get(target);
    if (!h || !h.length || t < h[0].t) return null;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t > t) i--;
    const b = h[i], a = i > 0 ? h[i - 1] : b;
    const k = t >= b.t || b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    for (const key of ['x', 'y', 'z', 'hx', 'hy', 'hz', 'cx', 'cy', 'cz']) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  }

  // a failed check: add points, ban at KICK_AT
  // Aim cheats show up once per gunfight, so their points are kept in a second pool that is
  // forgiven much more slowly and bans sooner.
  flag(av, why, pts) {
    if (!av?.isAvatar || av.kicked) return;
    const s = this.st(av), now = this.game.time, slow = AIM_CHEATS.has(why);
    s.pts = Math.max(0, s.pts - (now - s.ptsT) * FORGIVE); s.ptsT = now;
    s.apts = Math.max(0, s.apts - (now - s.aptsT) * FORGIVE_AIM); s.aptsT = now;
    if (now - (s.cool[why] ?? -9) < COOLDOWN) return;
    s.cool[why] = now;
    if (slow) s.apts += pts; else s.pts += pts;
    const total = slow ? s.apts : s.pts, limit = slow ? AIM_KICK_AT : KICK_AT;
    console.warn(`[anticheat] ${av.name}: ${REASONS[why] || why} (+${pts}, now ${total.toFixed(1)} of ${limit})`);
    if (total >= limit) this.kick(av, why);
  }

  kick(av, why) {
    av.kicked = true; av.kickedBy = 'anticheat';
    const g = this.game;
    console.warn(`[anticheat] banned ${av.name} (${REASONS[why] || why})`);
    g.net?.session?.ban(av.pid, `You were banned by the anticheat (${REASONS[why] || why}).`);
  }

  // shots and knife swings first: a hit is reported just before the shot that made it
  order(evs) {
    const fire = (ev) => ev?.e === 'shot' || ev?.e === 'knife';
    return [...evs.filter(fire), ...evs.filter((ev) => !fire(ev))];
  }

  // ---------- movement ----------
  // A position from a player's browser. Returns where the host puts them: the same place, or
  // as close to it as a legal move gets.
  move(av, x, y, z) {
    const s = this.st(av), g = this.game, now = g.time, dt = Math.min(1, Math.max(0, now - s.t));
    s.t = now;
    this.clock(s, now);
    const out = s.pos, rep = s.rep;
    // updates come 30 times a second, so even a bad connection can't jump this far between two
    if (Math.hypot(x - rep.x, z - rep.z) > 6 || y - rep.y > 4) this.flag(av, 'teleport', 4);
    rep.x = x; rep.y = y; rep.z = z;

    s.run = Math.min(RUN_SLACK, s.run + dt * MAX_RUN);
    s.rise = Math.min(RISE_SLACK, s.rise + dt * MAX_RISE);
    let dx = x - out.x, dz = z - out.z, dy = y - out.y;
    const d = Math.hypot(dx, dz);
    // held back by the speed limit for a while: more than a bad connection explains
    s.held = d > s.run + 0.01 ? s.held + dt : Math.max(0, s.held - dt);
    if (s.held > HELD_LIMIT) { this.flag(av, 'speed', 2); s.held = 0; }
    if (d > s.run) { dx *= s.run / d; dz *= s.run / d; }
    s.run -= Math.min(d, s.run);
    if (dy > s.rise) dy = s.rise;
    if (dy > 0) s.rise -= dy;

    // walls: the line at waist height from the last position to the new one must be clear
    const len = Math.hypot(dx, dy, dz);
    if (len > 0.01) {
      _e.set(out.x, out.y + 0.9, out.z);
      _d.set(dx / len, dy / len, dz / len);
      const w = raycast(_e, _d, len, this.cols(true), _hit);
      if (w && w.t < len - 0.02 && (_hit.nx || _hit.nz)) { this.flag(av, 'wall', 2); dx = dz = 0; dy = Math.min(dy, 0); }
    }
    out.x += dx; out.y += dy; out.z += dz;

    // a player who keeps getting further from where the host has them is too fast
    if (Math.hypot(x - out.x, z - out.z) > MAX_GAP) this.flag(av, 'speed', 2);

    // flying: too long off the ground, and not on a ladder
    const map = g.map, above = out.y - this.floorBelow(out), ladder = !!map.ladderAt?.(_e.set(out.x, out.y, out.z));
    if (above > 0.6 && !ladder) {
      s.air += dt;
      if (s.air > AIR_LIMIT) { this.flag(av, 'fly', 3); s.air = 0; }
    } else s.air = 0;
    this.groundSpeed(av, s, x, z, above < 0.08 && !ladder);
    return out;
  }

  // A steadier clock for when each update was sent: arrival times jump around with the network
  // (late, then several at once), but players send them evenly. It follows the arrival times
  // (never more than 0.15 s behind) at the pace they've been coming. Kept on the game's clock
  // (s.clk, for aim) and on the real one (s.wc; s.clkD: how far it moved), which keeps going
  // even when the host's game falls behind (a slow frame, a background tab).
  clock(s, now) {
    const steady = (c, t) => {
      const gap = c.last === null ? 1 : t - c.last, was = c.clk;
      c.last = t;
      if (gap < 0.5) {
        c.per += (gap - c.per) * 0.05;
        const pred = c.clk + c.per;
        c.clk = Math.min(t, Math.max(t - 0.15, pred + (t - pred) * 0.1));
      } else c.clk = t;
      return was === null || gap >= 0.5 ? 0 : Math.max(0, c.clk - was);
    };
    s.gc = s.gc || { last: null, clk: null, per: 1 / 30 };
    s.wc = s.wc || { last: null, clk: null, per: 1 / 30 };
    steady(s.gc, now);
    s.clk = s.gc.clk;
    s.clkD = steady(s.wc, performance.now() / 1000);
  }

  // Speed hacks: on the ground, friction holds everyone to their gun's running speed (bunny hops
  // are in the air, so they're left to the looser limit above). Each update earns that speed
  // (+12%, +0.15 m/s) for the time it covers on the steady clock above, so updates that arrive
  // late and bunched up still fit. Up to SPEED_BANK m can be saved up (walking slower); going
  // SPEED_DEBT m over is a speed hack.
  groundSpeed(av, s, x, z, ground) {
    const now = this.game.time, g = this.game, w = av.slots[av.slot];
    const moved = s.gx === undefined ? 0 : Math.hypot(x - s.gx, z - s.gz);
    s.gx = x; s.gz = z;
    // bumping into others shoves them along (zombies most of all)
    const near = (list, r) => list?.some((o) => o !== av && o.alive && o.active !== false && Math.hypot(o.body.pos.x - x, o.body.pos.z - z) < r);
    if (near(g.zombies, 2.5) || near(g.zombies ? g.players : g.combatants, 1.2)) s.pushT = now;
    if (!ground || now - s.pushT < PUSH_SKIP) { s.bank = SPEED_BANK; return; }
    const top = RUN_SPEED * (w?.def.speed || 1) * SPEED_SLACK + SPEED_ADD;
    s.bank = Math.min(SPEED_BANK, s.bank) + top * s.clkD - moved;
    if (s.bank < -SPEED_DEBT) { this.flag(av, 'speed', 2); s.bank = SPEED_BANK; }
  }

  // what bullets hit, or (for movement) what players bump into
  cols(players = false) { const m = this.game.map; return (players && m.playerColliders) || m.colliders; }

  // the height of what's under a spot: terrain, or the top of a box (players are about 0.3 m wide)
  floorBelow(p) {
    const m = this.game.map;
    let f = m.groundAt ? m.groundAt(p.x, p.z) : 0;
    for (const c of this.cols(false)) {
      if (c.y1 <= p.y + 0.05 && c.y1 > f && p.x > c.x0 - 0.35 && p.x < c.x1 + 0.35 && p.z > c.z0 - 0.35 && p.z < c.z1 + 0.35) f = c.y1;
    }
    return f;
  }

  // ---------- guns and ammo ----------
  // The ammo in a player's update (after their shots were counted): only for the guns the
  // host gave them, and never more than they had. More in the magazine than the host counted
  // means they reloaded: that has to have taken the gun's reload time.
  ammo(av, arr) {
    if (!Array.isArray(arr)) return;
    const s = this.st(av);
    [1, 2, 3].forEach((slot, i) => {
      const a = arr[i], w = av.slots[slot];
      if (!Array.isArray(a)) return;               // nothing there: the host's list stands
      if (!w) { this.flag(av, 'gun', 4); return; }
      if (w.def.melee) return;                    // knives have no ammo
      if (a[0] !== w.key || (a[1] | 0) !== (w.def.pap || 0)) { this.flag(av, 'gun', 4); return; }
      const mag = Math.max(0, Math.min(w.def.mag, a[2] | 0)), reserve = Math.max(0, a[3] | 0);
      if (mag + reserve > w.mag + w.reserve) { this.flag(av, 'ammo', 2); return; }
      if (mag > w.mag) this.reloaded(av, s, slot, w, mag);
      w.mag = mag; w.reserve = reserve;
    });
    for (const k in s.wshots) s.wshots[k].since = 0;
  }

  // A reload finished since the last update. The last shot before it and the first one after it
  // (or now) must be a reload time apart.
  reloaded(av, s, slot, w, mag) {
    const rec = s.wshots[slot];
    if (!rec || rec.key !== w.key || !rec.ts.length) return;
    const T = rec.ts, after = Math.max(0, Math.min(rec.since, w.def.mag - mag));   // shots fired after the reload
    if (T.length - 1 - after < 0) return;
    const before = T[T.length - 1 - after], next = after ? T[T.length - after] : this.game.time;
    const need = w.def.reload * (av.reloadMul || 1);
    if (next - before < need * RELOAD_SLACK - RELOAD_LAG) this.flag(av, 'reload', 3);
  }

  // A reported shot (ev.d: where its bullets ended). Returns false to ignore it.
  shot(av, ev) {
    const s = this.st(av), now = this.game.time, w = av.slots[av.slot];
    if (!w || w.def.melee) return false;
    const d = w.def;
    // the bullet has to leave roughly where they were looking (spinbots and silent aim don't)
    if (!this.alongView(s, d, ev)) { this.flag(av, 'silent', 4); return false; }
    // a snap onto a target just before the shot
    if (s.snapOn && now - s.snapT < SNAP_SHOT) { s.snapOn = false; this.flag(av, 'snap', 2); }
    // shooting at the decoy (and not at a real enemy in the same line)
    const dv = s.dview[s.dview.length - 1], cur = s.aim[s.aim.length - 1];
    if (dv && cur && dv.t === cur.t && dv.perr !== null && dv.perr < DSHOT_ON && s.dsnap && this.turnedTo(s.dsnap, cur)) {
      const real = this.pick(av, cur, s.lag, LAG_FIT);
      if (!real || real.err > REAL_NEAR) this.flag(av, 'decoy', 2);
    }
    // the first shot after a pause: how long the target had been under the crosshair
    if (now - s.lastShotT > 0.4) this.reaction(av, s);
    s.lastShotT = now;
    // fire rate: a little faster than the gun allows, with room for updates that arrive bunched up
    const gap = Math.min(d.rate || 0.1, d.burst ? d.burstGap : 9) * (av.rateMul || 1) * 0.8;
    s.credit = Math.min(Math.max(3, 1.2 / gap), s.credit + (now - s.creditT) / gap); s.creditT = now;
    if (s.credit < 1) { this.flag(av, 'rate', 2); return false; }
    s.credit--;
    this.fireRate(av, s, w);
    // firing before the gun is out (the shot's sound tells it's this gun, not the one put away)
    if (now - s.swT < (d.deploy || 0.5) * DRAW_SLACK - 0.05 && ev?.s === d.sound) {
      s.draws = s.draws.filter((t) => t > now - DRAW_WIN);
      s.draws.push(now);
      if (s.draws.length >= DRAW_N) { s.draws.length = 0; this.flag(av, 'instafire', 3); }
    }
    this.recoil(av, s, w, ev);
    // ammo: the host counts it too (the gun reloads from its spare ammo on their side)
    if (w.mag + w.reserve <= 0) { this.flag(av, 'empty', 2); return false; }
    if (w.mag > 0) w.mag--; else w.reserve--;
    const rec = s.wshots[av.slot]?.key === w.key ? s.wshots[av.slot] : (s.wshots[av.slot] = { key: w.key, ts: [], since: 0 });
    rec.ts.push(now); rec.since++;
    if (rec.ts.length > 64) rec.ts.shift();
    s.tokens = (now - s.tokT > 1 ? 0 : s.tokens) + hitsPerShot(d); s.tokT = now;
    return true;
  }

  // Rapid fire: over a long run of shots the time between them can be measured closely, even
  // though each one arrives a little late (and a few very late, after a lag spike): take the
  // middle value of the average gap between every pair of shots at least 5 apart (whole bursts
  // apart, for burst guns).
  fireRate(av, s, w) {
    const now = this.game.time, d = w.def, R = s.fire, step = d.burst || 1;
    const min = (d.burst ? d.rate / d.burst : d.rate || 0.1) * (av.rateMul || 1);
    if (R.key !== w.key || (R.ts.length && now - R.ts[R.ts.length - 1] > min * 3 + 0.15)) { R.key = w.key; R.ts.length = 0; }
    // more shots arriving at once than the gun fires in 50 ms: they were held up (a lag spike), so
    // their times say nothing; start over after them
    R.same = R.ts.length && R.ts[R.ts.length - 1] === now ? R.same + 1 : 1;
    if (R.same > Math.ceil(0.05 / min) + 1) { R.ts.length = 0; return; }
    R.ts.push(now);
    if (R.ts.length > RATE_RUN) R.ts.shift();
    const T = R.ts, n = T.length;
    if (n < RATE_MIN) return;
    const gaps = [];
    for (let i = 0; i < n; i++) for (let j = i + 5; j < n; j++) if ((j - i) % step === 0) gaps.push((T[j] - T[i]) / (j - i));
    gaps.sort((a, b) => a - b);
    if (gaps[gaps.length >> 1] < min * RATE_SLACK) { this.flag(av, 'rate', 2); T.length = 0; }
  }

  // No recoil: the game sends each bullet above the crosshair by the spray's recoil (the view
  // itself doesn't move, so pulling the mouse down doesn't change this). The host counts the
  // spray too and compares how high the bullets went with how high they should have.
  recoil(av, s, w, ev) {
    const now = this.game.time, d = w.def, R = s.rc;
    const settle = d.scope ? 0.2 : (d.rate || 0.1) + 0.06;
    if (R.key !== w.key || now - R.t > settle + 0.12) { this.recoilEnd(av, s); R.key = w.key; R.n = 0; }
    const n = R.n;
    R.n = Math.min(n + 1, 30); R.t = now;
    if (!d.auto || (d.kick || 0) < 0.005 || n < 3 || d.splash) return;
    const end = Array.isArray(ev?.d) && Array.isArray(ev.d[0]) ? ev.d[0] : null, A = s.aim, cur = A[A.length - 1];
    if (!end || !cur) return;
    const prev = A.length > 1 && cur.t - A[A.length - 2].t < 0.2 ? A[A.length - 2] : cur;
    const ex = +end[0], ey = +end[1], ez = +end[2];
    if (![ex, ey, ez].every(Number.isFinite)) return;
    const x = (prev.x + cur.x) / 2, y = (prev.y + cur.y) / 2, z = (prev.z + cur.z) / 2, flat = Math.hypot(ex - x, ez - z);
    if (flat < 6) return;
    // aiming down sights (Zombies) takes a quarter off
    const k = d.kick * (this.game.zombies ? 0.75 : 1);
    R.e += Math.min(n, 7) * k + Math.max(0, n - 7) * k * 0.2;
    R.m += Math.atan2(ey - y, flat) - (prev.pitch + cur.pitch) / 2;
    R.c++;
    if (R.c >= RECOIL_RUN) this.recoilEnd(av, s);
  }
  recoilEnd(av, s) {
    const R = s.rc;
    if (R.c >= RECOIL_MIN && R.e > RECOIL_SUM && R.m < R.e * RECOIL_RATIO) this.flag(av, 'recoil', 3);
    R.m = R.e = R.c = 0;
  }

  // A reported knife swing. Returns false to ignore it.
  melee(av) {
    const s = this.st(av), now = this.game.time;
    if (now - s.mT < 0.25) { this.flag(av, 'rate', 2); return false; }
    s.mtok = 2; s.mT = now;
    return true;
  }

  // ---------- aim ----------
  // A view update from a player's browser (after move() checked the position). eyeY: eye height.
  look(av, yaw, rawPitch, eyeY) {
    const s = this.st(av), now = this.game.time;
    // how far in the past they see others: there and back, plus their drawing delay
    s.lag = (this.game.net?.session?.rtt?.(av.pid) ?? LAG0) + VIEW_DELAY;
    if (Math.abs(rawPitch) > MAX_PITCH) this.flag(av, 'pitch', AIM_KICK_AT);   // anti-aim sends angles no mouse can reach
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rawPitch));
    dirFrom(yaw, pitch, _f);
    const p = s.pos, cur = { t: now, ts: s.clk, x: p.x, y: p.y + eyeY, z: p.z, yaw, pitch, dx: _f.x, dy: _f.y, dz: _f.z };
    const prev = s.aim[s.aim.length - 1];
    s.aim.push(cur);
    while (s.aim.length && s.aim[0].t < now - LOOK_KEEP) s.aim.shift();
    if (!prev) return;

    // spinbot: turning faster than a mouse can keep up
    s.spin.push({ t: now, a: Math.abs(wrapAngle(yaw - prev.yaw)) });
    while (s.spin.length && s.spin[0].t < now - SPIN_WIN) s.spin.shift();
    let turned = 0;
    for (const x of s.spin) turned += x.a;
    if (turned > SPIN_RATE * SPIN_WIN) { this.flag(av, 'spin', AIM_KICK_AT); s.spin.length = 0; }

    // a snap: a big turn in a few updates that stops right on a target (checked if they then fire)
    let early = prev;
    for (let i = s.aim.length - 2; i >= 0 && now - s.aim[i].t <= SNAP_TIME; i--) early = s.aim[i];
    if (angleBetween(early, cur) > SNAP_MIN) {
      const hit = this.pick(av, cur, s.lag, LAG_FIT);
      if (hit) {
        const bp = hit.target.body.pos, dist = Math.max(1, Math.hypot(bp.x - cur.x, bp.z - cur.z));
        if (hit.err < Math.atan(SNAP_ON / dist) + SNAP_ON0 && this.seesAt(cur, hit.target, s.lag)) { s.snapOn = true; s.snapT = now; }
      }
    }
    if (now - s.snapT > SNAP_SHOT) s.snapOn = false;

    this.watchDecoy(av, s, cur);
    if (now - s.evalT >= 0.1) { s.evalT = now; this.tracking(av, s); }
    if (now - s.mlT >= ML_EVERY) { s.mlT = now; this.mlJudge(av, s, this.mlWindow(av, s.aim, (t) => s.lag)); }
  }

  // what this player can shoot at: enemy fighters, or zombies
  targets(av) {
    const g = this.game;
    return g.zombies ? g.zombies.filter((z) => z.active !== false && z.alive) : g.combatants.filter((c) => c.alive && c !== av && c.team !== av.team);
  }

  // how far (rad) a view update was from a target's head or chest, as the player saw it `lag` s
  // earlier (they see everyone a little in the past); null if that's too long ago
  errAt(a, target, lag) {
    const q = this.posAt(target, a.t - lag);
    if (!q) return null;
    return Math.min(
      angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, q.x + q.hx, q.y + q.hy, q.z + q.hz),
      angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, q.x + q.cx, q.y + q.cy, q.z + q.cz));
  }

  // the target closest to a view update's crosshair: {target, err, dist}. The delay the player
  // sees others with is only roughly known, so delays within `spread` of `lag` are tried too.
  pick(av, a, lag, spread = 0) {
    let best = null;
    for (const t of this.targets(av)) {
      const bp = t.body.pos;
      // most targets are nowhere near the crosshair: skip them quickly
      if (Math.hypot(bp.x - a.x, bp.z - a.z) > 10 && angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, bp.x, bp.y + 1, bp.z) > 0.5) continue;
      for (let l = Math.max(0, lag - spread); l <= lag + spread + 1e-9; l += 0.025) {
        const err = this.errAt(a, t, l);
        if (err !== null && (!best || err < best.err)) best = { target: t, err };
      }
    }
    return best;
  }

  // could the eyes of a view update see the target's head or chest (as the player saw it)?
  seesAt(a, target, lag) {
    const q = this.posAt(target, a.t - lag);
    if (!q) return false;
    _o.set(a.x, a.y, a.z);
    return this.clear(_o, _t.set(q.x + q.hx, q.y + q.hy, q.z + q.hz)) || this.clear(_o, _t.set(q.x + q.cx, q.y + q.cy, q.z + q.cz));
  }

  // nothing solid on the line between two points
  clear(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 0.3) return true;
    _d.divideScalar(len);
    return !raycast(a, _d, len - 0.05, this.cols(false), _hit);
  }

  // Ten times a second: did the last second of aim follow a moving target too closely?
  // Following one in sight = aimbot; following one behind a wall = wallhack.
  tracking(av, s) {
    const now = this.game.time, win = s.aim.filter((a) => a.t >= now - LOCK_WIN);
    if (win.length < 20) return;
    const first = win[0], last = win[win.length - 1];
    const on = this.pick(av, last, s.lag, LAG_FIT);
    if (!on || on.err > 8 * DEG) return;
    const tg = on.target;
    // the delay that fits their aim best
    let best = null;
    for (let lag = Math.max(0, s.lag - LAG_FIT); lag <= s.lag + LAG_FIT + 1e-9; lag += 0.02) {
      let sum = 0, max = 0, ok = true;
      for (const a of win) {
        const e = this.errAt(a, tg, lag);
        if (e === null) { ok = false; break; }
        sum += e * e; if (e > max) max = e;
      }
      if (!ok) continue;
      const rms = Math.sqrt(sum / win.length);
      if (!best || rms < best.rms) best = { lag, rms, max };
    }
    if (!best) return;
    // only aim that followed a target across their view counts (not holding still on a still
    // one): add up how far the target moved across it, and how far their view turned
    let sweep = 0, turned = 0;
    for (let i = 1; i < win.length; i++) {
      const a = win[i - 1], b = win[i], qa = this.posAt(tg, a.t - best.lag, {}), qb = this.posAt(tg, b.t - best.lag, {});
      if (!qa || !qb) return;
      _a.set(qa.x - a.x, qa.y + qa.cy - a.y, qa.z - a.z).normalize();
      _b.set(qb.x - b.x, qb.y + qb.cy - b.y, qb.z - b.z).normalize();
      sweep += _a.angleTo(_b); turned += angleBetween(a, b);
    }
    if (sweep < SWEEP || turned < SWEEP * 0.8) return;
    const mid = win[win.length >> 1];
    const seen = [first, mid, last].map((a) => this.seesAt(a, tg, best.lag));
    if (seen.every(Boolean) && best.rms < LOCK_RMS && best.max < LOCK_MAX) this.flag(av, 'aimlock', 3);
    else if (!seen.some(Boolean) && best.rms < ESP_RMS) this.flag(av, 'esp', 4);
  }

  // ---------- the aim network ----------
  // The last second of aim at the enemy nearest the crosshair (who they could see), as samples
  // for aimml.js: {target, S: [{t, yaw, pitch, ty, tp}]}, or null. lagOf(target): how far in
  // the past this player sees that target.
  mlWindow(av, A, lagOf) {
    if (A.length < 20) return null;
    const last = A[A.length - 1], W = A.filter((a) => a.ts >= last.ts - ML_WIN);
    if (W.length < 20) return null;
    const on = this.pick(av, last, lagOf(null), LAG_FIT);
    if (!on || on.err > 8 * DEG) return null;
    const tg = on.target, lag = lagOf(tg), H = [], C = [];
    for (const a of W) {
      const q = this.posAt(tg, a.ts - lag);
      if (!q) return null;
      H.push(this.anglesTo(a, q.x + q.hx, q.y + q.hy, q.z + q.hz));
      C.push(this.anglesTo(a, q.x + q.cx, q.y + q.cy, q.z + q.cz));
    }
    if ([W[0], W[W.length >> 1], last].filter((a) => this.seesAt(a, tg, lag)).length < 2) return null;
    // whichever of head and chest they were aiming at
    const err = (S) => S.reduce((m, x) => m + Math.hypot(wrapAngle(x.yaw - x.ty) * Math.cos(x.tp), x.pitch - x.tp), 0);
    return { target: tg, S: err(H) <= err(C) ? H : C };
  }
  anglesTo(a, x, y, z) {
    const vx = x - a.x, vy = y - a.y, vz = z - a.z;
    return { t: a.ts, yaw: a.yaw, pitch: a.pitch, ty: Math.atan2(-vx, -vz), tp: Math.atan2(vy, Math.hypot(vx, vz)) };
  }

  // A window's score joins the fight it belongs to (the same target, without a long break).
  mlJudge(av, s, win) {
    const now = this.game.time, p = win ? aimScore(win.S) : null;
    if (s.eng && ((p !== null && s.eng.target !== win.target) || now - s.eng.t > ML_GAP)) this.mlEnd(av, s);
    if (p === null) return;
    if (!s.eng) s.eng = { target: win.target, ps: [] };
    s.eng.ps.push(p); s.eng.t = now;
    if (s.eng.ps.length >= ML_LONG) this.mlEnd(av, s);
  }
  mlEnd(av, s) {
    const E = s.eng;
    s.eng = null;
    if (!E || E.ps.length < ML_MIN) return;
    const m = E.ps.reduce((a, b) => a + b, 0) / E.ps.length;
    if (s.self) { this.selfPs.push(m); if (this.selfPs.length > 300) this.selfPs.shift(); return; }
    if (m > this.mlThreshold()) this.flag(av, 'ml', ML_PTS);
    else if (m > 0.8) console.info(`[anticheat] ${av.name}: aim score ${m.toFixed(3)} (bans over ${this.mlThreshold().toFixed(3)})`);
  }

  // The host's own aim is a person's, so the network shouldn't score it high. If it does
  // (this host plays unlike the people it learned from), the bar goes up to above the host's
  // highest fight.
  mlThreshold() {
    const P = this.selfPs;
    return P.length >= 10 ? Math.min(0.995, Math.max(AIM_THRESHOLD, Math.max(...P) + 0.01)) : AIM_THRESHOLD;
  }

  // 30 times a second: the host's own view, scored the same way (see mlThreshold)
  selfAim() {
    const g = this.game, p = g.player, now = g.time;
    if (!p || !p.alive || now - (this.selfT ?? -9) < 1 / 30 - 1e-6) return;
    this.selfT = now;
    const S = this.selfS || (this.selfS = { aim: [], eng: null, mlT: -9, self: true });
    const e = p.eyePos(_e);
    dirFrom(p.yaw, p.pitch, _f);
    const last = S.aim[S.aim.length - 1];
    if (last && now - last.t > 0.5) S.aim.length = 0;   // a break (dead, a new round)
    S.aim.push({ t: now, ts: now, x: e.x, y: e.y, z: e.z, yaw: p.yaw, pitch: p.pitch, dx: _f.x, dy: _f.y, dz: _f.z });
    while (S.aim.length && S.aim[0].t < now - LOOK_KEEP) S.aim.shift();
    if (now - S.mlT < ML_EVERY) return;
    S.mlT = now;
    // the host sees bots as they are, and other players a moment behind
    const nd = g.netDelay ?? 0.075;
    this.mlJudge(p, S, this.mlWindow(p, S.aim, (t) => (t ? (t.isAvatar ? nd : 0) : 0.04)));
  }

  // The first shot after a pause. A person needs a fifth of a second or so to fire once a target
  // walks into a still crosshair; a triggerbot fires on the same update. One instant shot is luck,
  // most of the recent ones is a cheat.
  reaction(av, s) {
    const A = s.aim, L = A.length - 1;
    if (L < 12) return;
    const hit = this.pick(av, A[L - 1], s.lag) || this.pick(av, A[L], s.lag);
    if (!hit) return;
    const tg = hit.target, r = (tg.body?.halfW || 0.3) + 0.05;
    const on = (a) => {
      const e = this.errAt(a, tg, s.lag), q = _q;
      if (e === null) return false;
      return e < Math.atan(r / Math.max(0.5, Math.hypot(q.x - a.x, q.z - a.z))) + 0.3 * DEG && this.seesAt(a, tg, s.lag);
    };
    if (!on(A[L - 1]) && !on(A[L])) return;   // not shooting at anyone
    let n = 0, k = L - 1;
    while (k >= 0 && on(A[k])) { n++; k--; }
    if (k < 4) return;                         // the crosshair was already on them: can't tell
    // the crosshair stood still and the target came to it (a flick and a click together is normal)
    if (angleBetween(A[k - 3], A[k + 1]) > 2 * DEG) return;
    s.react.push(n <= TRIG_N ? 1 : 0);
    if (s.react.length > TRIG_KEEP) s.react.shift();
    if (s.react.filter(Boolean).length >= TRIG_AT) { s.react.length = 0; this.flag(av, 'trigger', AIM_KICK_AT); }
  }

  // Did the first bullet of a shot leave along the view the player reported, somewhere between
  // their last update and this one? Recoil, spread and movement are allowed for.
  alongView(s, d, ev) {
    const end = Array.isArray(ev?.d) && Array.isArray(ev.d[0]) ? ev.d[0] : null;
    const A = s.aim, cur = A[A.length - 1];
    if (!end || !cur || d.splash) return true;
    const prev = A.length > 1 && cur.t - A[A.length - 2].t < 0.2 ? A[A.length - 2] : cur;
    const ex = +end[0], ey = +end[1], ez = +end[2];
    if (![ex, ey, ez].every(Number.isFinite) || Math.hypot(ex - cur.x, ey - cur.y, ez - cur.z) < 3) return true;
    const slack = 0.15 + (d.spread || 0) + (d.moveSpread || 0) + (d.airSpread ?? 0.1) + 30 * (d.recoilSpread || 0) + 14 * (d.kick || 0);
    for (let i = 0; i <= 4; i++) {
      const k = i / 4;
      dirFrom(prev.yaw + wrapAngle(cur.yaw - prev.yaw) * k, prev.pitch + (cur.pitch - prev.pitch) * k, _f);
      const x = prev.x + (cur.x - prev.x) * k, y = prev.y + (cur.y - prev.y) * k, z = prev.z + (cur.z - prev.z) * k;
      if (angleTo(_f.x, _f.y, _f.z, x, y, z, ex, ey, ez) < slack) return true;
    }
    return false;
  }

  // ---------- what each player is sent (5v5) ----------
  // The host's snapshot, trimmed for one player: enemies they can't see (or hear) are sent as
  // "hidden" with no position, so a wallhack has nothing to show.
  // Hidden ones may be sent at fake spots instead, and phantoms added (see fakes()).
  cull(snap, pid) {
    const g = this.game, r = g.avatars?.find((a) => a.pid === pid);
    if (!r || !Array.isArray(snap?.c)) return snap;
    const s = this.st(r), now = g.time, out = snap.c.slice(), hidden = new Map();   // nid -> index
    s.realT = s.realT || new Map();
    snap.c.forEach((e, i) => {
      const x = g.byNid.get(e[0]);
      if (!x || x === r || x.team === r.team || !x.alive) return;
      if (this.visibleTo(r, x)) { s.realT.set(x.nid, now); return; }
      out[i] = [e[0], 0, 0, 0, 0, 0, (e[6] & (F.ALIVE | F.BOMB)) | F.HIDE, e[7], e[8], '', 0];
      hidden.set(x.nid, i);
    });
    this.fakes(r, s, snap.c, out, hidden);
    return { ...snap, c: out };
  }

  // The round start's spawn list for one player: [nid, x, y, z, yaw, epoch, hidden]. Enemies
  // out of their sight are sent with no position.
  cullSpawns(sp, pid) {
    const g = this.game, r = g.avatars?.find((a) => a.pid === pid);
    if (!r) return sp;
    const s = this.st(r);
    s.realT = s.realT || new Map();
    return sp.map((e) => {
      const x = g.byNid.get(e[0]);
      if (!x || x === r || x.team === r.team || !x.alive) return e;
      if (this.visibleTo(r, x)) { s.realT.set(x.nid, g.time); return e; }
      return [e[0], 0, 0, 0, 0, e[5], 1];
    });
  }

  // A shot or knife swing by c, as player pid is told it: if they can't see c, it comes with
  // only roughly where it came from (o), for its sound.
  heard(c, ev, pid) {
    const r = this.game.avatars?.find((a) => a.pid === pid);
    if (!r || c === r || c.team === r.team || this.visibleTo(r, c, true)) return ev;
    const p = (c.isAvatar && c.interp?.latest) || c.body.pos, j = () => (Math.random() * 2 - 1) * SHOT_FUZZ;
    return { ...ev, o: [r1(p.x + j()), r1(p.y + 1.5), r1(p.z + j())] };
  }

  // should this player be sent where enemy x is? Dead players see what their living teammates see.
  visibleTo(r, x, fresh = false) {
    if (r.alive) return this.vis(r, x, fresh);
    const mates = this.game.combatants.filter((c) => c.alive && c.team === r.team);
    return !mates.length || mates.some((m) => this.vis(m, x, fresh));
  }

  // can v see x, or did lately? Checked at most every VIS_EVERY s per pair (fresh: check now).
  vis(v, x, fresh = false) {
    const now = this.game.time;
    this.seen = this.seen || new Map();
    const key = v.nid + ':' + x.nid;
    let e = this.seen.get(key);
    if (!e) this.seen.set(key, (e = { t: -9, until: -9 }));
    if (fresh || now - e.t >= VIS_EVERY) {
      e.t = now;
      if (this.mightSee(v, x)) e.until = now + VIS_HOLD;
    }
    return now < e.until;
  }

  // ---------- fakes (5v5) ----------
  // Writes this player's fakes into their snapshot (out): the decoy and the walkers in place of
  // hidden enemies, and the phantoms added at the end.
  fakes(r, s, src, out, hidden) {
    const now = this.game.time;
    const D = s.decoy || (s.decoy = { cur: null, nextT: 0, n: 0, tracks: new Map(), walk: new Map(), rest: new Map(), wT: 0, ph: [], phT: null });
    let d = D.cur;
    if (d && (!r.alive || !hidden.has(d.nid) || now > d.until || (now - d.chkT >= VIS_EVERY && !this.decoyOk(r, s, d)))) d = D.cur = null;
    if (!d && r.alive && hidden.size && now >= D.nextT) {
      d = D.cur = this.placeDecoy(r, s, D, hidden);
      if (!d) D.nextT = now + 0.5;
    }
    if (d) {
      const p = this.decoyPos(d, now, _a), i = hidden.get(d.nid), e = src[i];
      const eye = this.eyeOf(r, _b);
      out[i] = [d.nid, r2(p.x), r2(p.y), r2(p.z), r3(Math.atan2(-(eye.x - p.x), -(eye.z - p.z))), 0,
        F.ALIVE | (e[6] & F.BOMB), d.hp, 0, e[9], 0];
      this.trackFake(D, d.id, 'decoy', d.nid, p, now);
    }
    this.walkers(r, s, D, src, out, hidden);
    this.phantoms(r, D, out);
    for (const [id, T] of D.tracks) {
      while (T.pts.length && T.pts[0].t < now - DECOY_KEEP) T.pts.shift();
      if (!T.pts.length) D.tracks.delete(id);
    }
  }

  // remember where a fake was sent, for checking aim at it (each spot it's moved to has its own id)
  trackFake(D, id, kind, nid, p, t) {
    let T = D.tracks.get(id);
    if (!T) D.tracks.set(id, (T = { kind, nid, pts: [] }));
    T.pts.push({ t, x: p.x, y: p.y, z: p.z });
  }

  // where someone's eyes are, as the host has them
  eyeOf(c, out) {
    const p = (c.isAvatar && c.interp?.latest) || c.body.pos;
    return out.set(p.x, p.y + (c.eyeH || 1.65), p.z);
  }

  // where the decoy is at time t (its feet): drifting along the wall and bobbing up and down
  decoyPos(d, t, out) {
    const k = DECOY_AMP * Math.sin((t - d.t0) * DECOY_W + d.ph);
    return out.set(d.bx + d.ax * k, d.by + 0.12 * Math.sin(t * 2.1 + d.ph), d.bz + d.az * k);
  }

  // A new decoy spot: look along their view a little to either side for a wall within reach,
  // and put it just behind that wall, out of their sight. null if there's no such spot.
  placeDecoy(r, s, D, hidden) {
    const now = this.game.time, eye = this.eyeOf(r, new THREE.Vector3());
    const last = s.aim[s.aim.length - 1], yaw = last ? last.yaw : r.yaw;
    const unused = [...hidden.keys()].filter((n) => !D.walk.has(n));
    if (!unused.length) return null;
    const nid = unused[(Math.random() * unused.length) | 0];
    const dir = new THREE.Vector3();
    for (const off of DECOY_OFF) {
      for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
        dirFrom(yaw + off * side, 0, dir);
        const w = raycast(eye, dir, DECOY_MAX, this.cols(false), _hit);
        if (!w || w.t < 1.2) continue;
        const wallT = w.t;   // (w is reused by the line of sight checks below)
        for (let back = DECOY_STEP; back <= DECOY_THICK; back += DECOY_STEP) {
          const t = wallT + back;
          if (t < DECOY_MIN || t > DECOY_MAX + 3) break;
          const bx = eye.x + dir.x * t, bz = eye.z + dir.z * t;
          if (bx < 1 || bz < 1 || bx > WORLD - 1 || bz > WORLD - 1) break;
          const by = this.floorBelow({ x: bx, y: eye.y + 0.3, z: bz }) + DECOY_UP;
          const d = {
            nid, bx, by, bz, ax: -dir.z, az: dir.x, ph: Math.random() * 6.28, t0: now, chkT: now, turn: Math.max(DECOY_TURN, off + 30 * DEG),
            until: now + DECOY_LIFE + Math.random() * DECOY_LIFE_RAND, hp: 1 + ((Math.random() * 14) | 0), id: 0,
          };
          if (this.solidAt(d.bx, d.by, d.bz, d.ax, d.az, DECOY_AMP)) continue;
          if (this.decoyOk(r, s, d)) { d.id = ++D.n; return d; }
          break;
        }
      }
    }
    return null;
  }

  // would someone standing at (x, y, z), or anywhere `amp` m either way along (ax, az), be inside
  // something solid?
  solidAt(x0, y, z0, ax, az, amp) {
    for (const k of [-1, 0, 1]) {
      const x = x0 + ax * amp * k, z = z0 + az * amp * k;
      for (const c of this.cols(false)) {
        if (x + 0.35 > c.x0 && x - 0.35 < c.x1 && z + 0.35 > c.z0 && z - 0.35 < c.z1 && y + 2 > (c.y0 ?? 0) && y - 0.2 < c.y1) return true;
      }
    }
    return false;
  }

  // Is the decoy still a good one: out of their sight (from where they are, where they're
  // heading, leaning out either side or jumping), within reach and roughly in front of them?
  decoyOk(r, s, d) {
    const now = this.game.time;
    d.chkT = now;
    const E = this.eyeOf(r, _o);
    const dist = Math.hypot(d.bx - E.x, d.bz - E.z);
    if (dist < DECOY_MIN - 0.5 || dist > DECOY_MAX + 4) return false;
    const last = s.aim[s.aim.length - 1], yaw = last ? last.yaw : r.yaw;
    if (Math.abs(wrapAngle(Math.atan2(-(d.bx - E.x), -(d.bz - E.z)) - yaw)) > d.turn) return false;
    // hips, head, and either side of the head
    const pts = [[0, 0.75, 0], [0, 1.95, 0], [d.ax * 0.3, 1.95, d.az * 0.3], [-d.ax * 0.3, 1.95, -d.az * 0.3]];
    return this.hiddenFrom(r, E, d.bx, d.by, d.bz, d.ax, d.az, DECOY_AMP, pts, true);
  }

  // Can't r see any of the points `pts` (offsets from the feet) of someone at (x, y, z), or
  // anywhere `amp` m either way along (ax, az)? Looked at from their eyes E, where they're heading,
  // leaning out either side (and, if `jump`, jumping).
  hiddenFrom(r, E, x0, y, z0, ax, az, amp, pts, jump) {
    const vv = r.body.vel, dist = Math.max(0.01, Math.hypot(x0 - E.x, z0 - E.z));
    const sx = -(z0 - E.z) / dist, sz = (x0 - E.x) / dist;
    const eyes = [[0, 0, 0], [vv.x * 0.3, 0, vv.z * 0.3], [sx * 0.6, 0, sz * 0.6], [-sx * 0.6, 0, -sz * 0.6]];
    if (jump) eyes.push([0, 0.7, 0]);
    const eye = new THREE.Vector3(), pt = _e;
    for (const k of [-1, 0, 1]) {
      const x = x0 + ax * amp * k, z = z0 + az * amp * k;
      for (const [ex, ey, ez] of eyes) {
        eye.set(E.x + ex, E.y + ey, E.z + ez);
        for (const [px, py, pz] of pts) if (this.clear(eye, pt.set(x + px, y + py, z + pz))) return false;
      }
    }
    return true;
  }

  // ----- walkers: the other hidden enemies, walking back and forth behind walls -----
  walkers(r, s, D, src, out, hidden) {
    const now = this.game.time, primary = D.cur?.nid;
    for (const [nid, w] of D.walk) {
      if (!r.alive || !hidden.has(nid) || nid === primary || now > w.until || (now - w.chkT >= WALK_CHECK && !this.walkerOk(r, w))) {
        D.walk.delete(nid); D.rest.set(nid, now);
      }
    }
    if (r.alive && D.walk.size < WALKERS && now >= D.wT) {
      D.wT = now + WALK_EVERY;
      // an enemy that was just a fake somewhere else waits a moment (so it doesn't slide over)
      const free = [...hidden.keys()].filter((n) => n !== primary && !D.walk.has(n) && now - (D.rest.get(n) ?? -9) > WALK_REST);
      if (free.length) {
        const w = this.placeWalker(r, s, D, free[(Math.random() * free.length) | 0]);
        if (w) D.walk.set(w.nid, w);
      }
    }
    for (const w of D.walk.values()) {
      const p = this.walkerPos(w, now, _a), i = hidden.get(w.nid), e = src[i];
      out[i] = [w.nid, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(w.pitch), F.ALIVE | F.GROUND | (e[6] & F.BOMB), e[7], e[8], w.gun, 0];
      this.trackFake(D, w.id, 'walker', w.nid, p, now);
    }
  }

  // where a walker is at time t (its feet, and which way it faces)
  walkerPos(w, t, out) {
    const ph = ((t - w.t0) * w.v / w.len + w.ph) % 2, k = ph < 1 ? ph : 2 - ph, f = ph < 1 ? 1 : -1;
    out.set(w.bx + w.ax * (k - 0.5) * w.len, w.by, w.bz + w.az * (k - 0.5) * w.len);
    out.yaw = Math.atan2(-w.ax * f, -w.az * f);
    return out;
  }

  // A spot behind a wall, well off their crosshair, with a clear stretch of floor to walk along.
  placeWalker(r, s, D, nid) {
    const now = this.game.time, eye = this.eyeOf(r, new THREE.Vector3()), feet = eye.y - (r.eyeH || 1.65);
    const last = s.aim[s.aim.length - 1], yaw = last ? last.yaw : r.yaw, dir = new THREE.Vector3();
    for (let tries = 0; tries < 8; tries++) {
      dirFrom(yaw + (Math.random() < 0.5 ? 1 : -1) * rand(WALK_OFF, Math.PI), 0, dir);
      const w = raycast(eye, dir, WALK_MAX, this.cols(false), _hit);
      if (!w || w.t < WALK_MIN) continue;
      const wallT = w.t;
      for (let back = 1; back <= 8; back += 0.5) {
        const t = wallT + back, bx = eye.x + dir.x * t, bz = eye.z + dir.z * t;
        if (bx < 1 || bz < 1 || bx > WORLD - 1 || bz > WORLD - 1) break;
        const by = this.floorBelow({ x: bx, y: eye.y + 0.3, z: bz });
        if (Math.abs(by - feet) > 3) continue;
        // walking along the wall, or straight away from them
        const along = Math.random() < 0.7, ax = along ? -dir.z : dir.x, az = along ? dir.x : dir.z, len = rand(...WALK_LEN);
        if (this.solidAt(bx, by, bz, ax, az, len / 2)) continue;
        // the floor stays level the whole way (no walking over gaps or up crates)
        if ([-0.5, 0.5].some((k) => Math.abs(this.floorBelow({ x: bx + ax * len * k, y: by + 0.5, z: bz + az * len * k }) - by) > 0.1)) continue;
        const wk = {
          nid, id: ++D.n, bx, by, bz, ax, az, len, v: rand(...WALK_SPEED), ph: Math.random() * 2, t0: now, chkT: now,
          until: now + rand(...WALK_LIFE), pitch: rand(-0.08, 0.05), gun: this.gunFor(r),
        };
        if (this.walkerOk(r, wk)) return wk;
        break;
      }
    }
    return null;
  }

  // still out of their sight (anywhere along its walk), and not too close or too far?
  walkerOk(r, w) {
    w.chkT = this.game.time;
    const E = this.eyeOf(r, _o), dist = Math.hypot(w.bx - E.x, w.bz - E.z);
    if (dist < DECOY_MIN || dist > WALK_MAX + 12) return false;
    return this.hiddenFrom(r, E, w.bx, w.by, w.bz, w.ax, w.az, w.len / 2 + 0.3, [[0, 0.8, 0], [0, 1.7, 0]], false);
  }

  // what an enemy of r might carry
  gunFor(r) { const L = GUNS[r.team === 'T' ? 'CT' : 'T']; return L[(Math.random() * L.length) | 0]; }

  // ----- phantoms: enemies that only exist in the network messages -----
  phantoms(r, D, out) {
    const g = this.game, now = g.time;
    if (!r.alive) { D.ph.length = 0; D.phT = null; return; }
    const dt = D.phT === null ? 0 : Math.min(0.2, Math.max(0, now - D.phT));
    D.phT = now;
    for (let n = 0; D.ph.length < PHANTOMS && n < 2; n++) {   // a couple a snapshot, so they come in over a moment
      const p = this.spawnPhantom(r, D);
      if (p) { D.ph.push(p); D.ph.sort((a, b) => a.nid - b.nid); }   // in id order, like everyone else
    }
    for (const p of D.ph) {
      this.stepPhantom(r, D, p, dt);
      out.push([p.nid, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), F.ALIVE | F.GROUND, p.hp, p.armor, p.gun, 0]);
      this.trackFake(D, p.id, 'phantom', p.nid, p, now);
    }
  }

  // network ids no fighter has: after the roster's
  phantomNid(D) {
    const g = this.game;
    let base = 0;
    for (const c of g.combatants) base = Math.max(base, c.nid + 1);
    const used = new Set(D.ph.map((p) => p.nid));
    const free = [];
    for (let n = base; n < base + PHANTOMS + 6; n++) if (!used.has(n)) free.push(n);
    return free[(Math.random() * free.length) | 0];
  }

  // a spot on the floor around r, with room to stand and nobody near
  phantomSpot(r, near, far) {
    const p = r.body.pos;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(near, far), x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (x < 1 || z < 1 || x > WORLD - 1 || z > WORLD - 1) continue;
      const y = this.floorBelow({ x, y: p.y + 1, z });
      if (Math.abs(y - p.y) > 4 || this.solidAt(x, y, z, 0, 0, 0) || this.nearSomeone(x, z, 3)) continue;
      return { x, y, z };
    }
    return null;
  }
  nearSomeone(x, z, d) { return this.game.combatants.some((c) => c.alive && Math.hypot(c.body.pos.x - x, c.body.pos.z - z) < d); }

  spawnPhantom(r, D) {
    const at = this.phantomSpot(r, PH_NEAR, PH_FAR);
    if (!at) return null;
    return {
      nid: this.phantomNid(D), id: ++D.n, ...at, yaw: Math.random() * 6.28, pitch: rand(-0.1, 0.05), tx: at.x, tz: at.z,
      v: rand(...PH_SPEED), wait: 0, hp: Math.random() < 0.6 ? 100 : 20 + ((Math.random() * 80) | 0),
      armor: Math.random() < 0.7 ? 100 : 0, gun: this.gunFor(r),
    };
  }

  // run toward the next turn; at it, maybe stop for a moment, then pick another one in a clear line
  stepPhantom(r, D, p, dt) {
    const rp = r.body.pos;
    if (Math.hypot(p.x - rp.x, p.z - rp.z) > PH_LOST) {   // left behind: somewhere new, with a new id
      const at = this.phantomSpot(r, PH_NEAR, PH_FAR);
      if (at) { Object.assign(p, at, { tx: at.x, tz: at.z, id: ++D.n }); }
      return;
    }
    if (p.wait > 0) { p.wait -= dt; return; }
    const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.3) {
      if (Math.random() < PH_PAUSE) p.wait = rand(0.3, 1.5);
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, len = rand(...PH_LEG);
        _d.set(Math.sin(a), 0, Math.cos(a));
        const tx = p.x + _d.x * len, tz = p.z + _d.z * len;
        if (tx < 1 || tz < 1 || tx > WORLD - 1 || tz > WORLD - 1) continue;
        if (raycast(_e.set(p.x, p.y + 0.9, p.z), _d, len + 0.5, this.cols(false), _hit)) continue;
        const ty = this.floorBelow({ x: tx, y: p.y + 0.5, z: tz });
        if (Math.abs(ty - p.y) > 0.5 || this.nearSomeone(tx, tz, 3)) continue;
        p.tx = tx; p.tz = tz; p.v = rand(...PH_SPEED);
        break;
      }
      return;
    }
    const step = Math.min(d, p.v * dt);
    p.x += dx / d * step; p.z += dz / d * step;
    p.y = this.floorBelow({ x: p.x, y: p.y + 0.5, z: p.z });
    p.yaw = Math.atan2(-dx, -dz);
  }

  // a hit on an id the host doesn't know: was it one of this player's phantoms?
  fakeHit(av, nid) {
    const D = av?.ac?.decoy;
    if (!D) return;
    for (const T of D.tracks.values()) if (T.kind === 'phantom' && T.nid === nid) { this.flag(av, 'decoy', AIM_KICK_AT); return; }
  }

  // how far (rad) view update a was from the nearest fake (of `kind`, or any), as they saw it
  // `lag` s earlier (delays within LAG_FIT tried too): {err, id, ux, uy, uz (direction to it)},
  // or null if there was none on their screen
  decoyErr(D, a, lag, kind = null) {
    let best = null;
    for (const [id, T] of D.tracks) {
      if (kind && T.kind !== kind) continue;
      const P = T.pts;
      for (let l = Math.max(0, lag - LAG_FIT); l <= lag + LAG_FIT + 1e-9; l += 0.03) {
        const t = a.t - l;
        let i = P.length - 1;
        while (i >= 0 && P[i].t > t) i--;
        if (i < 0 || t - P[i].t > 0.15) continue;   // not on their screen then
        const p = P[i], n = P[i + 1];
        let x = p.x, y = p.y, z = p.z;
        if (n && n.t > p.t) { const k = (t - p.t) / (n.t - p.t); x += (n.x - p.x) * k; y += (n.y - p.y) * k; z += (n.z - p.z) * k; }
        const err = Math.min(angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, x, y + 1.65, z), angleTo(a.dx, a.dy, a.dz, a.x, a.y, a.z, x, y + 1.2, z));
        if (!best || err < best.err) {
          const len = Math.hypot(x - a.x, y + 1.2 - a.y, z - a.z) || 1;
          best = { err, id, x, y, z, ux: (x - a.x) / len, uy: (y + 1.2 - a.y) / len, uz: (z - a.z) / len };
        }
      }
    }
    return best;
  }

  // Each view update: did their aim follow a fake, or turn onto the decoy after it moved? A fair
  // player can't know where they are.
  // A player who moves (and keeps their mouse still, or keeps it on a corner while they strafe)
  // sweeps everything behind that wall across their crosshair, fakes included. So it only counts
  // when it was their view that went to the fake: following it better than a fixed spot where it
  // was, or turning by most of the way to it.
  watchDecoy(av, s, cur) {
    const D = s.decoy;
    if (!D || !D.tracks.size) return;
    const h = this.decoyErr(D, cur, s.lag), hp = D.cur ? this.decoyErr(D, cur, s.lag, 'decoy') : null;
    s.dview.push({
      t: cur.t, err: h ? h.err : null, id: h ? h.id : -1, perr: hp ? hp.err : null, x: cur.x, y: cur.y, z: cur.z,
      dx: cur.dx, dy: cur.dy, dz: cur.dz, ux: h?.ux, uy: h?.uy, uz: h?.uz, fx: h?.x, fy: h?.y, fz: h?.z,
    });
    while (s.dview.length && s.dview[0].t < cur.t - 1.5) s.dview.shift();

    // following one as it moves (and not a real enemy who happens to be in the same line)
    const win = h ? s.dview.filter((v) => v.t >= cur.t - DTRACK_WIN) : [];
    if (win.length >= 12 && win.every((v) => v.id === h.id)) {
      let sum = 0, max = 0, still = 0;
      const a = win[0], b = win[win.length - 1];
      for (const v of win) {
        sum += v.err * v.err; max = Math.max(max, v.err);
        // ...against a spot that stays where the fake was at the start
        still += Math.min(angleTo(v.dx, v.dy, v.dz, v.x, v.y, v.z, a.fx, a.fy + 1.65, a.fz), angleTo(v.dx, v.dy, v.dz, v.x, v.y, v.z, a.fx, a.fy + 1.2, a.fz)) ** 2;
      }
      const rms = Math.sqrt(sum / win.length), rmsStill = Math.sqrt(still / win.length);
      const moved = Math.acos(Math.max(-1, Math.min(1, a.ux * b.ux + a.uy * b.uy + a.uz * b.uz)));
      const own = Math.hypot(b.fx - a.fx, b.fz - a.fz);   // how far the fake itself went
      if (rms < DTRACK_RMS && max < DTRACK_MAX && moved > DTRACK_MOVE && angleBetween(a, b) > DTRACK_MOVE && own > 0.5 && rmsStill > rms * 2 + DEG) {
        const real = this.pick(av, cur, s.lag, LAG_FIT);
        if (!real || real.err > REAL_NEAR) this.flag(av, 'decoy', 4);
      }
    }

    // turning onto the decoy soon after it moved somewhere new (from well away)
    if (!hp) return;
    if (!s.dsnap || s.dsnap.id !== hp.id) s.dsnap = { id: hp.id, t: cur.t, from: hp.err, n: 0, done: false, dx: cur.dx, dy: cur.dy, dz: cur.dz };
    const q = s.dsnap;
    if (!q.done && q.from > DSNAP_FROM && cur.t - q.t < DSNAP_TIME) {
      q.n = hp.err < DSNAP_ON && this.turnedTo(q, cur) ? q.n + 1 : 0;
      if (q.n >= DSNAP_HOLD) { q.done = true; this.flag(av, 'decoy', 3); }
    }
  }

  // did the view turn most of the way from where it was when the decoy moved (q) to it?
  turnedTo(q, cur) { return angleBetween(q, cur) > q.from * 0.6; }

  // close, heard, spotted, or in sight (also a moment from now, so someone peeking a corner
  // shows up on time)
  mightSee(v, x) {
    const now = this.game.time;
    const vp = (v.isAvatar && v.interp?.latest) || v.body.pos, xp = (x.isAvatar && x.interp?.latest) || x.body.pos;
    const dist = Math.hypot(xp.x - vp.x, xp.y - vp.y, xp.z - vp.z);
    if (dist < NEAR || now < (x.spottedUntil || 0)) return true;
    if (now - (x.lastShot ?? -9) < SHOT_SHOW && dist < GUNSHOT) return true;
    if (dist < HEAR && x.body.onGround && !x.crouching && x.horizSpeed() > 3.6) return true;   // footsteps
    // eyes: now, a moment ahead, and leaning out to either side
    const vv = v.body.vel, xv = x.body.vel;
    const sx = -(xp.z - vp.z) / Math.max(dist, 0.01), sz = (xp.x - vp.x) / Math.max(dist, 0.01);
    const eh = v.eyeH || 1.65;
    const eyes = [[0, 0], [vv.x * AHEAD, vv.z * AHEAD], [sx * 0.6, sz * 0.6], [-sx * 0.6, -sz * 0.6]];
    const pts = [[0, 0], [xv.x * AHEAD, xv.z * AHEAD], [sx * 0.45, sz * 0.45], [-sx * 0.45, -sz * 0.45]];
    const hs = [(x.body.height || 1.8) - 0.15, 0.8];   // head, and hips (legs under a gap)
    for (const [ex, ez] of eyes) {
      _o.set(vp.x + ex, vp.y + eh, vp.z + ez);
      for (const [px, pz] of pts) for (const h of hs) if (this.clear(_o, _e.set(xp.x + px, xp.y + h, xp.z + pz))) return true;
    }
    return false;
  }

  // ---------- hits ----------
  // A reported hit on `target` (a fighter or a zombie). Returns false to ignore it.
  // quiet: a zombie hit that gives no points (extra pellets, explosions, lightning jumps)
  hit(av, target, { melee = false, quiet = false } = {}) {
    const s = this.st(av), now = this.game.time;
    const eyes = this.eyes(av), spots = this.spots(target);
    if (!eyes.length || !spots.length) return false;
    // 5v5: a hit on an enemy the host hasn't sent them for a while (they had no idea where they
    // were), or on one they were sent as a fake
    if (s.realT && target.nid != null && now - (s.realT.get(target.nid) ?? -9) > s.lag + 0.6) {
      let wasFake = false;
      for (const T of s.decoy?.tracks.values() || []) if (T.nid === target.nid && T.pts.length && now - T.pts[T.pts.length - 1].t < 1) wasFake = true;
      this.flag(av, wasFake ? 'decoy' : 'unseen', wasFake ? AIM_KICK_AT : 3);
      return false;
    }
    if (melee) {
      if (now - s.mT > 1 || s.mtok <= 0) { this.flag(av, 'noshot', 2); return false; }
      s.mtok--;
      if (this.nearest(eyes, spots) > 4) { this.flag(av, 'range', 2); return false; }
      return true;
    }
    const w = av.slots[av.slot];
    if (!w || w.def.melee) return false;
    if (now - s.tokT > 1 || s.tokens <= 0) { this.flag(av, 'noshot', 2); return false; }
    s.tokens--;
    const d = w.def;
    // explosions and lightning jumps land away from the bullet's line
    const side = quiet && (d.splash || d.chain);
    const reach = (d.range || 250) + 3 + (side ? (d.splash?.radius || 0) + (d.chain ? d.chain.range * d.chain.jumps : 0) : 0);
    if (this.nearest(eyes, spots) > reach) { this.flag(av, 'range', 2); return false; }
    if (side) return true;
    if (!this.sees(eyes, spots)) { this.flag(av, 'through', 2); return false; }
    if (!this.facing(eyes, spots)) { this.flag(av, 'aim', 1.5); return false; }
    return true;
  }

  // the most damage one hit from what this player holds can do (zombies)
  maxDamage(av, melee) {
    if (melee) return 200;
    const d = av.slots[av.slot]?.def;
    if (!d || d.melee) return 0;
    return Math.max(d.damage * (d.headMult || 4), d.splash?.damage || 0) * (av.perks?.has('dtap') ? 1.33 : 1) + 1;
  }

  // where this player's eyes were lately (with where they looked): their newest updates first
  eyes(av) {
    const out = [], h = av.eyeH || 1.65, buf = av.interp?.buf || [];
    for (let i = buf.length - 1; i >= 0 && out.length < 4; i--) out.push({ x: buf[i].x, y: buf[i].y + h, z: buf[i].z, yaw: buf[i].yaw, pitch: buf[i].pitch });
    const hist = this.hist.get(av) || [], now = this.game.time;
    for (let i = hist.length - 1; i >= 0; i -= 2) {
      const e = hist[i];
      if (e.t < now - 0.5) break;
      out.push({ x: e.x, y: e.y + h, z: e.z, yaw: e.yaw, pitch: e.pitch });
    }
    return out;
  }

  // spots on the target (legs, chest, head) where it was lately, or is now
  spots(target) {
    const p = target.body.pos;
    const chest = target.chestPos(_t).y - p.y;
    const head = target.headPos ? target.headPos(_t).y - p.y : (target.body.height || 1.8) - 0.17;
    const out = [], add = (x, y, z) => { out.push({ x, y: y + chest, z }, { x, y: y + head, z }, { x, y: y + 0.4, z }); };
    add(p.x, p.y, p.z);
    const l = target.interp?.latest;
    if (l) add(l.x, l.y, l.z);
    const hist = this.hist.get(target) || [];
    for (let i = hist.length - 1; i >= 0; i -= 2) add(hist[i].x, hist[i].y, hist[i].z);
    return out;
  }

  nearest(eyes, spots) {
    let best = Infinity;
    for (const e of eyes) for (const s of spots) best = Math.min(best, Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z));
    return best;
  }

  // can any recent eye position see any recent spot on the target?
  sees(eyes, spots) {
    const cols = this.cols(false);
    for (const e of eyes) for (const s of spots) {
      _e.set(e.x, e.y, e.z);
      _d.set(s.x - e.x, s.y - e.y, s.z - e.z);
      const len = _d.length();
      if (len < 0.3) return true;
      _d.divideScalar(len);
      if (!raycast(_e, _d, len - 0.05, cols, _hit)) return true;
    }
    return false;
  }

  // was the player looking roughly toward the target?
  facing(eyes, spots) {
    for (const e of eyes) {
      if (!Number.isFinite(e.yaw)) continue;
      dirFrom(e.yaw, e.pitch || 0, _f);
      for (const s of spots) {
        _d.set(s.x - e.x, s.y - e.y, s.z - e.z);
        const len = _d.length();
        if (len < 1) return true;
        const slack = AIM_SLACK + Math.atan(0.8 / len);
        if (_f.dot(_d) / len > Math.cos(slack)) return true;
      }
    }
    return false;
  }
}
