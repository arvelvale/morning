/** 柴火垛：圆木两层交错堆叠 + 捆绳（墙角乡村生活气息道具）。 */
import * as THREE from "three";
import { mat, numOf, markShadows, type PropBuilder } from "../shared";

export const buildFirewood: PropBuilder = (p) => {
  const g = new THREE.Group();
  const logLen = numOf(p.length, 0.7);
  const woodTones = [0x7a5a38, 0x6a4c2e, 0x8a6a44];
  const ringMat = mat("wood", 0xb8a078);        // 圆木截面浅色年轮端面
  // 下层 4 根 + 上层 3 根交错
  const rows = [
    { y: 0.07, n: 4, offset: 0 },
    { y: 0.2, n: 3, offset: 0.09 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const tone = woodTones[(i + row.y * 10) % woodTones.length];
      const logMat = mat("wood", tone);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, logLen, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.position.set(row.offset + (i - (row.n - 1) / 2) * 0.135, row.y, 0);
      log.rotation.y = (Math.random() - 0.5) * 0.06;
      // 端面年轮片
      for (const dz of [-logLen / 2 + 0.005, logLen / 2 - 0.005]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 8), ringMat);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(log.position.x, row.y, dz + log.rotation.y * 0);
        cap.position.z = dz + log.position.z;
        g.add(cap);
      }
      g.add(log);
    }
  }
  // 捆绳：竖环两道
  for (const bx of [-0.18, 0.18]) {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 6, 14), mat("fabric", 0x8a7a5a));
    rope.position.set(bx, 0.14, 0);
    rope.rotation.y = Math.PI / 2;
    g.add(rope);
  }
  return markShadows(g);
};
