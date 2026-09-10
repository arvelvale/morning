/** 电话亭：红框 + 半透玻璃 + 顶冠 + 门把手 + 暖色内光（深夜通话意象；内部地面=原点）。 */
import * as THREE from "three";
import { mat, hexNum, type PropBuilder } from "../shared";

export const buildPhoneBooth: PropBuilder = (p) => {
  const g = new THREE.Group();
  const frameMat = mat("paintedWood", hexNum(p.color, 0x9a3b3b));
  const w = 0.95, h = 2.4, d = 0.95;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), frameMat);
  base.position.y = 0.06;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.18, d + 0.1), frameMat);
  roof.position.y = h;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(w + 0.22, 0.06, d + 0.22), frameMat);
  crown.position.y = h + 0.12;
  g.add(base, roof, crown);
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sz]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), frameMat);
    post.position.set(sx * (w / 2 - 0.04), h / 2, sz * (d / 2 - 0.04));
    g.add(post);
  });
  const glassMat = mat("glass", 0xbfe0e8, { opacity: 0.22 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.4), glassMat);
  front.position.set(0, h / 2, d / 2 - 0.02);
  const left = front.clone(); left.rotation.y = Math.PI / 2; left.position.set(-w / 2 + 0.02, h / 2, 0);
  const right = left.clone(); right.position.x = w / 2 - 0.02;
  g.add(front, left, right);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.28, d + 0.12),
    mat("emissive", hexNum(p.sign, 0xffcf8a), { emissive: hexNum(p.sign, 0xffcf8a), emissiveIntensity: 0.8 }));
  sign.position.y = h - 0.16;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), mat("metal", 0x8a8f96));
  handle.position.set(w / 2 - 0.1, 1.2, d / 2 + 0.02);
  const light = new THREE.PointLight(0xffd9a0, 1.1, 4, 1.6);
  light.position.set(0, h - 0.5, 0);
  g.add(sign, handle, light);
  return g;
};
