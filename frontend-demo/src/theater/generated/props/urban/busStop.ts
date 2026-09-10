/**
 * 公交站亭（第二批规范重构）：4 金属立柱 + 微倾顶棚 + 背面亚克力挡风板 +
 * 侧站牌面板 + 一体木凳 + 顶棚下暖白筒灯（emissive + PointLight）。
 * propMeta：双座位锚点（dz=-0.35）+ inside 锚点（亭内躲雨）。
 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildBusStop: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = numOf(p.width, 3.4);
  const iron = mat("metal", hexNum(p.color, 0x3a3f46));

  // 4 根立柱
  ([[-W / 2 + 0.1, 0.55], [W / 2 - 0.1, 0.55], [-W / 2 + 0.1, -0.55], [W / 2 - 0.1, -0.55]] as const).forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.35, 10), iron);
    post.position.set(x, 1.175, z);
    g.add(post);
  });

  // 微倾平顶棚（前低后高 4°）+ 前缘檐口条
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.09, 1.7), iron);
  roof.position.set(0, 2.42, -0.05);
  roof.rotation.x = 0.07;
  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.34, 0.04, 1.76), flatMat(hexNum(p.color, 0x2e3238), 0.6));
  roofCap.position.set(0, 2.48, -0.05);
  roofCap.rotation.x = 0.07;
  g.add(roof, roofCap);

  // 背面亚克力挡风板（半透明）
  const acrylic = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.3, 1.45),
    mat("glass", 0xa8c8d0, { opacity: 0.34 })
  );
  acrylic.position.set(0, 1.32, -0.53);
  g.add(acrylic);

  // 侧站牌时刻表面板：竖面板 + 横条色块（站名示意）
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.78, 0.03), flatMat(0xe8e2d4, 0.72));
  board.position.set(W / 2 - 0.1, 1.62, -0.3);
  g.add(board);
  const lineTones = [0xc4653f, 0x4a6a9a, 0x8fa292];
  for (let i = 0; i < 3; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.012), flatMat(lineTones[i], 0.72));
    strip.position.set(W / 2 - 0.1, 1.78 - i * 0.14, -0.283);
    g.add(strip);
  }

  // 一体式木质长条候车凳（座面顶 ≈0.5，对齐 propMeta 座位锚点 dz=-0.35）
  const benchMat = flatMat(hexNum(p.seat, 0x8a7f70), 0.76);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.4), benchMat);
  bench.position.set(-0.2, 0.46, -0.35);
  bench.userData.supportSurface = true;
  const benchFront = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.05), benchMat);
  benchFront.position.set(-0.2, 0.36, -0.16);
  g.add(bench, benchFront);
  for (const bx of [-1.0, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.34), iron);
    leg.position.set(bx, 0.21, -0.35);
    g.add(leg);
  }

  // 顶棚下暖白筒灯：自发光圆片 + 向下弱 PointLight
  const lampPlate = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 12),
    mat("emissive", 0xfff0d8, { emissive: 0xfff0d8, emissiveIntensity: 1.1 })
  );
  lampPlate.rotation.x = Math.PI / 2;
  lampPlate.position.set(-0.2, 2.34, -0.2);
  const lampLight = new THREE.PointLight(0xfff0d8, 1.0, 2.8, 1.4);
  lampLight.position.set(-0.2, 2.2, -0.2);
  lampLight.castShadow = false;
  g.add(lampPlate, lampLight);

  return markShadows(g);
};
