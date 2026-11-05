import { KARTS } from "@dario-kart/sim";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural kart bodies. Every model shares one construction kit (sculpted
 * tub, pods, wings, exhausts) with different proportions, so each reads
 * differently at a glance. Parts are merged per material: one draw call per
 * material per kart, and geometry is shared between karts of the same model.
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

const SHAPES: Record<string, Shape> = {
  claude: { length: 1, width: 1, bevel: 0.14, noseDrop: 0.1, hump: 0.2, wing: "duck", exhausts: 2, pods: "slim", fin: false, wheel: 0.44, splitter: 0.9 },
  grok: { length: 1.08, width: 1.02, bevel: 0.03, noseDrop: 0.18, hump: 0.32, wing: "tall", exhausts: 4, pods: "wide", fin: false, wheel: 0.46, splitter: 1.15 },
  gippity: { length: 1.04, width: 0.98, bevel: 0.08, noseDrop: 0.14, hump: 0.24, wing: "low", exhausts: 2, pods: "slim", fin: false, wheel: 0.44, splitter: 1 },
  qwen: { length: 0.88, width: 0.94, bevel: 0.12, noseDrop: 0.06, hump: 0.16, wing: "duck", exhausts: 1, pods: "slim", fin: false, wheel: 0.4, splitter: 0.8 },
  fable: { length: 1.14, width: 0.96, bevel: 0.1, noseDrop: 0.2, hump: 0.28, wing: "low", exhausts: 2, pods: "slim", fin: true, wheel: 0.44, splitter: 1.05 },
  astra: { length: 1.02, width: 1.16, bevel: 0.06, noseDrop: 0.02, hump: 0.3, wing: "low", exhausts: 2, pods: "armored", fin: false, wheel: 0.52, splitter: 1.2 },
  gemini: { length: 1.06, width: 1.04, bevel: 0.08, noseDrop: 0.14, hump: 0.22, wing: "twin", exhausts: 4, pods: "twin", fin: true, wheel: 0.45, splitter: 1 },
};

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
    bevelSegments: 5,
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
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.1 + Math.sin(a) * 0.1, -w + (i / 12) * width));
  }
  pts.unshift(new THREE.Vector2(r * 0.62, -w));
  pts.push(new THREE.Vector2(r * 0.62, w));
  return new THREE.LatheGeometry(pts, 32).rotateZ(Math.PI / 2);
};

const buildParts = (modelId: string): Map<Part, THREE.BufferGeometry> => {
  const recipe = SHAPES[modelId] ?? SHAPES.gippity;
  // Compact toy-racer proportions, soft bodywork and round, oversize tires.
  const shape = { ...recipe, length: recipe.length * .88, bevel: Math.max(.16, recipe.bevel), wheel: recipe.wheel * 1.08 };
  const W = 1.34 * shape.width;
  const L = shape.length;
  const parts: Record<BuildPart, THREE.BufferGeometry[]> = {
    paint: [], trim: [], carbon: [], chrome: [], tire: [], glow: [], head: [], tail: [],
  };

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
      parts.trim.push(at(new RoundedBoxGeometry(0.42, 0.42, 1.5 * L, 4, 0.15), x, 0.46, 0.05));
      parts.carbon.push(at(new THREE.BoxGeometry(0.06, 0.3, 1.3 * L), x + side * 0.22, 0.46, 0.05));
    } else if (shape.pods === "twin") {
      parts.trim.push(at(new THREE.CapsuleGeometry(0.2, 1.25 * L, 4, 10), x, 0.5, -0.05, Math.PI / 2));
      parts.glow.push(at(new THREE.CircleGeometry(0.14, 12), x, 0.5, -0.05 - 0.83 * L, 0, Math.PI));
    } else {
      const wide = shape.pods === "wide" ? 0.44 : 0.34;
      parts.trim.push(at(new RoundedBoxGeometry(wide, 0.34, 1.35 * L, 4, 0.14), x, 0.44, 0.05));
      parts.carbon.push(at(new THREE.BoxGeometry(wide * 0.7, 0.16, 0.08), x, 0.5, 0.05 + 0.69 * L));
    }
    parts.paint.push(at(new THREE.BoxGeometry(0.05, 0.06, 1.2 * L), x + side * (shape.pods === "wide" ? 0.23 : 0.18), 0.56, 0.05));
  }

  // Front splitter + wing with endplates.
  const fw = 2.1 * shape.splitter;
  parts.carbon.push(at(new RoundedBoxGeometry(fw, 0.09, 0.42, 3, 0.045), 0, 0.2, 1.95 * L));
  parts.trim.push(at(new RoundedBoxGeometry(fw * 0.96, 0.09, 0.2, 3, 0.045), 0, 0.29, 2.02 * L, -0.25));
  for (const side of [-1, 1]) parts.trim.push(at(new RoundedBoxGeometry(0.09, 0.22, 0.5, 3, 0.045), side * fw / 2, 0.28, 1.95 * L));

  // Rear wing.
  const rz = -1.32 * L;
  const wing = (y: number, span: number, chord: number, x = 0) => {
    parts.trim.push(at(new RoundedBoxGeometry(span, 0.12, chord, 3, 0.055), x, y, rz, 0.12));
    for (const side of [-1, 1]) {
      parts.carbon.push(at(new RoundedBoxGeometry(0.09, 0.36, chord + 0.12, 3, 0.04), x + side * span / 2, y - 0.08, rz));
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
    parts.trim.push(at(new RoundedBoxGeometry(W * 0.95, 0.14, 0.34, 3, 0.06), 0, 0.92 + shape.hump * 0.8, rz + 0.05, -0.35));
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

  // Wheels: rounded tires, chrome rims, painted hub.
  const r = shape.wheel;
  const tireGeo = tire(r, 0.42);
  for (const [x, z] of [[-1, 1.15 * L], [1, 1.15 * L], [-1, -0.95 * L], [1, -0.95 * L]] as const) {
    const wx = x * (W / 2 + 0.36);
    parts.tire.push(at(tireGeo.clone(), wx, r, z));
    parts.chrome.push(at(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.44, 18), wx, r, z, 0, 0, Math.PI / 2));
    for (let spoke = 0; spoke < 5; spoke++) {
      const a = (spoke / 5) * Math.PI * 2;
      parts.carbon.push(at(new THREE.BoxGeometry(0.47, r * 0.5, 0.07), wx, r + Math.sin(a) * r * 0.3, z + Math.cos(a) * r * 0.3, a));
    }
    parts.trim.push(at(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.46, 10), wx, r, z, 0, 0, Math.PI / 2));
  }
  tireGeo.dispose();

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
    // Preserve the source normals: recomputing after de-indexing makes rounded parts faceted.
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
  dark: () => new THREE.MeshStandardMaterial({ color: 0x202232, roughness: 0.8, metalness: 0.1 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.14, metalness: 1 }),
  glow: () => new THREE.MeshBasicMaterial({ color: 0x3de0ff }),
  lights: () => new THREE.MeshBasicMaterial({ vertexColors: true }),
};

export const partMaterial = (part: Part, primary: number, secondary: number): THREE.Material => {
  if (part === "paint") return paintMaterial(primary);
  if (part === "trim") return paintMaterial(secondary);
  return cached(part, fixed[part]);
};

export const defaultPaint = (kartId: string): { primary: number; secondary: number } => {
  const model = KARTS.find((k) => k.id === kartId) ?? KARTS[0];
  return { primary: model.color, secondary: model.accent };
};
