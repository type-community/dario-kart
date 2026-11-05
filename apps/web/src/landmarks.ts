import { KARTS, type Track, type TrackTheme } from "@dario-kart/sim";
import * as THREE from "three";
import { canvasTexture, hex, placeOnTrack, trackPoint } from "./scene.ts";

/**
 * What makes each city look like itself: time of day, how the blocks sit
 * around the road, and a few landmarks. The sim decides how a track drives;
 * this only decides how it looks.
 */
export interface ThemeLook {
  readonly fog: readonly [number, number];
  readonly hemiSky: number;
  readonly hemi: number;
  readonly ambient: number;
  readonly sun: number;
  readonly sunColor: number;
  readonly sunAt: readonly [number, number, number];
  /** Building faces: lit windows at night, daytime windows, or plain machine panels. */
  readonly windows: "lit" | "day" | "panels";
  /** Walls and windows glow. */
  readonly glow: boolean;
  /** How far buildings scatter from the road: small makes a canyon. */
  readonly spread: number;
  /** Buildings per meter of track. */
  readonly density: number;
}

export const THEME_LOOKS: Record<TrackTheme["id"], ThemeLook> = {
  sf: {
    fog: [90, 900], hemiSky: 0xcfe3f5, hemi: 1.2, ambient: 0.35, sun: 2.3, sunColor: 0xfff0d8, sunAt: [300, 420, 200],
    windows: "day", glow: false, spread: 190, density: 1 / 5,
  },
  nyc: {
    fog: [120, 820], hemiSky: 0x7f8fd0, hemi: 0.9, ambient: 0.4, sun: 1.5, sunColor: 0xffa26b, sunAt: [600, 140, 120],
    windows: "lit", glow: false, spread: 45, density: 1 / 3.2,
  },
  fab: {
    fog: [140, 760], hemiSky: 0xf4f8ff, hemi: 1.5, ambient: 0.75, sun: 0.9, sunColor: 0xffffff, sunAt: [0, 600, 40],
    windows: "panels", glow: false, spread: 140, density: 1 / 6,
  },
  shenzhen: {
    fog: [160, 750], hemiSky: 0x8fa8ff, hemi: 1.1, ambient: 0.6, sun: 1.2, sunColor: 0xffffff, sunAt: [300, 500, 200],
    windows: "lit", glow: true, spread: 120, density: 1 / 5,
  },
  beijing: {
    fog: [80, 760], hemiSky: 0xf2dcb5, hemi: 1.2, ambient: 0.4, sun: 2, sunColor: 0xffd9a0, sunAt: [-300, 380, 250],
    windows: "day", glow: false, spread: 200, density: 1 / 6,
  },
};

export interface PlacedBuilding {
  x: number;
  z: number;
  /** Footprint along the building's local X and Z, and its height. */
  w: number;
  d: number;
  h: number;
  /** Rotation about Y. */
  rot: number;
}

export interface DecorKit {
  readonly group: THREE.Group;
  /** Static geometry in world space, merged per material by the caller. */
  add(geometry: THREE.BufferGeometry, material: THREE.Material): void;
  keep<T extends { dispose(): void }>(x: T): T;
}

export interface ThemeDecor {
  /** Ground the landmarks need; ordinary buildings stay out of these circles. */
  readonly reserved: ReadonlyArray<{ x: number; z: number; r: number }>;
  build(buildings: ReadonlyArray<PlacedBuilding>, kit: DecorKit): void;
}

const up = new THREE.Vector3(0, 1, 0);

/** A box in world space, standing on y = `base`, rotated `rot` about Y. */
const boxAt = (w: number, h: number, d: number, x: number, base: number, z: number, rot = 0): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d).rotateY(rot).translate(x, base + h / 2, z);

/** A square pyramid roof: base `w` × `d` at y = `base`, `h` tall. */
const pyramidAt = (w: number, h: number, d: number, x: number, base: number, z: number, rot = 0): THREE.BufferGeometry =>
  new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0).scale(w, h, d).rotateY(rot).translate(x, base, z);

