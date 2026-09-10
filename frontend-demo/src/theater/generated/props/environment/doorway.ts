/**
 * 立体门套（框景道具）：带 0.25m 进深的"门"字形通道，加厚门梁 +
 * 立柱内外踢脚线凸起。可独立作房间隔断过道，或与 door 组件组合。
 */
import * as THREE from "three";
import { flatMat, numOf, markShadows, type PropBuilder } from "../shared";

export const buildDoorway: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = numOf(p.width, 1.48), H = numOf(p.height, 2.3), D = numOf(p.depth, 0.25);
  const concrete = flatMat(0xb0aaa0, 0.9);
  const concreteDark = flatMat(0x9c968c, 0.9);

  // 双立柱（带厚度）
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, H, D), concrete);
    pillar.position.set(sx * (W / 2 - 0.09), H / 2, 0);
    pillar.castShadow = true;
    g.add(pillar);
    // 内外踢脚线凸起（底部，略厚于柱身）
    for (const side of [1, -1]) {
      const skirting = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.03), concreteDark);
      skirting.position.set(sx * (W / 2 - 0.09), 0.06, side * (D / 2 + 0.005));
      g.add(skirting);
    }
  }
  // 加厚门梁
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.28, D), concrete);
  lintel.position.y = H + 0.02;
  lintel.castShadow = true;
  g.add(lintel);
  // 梁下沿压条
  const lintelTrim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.05, D + 0.03), concreteDark);
  lintelTrim.position.y = H - 0.1;
  g.add(lintelTrim);
  return markShadows(g);
};
