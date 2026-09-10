/** 站台：地面板（顶 0.8，propMeta 承载面基准）+ 黄色安全线 + 顶棚 + 支柱。 */
import * as THREE from "three";
import { flatMat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildPlatform: PropBuilder = (p) => {
  const g = new THREE.Group();
  const len = numOf(p.length, 24);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 8), flatMat(hexNum(p.color, 0x3c4148), 0.8));
  slab.position.y = 0.4; slab.receiveShadow = true;
  const safe = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.25), new THREE.MeshBasicMaterial({ color: 0xd8b83a }));
  safe.position.set(0, 0.81, -3);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 9), flatMat(0x4a5058, 0.7));
  roof.position.set(0, 5.2, 0.5);
  g.add(slab, safe, roof);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.5 });
  const cols = Math.max(2, Math.round(len / 8));
  for (let i = 0; i < cols; i++) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.7, 10), pillarMat);
    pil.position.set(-len / 2 + 1 + i * (len / Math.max(1, cols - 1)), 2.9, 4);
    g.add(pil);
  }
  return markShadows(g);
};
