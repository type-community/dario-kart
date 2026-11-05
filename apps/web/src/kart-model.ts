import { CHARACTERS, type Character, type ChassisKind, KARTS } from "@dario-kart/sim";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural kart bodies. Each chassis kind is its own machine (an open-wheel
 * racer, a dragster, a go-kart, a trike, a rally hatch, a monster truck, a
 * hovercraft) built from a small kit of parts. Parts are merged per material:
 * one draw call per material per kart, and geometry is shared between karts
 * of the same model.
 */

/** Build-time part kinds. At merge time they collapse into fewer render materials (see MERGE_INTO). */
type BuildPart = "paint" | "trim" | "carbon" | "chrome" | "tire" | "glow" | "head" | "tail";
export type Part = "paint" | "trim" | "dark" | "chrome" | "glow" | "lights";

const MERGE_INTO: Record<BuildPart, Part> = {
  paint: "paint", trim: "trim", carbon: "dark", tire: "dark", chrome: "chrome", glow: "glow", head: "lights", tail: "lights",
};
const LIGHT_COLOR: Partial<Record<BuildPart, THREE.Color>> = {
  head: new THREE.Color(0xf6fbff),
  tail: new THREE.Color(0xff2a4a),
};

interface Shape {
  length: number;
  width: number;
  bevel: number;
  noseDrop: number;
  hump: number;
  wing: "low" | "tall" | "twin" | "duck" | "none";
  exhausts: number;
  pods: "slim" | "wide" | "armored" | "twin";
  fin: boolean;
  wheel: number;
  splitter: number;
}

const RACER: Shape = { length: 1, width: 1, bevel: 0.14, noseDrop: 0.1, hump: 0.2, wing: "duck", exhausts: 2, pods: "slim", fin: false, wheel: 0.44, splitter: 0.9 };

/** Where the driver sits and where effects attach, per chassis. Local +Z is forward. */
export interface ChassisFit {
  /** Driver offset and scale. */
  readonly seat: { y: number; z: number; scale: number };
  /** Boost flame origin. */
  readonly exhaust: { y: number; z: number };
  /** Drift sparks: half-track and z of the rear contact patches. */
  readonly sparks: { x: number; z: number };
  /** Name tag height. */
  readonly label: number;
  /** Floats and bobs instead of sitting on wheels. */
  readonly hover: boolean;
}

const FITS: Record<ChassisKind, ChassisFit> = {
  racer: { seat: { y: 0, z: 0, scale: 1 }, exhaust: { y: 0.55, z: -2.4 }, sparks: { x: 0.95, z: -1.05 }, label: 3.1, hover: false },
  dragster: { seat: { y: 0.05, z: -0.15, scale: 1 }, exhaust: { y: 0.75, z: -2.5 }, sparks: { x: 1.15, z: -1.3 }, label: 3.4, hover: false },
  kart: { seat: { y: -0.05, z: -0.25, scale: 1 }, exhaust: { y: 0.45, z: -1.9 }, sparks: { x: 0.95, z: -1.05 }, label: 3, hover: false },
  trike: { seat: { y: 0.1, z: -0.15, scale: 0.86 }, exhaust: { y: 0.6, z: -1.6 }, sparks: { x: 0.85, z: -0.9 }, label: 3, hover: false },
  rally: { seat: { y: 0.3, z: -0.25, scale: 0.95 }, exhaust: { y: 0.55, z: -2.3 }, sparks: { x: 1, z: -1.15 }, label: 3.4, hover: false },
  monster: { seat: { y: 1.05, z: -0.1, scale: 1 }, exhaust: { y: 1.5, z: -2.3 }, sparks: { x: 1.3, z: -1.35 }, label: 4.4, hover: false },
  hover: { seat: { y: 0.2, z: -0.1, scale: 0.95 }, exhaust: { y: 1.25, z: -2.2 }, sparks: { x: 1.05, z: -1.4 }, label: 3.3, hover: true },
};

export const chassisOf = (kartId: string): ChassisKind => (KARTS.find((k) => k.id === kartId) ?? KARTS[0]).chassis.kind;
export const chassisFit = (kartId: string): ChassisFit => FITS[chassisOf(kartId)];

const geometryCache = new Map<string, Map<Part, THREE.BufferGeometry>>();

const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};

/** Side profile of the body, z forward / y up. The first two points are the floor. */
const profilePoints = (shape: Shape): Array<[number, number]> => {
  const L = shape.length;
  return [
    [-1.3 * L, 0.2],
    [1.6 * L, 0.2],
    [2.1 * L, 0.24 - shape.noseDrop * 0.3],
    [2.0 * L, 0.32 - shape.noseDrop * 0.6],
    [1.1 * L, 0.48],
    [0.45 * L, 0.56],
    [-0.4 * L, 0.56],
    [-0.9 * L, 0.6 + shape.hump * 0.75],
    [-1.3 * L, 0.54 + shape.hump * 0.6],
  ];
};