/** Unit gable roof: ridge along X, base 1 × 1 at y = 0, 1 tall. */
const gableGeometry = (): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1);
  g.rotateZ(Math.PI / 2); // axis along X
  g.rotateX(Math.PI / 2 + Math.PI / 6); // a vertex straight up
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(0, -b.min.y, 0);
  g.scale(1, 1 / (b.max.y - b.min.y), 1 / (b.max.z - b.min.z));
  return g;
};

const unitPyramid = (): THREE.BufferGeometry =>
  new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);

/** Geometry built in a track-aligned local frame (+Z along the road, +Y up), moved into the world. */
const onTrack = (track: Track, s: number, d: number, h: number, heading: number) => {
  const frame = new THREE.Object3D();
  placeOnTrack(track, s, d, h, heading, frame);
  frame.updateMatrixWorld();
  return (g: THREE.BufferGeometry) => g.applyMatrix4(frame.matrixWorld);
};

const seeded = (seed: number) => {
  let r = seed | 0;
  return () => {
    r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x6d2b79f5) | 0;
    return ((r >>> 0) % 100000) / 100000;
  };
};

const sampleIndex = (track: Track, s: number) => ((Math.round(s / track.step) % track.count) + track.count) % track.count;

/** Distance from (x, z) to the nearest bit of road centerline. */
const roadDistance = (track: Track, x: number, z: number) => {
  let best = Infinity;
  for (let k = 0; k < track.count; k += 3) best = Math.min(best, Math.hypot(track.px[k] - x, track.pz[k] - z));
  return best;
};

/** A spot `offset` meters to one side of the road at `s`, with room for something `radius` wide. */
const spotBeside = (track: Track, rand: () => number, minOffset: number, maxOffset: number, radius: number) => {
  for (let tries = 0; tries < 300; tries++) {
    const s = rand() * track.length;
    const k = sampleIndex(track, s);
    const yaw = Math.atan2(track.tz[k], track.tx[k]);
    const side = rand() < 0.5 ? -1 : 1;
    const offset = minOffset + rand() * (maxOffset - minOffset);
    const x = track.px[k] - Math.sin(yaw) * side * offset;
    const z = track.pz[k] + Math.cos(yaw) * side * offset;
    if (roadDistance(track, x, z) > radius + track.halfWidth + 12) return { x, z, s };
  }
  return null;
};

/** The middle of the straightest `span` meters of road that isn't a loop or the start, if any is straight enough. */
const straightestStretch = (track: Track, span: number): number | null => {
  let best: number | null = null;
  let bestK = 0.012;
  for (let s = 80 + span / 2; s < track.length - 50 - span / 2; s += 8) {
    let k = 0;
    for (let o = -span / 2; o <= span / 2 && k < bestK; o += track.step) {
      const i = sampleIndex(track, s + o);
      k = track.loop[i] ? Infinity : Math.max(k, Math.abs(track.curvature[i]));
    }
    if (k < bestK) {
      bestK = k;
      best = s;
    }
  }
  return best;
};

/** Evenly spread straight-ish spots for things that span the road. */
const spanSites = (track: Track, count: number): number[] => {
  const sites: number[] = [];
  for (let i = 0; i < count; i++) {
    const target = ((i + 0.5) / count) * track.length;
    let best = -1;
    let bestK = Infinity;
    for (let o = -80; o <= 80; o += 4) {
      const s = target + o;
      if (s < 40 || s > track.length - 30) continue;
      let k = 0;
      let loop = false;
      for (let w = -14; w <= 14; w += 2) {
        const j = sampleIndex(track, s + w);
        k = Math.max(k, Math.abs(track.curvature[j]));
        loop ||= track.loop[j] === 1;
      }
      if (!loop && k < bestK) {
        bestK = k;
        best = s;
      }
    }
    if (best >= 0 && bestK < 0.02) sites.push(best);
  }
  return sites;
};

