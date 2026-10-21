// Visual effects: bullet holes, dust and blood particles, tracers, explosions.
import * as THREE from 'three';
import { bulletHoleTexture } from './textures.js';

const MAX_P = 400;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _col = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // bullet holes
    const holeMat = new THREE.MeshBasicMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4 });
    const holeGeo = new THREE.PlaneGeometry(0.13, 0.13);
    this.holes = [];
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat); m.visible = false; scene.add(m); this.holes.push(m);
    }
    this.holeIdx = 0;
    // particles (instanced cubes)
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_P);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    this.particles = [];
    for (let i = 0; i < MAX_P; i++) {
      this.particles.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.05, grav: 9 });
      this.pMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.pMesh.setColorAt(i, _col.set(1, 1, 1));
    }
    scene.add(this.pMesh);
    this.pIdx = 0;
    // tracers
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8 }));
      l.visible = false; l.frustumCulled = false; l.life = 0;
      scene.add(l); this.tracers.push(l);
    }
    this.tIdx = 0;
    // flash light (shared)
    this.light = new THREE.PointLight(0xffc070, 0, 12, 2);
    scene.add(this.light);
    this.lightLife = 0;
    // explosion
    this.boom = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false }));
    this.boom.visible = false; scene.add(this.boom);
    this.boomT = -1;
  }

  spawnParticle(pos, vel, color, size, life, grav = 9) {
    const i = this.pIdx; this.pIdx = (this.pIdx + 1) % MAX_P;
    const p = this.particles[i];
    p.pos.copy(pos); p.vel.copy(vel); p.size = size; p.life = life; p.max = life; p.grav = grav;
    this.pMesh.setColorAt(i, _col.set(color));
  }

  impact(pos, n) {
    const h = this.holes[this.holeIdx]; this.holeIdx = (this.holeIdx + 1) % this.holes.length;
    h.position.set(pos.x + n.nx * 0.01, pos.y + n.ny * 0.01, pos.z + n.nz * 0.01);
    h.lookAt(h.position.x + n.nx, h.position.y + n.ny, h.position.z + n.nz);
    h.rotateZ(Math.random() * 6);
    h.visible = true;
    for (let i = 0; i < 5; i++) {
      _v.set(n.nx + (Math.random() - 0.5) * 1.2, n.ny + Math.random() * 0.8, n.nz + (Math.random() - 0.5) * 1.2).multiplyScalar(2 + Math.random() * 2);
      this.spawnParticle(pos, _v, i < 2 ? 0xfff0b0 : 0x9a8460, 0.03 + Math.random() * 0.03, 0.35 + Math.random() * 0.3);
    }
  }

  blood(pos, dir) {
    for (let i = 0; i < 8; i++) {
      _v.set(dir.x + (Math.random() - 0.5), dir.y + Math.random() * 0.6, dir.z + (Math.random() - 0.5)).multiplyScalar(1.5 + Math.random() * 2);
      this.spawnParticle(pos, _v, 0x8a0a06, 0.04 + Math.random() * 0.05, 0.4 + Math.random() * 0.3);
    }
  }

  burst(pos, color, n = 20, speed = 5) {
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.spawnParticle(pos, _v, color, 0.05 + Math.random() * 0.07, 0.4 + Math.random() * 0.4, 4);
    }
  }

  tracer(from, to, color = 0xffe2a0) {
    const l = this.tracers[this.tIdx]; this.tIdx = (this.tIdx + 1) % this.tracers.length;
    l.material.color.setHex(color);
    const a = l.geometry.attributes.position;
    // only draw the far part of the tracer so it doesn't start inside the camera
    _v.copy(to).sub(from);
    const len = _v.length();
    const start = Math.min(len * 0.5, 1.5 + Math.random() * 3);
    a.setXYZ(0, from.x + _v.x / len * start, from.y + _v.y / len * start, from.z + _v.z / len * start);
    a.setXYZ(1, to.x, to.y, to.z);
    a.needsUpdate = true;
    l.visible = true; l.life = 0.06; l.material.opacity = 0.75;
  }

  flash(pos) {
    this.light.position.copy(pos);
    this.light.intensity = 25;
    this.lightLife = 0.05;
  }

  explosion(pos) {
    this.boom.position.copy(pos);
    this.boom.visible = true; this.boomT = 0;
    this.light.position.set(pos.x, pos.y + 3, pos.z);
    this.light.distance = 80; this.light.intensity = 4000; this.lightLife = 0.6;
    for (let i = 0; i < 120; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 1.2, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 18);
      this.spawnParticle(pos, _v, Math.random() < 0.5 ? 0xffb050 : 0x3a3530, 0.15 + Math.random() * 0.35, 0.8 + Math.random() * 1.2, 6);
    }
  }

  clear() {
    for (const h of this.holes) h.visible = false;
    for (const p of this.particles) p.life = 0;
    for (const t of this.tracers) t.visible = false;
  }

  update(dt) {
    for (let i = 0; i < MAX_P; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { if (p.wasAlive) { this.pMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); p.wasAlive = false; } continue; }
      p.wasAlive = true;
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) { p.pos.y = 0.02; p.vel.set(p.vel.x * 0.5, 0, p.vel.z * 0.5); }
      const s = p.size * Math.min(1, (p.life / p.max) * 2.5);
      _s.set(s, s, s);
      _m.compose(p.pos, _q, _s);
      this.pMesh.setMatrixAt(i, _m);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.life -= dt;
      t.material.opacity = Math.max(0, t.life / 0.06) * 0.75;
      if (t.life <= 0) t.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) { this.light.intensity = 0; this.light.distance = 12; }
      else if (this.light.distance > 12) this.light.intensity *= 0.9;
    }
    if (this.boomT >= 0) {
      this.boomT += dt;
      const k = this.boomT / 0.9;
      this.boom.scale.setScalar(2 + k * 22);
      this.boom.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { this.boom.visible = false; this.boomT = -1; }
    }
  }
}
