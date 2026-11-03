import { type ThemeId, themeById } from "./content.ts";
import { Rng } from "./rng.ts";

/**
 * Tracks are closed 3D ribbons described in track space: `s` is distance along
 * the centerline and `d` is the lateral offset (positive = driver's right).
 * Every sample carries a full frame (tangent, surface up), so the road can
 * climb, crest, bank and loop. The sim only needs a few scalars per sample:
 * yaw curvature in the road plane, pitch curvature, slope, and whether the
 * sample is inside a loop. World positions only matter for rendering.
 */

export const SAMPLE_STEP = 2;

export const FeatureKind = {
  Boost: 1,
  Slow: 2,
  Ramp: 3,
  Bumper: 4,
  Launch: 5,
} as const;
export type FeatureKind = (typeof FeatureKind)[keyof typeof FeatureKind];

export interface Feature {
  readonly kind: FeatureKind;
  /** Start of the feature along the track (bumpers: center). */
  readonly s: number;
  readonly length: number;
  /** Lateral center. */
  readonly d: number;
  /** Lateral half extent (bumpers: radius). */
  readonly halfWidth: number;
}

export interface ItemBoxDef {
  readonly s: number;
  readonly d: number;
}

/** A GPU pickup. `h` is height above the road: some lines float where only a jump reaches. */
export interface CoinDef {
  readonly s: number;
  readonly d: number;
  readonly h: number;
}

export interface Track {
  readonly theme: ThemeId;
  readonly seed: number;
  readonly playerCount: number;
  readonly length: number;
  readonly halfWidth: number;
  readonly count: number;
  readonly step: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly tz: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  readonly uz: Float64Array;
  /** Yaw curvature in the road plane, 1/m. Positive turns right. */
  readonly curvature: Float64Array;
  /** Pitch curvature, 1/m. Positive is a dip or loop, negative a crest. */
  readonly pitch: Float64Array;
  readonly loop: Uint8Array;
  readonly loops: ReadonlyArray<{ readonly s: number; readonly length: number }>;
  readonly features: ReadonlyArray<Feature>;
  readonly itemBoxes: ReadonlyArray<ItemBoxDef>;
  readonly coins: ReadonlyArray<CoinDef>;
  /** features overlapping bucket b: bucketItems[bucketStart[b] .. bucketStart[b + 1]) */
  readonly bucketSize: number;
  readonly bucketStart: Int32Array;
  readonly bucketItems: Int32Array;
}

/** World position plus the local frame at a track-space point. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** forward (track tangent) */
  fx: number;
  fy: number;
  fz: number;
  /** surface up */
  ux: number;
  uy: number;
  uz: number;
  /** right (+d) */
  rx: number;
  ry: number;
  rz: number;
}

export const makePose = (): Pose => ({ x: 0, y: 0, z: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, rx: 0, ry: 0, rz: 1 });

/** Surface scalars the physics step needs at one point. */
export interface Surface {
  curvature: number;
  pitch: number;
  /** tangent · world up: positive climbing */
  slope: number;
  /** surface up · world up: 1 on flat road, negative upside down */
  upY: number;
  loop: boolean;
}

export const makeSurface = (): Surface => ({ curvature: 0, pitch: 0, slope: 0, upY: 1, loop: false });

export const trackHalfWidth = (theme: ThemeId, playerCount: number): number =>
  Math.min(18, Math.max(8, (8 + 0.12 * playerCount) * themeById(theme).widthScale));

/** Two laps of this take about 50 s for a small lobby; big lobbies get a bit more road. */
export const targetTrackLength = (playerCount: number): number => 1000 + 110 * Math.sqrt(playerCount);

export const wrapS = (track: Track, s: number): number => {
  const L = track.length;
  const r = s % L;
  return r < 0 ? r + L : r;
};