const adTexture = (text: string, bg: number, fg: number, font: string) =>
  canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = hex(bg);
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = hex(fg);
    ctx.fillRect(0, 108, 256, 20);
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 128, 56);
  });

/** Free-standing billboards beside the road, facing oncoming karts. */
const billboards = (
  track: Track, kit: DecorKit, rand: () => number, count: number, textures: THREE.Texture[], postMat: THREE.Material,
) => {
  const edge = track.halfWidth + 1.6;
  for (let i = 0; i < count; i++) {
    const s = ((i + rand() * 0.6) / count) * track.length;
    const j = sampleIndex(track, s);
    if (track.loop[j] || track.uy[j] < 0.85) continue;
    const side = rand() < 0.5 ? -1 : 1;
    const d = side * (edge + 7);
    const mat = kit.keep(new THREE.MeshBasicMaterial({ map: textures[i % textures.length], side: THREE.DoubleSide, fog: true }));
    const board = new THREE.Mesh(kit.keep(new THREE.PlaneGeometry(18, 9)), mat);
    // Face back down the road, angled a little toward the racing line.
    placeOnTrack(track, s, d, 9, Math.PI + side * 0.35, board);
    board.updateMatrix();
    board.matrixAutoUpdate = false;
    kit.group.add(board);
    const foot = trackPoint(track, s, d, 0, new THREE.Vector3());
    kit.add(boxAt(0.9, foot.y + 5, 0.9, foot.x, 0, foot.z), postMat);
  }
};

/** Neon signs with Chinese characters for Shenzhen. */
const neonSign = (text: string, color: string) =>
  canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = "#0b0614";
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.font = "900 84px 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 68);
  });

const waferTexture = () =>
  canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 256);
    ctx.save();
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.clip();
    for (let y = 0; y < 256; y += 14) {
      for (let x = 0; x < 256; x += 14) {
        const hue = (x + y * 0.6) % 360;
        ctx.fillStyle = `hsl(${hue}, 70%, ${55 + ((x * y) % 20)}%)`;
        ctx.fillRect(x + 1, y + 1, 12, 12);
      }
    }
    ctx.restore();
    ctx.strokeStyle = "#d9dde4";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.stroke();
  });

const ceilingTexture = () =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#9aa3b2";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(8, 8, 112, 46);
    ctx.fillRect(8, 74, 112, 46);
  });

/* ---------------- per theme ---------------- */

