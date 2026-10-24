// Weapon stats. Spread / kick values are in radians, damage is per bullet.
// falloff = damage multiplier per 10m travelled.
export const WEAPONS = {
  knife: {
    key: 'knife', name: 'Knife', slot: 3, melee: true, damage: 50, rate: 0.45, range: 2.1,
    speed: 1.0, price: 0, deploy: 0.35, reward: 1500, vm: 'knife',
  },
  pistol: {
    key: 'pistol', name: 'P-9 Pistol', slot: 2, damage: 30, headMult: 4, rate: 0.15, auto: false,
    mag: 12, reserve: 48, reload: 2.1, spread: 0.005, moveSpread: 0.035, airSpread: 0.1, kick: 0.016,
    recoilSpread: 0.006, armorPen: 0.5, falloff: 0.88, speed: 0.96, price: 0, deploy: 0.4,
    reward: 300, sound: 'pistol', vm: 'pistol',
  },
  smg: {
    key: 'smg', name: 'SMG-7', slot: 1, damage: 26, headMult: 4, rate: 0.075, auto: true,
    mag: 30, reserve: 120, reload: 2.4, spread: 0.01, moveSpread: 0.025, airSpread: 0.08, kick: 0.008,
    recoilSpread: 0.004, armorPen: 0.6, falloff: 0.85, speed: 0.96, price: 1250, deploy: 0.5,
    reward: 600, sound: 'smg', vm: 'smg',
  },
  ak: {
    key: 'ak', name: 'AK Rifle', team: 'T', slot: 1, damage: 36, headMult: 4, rate: 0.1, auto: true,
    mag: 30, reserve: 90, reload: 2.5, spread: 0.003, moveSpread: 0.09, airSpread: 0.15, kick: 0.0145,
    recoilSpread: 0.0035, armorPen: 0.775, falloff: 0.98, speed: 0.86, price: 2700, deploy: 0.6,
    reward: 300, sound: 'rifle', vm: 'ak',
  },
  m4: {
    key: 'm4', name: 'M4 Rifle', team: 'CT', slot: 1, damage: 33, headMult: 4, rate: 0.09, auto: true,
    mag: 30, reserve: 90, reload: 3.0, spread: 0.003, moveSpread: 0.08, airSpread: 0.15, kick: 0.012,
    recoilSpread: 0.003, armorPen: 0.7, falloff: 0.97, speed: 0.9, price: 3100, deploy: 0.6,
    reward: 300, sound: 'rifle2', vm: 'm4',
  },
  sniper: {
    key: 'sniper', name: 'Bolt Sniper', slot: 1, damage: 115, headMult: 4, rate: 1.45, auto: false,
    mag: 5, reserve: 30, reload: 3.6, spread: 0.09, scopedSpread: 0.0006, moveSpread: 0.15, airSpread: 0.25,
    kick: 0.035, recoilSpread: 0, armorPen: 0.98, falloff: 0.99, speed: 0.8, price: 4750, deploy: 0.9,
    reward: 100, sound: 'sniper', vm: 'sniper', scope: true,
  },
  // hand cannon: one headshot kills, but spamming it ruins your accuracy
  deagle: {
    key: 'deagle', name: 'Desert Eagle', slot: 2, damage: 53, headMult: 4, rate: 0.27, auto: false,
    mag: 7, reserve: 35, reload: 2.2, spread: 0.004, moveSpread: 0.06, airSpread: 0.14, kick: 0.04,
    recoilSpread: 0.02, armorPen: 0.93, falloff: 0.9, speed: 0.92, price: 700, deploy: 0.55,
    reward: 300, sound: 'deagle', vm: 'deagle',
  },
  // budget rifle: one click fires a 3-round burst
  m16: {
    key: 'm16', name: 'M16 Burst', slot: 1, damage: 31, headMult: 4, rate: 0.36, auto: false, burst: 3, burstGap: 0.065,
    mag: 30, reserve: 90, reload: 2.9, spread: 0.0035, moveSpread: 0.08, airSpread: 0.15, kick: 0.009,
    recoilSpread: 0.0025, armorPen: 0.7, falloff: 0.97, speed: 0.9, price: 2250, deploy: 0.6,
    reward: 300, sound: 'm16', vm: 'm16',
  },
  // light bolt-action sniper: cheap, fast to carry, accurate in the air, but body shots don't kill
  scout: {
    key: 'scout', name: 'Scout', slot: 1, damage: 88, headMult: 4, rate: 1.25, auto: false,
    mag: 10, reserve: 90, reload: 3.0, spread: 0.06, scopedSpread: 0.0012, moveSpread: 0.07, airSpread: 0.012,
    kick: 0.03, recoilSpread: 0, armorPen: 0.85, falloff: 0.98, speed: 0.92, price: 1700, deploy: 0.75,
    reward: 300, sound: 'scout', vm: 'scout', scope: true, zoomFov: 36,
  },
};

