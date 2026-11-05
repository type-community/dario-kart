import * as THREE from "three";

/** A nozzle-anchored, flowing jet. UV.y runs from the nozzle to the tail. */
export const jetGeometry = new THREE.ConeGeometry(.32, 1.6, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -.8);

export const jetMaterial = (color: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
  transparent: true, depthWrite: false, side: THREE.FrontSide,
  blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: `
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      vUv = uv;
      vec3 p = position;
      float flutter = sin(uv.y * 18. - uTime * 35. + uv.x * 12.) * .06 * uv.y;
      p.xy *= 1. + flutter;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uColor;
    void main() {
      float flow = .72 + .28 * sin(vUv.y * 24. - uTime * 42. + sin(vUv.x * 25.) * 2.);
      float fade = pow(1. - vUv.y, .65);
      vec3 tint = mix(uColor, vec3(1., .98, .87), pow(1. - vUv.y, 5.));
      gl_FragColor = vec4(tint, fade * flow * .62);
      #include <colorspace_fragment>
    }
  `,
});

export const pickupRingMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 p = vec4(position, 1.);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      vec2 p = vUv * 2. - 1.;
      float r = length(p), a = atan(p.y, p.x) + uTime * .8;
      float arc = smoothstep(-.5, -.2, sin(a * 6.));
      float ring = (1. - smoothstep(.025, .05, abs(r - .72))) * arc;
      float outer = (1. - smoothstep(.008, .025, abs(r - .92))) * .35;
      float glow = exp(-abs(r - .72) * 18.) * .2;
      gl_FragColor = vec4(.35, .82, 1., (ring + outer + glow) * (.65 + .15 * sin(uTime * 3.)));
      #include <colorspace_fragment>
    }
  `,
});
