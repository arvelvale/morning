/** 智能手机：深灰背壳 + 凸起摄像模组 + 微发光屏幕。原点=机身中心（握持点）。 */
import * as THREE from "three";
import { mat, flatMat, type PropBuilder } from "../shared";

export const buildPhone: PropBuilder = () => {
  const g = new THREE.Group();
  // 背壳（微圆角观感：双层叠合）
  const shell = mat("standard", 0x2a2d33);         // 暖炭灰，不用纯黑
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.148, 0.009), shell);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.032, 0.005), shell);
  cam.position.set(-0.016, 0.05, -0.006);
  const lens1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 8), flatMat(0x3a3f4a, 0.4));
  lens1.rotation.x = Math.PI / 2;
  lens1.position.set(-0.022, 0.056, -0.009);
  const lens2 = lens1.clone();
  lens2.position.y = 0.044;
  // 屏幕：微发光冷光薄片
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.064, 0.136),
    mat("emissive", 0x9fc4ff, { emissive: 0x9fc4ff, emissiveIntensity: 0.55 })
  );
  screen.position.z = 0.0052;
  g.add(body, cam, lens1, lens2, screen);
  return g;
};