// ----- extra weapons (the shotgun is in both modes; the rest are Zombies only) -----
Object.assign(WEAPONS, {
  shotgun: {
    key: 'shotgun', name: 'Pump Shotgun', slot: 1, damage: 24, headMult: 2, pellets: 8, rate: 0.8, auto: false,
    mag: 8, reserve: 48, reload: 3.0, spread: 0.075, moveSpread: 0.02, airSpread: 0.05, kick: 0.05, recoilSpread: 0,
    armorPen: 0.5, falloff: 0.72, speed: 0.88, price: 1050, deploy: 0.6, reward: 900, sound: 'shotgun', vm: 'shotgun',
  },
  lmg: {
    key: 'lmg', name: 'Drum LMG', slot: 1, damage: 34, headMult: 3, rate: 0.085, auto: true,
    mag: 100, reserve: 300, reload: 5.2, spread: 0.006, moveSpread: 0.07, airSpread: 0.15, kick: 0.009,
    recoilSpread: 0.0025, armorPen: 0.8, falloff: 0.97, speed: 0.78, price: 5000, deploy: 0.9, sound: 'rifle', vm: 'lmg',
  },
  // the wonder weapon: a little slower and weaker than it used to be (still the best splash gun)
  raygun: {
    key: 'raygun', name: 'Tung Ray', slot: 1, damage: 90, headMult: 1.5, rate: 0.36, auto: false,
    mag: 16, reserve: 112, reload: 2.8, spread: 0.002, moveSpread: 0.01, airSpread: 0.02, kick: 0.02, recoilSpread: 0,
    armorPen: 1, falloff: 1, speed: 0.96, price: 0, deploy: 0.5, sound: 'raygun', vm: 'raygun',
    splash: { radius: 2.6, damage: 110 }, tracer: 0x50ff70,
  },
});

