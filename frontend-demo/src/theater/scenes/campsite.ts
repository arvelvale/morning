/** 深夜通话 · 露营地：帐篷、篝火、松林、星空 */
import * as THREE from "three";
import { createSkyDome, createStars, createMoon, createMountains, createGround } from "../utils";
import { createPineTree } from "../generated/props/nature/pineTree";
import { createFigure } from "../figure";
import type { TheaterScene } from "../types";

export function create(): TheaterScene {
  const group = new THREE.Group();

  const sky = createSkyDome({ top: 0x070d1f, bottom: 0x16223d, clouds: { color: 0x41537c, shade: 0x1b2744, amount: 0.4 } });
  group.add(sky);
  const stars = createStars({ count: 1100 });
  group.add(stars);
  group.add(createMoon({ size: 3.5, height: 40, angle: 0.5 }));
  group.add(createMountains({ color: 0x0d1728, count: 8, radius: 75 }));
  group.add(createGround({ color: 0x2c3f36 }));

  // 松林环绕
  for (let i = 0; i < 14; i++) {
    const t = createPineTree({ height: 3 + Math.random() * 2.5, color: 0x10281a });
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 22;
    t.position.set(Math.sin(a) * r, 0, -Math.cos(a) * r * 0.8 - 4);
    t.rotation.y = Math.random() * Math.PI;
    group.add(t);
  }

  // 帐篷（三棱柱）
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xc46a3a, roughness: 0.85, flatShading: true });
  const tent = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 3, 1), tentMat);
  tent.rotation.z = Math.PI / 2;
  tent.rotation.y = Math.PI / 2;
  tent.position.set(-3.2, 0.75, -2.5);
  tent.castShadow = true;
  group.add(tent);
  // 帐篷入口（深色三角）
  const door = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 3),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 })
  );
  door.position.set(-1.88, 0.72, -2.5);
  door.rotation.y = Math.PI / 2;
  group.add(door);
  // 帐内微光
  const tentLight = new THREE.PointLight(0xff9a4d, 0.8, 6);
  tentLight.position.set(-2.6, 0.8, -2.5);
  group.add(tentLight);

  // 篝火：木柴 + 火焰 + 光源
  const fireGroup = new THREE.Group();
  fireGroup.position.set(0.5, 0, -1.5);
  const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 5) * Math.PI;
    log.position.y = 0.1;
    fireGroup.add(log);
  }
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.9, 7),
    new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.85 })
  );
  flameOuter.position.y = 0.55;
  const flameInner = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.55, 6),
    new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.95 })
  );
  flameInner.position.y = 0.5;
  fireGroup.add(flameOuter, flameInner);
  const fireLight = new THREE.PointLight(0xff8844, 2.2, 18, 1.6);
  fireLight.position.y = 0.9;
  fireLight.castShadow = true;
  fireGroup.add(fireLight);
  // 火星粒子
  const sparkGeo = new THREE.BufferGeometry();
  const sparkCount = 24;
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkSeed = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) { sparkSeed[i] = Math.random(); }
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffaa44, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  fireGroup.add(sparks);
  group.add(fireGroup);

  // 人物：坐在篝火旁打电话
  const me = createFigure({ bodyColor: 0x7a8ba8, pose: "phone" });
  me.position.set(1.8, 0, -0.6);
  me.rotation.y = -Math.PI * 0.65;
  group.add(me);
  // 坐的原木
  const sitLog = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8), logMat);
  sitLog.rotation.z = Math.PI / 2;
  sitLog.position.set(1.8, 0.22, -0.85);
  sitLog.castShadow = true;
  group.add(sitLog);
  me.position.y = -0.35; // 坐姿沉到原木高度

  // 环境光 + 月光
  // 夜景要「黑但看得清」：冷色月光打底，篝火是唯一的暖焦点
  group.add(new THREE.AmbientLight(0x4a5c80, 1.5));
  group.add(new THREE.HemisphereLight(0xadc4df, 0x596b78, 0.9));
  const moonLight = new THREE.DirectionalLight(0xa4bce0, 1.3);
  moonLight.position.set(20, 35, 25);
  group.add(moonLight);

  function update(t: number) {
    sky.userData.update(t);
    stars.userData.update(t);
    // 火焰跳动
    const f1 = Math.sin(t * 11) * 0.5 + Math.sin(t * 23 + 1.3) * 0.3 + Math.sin(t * 5 + 0.6) * 0.2;
    flameOuter.scale.set(1 + f1 * 0.12, 1 + f1 * 0.22, 1 + f1 * 0.12);
    flameInner.scale.set(1 - f1 * 0.1, 1 + f1 * 0.3, 1 - f1 * 0.1);
    fireLight.intensity = 2.2 + f1 * 0.5;
    // 火星上升
    const pos = sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < sparkCount; i++) {
      const life = (t * 0.4 + sparkSeed[i]) % 1;
      pos[i * 3] = Math.sin(sparkSeed[i] * 40 + t) * 0.15;
      pos[i * 3 + 1] = 0.4 + life * 1.6;
      pos[i * 3 + 2] = Math.cos(sparkSeed[i] * 31 + t * 0.8) * 0.15;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    (sparks.material as THREE.PointsMaterial).opacity = 0.7 + Math.sin(t * 3) * 0.2;
  }

  return {
    group,
    update,
    camera: { pos: [4.5, 2.2, 4.5], look: [0, 0.8, -1.2] },
  };
}
