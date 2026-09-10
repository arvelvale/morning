/** 石砖地面：浅石板 + 砖缝网格线（长椅/路灯下的"微环境"贴片，flatUnderlay）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildPavement: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 5), d = numOf(p.depth, 3);
  const slab = mat("stone", hexNum(p.color, 0x9a948a));
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), slab);
  base.position.y = 0.025;
  base.receiveShadow = true;
  g.add(base);
  // 砖缝：深色细条网格（间距 ~0.9m）
  const seam = mat("stone", 0x77726a);
  const seamW = 0.025;
  for (let x = -w / 2 + 0.9; x < w / 2 - 0.2; x += 0.9) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(seamW, 0.012, d), seam);
    line.position.set(x, 0.052, 0);
    g.add(line);
  }
  for (let z = -d / 2 + 0.75; z < d / 2 - 0.2; z += 0.75) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, seamW), seam);
    line.position.set(0, 0.052, z);
    g.add(line);
  }
  return g;
};
