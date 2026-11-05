import { BoostKind, FeatureKind, TOKEN_MAXING_SCALE, TOKEN_MAXING_SECONDS, type Pose, type Track, type TrackTheme, makePose, poseAt } from "@dario-kart/sim";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { jetGeometry, jetMaterial, pickupRingMaterial } from "./effect-materials.ts";
import { type ChassisFit, type Part, chassisFit, kartGeometry, partMaterial } from "./kart-model.ts";
import { makeRackMissile } from "./fx.ts";
import { DriverVisual } from "./driver-model.ts";
import { THEME_LOOKS, type PlacedBuilding, themeDecor } from "./landmarks.ts";

const pose = makePose();
const basisX = new THREE.Vector3();
const basisY = new THREE.Vector3();
const basisZ = new THREE.Vector3();
const basis = new THREE.Matrix4();

/** Track-space (s, d, h) to world. */
export const trackPoint = (track: Track, s: number, d: number, h: number, out: THREE.Vector3): THREE.Vector3 => {
  poseAt(track, s, d, h, pose);
  return out.set(pose.x, pose.y, pose.z);
};

export const trackPose = (track: Track, s: number, d: number, h: number, out: Pose = pose): Pose =>
  poseAt(track, s, d, h, out);

/**
 * Place an object on the road at (s, d, h), yawed by `heading` within the road
 * plane. The object's local +Z points along its heading and +Y along the
 * surface normal, so it follows banks and loops.
 */
export const placeOnTrack = (
  track: Track, s: number, d: number, h: number, heading: number, obj: THREE.Object3D,
): void => {
  poseAt(track, s, d, h, pose);
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  basisZ.set(pose.fx * c + pose.rx * sn, pose.fy * c + pose.ry * sn, pose.fz * c + pose.rz * sn).normalize();
  basisY.set(pose.ux, pose.uy, pose.uz);
  basisX.crossVectors(basisY, basisZ).normalize();
  basis.makeBasis(basisX, basisY, basisZ);
  obj.position.set(pose.x, pose.y, pose.z);
  obj.quaternion.setFromRotationMatrix(basis);
};

export const canvasTexture = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
};

export const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const roadTexture = (theme: TrackTheme) =>
  canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = hex(theme.road);
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2200; i++) {
      const v = Math.random() * 40 - 20;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 300})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(6, 0, 5, 256);
    ctx.fillRect(245, 0, 5, 256);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (const x of [64, 128, 192]) ctx.fillRect(x - 2, 0, 4, 120);
  });

const kerbTexture = (theme: TrackTheme) =>
  canvasTexture(16, 64, (ctx) => {
    ctx.fillStyle = hex(theme.wall);
    ctx.fillRect(0, 0, 16, 32);
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 32, 16, 32);
  });

/** Canvas top maps to the forward end of a strip, so `forward` arrows point along the race direction. */
const chevronTexture = (color: string, back: string, forward: boolean) =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, 128, 128);
    ctx.save();
    if (!forward) {
      ctx.translate(0, 128);
      ctx.scale(1, -1);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(10, 92);
    ctx.lineTo(64, 38);
    ctx.lineTo(118, 92);
    ctx.lineTo(118, 120);
    ctx.lineTo(64, 66);
    ctx.lineTo(10, 120);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

/** Slow zones must read as bad at a glance: red and black stripes, a stencil, arrows pointing back. */
const slowZoneTexture = () =>
  canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = "#1a0006";
    ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = "#e0102f";
    for (let i = -256; i < 384; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(128, i + 64);
      ctx.lineTo(128, i + 84);
      ctx.lineTo(0, i + 20);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(64, 128);
    ctx.rotate(Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px 'Barlow Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SLOW", 0, 0);
    ctx.restore();
  });

const hazardTexture = () =>
  canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = "#ffc93c";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#1b1f3b";
    for (let i = -64; i < 128; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 80, 64);
      ctx.lineTo(i + 64, 64);
      ctx.fill();
    }
  });

const checkerTexture = () =>
  canvasTexture(64, 16, (ctx) => {
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4";
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
  });

const windowTexture = (lit: boolean) =>
  canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = lit ? "#000" : "#ffffff";
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 12)
      for (let x = 6; x < 64; x += 12) {
        const on = Math.random() < (lit ? 0.45 : 0.9);
        ctx.fillStyle = lit ? (on ? "#ffffff" : "#000") : on ? "#c9d3de" : "#ffffff";
        ctx.fillRect(x, y, 6, 7);
      }
  });

/**
 * Item box face: a "?" on a tile. The color map is a light tile the instance
 * color tints; the glow map lights only the "?" and the rim, so the box stays
 * saturated instead of washing out to white.
 */
