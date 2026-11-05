import * as THREE from "three";
import { Particles, Puffs } from "./particles.ts";

/* ---------------- the Outage Missile ---------------- */

const glowTexture = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

const missileGeo = {
  body: new THREE.CylinderGeometry(0.22, 0.22, 1.5, 14).rotateX(Math.PI / 2),
  nose: new THREE.ConeGeometry(0.22, 0.6, 14).rotateX(Math.PI / 2).translate(0, 0, 1.05),
  band: new THREE.CylinderGeometry(0.235, 0.235, 0.14, 14).rotateX(Math.PI / 2).translate(0, 0, 0.45),
  nozzle: new THREE.CylinderGeometry(0.16, 0.2, 0.18, 12).rotateX(Math.PI / 2).translate(0, 0, -0.84),
  fin: new THREE.BoxGeometry(0.03, 0.34, 0.4).translate(0, 0.32, -0.55),
  flame: new THREE.ConeGeometry(0.19, 1.3, 10).rotateX(-Math.PI / 2).translate(0, 0, -1.55),
  core: new THREE.ConeGeometry(0.1, 0.8, 8).rotateX(-Math.PI / 2).translate(0, 0, -1.3),
};
const missileMat = {
  body: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.3, metalness: 0.4 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.45, roughness: 0.35 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.5, metalness: 0.6 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  core: new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
};

/** The missile body with red nose and fins, without exhaust: also what a kart carries on its rack. */
const missileBody = (): THREE.Group => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(missileGeo.body, missileMat.body));
  g.add(new THREE.Mesh(missileGeo.nose, missileMat.red));
  g.add(new THREE.Mesh(missileGeo.band, missileMat.dark));
  g.add(new THREE.Mesh(missileGeo.nozzle, missileMat.dark));
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(missileGeo.fin, missileMat.red);
    fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    g.add(fin);
  }
  return g;
};

export interface MissileVisual {
  readonly root: THREE.Group;
  readonly spin: THREE.Group;
  readonly flame: THREE.Mesh;
  readonly glow: THREE.Sprite;
  /** Tail position last frame, to lay the trail continuously; null when it just appeared. */
  last: THREE.Vector3 | null;
}

export const makeMissile = (): MissileVisual => {
  const root = new THREE.Group();
  const spin = missileBody();
  const flame = new THREE.Mesh(missileGeo.flame, missileMat.flame);
  spin.add(flame, new THREE.Mesh(missileGeo.core, missileMat.core));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff6a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.position.z = -1.1;
  glow.scale.setScalar(2.6);
  root.add(spin, glow);
  root.scale.setScalar(1.35);
  return { root, spin, flame, glow, last: null };
};

export const animateMissile = (m: MissileVisual, time: number, seed: number): void => {
  m.spin.rotation.z = time * 9 + seed;
  const flicker = 0.85 + Math.sin(time * 61 + seed * 7) * 0.12 + Math.sin(time * 37 + seed) * 0.08;
  m.flame.scale.set(1, 1, flicker);
  m.glow.scale.setScalar(2.4 + flicker * 0.6);
};

export const disposeMissile = (m: MissileVisual): void => {
  m.glow.material.dispose();
};

/** A missile riding on a kart's roof rack, so everyone can see who's armed. */
export const makeRackMissile = (): THREE.Group => {
  const g = missileBody();
  g.scale.setScalar(0.62);
  return g;
};

/* ---------------- explosions, trails, flashes ---------------- */

interface Timed<T> {
  readonly obj: T;
  life: number;
  max: number;
}

const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
const UP = new THREE.Vector3(0, 0, 1);

