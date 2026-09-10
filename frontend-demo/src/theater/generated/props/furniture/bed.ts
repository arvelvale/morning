/** 床：木床架 + 床垫 + 软包床头（床头球）+ 双枕 + 搭毯，织物质感（原点贴地）。 */
import * as THREE from "three";
import { mat, hexNum, markShadows, type PropBuilder } from "../shared";

export const buildBed: PropBuilder = (p) => {
  const g = new THREE.Group();
  const sheet = mat("fabric", hexNum(p.color, 0x39415a));
  const frameWood = mat("wood", 0x4a3a30);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, 1.8), frameWood);
  frame.position.y = 0.22;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.18, 1.72), sheet);
  mattress.position.y = 0.52;
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.9), mat("fabric", hexNum(p.pillow, 0x5a647e)));
  pillow.position.set(-0.7, 0.66, 0);
  const pillow2 = pillow.clone();
  pillow2.position.z = 0.62; pillow2.position.x = -0.68;
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.7), mat("fabric", hexNum(p.blanket, 0x4a3a52)));
  blanket.position.set(0.3, 0.63, 0);
  // 床头软包：圆角高板 + 两颗床头球
  const headMat = mat("paintedWood", 0x3a3230);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.14), headMat);
  head.position.set(0, 0.62, -1.0);
  ([[-0.9], [0.9]] as const).forEach(([x]) => {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), headMat);
    knob.position.set(x, 1.1, -1.0);
    g.add(knob);
  });
  g.add(frame, mattress, pillow, pillow2, blanket, head);
  return markShadows(g);
};
