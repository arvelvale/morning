/** 雨：下落粒子（顶点循环，area/height 参数控制范围；相对原点自含，通常配 at 固定）。 */
import * as THREE from "three";
import { hexNum, numOf, type PropBuilder } from "../shared";

export const buildRain: PropBuilder = (p) => {
  const count = Math.round(numOf(p.count, 240));
  const area = numOf(p.area, 14), height = numOf(p.height, 12);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area;
    speed[i] = 6 + Math.random() * 6;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: hexNum(p.color, 0x9fb6d8), size: 0.06, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  let last = 0;
  pts.userData.update = (t: number) => {
    const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speed[i] * dt;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] += height;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
};