const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const curvatureAt = (track: Track, s: number): number => {
  const f = wrapS(track, s) / track.step;
  const i = Math.floor(f) % track.count;
  const t = f - Math.floor(f);
  const j = i + 1 === track.count ? 0 : i + 1;
  return track.curvature[i] * (1 - t) + track.curvature[j] * t;
};

export const surfaceAt = (track: Track, s: number, out: Surface): Surface => {
  const f = wrapS(track, s) / track.step;
  const i = Math.floor(f) % track.count;
  const t = f - Math.floor(f);
  const j = i + 1 === track.count ? 0 : i + 1;
  out.curvature = track.curvature[i] * (1 - t) + track.curvature[j] * t;
  out.pitch = track.pitch[i] * (1 - t) + track.pitch[j] * t;
  out.slope = track.ty[i] * (1 - t) + track.ty[j] * t;
  out.upY = track.uy[i] * (1 - t) + track.uy[j] * t;
  out.loop = track.loop[i] === 1 || track.loop[j] === 1;
  return out;
};

/** World pose of track-space point (s, d) at height h above the road surface. */
export const poseAt = (track: Track, s: number, d: number, h: number, out: Pose): Pose => {
  const f = wrapS(track, s) / track.step;
  const i = Math.floor(f) % track.count;
  const t = f - Math.floor(f);
  const j = i + 1 === track.count ? 0 : i + 1;
  const a = 1 - t;
  let fx = track.tx[i] * a + track.tx[j] * t;
  let fy = track.ty[i] * a + track.ty[j] * t;
  let fz = track.tz[i] * a + track.tz[j] * t;
  let len = Math.hypot(fx, fy, fz) || 1;
  fx /= len; fy /= len; fz /= len;
  let ux = track.ux[i] * a + track.ux[j] * t;
  let uy = track.uy[i] * a + track.uy[j] * t;
  let uz = track.uz[i] * a + track.uz[j] * t;
  len = Math.hypot(ux, uy, uz) || 1;
  ux /= len; uy /= len; uz /= len;
  // right = forward × up
  const rx = fy * uz - fz * uy;
  const ry = fz * ux - fx * uz;
  const rz = fx * uy - fy * ux;
  out.x = track.px[i] * a + track.px[j] * t + rx * d + ux * h;
  out.y = track.py[i] * a + track.py[j] * t + ry * d + uy * h;
  out.z = track.pz[i] * a + track.pz[j] * t + rz * d + uz * h;
  out.fx = fx; out.fy = fy; out.fz = fz;
  out.ux = ux; out.uy = uy; out.uz = uz;
  out.rx = rx; out.ry = ry; out.rz = rz;
  return out;
};

const superellipse = (theta: number, p: number): number =>
  Math.pow(Math.pow(Math.abs(Math.cos(theta)), p) + Math.pow(Math.abs(Math.sin(theta)), p), -1 / p);

