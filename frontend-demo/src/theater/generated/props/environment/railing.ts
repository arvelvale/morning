/** 栏杆/围栏：金属栏杆（默认）或 params.wooden 木桩尖栅栏（贴片）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildRailing: PropBuilder = (p) => {
  const g = new THREE.Group();
  const len = numOf(p.length, 6), h = numOf(p.height, 1.0);
  const wooden = p.wooden === true;
  const steel = wooden
    ? flatMat(hexNum(p.color, 0x8a6a44), 0.9)          // 木栅栏默认暖木色
    : mat("metal", hexNum(p.color, 0x8a8f96));
  if (wooden) {
    // 乡村木桩尖栅栏：等距桩 + 桩尖（小锥）+ 两道横杆
    const posts = Math.max(3, Math.round(len / 0.55));
    for (let i = 0; i < posts; i++) {
      const x = -len / 2 + i * (len / (posts - 1));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.06), steel);
      post.position.set(x, h / 2, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.12, 4), steel);
      tip.position.set(x, h + 0.05, 0);
      tip.rotation.y = Math.PI / 4;
      post.castShadow = tip.castShadow = true;
      g.add(post, tip);
    }
    for (const ry of [h * 0.72, h * 0.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.04), steel);
      rail.position.set(0, ry, 0);
      g.add(rail);
    }
    return g;
  }
  const posts = Math.max(2, Math.round(len / 1.2));
  // 规范模块：顶扶手圆杆 + 底踢脚横杆 + 均布细竖杆
  const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, len, 10), steel);
  handrail.rotation.z = Math.PI / 2;
  handrail.position.y = h;
  const kickRail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.04), steel);
  kickRail.position.y = 0.09;
  g.add(handrail, kickRail);
  const uprights = Math.max(4, Math.round(len / 0.32));
  for (let i = 0; i < uprights; i++) {
    const x = -len / 2 + 0.1 + i * ((len - 0.2) / (uprights - 1));
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, h - 0.1, 6), steel);
    bar.position.set(x, (h - 0.1) / 2 + 0.05, 0);
    g.add(bar);
  }
  // 端柱
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, h, 8), steel);
    post.position.set(sx * len / 2, h / 2, 0);
    g.add(post);
  }
  return g;
};