const sanFrancisco = (track: Track): ThemeDecor => {
  const rand = seeded(track.seed ^ 0x51f);
  const pyramid = spotBeside(track, rand, 70, 170, 18);
  return {
    reserved: pyramid ? [{ ...pyramid, r: 26 }] : [],
    build(buildings, kit) {
      // Painted Ladies: every house gets a pitched roof.
      const roofs = new THREE.InstancedMesh(
        kit.keep(gableGeometry()), kit.keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })), Math.max(1, buildings.length),
      );
      const ROOF_COLORS = [0x4a4f5c, 0x9c5a46, 0x5f6b7d, 0x7d4b52];
      const roofColor = new THREE.Color();
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      buildings.forEach((b, i) => {
        q.setFromAxisAngle(up, b.rot);
        m.compose(new THREE.Vector3(b.x, b.h, b.z), q, new THREE.Vector3(b.w * 1.06, Math.min(b.w, b.d) * 0.35, b.d * 1.06));
        roofs.setMatrixAt(i, m);
        roofs.setColorAt(i, roofColor.setHex(ROOF_COLORS[i % ROOF_COLORS.length]));
      });
      roofs.count = buildings.length;
      kit.group.add(roofs);

      // The bridge: two International Orange towers straddling the longest straight, cables sagging between.
      const mid = straightestStretch(track, 130);
      if (mid !== null) {
        const orange = kit.keep(new THREE.MeshStandardMaterial({ color: 0xc0362c, roughness: 0.55, metalness: 0.2 }));
        const cableMat = kit.keep(new THREE.MeshStandardMaterial({ color: 0xa82f26, roughness: 0.5 }));
        const half = 55;
        const top = 46;
        const lateral = track.halfWidth + 4.5;
        const foot = new THREE.Vector3();
        const head = new THREE.Vector3();
        for (const t of [-half, half]) {
          for (const side of [-1, 1]) {
            trackPoint(track, mid + t, side * lateral, top, head);
            kit.add(boxAt(2.6, head.y, 2.6, head.x, 0, head.z), orange);
          }
          for (const h of [14, 30, top - 1]) {
            const place = onTrack(track, mid + t, 0, h, 0);
            kit.add(place(new THREE.BoxGeometry(lateral * 2 + 2.6, 2.2, 2.2)), orange);
          }
        }
        for (const side of [-1, 1]) {
          const points: THREE.Vector3[] = [];
          for (let t = -half - 45; t <= half + 45; t += 5) {
            const a = Math.abs(t);
            const h = a <= half ? 5 + (top - 5) * (a / half) ** 2 : top * Math.max(0.03, 1 - (a - half) / 45);
            points.push(trackPoint(track, mid + t, side * lateral, h, new THREE.Vector3()));
          }
          kit.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.45, 6, false), cableMat);
          for (let t = -half + 5; t < half; t += 5) {
            const h = 5 + (top - 5) * (Math.abs(t) / half) ** 2;
            trackPoint(track, mid + t, side * lateral, 1.3, foot);
            trackPoint(track, mid + t, side * lateral, h, head);
            kit.add(boxAt(0.18, head.y - foot.y, 0.18, foot.x, foot.y, foot.z), cableMat);
          }
        }
      }

      if (pyramid) {
        const white = kit.keep(new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.6 }));
        kit.add(pyramidAt(26, 170, 26, pyramid.x, 0, pyramid.z, rand() * Math.PI), white);
      }
    },
  };
};

const newYork = (track: Track): ThemeDecor => {
  const rand = seeded(track.seed ^ 0x4e9);
  const empire = spotBeside(track, rand, 90, 200, 26);
  return {
    reserved: empire ? [{ ...empire, r: 34 }] : [],
    build(buildings, kit) {
      // Wooden water tanks on a third of the roofs.
      const tops = buildings.filter((_, i) => i % 3 === 0);
      const tankMat = kit.keep(new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 }));
      const tanks = new THREE.InstancedMesh(kit.keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0)), tankMat, Math.max(1, tops.length));
      const caps = new THREE.InstancedMesh(kit.keep(new THREE.ConeGeometry(0.56, 0.6, 12).translate(0, 0.3, 0)), tankMat, Math.max(1, tops.length));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      tops.forEach((b, i) => {
        const r = Math.min(7, Math.min(b.w, b.d) * 0.35);
        m.compose(new THREE.Vector3(b.x, b.h + 2.5, b.z), q, new THREE.Vector3(r, r * 0.9, r));
        tanks.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(b.x, b.h + 2.5 + r * 0.9, b.z), q, new THREE.Vector3(r, r * 0.9, r));
        caps.setMatrixAt(i, m);
      });
      tanks.count = caps.count = tops.length;
      kit.group.add(tanks, caps);

      // Broadway: lit billboards for every lab's kart, facing the traffic.
      const font = "italic 900 74px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      const ads = KARTS.map((k) => kit.keep(adTexture(k.name.toUpperCase(), k.color, k.accent, font)));
      billboards(track, kit, rand, 16, ads, kit.keep(new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.7 })));

      if (empire) {
        // Setbacks up to a mast with a red light on top.
        const stone = kit.keep(new THREE.MeshStandardMaterial({ color: 0x9a9284, roughness: 0.7 }));
        const light = kit.keep(new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
        const tiers: Array<[number, number]> = [[44, 70], [34, 60], [26, 50], [16, 26], [9, 16]];
        let y = 0;
        for (const [w, h] of tiers) {
          kit.add(boxAt(w, h, w, empire.x, y, empire.z), stone);
          y += h;
        }
        kit.add(new THREE.CylinderGeometry(0.6, 1.4, 50, 8).translate(empire.x, y + 25, empire.z), stone);
        kit.add(new THREE.SphereGeometry(1.6, 10, 8).translate(empire.x, y + 51, empire.z), light);
      }
    },
  };
};

