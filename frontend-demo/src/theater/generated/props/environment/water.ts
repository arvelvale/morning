/** 水面：顶点波动 shader + 月光反射带（backdrop 大件，权威锚点 z=-16）。 */
import * as THREE from "three";
import { numOf, type PropBuilder } from "../shared";

export const buildWater: PropBuilder = (p) => {
  const geo = new THREE.PlaneGeometry(numOf(p.width, 60), numOf(p.depth, 60), 60, 40);
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 0.25 + time * 0.9) * 0.22
                + sin(p.y * 0.4 + time * 0.6) * 0.15
                + sin((p.x + p.y) * 0.15 + time * 1.3) * 0.1;
        p.z += w;
        vWave = w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.02, 0.06, 0.12);
        vec3 shallow = vec3(0.05, 0.12, 0.2);
        vec3 col = mix(deep, shallow, vUv.y + vWave * 0.5);
        float band = exp(-pow((vUv.x - 0.5) * 6.0, 2.0));
        float shimmer = 0.5 + 0.5 * sin(vUv.y * 120.0 + time * 2.0 + vWave * 8.0);
        col += vec3(0.85, 0.82, 0.65) * band * shimmer * (0.12 + vUv.y * 0.3);
        col += vec3(0.3, 0.35, 0.5) * smoothstep(0.85, 1.0, vUv.y) * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.rotation.x = -Math.PI / 2;
  sea.userData.update = (t: number) => { mat.uniforms.time.value = t; };
  return sea;
};
