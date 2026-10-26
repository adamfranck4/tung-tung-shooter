# Tung Tung Shooter

A 5v5 Counter-Strike–style tactical shooter that runs entirely in the browser (Three.js + WebGL).
No build step, no server code, no assets to download — every texture, model and sound is generated in code.

- Original desert map with bomb sites A and B, mid, long and tunnels
- You + 4 bot teammates vs 5 bots, three difficulty levels — or play **online with friends** (see below)
- Buy menu and economy, recoil and spread, headshots, armor
- Guns: P-9 Pistol, Desert Eagle, Pump Shotgun, SMG-7, M16 Burst (3-round burst per click), AK (T) / M4 (CT),
  Scout (light sniper, accurate in the air, lighter zoom), Bolt Sniper
- Bomb plant / defuse, round timer, radar, kill feed, scoreboard, spectating
- Halftime: the teams switch sides after `rounds to win - 1` rounds (after 4, 7 or 12). Scores follow the
  players, and everyone restarts with a pistol and $800
- Bot Terrorists change up their attack every round: rushes, quiet executes, split hits from two routes,
  slow defaults that take map control and then call the weaker site, and fakes. They use every route
  (long, short / catwalk, tunnels, mid to B), sometimes leave a lurker, and avoid repeating recent plans.
  CTs vary their setup (2-1-2 or stacking a site) and can rotate back after falling for a fake
- Every fighter is a "Tung Tung Tung Sahur" kentongan log: dome top, bulging eyes, toothy grin, bare feet,
  and a baseball bat (slung on the back, swung in melee). Team color is the hanging rope: orange = T, blue = CT.
- Knife skins picked in the menu: Knife, Karambit, Flip, Butterfly (with flips), Sword, Katana, Kuronami no Yaiba.
  Skins are cosmetic. Every knife has its own CS2-style draw and inspect (**F**) animation, held in a jointed hand
  that lets go for spins and tosses. Attacks alternate forehand and backhand slashes with a glowing trail. The Katana
  does an iai draw: it comes out of a scabbard held in your left hand, straight into a cut across the screen.
- Kuronami no Yaiba (after Valorant's Kuronami melee): two chained kunai, one in each hand, with glowing blue edges.
  They float up and whirl over your open palms on the draw, attacks fling a kunai out on its chain in a wide blue
  arc and yank it back, and the inspect spins one like a propeller (press **F** again to spin it faster).
- 10 static crosshairs (no spread): Classic Green, s1mple, ZywOo, NiKo, donk, m0NESY, T-Shape, Dot Only,
  Cross + Dot, Circle + Dot. Pro presets use the most commonly reported 2026 settings; pros change them often.
  Add or edit presets in `src/crosshair.js`.

## Movement & feel (matched to CS2)

- CS2's real movement values, converted from Source units: 250 u/s with the knife (215 AK, 225 M4, 200 sniper),
  acceleration 5.5, friction 5.2, stop speed 80, air acceleration 12 with the 30 u/s air-strafe cap,
  gravity 800, 57-unit jump, 18-unit steps. Shift-walk is 52% speed and silent; crouch is 34%.
- Crates are CS2's 64-unit (1.6 m) boxes: you need a crouch-jump to get on top.
- Jump is press-to-jump (no auto-bhop when holding Space), with a short buffer for presses just before landing.
- Physics runs at a fixed 128 ticks per second and every frame is drawn between ticks, so movement is identical
  at 30, 60, 144 or 240 fps and stays smooth on high-refresh screens.
- Raw mouse input (no OS pointer acceleration) and CS2's sensitivity scale (0.022° × sensitivity per count),
  so you can type in your CS2 sensitivity.
- Graphics: **High quality** (realistic materials, soft sky lighting, ambient occlusion in corners and a glow on fire,
  lamps and neon) or **Performance** for slower computers.

## Online play

Pick **Players: Online with friends** in the menu. One person clicks **HOST A ROOM** and gets a 5-letter room
code (and a **Copy invite link** button); everyone else types the code and clicks **JOIN**, or just opens the link.

- **5v5 Classic:** up to 10 players. Everyone picks a team in the lobby (5 per team); the host can fill the empty
  slots with bots (and pick their difficulty) and set the rounds to win.
- **Zombies Co-op:** up to 4 players. See *Co-op* below.
- The host's browser runs the match: keep that tab open. Switching tabs is fine (the match keeps ticking in the
  background), but if the host closes the tab or leaves, the room closes for everyone.