/** Side profile extruded across the kart's width. */
const tub = (shape: Shape, width: number, lift: number) => {
  const pts = profilePoints(shape);
  const profile = new THREE.Shape();
  profile.moveTo(pts[0][0], pts[0][1] + lift);
  for (const [z, y] of pts.slice(1)) profile.lineTo(z, y + lift);
  profile.closePath();
  const bevel = Math.min(shape.bevel, width * 0.3);
  const geo = new THREE.ExtrudeGeometry(profile, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0.01,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  return geo;
};

const tire = (radius: number, width: number) => {
  const pts: THREE.Vector2[] = [];
  const r = radius;
  const w = width / 2;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.1 + Math.sin(a) * 0.1, -w + (i / 8) * width));
  }
  pts.unshift(new THREE.Vector2(r * 0.62, -w));
  pts.push(new THREE.Vector2(r * 0.62, w));
  return new THREE.LatheGeometry(pts, 20).rotateZ(Math.PI / 2);
};

type Parts = Record<BuildPart, THREE.BufferGeometry[]>;
const emptyParts = (): Parts => ({ paint: [], trim: [], carbon: [], chrome: [], tire: [], glow: [], head: [], tail: [] });

/** A tire with chrome rim, spokes and hub, axle along X. */
const wheel = (parts: Parts, x: number, z: number, r: number, width: number, y = r, spokes = 5) => {
  const tireGeo = tire(r, width);
  parts.tire.push(at(tireGeo, x, y, z));
  parts.chrome.push(at(new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.02, 18), x, y, z, 0, 0, Math.PI / 2));
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    parts.carbon.push(at(new THREE.BoxGeometry(width + 0.05, r * 0.5, 0.07), x, y + Math.sin(a) * r * 0.3, z + Math.cos(a) * r * 0.3, a));
  }
  parts.trim.push(at(new THREE.CylinderGeometry(r * 0.2, r * 0.2, width + 0.04, 10), x, y, z, 0, 0, Math.PI / 2));
};

/** Chunky tread blocks around a tire. */
const treads = (parts: Parts, x: number, z: number, r: number, width: number, y = r, count = 14) => {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    parts.tire.push(at(new THREE.BoxGeometry(width * 1.04, 0.14, r * 0.28), x, y + Math.cos(a) * r, z + Math.sin(a) * r, a));
  }
};

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, r);
const cyl = (top: number, bottom: number, h: number, seg = 12) => new THREE.CylinderGeometry(top, bottom, h, seg);
/** A tube from a to b. */
const tube = (parts: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, r: number) => {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  parts.push(at(g, mid.x, mid.y, mid.z));
};
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lights = (parts: Parts, z: number, y: number, spread: number, size = 0.3) => {
  for (const side of [-1, 1]) parts.head.push(at(rbox(size, 0.08, 0.06, 0.02), side * spread, y, z));
};

