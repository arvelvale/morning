/** 高铁列车：鼻锥车头 + 腰线 + 车窗灯带 + 车顶设备箱，带停站微晃动画。 */
import * as THREE from "three";
import { mat, hexNum, type PropBuilder } from "../shared";

export const buildTrain: PropBuilder = (p) => {
  const g = new THREE.Group();
  const shell = mat("metal", hexNum(p.color, 0xdfe4ea));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.55, 20, 8, 16), shell);
  body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 0.82); body.position.y = 1.75; body.castShadow = true;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(21, 0.22, 2.62),
    new THREE.MeshStandardMaterial({ color: hexNum(p.stripe, 0x2a5aa8), roughness: 0.4 }));
  stripe.position.y = 1.5;
  // 车头鼻锥（压扁球）+ 驾驶窗（深色玻璃弧带）
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), shell);
  nose.scale.set(1.4, 0.9, 0.75);
  nose.position.set(11.2, 1.75, 0);
  const winStrip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.24), mat("glass", 0x1c2836, { opacity: 0.8 }));
  winStrip.position.set(10.4, 2.2, 0);
  g.add(body, stripe, nose, winStrip);
  const winMat = mat("emissive", 0xffe8b8, { emissive: 0xffe0a0, emissiveIntensity: 0.55 });
  for (let i = 0; i < 10; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.02), winMat);
    win.position.set(-9 + i * 2.1, 2.25, 1.28);
    g.add(win);
  }
  // 车顶设备箱两台（空调机组）
  const boxMat = mat("metal", 0x8a9198);
  ([[3.2], [-4.8]] as const).forEach(([x]) => {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 1.1), boxMat);
    ac.position.set(x, 3.16, 0);
    g.add(ac);
  });
  g.userData.update = (t: number) => { g.position.y = Math.sin(t * 2.2) * 0.008; };
  return g;
};
