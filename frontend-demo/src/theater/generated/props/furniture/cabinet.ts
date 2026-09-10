/** 双门边柜：扁长柜体 + 竖向把手 + 悬空细金属腿（台面顶 ≈0.7 自动承载）。 */
import * as THREE from "three";
import { mat, flatMat, markShadows, type PropBuilder } from "../shared";

export const buildCabinet: PropBuilder = () => {
  const g = new THREE.Group();
  const W = 1.2, H = 0.7, D = 0.4;
  const wood = mat("wood", 0x9a7a52);
  const doorTone = flatMat(0x8a6a44, 0.72);

  // 台面（微出檐）
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.04, D + 0.03), wood);
  top.position.y = H - 0.02;
  // 柜体
  const body = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, H - 0.14, D - 0.02), doorTone);
  body.position.y = (H - 0.14) / 2 + 0.1;
  // 双门缝 + 两条竖向把手
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, H - 0.18, 0.012), flatMat(0x4a3a28, 0.74));
  seam.position.y = body.position.y;
  seam.position.z = D / 2;
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.22, 6), mat("metal", 0x9aa0a8));
    grip.position.set(sx * 0.09, body.position.y, D / 2 + 0.02);
    g.add(grip);
  }
  // 悬空细金属腿 ×4
  for (const [sx, sz] of ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), mat("metal", 0x6a7078));
    leg.position.set(sx * (W / 2 - 0.09), 0.08, sz * (D / 2 - 0.06));
    g.add(leg);
  }
  g.add(top, body, seam);
  return markShadows(g);
};