/** The open-wheel racer: sculpted tub, side pods, wings. */
const buildRacer = (parts: Parts): void => {
  const shape = RACER;
  const W = 1.34 * shape.width;
  const L = shape.length;

  parts.paint.push(at(tub(shape, W, 0.04), 0, 0, 0));

  // Livery stripe: a thin band riding just above the body's top contour, nose to tail.
  {
    const bevel = Math.min(shape.bevel, W * 0.3);
    const top = profilePoints(shape).slice(3);
    const band = new THREE.Shape();
    band.moveTo(top[0][0] + bevel * 0.5, top[0][1] + 0.04 + bevel + 0.03);
    for (const [z, y] of top.slice(1)) band.lineTo(z, y + 0.04 + bevel + 0.03);
    for (const [z, y] of [...top].reverse()) band.lineTo(z, y + 0.04 + bevel - 0.05);
    band.closePath();
    const stripe = new THREE.ExtrudeGeometry(band, { depth: 0.5, bevelEnabled: false });
    stripe.rotateY(-Math.PI / 2);
    stripe.translate(0.25, 0, 0);
    parts.trim.push(at(stripe, 0, 0, 0));
  }

  // Cockpit opening + headrest + windscreen.
  parts.carbon.push(at(new RoundedBoxGeometry(0.86, 0.12, 1.0, 2, 0.05), 0, 0.62 + shape.bevel, -0.1));
  parts.trim.push(at(new RoundedBoxGeometry(0.62, 0.34, 0.24, 2, 0.08), 0, 0.8 + shape.bevel, -0.72));
  parts.head.push(at(new THREE.BoxGeometry(0.7, 0.02, 0.02), 0, 0.62 + shape.bevel, 0.5));

  // Rear diffuser with strakes, and a full-width light bar.
  const rear = -1.3 * L - shape.bevel;
  parts.carbon.push(at(new THREE.BoxGeometry(W * 0.92, 0.16, 0.34), 0, 0.2, rear - 0.05, -0.35));
  for (let i = -2; i <= 2; i++) parts.carbon.push(at(new THREE.BoxGeometry(0.03, 0.2, 0.36), i * W * 0.18, 0.22, rear - 0.05));
  parts.tail.push(at(new THREE.BoxGeometry(W * 0.86, 0.05, 0.03), 0, 0.5 + shape.hump * 0.6, rear - 0.005));

  // Side pods.
  for (const side of [-1, 1]) {
    const x = side * (W / 2 + 0.16);
    if (shape.pods === "armored") {
      parts.trim.push(at(new RoundedBoxGeometry(0.42, 0.42, 1.5 * L, 2, 0.05), x, 0.46, 0.05));
      parts.carbon.push(at(new THREE.BoxGeometry(0.06, 0.3, 1.3 * L), x + side * 0.22, 0.46, 0.05));
    } else if (shape.pods === "twin") {
      parts.trim.push(at(new THREE.CapsuleGeometry(0.2, 1.25 * L, 4, 10), x, 0.5, -0.05, Math.PI / 2));
      parts.glow.push(at(new THREE.CircleGeometry(0.14, 12), x, 0.5, -0.05 - 0.83 * L, 0, Math.PI));
    } else {
      const wide = shape.pods === "wide" ? 0.44 : 0.34;
      parts.trim.push(at(new RoundedBoxGeometry(wide, 0.34, 1.35 * L, 2, 0.1), x, 0.44, 0.05));
      parts.carbon.push(at(new THREE.BoxGeometry(wide * 0.7, 0.16, 0.08), x, 0.5, 0.05 + 0.69 * L));
    }
    parts.paint.push(at(new THREE.BoxGeometry(0.05, 0.06, 1.2 * L), x + side * (shape.pods === "wide" ? 0.23 : 0.18), 0.56, 0.05));
  }

  // Front splitter + wing with endplates.
  const fw = 2.1 * shape.splitter;
  parts.carbon.push(at(new THREE.BoxGeometry(fw, 0.05, 0.42), 0, 0.2, 1.95 * L));
  parts.trim.push(at(new THREE.BoxGeometry(fw * 0.96, 0.05, 0.16), 0, 0.27, 2.02 * L, -0.25));
  for (const side of [-1, 1]) parts.trim.push(at(new THREE.BoxGeometry(0.05, 0.22, 0.5), side * fw / 2, 0.28, 1.95 * L));

  // Rear wing.
  const rz = -1.32 * L;
  const wing = (y: number, span: number, chord: number, x = 0) => {
    parts.trim.push(at(new THREE.BoxGeometry(span, 0.07, chord), x, y, rz, 0.12));
    for (const side of [-1, 1]) {
      parts.carbon.push(at(new THREE.BoxGeometry(0.05, 0.36, chord + 0.12), x + side * span / 2, y - 0.08, rz));
    }
  };
  if (shape.wing === "tall") {
    wing(1.45, 1.8, 0.5);
    for (const side of [-1, 1]) parts.carbon.push(at(new THREE.BoxGeometry(0.07, 0.7, 0.14), side * 0.42, 1.08, rz));
  } else if (shape.wing === "low") {
    wing(1.16, 1.7, 0.44);
    for (const side of [-1, 1]) parts.carbon.push(at(new THREE.BoxGeometry(0.07, 0.36, 0.12), side * 0.4, 0.96, rz));
  } else if (shape.wing === "twin") {
    wing(1.2, 0.8, 0.4, -0.55);
    wing(1.2, 0.8, 0.4, 0.55);
    for (const side of [-1, 1]) parts.carbon.push(at(new THREE.BoxGeometry(0.07, 0.4, 0.12), side * 0.55, 0.98, rz));
  } else if (shape.wing === "duck") {
    parts.trim.push(at(new THREE.BoxGeometry(W * 0.95, 0.1, 0.32), 0, 0.92 + shape.hump * 0.8, rz + 0.05, -0.35));
  }
  if (shape.fin) {
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-0.9, 0);
    fin.lineTo(-0.8, 0.55);
    fin.lineTo(-0.55, 0.55);
    fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    parts.paint.push(at(finGeo, 0.025, 0.86 + shape.hump * 0.6, -0.5 * L));
  }

  // Exhausts.
  const pipes = shape.exhausts;
  for (let i = 0; i < pipes; i++) {
    const x = pipes === 1 ? 0 : (i / (pipes - 1) - 0.5) * (pipes > 2 ? 0.9 : 0.5);
    const y = 0.4 + (pipes > 2 && i % 2 ? 0.1 : 0);
    parts.chrome.push(at(new THREE.CylinderGeometry(0.1, 0.12, 0.42, 12, 1, true), x, y, rear - 0.12, Math.PI / 2));
    parts.glow.push(at(new THREE.CircleGeometry(0.085, 12), x, y, rear - 0.33, 0, Math.PI));
  }

  // Lights.
  for (const side of [-1, 1]) {
    parts.head.push(at(new RoundedBoxGeometry(0.34, 0.05, 0.06, 1, 0.02), side * 0.4 * shape.width, 0.36 - shape.noseDrop * 0.5 + shape.bevel * 0.6, 1.95 * L, -0.5, side * 0.25));

  }

  for (const [x, z] of [[-1, 1.15 * L], [1, 1.15 * L], [-1, -0.95 * L], [1, -0.95 * L]] as const) {
    wheel(parts, x * (W / 2 + 0.36), z, shape.wheel, 0.42);
  }
};

