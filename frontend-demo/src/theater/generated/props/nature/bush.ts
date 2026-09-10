/** 灌木：三大一小错位球团，上层提亮。 */
import * as THREE from "three";
import { mat, hexNum, markShadows, numOf, type PropBuilder } from "../shared";

export const buildBush: PropBuilder = (p) => {
  const g = new THREE.Group();
  const s = numOf(p.size, 0.5);
  // 三大一小错位球 + 上层略提亮，自然的灌木团感
  const base = hexNum(p.color, 0x2f5330);
  const matA = mat("foliage", base);
  const matB = mat("foliage", new THREE.Color(base).offsetHSL(0.015, 0.04, 0.05).getHex());
  ([[0, 0, 0, 1], [0.35, -0.05, 0.1, 0.7], [-0.3, -0.02, -0.1, 0.75]] as const).forEach(([x, y, z, r], i) => {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s * r, 0), i === 0 ? matA : matB);
    b.position.set(x * s, s * 0.6 + y, z * s);
    g.add(b);
  });
  const sprig = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.4, 0), matA);
  sprig.position.set(s * 0.1, s * 1.0, -s * 0.05);
  g.add(sprig);
  return markShadows(g);
};
