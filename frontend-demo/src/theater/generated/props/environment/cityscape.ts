/** 城市剪影：高低错落楼群 + 零星亮窗（远景 backdrop，z=-38）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildCityscape: PropBuilder = (p) => {
  const g = new THREE.Group();
  const bodyMat = mat("stone", hexNum(p.color, 0x1a2438));
  const winMat = mat("emissive", hexNum(p.window, 0xffd48a), { emissive: hexNum(p.window, 0xffd48a), emissiveIntensity: 0.9 });
  const count = Math.max(4, Math.round(numOf(p.count, 12)));
  const lit = p.lit !== false;
  for (let i = 0; i < count; i++) {
    const w = 3 + Math.random() * 5;
    const h = 5 + Math.random() * 12;
    const x = -count * 4 + i * 8 + Math.random() * 3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), bodyMat);
    b.position.set(x, h / 2, -Math.random() * 8);
    g.add(b);
    if (lit) {
      for (let r = 0; r < Math.floor(h / 1.6); r++) {
        if (Math.random() > 0.5) continue;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), winMat);
        win.position.set(x + (Math.random() - 0.5) * (w - 1), 1 + r * 1.6, b.position.z + 1.51);
        g.add(win);
      }
    }
  }
  return g;
};