/** Top fuel dragster: needle nose, bicycle front wheels, huge slicks, blower and stacks. */
const buildDragster = (parts: Parts): void => {
  // Needle nose: a four-sided taper from the cockpit to the front wheels.
  parts.paint.push(at(cyl(0.1, 0.46, 3.7, 4), 0, 0.45, 2.05, Math.PI / 2, Math.PI / 4));
  parts.trim.push(at(box(0.08, 0.08, 3.4), 0, 0.72, 2.05, -0.1));
  parts.paint.push(at(rbox(1.0, 0.55, 1.5, 0.12), 0, 0.55, -0.15));
  parts.carbon.push(at(rbox(0.8, 0.12, 0.9, 0.05), 0, 0.85, -0.05));
  // Engine, blower and scoop sit right behind the driver.
  parts.carbon.push(at(rbox(0.85, 0.6, 1.0, 0.06), 0, 0.85, -1.15));
  parts.chrome.push(at(rbox(0.55, 0.4, 0.6, 0.05), 0, 1.35, -1.1));
  parts.trim.push(at(box(0.5, 0.28, 0.42), 0, 1.68, -1.0, -0.2));
  parts.carbon.push(at(box(0.36, 0.12, 0.3), 0, 1.85, -0.92, -0.2));
  // Zoomie stacks, four a side, flaring out.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.8 - i * 0.18;
      const base = v(side * 0.42, 0.95, z);
      const tip = v(side * 0.75, 1.25, z - 0.12);
      tube(parts.chrome, base, tip, 0.06);
      parts.glow.push(at(new THREE.CircleGeometry(0.05, 8), tip.x, tip.y, tip.z, 0, side * Math.PI / 2));
    }
  }
  // Wheelie bars and chute pack.
  tube(parts.chrome, v(-0.3, 0.3, -1.6), v(-0.3, 0.25, -2.6), 0.04);
  tube(parts.chrome, v(0.3, 0.3, -1.6), v(0.3, 0.25, -2.6), 0.04);
  parts.trim.push(at(cyl(0.22, 0.22, 0.5), 0, 0.55, -2.0, Math.PI / 2));
  parts.tail.push(at(box(0.6, 0.06, 0.03), 0, 0.82, -2.26));
  // A wing up high on tall struts.
  parts.paint.push(at(box(2.3, 0.08, 0.75), 0, 2.45, -2.0, 0.18));
  for (const side of [-1, 1]) {
    parts.carbon.push(at(box(0.06, 0.6, 0.9), side * 1.15, 2.35, -2.0));
    tube(parts.carbon, v(side * 0.35, 0.9, -1.6), v(side * 0.55, 2.4, -2.0), 0.05);
  }
  // Skinny bicycle tires up front on a narrow axle, huge slicks at the back.
  parts.carbon.push(at(box(1.15, 0.06, 0.06), 0, 0.3, 3.65));
  for (const side of [-1, 1]) wheel(parts, side * 0.6, 3.65, 0.3, 0.16, 0.3, 4);
  for (const side of [-1, 1]) wheel(parts, side * 1.08, -1.3, 0.8, 0.8, 0.8, 6);
  lights(parts, 3.95, 0.4, 0.12, 0.14);
};

