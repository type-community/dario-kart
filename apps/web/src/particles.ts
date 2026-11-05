import * as THREE from "three";

let glow: THREE.Texture | null = null;
const glowTexture = () => {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
};

let paper: THREE.Texture | null = null;
const confettiTexture = () => {
  if (paper) return paper;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(6, 11, 20, 10);
  paper = new THREE.CanvasTexture(c);
  return paper;
};

/**
 * A fixed pool of point sprites. Spawning never allocates; dead particles are
 * parked far away and recycled round-robin.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly baseColor: Float32Array;
  private cursor = 0;
  private readonly color = new THREE.Color();

  constructor(private readonly capacity: number, size: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3).fill(-99999);
    this.col = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.baseColor = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
      map: additive ? glowTexture() : confettiTexture(),
      alphaTest: additive ? 0 : 0.5,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Size attenuation makes a particle right in front of the camera fill the
    // screen (your own exhaust, a pickup you drive through): cap it.
    const maxPixels = (36 * Math.min(2, window.devicePixelRatio || 1)).toFixed(1);
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>\n\tgl_PointSize = min(gl_PointSize, ${maxPixels});`,
      );
    };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, gravity = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.color.setHex(color);
    this.baseColor[i * 3] = this.color.r;
    this.baseColor[i * 3 + 1] = this.color.g;
    this.baseColor[i * 3 + 2] = this.color.b;
  }

  /** A puff of `count` particles with random spread. */
  burst(at: THREE.Vector3, count: number, color: number | readonly number[], speed: number, life: number, gravity = 0, up = 0): void {
    for (let n = 0; n < count; n++) {
      const c = typeof color === "number" ? color : color[n % color.length];
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.emit(
        at.x, at.y, at.z,
        Math.sin(phi) * Math.cos(theta) * v, Math.abs(Math.cos(phi)) * v + up, Math.sin(phi) * Math.sin(theta) * v,
        c, life * (0.6 + Math.random() * 0.4), gravity,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -99999;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.5);
      this.col[i * 3] = this.baseColor[i * 3] * fade;
      this.col[i * 3 + 1] = this.baseColor[i * 3 + 1] * fade;
      this.col[i * 3 + 2] = this.baseColor[i * 3 + 2] * fade;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
