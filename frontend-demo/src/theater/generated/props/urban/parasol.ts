/** 遮阳伞：伞杆 + 八角伞面 + 伞尖。 */
import * as THREE from "three";
import { flatMat, hexNum, type PropBuilder } from "../shared";

export const buildParasol: PropBuilder = (p) => {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), flatMat(0x8a7a5a, 0.8));
  pole.position.y = 1.2;
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 8), flatMat(hexNum(p.color, 0xcf7a5a), 1));
  canopy.position.y = 2.35;
  canopy.castShadow = true;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), flatMat(0x6a5a4a, 0.8));
  tip.position.y = 2.63;
  g.add(pole, canopy, tip);
  return g;
};
