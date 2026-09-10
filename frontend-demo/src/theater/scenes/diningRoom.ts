/** 家中餐桌：暖光吊灯下，两个人物相对而坐 */
import * as THREE from "three";
import { createChair } from "../generated/props/furniture/chair";
import { createFigure } from "../figure";
import type { TheaterScene } from "../types";

export function create(): TheaterScene {
  const group = new THREE.Group();

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 1 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x7a5f42, roughness: 0.9 });

  // 地板 + 三面墙
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 10), floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  group.add(floor);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 4.5, 0.2), wallMat);
  backWall.position.set(0, 2.25, -5);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, 10), wallMat);
  leftWall.position.set(-6, 2.25, 0);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 10), wallMat);
  ceil.position.set(0, 4.5, 0);
  group.add(backWall, leftWall, ceil);

  // 餐桌
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.7, flatShading: true });
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.4), tableMat);
  top.position.y = 0.78;
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.74, 8);
  ([[-1.05, -0.55], [1.05, -0.55], [-1.05, 0.55], [1.05, 0.55]] as const).forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, tableMat);
    leg.position.set(x, 0.39, z);
    table.add(leg);
  });
  group.add(table);

  // 餐具：两碗两杯 + 中间一盘菜
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.6 });
  const bowlGeo = new THREE.CylinderGeometry(0.11, 0.07, 0.09, 12);
  const bowl1 = new THREE.Mesh(bowlGeo, bowlMat); bowl1.position.set(-0.55, 0.87, -0.35);
  const bowl2 = new THREE.Mesh(bowlGeo, bowlMat); bowl2.position.set(0.55, 0.87, 0.35);
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xa85a3a, roughness: 0.6 });
  const cupGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.1, 10);
  const cup1 = new THREE.Mesh(cupGeo, cupMat); cup1.position.set(-0.3, 0.87, -0.5);
  const cup2 = new THREE.Mesh(cupGeo, cupMat); cup2.position.set(0.3, 0.87, 0.5);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.05, 14), bowlMat);
  dish.position.set(0, 0.85, 0);
  const food = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xc88a4a, roughness: 1, flatShading: true }));
  food.position.set(0, 0.87, 0);
  group.add(bowl1, bowl2, cup1, cup2, dish, food);

  // 菜肴热气
  const steamGeo = new THREE.BufferGeometry();
  const steamCount = 10;
  const steamPos = new Float32Array(steamCount * 3);
  const steamSeed = new Float32Array(steamCount);
  for (let i = 0; i < steamCount; i++) steamSeed[i] = Math.random();
  steamGeo.setAttribute("position", new THREE.BufferAttribute(steamPos, 3));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.06, transparent: true, opacity: 0.18, depthWrite: false,
  }));
  group.add(steam);

  // 吊灯（暖光主角）
  const lampGroup = new THREE.Group();
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  cord.position.y = 3.95;
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.4, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, side: THREE.DoubleSide }));
  shade.position.y = 3.3;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  bulb.position.y = 3.18;
  const lampLight = new THREE.PointLight(0xffc887, 1.2, 12, 1.8);
  lampLight.position.y = 3.05;
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lampGroup.add(cord, shade, bulb, lampLight);
  // 桌面光晕
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc887, transparent: true, opacity: 0.06 }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.825;
  group.add(lampGroup, glow);

  // 两把椅子 + 两个人物相对而坐
  const chair1 = createChair(); chair1.position.set(-0.5, 0, -1.05); chair1.rotation.y = 0;
  const chair2 = createChair(); chair2.position.set(0.5, 0, 1.05); chair2.rotation.y = Math.PI;
  group.add(chair1, chair2);

  // 人物一：母亲（暖色衣服，坐姿）
  const mom = createFigure({ bodyColor: 0xa85a5a, hairColor: 0x2a2226, pose: "sitting" });
  mom.position.set(-0.5, 0.18, -1.05);
  mom.rotation.y = 0;
  // 人物二：我（冷色衣服，坐姿）
  const me = createFigure({ bodyColor: 0x5a6a8a, pose: "sitting" });
  me.position.set(0.5, 0.18, 1.05);
  me.rotation.y = Math.PI;
  group.add(mom, me);

  // 背景：墙上挂历/相框、窗（夜色）
  const frame1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.8 }));
  frame1.position.set(-2.5, 2.4, -4.9);
  const photo1 = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.76),
    new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 1 }));
  photo1.position.set(-2.5, 2.4, -4.87);
  const frame2 = frame1.clone(); frame2.position.set(-1.5, 2.2, -4.9); frame2.scale.setScalar(0.7);
  const photo2 = photo1.clone(); photo2.position.set(-1.5, 2.2, -4.87); photo2.scale.setScalar(0.7);
  photo2.material = new THREE.MeshStandardMaterial({ color: 0xa89a7a, roughness: 1 });
  group.add(frame1, photo1, frame2, photo2);

  // 窗：白天（晴空渐变 + 远处楼影）
  const dayMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 sky = mix(vec3(0.85, 0.92, 0.98), vec3(0.45, 0.68, 0.92), vUv.y);
        // 太阳柔光
        sky += vec3(1.0, 0.95, 0.8) * 0.35 * smoothstep(0.45, 0.0, distance(vUv, vec2(0.3, 0.75)));
        // 云
        float cloud = smoothstep(0.55, 0.9, hash(floor(vUv * vec2(6.0, 4.0)) + 0.3));
        sky = mix(sky, vec3(0.98), cloud * 0.35 * step(0.4, vUv.y));
        // 远处居民楼剪影
        vec2 grid = floor(vUv * vec2(8.0, 1.0));
        float buildings = step(vUv.y, 0.18 + 0.12 * hash(grid));
        sky = mix(sky, vec3(0.62, 0.68, 0.75), buildings * 0.8);
        gl_FragColor = vec4(sky, 1.0);
      }`,
  });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), dayMat);
  win.position.set(3, 2.3, -4.89);
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.55, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 0.9 }));
  winFrame.position.set(3, 2.3, -4.92);
  group.add(winFrame, win);

  // 日光从窗口斜射进来
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);
  sun.position.set(4, 3.5, -6);
  sun.castShadow = true;
  group.add(sun);
  // 地面光斑
  const sunPatch = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.2),
    new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.14 }));
  sunPatch.rotation.x = -Math.PI / 2;
  sunPatch.rotation.z = 0.4;
  sunPatch.position.set(2.2, 0.005, -2.2);
  group.add(sunPatch);

  // 冰箱轮廓（右侧生活感）
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.5, metalness: 0.3 }));
  fridge.position.set(4.8, 0.95, -3.5);
  fridge.castShadow = true;
  group.add(fridge);

  group.add(new THREE.AmbientLight(0xa89a80, 1.1));
  // 天光（白天从窗户漫射进来的环境反射）
  const hemi = new THREE.HemisphereLight(0xcfe0ee, 0x8a6a4a, 0.7);
  group.add(hemi);

  function update(t: number) {
    // 吊灯轻微摆动（老房子感）
    lampGroup.rotation.x = Math.sin(t * 0.6) * 0.008;
    lampGroup.rotation.z = Math.cos(t * 0.45) * 0.008;
    // 热气上升
    const pos = steamGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < steamCount; i++) {
      const life = (t * 0.25 + steamSeed[i]) % 1;
      pos[i * 3] = Math.sin(life * 6 + steamSeed[i] * 20) * 0.08;
      pos[i * 3 + 1] = 0.95 + life * 0.7;
      pos[i * 3 + 2] = Math.cos(life * 5 + steamSeed[i] * 15) * 0.08;
    }
    steamGeo.attributes.position.needsUpdate = true;
    (steam.material as THREE.PointsMaterial).opacity = 0.12 + Math.sin(t * 0.8) * 0.05;
  }

  return {
    group,
    update,
    camera: { pos: [2.2, 1.7, 2.6], look: [0, 1.0, 0] },
  };
}
