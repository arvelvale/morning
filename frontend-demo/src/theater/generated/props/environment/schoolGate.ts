/** 校门：门柱带柱帽尖顶 + 横梁 + 匾额与示意字块。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildSchoolGate: PropBuilder = (p) => {
  const g = new THREE.Group();
  const pillarMat = flatMat(hexNum(p.color, 0x9a8a72), 0.9);
  const w = numOf(p.width, 4), h = numOf(p.height, 3);
  const mkPillar = (x: number) => {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), pillarMat);
    pil.position.set(x, h / 2, 0);
    // 柱帽：略宽的方盖 + 小尖
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), pillarMat);
    cap.position.set(x, h + 0.06, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 4), pillarMat);
    tip.position.set(x, h + 0.22, 0);
    tip.rotation.y = Math.PI / 4;
    pil.castShadow = true;
    g.add(cap, tip);
    return pil;
  };
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, 0.4), pillarMat);
  beam.position.y = h + 0.1;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.45, 0.06),
    mat("paintedWood", hexNum(p.sign, 0x8a2a2a)));
  sign.position.set(0, h + 0.1, 0.24);
  // 匾额上的示意"字"：三块浅色小方块
  const charMat = mat("paintedWood", 0xe8dcc0);
  for (let i = 0; i < 3; i++) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.02), charMat);
    ch.position.set(-w * 0.18 + i * w * 0.18, h + 0.1, 0.28);
    g.add(ch);
  }
  g.add(mkPillar(-w / 2), mkPillar(w / 2), beam, sign);
  return g;
};
