import * as THREE from "three";

const vertexShader = /* glsl */`
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec3 aUp;
attribute vec3 aTint;
attribute vec4 aLife;
attribute vec4 aStyle;
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
varying float vKind;
void main() {
  float age = uTime - aLife.x;
  float t = clamp(age / max(.001, aLife.y), 0., 1.);
  vUv = uv;
  vTint = aTint;
  vFade = 1. - t;
  vKind = aStyle.x;
  if (aLife.y <= 0. || age < 0. || age >= aLife.y) {
    gl_Position = vec4(2., 2., 2., 1.);
    return;
  }
  float travel = (1. - exp(-age * 1.8)) / 1.8;
  vec3 center = aOrigin + aVelocity * travel - aUp * aStyle.w * age * age * .5;
  float size = max(.001, aLife.z + aLife.w * age);
  float angle = aStyle.y + age * aStyle.z;
  vec2 corner = position.xy;
  if (vKind > 2.5 && vKind < 3.5) corner.x *= .18;
  corner = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * corner;
  vec4 viewCenter = modelViewMatrix * vec4(center, 1.);
  if (vKind > .5 && vKind < 1.5) {
    vec3 reference = abs(aUp.y) > .9 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
    vec3 right = normalize(cross(reference, aUp));
    vec3 forward = cross(aUp, right);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center + (right * corner.x + forward * corner.y) * size, 1.);
  } else {
    viewCenter.xy += corner * size;
    gl_Position = projectionMatrix * viewCenter;
  }
}`;

const fragmentShader = /* glsl */`
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
varying float vKind;
void main() {
  vec2 p = vUv * 2. - 1.;
  float r = length(p), a = atan(p.y, p.x);
  float alpha = 0.;
  vec3 tint = vTint;
  if (vKind < .5) {
    float edge = .43 + .24 * pow(.5 + .5 * cos(a * 5.), 3.);
    alpha = 1. - smoothstep(edge - .045, edge + .015, r);
    tint = mix(tint, vec3(1., .97, .82), (1. - smoothstep(.06, .30, r)) * vFade);
  } else if (vKind < 1.5) {
    float width = .025 + .075 * vFade;
    alpha = (1. - smoothstep(width, width + .025, abs(r - .72))) * (.7 + .3 * sin(a * 8. + vFade * 5.));
  } else if (vKind < 2.5) {
    float edge = .69 + .055 * sin(a * 5. + 1.4) + .05 * cos(a * 7.);
    alpha = (1. - smoothstep(edge - .19, edge + .04, r)) * .44;
    tint *= .8 + .2 * (p.y * .5 + .5);
  } else if (vKind < 3.5) {
    alpha = (1. - smoothstep(.2, .95, abs(p.x))) * (1. - smoothstep(.25, 1., abs(p.y)));
  } else if (vKind < 4.5) {
    alpha = 1. - smoothstep(.62, .69, abs(p.x) + abs(p.y));
  } else {
    float rays = .3 + .28 * pow(abs(cos(a * 6.)), 9.);
    alpha = max(1. - smoothstep(.1, .65, r), (1. - smoothstep(rays - .03, rays + .03, r)) * .8);
    tint = mix(tint, vec3(1., .98, .84), 1. - smoothstep(.05, .37, r));
  }
  alpha *= pow(vFade, vKind > 1.5 && vKind < 2.5 ? 1.1 : .8);
  if (alpha < .008) discard;
  gl_FragColor = vec4(tint, alpha);
  #include <colorspace_fragment>
}`;

/** Fixed GPU sprite pool: two triangles per effect, with lifetime/motion evaluated in the shader. */
class SpritePool {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly origin: THREE.InstancedBufferAttribute;
  private readonly velocity: THREE.InstancedBufferAttribute;
  private readonly up: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly style: THREE.InstancedBufferAttribute;
  private readonly color = new THREE.Color();
  private cursor = 0;
  private time = 0;
  private dirty = false;

  constructor(private readonly capacity: number, additive: boolean) {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = plane.index;
    this.geometry.setAttribute("position", plane.attributes.position);
    this.geometry.setAttribute("uv", plane.attributes.uv);
    this.geometry.instanceCount = capacity;
    const attribute = (name: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, a);
      return a;
    };
    this.origin = attribute("aOrigin", 3);
    this.velocity = attribute("aVelocity", 3);
    this.up = attribute("aUp", 3);
    this.tint = attribute("aTint", 3);
    this.life = attribute("aLife", 4);
    this.style = attribute("aStyle", 4);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  emit(at: THREE.Vector3, velocity: THREE.Vector3, up: THREE.Vector3, color: number, life: number,
    size: number, growth: number, kind: number, gravity = 0): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    this.origin.setXYZ(i, at.x, at.y, at.z);
    this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
    this.up.setXYZ(i, up.x, up.y, up.z);
    this.color.setHex(color);
    this.tint.setXYZ(i, this.color.r, this.color.g, this.color.b);
    this.life.setXYZW(i, this.time, life, size, growth);
    this.style.setXYZW(i, kind, Math.random() * Math.PI * 2, (Math.random() - .5) * 5, gravity);
    this.dirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (!this.dirty) return;
    for (const a of [this.origin, this.velocity, this.up, this.tint, this.life, this.style]) a.needsUpdate = true;
    this.dirty = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Shared visual language for contacts, rewards and motion; budgets stay fixed even in a large race. */
export class RaceEffects {
  readonly root = new THREE.Group();
  private readonly bright = new SpritePool(768, true);
  private readonly soft = new SpritePool(192, false);
  private readonly lights = Array.from({ length: 2 }, () => ({ light: new THREE.PointLight(0xffaa55, 0, 11, 2), age: 1 }));
  private lightCursor = 0;
  private readonly velocity = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly zero = new THREE.Vector3();