const itemBoxTexture = (glow: boolean) =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = glow ? "#000000" : "#e6e6e6";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = glow ? "#8a8a8a" : "#ffffff";
    ctx.fillRect(0, 0, 128, 9);
    ctx.fillRect(0, 119, 128, 9);
    ctx.fillRect(0, 0, 9, 128);
    ctx.fillRect(119, 0, 9, 128);
    ctx.font = "900 italic 100px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!glow) {
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#11142a";
      ctx.strokeText("?", 66, 70);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText("?", 66, 70);
  });

/** A graphics card seen from above: green board, two fans, gold edge connector. */
const gpuTexture = () =>
  canvasTexture(128, 80, (ctx) => {
    ctx.fillStyle = "#1d2a12";
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = "#76b900";
    ctx.fillRect(4, 4, 120, 60);
    ctx.fillStyle = "#ffc93c";
    for (let x = 12; x < 116; x += 6) ctx.fillRect(x, 66, 4, 12);
    for (const cx of [36, 92]) {
      ctx.fillStyle = "#11142a";
      ctx.beginPath();
      ctx.arc(cx, 34, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b9f24a";
      ctx.lineWidth = 3;
      for (let a = 0; a < 7; a++) {
        ctx.beginPath();
        ctx.moveTo(cx, 34);
        ctx.lineTo(cx + Math.cos((a / 7) * Math.PI * 2) * 19, 34 + Math.sin((a / 7) * Math.PI * 2) * 19);
        ctx.stroke();
      }
    }
  });

/** Machine casing for the Fab's tools: white panels, seams, a colored status band. */
const panelTexture = () =>
  canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 64, 128);
    ctx.strokeStyle = "#c3cad4";
    ctx.lineWidth = 2;
    for (let y = 0; y <= 128; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.lineTo(32, 128);
    ctx.stroke();
    ctx.fillStyle = "#2a3550";
    ctx.fillRect(0, 100, 64, 10);
  });

const floorTexture = (theme: TrackTheme) =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = hex(theme.ground);
    ctx.fillRect(0, 0, 128, 128);
    if (theme.id === "fab") {
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= 128; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 128);
        ctx.moveTo(0, i);
        ctx.lineTo(128, i);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      for (let x = 8; x < 128; x += 8) for (let y = 8; y < 128; y += 8) ctx.fillRect(x, y, 1, 1);
    } else {
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
      }
    }
  });

/**
 * A strip that follows the track. For each sample along [s0, s1] the callback
 * returns two track-space points (d, h) forming the strip's cross-section.
 */
const strip = (
  track: Track, s0: number, s1: number, step: number, vScale: number,
  section: (s: number, k: number) => readonly [number, number, number, number],
): THREE.BufferGeometry => {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const s = Math.min(s1, s0 + k * step);
    const [dA, hA, dB, hB] = section(s, k);
    trackPoint(track, s, dA, hA, v);
    positions.set([v.x, v.y, v.z], k * 6);
    trackPoint(track, s, dB, hB, v);
    positions.set([v.x, v.y, v.z], k * 6 + 3);
    uvs.set([0, (s - s0) / vScale, 1, (s - s0) / vScale], k * 4);
  }
  const index: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

export interface TrackScene {
  readonly group: THREE.Group;
  update(time: number, boxesReady: Uint8Array | null, coinsReady: Uint8Array | null, kartNear: (s: number, d: number) => boolean): void;
  /** Called when a box or GPU someone just took disappears, with where it was. */
  onPickup: ((kind: "box" | "gpu", at: THREE.Vector3, up: THREE.Vector3) => void) | null;
  dispose(): void;
}

const neon = (theme: TrackTheme) => THEME_LOOKS[theme.id].glow;

