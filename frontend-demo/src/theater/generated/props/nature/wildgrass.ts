/**
 * 草丛：4~6 片三角/五边形叶片呈放射状展开（规范 grassPatch 形态），可选小花。
 * 叶片为压扁三棱锥，确定性随机（以 size 为种）。
 */
import * as THREE from "three";
import { flatMat, numOf, markShadows, type PropBuilder } from "../shared";

export const buildWildgrass: PropBuilder = (p) => {
  const g = new THREE.Group();
  const size = numOf(p.size, 0.3);
  const rand = (() => {
    let s = Math.floor(size * 7919) % 233280;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  })();
  const tones = [0x8fa75a, 0x7a9348, 0x9ab266, 0x6f8a42];
  const blades = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rand() * 0.5;
    const r = size * (0.3 + rand() * 0.45);
    const h = size * (1.1 + rand() * 0.7);
    // 三棱压扁叶片：放射展开 + 向外倾斜
    const blade = new THREE.Mesh(new THREE.ConeGeometry(size * 0.16, h, 3), flatMat(tones[i % tones.length], 0.82));
    blade.scale.z = 0.32;
    blade.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    blade.rotation.y = -a;
    blade.rotation.x = 0.18 + rand() * 0.22;          // 向外倾斜
    blade.castShadow = true;
    g.add(blade);
  }
  // 小花 1~2 朵（可关）
  if (p.flowers !== false) {
    const petals = [0xe8d8e0, 0xe0b8c0, 0xf0e6c8];
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = size * (0.2 + rand() * 0.4);
      const stemH = size * (1.15 + rand() * 0.35);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, stemH, 4), flatMat(0x8a9a5a, 0.82));
      stem.position.set(Math.cos(a) * r, stemH / 2, Math.sin(a) * r);
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), flatMat(petals[i % petals.length], 0.78));
      bloom.position.set(Math.cos(a) * r, stemH, Math.sin(a) * r);
      g.add(stem, bloom);
    }
  }
  return markShadows(g);
};
