/** 落叶堆：5~8 片微倾斜散落的红黄枯叶（贴片，flatUnderlay）。 */
import * as THREE from "three";
import { flatMat, numOf, type PropBuilder } from "../shared";

export const buildFallenLeaves: PropBuilder = (p) => {
  const g = new THREE.Group();
  const spread = numOf(p.spread, 0.34);
  const tones = [0xc4622d, 0xd8913a, 0xa84a2a, 0xc98a3a];
  const n = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.12), flatMat(tones[i % tones.length], 0.78));
    leaf.position.set(Math.cos(a) * r, 0.006, Math.sin(a) * r);
    leaf.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.35, 0, Math.random() * Math.PI);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
};
