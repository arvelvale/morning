/** 路灯：配重底座 + 渐细杆 + 球关节 + 锥形灯罩 + emissive 灯芯 + 实用点光。 */
import * as THREE from "three";
import { mat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildStreetlight: PropBuilder = (p) => {
  const g = new THREE.Group();
  const h = numOf(p.height, 3.2);
  const iron = mat("metal", hexNum(p.color, 0x2b2b30));
  // 三段式：配重底座 → 渐细主杆 → 球关节
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 12), iron);
  base.position.y = 0.07;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, h - 0.2, 10), iron);
  post.position.y = (h - 0.2) / 2 + 0.1;
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), iron);
  joint.position.y = h - 0.06;
  // 灯罩（锥形开口向下）+ 内芯暖光泡 + 实用光
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.26, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: hexNum(p.color, 0x30343c), roughness: 0.5, metalness: 0.6, flatShading: true, side: THREE.DoubleSide })
  );
  shade.position.y = h + 0.06;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    mat("emissive", 0xffe6b0, { emissive: 0xffd88a, emissiveIntensity: 1.4 })
  );
  bulb.position.y = h - 0.02;
  const light = new THREE.PointLight(0xffdca0, numOf(p.intensity, 1.6), numOf(p.range, 12), 1.5);
  light.position.y = h;
  g.add(markShadows(base), markShadows(post), joint, shade, bulb, light);
  // 灯下暖色聚光：在地面投出一块光斑（"留守 vs 远行"的舞台隐喻）
  const spot = new THREE.SpotLight(0xffd9a0, 2.4, 9, 0.72, 0.55, 1.3);
  spot.position.set(0, h - 0.08, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = false;                      // 预算：阴影只归 mood key light
  g.add(spot, spot.target);
  return g;
};
