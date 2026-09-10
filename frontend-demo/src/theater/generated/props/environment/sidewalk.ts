/**
 * 人行道模块：路面板 + 斜切道牙石（前缘出路面 0.15m 高差），
 * 两端开放可沿 X 轴无缝拼接（2.0×1.2×0.15 模数）。
 */
import * as THREE from "three";
import { flatMat, numOf, type PropBuilder } from "../shared";

export const buildSidewalk: PropBuilder = (p) => {
  const g = new THREE.Group();
  const L = numOf(p.length, 2.0), W = numOf(p.width, 1.2), H = numOf(p.height, 0.15);
  const slabA = flatMat(0x9a968c, 0.9);
  const slabB = flatMat(0x918d84, 0.9);      // 明暗分块
  const curb = flatMat(0xa8a49a, 0.9);

  // 道牙立缘（临路前缘，全高）
  const curbStone = new THREE.Mesh(new THREE.BoxGeometry(L, H, 0.12), curb);
  curbStone.position.set(0, H / 2, W / 2 - 0.06);
  curbStone.receiveShadow = true;
  g.add(curbStone);
  // 人行道平板：两块明暗分块
  for (const [i, sx] of ([-1, 1] as const).entries()) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L / 2, H - 0.02, W - 0.12), i === 0 ? slabA : slabB);
    slab.position.set(sx * L / 4, (H - 0.02) / 2 + 0.02, -0.06);
    slab.receiveShadow = true;
    g.add(slab);
  }
  return g;
};