const theFab = (track: Track): ThemeDecor => {
  const rand = seeded(track.seed ^ 0xfab);
  const wafers = Array.from({ length: 5 }, () => spotBeside(track, rand, 50, 160, 24)).filter((w) => w !== null);
  return {
    reserved: wafers.map((w) => ({ ...w, r: 26 })),
    build(buildings, kit) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
      for (let k = 0; k < track.count; k++) {
        minX = Math.min(minX, track.px[k]); maxX = Math.max(maxX, track.px[k]);
        minZ = Math.min(minZ, track.pz[k]); maxZ = Math.max(maxZ, track.pz[k]);
        maxY = Math.max(maxY, track.py[k]);
      }
      // A lit cleanroom ceiling over everything, held up by a grid of columns.
      const ceilingY = maxY + 50;
      const w = maxX - minX + 900;
      const d = maxZ - minZ + 900;
      const tex = kit.keep(ceilingTexture());
      tex.repeat.set(w / 24, d / 24);
      const ceiling = new THREE.Mesh(
        kit.keep(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2)),
        kit.keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })),
      );
      ceiling.position.set((minX + maxX) / 2, ceilingY, (minZ + maxZ) / 2);
      ceiling.updateMatrix();
      ceiling.matrixAutoUpdate = false;
      kit.group.add(ceiling);
      const columnMat = kit.keep(new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 }));
      for (let x = minX - 300; x <= maxX + 300; x += 110) {
        for (let z = minZ - 300; z <= maxZ + 300; z += 110) {
          if (roadDistance(track, x, z) < track.halfWidth + 14) continue;
          kit.add(boxAt(5, ceilingY, 5, x, 0, z), columnMat);
        }
      }

      // Each machine gets a yellow or cyan status light on top.
      const lamp = new THREE.InstancedMesh(
        kit.keep(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10).translate(0, 0.7, 0)),
        kit.keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), Math.max(1, buildings.length),
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      buildings.forEach((b, i) => {
        m.compose(new THREE.Vector3(b.x + b.w * 0.3, b.h, b.z), q, new THREE.Vector3(1, 1, 1));
        lamp.setMatrixAt(i, m);
        lamp.setColorAt(i, c.setHex(i % 3 === 0 ? 0xffc93c : 0x00e5ff));
      });
      lamp.count = buildings.length;
      kit.group.add(lamp);

      // Giant wafers standing on edge.
      const waferMat = kit.keep(new THREE.MeshStandardMaterial({
        map: kit.keep(waferTexture()), metalness: 0.75, roughness: 0.2, emissive: 0x223355, emissiveIntensity: 0.3,
      }));
      for (const spot of wafers) {
        const g = new THREE.CylinderGeometry(22, 22, 1.2, 48).rotateX(Math.PI / 2).rotateY(rand() * Math.PI).translate(spot.x, 23, spot.z);
        kit.add(g, waferMat);
      }
    },
  };
};

