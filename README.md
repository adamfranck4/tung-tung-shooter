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
- Knife skins picked in the menu: Knife, Karambit, Flip, Butterfly (with flips), Sword, Katana. Skins are cosmetic.
  Every knife has its own CS2-style draw and inspect (**F**) animation, held in a jointed hand that lets go
  for spins and tosses. Attacks alternate forehand and backhand slashes with a glowing trail. The Katana does an
  iai draw: it comes out of a scabbard held in your left hand, straight into a cut across the screen.
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
- Graphics: **High quality** (detailed surfaces + soft sky lighting) or **Performance** for slower computers.

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

- Endless rounds of Tung Tung zombies with bats. They tear boards off the windows and climb in, or rise from
  the ground. Regular zombies have 100 HP (same as a player); each round brings more of them, and they get
  faster (walkers → runners → sprinters).
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
  - Kill points: the usual 60 / 100 headshot / 130 knife, +30 speedster, +20 crawler, +40 thrower or flyer.
- Between rounds, press **N** to start the next wave right away.
- **Sahur Hill** (doors from the Courtyard 1250 / Kitchen 1000): two hills, a walk-in hut, and a watchtower
  with a hanging kentongan, reached by stairs or a ladder (W climbs the way you look; S or look down to go down).
  Zombies take the stairs. The Courtyard also has a walk-in hut you can run through.
- **The fountain** in the Courtyard sits on a round mound with a ramp all the way round, so zombies walk right
  up to anyone standing on it (no camping).
- **Night Market** (doors from the alley 1250, or up a zig-zag path from Sahur Hill 1000): striped market stalls
  and a walk-through shop. Scout on the wall.
- **Rice Barn** (doors from the Courtyard 1000, through a bending corridor, or Sahur Hill 1250): a big barn
  whose stall walls make a winding path through it. M16 on the wall.
- **Dead Orchard** (doors from the Spawn Room 1250, or down a winding path from the Garden 1000): dying trees,
  fallen logs, a tool shed, and graves that zombies rise from. Desert Eagle on the wall.
- **Upstairs (2F):** a wooden second floor on the house between the Courtyard and Sahur Hill, with three rooms
  in a row. Outdoor stone stairs climb to it from both sides: up the Courtyard's east wall to the **Lantern Loft**
  (door 1000), and up Sahur Hill's west wall to the **Lookout** (door 1000). The **Sleeping Loft** in the middle
  opens from either one (750 each side) and has an AK on the wall; the Lookout has a Scout. Balconies look out over
  the Courtyard and Sahur Hill (and down on the stairs), and windows over the paths either side, so you can shoot
  down at the zombies coming for you. Zombies take the stairs; only flyers come straight in. You can jump down
  from a balcony or the landings to get out fast.
- **Map (press M):** shows the whole village with the rooms you've opened lit up (locked ones hatched), every closed
  door with its price, the stairs (the arrow points up), perks, Pack-a-Punch stations, the Mystery Box and wall guns,
  and an arrow for you and each teammate (a red cross when someone is down). Underneath, it lists which room
  everyone is in. It stays open while you play; M again closes it.
- **Aim down sights (hold right click):** any gun without a scope comes up to your eye with its front sight on the
  middle of the screen. The view zooms in a little (more for rifles), spread is halved (moving too), recoil drops
  by a quarter, and you walk at 70% speed. Reloading lowers the gun. The Scout and Bolt Sniper still scope in.
- Every roof and hut doorway is tall enough for the rainbow giant. The village also has bunting with paper
  lanterns, painted shutters (some windows lit from inside), boarded-up doors, and dead trees and logs here and there.
