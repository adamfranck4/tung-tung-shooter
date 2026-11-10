// The knife locker in the main menu: the selected knife, held and animated exactly as in a match
// (it plays its draw when picked; click it to inspect), drawn on its own small canvas.
import * as THREE from 'three';
import { ViewModel, KNIFE_SKINS } from './viewmodel.js';

// a line about each knife, shown under the preview
export const KNIFE_NOTES = {
  knife: 'Standard issue. Flipped up and caught on the draw.',
  karambit: 'Curved claw, spun around the finger through its ring.',
  flip: 'Folding blade that snaps open with a flick of the wrist.',
  butterfly: 'Two handles, one blade, a lot of flipping.',
  sword: 'A longsword drawn from over the shoulder.',
  katana: 'Drawn from its scabbard straight into a cut.',
  kuronami: 'Twin kunai on a chain, with blue trails.',
  bayonet: 'Long clip-point blade with a muzzle ring.',
  cleaver: 'A slab of kitchen steel with a riveted handle.',
  tomahawk: 'Bearded axe head with a spike on the back.',
  ember: 'Volcanic glass with a lava crack. Leaves a trail of fire.',
  frost: 'A karambit carved from ice. Leaves a cold blue trail.',
  gilded: 'Butterfly knife in gold with ruby studs.',
  bat: "Tung Tung's own bat. Tung tung tung.",
  plasma: 'A blade of light between two emitter prongs.',
  random: 'A different knife every match.',
};

// where the camera looks from and at, for hand-sized knives and for the long ones
const VIEW = {
  small: { from: [0.03, -0.07, 0.02], at: [0.115, -0.09, -0.36], fov: 44 },
  big: { from: [-0.1, 0.02, 0.2], at: [0.02, 0.06, -0.4], fov: 58 },
};

export class KnifePreview {
  constructor(canvas, sound) {
    this.canvas = canvas; this.sound = sound;
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (_) { return; }                       // no second WebGL context: the menu works without the preview
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.vm = new ViewModel({ knivesOnly: true });
    this.vm.setTeam('P');
    this.camera = new THREE.PerspectiveCamera(44, 2, 0.01, 10);
    this.game = { time: 0, sound: null };
    // a stand-in for the player: standing still, knife out
    this.holder = {
      weapon: { def: { melee: true } }, body: { onGround: true }, reloading: false, deployUntil: 0, downed: false,
      scoped: false, horizSpeed: () => 0, adsK: () => 0,
    };
    this.id = null; this.random = false; this.cycleT = 0; this.idle = 0;
    this.w = 0; this.h = 0;
    this.ok = true;
  }

  // id: a knife skin, or 'random' (shows them one after another)
  show(id) {
    if (!this.ok) return;
    this.random = id === 'random';
    this.cycleT = 0; this.idle = 0;
    this.set(this.random ? KNIFE_SKINS[Math.floor(Math.random() * KNIFE_SKINS.length)].id : id);
  }

  set(id) {
    this.id = id;
    this.vm.setKnife(id);
    const skin = KNIFE_SKINS.find((s) => s.id === id);
    const v = skin?.big ? VIEW.big : VIEW.small;
    this.camera.position.set(...v.from);
    this.camera.fov = v.fov;
    this.camera.lookAt(...v.at);
    this.camera.updateProjectionMatrix();
  }

  inspect() {
    if (!this.ok) return;
    this.game.sound = this.sound;                 // (silent until the first click: browsers want one before sound)
    this.idle = 0; this.cycleT = 0;
    this.vm.inspect();
  }

  render(dt) {
    if (!this.ok) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    this.game.time += dt;
    if (this.random) {
      this.cycleT += dt;
      if (this.cycleT > 2.4 && !this.vm.clip) {
        this.cycleT = 0;
        const others = KNIFE_SKINS.filter((s) => s.id !== this.id);
        this.set(others[Math.floor(Math.random() * others.length)].id);
      }
    } else if (!this.vm.clip) {
      // left alone, it shows the knife off every so often
      this.idle += dt;
      if (this.idle > 6) { this.idle = 0; this.vm.inspect(); }
    }
    this.vm.update(dt, this.holder, this.game, 0, 0);
    this.renderer.render(this.vm.scene, this.camera);
  }
}
