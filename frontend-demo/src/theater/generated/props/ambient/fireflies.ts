/** 萤火虫：上下飘动的暖黄光点，带明灭呼吸。 */
import * as THREE from "three";
import { hexNum, numOf, type PropBuilder } from "../shared";

export const buildFireflies: PropBuilder = (p) => {
  const count = Math.round(numOf(p.count, 30));
  const area = numOf(p.area, 6);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = 0.3 + Math.random() * 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area;
    seed[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const base = new Float32Array(pos);
  const m = new THREE.PointsMaterial({ color: hexNum(p.color, 0xffe9a0), size: 0.12, transparent: true, opacity: 0.9, depthWrite: false });
  const pts = new THREE.Points(geo, m);
  pts.userData.update = (t: number) => {
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = base[i * 3] + Math.sin(t * 0.5 + seed[i]) * 0.4;
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.7 + seed[i] * 1.3) * 0.3;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.4 + seed[i]) * 0.4;
    }
    geo.attributes.position.needsUpdate = true;
    m.opacity = 0.6 + 0.35 * Math.sin(t * 2);
  };
  return pts;
};
