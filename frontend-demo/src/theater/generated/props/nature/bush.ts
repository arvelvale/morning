/** 灌木：五个细分团块错位堆成一丛，顶部提亮、底部压暗，偶尔点缀几颗小果。 */
import * as THREE from "three";
import { hexNum, numOf, type PropBuilder } from "../shared";
import { jitterRadial, paintByNormal, vertexColorMaterial } from "./shape";

export const buildBush: PropBuilder = (p) => {
  const g = new THREE.Group();
  const s = numOf(p.size, 0.5);
  const base = hexNum(p.color, 0x2f5330);
  const light = new THREE.Color(base).offsetHSL(0.03, 0.06, 0.12).getHex();
  const material = vertexColorMaterial(0.9);
  ([[0, 0.0, 0, 1.0], [0.62, -0.08, 0.2, 0.72], [-0.6, -0.1, -0.1, 0.74], [0.08, -0.06, -0.58, 0.66], [0.05, 0.36, 0.04, 0.7]] as const).forEach(([x, y, z, r], i) => {
    const geo = jitterRadial(new THREE.IcosahedronGeometry(s * r, 1), 0.1, 20 + i);
    geo.scale(1, 0.88, 1);
    const b = new THREE.Mesh(paintByNormal(geo, new THREE.Color(base).offsetHSL(0, 0, -0.03 * i).getHex(), light, 0.7), material);
    b.position.set(x * s, s * 0.52 * r + y * s + 0.04, z * s); b.castShadow = true;
    g.add(b);
  });
  if (p.berries !== false) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8503e, roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6, r = s * (0.55 + (i % 2) * 0.2);
      const berry = new THREE.Mesh(new THREE.SphereGeometry(s * 0.045, 6, 5), bm);
      berry.position.set(Math.cos(a) * r, s * (0.55 + (i % 3) * 0.12), Math.sin(a) * r * 0.9);
      g.add(berry);
    }
  }
  return g;
};
