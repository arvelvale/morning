/** 深夜通话 · 卧室窗前：夜色透过窗，人坐在窗边打电话（房间已扩大：14×11×4.6，家具重布） */
import * as THREE from "three";
import { createFigure } from "../figure";
import type { TheaterScene } from "../types";

export function create(): TheaterScene {
  const group = new THREE.Group();

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2e3c, roughness: 1 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.95 });

  // 房间尺寸：宽 14 × 深 11 × 高 4.6（原 10×8×4，用户反馈太小）
  const W = 14, D = 11, H = 4.6, WALL_Z = -5.5;

  // 地板
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  group.add(floor);

  // 后墙（带窗洞：用四块拼）
  const winW = 3.4, winH = 2.4, winY = 1.25, winX = 0.9;
  const mkWall = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), wallMat);
    m.position.set(x, y, WALL_Z);
    group.add(m);
  };
  // 左墙 / 右墙 / 上墙 / 下墙
  const leftW = winX - winW / 2 + W / 2;
  const rightW = W / 2 - (winX + winW / 2);
  mkWall(leftW, H, -W / 2 + leftW / 2, H / 2);
  mkWall(rightW, H, W / 2 - rightW / 2, H / 2);
  mkWall(winW, winY, winX, winY / 2);
  mkWall(winW, H - winY - winH, winX, (H + winY + winH) / 2);

  // 侧墙
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, D), wallMat);
  sideL.position.set(-W / 2, H / 2, 0);
  const sideR = sideL.clone();
  sideR.position.x = W / 2;
  // 天花板
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), wallMat);
  ceil.position.set(0, H, 0);
  group.add(sideL, sideR, ceil);

  // 窗框
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1f2a, roughness: 0.8 });
  const frameT = 0.08;
  const mkFrame = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frameMat);
    m.position.set(x, y, WALL_Z + 0.05);
    group.add(m);
  };
  mkFrame(winW + frameT * 2, frameT, winX, winY + winH + frameT / 2);
  mkFrame(winW + frameT * 2, frameT, winX, winY - frameT / 2);
  mkFrame(frameT, winH, winX - winW / 2 - frameT / 2, winY + winH / 2);
  mkFrame(frameT, winH, winX + winW / 2 + frameT / 2, winY + winH / 2);
  mkFrame(frameT * 0.7, winH, winX, winY + winH / 2); // 中梃

  // 窗外夜景（发光平面：深蓝夜空 + 月亮 + 零星灯火）
  const nightMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 sky = mix(vec3(0.05, 0.08, 0.18), vec3(0.02, 0.03, 0.09), vUv.y);
        // 月亮
        float moon = smoothstep(0.09, 0.075, distance(vUv, vec2(0.72, 0.78)));
        vec3 col = sky + vec3(0.95, 0.92, 0.8) * moon;
        // 月晕
        col += vec3(0.5, 0.5, 0.6) * 0.25 * smoothstep(0.25, 0.08, distance(vUv, vec2(0.72, 0.78)));
        // 远处城市灯火
        vec2 grid = floor(vUv * vec2(40.0, 14.0));
        float lit = step(0.93, hash(grid)) * step(vUv.y, 0.28);
        float flicker = 0.6 + 0.4 * sin(time * 0.5 + hash(grid) * 20.0);
        col += vec3(1.0, 0.8, 0.5) * lit * 0.5 * flicker;
        // 城市剪影
        float skyline = step(vUv.y, 0.16 + 0.1 * hash(vec2(grid.x, 0.0)));
        col = mix(col, vec3(0.02, 0.025, 0.05), skyline * (1.0 - lit));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const nightView = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), nightMat);
  nightView.position.set(winX, winY + winH / 2, WALL_Z - 0.16);
  group.add(nightView);

  // 月光洒入（从窗口斜射的光柱感：平行光 + 地面光斑）
  const moonBeam = new THREE.SpotLight(0xa8c0e8, 4.0, 20, Math.PI / 5, 0.5, 1.2);
  moonBeam.position.set(winX + 0.8, winY + winH - 0.2, WALL_Z + 0.4);
  moonBeam.target.position.set(-1.5, 0, 2.0);
  moonBeam.castShadow = true;
  group.add(moonBeam, moonBeam.target);
  const moonPatch = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.4),
    new THREE.MeshBasicMaterial({ color: 0x8fa8d8, transparent: true, opacity: 0.07 })
  );
  moonPatch.rotation.x = -Math.PI / 2;
  moonPatch.rotation.z = 0.5;
  moonPatch.position.set(-1.0, 0.005, 0.3);
  group.add(moonPatch);

  // 床（深色剪影，双人床尺寸）
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 1 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.8), bedMat);
  bed.position.set(-5.2, 0.25, -4.3);
  bed.castShadow = true;
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x5a647e, roughness: 1 }));
  pillow.position.set(-5.9, 0.57, -4.3);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x4a3a52, roughness: 1, flatShading: true }));
  blanket.position.set(-4.9, 0.53, -4.3);
  // 床头板
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x3a3230, roughness: 0.9 }));
  headboard.position.set(-5.2, 0.65, -5.3);
  headboard.castShadow = true;
  group.add(bed, pillow, blanket, headboard);

  // 床头柜 + 熄着的台灯（轮廓）
  const nightstand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }));
  nightstand.position.set(-6.5, 0.25, -4.95);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 8),
    new THREE.MeshStandardMaterial({ color: 0x555f75, roughness: 1 }));
  lampShade.position.set(-6.5, 0.75, -4.95);
  group.add(nightstand, lampShade);

  // 地毯
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 28),
    new THREE.MeshStandardMaterial({ color: 0x5a4a5e, roughness: 1 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.3, 0.005, 0.3);
  rug.receiveShadow = true;
  group.add(rug);

  // 窗帘（两侧）
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x3a4260, roughness: 1, side: THREE.DoubleSide });
  const curtainL = new THREE.Mesh(new THREE.PlaneGeometry(0.7, winH + 0.5), curtainMat);
  curtainL.position.set(winX - winW / 2 - 0.42, winY + winH / 2, WALL_Z + 0.08);
  const curtainR = curtainL.clone();
  curtainR.position.x = winX + winW / 2 + 0.42;
  group.add(curtainL, curtainR);

  // 衣柜（左侧）
  const wardrobe = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 2.3, 0.65),
    new THREE.MeshStandardMaterial({ color: 0x4a3f35, roughness: 0.9 })
  );
  wardrobe.position.set(-6.2, 1.15, -1.8);
  wardrobe.castShadow = true;
  group.add(wardrobe);

  // 书桌 + 椅子（右侧）
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.75, 0.65),
    new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8 })
  );
  desk.position.set(5.5, 0.375, -4.0);
  desk.castShadow = true;
  group.add(desk);
  const deskChair = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.9, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.9 })
  );
  deskChair.position.set(5.5, 0.45, -2.8);
  deskChair.castShadow = true;
  group.add(deskChair);

  // 床头挂画
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.65),
    new THREE.MeshStandardMaterial({ color: 0x6a7a9a, roughness: 0.9 })
  );
  art.position.set(-5.2, 2.3, WALL_Z + 0.1);
  group.add(art);

  // 门（右侧墙）
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.15, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x4a3f35, roughness: 0.9 })
  );
  door.position.set(6.9, 1.075, 1.2);
  group.add(door);

  // 窗边落地灯（熄着的剪影，让窗左侧不空）
  const floorLampMat = new THREE.MeshStandardMaterial({ color: 0x232837, roughness: 0.9 });
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), floorLampMat);
  lampPole.position.set(-2.6, 0.85, -4.9);
  const floorLampShade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.35, 8),
    new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 1 }));
  floorLampShade.position.set(-2.6, 1.78, -4.9);
  group.add(lampPole, floorLampShade);

  // 右后角绿植（花盆 + 叶球，深色剪影）
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 1 }));
  pot.position.set(6.2, 0.2, -4.7);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1e3a28, roughness: 1, flatShading: true });
  const leaf1 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 6), leafMat);
  leaf1.position.set(6.2, 0.75, -4.7);
  const leaf2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), leafMat);
  leaf2.position.set(6.05, 1.1, -4.65);
  group.add(pot, leaf1, leaf2);

  // 人物：坐在窗台上打电话，腿垂下来
  const me = createFigure({ bodyColor: 0x6a7590, pose: "phone" });
  me.position.set(winX, winY - 0.35, WALL_Z + 0.25);
  me.rotation.y = Math.PI * 0.15;
  group.add(me);

  // 环境光 + 半球补光：夜晚但不至于看不清（物理光照模式下需要较高强度）
  group.add(new THREE.AmbientLight(0x3a4a68, 8));
  group.add(new THREE.HemisphereLight(0x4a5a78, 0x2a2a3a, 4.5));

  // 手机屏幕微光（点光，照亮人物侧脸和窗台）
  const phoneGlow = new THREE.PointLight(0x88aaff, 1.4, 3, 2);
  phoneGlow.position.set(winX + 0.15, winY - 0.1, WALL_Z + 0.45);
  group.add(phoneGlow);

  // 床头小夜灯暖光（让左侧床铺区域有层次）
  const nightLight = new THREE.PointLight(0xffb87a, 1.3, 6, 2);
  nightLight.position.set(-6.5, 0.9, -4.95);
  group.add(nightLight);

  function update(t: number) {
    nightMat.uniforms.time.value = t;
  }

  return {
    group,
    update,
    camera: { pos: [-2.6, 2.3, 5.6], look: [0, 1.2, -3.0] },
  };
}
