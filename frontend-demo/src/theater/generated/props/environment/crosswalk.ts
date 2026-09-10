/** 斑马线：一排白色横条（贴片，backdrop 锚点 z=-1.5）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildCrosswalk: PropBuilder = (p) => {
  const g = new THREE.Group();
  const bars = Math.max(3, Math.round(numOf(p.bars, 6)));
  const paint = mat("paintedWood", hexNum(p.color, 0xe8e6e0));
  for (let i = 0; i < bars; i++) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3), paint);
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(-bars * 0.35 + i * 0.7, 0.02, 0);
    g.add(bar);
  }
  return g;
};
