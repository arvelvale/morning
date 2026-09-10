/** 落地灯：配重底座 + 金属杆 + 锥形灯罩 + emissive 灯芯 + 实用点光。 */
import * as THREE from "three";
import { mat, hexNum, numOf, type PropBuilder } from "../shared";

export const buildLamp: PropBuilder = (p) => {
  const g = new THREE.Group();
  // 落地灯：金属杆 + 锥形灯罩 + 内芯光
  const iron = mat("metal", 0x2b2b30);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.05, 10), iron);
  base.position.y = 0.025;
  const rodH = numOf(p.height, 1.4) - 0.3;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, rodH, 8), iron);
  rod.position.y = rodH / 2 + 0.05;
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.22, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc9a878, roughness: 0.7, flatShading: true, side: THREE.DoubleSide })
  );
  shade.position.y = rodH + 0.16;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 10, 8),
    mat("emissive", hexNum(p.color, 0xffe6b0), { emissive: hexNum(p.color, 0xffd88a), emissiveIntensity: 1.2 })
  );
  bulb.position.y = rodH + 0.1;
  const light = new THREE.PointLight(hexNum(p.color, 0xffcc88), numOf(p.intensity, 1.4), numOf(p.range, 8), 1.4);
  light.position.y = numOf(p.height, 1.4);
  g.add(base, rod, shade, bulb, light);
  return g;
};
