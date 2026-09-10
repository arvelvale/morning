/** 串灯：悬垂暖光灯泡阵列，呼吸闪烁（sag 控制垂弧）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildStringLights: PropBuilder = (p) => {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(numOf(p.count, 10)));
  const span = numOf(p.span, 4), sag = numOf(p.sag, 0.5), h = numOf(p.height, 2.4);
  const bulbs: THREE.Mesh[] = [];
  const bulbMat = mat("emissive", hexNum(p.color, 0xffd48a), { emissive: hexNum(p.color, 0xffd48a), emissiveIntensity: 1.0 });
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bulbMat);
    bulb.position.set((u - 0.5) * span, h - Math.sin(u * Math.PI) * sag, 0);
    bulbs.push(bulb); g.add(bulb);
  }
  g.userData.update = (t: number) => {
    bulbs.forEach((b, i) => {
      const m = b.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.7 + 0.35 * Math.sin(t * 1.5 + i * 0.6);
    });
  };
  return g;
};