// ----- Zombies-only guns from the case system (see RARITIES below) -----
// Special behaviour, read by the Zombies game: range (bullets stop short), pierce (the bullet goes
// through every zombie in its path, each one taking `pierce` times the last one's damage), chain
// (lightning jumps on to the nearest zombies), spin (fires slowly at first and spins up to `rate`),
// flame (fire instead of tracers), noHitPoints (hits don't give the usual +10, only kills do).
Object.assign(WEAPONS, {
  revolver: {
    key: 'revolver', name: 'Six-Shooter', slot: 2, damage: 46, headMult: 4, rate: 0.32, auto: false,
    mag: 6, reserve: 42, reload: 2.6, spread: 0.004, moveSpread: 0.05, airSpread: 0.12, kick: 0.035,
    recoilSpread: 0.015, armorPen: 0.8, falloff: 0.9, speed: 0.95, price: 0, deploy: 0.45, sound: 'revolver', vm: 'revolver',
  },
  micro: {
    key: 'micro', name: 'Kampung Micro', slot: 1, damage: 16, headMult: 3.5, rate: 0.055, auto: true,
    mag: 32, reserve: 160, reload: 2.0, spread: 0.02, moveSpread: 0.02, airSpread: 0.08, kick: 0.006,
    recoilSpread: 0.005, armorPen: 0.5, falloff: 0.8, speed: 0.98, price: 0, deploy: 0.4, sound: 'micro', vm: 'micro',
  },
  pdw: {
    key: 'pdw', name: 'Hornet PDW', slot: 1, damage: 21, headMult: 3.5, rate: 0.066, auto: true,
    mag: 50, reserve: 200, reload: 2.8, spread: 0.007, moveSpread: 0.03, airSpread: 0.08, kick: 0.007,
    recoilSpread: 0.003, armorPen: 0.6, falloff: 0.88, speed: 0.95, price: 0, deploy: 0.5, sound: 'pdw', vm: 'pdw',
  },
  autoshotgun: {
    key: 'autoshotgun', name: 'Combat Shotgun', slot: 1, damage: 16, headMult: 2, pellets: 7, rate: 0.3, auto: false,
    mag: 10, reserve: 60, reload: 3.2, spread: 0.07, moveSpread: 0.02, airSpread: 0.05, kick: 0.04, recoilSpread: 0,
    armorPen: 0.5, falloff: 0.72, speed: 0.88, price: 0, deploy: 0.6, sound: 'autoshotgun', vm: 'autoshotgun',
  },
  autosniper: {
    key: 'autosniper', name: 'Sentinel Auto-Sniper', slot: 1, damage: 68, headMult: 3, rate: 0.26, auto: false,
    mag: 15, reserve: 75, reload: 3.4, spread: 0.06, scopedSpread: 0.0012, moveSpread: 0.12, airSpread: 0.2, kick: 0.022,
    recoilSpread: 0.004, armorPen: 0.9, falloff: 0.99, speed: 0.82, price: 0, deploy: 0.8, sound: 'autosniper', vm: 'autosniper',
    scope: true, zoomFov: 30,
  },
  thumper: {
    key: 'thumper', name: 'Coconut Thumper', slot: 1, damage: 70, headMult: 1.5, rate: 0.8, auto: false,
    mag: 6, reserve: 30, reload: 3.4, spread: 0.004, moveSpread: 0.03, airSpread: 0.06, kick: 0.06, recoilSpread: 0,
    armorPen: 1, falloff: 1, speed: 0.88, price: 0, deploy: 0.7, sound: 'thumper', vm: 'thumper',
    splash: { radius: 3.6, damage: 150 }, splashColor: 0xffa040, tracer: 0xffa040,
  },
  minigun: {
    key: 'minigun', name: 'Sahur Shredder', slot: 1, damage: 22, headMult: 3, rate: 0.05, auto: true, spin: { from: 0.16, time: 0.9 },
    mag: 150, reserve: 450, reload: 5.5, spread: 0.012, moveSpread: 0.04, airSpread: 0.12, kick: 0.0035,
    recoilSpread: 0.0012, armorPen: 1, falloff: 0.95, speed: 0.74, price: 0, deploy: 1.0, sound: 'minigun', vm: 'minigun',
  },
  petir: {
    key: 'petir', name: 'Petir Arc', slot: 1, damage: 52, headMult: 2, rate: 0.22, auto: true,
    mag: 30, reserve: 150, reload: 2.6, spread: 0.002, moveSpread: 0.01, airSpread: 0.04, kick: 0.012, recoilSpread: 0.001,
    armorPen: 1, falloff: 1, speed: 0.92, price: 0, deploy: 0.6, sound: 'petir', vm: 'petir',
    tracer: 0x8fe4ff, chain: { jumps: 3, range: 6, mult: 0.65 },
  },
  rail: {
    key: 'rail', name: 'Tung Lance', slot: 1, damage: 220, headMult: 2, rate: 1.15, auto: false,
    mag: 5, reserve: 35, reload: 3.0, spread: 0.001, moveSpread: 0.03, airSpread: 0.08, kick: 0.05, recoilSpread: 0,
    armorPen: 1, falloff: 1, speed: 0.88, price: 0, deploy: 0.7, sound: 'rail', vm: 'rail',
    tracer: 0x5ff2ff, pierce: 0.85,
  },
  torch: {
    key: 'torch', name: 'Sambal Torch', slot: 1, damage: 8, headMult: 1.25, pellets: 3, rate: 0.06, auto: true,
    mag: 100, reserve: 300, reload: 3.6, spread: 0.07, moveSpread: 0, airSpread: 0.02, kick: 0.0015, recoilSpread: 0,
    armorPen: 1, falloff: 0.75, speed: 0.9, price: 0, deploy: 0.7, sound: 'torch', vm: 'torch',
    range: 8.5, pierce: 0.6, flame: true, noHitPoints: true,
  },
});

