/** 相框：木框 + 白衬边 + 微自发光照片 + 支架。 */
import * as THREE from "three";
import { mat, hexNum, markShadows, type PropBuilder } from "../shared";

export const buildPhotoFrame: PropBuilder = (p) => {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.03), mat("wood", hexNum(p.frame, 0x5b4a3a)));
  // 白色衬边（相纸留白）夹在框与照片之间
  const matte = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), mat("fabric", 0xe8e2d4));
  matte.position.z = 0.016;
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), mat("emissive", hexNum(p.photo, 0xb8c6d8), { emissive: hexNum(p.photo, 0xb8c6d8), emissiveIntensity: 0.12 }));
  photo.position.z = 0.023;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.02), mat("wood", 0x5b4a3a));
  stand.position.set(0, -0.18, -0.08); stand.rotation.x = 0.4;
  g.add(frame, matte, photo, stand);
  return markShadows(g);
};