export const buildTrackScene = (track: Track, theme: TrackTheme, scene: THREE.Scene): TrackScene => {
  const group = new THREE.Group();
  const L = track.length;
  const hw = track.halfWidth;
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  // Static strips are batched per material and merged into one mesh each at the end.
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const addStatic = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    let list = batches.get(material);
    if (!list) batches.set(material, (list = []));
    list.push(geometry);
  };

  const look = THEME_LOOKS[theme.id];
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, look.fog[0], look.fog[1]);

  const hemi = new THREE.HemisphereLight(look.hemiSky, theme.ground, look.hemi);
  const ambient = new THREE.AmbientLight(0xffffff, look.ambient);
  const sun = new THREE.DirectionalLight(look.sunColor, look.sun);
  sun.position.set(...look.sunAt);
  group.add(hemi, ambient, sun);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < track.count; k++) {
    minX = Math.min(minX, track.px[k]); maxX = Math.max(maxX, track.px[k]);
    minZ = Math.min(minZ, track.pz[k]); maxZ = Math.max(maxZ, track.pz[k]);
  }
  const size = Math.max(maxX - minX, maxZ - minZ) + 2600;
  const floorTex = keep(floorTexture(theme));
  floorTex.repeat.set(size / 40, size / 40);
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(size, size)),
    keep(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, -0.05, (minZ + maxZ) / 2);
  group.add(ground);

  const edge = hw + 1.6;
  const roadTex = keep(roadTexture(theme));
  addStatic(
    strip(track, 0, L, 1, 16, () => [-hw, 0, hw, 0]),
    keep(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.8, metalness: theme.id === "fab" ? 0.3 : 0.05 })),
  );
  const underMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.wall).multiplyScalar(0.55), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
  addStatic(strip(track, 0, L, 2, 8, () => [edge, -0.7, -edge, -0.7]), underMat);
  for (const side of [-1, 1]) {
    const d = side * edge;
    addStatic(strip(track, 0, L, 2, 8, () => side > 0 ? [d, -0.7, d, 0] : [d, 0, d, -0.7]), underMat);
  }

  const kerbTex = keep(kerbTexture(theme));
  const kerbMat = keep(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 }));
  addStatic(strip(track, 0, L, 1, 6, () => [hw, 0.03, edge, 0.03]), kerbMat);
  addStatic(strip(track, 0, L, 1, 6, () => [-edge, 0.03, -hw, 0.03]), kerbMat);

  const wallMat = keep(new THREE.MeshStandardMaterial({
    color: theme.wall, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    emissive: neon(theme) ? theme.wall : 0x000000, emissiveIntensity: neon(theme) ? 0.35 : 0,
  }));
  const glowMat = keep(new THREE.MeshBasicMaterial({ color: theme.glow, side: THREE.DoubleSide }));
  for (const side of [-1, 1]) {
    const d = side * edge;
    addStatic(strip(track, 0, L, 1, 8, () => [d, 0, d, 1.1]), wallMat);
    addStatic(strip(track, 0, L, 1, 8, () => [d, 1.1, d, 1.3]), glowMat);
  }

  // Support pillars under raised road (not under loops).
  const pillarSpacing = 26;
  const pillarCount = Math.ceil(L / pillarSpacing) * 2;
  const pillarMat = keep(new THREE.MeshStandardMaterial({ color: neon(theme) ? 0x2a2f45 : 0x8e939c, roughness: 0.7, metalness: 0.3 }));
  const pillars = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.7, 0.9, 1, 10)), pillarMat, pillarCount);
  let pillarIndex = 0;
  const pm = new THREE.Matrix4();
  const pp = new THREE.Vector3();
  for (let s = 6; s < L; s += pillarSpacing) {
    const k = Math.round(s / track.step) % track.count;
    if (track.loop[k] || track.uy[k] < 0.8) continue;
    for (const side of [-1, 1]) {
      trackPoint(track, s, side * hw * 0.7, -0.7, pp);
      if (pp.y < 2) continue;
      pm.makeScale(1, pp.y, 1).setPosition(pp.x, pp.y / 2, pp.z);
      pillars.setMatrixAt(pillarIndex++, pm);
    }
  }
  pillars.count = pillarIndex;
  group.add(pillars);

  const checker = keep(checkerTexture());
  checker.repeat.set(Math.round(hw / 2), 1);
  addStatic(strip(track, 0, 4, 1, 4, () => [-hw, 0.05, hw, 0.05]), keep(new THREE.MeshBasicMaterial({ map: checker })));

  const gantryMat = keep(new THREE.MeshStandardMaterial({ color: 0x1b1f3b, roughness: 0.5 }));
  const bannerTex = keep(canvasTexture(1024, 128, (ctx) => {
    ctx.fillStyle = "#1b1f3b";
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = "#ffc93c";
    ctx.font = "italic 900 92px 'Barlow Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`DARIO KART · ${theme.name.toUpperCase()}`, 512, 68);
  }));
  bannerTex.wrapS = THREE.ClampToEdgeWrapping;
  const gantry = new THREE.Group();
  placeOnTrack(track, 2, 0, 0, 0, gantry);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, 9, 1.2)), gantryMat);
    pillar.position.set(side * (edge + 0.8), 4.5, 0);
    gantry.add(pillar);
  }
  const banner = new THREE.Mesh(
    keep(new THREE.BoxGeometry(edge * 2 + 2.8, 2.4, 0.6)),
    [gantryMat, gantryMat, gantryMat, gantryMat,
      keep(new THREE.MeshBasicMaterial({ map: bannerTex })), keep(new THREE.MeshBasicMaterial({ map: bannerTex }))],
  );
  banner.position.y = 8.4;
  gantry.add(banner);
  group.add(gantry);

  const boostTex = keep(chevronTexture("#3de0ff", "rgba(17,20,42,0.85)", true));
  const slowTex = keep(slowZoneTexture());
  const boostMat = keep(new THREE.MeshBasicMaterial({ map: boostTex, transparent: true }));
  const slowEdgeMat = keep(new THREE.MeshBasicMaterial({ color: 0xff1a3d, side: THREE.DoubleSide }));
  const slowMat = keep(new THREE.MeshBasicMaterial({ map: slowTex }));
  const rampTex = keep(hazardTexture());
  rampTex.repeat.set(4, 1);
  const rampMat = keep(new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.6, side: THREE.DoubleSide }));
  const launchMat = keep(new THREE.MeshStandardMaterial({
    color: 0x3de0ff, emissive: 0x3de0ff, emissiveIntensity: 0.5, map: rampTex, side: THREE.DoubleSide,
  }));
  const bumperGeo = keep(new THREE.CylinderGeometry(1.3, 1.5, 1.6, 20));
  const bumperRingGeo = keep(new THREE.TorusGeometry(1.3, 0.18, 8, 24));
  const bumperMat = keep(new THREE.MeshStandardMaterial({ color: 0x3de0ff, emissive: 0x3de0ff, emissiveIntensity: 0.6, roughness: 0.3 }));
  const ringMat = keep(new THREE.MeshBasicMaterial({ color: 0xffc93c }));
  const bumpers: Array<{ mesh: THREE.Group; s: number; d: number; pulse: number }> = [];

  for (const f of track.features) {
    if (f.kind === FeatureKind.Boost || f.kind === FeatureKind.Slow) {
      const tex = f.kind === FeatureKind.Boost ? boostMat : slowMat;
      if (f.kind === FeatureKind.Slow) {
        // Raised red edges so it reads as a hazard from a distance, not just a texture.
        for (const side of [-1, 1]) {
          const e = f.d + side * f.halfWidth;
          addStatic(strip(track, f.s, f.s + f.length, 1, 4, () => side > 0 ? [e, 0.06, e, 0.5] : [e, 0.5, e, 0.06]), slowEdgeMat);
        }
      }
      addStatic(
        strip(track, f.s, f.s + f.length, 1, f.halfWidth * 2, () => [f.d - f.halfWidth, 0.06, f.d + f.halfWidth, 0.06]),
        tex,
      );
    } else if (f.kind === FeatureKind.Ramp || f.kind === FeatureKind.Launch) {
      const height = f.kind === FeatureKind.Launch ? 2.6 : 1.7;
      const mat = f.kind === FeatureKind.Launch ? launchMat : rampMat;
      const rise = (s: number) => ((s - f.s) / f.length) ** 1.4 * height;
      addStatic(
        strip(track, f.s, f.s + f.length, 0.5, 2, (s) => [f.d - f.halfWidth, rise(s), f.d + f.halfWidth, rise(s)]),
        mat,
      );
      addStatic(
        strip(track, f.s + f.length - 0.01, f.s + f.length, 0.01, 1, () => [f.d - f.halfWidth, 0, f.d + f.halfWidth, height]),
        mat,
      );
    } else if (f.kind === FeatureKind.Bumper) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      const body = new THREE.Mesh(bumperGeo, bumperMat);
      body.position.y = 0.8;
      const ring = new THREE.Mesh(bumperRingGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.65;
      inner.add(body, ring);
      g.add(inner);
      placeOnTrack(track, f.s, f.d, 0, 0, g);
      group.add(g);
      bumpers.push({ mesh: inner, s: f.s, d: f.d, pulse: 0 });
    }
  }

  // Item boxes: solid, bright, a "?" on every face, so a row reads from far down the road.
  const boxTex = keep(itemBoxTexture(false));
  const boxGlow = keep(itemBoxTexture(true));
  const boxGeo = keep(new RoundedBoxGeometry(2, 2, 2, 3, .18));
  const boxMat = keep(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: boxTex, emissive: 0xffffff, emissiveMap: boxGlow, emissiveIntensity: .5,
    roughness: .26, metalness: .12, clearcoat: 1, clearcoatRoughness: .12,
  }));
  const boxTime = { value: 0 };
  boxMat.onBeforeCompile = (shader) => {
    shader.uniforms.uBoxTime = boxTime;
    shader.vertexShader = `varying vec3 vBoxPosition;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvBoxPosition = position;");
    shader.fragmentShader = `varying vec3 vBoxPosition;\nuniform float uBoxTime;\n${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\nfloat scan = pow(.5 + .5 * sin(vBoxPosition.y * 5. - uBoxTime * 3.), 14.);\ntotalEmissiveRadiance += vec3(.14, .35, .55) * scan;",
    );
  };
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, track.itemBoxes.length));
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const boxBase = track.itemBoxes.map((b) => trackPoint(track, b.s, b.d, 1.5, new THREE.Vector3()));
  const boxUp = track.itemBoxes.map((b) => {
    poseAt(track, b.s, b.d, 0, pose);
    return new THREE.Vector3(pose.ux, pose.uy, pose.uz);
  });
  const boxColor = new THREE.Color();
  track.itemBoxes.forEach((_, i) => boxes.setColorAt(i, boxColor.setHSL((i * 0.13) % 1, 1, 0.5)));
  group.add(boxes);
  // A glowing ring on the road under each box.
  const boxRingMat = keep(pickupRingMaterial());
  const rings = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(3.8, 3.8)), boxRingMat, Math.max(1, track.itemBoxes.length));
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const ringPose = track.itemBoxes.map((b) => {
    const at = trackPoint(track, b.s, b.d, 0.08, new THREE.Vector3());
    poseAt(track, b.s, b.d, 0, pose);
    const up = new THREE.Vector3(pose.ux, pose.uy, pose.uz);
    return { at, turn: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up) };
  });
  group.add(rings);

  // GPUs: chunky glowing graphics cards spinning above the road.
  const gpuTex = keep(gpuTexture());
  const coinMat = keep(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: gpuTex, emissive: 0x76b900, emissiveMap: gpuTex, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.35,
  }));
  const coins = new THREE.InstancedMesh(keep(new RoundedBoxGeometry(1.7, .28, 1.06, 2, .10)), coinMat, Math.max(1, track.coins.length));
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const coinBase = track.coins.map((c) => trackPoint(track, c.s, c.d, c.h, new THREE.Vector3()));
  const coinUp = track.coins.map((c) => {
    poseAt(track, c.s, c.d, 0, pose);
    return new THREE.Vector3(pose.ux, pose.uy, pose.uz);
  });
  group.add(coins);

  const decor = themeDecor(track, theme);
  const lit = look.windows === "lit";
  const buildingCount = Math.min(900, Math.floor(L * look.density));
  const buildingMat = keep(new THREE.MeshStandardMaterial({
    map: keep(look.windows === "panels" ? panelTexture() : windowTexture(lit)),
    emissiveMap: lit ? keep(windowTexture(true)) : null,
    emissive: lit ? (look.glow ? theme.glow : 0xffd9a0) : 0x000000,
    emissiveIntensity: look.glow ? 0.9 : 0.55,
    roughness: 0.8,
  }));
  const placedBuildings: PlacedBuilding[] = [];
  const buildings = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), buildingMat, buildingCount);
  const coarse: number[] = [];
  for (let k = 0; k < track.count; k += 4) coarse.push(track.px[k], track.pz[k]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  let rng = track.seed ^ 0x5bd1e995;
  const rand = () => {
    rng = (Math.imul(rng ^ (rng >>> 15), 2246822507) + 0x6d2b79f5) | 0;
    return ((rng >>> 0) % 100000) / 100000;
  };
  let placed = 0;
  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount; attempt++) {
    const s = rand() * L;
    const side = rand() < 0.5 ? -1 : 1;
    const footprint = 8 + rand() * 22;
    const k = Math.round(s / track.step) % track.count;
    const yaw = Math.atan2(track.tz[k], track.tx[k]);
    const offset = hw + 10 + footprint / 2 + rand() * rand() * look.spread;
    pos.set(track.px[k] - Math.sin(yaw) * side * offset, 0, track.pz[k] + Math.cos(yaw) * side * offset);
    const clearance = hw + footprint * 0.75 + 8;
    let ok = true;
    for (let c = 0; c < coarse.length; c += 2) {
      const dx = coarse[c] - pos.x;
      const dz = coarse[c + 1] - pos.z;
      if (dx * dx + dz * dz < clearance * clearance) {
        ok = false;
        break;
      }
    }
    if (!ok || decor.reserved.some((r) => Math.hypot(r.x - pos.x, r.z - pos.z) < r.r + footprint * 0.75)) continue;
    const [hMin, hMax] = theme.buildingHeight;
    const height = hMin + (hMax - hMin) * Math.pow(rand(), 1.6);
    pos.y = height / 2;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2 - yaw);
    scale.set(footprint, height, footprint * (0.7 + rand() * 0.6));
    placedBuildings.push({ x: pos.x, z: pos.z, w: scale.x, d: scale.z, h: height, rot: Math.PI / 2 - yaw });
    m.compose(pos, q, scale);
    buildings.setMatrixAt(placed, m);
    buildings.setColorAt(placed, color.setHex(theme.buildings[Math.floor(rand() * theme.buildings.length)]));
    placed++;
  }
  buildings.count = placed;
  group.add(buildings);
  decor.build(placedBuildings, { group, add: addStatic, keep });

  for (const [material, list] of batches) {
    const merged = keep(mergeGeometries(list, false));
    for (const g of list) g.dispose();
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.traverse((o) => {
    if (o !== boxes && o !== coins && o !== rings) {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    }
  });
  for (const b of bumpers) b.mesh.matrixAutoUpdate = true;
  scene.add(group);

  const tmp = new THREE.Object3D();
  const coinWas = new Uint8Array(coinBase.length).fill(1);
  const boxWas = new Uint8Array(boxBase.length).fill(1);
  const result: TrackScene = {
    group,
    onPickup: null,
    update(time, boxesReady, coinsReady, kartNear) {
      boxTime.value = time;
      boxRingMat.uniforms.uTime.value = time;
      for (let i = 0; i < coinBase.length; i++) {
        const ready = coinsReady ? coinsReady[i] === 1 : true;
        if (!ready && coinWas[i]) result.onPickup?.("gpu", coinBase[i], coinUp[i]);
        coinWas[i] = ready ? 1 : 0;
        tmp.position.copy(coinBase[i]);
        tmp.position.y += Math.sin(time * 3 + i * 0.7) * 0.2;
        tmp.rotation.set(0.35, time * 2.4 + i * 0.4, 0);
        tmp.scale.setScalar(ready ? 1 : 0.0001);
        tmp.updateMatrix();
        coins.setMatrixAt(i, tmp.matrix);
      }
      coins.instanceMatrix.needsUpdate = true;
      boostTex.offset.y = -time * 2.2;
      slowTex.offset.y = time * 1.2;
      for (let i = 0; i < boxBase.length; i++) {
        const ready = boxesReady ? boxesReady[i] === 1 : true;
        if (!ready && boxWas[i]) result.onPickup?.("box", boxBase[i], boxUp[i]);
        boxWas[i] = ready ? 1 : 0;
        tmp.position.copy(boxBase[i]).addScaledVector(boxUp[i], Math.sin(time * 2 + i) * 0.25);
        tmp.rotation.set(time * 0.7 + i, time * 1.1 + i, 0);
        tmp.scale.setScalar(ready ? 1 : 0.0001);
        tmp.updateMatrix();
        boxes.setMatrixAt(i, tmp.matrix);
        const ring = ringPose[i];
        tmp.position.copy(ring.at);
        tmp.quaternion.copy(ring.turn);
        tmp.scale.setScalar(ready ? 1 + Math.sin(time * 4 + i) * 0.08 : 0.0001);
        tmp.updateMatrix();
        rings.setMatrixAt(i, tmp.matrix);
      }
      boxes.instanceMatrix.needsUpdate = true;
      rings.instanceMatrix.needsUpdate = true;
      for (const b of bumpers) {
        if (kartNear(b.s, b.d)) b.pulse = 1;
        b.pulse = Math.max(0, b.pulse - 0.05);
        b.mesh.scale.setScalar(1 + b.pulse * 0.35);
      }
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      boxes.dispose();
      rings.dispose();
      buildings.dispose();
      pillars.dispose();
      coins.dispose();
    },
  };
  return result;
};