// ----- Zombies: gun rarities -----
// Every Zombies gun (except the starting P-9) has a rarity. Common and rare guns are sold at the
// Gun Shop; every rarity has its own case, sold at its own vending machine. A case holds the five
// guns of its rarity: `guns` are [key, weight] (the odds of each one when you open it).
export const RARITIES = {
  common: {
    name: 'Common', color: '#b0c3d9', glow: 0xb0c3d9, casePrice: 1000, ammo: 0, sell: 250,
    guns: [['revolver', 24], ['deagle', 20], ['smg', 20], ['micro', 20], ['shotgun', 16]],
  },
  rare: {
    name: 'Rare', color: '#4b8bff', glow: 0x4b8bff, casePrice: 2500, ammo: 0, sell: 600,
    guns: [['m16', 24], ['pdw', 22], ['scout', 20], ['autoshotgun', 18], ['m4', 16]],
  },
  epic: {
    name: 'Epic', color: '#a659ff', glow: 0xa659ff, casePrice: 6000, ammo: 1500, sell: 1500,
    guns: [['ak', 24], ['lmg', 20], ['sniper', 20], ['autosniper', 18], ['thumper', 18]],
  },
  legendary: {
    name: 'Legendary', color: '#ffb02e', glow: 0xffb02e, casePrice: 15000, ammo: 2500, sell: 3750,
    guns: [['minigun', 22], ['petir', 22], ['rail', 21], ['torch', 21], ['raygun', 14]],
  },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
export const rarityOf = (key) => RARITY_ORDER.find((r) => RARITIES[r].guns.some(([k]) => k === key)) || null;
// a case's odds, as percentages: [[key, %], ...]
export const caseOdds = (rarity) => {
  const g = RARITIES[rarity].guns, total = g.reduce((a, [, w]) => a + w, 0);
  return g.map(([k, w]) => [k, Math.round(w / total * 1000) / 10]);
};
// a random gun out of a case of this rarity
export function rollCase(rarity, rnd = Math.random) {
  const g = RARITIES[rarity].guns, total = g.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [k, w] of g) { r -= w; if (r < 0) return k; }
  return g[g.length - 1][0];
}
// the inventory (I): how many cases and guns it holds
export const STASH_SIZE = 24;
// selling a stored gun: by rarity, plus 1000 a Pack-a-Punch level (the starting P-9: 100)
export const sellValue = (key, pap = 0) => (RARITIES[rarityOf(key)]?.sell || 100) + 1000 * (pap | 0);
// The Mystery Box: any gun, but mostly common ones (a case is the sure way to get a better one)
const BOX_RARITY = { common: 55, rare: 30, epic: 12, legendary: 3 };
export const BOX_WEAPONS = RARITY_ORDER.flatMap((r) => {
  const g = RARITIES[r].guns, total = g.reduce((a, [, w]) => a + w, 0);
  return g.map(([k, w]) => [k, BOX_RARITY[r] * w / total]);
});

// Aiming down sights (Zombies, hold right click), by viewmodel: how much it zooms in and how long
// it takes to raise the gun. Scoped snipers use their scope instead; knives can't aim, and neither
// can the minigun or the flamethrower (they're fired from the hip).
export const ADS = {
  pistol: { zoom: 1.2, time: 0.13 }, deagle: { zoom: 1.25, time: 0.16 }, raygun: { zoom: 1.3, time: 0.16 },
  smg: { zoom: 1.3, time: 0.16 }, shotgun: { zoom: 1.2, time: 0.2 },
  ak: { zoom: 1.45, time: 0.2 }, m4: { zoom: 1.45, time: 0.2 }, m16: { zoom: 1.5, time: 0.21 }, lmg: { zoom: 1.35, time: 0.28 },
  revolver: { zoom: 1.25, time: 0.15 }, micro: { zoom: 1.25, time: 0.14 }, pdw: { zoom: 1.35, time: 0.17 },
  autoshotgun: { zoom: 1.2, time: 0.2 }, thumper: { zoom: 1.25, time: 0.22 }, petir: { zoom: 1.35, time: 0.2 },
  rail: { zoom: 1.5, time: 0.24 },
};
export const adsOf = (def) => (!def || def.melee || def.scope ? null : ADS[def.vm] || null);

