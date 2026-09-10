/** 地毯：深色织边 + 内芯微抬双层（贴片，propMeta flatUnderlay）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildRug: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 2), d = numOf(p.depth, 1.4);
  // 双层：外圈深色织边 + 内芯微抬，织物感
  const border = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.018, d),
    mat("fabric", hexNum(p.color, 0x8a4a3a))
  );
  border.position.y = 0.009;
  border.receiveShadow = true;
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.82, 0.014, d * 0.78),
    mat("fabric", new THREE.Color(hexNum(p.color, 0x8a4a3a)).offsetHSL(0, 0.02, 0.07).getHex())
  );
  inner.position.y = 0.016;
  inner.receiveShadow = true;
  g.add(border, inner);
  return g;
};
