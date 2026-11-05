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

/**
 * Soft round puffs that grow and fade: smoke, fireballs, exhaust. Unlike
 * `Particles` each puff has its own size and opacity, so smoke can billow out
 * and thin away instead of shrinking to a dot.
 */
export class Puffs {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly grow: Float32Array;
  private readonly startAlpha: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private readonly a = new THREE.Color();
  private readonly b = new THREE.Color();

  constructor(private readonly capacity: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3).fill(-99999);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.from = new Float32Array(capacity * 3);
    this.to = new Float32Array(capacity * 3);
    this.grow = new Float32Array(capacity * 2);
    this.startAlpha = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 500 }, maxPixels: { value: 260 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float scale;
        uniform float maxPixels;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / max(0.1, -mv.z), maxPixels);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.2, 1.0, d);
          if (a <= 0.0) discard;
          gl_FragColor = vec4(vColor, vAlpha * a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  /** `size` grows from `size0` to `size1` meters while the color shifts from `color0` to `color1` and fades out. */
  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, color0: number, color1: number, alpha = 1,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.a.setHex(color0);
    this.b.setHex(color1);
    this.from.set([this.a.r, this.a.g, this.a.b], i * 3);
    this.to.set([this.b.r, this.b.g, this.b.b], i * 3);
    this.grow[i * 2] = size0;
    this.grow[i * 2 + 1] = size1;
    this.startAlpha[i] = alpha;
  }

  /** Points are sized in meters: tell the shader how many pixels a meter is at 1 m. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.material.uniforms.maxPixels.value = heightPx * 0.35;
  }

  update(dt: number): void {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -99999;
        this.alpha[i] = 0;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= drag;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
        this.col[i * 3 + k] = this.from[i * 3 + k] + (this.to[i * 3 + k] - this.from[i * 3 + k]) * t;
      }
      // Ease out: puffs bloom fast, then drift.
      const bloom = 1 - (1 - t) * (1 - t);
      this.size[i] = this.grow[i * 2] + (this.grow[i * 2 + 1] - this.grow[i * 2]) * bloom;
      this.alpha[i] = this.startAlpha[i] * (1 - t) * Math.min(1, t * 12 + 0.3);
    }
    const attrs = this.points.geometry.attributes;
    for (const name of ["position", "color", "alpha", "size"]) (attrs[name] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
