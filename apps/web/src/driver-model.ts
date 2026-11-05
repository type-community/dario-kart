import { CHARACTERS, type Character } from "@dario-kart/sim";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";

type Point = [number, number, number];
type Hair = "curls" | "quiff" | "tousled" | "part" | "crop" | "bald" | "bob" | "long" | "swept" | "receding";
interface Look {
  hair: Hair;
  glasses?: "round" | "square";
  jacket?: boolean;
  width: number;
  height: number;
  brow: number;
  smile: number;
  iris: number;
  beard?: boolean;
}

const LOOKS: Record<string, Look> = {
  dario: { hair: "curls", glasses: "round", width: 1, height: 1, brow: .02, smile: .8, iris: 0x99552d },
  elon: { hair: "quiff", width: 1.03, height: 1, brow: -.025, smile: .35, iris: 0x487f9e },
  sam: { hair: "tousled", width: .94, height: 1.04, brow: .035, smile: .7, iris: 0x3d8e77 },
  sundar: { hair: "part", glasses: "square", width: .94, height: 1.06, brow: .015, smile: .65, iris: 0x705032, beard: true },
  mark: { hair: "crop", width: .98, height: 1, brow: -.015, smile: .45, iris: 0x4486b5 },
  satya: { hair: "bald", glasses: "round", jacket: true, width: .96, height: 1.03, brow: .04, smile: 1, iris: 0x785137, beard: true },
  lisa: { hair: "bob", glasses: "square", jacket: true, width: .98, height: .98, brow: .035, smile: .9, iris: 0x834b35 },
  mira: { hair: "long", width: .93, height: 1.02, brow: .025, smile: .8, iris: 0x674f86 },
  jensen: { hair: "swept", glasses: "square", jacket: true, width: 1.02, height: .98, brow: .025, smile: 1, iris: 0x745338 },
  demis: { hair: "receding", jacket: true, width: 1, height: 1.02, brow: .03, smile: .8, iris: 0x557b79, beard: true },
};