const shenzhen = (track: Track): ThemeDecor => {
  const rand = seeded(track.seed ^ 0x5e2);
  const tower = spotBeside(track, rand, 120, 240, 30);
  return {
    reserved: tower ? [{ ...tower, r: 36 }] : [],
    build(buildings, kit) {
      // Neon strips up two corners of every tower.
      const strips = new THREE.InstancedMesh(
        kit.keep(new THREE.BoxGeometry(1, 1, 1)), kit.keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), Math.max(1, buildings.length * 2),
      );
      const colors = [0xff2bd6, 0x00ffd0, 0x3de0ff, 0xffe14d, 0x9b5cff];
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      const v = new THREE.Vector3();
      let n = 0;
      buildings.forEach((b, i) => {
        q.setFromAxisAngle(up, b.rot);
        for (const corner of [1, -1]) {
          v.set((b.w / 2) * corner, 0, (b.d / 2) * corner).applyQuaternion(q);
          m.compose(new THREE.Vector3(b.x + v.x, b.h / 2, b.z + v.z), q, new THREE.Vector3(0.8, b.h, 0.8));
          strips.setMatrixAt(n, m);
          strips.setColorAt(n++, c.setHex(colors[(i + (corner > 0 ? 0 : 2)) % colors.length]));
        }
      });
      strips.count = n;
      kit.group.add(strips);

      const words: Array<[string, string]> = [["深圳", "#ff2bd6"], ["芯片", "#00ffd0"], ["未来", "#3de0ff"], ["科技", "#ffe14d"], ["算力", "#9b5cff"], ["模型", "#ff6b3d"]];
      billboards(track, kit, rand, 18, words.map(([t, col]) => kit.keep(neonSign(t, col))),
        kit.keep(new THREE.MeshStandardMaterial({ color: 0x1a1424, roughness: 0.6 })));

      if (tower) {
        // A supertall: tapered body, glowing ribs and a spire.
        const glass = kit.keep(new THREE.MeshStandardMaterial({ color: 0x2c3e66, roughness: 0.25, metalness: 0.7 }));
        const rib = kit.keep(new THREE.MeshBasicMaterial({ color: 0x00ffd0 }));
        kit.add(new THREE.CylinderGeometry(9, 20, 360, 4, 1).rotateY(Math.PI / 4).translate(tower.x, 180, tower.z), glass);
        // The body's corners run from radius 20 at the foot to 9 at the top; a glowing rib follows each.
        for (let a = 0; a < 4; a++) {
          const cx = Math.cos((a * Math.PI) / 2);
          const cz = Math.sin((a * Math.PI) / 2);
          const line = new THREE.LineCurve3(
            new THREE.Vector3(tower.x + cx * 20.4, 0, tower.z + cz * 20.4),
            new THREE.Vector3(tower.x + cx * 9.4, 360, tower.z + cz * 9.4),
          );
          kit.add(new THREE.TubeGeometry(line, 1, 0.7, 5, false), rib);
        }
        kit.add(new THREE.CylinderGeometry(0.5, 2.5, 60, 6).translate(tower.x, 390, tower.z), glass);
      }
    },
  };
};