/* ---------------- karts ---------------- */

const fx = { spark: new THREE.SphereGeometry(.13, 10, 8) };
const hitMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1ca });
const starShape = new THREE.Shape();
for (let i = 0; i < 10; i++) {
  const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? .085 : .20;
  if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
}
starShape.closePath();
const starBase = new THREE.ExtrudeGeometry(starShape, { depth: .04, bevelEnabled: true, bevelSize: .012, bevelThickness: .01, bevelSegments: 1 });
const starParts = Array.from({ length: 3 }, (_, i) => {
  const a = i / 3 * Math.PI * 2;
  return starBase.clone().rotateY(a).translate(Math.cos(a) * .72, 0, Math.sin(a) * .72);
});
const starGeometry = mergeGeometries(starParts, false);
starBase.dispose();
for (const g of starParts) g.dispose();
const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffdf62, side: THREE.DoubleSide });
const tokenHaloGeometry = new THREE.TorusGeometry(1.5, .045, 6, 48).rotateX(Math.PI / 2);
const tokenHaloMaterial = new THREE.MeshBasicMaterial({ color: 0xffd56a, transparent: true, opacity: .72, depthWrite: false });
/** Drift spark colors by charge: building, mini boost ready, super boost ready. */
export const SPARK_COLORS = [0xd7dce6, 0x3de0ff, 0xff3d7f, 0xb18cff];
const sparkMats = SPARK_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c }));

