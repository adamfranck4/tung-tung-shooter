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
};

// ----- extra weapons used in Zombies mode -----
Object.assign(WEAPONS, {
  shotgun: {
    key: 'shotgun', name: 'Pump Shotgun', slot: 1, damage: 24, headMult: 2, pellets: 8, rate: 0.8, auto: false,
    mag: 8, reserve: 48, reload: 3.0, spread: 0.075, moveSpread: 0.02, airSpread: 0.05, kick: 0.05, recoilSpread: 0,
    armorPen: 0.5, falloff: 0.72, speed: 0.88, price: 1500, deploy: 0.6, reward: 900, sound: 'shotgun', vm: 'shotgun',
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

// Pack-a-Punch: returns an upgraded copy of a weapon definition.
export function papDef(def) {
  return {
    ...def, pap: true, name: "Tung'd " + def.name,
    damage: def.damage * 2.2, mag: Math.round(def.mag * 1.5), reserve: Math.round(def.reserve * 2),
    splash: def.splash ? { radius: def.splash.radius * 1.3, damage: def.splash.damage * 2 } : undefined,
    tracer: def.tracer ? 0xff50ff : 0xc070ff,
  };
}

export const ARMOR_PRICE = 1000;

// buy menu entries (key 1..4)
export const BUY_ITEMS = [
  { id: 'smg', label: () => WEAPONS.smg.name, price: () => WEAPONS.smg.price },
  { id: 'rifle', label: (team) => (team === 'T' ? WEAPONS.ak : WEAPONS.m4).name, price: (team) => (team === 'T' ? WEAPONS.ak : WEAPONS.m4).price },
  { id: 'sniper', label: () => WEAPONS.sniper.name, price: () => WEAPONS.sniper.price },
  { id: 'armor', label: () => 'Kevlar + Helmet', price: () => ARMOR_PRICE },
];
