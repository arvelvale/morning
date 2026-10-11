/** 离开的路上 · 高铁站：白天的站台，白色高铁停靠，顶棚灯带 */
import * as THREE from "three";
import { createSkyDome } from "../utils";
import { createFigure, createLuggage } from "../figure";
import type { TheaterScene } from "../types";

export function create(): TheaterScene {
  const group = new THREE.Group();

  // 白天晴空
  const sky = createSkyDome({ top: 0x4a7fc0, bottom: 0xc8dcec, clouds: { color: 0xffffff, shade: 0xc4d2e6, amount: 0.75 } });
  group.add(sky);
  // 太阳
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(4, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff8e0, fog: false }));
  sunDisc.position.set(-50, 45, -80);
  sunDisc.lookAt(0, 10, 0);
  const sunHalo = new THREE.Mesh(new THREE.CircleGeometry(8, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.25, fog: false }));
  sunHalo.position.copy(sunDisc.position).add(new THREE.Vector3(0, 0, -0.5));
  sunHalo.lookAt(0, 10, 0);
  group.add(sunDisc, sunHalo);

  // 站台地面
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.8 });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(50, 0.8, 10), platformMat);
  platform.position.set(0, 0.4, 2);
  platform.receiveShadow = true;
  group.add(platform);
  // 黄色安全线
  const safeLine = new THREE.Mesh(new THREE.BoxGeometry(50, 0.02, 0.25),
    new THREE.MeshBasicMaterial({ color: 0xd8b83a }));
  safeLine.position.set(0, 0.81, -1.2);
  group.add(safeLine);
  // 盲道
  const tactile = new THREE.Mesh(new THREE.BoxGeometry(50, 0.02, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x8a8438, roughness: 1 }));
  tactile.position.set(0, 0.81, 0.8);
  group.add(tactile);

  // 轨道区（下沉）
  const trackBed = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 1 }));
  trackBed.position.set(0, -0.3, -4.5);
  group.add(trackBed);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.3, metalness: 0.8 });
  [-5.6, -4.6, -3.6, -2.6].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(60, 0.08, 0.08), railMat);
    rail.position.set(0, -0.15, z);
    group.add(rail);
  });

  // 高铁列车（白色流线车身 + 蓝色腰线 + 车窗灯带）
  const train = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.3, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.55, 26, 8, 16), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 1, 0.82);
  body.position.y = 1.75;
  body.castShadow = true;
  train.add(body);
  // 蓝色腰线
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(27, 0.22, 2.62),
    new THREE.MeshStandardMaterial({ color: 0x2a5aa8, roughness: 0.4 }));
  stripe.position.y = 1.5;
  train.add(stripe);
  // 车窗（发光带）
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffe8b8 });
  for (let i = 0; i < 12; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.02), winMat);
    win.position.set(-12 + i * 2.1, 2.25, 1.28);
    train.add(win);
  }
  // 车头灯
  const headLight = new THREE.Mesh(new THREE.SphereGeometry(0.12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  headLight.position.set(14.2, 1.4, 0.6);
  train.add(headLight);
  const headBeam = new THREE.SpotLight(0xfff4d8, 2, 25, 0.4, 0.6);
  headBeam.position.set(14.2, 1.5, 0);
  headBeam.target.position.set(30, 0.5, 0);
  train.add(headBeam, headBeam.target);
  train.position.set(-2, 0, -4.1);
  group.add(train);

  // 站台顶棚
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.7, flatShading: true });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 12), roofMat);
  roof.position.set(0, 5.5, 1);
  group.add(roof);
  // 顶棚支柱
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.7, 10), pillarMat);
    pillar.position.set(-20 + i * 8, 3.15, 5.5);
    group.add(pillar);
  }
  // 顶棚灯带
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xe8f0f8 });
  for (let i = 0; i < 5; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.3), stripMat);
    strip.position.set(-16 + i * 8, 5.36, 1);
    group.add(strip);
  }

  // 站台吊牌（发光）
  const mkSign = (x: number) => {
    const s = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.5 }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x66c8ff }));
    glow.position.z = 0.06;
    const glow2 = glow.clone(); glow2.rotation.y = Math.PI; glow2.position.z = -0.06;
    const hang1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5), pillarMat);
    hang1.position.set(-0.7, 0.6, 0);
    const hang2 = hang1.clone(); hang2.position.x = 0.7;
    s.add(board, glow, glow2, hang1, hang2);
    s.position.set(x, 4.6, 1);
    group.add(s);
    return s;
  };
  mkSign(-8);
  mkSign(6);

  // 长椅
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.5, metalness: 0.3 });
  const bench = new THREE.Group();
  const bSeat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.55), benchMat);
  bSeat.position.y = 0.5;
  const bBack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.07), benchMat);
  bBack.position.set(0, 0.85, -0.26);
  bBack.rotation.x = -0.12;
  const bLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.5), benchMat);
  bLeg1.position.set(-0.9, 0.25, 0);
  const bLeg2 = bLeg1.clone(); bLeg2.position.x = 0.9;
  bench.add(bSeat, bBack, bLeg1, bLeg2);
  bench.position.set(3, 0.8, 4);
  group.add(bench);

  // 人物：站在安全线后，拖着行李箱，望着列车
  const me = createFigure({ bodyColor: 0x8a7a6a, pose: "standing" });
  me.position.set(-3, 0.8, 0.5);
  me.rotation.y = Math.PI + 0.15;
  group.add(me);
  const luggage = createLuggage({ color: 0x4a6a9a });
  luggage.position.set(-2.4, 0.8, 0.9);
  group.add(luggage);

  // 另一个候车人坐在长椅上
  const stranger = createFigure({ bodyColor: 0x5a5a6a, skinColor: 0xd8b898, pose: "sitting", scale: 0.96 });
  stranger.position.set(3.3, 0.88, 3.95);
  stranger.rotation.y = Math.PI;
  group.add(stranger);

  // 远处建筑剪影（白天）
  const bldMat = new THREE.MeshStandardMaterial({ color: 0x9aa8b8, roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const w = 3 + Math.random() * 5;
    const h = 4 + Math.random() * 10;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), bldMat);
    b.position.set(-55 + i * 10 + Math.random() * 4, h / 2 - 0.5, -35 - Math.random() * 12);
    group.add(b);
  }

  // 灯光：白天，阳光为主
  group.add(new THREE.AmbientLight(0xa8b4c4, 1.05));
  const roofLight = new THREE.DirectionalLight(0xfff2dc, 1.5);
  roofLight.position.set(-20, 25, 15);
  roofLight.castShadow = true;
  group.add(roofLight);

  function update(t: number) {
    sky.userData.update(t);
    // 列车极轻微的停站晃动（车体制动后的余振）
    train.position.y = Math.sin(t * 2.2) * 0.008;
  }

  return {
    group,
    update,
    camera: { pos: [4, 2.8, 8.5], look: [-4, 1.6, -4] },
  };
}
