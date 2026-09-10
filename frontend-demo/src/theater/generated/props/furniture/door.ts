/**
 * 房门：门框 + 门板（带球形把手）。原点=地面中心；门板 pivot 在门轴侧，
 * params.open ∈ [0,1] 控制 0°~90° 开门（0 关闭默认）。
 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildDoor: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = numOf(p.width, 1.0), H = numOf(p.height, 2.05);
  const frameMat = flatMat(hexNum(p.frame, 0x7a684e), 0.72);
  const leafMat = mat("paintedWood", hexNum(p.color, 0xc8b8a0));

  // 门框：双柱 + 顶梁（有厚度）
  for (const sx of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.14), frameMat);
    jamb.position.set(sx * (W / 2 - 0.05), H / 2, 0);
    g.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.14), frameMat);
  lintel.position.set(0, H - 0.05, 0);
  g.add(lintel);

  // 门板：pivot 在左门轴侧（原点规范：门轴旋转边缘），open 参数旋转 0~90°
  const leafW = W - 0.12;
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2 + 0.1, 0, 0);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, H - 0.12, 0.055), leafMat);
  leaf.position.set(leafW / 2, (H - 0.12) / 2, 0);
  leaf.castShadow = true;
  hinge.add(leaf);
  // 凹槽造型两块 + 球形把手
  for (const py of [0.62, 1.32]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.2, 0.52, 0.02), flatMat(hexNum(p.color, 0xbba890), 0.66));
    panel.position.set(leafW / 2, py, 0.032);
    hinge.add(panel);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat("metal", 0xc8b090));
  knob.position.set(leafW - 0.09, 1.0, 0.05);
  hinge.add(knob);
  const open = Math.min(1, Math.max(0, numOf(p.open, 0)));
  hinge.rotation.y = -open * Math.PI * 0.5;
  g.add(hinge);
  return markShadows(g);
};
