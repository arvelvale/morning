/** 布艺沙发：底座 + 双坐垫 + 饱满靠背 + 圆柱扶手（双人；座面顶 0.5，双座位锚点）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildSofa: PropBuilder = (p) => {
  const g = new THREE.Group();
  const cloth = mat("fabric", hexNum(p.color, 0xe8e0d5));           // 燕麦米
  const cushion = mat("fabric", new THREE.Color(hexNum(p.color, 0xe8e0d5)).offsetHSL(0, 0.01, -0.03).getHex());
  const w = numOf(p.width, 2.0);

  // 底座（有厚度）+ 四只短脚
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.85), cloth);
  base.position.y = 0.19;
  g.add(base);
  const legGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.08, 8);
  const wood = mat("wood", 0x8a6a4a);
  ([[-w / 2 + 0.1, 0.32], [w / 2 - 0.1, 0.32], [-w / 2 + 0.1, -0.32], [w / 2 - 0.1, -0.32]] as const).forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0.04, z);
    g.add(leg);
  });

  // 加厚坐垫 ×2（座面顶 ≈0.5）
  for (const cx of [-w * 0.24, w * 0.24]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w * 0.44, 0.18, 0.72), cushion);
    pad.position.set(cx, 0.43, 0.04);
    pad.userData.supportSurface = true;
    g.add(pad);
  }

  // 饱满靠背：主体 + 顶部圆枕条（微后倾）
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.52, 0.2), cloth);
  back.position.set(0, 0.62, -0.32);
  back.rotation.x = -0.07;
  const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, w, 12), cushion);
  topRoll.rotation.z = Math.PI / 2;
  topRoll.position.set(0, 0.9, -0.35);
  g.add(back, topRoll);

  // 圆润圆柱扶手 ×2
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.85, 12), cushion);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * (w / 2 - 0.1), 0.45, 0);
    g.add(arm);
  }
  return markShadows(g);
};
