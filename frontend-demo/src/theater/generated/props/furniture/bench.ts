/** 长凳：三条木板拼合座面 + 金属 A 形支撑（座高 ≈0.45-0.48，propMeta 双座位锚点基准）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, markShadows, numOf, type PropBuilder } from "../shared";

export const buildBench: PropBuilder = (p) => {
  const g = new THREE.Group();
  const wood = flatMat(hexNum(p.color, 0x6b4a30), 0.9);
  const iron = mat("metal", 0x3a3d42);
  const w = numOf(p.width, 1.6);
  // 座板：三条木条拼合，条间留镂空缝隙；座高保持 ≈0.44-0.48
  for (const dz of [-.14, 0, .14]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(w * .89, 0.07, 0.14), wood);
    slat.position.set(0, 0.45, dz);
    slat.userData.supportSurface = true;
    g.add(slat);
  }
  // 两端铁艺支撑：双细柱 + 顶横把兼扶手
  ([[-w / 2 + 0.16], [w / 2 - 0.16]] as const).forEach(([x]) => {
    for (const dz of [-0.13, 0.13]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), iron);
      post.position.set(x, 0.22, dz);
      g.add(post);
    }
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.3, 0.045), iron);
    armPost.position.set(x, 0.6, 0);
    const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.46), iron);
    armBar.position.set(x, 0.74, 0);
    g.add(armPost, armBar);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.44), iron);
    foot.position.set(x, 0.02, 0);
    g.add(foot);
  });
  return markShadows(g);
};