/** A proper go-kart: flat tray, bumpers, seat, steering wheel, side engine. */
const buildGoKart = (parts: Parts): void => {
  parts.carbon.push(at(box(1.5, 0.08, 2.9), 0, 0.22, 0));
  // Nose fairing and side pods.
  parts.paint.push(at(rbox(1.3, 0.34, 0.7, 0.12), 0, 0.42, 1.45, -0.25));
  parts.trim.push(at(box(0.55, 0.36, 0.05), 0, 0.62, 1.82, -0.25));
  for (const side of [-1, 1]) {
    parts.paint.push(at(rbox(0.32, 0.34, 1.2, 0.1), side * 0.82, 0.38, -0.05));
    parts.trim.push(at(box(0.05, 0.1, 1.0), side * 0.99, 0.44, -0.05));
  }
  // Bumper hoops, front and back.
  tube(parts.chrome, v(-0.95, 0.32, 1.9), v(0.95, 0.32, 1.9), 0.06);
  tube(parts.chrome, v(-0.95, 0.38, -1.5), v(0.95, 0.38, -1.5), 0.06);
  for (const side of [-1, 1]) {
    tube(parts.chrome, v(side * 0.95, 0.32, 1.9), v(side * 0.6, 0.25, 1.35), 0.05);
    tube(parts.chrome, v(side * 0.95, 0.38, -1.5), v(side * 0.6, 0.25, -1.1), 0.05);
  }
  // Bucket seat, steering column and wheel.
  parts.carbon.push(at(rbox(0.72, 0.75, 0.22, 0.1), 0, 0.72, -0.62, -0.35));
  parts.carbon.push(at(rbox(0.72, 0.18, 0.6, 0.06), 0, 0.36, -0.35));
  tube(parts.chrome, v(0, 0.3, 1.2), v(0, 0.9, 0.55), 0.04);
  parts.carbon.push(at(new THREE.TorusGeometry(0.22, 0.04, 6, 16), 0, 0.92, 0.5, -0.9));
  // The engine hangs off the right side with its exhaust.
  parts.chrome.push(at(rbox(0.42, 0.42, 0.5, 0.06), 0.62, 0.55, -0.95));
  parts.carbon.push(at(cyl(0.12, 0.12, 0.2), 0.62, 0.85, -0.95));
  tube(parts.chrome, v(0.62, 0.45, -1.2), v(0.3, 0.4, -1.75), 0.06);
  parts.glow.push(at(new THREE.CircleGeometry(0.05, 8), 0.3, 0.4, -1.78, 0, Math.PI));
  parts.tail.push(at(box(0.5, 0.05, 0.03), -0.35, 0.42, -1.53));
  for (const [x, z, w] of [[-1, 1.1, 0.34], [1, 1.1, 0.34], [-1, -1.05, 0.46], [1, -1.05, 0.46]] as const) {
    wheel(parts, x * 0.98, z, 0.33, w);
  }
};

/** A bubble trike: one wheel in front, two behind, an antenna flag. */
const buildTrike = (parts: Parts): void => {
  // Open-topped egg tub: the driver pokes out of it.
  const egg = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68);
  egg.scale(0.82, 0.7, 1.45);
  parts.paint.push(at(egg, 0, 0.82, 0.15));
  parts.trim.push(at(new THREE.TorusGeometry(1, 0.05, 6, 28).scale(0.72, 1.28, 1), 0, 1.18, 0.2, Math.PI / 2));
  // Windscreen arc.
  const screen = new THREE.SphereGeometry(0.62, 16, 8, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.18, Math.PI * 0.25);
  parts.carbon.push(at(screen, 0, 1.05, 0.45));
  // Front fork, fender and wheel.
  tube(parts.chrome, v(-0.16, 0.42, 1.65), v(-0.12, 1.0, 1.2), 0.045);
  tube(parts.chrome, v(0.16, 0.42, 1.65), v(0.12, 1.0, 1.2), 0.045);
  parts.trim.push(at(new THREE.TorusGeometry(0.5, 0.08, 6, 14, Math.PI), 0, 0.45, 1.65, 0, Math.PI / 2));
  wheel(parts, 0, 1.65, 0.4, 0.28);
  // Rear wheels on outriggers with fenders.
  for (const side of [-1, 1]) {
    tube(parts.carbon, v(side * 0.4, 0.5, -0.85), v(side * 0.78, 0.46, -0.85), 0.06);
    parts.trim.push(at(new THREE.TorusGeometry(0.52, 0.07, 6, 12, Math.PI), side * 0.86, 0.46, -0.85, 0, Math.PI / 2));
    wheel(parts, side * 0.86, -0.85, 0.44, 0.3);
  }
  // Antenna with a glowing ball, and a tail fin.
  tube(parts.chrome, v(-0.45, 0.9, -0.9), v(-0.55, 2.6, -1.1), 0.025);
  parts.glow.push(at(new THREE.SphereGeometry(0.11, 10, 8), -0.55, 2.65, -1.1));
  parts.trim.push(at(new THREE.ConeGeometry(0.16, 0.45, 3), -0.58, 2.35, -1.12, 0, 0, -Math.PI / 2));
  parts.paint.push(at(box(0.06, 0.5, 0.6), 0, 1.1, -1.05, 0.3));
  parts.head.push(at(new THREE.CircleGeometry(0.13, 12), 0, 0.85, 1.48));
  parts.tail.push(at(box(0.6, 0.05, 0.03), 0, 0.72, -1.2));
};

