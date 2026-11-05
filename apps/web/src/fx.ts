import * as THREE from "three";
import { missileBodyGeometry, missileBodyMaterial } from "./item-model.ts";

/** A carried missile uses the same cached geometry and colors as the projectile. */
export const makeRackMissile = (): THREE.Mesh => {
  const missile = new THREE.Mesh(missileBodyGeometry, missileBodyMaterial);
  missile.scale.setScalar(.62);
  return missile;
};