// Pack-a-Punch levels (Zombies). Each station upgrades a gun one level further, in order.
// Multipliers apply to the base gun; rate < 1 fires faster.
export const PAP_LEVELS = [
  null,
  { tag: '',     damage: 2.2, mag: 1.5,  reserve: 2,   rate: 1,    tracer: 0xc070ff },
  { tag: ' II',  damage: 3.2, mag: 1.75, reserve: 2.5, rate: 0.9,  tracer: 0x4fe3ff },
  { tag: ' III', damage: 4.6, mag: 2,    reserve: 3,   rate: 0.82, tracer: 0xffc93a },
  { tag: ' IV',  damage: 6.6, mag: 2.5,  reserve: 3.5, rate: 0.74, tracer: 0xff3b3b },
];
export const MAX_PAP = PAP_LEVELS.length - 1;

// Pack-a-Punch: an upgraded copy of a weapon definition (level 1..MAX_PAP). def.pap = its level.
export function papDef(def, level = 1) {
  const base = WEAPONS[def.key] || def, lv = Math.max(1, Math.min(MAX_PAP, level | 0)), L = PAP_LEVELS[lv];
  return {
    ...base, pap: lv, name: "Tung'd " + base.name + L.tag,
    damage: base.damage * L.damage, rate: base.rate * L.rate,
    mag: Math.round(base.mag * L.mag), reserve: Math.round(base.reserve * L.reserve),
    splash: base.splash ? { radius: base.splash.radius * (1.2 + 0.1 * lv), damage: base.splash.damage * L.damage * 0.9 } : undefined,
    tracer: L.tracer,
  };
}

// ----- Zombies Gun Shop (the counter you spawn at): the common and rare guns, one more for every
// round you survive. after: how many rounds you need to have survived before it's on sale.
// Prices in points. (Epic and legendary guns only come out of cases and the Mystery Box.)
export const ZOMBIE_PRICES = { pistol: 500, revolver: 500, deagle: 700, smg: 1000, micro: 1100, shotgun: 1500,
  m16: 1600, pdw: 1800, scout: 1700, autoshotgun: 2000, m4: 2200 };
export const ZOMBIE_SHOP = [
  { key: 'revolver', cat: 'Pistol', after: 0 }, { key: 'deagle', cat: 'Pistol', after: 0 }, { key: 'smg', cat: 'SMG', after: 0 },
  { key: 'micro', cat: 'SMG', after: 1 }, { key: 'shotgun', cat: 'Shotgun', after: 2 },
  { key: 'm16', cat: 'Rifle', after: 3 }, { key: 'pdw', cat: 'SMG', after: 4 }, { key: 'scout', cat: 'Sniper', after: 5 },
  { key: 'autoshotgun', cat: 'Shotgun', after: 6 }, { key: 'm4', cat: 'Rifle', after: 7 },
];
// refilling a gun's ammo (at the Gun Shop): half its price; epic and legendary guns have a set
// price; more once it's upgraded
export function ammoCost(w) {
  if (w.def.pap) return 2500 + 2000 * w.def.pap;
  if (ZOMBIE_PRICES[w.key]) return Math.round(ZOMBIE_PRICES[w.key] / 2);
  return RARITIES[rarityOf(w.key)]?.ammo || 500;
}

export const ARMOR_PRICE = 1000;

// Buy menu entries, bought with keys 1..8 in this order. key(team) is the weapon you get
// (the AK / M4 slot depends on your side); armor has no weapon key.
const weaponItem = (cat, key) => ({
  cat, key, label: (team) => WEAPONS[key(team)].name, price: (team) => WEAPONS[key(team)].price,
});
export const BUY_ITEMS = [
  weaponItem('Pistol', () => 'deagle'),
  weaponItem('Shotgun', () => 'shotgun'),
  weaponItem('SMG', () => 'smg'),
  weaponItem('Rifle', () => 'm16'),
  weaponItem('Rifle', (team) => (team === 'T' ? 'ak' : 'm4')),
  weaponItem('Sniper', () => 'scout'),
  weaponItem('Sniper', () => 'sniper'),
  { cat: 'Gear', key: null, armor: true, label: () => 'Kevlar + Helmet', price: () => ARMOR_PRICE },
];
