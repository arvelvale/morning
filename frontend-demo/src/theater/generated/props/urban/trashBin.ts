/** 街头分类垃圾桶：灰绿/灰蓝双联箱体 + 斜顶投放口 + 加厚底座（dropAnchor=投放口）。 */
import * as THREE from "three";
import { mat, flatMat, markShadows, type PropBuilder } from "../shared";

export const buildTrashBin: PropBuilder = () => {
  const g = new THREE.Group();
  const green = mat("standard", 0x7f917f);
  const blue = mat("standard", 0x7f8fa0);
  const dark = flatMat(0x2c2c30, 0.78);

  // 加厚底座
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.38), dark);
  base.position.y = 0.035;
  g.add(base);

  // 双联箱体（可回收/不可回收）
  for (const [i, tone] of ([0, 1] as const).entries()) {
    const bin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.6, 0.32), i === 0 ? green : blue);
    bin.position.set(i === 0 ? -0.2 : 0.2, 0.38, 0);
    bin.castShadow = true;
    g.add(bin);
    // 投放口斜顶（带屋檐状斜盖 + 前脸分类色块）
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.025, 0.36), dark);
    lid.position.set(i === 0 ? -0.2 : 0.2, 0.7, -0.02);
    lid.rotation.x = -0.28;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.01), flatMat(0x1a1a1e, 0.8));
    hole.position.set(i === 0 ? -0.2 : 0.2, 0.6, 0.163);
    g.add(lid, hole);
  }
  return markShadows(g);
};