- Points: +10 per hit, +60 per kill, +100 headshot kill, +130 knife kill, +10 per board you rebuild (hold E).
- **Shop (press B, anywhere):** buy guns and ammo with points. More guns unlock every two rounds:
  - Round 1: Desert Eagle 700, SMG 1000 · Round 3: Shotgun 1500, M16 1600 · Round 5: AK 1800, Scout 1700 ·
    Round 7: M4 1800, Sniper 2000 · Round 9: Drum LMG 3000
  - 1-9 buys a gun (it replaces the gun in your hands when you already carry two), 0 refills the ammo of the
    gun in your hands (half its price; 4500 / 6500 / 8500 / 10500 once it's upgraded to level I-IV).
  - The Tung Ray stays a Mystery Box exclusive.
- Spend points on (press E):
  - Doors: Courtyard 750, Kitchen 1000, Garden 1000, Drum Tower 1250, Sahur Hill 1250 / 1000,
    Night Market 1250 / 1000, Rice Barn 1000 / 1250, Dead Orchard 1250 / 1000,
    upstairs: Lantern Loft 1000, Lookout 1000, Sleeping Loft 750 (from either side)
  - Wall guns: SMG 1000, Shotgun 1500, AK 1800, M4 1800, Sniper 2000, LMG 3000 (ammo = half price). They are
    available from round 1, before the shop unlocks them, if you open their area. Upstairs: AK 1800, Scout 1700.
  - Perks: Quick Revive 500 (gets you back up once), Double Tap 2000, Juggernog 2500 (more health), Speed Cola 3000 (faster reloads)
  - Mystery Box 950: random gun, including the Drum LMG and the Tung Ray wonder weapon
  - **Pack-a-Punch, four levels.** Each station upgrades the gun in your hands one level, in order, so a gun
    can keep up as the waves get harder. The hint at a station tells you where the next one is.

    | Level | Station | Cost | Damage | Mag / reserve | Fire rate |
    | --- | --- | --- | --- | --- | --- |
    | I | Drum Tower (purple) | 5000 | x2.2 | x1.5 / x2 | same |
    | II | Kitchen (cyan) | 10000 | x3.2 | x1.75 / x2.5 | +11% |
    | III | Garden (gold) | 15000 | x4.6 | x2 / x3 | +22% |
    | IV | Top of the watchtower (red) | 25000 | x6.6 | x2.5 / x3.5 | +35% |

    Buying a new gun starts it back at level 0.
- Power-ups drop from zombies: Max Ammo, Insta-Kill, Double Points, Kaboom (nuke), Carpenter.
- Health regenerates when you avoid hits for a few seconds. Without Quick Revive, going down ends the game
  (with it, you shoot back with your pistol for a few seconds while it gets you up).

### Co-op

- Zombies go for whoever is closest. Each round has more of them with more players (+50% per extra player).
- Doors, windows, the Mystery Box, Pack-a-Punch and power-ups are shared; points, perks and guns are your own.
  Only the player who paid for the Mystery Box can take its gun. Max Ammo refills everyone; Carpenter and
  Kaboom give every player their points.
- Going down doesn't end the game: you lose your perks and have 100 seconds. A teammate holds **E** next to you
  for 3 seconds to revive you (1.5 with Quick Revive). Downed teammates show a red cross you can see through walls.
- While down you're in last stand: you can't move, but you can aim, shoot and reload a pistol to cover whoever is
  reviving you. You get the strongest pistol you carry (P-9 or Desert Eagle, upgrades included) or a spare P-9
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
| B | Buy menu (in spawn during buy time), then 1-8 to buy. Zombies: the shop, anywhere (1-9 guns, 0 ammo) |
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

Add `?low` to the URL for lower-quality shadows on slow machines.

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
- `src/map.js` — map layout, geometry, collision boxes, A* pathfinding, attack routes for the bots
- `src/game.js` — rounds, economy, bomb, bullets, damage, spectating
- `src/combatant.js` — shared movement, weapons, recoil, hitboxes
- `src/player.js` — keyboard/mouse control
- `src/bots.js`, `src/director.js` — bot AI and team strategy (and the Tung Tung model)
- `src/zmap.js`, `src/zombies.js` — Zombies map (Sahur Village) and Zombies rules / zombie AI
- `src/net.js` — online rooms, lobby and message batching (PeerJS)
- `src/avatar.js` — other players' fighters, moved by network updates
- `src/netclassic.js`, `src/netzombies.js` — 5v5 and Zombies on a joining player's browser (the host runs
  `game.js` / `zombies.js` for everyone)
- `src/viewmodel.js`, `src/effects.js`, `src/audio.js`, `src/hud.js`, `src/textures.js`