/** Rally hatch: boxy shell, flared arches, light pod, a big wing, mud flaps. */
const buildRally = (parts: Parts): void => {
  const W = 1.9;
  // Lower shell and bonnet.
  parts.paint.push(at(rbox(W, 0.62, 3.7, 0.16), 0, 0.68, 0));
  parts.paint.push(at(rbox(W * 0.96, 0.3, 1.2, 0.12), 0, 1.05, 1.15, 0.12));
  parts.trim.push(at(box(0.5, 0.06, 0.5), 0, 1.22, 1.2, 0.12));
  // Targa cabin: windscreen, roll hoop and rear deck. Open, so the driver shows.
  parts.carbon.push(at(box(W * 0.86, 0.5, 0.06), 0, 1.38, 0.45, -0.55));
  tube(parts.chrome, v(-0.82, 1.0, -0.75), v(-0.7, 1.75, -0.7), 0.06);
  tube(parts.chrome, v(0.82, 1.0, -0.75), v(0.7, 1.75, -0.7), 0.06);
  tube(parts.chrome, v(-0.7, 1.75, -0.7), v(0.7, 1.75, -0.7), 0.06);
  tube(parts.chrome, v(-0.7, 1.75, -0.7), v(-0.85, 1.05, 0.4), 0.05);
  tube(parts.chrome, v(0.7, 1.75, -0.7), v(0.85, 1.05, 0.4), 0.05);
  parts.paint.push(at(rbox(W * 0.94, 0.42, 1.1, 0.12), 0, 1.15, -1.25));
  // Flared arches and side skirts.
  for (const side of [-1, 1]) {
    for (const z of [1.2, -1.15]) parts.trim.push(at(rbox(0.32, 0.46, 1.25, 0.12), side * (W / 2 + 0.06), 0.82, z));
    parts.carbon.push(at(box(0.08, 0.16, 1.2), side * (W / 2 + 0.02), 0.42, 0.02));
    // Door roundel.
    parts.trim.push(at(cyl(0.26, 0.26, 0.04, 16), side * (W / 2 + 0.01), 0.75, 0.05, 0, 0, Math.PI / 2));
    // Mud flaps.
    parts.carbon.push(at(box(0.4, 0.42, 0.04), side * 0.75, 0.38, -1.85));
  }
  // Light pod on the bonnet: four big lamps.
  parts.carbon.push(at(box(1.3, 0.12, 0.12), 0, 1.3, 1.75));
  for (let i = 0; i < 4; i++) parts.head.push(at(new THREE.CircleGeometry(0.13, 14), -0.48 + i * 0.32, 1.3, 1.82));
  // Big wing on the rear deck.
  parts.trim.push(at(box(W * 1.05, 0.08, 0.5), 0, 1.75, -1.6, 0.15));
  for (const side of [-1, 1]) parts.carbon.push(at(box(0.06, 0.4, 0.4), side * 0.55, 1.5, -1.55));
  parts.chrome.push(at(cyl(0.11, 0.11, 0.3), 0.55, 0.42, -1.95, Math.PI / 2));
  parts.glow.push(at(new THREE.CircleGeometry(0.08, 10), 0.55, 0.42, -2.11, 0, Math.PI));
  parts.tail.push(at(box(W * 0.8, 0.07, 0.03), 0, 0.98, -1.86));
  lights(parts, 1.86, 0.78, 0.62, 0.36);
  for (const [x, z] of [[-1, 1.2], [1, 1.2], [-1, -1.15], [1, -1.15]] as const) wheel(parts, x * 0.92, z, 0.46, 0.42);
};

/** Monster truck: a pickup on stilts with a roll cage and enormous tires. */
const buildMonster = (parts: Parts): void => {
  const lift = 1.05;
  // Frame and suspension.
  for (const side of [-1, 1]) parts.carbon.push(at(box(0.16, 0.18, 3.6), side * 0.55, lift + 0.05, 0));
  for (const z of [1.35, -1.35]) {
    parts.carbon.push(at(box(2.1, 0.14, 0.18), 0, 0.95, z));
    for (const side of [-1, 1]) {
      tube(parts.chrome, v(side * 0.5, lift + 0.1, z + 0.3), v(side * 1.0, 0.95, z), 0.07);
      tube(parts.chrome, v(side * 0.5, lift + 0.1, z - 0.3), v(side * 1.0, 0.95, z), 0.07);
    }
  }
  // Pickup body: bonnet, open cab, bed.
  parts.paint.push(at(rbox(2.0, 0.6, 1.4, 0.14), 0, lift + 0.55, 1.1));
  parts.trim.push(at(box(1.0, 0.18, 0.6), 0, lift + 0.92, 1.15));
  parts.carbon.push(at(box(1.4, 0.4, 0.06), 0, lift + 0.6, 1.82));
  parts.paint.push(at(rbox(2.0, 0.55, 1.1, 0.1), 0, lift + 0.5, 0.0));
  parts.paint.push(at(rbox(2.0, 0.6, 1.4, 0.1), 0, lift + 0.55, -1.25));
  parts.carbon.push(at(box(1.7, 0.1, 1.2), 0, lift + 0.82, -1.25));
  // Roll cage over the cab, with a light bar.
  for (const [x, z] of [[-0.85, 0.5], [0.85, 0.5], [-0.85, -0.5], [0.85, -0.5]] as const) {
    tube(parts.chrome, v(x, lift + 0.7, z), v(x * 0.92, lift + 1.75, z * 0.85), 0.06);
  }
  tube(parts.chrome, v(-0.78, lift + 1.75, 0.42), v(0.78, lift + 1.75, 0.42), 0.06);
  tube(parts.chrome, v(-0.78, lift + 1.75, -0.42), v(0.78, lift + 1.75, -0.42), 0.06);
  tube(parts.chrome, v(-0.78, lift + 1.75, 0.42), v(-0.78, lift + 1.75, -0.42), 0.06);
  tube(parts.chrome, v(0.78, lift + 1.75, 0.42), v(0.78, lift + 1.75, -0.42), 0.06);
  parts.carbon.push(at(box(1.5, 0.12, 0.14), 0, lift + 1.85, 0.42));
  for (let i = 0; i < 4; i++) parts.head.push(at(new THREE.CircleGeometry(0.11, 12), -0.54 + i * 0.36, lift + 1.85, 0.5));
  // Stacks behind the cab.
  for (const side of [-1, 1]) {
    parts.chrome.push(at(cyl(0.1, 0.1, 1.1), side * 0.7, lift + 1.15, -0.62));
    parts.glow.push(at(new THREE.CircleGeometry(0.08, 10), side * 0.7, lift + 1.71, -0.62, -Math.PI / 2));
  }
  lights(parts, 1.82, lift + 0.55, 0.65, 0.36);
  parts.tail.push(at(box(1.6, 0.08, 0.03), 0, lift + 0.6, -1.96));
  for (const [x, z] of [[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]] as const) {
    wheel(parts, x * 1.28, z, 0.95, 0.75, 0.95, 6);
    treads(parts, x * 1.28, z, 0.95, 0.75);
  }
};

