import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { RaceEffects } from "../src/effects.ts";
import { MissileVisual } from "../src/item-model.ts";

const at = new THREE.Vector3(1, 2, 3), up = new THREE.Vector3(0, 1, 0);
const meshes = (fx: RaceEffects) => fx.root.children.filter((part): part is THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> => part instanceof THREE.Mesh);
const lights = (fx: RaceEffects) => fx.root.children.filter((part): part is THREE.PointLight => part instanceof THREE.PointLight);

describe("race effect budgets and time", () => {
  test("a pile-up reuses the same fixed buffers and two lights", () => {
    const fx = new RaceEffects(), before = meshes(fx).map((mesh) => mesh.geometry.getAttribute("aOrigin").array);
    for (let i = 0; i < 300; i++) fx.impact(at, up);
    fx.update(1 / 60);
    expect(fx.root.children.length).toBe(4);
    expect(lights(fx).length).toBe(2);
    expect(meshes(fx).map((mesh) => mesh.geometry.instanceCount)).toEqual([192, 768]);
    meshes(fx).forEach((mesh, i) => {
      expect(mesh.geometry.getAttribute("aOrigin").array).toBe(before[i]);
      for (const attribute of Object.values(mesh.geometry.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    });
    fx.dispose();
  });

  test("30, 60 and 120 Hz produce the same lifetime and light decay", () => {
    const samples = [30, 60, 120].map((fps) => {
      const fx = new RaceEffects();
      fx.impact(at, up);
      for (let i = 0; i < fps / 10; i++) fx.update(1 / fps);
      const result = [meshes(fx)[0].material.uniforms.uTime.value, lights(fx)[0].intensity];
      fx.dispose();
      return result;
    });
    for (const sample of samples) {
      expect(sample[0]).toBeCloseTo(.1, 8);
      expect(sample[1]).toBeCloseTo(samples[0][1], 8);
    }
  });

  test("paused feedback stays still; expired effects and lights finish", () => {
    const fx = new RaceEffects();
    fx.impact(at, up);
    fx.update(.05);
    for (let i = 0; i < 20; i++) fx.update(0);
    expect(meshes(fx)[0].material.uniforms.uTime.value).toBe(.05);
    fx.update(2);
    expect(lights(fx).every((light) => light.intensity === 0)).toBe(true);
    for (const mesh of meshes(fx)) {
      const lives = mesh.geometry.getAttribute("aLife");
      for (let i = 0; i < lives.count; i++) expect(lives.getX(i) + lives.getY(i)).toBeLessThan(mesh.material.uniforms.uTime.value);
    }
    fx.dispose();
  });

  test("reduced motion keeps the contact cue but suppresses impact lighting", () => {
    const fx = new RaceEffects();
    fx.impact(at, up, true);
    fx.update(.01, true);
    expect(lights(fx).every((light) => light.intensity === 0)).toBe(true);
    expect(meshes(fx)[1].geometry.getAttribute("aLife").getY(0)).toBeGreaterThan(0);
    fx.dispose();
  });

  test("missile instances share geometry while keeping independent jet uniforms", () => {
    const a = new MissileVisual(), b = new MissileVisual();
    const aBody = a.root.children[0] as THREE.Mesh, bBody = b.root.children[0] as THREE.Mesh;
    const aJet = a.root.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const bJet = b.root.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(aBody.geometry).toBe(bBody.geometry);
    expect(aJet.geometry).toBe(bJet.geometry);
    expect(aJet.material).not.toBe(bJet.material);
    a.update(2); b.update(4);
    expect(aJet.material.uniforms.uTime.value).toBe(2);
    expect(bJet.material.uniforms.uTime.value).toBe(4);
    a.dispose(); b.dispose();
  });
});
