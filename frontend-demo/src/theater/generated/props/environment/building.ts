/** 单栋楼：楼体 + 压檐 + 入口门斗 + 窗格阵列（门位留空）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildBuilding: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 5), h = numOf(p.height, 8), d = numOf(p.depth, 4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(hexNum(p.color, 0xb8a894), 1));
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  // 楼顶压檐 + 地面入口门斗
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.3, d * 1.05), flatMat(hexNum(p.color, 0x9a8c7c), 1));
  cornice.position.y = h - 0.15;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 0.5), mat("wood", 0x4a3a2c));
  door.position.set(0, 0.95, d / 2 + 0.15);
  g.add(cornice, door);
  const winMat = mat("emissive", hexNum(p.window, 0x8fb0d8), { emissive: hexNum(p.window, 0x8fb0d8), emissiveIntensity: 0.35 });
  const cols = Math.max(2, Math.floor(w / 1.2)), rows = Math.max(2, Math.floor(h / 1.6));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && Math.abs(-w / 2 + 0.8 + (c * (w - 1.6)) / Math.max(1, cols - 1)) < 0.9) continue;   // 门位留空
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), winMat);
      win.position.set(
        -w / 2 + 0.8 + (c * (w - 1.6)) / Math.max(1, cols - 1),
        1 + (r * (h - 1.6)) / Math.max(1, rows - 1),
        d / 2 + 0.01,
      );
      g.add(win);
    }
  }
  return g;
};