// A soft toon ramp keeps the graphic colors without turning curved surfaces into hard bands.
const ramp = new THREE.DataTexture(new Uint8Array(Array.from({ length: 32 }, (_, i) =>
  Math.round(55 + 200 * THREE.MathUtils.smoothstep(i / 31, .3, .9)))), 32, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;
const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
const cache = new Map<string, { body: THREE.BufferGeometry; head: THREE.BufferGeometry }>();
const shade = (color: number, toward: number, amount: number) => new THREE.Color(color).lerp(new THREE.Color(toward), amount).getHex();
const ink = 0x24243b;
const tessellate = new TessellateModifier(.045, 4);

/** Facial ink follows the same surface as the sculpted head, including its tapered jaw. */
const faceDepth = (x: number, y: number): number => {
  const ny = (y - .32) / .48;
  const width = .4 * (ny < 0 ? 1 + ny * .18 : 1);
  return .33 * Math.sqrt(Math.max(.01, 1 - (x / width) ** 2 - ny ** 2));
};

/** Bake decoration into two moving parts; detail never adds a draw call. */
class Parts {
  private readonly pieces: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: number, position: Point, scale: Point = [1, 1, 1], rotation: Point = [0, 0, 0]): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute("uv");
    g.scale(...scale);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);
    if (!g.hasAttribute("color")) {
      const tint = new THREE.Color(color);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    this.pieces.push(g);
  }

  oval(color: number, position: Point, scale: Point, rotation: Point = [0, 0, 0]): void {
    this.add(new THREE.SphereGeometry(1, 20, 14), color, position, scale, rotation);
  }

  stroke(color: number, points: Point[], radius: number, segments = 12): void {
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, 8, false), color, [0, 0, 0]);
  }

  face(shape: THREE.Shape, color: number, lift = .009): void {
    const flat = new THREE.ShapeGeometry(shape, 12);
    const g = tessellate.modify(flat);
    flat.dispose();
    const position = g.attributes.position;
    for (let i = 0; i < position.count; i++) position.setZ(i, faceDepth(position.getX(i), position.getY(i)) + lift);
    g.computeVertexNormals();
    this.add(g, color, [0, 0, 0]);
  }

  faceOval(color: number, x: number, y: number, width: number, height: number, lift = .012): void {
    const shape = new THREE.Shape();
    shape.absellipse(x, y, width, height, 0, Math.PI * 2, false, 0);
    this.face(shape, color, lift);
  }

  faceLine(color: number, points: [number, number][], radius: number, lift = .015): void {
    this.stroke(color, points.map(([x, y]) => [x, y, faceDepth(x, y) + lift]), radius);
  }

  /** A curved, tapering hair lock, with a broad root and a fine swept tip. */
  lock(color: number, points: [Point, Point, Point], width: number, depth: number): void {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...points[0]), new THREE.Vector3(...points[1]), new THREE.Vector3(...points[2]),
    );
    const positions: number[] = [], indices: number[] = [];
    const rings = 18, sides = 14;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, center = curve.getPoint(t), tangent = curve.getTangent(t);
      const across = new THREE.Vector3(-tangent.y, tangent.x, 0);
      if (across.lengthSq() < .001) across.set(1, 0, 0);
      across.normalize();
      const outward = new THREE.Vector3().crossVectors(tangent, across).normalize();
      const taper = Math.max(.005, (.7 + .3 * Math.sin(t * Math.PI)) * (1 - t) ** .65);
      for (let j = 0; j < sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const point = center.clone().addScaledVector(across, Math.cos(angle) * width * taper)
          .addScaledVector(outward, Math.sin(angle) * depth * taper);
        positions.push(point.x, point.y, point.z);
        if (i < rings) {
          const a = i * sides + j, b = i * sides + (j + 1) % sides;
          indices.push(a, b, a + sides, b, b + sides, a + sides);
        }
      }
    }
    const start = positions.length / 3, end = start + 1;
    positions.push(...points[0], ...points[2]);
    for (let j = 0; j < sides; j++) {
      indices.push(start, (j + 1) % sides, j);
      indices.push(end, rings * sides + j, rings * sides + (j + 1) % sides);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    this.add(g, color, [0, 0, 0]);
  }

  finish(): THREE.BufferGeometry {
    const geometry = mergeGeometries(this.pieces, false);
    for (const piece of this.pieces) piece.dispose();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const makeBody = (c: Character, look: Look): THREE.BufferGeometry => {
  const p = new Parts();
  const jersey = shade(c.outfit, c.color, look.jacket ? .2 : .48);
  const trim = shade(c.color, 0xffffff, .15);
  // A taller, pear-shaped torso with a visible neck and relaxed bent elbows.
  p.oval(jersey, [0, 1.08, -.14], [.31, .38, .23]);
  p.oval(c.skin, [0, 1.47, -.12], [.105, .16, .10]);
  p.stroke(trim, [[-.14, 1.39, -.02], [0, 1.34, .075], [.14, 1.39, -.02]], .027);
  for (const side of [-1, 1]) {
    p.oval(jersey, [side * .245, 1.29, -.1], [.12, .14, .115]);
    p.stroke(jersey, [[side * .24, 1.32, -.1], [side * .37, 1.08, .13], [side * .27, 1.07, .44]], .105, 18);
    p.stroke(c.color, [[side * .26, 1.34, -.04], [side * .36, 1.17, .13]], .028, 8);
    p.oval(trim, [side * .28, 1.065, .37], [.105, .1, .065]);
    p.oval(0xfff4df, [side * .245, 1.08, .48], [.105, .10, .085]);
    p.oval(0xfff4df, [side * .18, 1.115, .47], [.05, .06, .05]);
    // One readable crease gives the oversize gloves a little personality.
    p.stroke(0xc8bfae, [[side * .25, 1.12, .555], [side * .29, 1.10, .545]], .007, 4);
  }
  p.add(new THREE.TorusGeometry(.245, .025, 8, 32), ink, [0, 1.08, .50], [1, 1, 1], [-.35, 0, 0]);
  p.stroke(0x65768e, [[-.22, 1.08, .50], [0, 1.08, .50], [.22, 1.08, .50]], .017);
  p.stroke(0x65768e, [[0, 1.08, .50], [0, .86, .57]], .017);
  p.oval(c.color, [0, 1.08, .525], [.055, .055, .02]);
  if (look.jacket) {
    for (const side of [-1, 1]) p.stroke(trim, [[side * .12, 1.39, .02], [side * .18, 1.22, .08], [side * .075, 1.10, .105]], .025);
    p.stroke(0xe4e7ec, [[0, .82, .07], [0, 1.29, .09]], .009);
  } else {
    p.stroke(trim, [[-.12, .83, .065], [-.16, 1.03, .07], [-.14, 1.26, .05]], .018);
  }
  if (c.id === "mark") p.stroke(0xe1cf9a, [[-.13, 1.4, .025], [0, 1.22, .11], [.13, 1.4, .025]], .012);
  p.oval(c.color, [.15, 1.24, .07], [.063, .07, .02]);
  p.oval(0xfff4df, [.15, 1.25, .091], [.027, .036, .008]);
  return p.finish();
};

const addHair = (p: Parts, c: Character, look: Look): void => {
  const base = c.hair, light = new THREE.Color(base).multiplyScalar(1.5).getHex();
  const { hair } = look;
  if (hair === "bald") return;
  if (hair === "receding") {
    p.add(new THREE.SphereGeometry(1, 32, 12, Math.PI * .88, Math.PI * 1.24, .8, 1.1), base, [0, .32, -.012], [.42, .50, .35]);
    for (const side of [-1, 1]) p.lock(light, [[side * .29, .65, -.13], [side * .4, .58, -.08], [side * .37, .4, .02]], .075, .055);
    return;
  }
  const cap = new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const vertices = cap.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i), radius = Math.hypot(x, z);
    if (radius < .0001) continue;
    const theta = Math.acos(THREE.MathUtils.clamp(vertices.getY(i), -1, 1)) / (Math.PI / 2);
    const edge = 1.92 - Math.max(0, z / radius) * .84;
    const puff = hair === "curls" ? 1 + .11 * Math.sin(theta * Math.PI) * (.5 + .5 * Math.cos(Math.atan2(x, z) * 9 + theta * 7)) : 1;
    vertices.setXYZ(i, x / radius * Math.sin(theta * edge) * puff, Math.cos(theta * edge) * puff, z / radius * Math.sin(theta * edge) * puff);
  }
  cap.computeVertexNormals();
  p.add(cap, base, [0, .32, -.012], [.42, .50, .35]);
  if (hair === "bob" || hair === "long") {
    const long = hair === "long";
    for (let i = 0; i < 11; i++) {
      const a = .85 + i / 10 * (Math.PI * 2 - 1.7);
      const x = Math.sin(a), z = Math.cos(a);
      p.lock(i % 4 === 0 ? light : base, [[x * .22, .64, z * .20], [x * .41, .28, z * .33 - .015],
        [x * (long ? .48 : .43), long ? -.31 : -.02, z * .34]], .18, .115);
    }
    p.lock(light, [[.19, .74, .1], [-.05, .8, .27], [-.29, .47, .27]], .17, .075);
    p.lock(base, [[.22, .73, .08], [.31, .58, .25], [.35, .35, .16]], .12, .07);
  } else if (hair === "curls") {
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * .115;
      p.lock(i % 3 === 0 ? light : base, [[x * .8, .69, .1], [x - .035, .79, .26], [x + .025, .55 + (i % 2) * .04, .31]], .105, .10);
    }
    p.lock(base, [[.08, .72, -.08], [-.08, .94, -.015], [-.21, .84, .11]], .14, .11);
  } else if (hair === "tousled") {
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * .105;
      p.lock(i % 2 ? base : light, [[x * .8, .69, .08], [x + .025, .81, .23],
        [x - .04, i % 2 ? .59 : .53, .31]], .12, .09);
    }
    p.lock(base, [[.16, .70, -.08], [.34, .89, -.04], [.46, .83, .04]], .14, .10);
    p.lock(light, [[-.08, .71, -.08], [-.21, .94, .04], [-.31, .85, .1]], .14, .10);
  } else if (hair === "crop") {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * .11;
      p.lock(i % 2 ? base : light, [[x * .8, .70, .07], [x + .025, .73, .26], [x - .025, .54 + (i % 2) * .03, .31]], .085, .05);
    }
  } else {
    const quiff = hair === "quiff";
    for (let i = 0; i < 4; i++) {
      p.lock(i % 2 ? base : light, [[.23 - i * .035, .67, -.10 + i * .055],
        [.02 - i * .065, quiff ? .91 - i * .025 : .84 - i * .015, .04 + i * .07],
        [-.35 + i * .09, .67 - i * .035, .16 + i * .045]], .145, .10);
    }
    p.lock(base, [[.25, .70, .09], [.36, .62, .22], [.36, .39, .15]], .095, .06);
  }
};

