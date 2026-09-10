/**
 * 窗帘：顶部金属滑轨 + 顶点波浪褶皱布帘（双开微拢）。
 * 顶点原点=背部贴墙面（z=0 即墙面），布面 z 起伏朝室内。
 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildCurtain: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = numOf(p.width, 1.7), H = numOf(p.height, 2.2);
  const cloth = mat("fabric", hexNum(p.color, 0xd8c8b0));

  // 滑轨：金属横杆 + 两端端盖
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, W + 0.22, 8), mat("metal", 0x8a8f96));
  rail.rotation.z = Math.PI / 2;
  rail.position.y = H;
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat("metal", 0x8a8f96));
    cap.position.set(sx * (W / 2 + 0.11), H, 0);
    g.add(cap);
  }
  g.add(rail);

  // 双开布帘：两片 Plane，顶点做竖向波浪褶皱（z 向起伏），微透明透柔光
  const mkPanel = (side: 1 | -1) => {
    const pw = W * 0.46;
    const geo = new THREE.PlaneGeometry(pw, H, 14, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const u = (x + pw / 2) / pw;                       // 0..1 片内位置
      pos.setZ(i, Math.sin(u * Math.PI * 3.4) * 0.055 + Math.sin(u * Math.PI * 7) * 0.02);
    }
    geo.computeVertexNormals();
    const panel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: cloth.color.getHex(), roughness: 0.82, flatShading: false,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    }));
    // 左片拢向左缘、右片拢向右缘（微收拢的褶皱堆叠感）
    panel.position.set(side * (W * 0.27), H / 2 - 0.02, 0);
    panel.rotation.y = side * -0.12;
    g.add(panel);
  };
  mkPanel(-1);
  mkPanel(1);
  return g;
};