- Pressing Esc opens a menu but doesn't pause an online match. The host can end the match from there and
  everyone goes back to the lobby.
- Players connect to each other directly (WebRTC, via [PeerJS](https://peerjs.com)). PeerJS's free public server
  is only used to find each other, so there is still no server to deploy. Hosting a full 10-player room uses about
  1 Mbps of upload.
- Joining a match that has already started isn't supported: join in the lobby.
- Testing on one computer: open two tabs with `?net=local` added to the URL (they connect without the internet;
  `&lag=150` fakes a 150 ms round trip).

## Zombies mode

Pick **Zombies** in the menu for survival in **Sahur Village**, a night-time map built for this mode — alone or
online with up to 3 friends.

- **The Gun Shop** is where you spawn: the walk-in shop in the middle of the Courtyard (the middle of the village),
  with glowing signs on its roof and over both doors. Press **E** at the counter to open the shop menu: it sells the
  common and rare guns, and ammo for whatever two guns you carry (any rarity). Click a gun to buy it (or press 1-9, 0).
  The guns also hang on the wall behind the counter: the ones on sale with their price (in their rarity's color),
  the rest as faded outlines with the round they unlock after. Buying a gun you already carry refills its ammo.
- **Everything unlocks as you survive.** Nobody buys doors: at the end of each round one more area opens (its doors
  swing open by themselves) and one more gun goes on sale at the Gun Shop. A banner says what's new.

  | Survive round | Area that opens | New at the Gun Shop |
  | --- | --- | --- |
  | (start) | Courtyard | Six-Shooter 500, Desert Eagle 700, SMG-7 1000 |
  | 1 | Village Hall (Quick Revive) | Kampung Micro 1100 |
  | 2 | Kitchen | Pump Shotgun 1500 |
  | 3 | Drum Tower | M16 Burst 1600 |
  | 4 | Garden | Hornet PDW 1800 |
  | 5 | Rice Barn | Scout 1700 |
  | 6 | Sahur Hill | Combat Shotgun 2000 |
  | 7 | Tree House (upstairs) | M4 Rifle 2200 |
  | 8 | Dead Orchard | |
  | 9 | Night Market | |
  | 10 | Spooky Woods | |
  | 11 | Container Yard | |

  A door opens when both of the areas it joins are open. A locked door shows the round it opens after (on the
  door and on the map), and standing next to it tells you which area is behind it.
- **Ammo:** at the Gun Shop only (there's no B menu in Zombies). It refills the spare ammo of a gun you carry: half
  the gun's price for common and rare guns, 1500 for epic guns, 2500 for legendary guns, and 4500 / 6500 / 8500 / 10500
  once it's upgraded to level I-IV.

### Guns, rarities and cases

Every Zombies gun (except the P-9 you start with) has a rarity: **common** (grey-blue), **rare** (blue), **epic**
(purple) or **legendary** (gold). Rarer guns are stronger, but not by a mile: a legendary gun is a big help, not a win
button.

| Rarity | Guns | Where you get them |
| --- | --- | --- |
| Common | Six-Shooter (revolver), Desert Eagle, SMG-7, Kampung Micro (fast machine pistol), Pump Shotgun | Gun Shop, Common Case, Mystery Box |
| Rare | M16 Burst, Hornet PDW (50-round bullpup), Scout, Combat Shotgun (semi-auto), M4 Rifle | Gun Shop, Rare Case, Mystery Box |
| Epic | AK Rifle, Drum LMG, Bolt Sniper, Sentinel Auto-Sniper (semi-auto, scoped), Coconut Thumper (explosive launcher) | Epic Case, Mystery Box |
| Legendary | Sahur Shredder, Petir Arc, Tung Lance, Sambal Torch, Tung Ray | Legendary Case, Mystery Box |

The legendary guns each do something special:
- **Sahur Shredder:** a six-barrel minigun. It fires slowly at first and spins up over about a second while you hold
  the trigger (the barrels spin), 150-round belt. Fired from the hip, and you move a little slower with it.
- **Petir Arc:** a lightning gun. Each shot jumps on from the zombie it hits to up to 3 more nearby (65% of the damage
  each jump), with a crackle of blue lightning.
- **Tung Lance:** a railgun. A slow, heavy shot that goes through every zombie in a line (each one takes 85% of what
  the last one did).
- **Sambal Torch:** a flamethrower with a red chili fuel tank. Short range (about 8 m), sets the front of a crowd alight
  (the flames reach a second zombie at 60%). Its hits don't give the +10 points, only its kills do.
- **Tung Ray:** the old wonder weapon, nerfed: 90 damage (was 140), a smaller and weaker blast (2.6 m / 110, was
  3.2 m / 240), 16-shot magazine (was 20) and a bit slower. Still the best splash gun.

**Case vending machines:** four machines stand side by side against the Courtyard's north wall, by the door to the Drum
Tower, under a glowing CASES sign: one per rarity, in its color. Press **E** at one to buy that case; it goes into your
inventory.

| Case | Price |
| --- | --- |
| Common | 1000 |
| Rare | 2500 |
| Epic | 6000 |
| Legendary | 15000 |

**Inventory (press I, anywhere):** shows your loadout (slots 1 and 2, and your knife) and up to 24 stored cases and
guns. Click **OPEN** on a case for the CS-style case opening: the case and its five guns with their odds, then **UNLOCK
CASE** spins a strip of guns past a yellow line that slows down and stops on what you got (click or Esc to skip). The
gun goes into your inventory; equip it to slot 1 or 2 right there, open another case of the same kind, or keep it
stored. Stored guns keep their ammo and Pack-a-Punch level. On a stored gun: **SLOT 1 / SLOT 2** swaps it with what's in
that slot, **SELL** (click twice) sells it (common 250, rare 600, epic 1500, legendary 3750, +1000 per Pack-a-Punch
level). On a gun you carry: **PUT AWAY** stores it. When a new gun (Gun Shop, Mystery Box) replaces the one in your
hands, that one goes into your inventory too, if there's room. Max Ammo refills stored guns as well.

The case odds (each case holds its five guns):

| Case | Odds |
| --- | --- |
| Common | Six-Shooter 24%, Desert Eagle 20%, SMG-7 20%, Kampung Micro 20%, Pump Shotgun 16% |
| Rare | M16 Burst 24%, Hornet PDW 22%, Scout 20%, Combat Shotgun 18%, M4 Rifle 16% |
| Epic | AK Rifle 24%, Drum LMG 20%, Bolt Sniper 20%, Sentinel Auto-Sniper 18%, Coconut Thumper 18% |
| Legendary | Sahur Shredder 22%, Petir Arc 22%, Tung Lance 21%, Sambal Torch 21%, Tung Ray 14% |

The Gun Shop and inventory menus free the mouse so you can click. In a solo game the game pauses while one is open;
online the match keeps running (like the Esc menu), so find a quiet moment. Online, cases are rolled by the host and
everyone is told when someone unboxes an epic or legendary gun.

- Endless rounds of Tung Tung zombies with bats. They tear boards off the windows and climb in, or rise from
  the ground. Regular zombies start with 100 HP (same as a player); each round brings more of them, and they get
  faster (walkers → runners → sprinters) and tougher (see *Zombie health* below).
- **Big zombies** (from round 3): ~1.7x size, 400 + 80 × round HP, hit for 80, worth 250 points. They rise from
  the ground (max 3 at once).
- **Zombie types.** Regular (red) zombies stay the most common (at least 40% of each round). The first time a
  type is due, one comes early in the round and a message tells you what it is:
  - **Yellow speedster** (round 2+): runs faster than you (~6.7 m/s), but only 70 HP. Hits for 35, often.
  - **Brown crawler** (round 2+): drags itself along the floor on its hands, face first. Low and hard to hit
    (aim low, the face out front is its head). 90 HP, bites for 30.
  - **Pink thrower** (round 3+): stops about 10 m away when it can see you and lobs coconuts (30 damage) in
    an arc. Keep moving to dodge them. Swipes for 35 if you get close.
  - **Purple flyer** (round 4+): bat wings. Swoops in from the sky (or the rafters indoors), cruises above
    the others weaving side to side, then dives on you. Ducks under roofs and doorways. 80 HP, hits for 40.
  - **Rainbow giant** (round 5+): 2.2x size, 900 + 120 × round HP, hits for 100. Slow, shakes the ground
    as it walks, and ignores Insta-Kill and Kaboom. Worth 500 points and always drops a power-up.
    One at a time (two from round 12); it only rises out of open ground.
  - **THE BOSS** (every 7th round: 7, 14, 21...): a huge crowned, winged Tung Tung with a health bar across the
    top of the screen. It flies, hovers to throw fans of big coconuts, and swoops in to hit for 90. Each visit
    it comes back in new colors (Magma, Frost, Venom, Void, then round again) and tougher: more health
    (4272 on round 7, more per visit, and more with more players), more coconuts per volley (3, 4, 5... up
    to 7), faster flying and throwing, and from round 14 it calls in purple flyers. Ignores Insta-Kill and
    Kaboom, worth 3000 points, and always drops a power-up. The round doesn't end until it's down.
  - Kill points: the usual 60 / 100 headshot / 130 knife, +30 speedster, +20 crawler, +40 thrower or flyer.
- **Zombie health goes up every round.** The health above is round 1. Regular zombies and the speedster, crawler,
  thrower and flyer gain 12% of it a round up to double on round 10, then 8% more each round after that (up to
  20x). Big zombies, the rainbow giant and the boss already grow with the round, and on top of that gain 3% a
  round, then 5% a round after round 10 (up to 8x).

  | Round | Regular | Speedster | Big zombie | Rainbow giant | Boss |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 100 | 70 | 480 | 1020 | |
  | 5 | 148 | 104 | 896 | 1680 | |
  | 7 | 172 | 120 | 1133 | 2053 | 4272 |
  | 10 | 208 | 146 | 1524 | 2667 | |
  | 14 | 283 | 198 | 2346 | 3983 | 9170 |
  | 20 | 449 | 314 | 4137 | 6827 | |
  | 21 | 485 | 339 | 4518 | 7429 | 17942 |
  | 30 | 969 | 679 | 9435 | 15164 | |

  (The boss gets 65% more for each extra player.)
- You get 20 seconds between waves (time to get back to the Gun Shop); press **N** to start the next wave right away.
- **Sahur Hill** (doors from the Courtyard and the Kitchen alley): two hills, a walk-through hut, and a stepped
  stone pyramid with a staircase up the middle of each side and braziers on its corners. The last Pack-a-Punch
  is on top, and zombies come up all four staircases. Its sides are four 1 m steps, each 0.8 m high: jump up and
  down them and run all over it. Zombies jump up the steps after you, so it's no hiding place. The Gun Shop in the
  Courtyard is walk-through too (doors east and west).
- **The fountain** in the Courtyard sits on a round mound with a ramp all the way round, so zombies walk right
  up to anyone standing on it (no camping).
- **Night Market** (doors from the alley, or up a zig-zag path from Sahur Hill): striped market stalls
  and a walk-through shop.
- **Rice Barn** (doors from the Courtyard, through a bending corridor, or from Sahur Hill): a big barn
  whose stall walls make a winding path through it.
- **Dead Orchard** (doors from the Village Hall, or down a winding path from the Garden): dying trees,
  fallen logs, a tool shed, and graves that zombies rise from.
- **Spooky Woods** (door from the Dead Orchard): a thicket of dead trees on dark earth, old graves, low mist
  and two drifting will-o'-the-wisps (green and violet). Zombies rise out of the ground between the trees.
- **Container Yard** (doors from the Spooky Woods, the Village Hall and the Night Market): a big concrete yard
  along the south edge of the map, full of shipping containers (some stacked two high) under sodium lamps.
  The containers stand apart from each other and the walls, so there are no dead ends to hide in.
- **Tree House (upstairs, 2F):** a wooden second floor on the house between the Courtyard and Sahur Hill: three
  rooms in a row (Lantern Loft, Sleeping Loft, Lookout) with wide open doorways between them, so it opens all
  at once. Outdoor stone stairs climb to it from both sides, each with one door at the top: up the Courtyard's
  east wall and up Sahur Hill's west wall.
  Balconies look out over the Courtyard and Sahur Hill (and down on the stairs), and windows over the paths either side, so you can shoot
  down at the zombies coming for you. Zombies take the stairs; only flyers come straight in. You can jump down
  from a balcony or the landings to get out fast.
- **Minimap (top left):** the area around you (32 m to the edge), turning with you so the way you face is up,
  with N on the rim. It shows open and locked floor, walls, closed doors, the Gun Shop, perks, Pack-a-Punch, the
  Mystery Box and the case machines, and your teammates as arrows in their map colors with their names (a red
  cross when they're down). A teammate off the edge shows as a dot on the rim, in their direction. It hides while
  the big map is open.
- **Map (press M):** shows the whole village with the rooms you've opened lit up (locked ones hatched, with the round
  they open after), every closed door with its round (R3 = opens after round 3), the Gun Shop, the stairs (the arrow
  points up), perks, Pack-a-Punch stations and the Mystery Box,
  and an arrow for you and each teammate (a red cross when someone is down). Underneath, it lists which room
  everyone is in. It stays open while you play; M again closes it.
- **Aim down sights (hold right click):** any gun without a scope comes up to your eye with its front sight on the
  middle of the screen. The view zooms in a little (more for rifles), spread is halved (moving too), recoil drops
  by a quarter, and you walk at 70% speed. Reloading lowers the gun. The Scout and Bolt Sniper still scope in.
- **No standing on walls or roofs:** walls, roofs and tall props (perk machines, Pack-a-Punch, lamp posts,
  trees, containers) have invisible walls above them (the pyramid's steps don't), so you can't jump up onto (or across) them. Bullets and
  zombies aren't affected.
- Every roof and hut doorway is tall enough for the rainbow giant. The village also has bunting with paper
  lanterns, painted shutters (some windows lit from inside), boarded-up doors, and dead trees and logs here and there.
- Points: +10 per hit, +60 per kill, +100 headshot kill, +130 knife kill, +10 per board you rebuild (hold E).
- At the Gun Shop a new gun replaces the gun in your hands when you already carry two (that one goes into your
  inventory). It's the only place that sells guns (there are no wall guns); epic and legendary guns only come out of
  cases and the Mystery Box.
- Spend points on (press E):
  - Perks: Quick Revive 500 (gets you back up once), Double Tap 2000, Juggernog 2500 (more health), Speed Cola 3000 (faster reloads)
  - Mystery Box 950: a random gun of any rarity, but mostly common ones (55% common, 30% rare, 12% epic, 3% legendary).
    A case is the sure way to get the rarity you want.
  - **Pack-a-Punch, four levels.** Each station upgrades the gun in your hands one level, in order, so a gun
    can keep up as the waves get harder. The hint at a station tells you where the next one is.

    | Level | Station | Cost | Damage | Mag / reserve | Fire rate |
    | --- | --- | --- | --- | --- | --- |
    | I | Drum Tower (purple) | 5000 | x2.2 | x1.5 / x2 | same |
    | II | Kitchen (cyan) | 10000 | x3.2 | x1.75 / x2.5 | +11% |
    | III | Garden (gold) | 15000 | x4.6 | x2 / x3 | +22% |
    | IV | Top of the pyramid (red) | 25000 | x6.6 | x2.5 / x3.5 | +35% |

    Buying a new gun starts it back at level 0.
- Power-ups drop from zombies: Max Ammo, Insta-Kill, Double Points, Kaboom (nuke), Carpenter.
- Health regenerates when you avoid hits for a few seconds. Without Quick Revive, going down ends the game
  (with it, you shoot back with your pistol for a few seconds while it gets you up).

### Co-op

- Zombies go for whoever is closest. Each round has more of them with more players (+50% per extra player).
- Areas, windows, the Mystery Box, Pack-a-Punch and power-ups are shared; points, perks, guns and inventories are your own.
  Only the player who paid for the Mystery Box can take its gun. Max Ammo refills everyone; Carpenter and
  Kaboom give every player their points.
- Going down doesn't end the game: you lose your perks and have 100 seconds. A teammate holds **E** next to you
  for 3 seconds to revive you (1.5 with Quick Revive). Downed teammates show a red cross you can see through walls.
- While down you're in last stand: you can't move, but you can aim, shoot and reload a pistol to cover whoever is
  reviving you. You get the strongest pistol you carry (P-9, Six-Shooter or Desert Eagle, upgrades included) or a spare P-9
  if you have none, with at least two magazines of ammo. Your other gun comes back when you're revived.
- If nobody gets to you, you bleed out and watch your teammates until the next round, when you come back next
  to a teammate with a pistol (you keep your points).
- The game is over when everyone is down or out at the same time.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim / shoot (right click scopes the Scout and Bolt Sniper; in Zombies, hold it to aim down sights with other guns) |
| Space | Jump |
| C or Ctrl | Crouch |
| Shift | Walk (quiet, more accurate) |
| 1 / 2 / 3, Q, wheel | Switch weapons |
| R | Reload |
| B | Buy menu (in spawn during buy time), then 1-8 to buy (5v5 only) |
| E | Zombies: buy (Gun Shop counter, case machines, perks, box, Pack-a-Punch) |
| I | Zombies: inventory (stored guns and cases, case opening) |
| E (hold) | Plant / defuse, rebuild boards, revive a teammate |
| Tab | Scoreboard |
| M | Map (Zombies) |
| F | Inspect weapon |

## Run locally

Any static file server works. With Python:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

Add `?low` to the URL for Performance graphics on slow machines (simpler materials and shadows, no ambient
occlusion or glow).

## Deploy to Vercel (Hobby plan)

It's a plain static site, so it fits the free Hobby plan.

**Option A — GitHub**
1. Push this folder to a GitHub repo.
2. In Vercel: *Add New → Project*, import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty. Deploy.

**Option B — Vercel CLI**
```bash
npm i -g vercel
vercel --prod
```
(run inside this folder)

## Files

- `index.html`, `style.css` — page, menus, HUD layout
- `src/main.js` — renderer, lighting, sky, menu, game loop
- `src/gfx.js` — the graphics setting and the materials that depend on it
- `src/postfx.js` — High graphics screen effects: ambient occlusion and glow
- `src/map.js` — map layout, geometry, collision boxes, A* pathfinding, attack routes for the bots
- `src/game.js` — rounds, economy, bomb, bullets, damage, spectating
- `src/combatant.js` — shared movement, weapons, recoil, hitboxes
- `src/player.js` — keyboard/mouse control
- `src/bots.js`, `src/director.js` — bot AI and team strategy (and the Tung Tung model)
- `src/zmap.js`, `src/zombies.js` — Zombies map (Sahur Village) and Zombies rules / zombie AI
- `src/zui.js` — Zombies Gun Shop menu, inventory and case opening (gun pictures are rendered from the gun models)
- `src/net.js` — online rooms, lobby and message batching (PeerJS)
- `src/avatar.js` — other players' fighters, moved by network updates
- `src/netclassic.js`, `src/netzombies.js` — 5v5 and Zombies on a joining player's browser (the host runs
  `game.js` / `zombies.js` for everyone)
- `src/viewmodel.js`, `src/effects.js`, `src/audio.js`, `src/hud.js`, `src/textures.js`
