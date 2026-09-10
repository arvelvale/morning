/** 床头柜：柜体+抽屉拉手+开放底腔+四根小斜腿（台面顶 ≈0.565 自动承载）。 */
import * as THREE from "three";
import { mat, flatMat, markShadows, type PropBuilder } from "../shared";

export const buildBedsideTable: PropBuilder = () => {
  const g = new THREE.Group();
  const wood = mat("wood", 0x8a6a4a);
  const dark = flatMat(0x6a4e34, 0.74);

  // 台面板（微出檐）
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.03, 0.47), wood);
  top.position.y = 0.55;
  // 柜体（抽屉层）
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.44), wood);
  body.position.y = 0.385;
  const drawerFace = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.02), dark);
  drawerFace.position.set(0, 0.385, 0.23);
  const knob = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12), mat("metal", 0xb8a878));
  knob.position.set(0, 0.385, 0.25);
  g.add(top, body, drawerFace, knob);

  // 底部开放空腔：后背板 + 左右侧板（留出置物空隙）
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.02), wood);
  back.position.set(0, 0.12, -0.21);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.44), wood);
    side.position.set(sx * 0.21, 0.12, 0);
    g.add(side);
  }
  g.add(back);

  // 四根小斜腿
  for (const [sx, sz] of ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.16, 8), wood);
    leg.position.set(sx * 0.18, 0.02, sz * 0.18);
    leg.rotation.z = sx * 0.08;
    leg.rotation.x = sz * 0.08;
    g.add(leg);
  }
  return markShadows(g);
};
