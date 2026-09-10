/** 木货箱：箱体 + 上下边框条 + 斜撑（顶面 = size，自动承载面）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildCrate: PropBuilder = (p) => {
  const s = numOf(p.size, 0.6);
  const g = new THREE.Group();
  const wood = mat("wood", hexNum(p.color, 0x8a6a44));
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood);
  body.position.y = s / 2;
  // 四条边框条 + 一根斜撑：货箱的木构细节
  const slat = mat("wood", new THREE.Color(hexNum(p.color, 0x8a6a44)).offsetHSL(0, -0.03, -0.05).getHex());
  for (const dy of [s * 0.12, s * 0.88]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, s * 0.1, s * 1.04), slat);
    bar.position.y = dy;
    g.add(bar);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(s * 1.06, 0.05, s * 0.06), slat);
  brace.position.set(0, s / 2, s * 0.53);
  brace.rotation.z = 0.7;
  body.castShadow = true;
  g.add(body, brace);
  return g;
};
