/** 站牌/街口路牌：法兰盘底座 + 深灰金属杆 + 顶挂双面标牌（浅米白底 + 色块条纹）。 */
import * as THREE from "three";
import { mat, flatMat, numOf, markShadows, type PropBuilder } from "../shared";

export const buildSignBoard: PropBuilder = (p) => {
  const g = new THREE.Group();
  const H = numOf(p.height, 2.3);
  const iron = mat("metal", 0x3a3f46);

  // 法兰盘 + 杆
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 12), iron);
  flange.position.y = 0.02;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, H, 10), iron);
  post.position.y = H / 2;
  g.add(flange, post);

  // 双面标牌：浅米白底 + 极简色块条纹（站名/线路示意）
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.03), flatMat(0xe8e2d4, 0.72));
  board.position.y = H - 0.28;
  g.add(board);
  const tones = [0xc4653f, 0x4a6a9a, 0x8fa292];
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.24 + (i === 0 ? 0.18 : 0), 0.045, 0.01), flatMat(tones[i], 0.72));
      strip.position.set(-0.03, H - 0.38 + i * 0.09, side * 0.017);
      g.add(strip);
    }
  }
  return markShadows(g);
};
