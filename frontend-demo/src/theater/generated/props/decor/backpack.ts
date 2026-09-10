/** 学生双肩包：主包身 + 前袋 + 顶部提手 + 两条背带（原点=底面中心，可落地/上桌）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, markShadows, type PropBuilder } from "../shared";

export const buildBackpack: PropBuilder = (p) => {
  const g = new THREE.Group();
  const cloth = mat("fabric", hexNum(p.color, 0xc47a3a));         // 与人物背包同色系
  const dark = flatMat(hexNum(p.color, 0x9a5c2a), 0.78);

  // 主包身：下箱体 + 顶部圆弧（压扁半球）
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.16), cloth);
  body.position.y = 0.17;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  dome.scale.set(1, 0.62, 0.92);
  dome.position.y = 0.32;
  g.add(body, dome);

  // 前置小口袋 + 拉链线
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.05), dark);
  pocket.position.set(0, 0.15, 0.095);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.01), flatMat(0x5a3a1c, 0.7));
  zip.position.set(0, 0.22, 0.122);
  g.add(pocket, zip);

  // 顶部提手：小拱环
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 12, Math.PI), dark);
  handle.position.y = 0.415;
  g.add(handle);

  // 背带：两条竖向弯曲带（后侧）
  for (const sx of [-0.09, 0.09]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 14, Math.PI * 1.15), dark);
    strap.position.set(sx, 0.3, -0.085);
    strap.rotation.y = Math.PI;                     // 朝后弯
    g.add(strap);
  }
  return markShadows(g);
};
