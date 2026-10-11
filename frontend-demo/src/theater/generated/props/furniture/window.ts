/** 窗：木框 + 十字窗棂 + 窗台 + 自发光窗玻璃（挂墙贴片，at.bias 贴近墙面）。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildWindow: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 1.2), h = numOf(p.height, 1.4);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.08), mat("wood", hexNum(p.frame, 0x5b4a3a)));
  // 十字窗棂 + 窗台
  const muntin = mat("wood", hexNum(p.frame, 0x5b4a3a));
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.045, h, 0.05), muntin);
  barV.position.z = 0.045;
  const barH = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, 0.05), muntin);
  barH.position.z = 0.045;
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.06, 0.14), muntin);
  sill.position.set(0, -h / 2 - 0.04, 0.05);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    mat("emissive", hexNum(p.glow, 0xf4d9a0), { emissive: hexNum(p.glow, 0xf4d9a0), emissiveIntensity: 0.75, opacity: 0.86, transparent: true })
  );
  pane.position.z = 0.05;
  g.add(frame, barV, barH, sill, pane);
  // 离地高度放在内层：根节点保持在原点，装配时 pos.y 不会把窗台高度抹掉
  g.position.y = numOf(p.sill, 1.2) + h / 2;
  const root = new THREE.Group();
  root.add(g);
  return root;
};
