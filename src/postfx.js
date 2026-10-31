// Screen effects for Ultra graphics:
//  - ambient occlusion: soft shade where surfaces meet (wall bases, corners, under crates and zombies)
//  - glow: fire, lanterns, neon signs and other players' muzzle flashes bleed a little light around them
// (your own gun is drawn on top afterwards, so it isn't affected)
// The scene is drawn into an HDR buffer, the effects run on it, and the last pass applies the
// tone mapping and exposure (which the renderer otherwise does inside every material).
// High and Low graphics don't create this at all.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Ambient occlusion is soft by nature, so it runs at half resolution to stay cheap.
class HalfResAO extends GTAOPass {
  setSize(width, height) { super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2))); }
}

export class PostFX {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.enabled = true;   // (turn off from the console to compare: __post.enabled = false)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    target.depthTexture = new THREE.DepthTexture(1, 1);   // ambient occlusion reads the scene's depth
    this.composer = new EffectComposer(renderer, target);

    this.scenePass = new RenderPass(null, camera);
    this.ao = new HalfResAO(null, camera, 1, 1);
    // radius/thickness in meters: reaches about a crate's width from a corner
    this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.2, thickness: 3, scale: 1.6, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.depthTex = null;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 1);

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize(innerWidth, innerHeight);
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  // look: { ao: strength 0..1, bloom: { strength, radius, threshold } }, set per map.
  // (The AO pass always runs, even at strength 0, so the buffers swap the same way every frame.)
  render(scene, look) {
    this.scenePass.scene = scene;
    this.ao.scene = scene;
    // The scene is always drawn into the composer's read buffer; point the AO at that buffer's depth.
    const depth = this.composer.readBuffer.depthTexture;
    if (!this.depthTex) {
      this.ao.setGBuffer(depth);   // depth only: normals are rebuilt from it, so the scene isn't drawn twice
      this.ao.gtaoMaterial.needsUpdate = this.ao.pdMaterial.needsUpdate = true;
    } else if (depth !== this.depthTex) {
      this.ao.gtaoMaterial.uniforms.tDepth.value = this.ao.pdMaterial.uniforms.tDepth.value = depth;
    }
    this.depthTex = depth;
    this.ao.blendIntensity = look.ao;
    Object.assign(this.bloom, look.bloom);
    this.composer.render();
  }
}