const catmullRom = (
  p0x: number, p0z: number, p1x: number, p1z: number,
  p2x: number, p2z: number, p3x: number, p3z: number,
  samples: number, outX: number[], outZ: number[],
): void => {
  const knot = (ax: number, az: number, bx: number, bz: number) =>
    Math.max(1e-4, Math.pow(Math.hypot(bx - ax, bz - az), 0.5));
  const t0 = 0;
  const t1 = t0 + knot(p0x, p0z, p1x, p1z);
  const t2 = t1 + knot(p1x, p1z, p2x, p2z);
  const t3 = t2 + knot(p2x, p2z, p3x, p3z);
  for (let k = 0; k < samples; k++) {
    const t = t1 + ((t2 - t1) * k) / samples;
    const a1x = ((t1 - t) * p0x + (t - t0) * p1x) / (t1 - t0);
    const a1z = ((t1 - t) * p0z + (t - t0) * p1z) / (t1 - t0);
    const a2x = ((t2 - t) * p1x + (t - t1) * p2x) / (t2 - t1);
    const a2z = ((t2 - t) * p1z + (t - t1) * p2z) / (t2 - t1);
    const a3x = ((t3 - t) * p2x + (t - t2) * p3x) / (t3 - t2);
    const a3z = ((t3 - t) * p2z + (t - t2) * p3z) / (t3 - t2);
    const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
    const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
    const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
    const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);
    outX.push(((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1));
    outZ.push(((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1));
  }
};

interface Centerline {
  x: Float64Array;
  z: Float64Array;
  angle: Float64Array;
  curvature: Float64Array;
  length: number;
  count: number;
  step: number;
}

const buildCenterline = (
  rng: Rng, themeId: ThemeId, playerCount: number, wobbleScale: number, smoothing: number,
): Centerline => {
  const theme = themeById(themeId);
  const target = targetTrackLength(playerCount);
  const corners = Math.min(24, Math.max(7, 8 + Math.floor(playerCount / 8) + Math.round(theme.extraCorners / 2)));
  const radius = (target / (2 * Math.PI)) * 0.8;
  const px: number[] = [];
  const pz: number[] = [];
  const spin = rng.range(0, Math.PI * 2);
  for (let i = 0; i < corners; i++) {
    const theta = (2 * Math.PI * (i + rng.range(-0.3, 0.3))) / corners;
    const r = radius * superellipse(theta, theme.boxiness) * (1 + theme.wobble * wobbleScale * rng.range(-1, 1));
    px.push(Math.cos(theta + spin) * r);
    pz.push(Math.sin(theta + spin) * r);
  }

  const dx: number[] = [];
  const dz: number[] = [];
  for (let i = 0; i < corners; i++) {
    const a = (i - 1 + corners) % corners;
    const b = (i + 1) % corners;
    const c = (i + 2) % corners;
    catmullRom(px[a], pz[a], px[i], pz[i], px[b], pz[b], px[c], pz[c], 32, dx, dz);
  }

  const n = dx.length;
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cumulative[i + 1] = cumulative[i] + Math.hypot(dx[j] - dx[i], dz[j] - dz[i]);
  }
  const rawLength = cumulative[n];
  const count = Math.max(64, Math.round(rawLength / SAMPLE_STEP));
  const step = rawLength / count;
  let x = new Float64Array(count);
  let z = new Float64Array(count);
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (cumulative[seg + 1] < target) seg++;
    const span = cumulative[seg + 1] - cumulative[seg];
    const t = span > 0 ? (target - cumulative[seg]) / span : 0;
    const j = (seg + 1) % n;
    x[k] = dx[seg] + (dx[j] - dx[seg]) * t;
    z[k] = dz[seg] + (dz[j] - dz[seg]) * t;
  }

  for (let pass = 0; pass < smoothing; pass++) {
    const nx = new Float64Array(count);
    const nz = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const a = (k - 1 + count) % count;
      const b = (k + 1) % count;
      nx[k] = (x[a] + 2 * x[k] + x[b]) / 4;
      nz[k] = (z[a] + 2 * z[k] + z[b]) / 4;
    }
    x = nx;
    z = nz;
  }

  let length = 0;
  for (let k = 0; k < count; k++) {
    const j = (k + 1) % count;
    length += Math.hypot(x[j] - x[k], z[j] - z[k]);
  }
  const realStep = length / count;
  const angle = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const j = (k + 1) % count;
    angle[k] = Math.atan2(z[j] - z[k], x[j] - x[k]);
  }
  const curvature = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const j = (k + 1) % count;
    curvature[k] = wrapAngle(angle[j] - angle[k]) / realStep;
  }
  return { x, z, angle, curvature, length, count, step: realStep };
};

const selfIntersects = (c: Centerline, halfWidth: number): boolean => {
  const stride = 3;
  const minArc = halfWidth * 6 + 40;
  const minDist = halfWidth * 2 + 14;
  for (let i = 0; i < c.count; i += stride) {
    for (let j = i + stride; j < c.count; j += stride) {
      const arc = Math.min((j - i) * c.step, c.length - (j - i) * c.step);
      if (arc < minArc) continue;
      if (Math.hypot(c.x[i] - c.x[j], c.z[i] - c.z[j]) < minDist) return true;
    }
  }
  return false;
};