/** Hovercraft: a hull on a rubber skirt, twin ducted fans, no wheels at all. */
const buildHover = (parts: Parts): void => {
  const hull = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.5);
  hull.scale(1.05, 0.55, 1.8);
  parts.paint.push(at(hull, 0, 0.78, 0.1));
  parts.trim.push(at(rbox(1.5, 0.12, 2.4, 0.06), 0, 1.08, 0.1));
  // Skirt and the glow it rides on.
  parts.tire.push(at(new THREE.TorusGeometry(1, 0.26, 8, 32).scale(1.05, 1.8, 1), 0, 0.42, 0.1, Math.PI / 2));
  parts.glow.push(at(new THREE.TorusGeometry(1, 0.06, 6, 32).scale(1.1, 1.85, 1), 0, 0.2, 0.1, Math.PI / 2));
  // Cockpit rim and windscreen.
  parts.carbon.push(at(new THREE.TorusGeometry(0.55, 0.07, 6, 18).scale(1, 1.3, 1), 0, 1.15, 0.05, Math.PI / 2));
  parts.carbon.push(at(box(1.0, 0.36, 0.05), 0, 1.3, 0.75, -0.6));
  // Twin ducted fans with tail fins.
  for (const side of [-1, 1]) {
    const x = side * 0.62;
    parts.trim.push(at(new THREE.TorusGeometry(0.5, 0.11, 8, 24), x, 1.35, -1.55));
    parts.carbon.push(at(cyl(0.12, 0.12, 0.3), x, 1.35, -1.55, Math.PI / 2));
    for (let b = 0; b < 5; b++) parts.carbon.push(at(box(0.08, 0.42, 0.04), x, 1.35, -1.55, 0, 0, (b / 5) * Math.PI));
    parts.glow.push(at(new THREE.CircleGeometry(0.4, 18), x, 1.35, -1.68, 0, Math.PI));
    parts.paint.push(at(box(0.06, 0.7, 0.55), x, 2.0, -1.65, 0.2));
    tube(parts.carbon, v(x, 1.0, -1.1), v(x, 1.2, -1.45), 0.06);
  }
  // Glow strips along the flanks and a nose light.
  for (const side of [-1, 1]) parts.glow.push(at(box(0.04, 0.06, 2.2), side * 1.04, 0.8, 0.2));
  parts.head.push(at(rbox(0.7, 0.07, 0.06, 0.02), 0, 0.8, 1.9));
  parts.tail.push(at(box(0.9, 0.06, 0.03), 0, 0.95, -1.7));
};

const BUILDERS: Record<ChassisKind, (parts: Parts) => void> = {
  racer: buildRacer, dragster: buildDragster, kart: buildGoKart, trike: buildTrike,
  rally: buildRally, monster: buildMonster, hover: buildHover,
};