/** Everything that blows up, burns or smokes in a race. One draw call per pool. */
export class Effects {
  readonly fire = new Puffs(900, true);
  readonly smoke = new Puffs(700, false);
  readonly debris = new Particles(500, 0.45, true);
  private readonly rings: Array<Timed<THREE.Mesh>> = [];
  private readonly flashes: Array<Timed<THREE.Sprite>> = [];
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.visible = false;
      this.rings.push({ obj: ring, life: 0, max: 0.45 });
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffe2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      flash.visible = false;
      this.flashes.push({ obj: flash, life: 0, max: 0.22 });
      this.group.add(ring, flash);
    }
    this.group.add(this.fire.points, this.smoke.points, this.debris.points);
    scene.add(this.group);
  }

  /**
   * Exhaust behind a flying missile: a hot core and a smoke trail that lingers.
   * A missile covers 1.5 m a frame, so puffs are laid along the whole stretch
   * it flew, not just where it is now, or the trail reads as dots.
   */
  trail(m: MissileVisual): void {
    const tail = m.root.localToWorld(this.tmp.set(0, 0, -1.1));
    const from = m.last && m.last.distanceToSquared(tail) < 36 ? m.last : tail;
    const steps = Math.max(1, Math.min(6, Math.ceil(from.distanceTo(tail) / 0.45)));
    for (let s = 0; s < steps; s++) {
      const f = (s + 1) / steps;
      const x = from.x + (tail.x - from.x) * f;
      const y = from.y + (tail.y - from.y) * f;
      const z = from.z + (tail.z - from.z) * f;
      this.fire.emit(x, y, z, rand(0.6), rand(0.6), rand(0.6), 0.2 + 0.06 * f, 0.95, 0.3, 0xfff0b0, 0xff4a1a, 0.85);
      if (s % 2 === 0) this.smoke.emit(x, y, z, rand(0.7), 0.5 + Math.random() * 0.6, rand(0.7), 1.0 + Math.random() * 0.5, 0.55, 2.4, 0xe2e2e8, 0x8a8c96, 0.38);
    }
    (m.last ??= new THREE.Vector3()).copy(tail);
  }

  /** Muzzle flash where a missile leaves its launcher. */
  launch(at: THREE.Vector3): void {
    this.flash(at, 4.5, 0.18);
    for (let i = 0; i < 8; i++) {
      this.smoke.emit(at.x, at.y, at.z, rand(4), 1 + Math.random() * 2, rand(4), 0.8, 0.8, 2.6, 0xe8e8ee, 0x8a8c96, 0.5);
    }
  }

  /** A hit: flash, fireball, a shockwave across the road, debris and smoke. */
  explode(at: THREE.Vector3, up: THREE.Vector3): void {
    this.flash(at, 11, 0.24);
    const ring = this.rings.find((r) => r.life <= 0) ?? this.rings[0];
    ring.life = ring.max;
    ring.obj.visible = true;
    ring.obj.position.copy(at).addScaledVector(up, 0.25);
    ring.obj.quaternion.setFromUnitVectors(UP, up);
    for (let i = 0; i < 26; i++) {
      const s = 5 + Math.random() * 7;
      const dir = this.tmp.set(rand(1), Math.random() * 0.9 + 0.2, rand(1)).normalize();
      this.fire.emit(at.x, at.y + 0.6, at.z, dir.x * s, dir.y * s, dir.z * s, 0.45 + Math.random() * 0.35, 2, 5 + Math.random() * 2, 0xfff3c4, 0xff3012, 1);
    }
    for (let i = 0; i < 16; i++) {
      this.smoke.emit(at.x, at.y + 1, at.z, rand(5), 2 + Math.random() * 4, rand(5), 1.4 + Math.random() * 0.9, 1.8, 6.5, 0x9a9aa2, 0x5c5d66, 0.5);
    }
    this.debris.burst(at, 46, [0xffc93c, 0xff7a2a, 0xffffff, 0xff3d7f], 18, 0.9, 22, 7);
  }

  private flash(at: THREE.Vector3, size: number, life: number): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.life = f.max = life;
    f.obj.visible = true;
    f.obj.position.copy(at).y += 0.8;
    f.obj.scale.setScalar(size);
    f.obj.userData.size = size;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, heightPx: number): void {
    this.fire.setViewport(heightPx, camera.fov);
    this.smoke.setViewport(heightPx, camera.fov);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      r.obj.scale.setScalar(1 + t * 9);
      (r.obj.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      if (r.life <= 0) r.obj.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      f.obj.scale.setScalar((f.obj.userData.size as number) * (0.6 + t * 0.6));
      f.obj.material.opacity = 1 - t;
      if (f.life <= 0) f.obj.visible = false;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.fire.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    for (const r of this.rings) (r.obj.material as THREE.Material).dispose();
    for (const f of this.flashes) f.obj.material.dispose();
  }
}

const rand = (spread: number) => (Math.random() * 2 - 1) * spread;
