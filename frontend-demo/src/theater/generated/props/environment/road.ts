/** 沥青路面：沿 X 轴长条 + 中线虚线 + 两侧路缘石（backdrop，锚点 z=2，rotY 转路向）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildRoad: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 8), len = numOf(p.length, 40);
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(len, w),
    mat("roadSurf", hexNum(p.color, 0x3a3d42)));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.01;
  surface.receiveShadow = true;
  g.add(surface);
  // 两侧路缘石：略高出路面，收住路面边界
  const curbMat = mat("stone", 0x8a8a82);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.22), curbMat);
    curb.position.set(0, 0.045, side * (w / 2 + 0.11));
    g.add(curb);
  }
  const dashMat = mat("emissive", hexNum(p.line, 0xd8c86a), { emissive: hexNum(p.line, 0xd8c86a), emissiveIntensity: 0.25 });
  for (let i = 0; i < Math.floor(len / 3); i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.18), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(-len / 2 + 1 + i * 3, 0.02, 0);
    g.add(dash);
  }
  return g;
};
