/** 岩石：双 Icosa 错位堆叠 + 压扁拉长，打破球对称。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildRock: PropBuilder = (p) => {
  // 岩石：压扁拉长打破球对称 + 顶面略平（两颗 Icosa 大小错位堆叠）
  const g = new THREE.Group();
  const s = numOf(p.size, 0.5);
  const stone = mat("stone", hexNum(p.color, 0x6b6660));
  const main = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), stone);
  main.scale.set(1.15, 0.75, 0.9);
  main.position.y = s * 0.5;
  const chip = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.45, 0), stone);
  chip.position.set(s * 0.7, s * 0.3, s * 0.3);
  chip.rotation.set(0.6, 0.3, 0.4);
  main.castShadow = chip.castShadow = true;
  g.add(main, chip);
  return g;
};
