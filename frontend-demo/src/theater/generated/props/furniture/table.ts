/** 圆桌：椭圆短圆柱桌面 + 裙板 + 四条锥形腿（P3 升级版）。 */
import * as THREE from "three";
import { flatMat, hexNum, markShadows, numOf, type PropBuilder } from "../shared";

export const buildTable: PropBuilder = (p) => {
  const g = new THREE.Group();
  const wood = flatMat(hexNum(p.color, 0x7a5636), 0.9);
  const w = numOf(p.width, 1.4), d = numOf(p.depth, 0.8), h = numOf(p.height, 0.74);
  // 桌面：短圆柱代替方板（圆角轮廓），叠一层深色裙板显厚度
  const topR = Math.min(w, d) / 2;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(topR * 1.28, topR * 1.28, 0.055, 24), wood);
  if (w !== d) top.scale.set(w / (topR * 2.56), 1, d / (topR * 2.56));   // 长桌拉成椭圆
  top.position.y = h - 0.03;
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .09, 24), flatMat(hexNum(p.color, 0x6a4a30), 0.92));
  apron.scale.set(w * .44, 1, d * .44);
  apron.position.y = h - 0.11;
  g.add(top, apron);
  // 四条锥形腿（下端略细），内收摆在裙板角下
  const legGeo = new THREE.CylinderGeometry(0.038, 0.05, h - 0.08, 10);
  const lx = w * .3, lz = d * .3; // keep legs under the elliptical top
  ([[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]] as const).forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, (h - 0.08) / 2, z);
    g.add(leg);
  });
  return markShadows(g);
};
