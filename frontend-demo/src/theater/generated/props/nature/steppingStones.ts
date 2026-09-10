/** 汀步石板路：5~7 块不规则扁石沿微弯路径排布（乡村小院的归家小径；贴片）。 */
import * as THREE from "three";
import { mat, numOf, type PropBuilder } from "../shared";

export const buildSteppingStones: PropBuilder = (p) => {
  const g = new THREE.Group();
  const len = numOf(p.length, 4.5);
  const stones = Math.max(4, Math.round(numOf(p.count, 6)));
  const stone = mat("stone", 0x8f8a80);
  for (let i = 0; i < stones; i++) {
    const t = i / (stones - 1);
    // 微弯：x 随 t 正弦偏移
    const z = -len / 2 + t * len;
    const x = Math.sin(t * Math.PI * 1.2 + 0.4) * 0.5;
    const s = 0.34 + (i % 2) * 0.08 + Math.random() * 0.05;
    const slab = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), stone);
    slab.scale.set(1, 0.18, 0.82);
    slab.position.set(x, 0.03, z);
    slab.rotation.y = Math.random() * Math.PI;
    slab.receiveShadow = true;
    slab.castShadow = true;
    g.add(slab);
  }
  return g;
};
