/** 背景墙：墙身 + 踢脚线 + 压顶条（贴片，不与前景件互挤）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildWall: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 4), h = numOf(p.height, 2.6);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.12),
    mat("paintedWood", hexNum(p.color, 0xcabfa8))
  );
  body.position.y = h / 2;
  body.receiveShadow = true;
  // 踢脚线 + 压顶条：墙面的上下收口
  const trim = mat("wood", new THREE.Color(hexNum(p.color, 0xcabfa8)).offsetHSL(0, -0.04, -0.09).getHex());
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(w * 1.005, 0.14, 0.16), trim);
  skirting.position.y = 0.07;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.08, 0.18), trim);
  cap.position.y = h - 0.04;
  g.add(body, skirting, cap);
  return g;
};
