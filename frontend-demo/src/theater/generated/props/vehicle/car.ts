/** 低多边形小车：漆面车身 + 玻璃座舱 + 轮毂圈 + 车头灯；params.drive 缓慢驶过循环。 */
import * as THREE from "three";
import { mat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildCar: PropBuilder = (p) => {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const bodyMat = mat("paintedWood", hexNum(p.color, 0x7a8a9a));   // 漆面质感
  const glass = mat("glass", 0x223344, { opacity: 0.55 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.55, 1.5), bodyMat);
  lower.position.y = 0.52;
  const cabinFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 1.3), bodyMat);
  cabinFrame.position.set(-0.2, 1.06, 0);
  // 座舱玻璃：前/侧三片，深色低透
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 1.16), glass);
  windshield.position.set(0.72, 1.08, 0);
  const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 0.05), glass);
  sideGlassL.position.set(-0.2, 1.12, 0.64);
  const sideGlassR = sideGlassL.clone(); sideGlassR.position.z = -0.64;
  inner.add(lower, cabinFrame, windshield, sideGlassL, sideGlassR);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.85 });
  const hubMat = mat("metal", 0xb8bcc2);
  ([[-1.1, 0.75], [1.1, 0.75], [-1.1, -0.75], [1.1, -0.75]] as const).forEach(([x, z]) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 14), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.3, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 10), hubMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.3, z * 1.02);
    inner.add(wheel, hub);
  });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false });
  ([-0.55, 0.55] as const).forEach((z) => {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), headMat);
    head.position.set(1.72, 0.6, z);
    inner.add(head);
  });
  markShadows(inner);
  g.add(inner);
  if (p.drive) {
    const span = numOf(p.driveSpan, 24), speed = numOf(p.driveSpeed, 2.2);
    g.userData.update = (t: number) => { inner.position.x = ((t * speed) % span) - span / 2; };
  }
  return g;
};
