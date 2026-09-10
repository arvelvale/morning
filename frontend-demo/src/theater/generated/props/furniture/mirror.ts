/** 落地全身镜：黑铁边框 + 后倾 5° 支架；镜面低粗糙微偏青冷（近似反射质感）。 */
import * as THREE from "three";
import { mat, flatMat, markShadows, type PropBuilder } from "../shared";

export const buildMirror: PropBuilder = () => {
  const g = new THREE.Group();
  const frameMat = mat("metal", 0x3a3d42);       // 黑铁
  const W = 0.55, H = 1.7;

  // 镜组整体微后倾 5°
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.087;
  tilt.position.y = 0.06;
  // 边框四条（有厚度 0.045）
  for (const sy of [-1, 1]) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.045), frameMat);
    hBar.position.set(0, sy * (H / 2 - 0.025), 0);
    tilt.add(hBar);
  }
  for (const sx of [-1, 1]) {
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.1, 0.045), frameMat);
    vBar.position.set(sx * (W / 2 - 0.025), 0, 0);
    tilt.add(vBar);
  }
  // 镜面：极低粗糙 + 青冷色（无 envmap，以高光近似反射）
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.09, H - 0.14),
    new THREE.MeshStandardMaterial({
      color: 0xd4e6f1, roughness: 0.06, metalness: 0.55,
      emissive: 0x1a262c, emissiveIntensity: 0.4,
    })
  );
  mirror.position.z = 0.012;
  tilt.add(mirror);
  g.add(tilt);

  // 后撑斜柱 + 底横杆
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8), frameMat);
  strut.position.set(0, 0.34, -0.24);
  strut.rotation.x = 0.5;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.06), frameMat);
  foot.position.set(0, 0.025, -0.32);
  g.add(strut, foot);
  return markShadows(g);
};
