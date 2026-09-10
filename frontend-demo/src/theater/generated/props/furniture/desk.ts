/** 写字桌：倒角观感桌面 + 左侧三层抽屉柜体 + 右侧双腿，桌下留腿部空隙。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildDesk: PropBuilder = (p) => {
  const g = new THREE.Group();
  const wood = mat("wood", hexNum(p.color, 0x9a7a52));
  const w = numOf(p.width, 1.4), d = numOf(p.depth, 0.7), h = numOf(p.height, 0.75);

  // 桌面：厚板（0.06）+ 前缘收边条，倒角观感
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), wood);
  top.position.y = h - 0.03;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.02), flatMat(hexNum(p.color, 0x86683f), 0.72));
  edge.position.y = h - 0.06;
  g.add(top, edge);

  // 左侧抽屉柜体：三层面板 + 球形把手
  const drawerW = 0.42;
  const body = new THREE.Mesh(new THREE.BoxGeometry(drawerW, h - 0.08, d - 0.06), wood);
  body.position.set(-w / 2 + drawerW / 2 + 0.03, (h - 0.08) / 2 + 0.06, 0);
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const face = new THREE.Mesh(new THREE.BoxGeometry(drawerW - 0.06, 0.15, 0.02), flatMat(hexNum(p.color, 0x86683f), 0.66));
    face.position.set(-w / 2 + drawerW / 2 + 0.03, 0.24 + i * 0.19, d / 2 - 0.02);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat("metal", 0xb8a878));
    knob.position.set(face.position.x, face.position.y, d / 2 + 0.01);
    g.add(face, knob);
  }

  // 右侧双腿（桌下留出推椅空隙）
  for (const dz of [-d / 2 + 0.06, d / 2 - 0.06]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, h - 0.06, 0.06), wood);
    leg.position.set(w / 2 - 0.08, (h - 0.06) / 2, dz);
    g.add(leg);
  }
  return markShadows(g);
};