interface Dense {
  x: number[];
  y: number[];
  z: number[];
  /** explicit surface up inside loops, NaN elsewhere */
  ux: number[];
  uy: number[];
  uz: number[];
  bank: number[];
  loop: number[];
}

export const generateTrack = (theme: ThemeId, seed: number, playerCount: number): Track => {
  const themeDef = themeById(theme);
  const halfWidth = trackHalfWidth(theme, playerCount);
  const rng = new Rng(seed);

  let c: Centerline | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = buildCenterline(rng, theme, playerCount, Math.pow(0.82, attempt), 5 + attempt * 2);
    let maxK = 0;
    for (let k = 0; k < candidate.count; k++) maxK = Math.max(maxK, Math.abs(candidate.curvature[k]));
    c = candidate;
    if (maxK * halfWidth < 0.55 && maxK < 0.06 && !selfIntersects(candidate, halfWidth)) break;
  }
  const cl = c!;
  const L2 = cl.length;
  const n2 = cl.count;
  const at = (u: number) => ((Math.round(u / cl.step) % n2) + n2) % n2;
  const maxK2 = (u: number, back: number, ahead: number) => {
    let m = 0;
    for (let o = -back; o <= ahead; o += cl.step) m = Math.max(m, Math.abs(cl.curvature[at(u + o)]));
    return m;
  };

  // Loop sites: straight stretches away from the start line and from each other.
  const loopRadius = 12 + halfWidth * 0.35;
  const loopShift = halfWidth * 2 + 7;
  const wantLoops = Math.min(themeDef.loops, 1) + Math.floor(L2 / 2000);
  const sites: number[] = [];
  for (let pass = 0; pass < 3 && sites.length < wantLoops; pass++) {
    const tolerance = [0.0045, 0.007, 0.011][pass];
    for (let tries = 0; tries < 300 && sites.length < wantLoops; tries++) {
      const u = at(rng.range(260, L2 - 260)) * cl.step;
      if (sites.some((x) => Math.abs(x - u) < 420)) continue;
      if (maxK2(u, 60, 140) > tolerance) continue;
      sites.push(u);
    }
  }
  // Twisty cities still get their loop: take the straightest stretch available.
  for (let extra = 0; sites.length < wantLoops && extra < wantLoops; extra++) {
    let best = -1;
    let bestK = Infinity;
    for (let tries = 0; tries < 200; tries++) {
      const u = at(rng.range(260, L2 - 260)) * cl.step;
      if (sites.some((x) => Math.abs(x - u) < 420)) continue;
      const k = maxK2(u, 50, 120);
      if (k < bestK) {
        bestK = k;
        best = u;
      }
    }
    if (best < 0 || bestK > 0.03) break;
    sites.push(best);
  }
  sites.sort((a, b) => a - b);
  const siteIndex = new Set(sites.map((u) => at(u)));

  // Elevation: rolling hills everywhere, flattened at the start line and around loops.
  const waves = 5;
  const freqs: number[] = [];
  const phases: number[] = [];
  const amps: number[] = [];
  let ampSum = 0;
  for (let w = 0; w < waves; w++) {
    freqs.push(rng.int(2, 4 + Math.floor(L2 / 260)));
    phases.push(rng.range(0, Math.PI * 2));
    const amp = rng.range(0.35, 1);
    amps.push(amp);
    ampSum += amp;
  }
  const rawY = new Float64Array(n2);
  for (let k = 0; k < n2; k++) {
    const u = k * cl.step;
    let h = 0;
    for (let w = 0; w < waves; w++) h += amps[w] * Math.sin((2 * Math.PI * freqs[w] * u) / L2 + phases[w]);
    rawY[k] = (themeDef.hills * h) / ampSum;
  }
  let maxSlope = 0;
  for (let k = 0; k < n2; k++) maxSlope = Math.max(maxSlope, Math.abs(rawY[(k + 1) % n2] - rawY[k]) / cl.step);
  const slopeScale = maxSlope > 0.36 ? 0.36 / maxSlope : 1;
  const elevation = new Float64Array(n2);
  for (let k = 0; k < n2; k++) {
    const u = k * cl.step;
    let y = rawY[k] * slopeScale;
    const fromStart = Math.min(u, L2 - u);
    y = rawY[0] * slopeScale + (y - rawY[0] * slopeScale) * smoothstep(30, 140, fromStart);
    for (const site of sites) {
      const local = rawY[at(site)] * slopeScale;
      const dist = u - site;
      const w = dist < 0 ? smoothstep(40, 150, -dist) : smoothstep(60, 170, dist);
      y = local + (y - local) * w;
    }
    elevation[k] = y;
  }

  // Bank into corners, smoothed so the road twists gradually.
  const bankRaw = new Float64Array(n2);
  const bankGain = themeDef.bank / 0.018;
  for (let k = 0; k < n2; k++) bankRaw[k] = Math.max(-themeDef.bank, Math.min(themeDef.bank, cl.curvature[k] * bankGain));
  const bank = new Float64Array(n2);
  const window = 12;
  for (let k = 0; k < n2; k++) {
    let sum = 0;
    for (let o = -window; o <= window; o++) sum += bankRaw[(k + o + n2) % n2];
    bank[k] = sum / (window * 2 + 1);
  }

  const lateralShift = (u: number) => {
    let shift = 0;
    for (const site of sites) if (u >= site) shift += loopShift * (1 - smoothstep(0, 130, u - site));
    return shift;
  };

  const dense: Dense = { x: [], y: [], z: [], ux: [], uy: [], uz: [], bank: [], loop: [] };
  const push = (x: number, y: number, z: number, b: number, loop: number, ux = NaN, uy = NaN, uz = NaN) => {
    dense.x.push(x); dense.y.push(y); dense.z.push(z);
    dense.ux.push(ux); dense.uy.push(uy); dense.uz.push(uz);
    dense.bank.push(b); dense.loop.push(loop);
  };
  for (let k = 0; k < n2; k++) {
    const u = k * cl.step;
    const a = cl.angle[k];
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    const rx = -Math.sin(a);
    const rz = Math.cos(a);
    if (siteIndex.has(k)) {
      const site = u;
      const before = lateralShift(site - 1e-6);
      const bx = cl.x[k] + rx * before;
      const bz = cl.z[k] + rz * before;
      const by = elevation[k];
      const steps = Math.ceil((2 * Math.PI * loopRadius) / 0.8);
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * Math.PI * 2;
        const side = loopShift * smoothstep(0, 1, i / steps);
        const sin = Math.sin(th);
        const cos = Math.cos(th);
        push(
          bx + fx * loopRadius * sin + rx * side,
          by + loopRadius * (1 - cos),
          bz + fz * loopRadius * sin + rz * side,
          0, i === 0 || i === steps ? 0 : 1,
          -fx * sin, cos, -fz * sin,
        );
      }
    }
    const shift = lateralShift(u);
    push(cl.x[k] + rx * shift, elevation[k], cl.z[k] + rz * shift, bank[k], 0);
  }

  // Resample by true 3D arc length.
  const m = dense.x.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i] + Math.hypot(dense.x[j] - dense.x[i], dense.y[j] - dense.y[i], dense.z[j] - dense.z[i]);
  }
  const L = cum[m];
  const count = Math.max(64, Math.round(L / SAMPLE_STEP));
  const step = L / count;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  const hintX = new Float64Array(count);
  const hintY = new Float64Array(count);
  const hintZ = new Float64Array(count);
  const bankS = new Float64Array(count);
  const loop = new Uint8Array(count);
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? (target - cum[seg]) / span : 0;
    const j = (seg + 1) % m;
    px[k] = dense.x[seg] + (dense.x[j] - dense.x[seg]) * t;
    py[k] = dense.y[seg] + (dense.y[j] - dense.y[seg]) * t;
    pz[k] = dense.z[seg] + (dense.z[j] - dense.z[seg]) * t;
    bankS[k] = dense.bank[seg] + (dense.bank[j] - dense.bank[seg]) * t;
    const inLoop = dense.loop[seg] === 1 || dense.loop[j] === 1;
    loop[k] = inLoop ? 1 : 0;
    const a = Number.isNaN(dense.ux[seg]) ? j : seg;
    const b = Number.isNaN(dense.ux[j]) ? seg : j;
    hintX[k] = inLoop ? dense.ux[a] + (dense.ux[b] - dense.ux[a]) * t : NaN;
    hintY[k] = inLoop ? dense.uy[a] + (dense.uy[b] - dense.uy[a]) * t : NaN;
    hintZ[k] = inLoop ? dense.uz[a] + (dense.uz[b] - dense.uz[a]) * t : NaN;
  }
  let minY = Infinity;
  for (let k = 0; k < count; k++) minY = Math.min(minY, py[k]);
  for (let k = 0; k < count; k++) py[k] += 7 - minY;

  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const tz = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const a = (k - 1 + count) % count;
    const b = (k + 1) % count;
    const x = px[b] - px[a];
    const y = py[b] - py[a];
    const z = pz[b] - pz[a];
    const len = Math.hypot(x, y, z) || 1;
    tx[k] = x / len; ty[k] = y / len; tz[k] = z / len;
  }

  let ux = new Float64Array(count);
  let uy = new Float64Array(count);
  let uz = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    let x: number, y: number, z: number;
    if (loop[k] && !Number.isNaN(hintX[k])) {
      x = hintX[k]; y = hintY[k]; z = hintZ[k];
    } else {
      // Level "up", then roll it about the tangent by the bank angle.
      x = -ty[k] * tx[k];
      y = 1 - ty[k] * ty[k];
      z = -ty[k] * tz[k];
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      const rx = ty[k] * z - tz[k] * y;
      const ry = tz[k] * x - tx[k] * z;
      const rz = tx[k] * y - ty[k] * x;
      const cb = Math.cos(bankS[k]);
      const sb = Math.sin(bankS[k]);
      x = x * cb + rx * sb;
      y = y * cb + ry * sb;
      z = z * cb + rz * sb;
    }
    ux[k] = x; uy[k] = y; uz[k] = z;
  }
  for (let pass = 0; pass < 3; pass++) {
    const nx = new Float64Array(count);
    const ny = new Float64Array(count);
    const nz = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const a = (k - 1 + count) % count;
      const b = (k + 1) % count;
      let x = ux[a] + 2 * ux[k] + ux[b];
      let y = uy[a] + 2 * uy[k] + uy[b];
      let z = uz[a] + 2 * uz[k] + uz[b];
      const dot = x * tx[k] + y * ty[k] + z * tz[k];
      x -= dot * tx[k]; y -= dot * ty[k]; z -= dot * tz[k];
      const len = Math.hypot(x, y, z) || 1;
      nx[k] = x / len; ny[k] = y / len; nz[k] = z / len;
    }
    ux = nx; uy = ny; uz = nz;
  }

  const curvature = new Float64Array(count);
  const pitch = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const a = (k - 1 + count) % count;
    const b = (k + 1) % count;
    const dx = (tx[b] - tx[a]) / (2 * step);
    const dy = (ty[b] - ty[a]) / (2 * step);
    const dz = (tz[b] - tz[a]) / (2 * step);
    const rx = ty[k] * uz[k] - tz[k] * uy[k];
    const ry = tz[k] * ux[k] - tx[k] * uz[k];
    const rz = tx[k] * uy[k] - ty[k] * ux[k];
    curvature[k] = dx * rx + dy * ry + dz * rz;
    pitch[k] = dx * ux[k] + dy * uy[k] + dz * uz[k];
  }

  const loops: Array<{ s: number; length: number }> = [];
  for (let k = 0; k < count; k++) {
    if (loop[k] && !loop[(k - 1 + count) % count]) {
      let e = k;
      while (loop[e % count]) e++;
      loops.push({ s: k * step, length: (e - k) * step });
    }
  }
  const nearLoop = (s: number, before: number, after: number) =>
    loops.some((l) => s > l.s - before && s < l.s + l.length + after);

  const sampleIndex = (s: number) => ((Math.round(s / step) % count) + count) % count;
  const windowMaxCurvature = (s: number, radius: number): number => {
    let mk = 0;
    for (let o = -radius; o <= radius; o += step) mk = Math.max(mk, Math.abs(curvature[sampleIndex(s + o)]));
    return mk;
  };

  const itemBoxes: ItemBoxDef[] = [];
  const rowSpacing = Math.min(360, Math.max(200, L / 6));
  const rowStarts: number[] = [];
  for (let s = 150; s < L - 100; s += rowSpacing) {
    let row = s;
    while (nearLoop(row, 30, 40)) row += 20;
    rowStarts.push(row);
    const usable = halfWidth * 2 * 0.8;
    const boxes = Math.max(3, Math.floor(usable / 3.6));
    for (let b = 0; b < boxes; b++) itemBoxes.push({ s: row, d: -usable / 2 + (usable * (b + 0.5)) / boxes });
  }
  const nearItemRow = (s: number, margin: number) => rowStarts.some((r) => Math.abs(r - s) < margin);

  const features: Feature[] = [];
  for (const l of loops) {
    for (const lane of [-1, 1]) {
      features.push({ kind: FeatureKind.Boost, s: l.s - 46, length: 12, d: lane * halfWidth * 0.45, halfWidth: halfWidth * 0.42 });
      features.push({ kind: FeatureKind.Boost, s: l.s - 24, length: 12, d: lane * halfWidth * 0.45, halfWidth: halfWidth * 0.42 });
    }
  }
  for (let s = 100; s < L - 60; ) {
    if (nearLoop(s, 60, 50)) {
      s += 20;
      continue;
    }
    if (nearItemRow(s, 16)) {
      s += 18;
      continue;
    }
    const straight = windowMaxCurvature(s, 18) < 0.008;
    const k = curvature[sampleIndex(s + 8)];
    const downhillAhead = ty[sampleIndex(s + 30)] < -0.12;
    const roll = rng.next();
    if (straight && roll < 0.34) {
      const lane = rng.range(-halfWidth + 2.6, halfWidth - 2.6);
      features.push({ kind: FeatureKind.Boost, s, length: 10, d: lane, halfWidth: 2.2 });
      s += rng.range(30, 55);
    } else if (straight && roll < 0.68) {
      const full = rng.next() < 0.55;
      const side = rng.sign();
      features.push({
        kind: downhillAhead ? FeatureKind.Launch : FeatureKind.Ramp,
        s, length: downhillAhead ? 9 : 7,
        d: full ? 0 : side * halfWidth * 0.5,
        halfWidth: full ? halfWidth : halfWidth * 0.5,
      });
      s += rng.range(55, 95);
    } else if (!straight && roll < 0.42) {
      // Speed Racer lane: a boost strip high on the outside of the banked turn.
      const outside = -(Math.sign(k) || 1);
      features.push({ kind: FeatureKind.Boost, s, length: 14, d: outside * (halfWidth - 2.4), halfWidth: 2.1 });
      s += rng.range(35, 55);
    } else if (!straight && roll < 0.62) {
      const inside = Math.sign(k) || 1;
      features.push({ kind: FeatureKind.Slow, s, length: 18, d: inside * (halfWidth - 2.6), halfWidth: 2.6 });
      s += rng.range(35, 55);
    } else if (halfWidth >= 8 && roll < 0.78) {
      const n = rng.int(1, 3);
      for (let b = 0; b < n; b++) {
        const side = rng.sign();
        features.push({
          kind: FeatureKind.Bumper, s: s + b * rng.range(6, 10), length: 0,
          d: side * rng.range(halfWidth * 0.35, halfWidth - 2.5), halfWidth: 1.3,
        });
      }
      s += rng.range(55, 85);
    } else {
      s += 16;
    }
  }

  // GPU lines reward the risky line: through loops, off ramps, hugging banked walls.
  const coins: CoinDef[] = [];
  const coinLine = (s0: number, d: number, count: number, gap: number, h: (i: number) => number) => {
    for (let i = 0; i < count; i++) {
      const s = s0 + i * gap;
      if (s > 20 && s < L - 20) coins.push({ s, d: Math.max(-halfWidth + 1.2, Math.min(halfWidth - 1.2, d)), h: h(i) });
    }
  };
  for (const l of loops) coinLine(l.s + 6, 0, 8, (l.length - 12) / 7, () => 1.1);
  for (const f of features) {
    if (f.kind === FeatureKind.Ramp || f.kind === FeatureKind.Launch) {
      const peak = f.kind === FeatureKind.Launch ? 6 : 3.4;
      coinLine(f.s + f.length + 6, f.d, 4, 7, (i) => 1.2 + peak * Math.sin(((i + 1) / 5) * Math.PI));
    } else if (f.kind === FeatureKind.Boost && Math.abs(f.d) > halfWidth * 0.55) {
      coinLine(f.s + 1, f.d, 3, 5, () => 1.1);
    }
  }
  for (let s = 220; s < L - 120; s += rng.range(140, 220)) {
    if (nearLoop(s, 40, 40) || nearItemRow(s, 30)) continue;
    const lane = rng.range(-halfWidth + 1.5, halfWidth - 1.5);
    const drift = rng.range(-0.25, 0.25);
    for (let i = 0; i < 5; i++) coins.push({ s: s + i * 6, d: Math.max(-halfWidth + 1.2, Math.min(halfWidth - 1.2, lane + drift * i * 6)), h: 1.1 });
  }

  const bucketSize = 16;
  const bucketCount = Math.ceil(L / bucketSize) + 1;
  const lists: number[][] = Array.from({ length: bucketCount }, () => []);
  features.forEach((f, index) => {
    const pad = f.kind === FeatureKind.Bumper ? f.halfWidth + 2 : 2;
    const first = Math.floor((f.s - pad) / bucketSize);
    const last = Math.floor((f.s + f.length + pad) / bucketSize);
    for (let b = first; b <= last; b++) lists[((b % bucketCount) + bucketCount) % bucketCount].push(index);
  });
  const bucketStart = new Int32Array(bucketCount + 1);
  const flat: number[] = [];
  for (let b = 0; b < bucketCount; b++) {
    bucketStart[b] = flat.length;
    flat.push(...lists[b]);
  }
  bucketStart[bucketCount] = flat.length;

  return {
    theme, seed, playerCount, length: L, halfWidth, count, step,
    px, py, pz, tx, ty, tz, ux, uy, uz, curvature, pitch, loop, loops,
    features, itemBoxes, coins, bucketSize, bucketStart, bucketItems: Int32Array.from(flat),
  };
};

/** Starting grid: rows across the road, behind the start line (negative distance). */
export const gridSlot = (track: Track, slot: number): { dist: number; d: number } => {
  const usable = track.halfWidth * 2 - 3;
  const perRow = Math.max(2, Math.floor(usable / 3.6));
  const row = Math.floor(slot / perRow);
  const col = slot % perRow;
  const stagger = row % 2 === 0 ? 0 : usable / perRow / 2;
  const d = -usable / 2 + ((col + 0.5) * usable) / perRow + stagger - usable / perRow / 4;
  return { dist: -8 - row * 5.5, d };
};
