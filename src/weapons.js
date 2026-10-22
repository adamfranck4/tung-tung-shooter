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
  raygun: {
    key: 'raygun', name: 'Tung Ray', slot: 1, damage: 140, headMult: 1.5, rate: 0.32, auto: false,
    mag: 20, reserve: 160, reload: 2.8, spread: 0.002, moveSpread: 0.01, airSpread: 0.02, kick: 0.02, recoilSpread: 0,
    armorPen: 1, falloff: 1, speed: 0.96, price: 0, deploy: 0.5, sound: 'raygun', vm: 'raygun',
    splash: { radius: 3.2, damage: 240 }, tracer: 0x50ff70,
  },
});

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

// ----- Zombies shop (B): guns unlock every couple of rounds; prices in points -----
export const ZOMBIE_PRICES = { pistol: 500, deagle: 700, smg: 1000, shotgun: 1500, m16: 1600, scout: 1700,
  ak: 1800, m4: 1800, sniper: 2000, lmg: 3000, raygun: 8000 };
export const ZOMBIE_SHOP = [
  { key: 'deagle', cat: 'Pistol', round: 1 }, { key: 'smg', cat: 'SMG', round: 1 },
  { key: 'shotgun', cat: 'Shotgun', round: 3 }, { key: 'm16', cat: 'Rifle', round: 3 },
  { key: 'ak', cat: 'Rifle', round: 5 }, { key: 'scout', cat: 'Sniper', round: 5 },
  { key: 'm4', cat: 'Rifle', round: 7 }, { key: 'sniper', cat: 'Sniper', round: 7 },
  { key: 'lmg', cat: 'LMG', round: 9 },
];
// refilling a gun's ammo (shop or wall): half its price, more once it's upgraded
export function ammoCost(w) {
  if (w.def.pap) return 2500 + 2000 * w.def.pap;
  return Math.round((ZOMBIE_PRICES[w.key] || 500) / 2);
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