const labelSprite = (text: string, me: boolean): THREE.Sprite => {
  const tex = canvasTexture(256, 64, (ctx) => {
    ctx.font = "700 34px 'Barlow Semi Condensed', sans-serif";
    const w = Math.min(250, ctx.measureText(text).width + 24);
    ctx.fillStyle = me ? "rgba(255,201,60,0.95)" : "rgba(17,20,42,0.75)";
    ctx.fillRect((256 - w) / 2, 10, w, 44);
    ctx.fillStyle = me ? "#11142a" : "#d7dce6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 33);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 3.1;
  return sprite;
};

export interface KartLook {
  readonly kart: string;
  readonly character: string;
  readonly name: string;
  readonly primary: number;
  readonly secondary: number;
  readonly me: boolean;
}

export interface KartFx {
  speed: number;
  boostT: number;
  boostKind: number;
  nitro: boolean;
  stunT: number;
  giantT: number;
  squashT: number;
  drifting: number;
  driftCharge: number;
  trickT: number;
  slip: number;
  time: number;
  showLabel: boolean;
  /** Items held, shown as missiles on the roof rack. */
  items: number;
}

/** Builds the kart body (shared by races and the lobby preview). Faces local +Z. */
export const buildKartBody = (look: Pick<KartLook, "kart" | "character" | "primary" | "secondary">) => {
  const body = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0x3de0ff });
  for (const [part, geo] of kartGeometry(look.kart)) {
    const mat = part === "glow" ? glow : partMaterial(part as Part, look.primary, look.secondary);
    body.add(new THREE.Mesh(geo, mat));
  }
  const driver = new DriverVisual(look.character);
  const fit = chassisFit(look.kart);
  driver.root.position.y += fit.seat.y;
  driver.root.position.z += fit.seat.z;
  driver.root.scale.multiplyScalar(fit.seat.scale);
  body.add(driver.root);
  return { body, glow, driver, fit };
};