  constructor() {
    this.root.add(this.soft.mesh, this.bright.mesh, ...this.lights.map((x) => x.light));
  }

  impact(at: THREE.Vector3, up: THREE.Vector3, reducedMotion = false): void {
    this.bright.emit(at, this.zero, up, 0xffda6b, reducedMotion ? .17 : .11, reducedMotion ? 1.3 : 2.6, 5, 5);
    this.bright.emit(at, this.zero, up, 0xff8358, .32, 1.2, 10, 0);
    this.at.copy(at).addScaledVector(up, -.65);
    this.bright.emit(this.at, this.zero, up, 0xffbb5c, .42, .9, 22, 1);
    for (let i = 0; i < (reducedMotion ? 10 : 26); i++) {
      this.velocity.randomDirection().multiplyScalar(4 + Math.random() * 7).addScaledVector(up, 4);
      this.bright.emit(at, this.velocity, up, i % 3 ? 0xffad4d : 0xfff2c0, .3 + Math.random() * .3, .24 + Math.random() * .28, -.12, i % 3 ? 3 : 0, 14);
    }
    for (let i = 0; i < (reducedMotion ? 3 : 8); i++) {
      this.velocity.randomDirection().multiplyScalar(2.5).addScaledVector(up, 2.7);
      this.soft.emit(at, this.velocity, up, i % 2 ? 0x68647c : 0xc3b6c6, .7 + Math.random() * .25, .55, 2, 2);
      this.velocity.randomDirection().multiplyScalar(6).addScaledVector(up, 4);
      this.soft.emit(at, this.velocity, up, i % 2 ? 0xff547b : 0xffde91, .5, .26, -.18, 4, 15);
    }
    if (!reducedMotion) {
      const slot = this.lights[this.lightCursor++ % this.lights.length];
      slot.light.position.copy(at);
      slot.age = 0;
    }
  }

  pickup(at: THREE.Vector3, up: THREE.Vector3, box: boolean, reducedMotion = false): void {
    const color = box ? 0xffd45e : 0xafff64;
    this.bright.emit(at, this.zero, up, color, .27, 1.1, 5, 5);
    this.bright.emit(at, this.zero, up, color, .42, 1.2, 7, 1);
    for (let i = 0; i < (reducedMotion ? 4 : box ? 14 : 8); i++) {
      this.velocity.randomDirection().multiplyScalar(3.5).addScaledVector(up, 2);
      this.bright.emit(at, this.velocity, up, box && i % 3 === 0 ? 0x88eaff : color, .45, .28, -.12, i % 2 ? 0 : 4, 5);
    }
  }

  landing(at: THREE.Vector3, up: THREE.Vector3): void {
    this.bright.emit(at, this.zero, up, 0xcce7ff, .28, 1, 10, 1);
    for (let i = 0; i < 5; i++) {
      this.velocity.randomDirection().addScaledVector(up, -this.velocity.dot(up)).multiplyScalar(3);
      this.soft.emit(at, this.velocity, up, 0xc8c7cd, .42, .4, 1.8, 2);
    }
  }

  boost(at: THREE.Vector3, up: THREE.Vector3, color: number): void {
    this.bright.emit(at, this.zero, up, color, .3, 1.2, 12, 1);
    this.bright.emit(at, this.zero, up, color, .15, 1.4, 3, 5);
  }

  maxing(at: THREE.Vector3, up: THREE.Vector3, reducedMotion = false): void {
    this.bright.emit(at, this.zero, up, 0xffce60, .55, 1.5, 13, 1);
    for (let i = 0; i < (reducedMotion ? 6 : 18); i++) {
      this.velocity.randomDirection().multiplyScalar(2).addScaledVector(up, 6);
      this.bright.emit(at, this.velocity, up, i % 2 ? 0xffd469 : 0xc094ff, .65, .35, .1, i % 2 ? 0 : 4, 3);
    }
  }

  squash(at: THREE.Vector3, up: THREE.Vector3, reducedMotion = false): void {
    this.bright.emit(at, this.zero, up, 0xffcf63, .3, 1.2, 17, 1);
    for (let i = 0; i < (reducedMotion ? 5 : 12); i++) {
      this.velocity.randomDirection().addScaledVector(up, -this.velocity.dot(up)).multiplyScalar(6);
      this.soft.emit(at, this.velocity, up, 0xd5bed8, .45, .45, 1.1, 2);
      this.velocity.addScaledVector(up, 3);
      this.bright.emit(at, this.velocity, up, i % 2 ? 0xffd469 : 0xc094ff, .4, .3, -.2, 0, 12);
    }
  }

  trail(at: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, color: number, kind: "missile" | "boost" | "drift"): void {
    const missile = kind === "missile", drift = kind === "drift";
    this.velocity.copy(forward).multiplyScalar(drift ? -2 : -5).addScaledVector(up, drift ? 2.3 : .2);
    this.velocity.x += (Math.random() - .5) * 2;
    this.velocity.z += (Math.random() - .5) * 2;
    this.bright.emit(at, this.velocity, up, color, drift ? .28 : .24, missile ? .45 : .25, -.4, drift ? 3 : 0, drift ? 10 : 0);
    if (missile) this.soft.emit(at, this.velocity, up, 0xb7adbe, .36, .28, .9, 2);
  }

  update(dt: number, reducedMotion = false): void {
    this.bright.update(dt);
    this.soft.update(dt);
    for (const slot of this.lights) {
      slot.age += dt;
      slot.light.intensity = reducedMotion ? 0 : 18 * Math.max(0, 1 - slot.age / .18) ** 2;
    }
  }

  dispose(): void {
    this.bright.dispose();
    this.soft.dispose();
    for (const slot of this.lights) slot.light.dispose();
  }
}

