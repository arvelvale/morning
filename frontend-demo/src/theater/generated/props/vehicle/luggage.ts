/** 行李箱：复用 figure.createLuggage 本体 + 包边框条 + 四角铆钉。 */
import { createLuggage } from "../../../figure";
import * as THREE from "three";
import { mat, hexNum, type PropBuilder } from "../shared";

export const buildLuggage: PropBuilder = (p) => {
  const g = createLuggage({ color: hexNum(p.color, 0xb05c4a) });
  // 行李箱边框条 + 四角铆钉：识别度小细节
  const trim = mat("wood", 0x7a4638);
  const body = g.children[0];
  if (body && "geometry" in body) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.52, 0.23), trim);
    frame.position.copy(body.position);
    g.add(frame);
  }
  const boltGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const boltMat = mat("metal", 0xc8b090);
  ([[0.18, 0.32, 0.11], [-0.18, 0.32, 0.11], [0.18, 0.32, -0.11], [-0.18, 0.32, -0.11]] as const).forEach(([x, y, z]) => {
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.set(x, y, z);
    g.add(bolt);
  });
  return g;
};