/** Visual for one racer. */
export class KartVisual {
  readonly root = new THREE.Group();
  readonly body: THREE.Group;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly driver: DriverVisual;
  private readonly flame: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sparks: THREE.Mesh[] = [];
  private readonly stars = new THREE.Mesh(starGeometry, starMaterial);
  private readonly tokenHalo = new THREE.Mesh(tokenHaloGeometry, tokenHaloMaterial);
  private readonly surfaces: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
  private hitAt = -100;
  private quietHit = false;
  private flashing = false;
  private readonly label: THREE.Sprite;
  private readonly fit: ChassisFit;
  /** How much taller than a standard kart this one is: the chase camera rides higher. */
  get height(): number {
    return Math.max(0, this.fit.label - 3.1);
  }
  private readonly rack: THREE.Mesh[] = [];

  constructor(look: KartLook) {
    const built = buildKartBody(look);
    this.body = built.body;
    this.glow = built.glow;
    this.driver = built.driver;
    this.fit = built.fit;
    this.root.add(this.body);
    this.body.traverse((part) => {
      if (part instanceof THREE.Mesh) this.surfaces.push({ mesh: part, material: part.material });
    });

    this.flame = new THREE.Mesh(jetGeometry, jetMaterial(0x3de0ff));
    const exhaust = kartGeometry(look.kart).get("glow")!;
    if (!exhaust.boundingBox) exhaust.computeBoundingBox();
    this.flame.position.set(0, this.fit.exhaust.y, exhaust.boundingBox!.min.z);
    this.body.add(this.flame);
    for (const x of [-this.fit.sparks.x, this.fit.sparks.x]) {
      const spark = new THREE.Mesh(fx.spark, sparkMats[0]);
      spark.position.set(x, 0.15, this.fit.sparks.z);
      spark.visible = false;
      this.body.add(spark);
      this.sparks.push(spark);
    }
    this.stars.position.y = 2.65;
    this.stars.visible = false;
    this.root.add(this.stars);
    this.tokenHalo.position.y = .12;
    this.tokenHalo.visible = false;
    this.root.add(this.tokenHalo);

    for (const x of [0, 0.42]) {
      const m = makeRackMissile();
      m.position.set(x, this.fit.label - 1.5, -1.05);
      m.visible = false;
      this.body.add(m);
      this.rack.push(m);
    }

    this.label = labelSprite(look.me ? "You" : look.name, look.me);
    this.label.position.y = this.fit.label;
    this.root.add(this.label);
  }

