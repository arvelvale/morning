/** 精装书：params.open 切换闭合/翻开平铺。原点=书的几何中心。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, type PropBuilder } from "../shared";

export const buildBook: PropBuilder = (p) => {
  const g = new THREE.Group();
  const cover = mat("paintedWood", hexNum(p.color, 0xb0604a));   // 硬壳彩色
  const page = flatMat(0xf0e8d0, 0.78);                          // 浅黄白内页
  const W = 0.16, D = 0.22;
  const open = p.open === true;

  if (open) {
    // 翻开平铺：左右两页微斜 + 中缝书脊
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(W / 2 - 0.005, 0.018, D), page);
      half.position.set(side * (W / 4), 0.009, 0);
      half.rotation.z = side * -0.045;
      const coverHalf = new THREE.Mesh(new THREE.BoxGeometry(W / 2 + 0.004, 0.008, D + 0.008), cover);
      coverHalf.position.set(side * (W / 4), 0.0, 0);
      coverHalf.rotation.z = side * -0.045;
      g.add(half, coverHalf);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, D + 0.006), cover);
    spine.position.y = 0.014;
    g.add(spine);
  } else {
    // 闭合：硬壳 + 内页（微内缩露出页缘）+ 书脊
    const pages = new THREE.Mesh(new THREE.BoxGeometry(W - 0.016, 0.024, D - 0.012), page);
    pages.position.y = 0.017;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, 0.004, D), cover);
    shell.position.y = 0.002;
    const lid = shell.clone();
    lid.position.y = .032;
    shell.castShadow = true;
    const spineStrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.034, D + 0.004), flatMat(hexNum(p.color, 0x8a4a3a), 0.66));
    spineStrip.position.set(-W / 2 + 0.01, 0.017, 0);
    g.add(shell, lid, pages, spineStrip);
  }
  return g;
};