const buildParts = (modelId: string): Map<Part, THREE.BufferGeometry> => {
  const parts = emptyParts();
  BUILDERS[chassisOf(modelId)](parts);
  const grouped = new Map<Part, THREE.BufferGeometry[]>();
  for (const [part, list] of Object.entries(parts) as Array<[BuildPart, THREE.BufferGeometry[]]>) {
    const target = MERGE_INTO[part];
    const light = LIGHT_COLOR[part];
    for (const g of list) {
      if (light) {
        const colors = new Float32Array(g.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) colors.set([light.r, light.g, light.b], i);
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      let bucket = grouped.get(target);
      if (!bucket) grouped.set(target, (bucket = []));
      bucket.push(g);
    }
  }
  const merged = new Map<Part, THREE.BufferGeometry>();
  for (const [part, list] of grouped) {
    const g = mergeGeometries(list, false);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    merged.set(part, g);
    for (const x of list) x.dispose();
  }
  return merged;
};

export const kartGeometry = (modelId: string): Map<Part, THREE.BufferGeometry> => {
  let parts = geometryCache.get(modelId);
  if (!parts) {
    parts = buildParts(modelId);
    geometryCache.set(modelId, parts);
  }
  return parts;
};

const materialCache = new Map<string, THREE.Material>();
const cached = <T extends THREE.Material>(key: string, make: () => T): T => {
  let m = materialCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
};

export const paintMaterial = (color: number) =>
  cached(`paint:${color}`, () => new THREE.MeshPhysicalMaterial({
    color, metalness: 0.05, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: color, emissiveIntensity: 0.12,
  }));

const fixed: Record<Exclude<Part, "paint" | "trim">, () => THREE.Material> = {
  dark: () => new THREE.MeshStandardMaterial({ color: 0x18191e, roughness: 0.6, metalness: 0.3 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.14, metalness: 1 }),
  glow: () => new THREE.MeshBasicMaterial({ color: 0x3de0ff }),
  lights: () => new THREE.MeshBasicMaterial({ vertexColors: true }),
};

export const partMaterial = (part: Part, primary: number, secondary: number): THREE.Material => {
  if (part === "paint") return paintMaterial(primary);
  if (part === "trim") return paintMaterial(secondary);
  return cached(part, fixed[part]);
};

/* ---------------- driver ---------------- */

const driverGeo = {
  torso: new RoundedBoxGeometry(0.74, 0.56, 0.5, 2, 0.14),
  arm: new THREE.CapsuleGeometry(0.11, 0.5, 3, 8).rotateX(Math.PI / 2.6),
  head: new THREE.SphereGeometry(0.34, 18, 14),
  hair: new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1),
  bob: new THREE.SphereGeometry(0.38, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.45),
  glasses: new THREE.BoxGeometry(0.46, 0.09, 0.08),
};

const DRIVER_HAIR: Record<string, "cap" | "bob" | "bald" | "volume"> = {
  dario: "volume", elon: "cap", sam: "cap", sundar: "cap", mark: "cap", satya: "bald",
  lisa: "bob", mira: "bob", jensen: "volume", demis: "cap",
};

const driverCache = new Map<string, THREE.BufferGeometry>();
const driverMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });

const tinted = (geo: THREE.BufferGeometry, color: number, matrix: THREE.Matrix4): THREE.BufferGeometry => {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
  g.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
};

/** The driver as one vertex-colored mesh: one draw call, shared per character. */
export const buildDriver = (characterId: string): THREE.Mesh => {
  const c: Character = CHARACTERS.find((x) => x.id === characterId) ?? CHARACTERS[0];
  let geometry = driverCache.get(c.id);
  if (!geometry) {
    const m = new THREE.Matrix4();
    const parts: THREE.BufferGeometry[] = [
      tinted(driverGeo.torso, c.outfit, m.makeTranslation(0, 0.98, -0.18)),
      tinted(driverGeo.head, c.skin, m.makeTranslation(0, 1.5, -0.12)),
      ...[-1, 1].map((side) => tinted(driverGeo.arm, c.outfit, new THREE.Matrix4().makeTranslation(side * 0.36, 0.98, 0.18))),
    ];
    const style = DRIVER_HAIR[c.id] ?? "cap";
    if (style !== "bald") {
      const hm = new THREE.Matrix4().makeTranslation(0, style === "bob" ? 1.5 : 1.54, -0.15);
      if (style === "volume") hm.multiply(new THREE.Matrix4().makeScale(1.12, 1.25, 1.1));
      parts.push(tinted(style === "bob" ? driverGeo.bob : driverGeo.hair, c.hair, hm));
    }
    if (c.id === "satya" || c.id === "dario" || c.id === "mark") {
      parts.push(tinted(driverGeo.glasses, 0x111111, new THREE.Matrix4().makeTranslation(0, 1.53, 0.2)));
    }
    geometry = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    driverCache.set(c.id, geometry);
  }
  const mesh = new THREE.Mesh(geometry, driverMaterial);
  mesh.scale.setScalar(0.88);
  mesh.position.y = -0.08;
  return mesh;
};

export const defaultPaint = (kartId: string): { primary: number; secondary: number } => {
  const model = KARTS.find((k) => k.id === kartId) ?? KARTS[0];
  return { primary: model.color, secondary: model.accent };
};