const makeHead = (c: Character, look: Look): THREE.BufferGeometry => {
  const p = new Parts();
  const head = new THREE.SphereGeometry(1, 40, 28), position = head.attributes.position;
  const skin = new THREE.Color(c.skin), stubble = new THREE.Color(c.hair), blush = new THREE.Color(0xeb8b82);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), x = position.getX(i), z = position.getZ(i);
    position.setX(i, x * (y < 0 ? 1 + y * .18 : 1));
    const beard = look.beard ? THREE.MathUtils.smoothstep(-y, .2, .75) * THREE.MathUtils.smoothstep(z, 0, .4) * .28 : 0;
    const cheek = Math.exp(-((Math.abs(x) - .58) ** 2 * 35 + (y + .15) ** 2 * 45)) * Math.max(0, z) * .25;
    skin.setHex(c.skin).lerp(stubble, beard).lerp(blush, cheek).toArray(colors, i * 3);
  }
  head.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  head.computeVertexNormals();
  p.add(head, c.skin, [0, .32, 0], [.4, .48, .33]);
  for (const side of [-1, 1]) {
    p.oval(c.skin, [side * .4, .31, -.015], [.065, .105, .055]);
    p.oval(shade(c.skin, 0xc27867, .35), [side * .43, .31, .024], [.025, .057, .018]);
    const x = side * .15, y = .405;
    const eye = new THREE.Shape();
    eye.moveTo(x - .103, y - .038);
    eye.bezierCurveTo(x - .12, y + .085, x + .035, y + .15, x + .10, y + .055);
    eye.bezierCurveTo(x + .12, y - .045, x + .055, y - .105, x - .025, y - .09);
    eye.quadraticCurveTo(x - .08, y - .085, x - .103, y - .038);
    p.face(eye, 0xfff8e9);
    p.faceOval(ink, x + .012, y + .005, .055, .086, .016);
    p.faceOval(look.iris, x + .012, y + .002, .043, .071, .020);
    p.faceOval(ink, x + .014, y + .018, .025, .050, .024);
    p.faceOval(0xffffff, x - .005, y + .051, .019, .023, .028);
    p.faceOval(0xffffff, x + .034, y - .032, .008, .01, .028);
    p.faceLine(ink, [[x - .105, y - .01], [x - .07, y + .09], [x + .025, y + .11], [x + .10, y + .055]], .009);
    p.faceLine(c.hair, [[side * .055, .555 + look.brow], [side * .15, .58 + look.brow], [side * .255, .55 - look.brow]], .018);
    if (c.id === "mira" || c.id === "lisa") p.faceLine(ink, [[side * .235, .48], [side * .27, .50]], .009);
    p.faceLine(shade(c.skin, 0xce7869, .5), [[side * .225, .235], [side * .25, .25]], .006);
  }
  p.oval(c.skin, [0, .265, .33], [.052, .07, .067]);
  const smile = new THREE.Shape();
  smile.moveTo(-.135, .14);
  smile.quadraticCurveTo(0, .095, .145, .16);
  smile.bezierCurveTo(.12, .045 - look.smile * .06, -.10, .025 - look.smile * .04, -.135, .14);
  p.face(smile, 0x65343b, .012);
  const teeth = new THREE.Shape();
  teeth.moveTo(-.12, .132);
  teeth.quadraticCurveTo(0, .095, .13, .15);
  teeth.lineTo(.108, .105);
  teeth.quadraticCurveTo(0, .067, -.102, .094);
  teeth.closePath();
  p.face(teeth, 0xfff8e9, .018);
  if (look.smile > .75) p.faceOval(0xef7b88, .012, .047, .056, .019, .019);
  addHair(p, c, look);
  if (look.glasses) {
    for (const side of [-1, 1]) {
      const x = side * .15;
      const points: [number, number][] = [];
      if (look.glasses === "round") {
        for (let i = 0; i <= 24; i++) points.push([x + Math.cos(i / 24 * Math.PI * 2) * .127, .405 + Math.sin(i / 24 * Math.PI * 2) * .13]);
      } else {
        points.push([x - .116, .495], [x + .11, .495], [x + .118, .33], [x - .108, .33], [x - .116, .495]);
      }
      p.faceLine(ink, points, .011, .038);
      p.stroke(ink, [[side * .27, .45, faceDepth(side * .27, .45) + .038], [side * .39, .43, .16], [side * .415, .35, -.02]], .011);
    }
    p.stroke(ink, [[-.028, .43, .36], [0, .45, .37], [.028, .43, .36]], .01);
  }
  const geometry = p.finish();
  geometry.scale(look.width, look.height, 1);
  geometry.computeBoundingSphere();
  return geometry;
};