const beijing = (track: Track): ThemeDecor => {
  const rand = seeded(track.seed ^ 0xbe1);
  const pagodas = Array.from({ length: 2 }, () => spotBeside(track, rand, 70, 180, 16)).filter((p) => p !== null);
  const pants = spotBeside(track, rand, 140, 260, 50);
  const reserved = pagodas.map((p) => ({ ...p, r: 20 }));
  if (pants) reserved.push({ ...pants, r: 58 });
  return {
    reserved,
    build(buildings, kit) {
      const red = kit.keep(new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.6 }));
      const tile = kit.keep(new THREE.MeshStandardMaterial({ color: 0xd9a82e, roughness: 0.45, metalness: 0.2 }));
      const greenTile = kit.keep(new THREE.MeshStandardMaterial({ color: 0x3f6b55, roughness: 0.6 }));

      // Low courtyard buildings get glazed hip roofs.
      const low = buildings.filter((b) => b.h < 18);
      const roofs = new THREE.InstancedMesh(kit.keep(unitPyramid()), tile, Math.max(1, low.length));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      low.forEach((b, i) => {
        q.setFromAxisAngle(up, b.rot);
        m.compose(new THREE.Vector3(b.x, b.h, b.z), q, new THREE.Vector3(b.w * 1.18, Math.min(b.w, b.d) * 0.35, b.d * 1.18));
        roofs.setMatrixAt(i, m);
      });
      roofs.count = low.length;
      kit.group.add(roofs);

      // Paifang gates across the ring road.
      const edge = track.halfWidth + 1.6;
      const plaqueTex = kit.keep(canvasTexture(256, 96, (ctx) => {
        ctx.fillStyle = "#1d3c78";
        ctx.fillRect(0, 0, 256, 96);
        ctx.strokeStyle = "#d9a82e";
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 248, 88);
        ctx.font = "900 62px 'PingFang SC', 'Noto Sans SC', serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#d9a82e";
        ctx.fillText("环路", 128, 52);
      }));
      const plaqueMat = kit.keep(new THREE.MeshBasicMaterial({ map: plaqueTex }));
      for (const s of spanSites(track, 4)) {
        const place = onTrack(track, s, 0, 0, 0);
        const span = edge + 1.4;
        for (const x of [-span, span]) kit.add(place(new THREE.CylinderGeometry(0.75, 0.85, 12, 12).translate(x, 6, 0)), red);
        kit.add(place(new THREE.BoxGeometry(span * 2 + 2, 1.4, 1.4).translate(0, 11.2, 0)), red);
        kit.add(place(new THREE.BoxGeometry(span * 2 + 5, 0.6, 3.4).translate(0, 12.2, 0)), greenTile);
        kit.add(place(unitPyramid().scale(span * 2 + 6, 2.2, 3.6).translate(0, 12.5, 0)), tile);
        kit.add(place(new THREE.BoxGeometry(7, 2.6, 0.3).translate(0, 9, -0.75)), plaqueMat);
        kit.add(place(new THREE.BoxGeometry(7, 2.6, 0.3).translate(0, 9, 0.75)), plaqueMat);
      }

      // Pagodas: shrinking tiers, each with a flared roof.
      for (const p of pagodas) {
        let y = 0;
        let w = 16;
        const rot = rand() * Math.PI;
        for (let tier = 0; tier < 7; tier++) {
          kit.add(boxAt(w, 7, w, p.x, y, p.z, rot), red);
          kit.add(pyramidAt(w * 1.55, 3, w * 1.55, p.x, y + 7, p.z, rot), greenTile);
          y += 8.5;
          w *= 0.86;
        }
        kit.add(new THREE.ConeGeometry(0.8, 9, 8).translate(p.x, y + 4.5, p.z), tile);
      }

      // The "Big Pants": two leaning towers joined by a cantilevered bridge at the top.
      if (pants) {
        const glass = kit.keep(new THREE.MeshStandardMaterial({ color: 0x55606c, roughness: 0.3, metalness: 0.6 }));
        const rot = rand() * Math.PI;
        const local = new THREE.Matrix4().makeRotationY(rot).setPosition(pants.x, 0, pants.z);
        const lean = 0.1;
        for (const side of [-1, 1]) {
          const g = new THREE.BoxGeometry(22, 160, 22).translate(0, 80, 0);
          g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-side * lean));
          g.translate(side * 24, 0, 0);
          kit.add(g.applyMatrix4(local), glass);
        }
        kit.add(new THREE.BoxGeometry(92, 30, 22).translate(0, 150, 0).applyMatrix4(local), glass);
        kit.add(new THREE.BoxGeometry(70, 26, 22).translate(0, 13, 0).applyMatrix4(local), glass);
      }
    },
  };
};

export const themeDecor = (track: Track, theme: TrackTheme): ThemeDecor => {
  switch (theme.id) {
    case "sf": return sanFrancisco(track);
    case "nyc": return newYork(track);
    case "fab": return theFab(track);
    case "shenzhen": return shenzhen(track);
    case "beijing": return beijing(track);
  }
};
