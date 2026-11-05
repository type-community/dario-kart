import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { jetGeometry, jetMaterial } from "./effect-materials.ts";

const pieces: THREE.BufferGeometry[] = [];
const add = (g: THREE.BufferGeometry, color: number) => {
  const geometry = g.index ? g.toNonIndexed() : g;
  if (geometry !== g) g.dispose();
  geometry.deleteAttribute("uv");
  const tint = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  pieces.push(geometry);
};
add(new THREE.CapsuleGeometry(.26, .8, 6, 20).rotateX(Math.PI / 2), 0xfff0d5);
add(new THREE.SphereGeometry(.265, 20, 12).scale(1, 1, 1.35).translate(0, 0, .51), 0xff4e70);
add(new THREE.TorusGeometry(.265, .035, 8, 24).translate(0, 0, .25), 0x243352);
add(new THREE.CylinderGeometry(.22, .27, .24, 16).rotateX(Math.PI / 2).translate(0, 0, -.63), 0x26344b);
add(new THREE.TorusGeometry(.21, .038, 8, 20).translate(0, 0, -.77), 0xffbf5c);
for (let i = 0; i < 4; i++) {
  const shape = new THREE.Shape();
  shape.moveTo(.18, -.28); shape.lineTo(.52, -.58); shape.quadraticCurveTo(.56, -.71, .45, -.69);
  shape.lineTo(.19, -.55); shape.closePath();
  const fin = new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: true, bevelSize: .025, bevelThickness: .02, bevelSegments: 2, steps: 1 });
  // The fin is authored in X/Z, then repeated around the rocket's forward axis.
  fin.rotateX(Math.PI / 2);
  fin.rotateZ(i * Math.PI / 2);
  add(fin, i % 2 ? 0xffbe52 : 0xff4e70);
}
// Small angry eyes on the upper shell make it read as a playful, dangerous item.
for (const side of [-1, 1]) {
  add(new THREE.SphereGeometry(1, 12, 8).scale(.075, .026, .10).rotateY(side * -.3).translate(side * .11, .247, .06), 0x20263d);
  add(new THREE.SphereGeometry(.023, 10, 6).scale(1, .5, 1).translate(side * .11, .275, .07), 0xffe995);
}
const bodyGeometry = mergeGeometries(pieces, false);
for (const g of pieces) g.dispose();
pieces.length = 0;
const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .18 });
export { bodyGeometry as missileBodyGeometry, bodyMaterial as missileBodyMaterial };

/** Two shared-geometry meshes; the jet owns only its small set of uniforms. */
export class MissileVisual {
  readonly root = new THREE.Group();
  private readonly jet = new THREE.Mesh(jetGeometry, jetMaterial(0xff9345));

  constructor() {
    this.root.add(new THREE.Mesh(bodyGeometry, bodyMaterial));
    this.jet.position.z = -.78;
    this.root.add(this.jet);
    this.root.visible = false;
  }

  update(time: number): void {
    this.jet.material.uniforms.uTime.value = time;
    this.jet.scale.set(1, 1, .85 + Math.sin(time * 43) * .16);
  }

  dispose(): void {
    this.jet.material.dispose();
  }
}

export const MISSILE_ICON = `<svg viewBox="0 0 80 80" role="img" aria-label="Outage Missile" width="100%" height="100%">
  <path d="M19 53 8 73 29 62Z" fill="#ffb544"/><path d="m22 54-7 14 14-8" fill="#fff3a7"/>
  <path d="m24 44-12 1 5-17 19 3M36 57l-1 12 17-5-3-20" fill="#ff5076" stroke="#20263d" stroke-width="3" stroke-linejoin="round"/>
  <path d="M22 48C30 24 49 10 68 12c2 19-12 38-36 46Z" fill="#fff1d5" stroke="#20263d" stroke-width="3"/>
  <path d="M51 15c7-3 12-4 17-3 1 6 0 12-3 18Z" fill="#ff5076"/>
  <path d="m28 43 10 10" stroke="#20263d" stroke-width="5"/><path d="m46 28 9 4-9 6Z" fill="#20263d"/>
</svg>`;

export const TOKEN_MAXING_ICON = `<svg viewBox="0 0 80 80" role="img" aria-label="Token Maxing" width="100%" height="100%">
  <path d="m8 28 9-15 9 15M54 28l9-15 9 15" fill="#c59aff" stroke="#20263d" stroke-width="3" stroke-linejoin="round"/>
  <path d="M17 25v13m46-13v13" stroke="#c59aff" stroke-width="6"/>
  <path d="m40 15 24 14v28L40 71 16 57V29Z" fill="#ffb63e" stroke="#20263d" stroke-width="4" stroke-linejoin="round"/>
  <path d="m40 22 17 10v21L40 63 23 53V32Z" fill="#ffdf78" stroke="#fff2be" stroke-width="3"/>
  <path d="M28 51V36l12 9 12-9v15" fill="none" stroke="#6b397e" stroke-width="6" stroke-linejoin="round"/>
  <path d="m40 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#fff3bf"/>
</svg>`;