/** Shared body + head geometry for every instance of a character. */
export class DriverVisual {
  readonly root = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly phase: number;

  constructor(characterId: string) {
    const c = CHARACTERS.find((character) => character.id === characterId) ?? CHARACTERS[0];
    const look = LOOKS[c.id] ?? LOOKS.dario;
    let geometry = cache.get(c.id);
    if (!geometry) {
      geometry = { body: makeBody(c, look), head: makeHead(c, look) };
      cache.set(c.id, geometry);
    }
    this.head = new THREE.Mesh(geometry.head, material);
    this.head.position.set(0, 1.65, -.12);
    this.root.add(new THREE.Mesh(geometry.body, material), this.head);
    this.root.scale.setScalar(.88);
    this.root.position.y = -.08;
    this.phase = CHARACTERS.indexOf(c) * 1.7;
  }

  animate(time: number, slip: number, speed: number, stunned: boolean): void {
    const moving = Math.min(1, Math.abs(speed) / 30);
    this.head.rotation.y = THREE.MathUtils.clamp(slip * .4, -.3, .3) + Math.sin(time * .85 + this.phase) * .045;
    this.head.rotation.z = stunned ? Math.sin(time * 17 + this.phase) * .18 : -slip * .12 + Math.sin(time * 1.4 + this.phase) * .015;
    this.head.rotation.x = -.025 + Math.sin(time * 7 + this.phase) * .025 * moving;
    this.head.position.y = 1.65 + Math.sin(time * 2.2 + this.phase) * .012;
  }
}
