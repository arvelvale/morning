/** 信息牌：暗底牌 + emissive 发光屏 + 示意字行 + 双吊杆，呼吸亮度动画。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildDepartureBoard: PropBuilder = (p) => {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.12), mat("metal", 0x0c1018));
  const glowMat = mat("emissive", hexNum(p.color, 0x22d3aa), { emissive: hexNum(p.color, 0x22d3aa), emissiveIntensity: 1.1 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.9), glowMat);
  glow.position.z = 0.061;
  for (let i = 0; i < 3; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.4 - i * 0.3, 0.12), new THREE.MeshBasicMaterial({ color: 0x0c1018 }));
    line.position.set(-0.1 + i * 0.05, 0.25 - i * 0.25, 0.08);
    g.add(line);
  }
  // 双吊杆 + 顶部横梁
  const rodMat = mat("metal", 0x2a3038);
  ([[-1.2], [1.2]] as const).forEach(([x]) => {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), rodMat);
    rod.position.set(x, 0.95, 0);
    g.add(rod);
  });
  g.add(board, glow);
  g.position.y = numOf(p.height, 3.4);
  const base = glowMat.color.getHex();
  const emiBase = glowMat.emissive.getHex();
  g.userData.update = (t: number) => {
    const k = 0.85 + Math.sin(t * 1.2) * 0.15;
    glowMat.color.setHex(base).multiplyScalar(k);
    glowMat.emissive.setHex(emiBase).multiplyScalar(k);
  };
  return g;
};