  hit(time: number, reducedMotion: boolean): void {
    this.hitAt = time;
    this.quietHit = reducedMotion;
  }

  apply(state: KartFx): void {
    const giantT = state.giantT ?? 0, squashT = state.squashT ?? 0;
    const grown = THREE.MathUtils.smoothstep(Math.min((TOKEN_MAXING_SECONDS - giantT) / .22, giantT / .3), 0, 1);
    const size = 1 + (TOKEN_MAXING_SCALE - 1) * grown;
    const flat = Math.min(1, squashT / .18);
    this.body.scale.set(size * (1 + flat * .28), size * (1 - flat * .82), size * (1 + flat * .18));
    this.tokenHalo.visible = giantT > 0;
    this.tokenHalo.scale.setScalar(size * (1 + Math.sin(state.time * 4) * .025));
    this.label.position.y = squashT > 0 ? 1.5 : this.fit.label * size;
    this.driver.animate(state.time, state.slip, state.speed, state.stunT > 0);
    const age = state.time - this.hitAt;
    const flashing = !this.quietHit && age >= 0 && age < .065;
    if (flashing !== this.flashing) {
      for (const part of this.surfaces) part.mesh.material = flashing ? hitMaterial : part.material;
      this.flashing = flashing;
    }
    this.body.position.y = squashT <= 0 && !this.quietHit && age >= 0 && age < .32 ? Math.sin(age / .32 * Math.PI) * .15 : 0;
    this.flame.visible = squashT <= 0 && state.boostT > 0;
    if (this.flame.visible) {
      this.flame.material.uniforms.uTime.value = state.time;
      this.flame.material.uniforms.uColor.value.setHex(state.boostKind === BoostKind.UltraDrift ? 0xb98aff : state.nitro ? 0x75f3ff : 0x3de0ff);
      this.flame.scale.set(state.nitro ? 1.25 : 1, state.nitro ? 1.25 : 1, 1.1 + Math.sin(state.time * 40) * .16);
    }
    this.body.rotation.y = squashT > 0 ? 0 : state.stunT > 0 ? state.time * 14 : -state.slip * 0.35;
    this.body.rotation.z = squashT > 0 || state.stunT > 0 ? 0 : state.slip * 0.2;
    // Trick: a full barrel roll while airborne.
    this.body.rotation.x = 0;
    if (squashT <= 0 && state.trickT > 0) this.body.rotation.z = (1 - state.trickT / 0.45) * Math.PI * 2;
    if (squashT <= 0 && this.fit.hover) {
      this.body.position.y += 0.3 + Math.sin(state.time * 3.2 + this.fit.label) * 0.07;
      if (state.stunT <= 0 && state.trickT <= 0) this.body.rotation.z = state.slip * 0.45;
    }

    this.glow.color.setHex(state.boostT > 0 ? 0xffffff : 0x3de0ff);
    this.stars.visible = state.stunT > 0 || squashT > 0;
    this.stars.rotation.y = state.time * 3.5;
    this.stars.position.y = (squashT > 0 ? .9 : (this.fit.label - .45) * size) + Math.sin(state.time * 5) * .08;

    const charge = state.driftCharge;
    const tier = charge >= 2.3 ? 3 : charge >= 1.4 ? 2 : charge >= 0.7 ? 1 : 0;
    for (const s of this.sparks) {
      s.visible = state.drifting > 0 && Math.sin(state.time * 50 + s.position.x) > -0.3;
      s.material = sparkMats[tier];
      s.scale.setScalar(tier === 0 ? 0.7 : tier === 1 ? 1.2 : tier === 2 ? 1.7 : 2.2);
    }
    this.label.visible = state.showLabel;
    // Armed karts carry their missiles where everyone can see them.
    this.rack[0].visible = state.items > 0;
    this.rack[0].position.x = state.items > 1 ? -0.21 : 0;
    this.rack[1].visible = state.items > 1;
    this.rack[1].position.x = 0.21;
  }

  dispose(): void {
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
    this.label.material.dispose();
    this.glow.dispose();
    this.flame.material.dispose();
  }
}

/* ---------------- projectiles ---------------- */

/** Speech bubble for emotes, floating above a kart. */
export const makeBubble = (text: string, accent: number): THREE.Sprite => {
  const tex = canvasTexture(512, 160, (ctx) => {
    ctx.font = "700 40px 'Barlow Semi Condensed', sans-serif";
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 440 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    const h = 30 + lines.length * 44;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(16, 4, 480, h, 22);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(230, h + 2);
    ctx.lineTo(256, h + 30);
    ctx.lineTo(282, h + 2);
    ctx.fill();
    ctx.fillStyle = hex(accent);
    ctx.fillRect(16, 4, 10, h);
    ctx.fillStyle = "#11142a";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, 262, 20 + i * 44));
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  sprite.scale.set(7, 2.2, 1);
  sprite.position.y = 5.2;
  sprite.renderOrder = 10;
  return sprite;
};
