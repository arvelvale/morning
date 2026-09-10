/** 户外咖啡桌：圆桌面 + 支柱 + 底盘。 */
import * as THREE from "three";
import { flatMat, hexNum, markShadows, type PropBuilder } from "../shared";

export const buildCafeTable: PropBuilder = (p) => {
  const g = new THREE.Group();
  const iron = flatMat(hexNum(p.color, 0x8a7a5a), 0.8);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20), iron);
  top.position.y = 0.72;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 8), iron);
  pole.position.y = 0.36;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.05, 16), iron);
  base.position.y = 0.03;
  g.add(top, pole, base);
  return markShadows(g);
};
