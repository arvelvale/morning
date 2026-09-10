/**
 * 风格化人物/行李箱。低多边形、非写实——"假"恰恰给人安全感。
 *
 * 骨架：髋 pivot 腿 + 上半身 pivot（躯干/头/两臂），手臂为「肩 → 肘 → 手」两段式。
 * 姿态与情感动作见 poses.ts；类型/体型/服装/发型预设见 presets.ts。
 * 动画姿态（walking/waving/arguing/comforting/hugging/handingItem/crying）
 * 通过 figure.userData.update(t) 驱动，场景 update 里调用。
 *
 * 兼容旧参数：bodyColor / skinColor / hairColor / pose("standing"|"sitting"|"phone") / scale。
 */
import * as THREE from "three";
import {
  ANIMATED_POSES,
  BUILD_WIDTH,
  HIP_Y,
  OUTFIT_COLORS,
  SHOULDER_Y,
  TYPE_PRESETS,
  type FigureBuild,
  type FigureHair,
  type FigureOutfit,
  type FigurePose,
  type FigureType,
} from "./presets";
import { applyPose, makePoseUpdate, type FigureParts } from "./poses";
import { createFace } from './face';

export type { FigureBuild, FigureHair, FigureOutfit, FigurePose, FigureType } from "./presets";

export interface CreateFigureOptions {
  type?: FigureType;
  build?: FigureBuild;
  outfit?: FigureOutfit;
  hairstyle?: FigureHair;
  backpack?: boolean;
  pose?: FigurePose;
  scale?: number;
  bodyColor?: number;
  skinColor?: number;
  hairColor?: number;
  externalHandProp?: boolean;
  /** Only semantic sitOn opts in; old absolute scenes keep their original pose. */
  seatContactEnabled?: boolean;
}

export function createFigure({
  type = "adult",
  build = "average",
  outfit = "casual",
  hairstyle = "short",
  backpack = false,
  pose = "standing",
  scale = 1,
  bodyColor,
  skinColor = 0xe8c8a8,
  hairColor,
  externalHandProp = false,
  seatContactEnabled = false,
}: CreateFigureOptions = {}) {
  const preset = TYPE_PRESETS[type] ?? TYPE_PRESETS.adult;
  const clothColor = bodyColor ?? OUTFIT_COLORS[outfit] ?? OUTFIT_COLORS.casual;
  const finalHair = hairColor ?? preset.hairColor ?? 0x3a3230;

  const g = new THREE.Group();
  const body = new THREE.Group(); // 整体升降（走路起伏）
  const contactMeshes: THREE.Mesh[] = [];
  g.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9, flatShading: true });
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.95, flatShading: true });
  const hairMat = new THREE.MeshStandardMaterial({ color: finalHair, roughness: 1, flatShading: true });
  const trouserMat = outfit === 'skirt' ? skin : new THREE.MeshStandardMaterial({
    color: new THREE.Color(clothColor).multiplyScalar(.62), roughness: .98, flatShading: true,
  });

  // ---------- 腿（髋 pivot，加粗一档）----------
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.42, 3, 8);
  const shoeGeo = new THREE.SphereGeometry(1, 8, 6);
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x403934, roughness: .95, flatShading: true });
  const mkLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, HIP_Y, 0);
    const mesh = new THREE.Mesh(legGeo, trouserMat);
    mesh.position.y = -0.28;
    pivot.add(mesh);
    contactMeshes.push(mesh);
    // One continuous shoe silhouette per leg, never a second static foot on the floor.
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    shoe.name = x < 0 ? 'shoe-left' : 'shoe-right';
    shoe.scale.set(.082, .045, .135);
    shoe.position.set(0, -.515, .055);
    pivot.add(shoe);
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-0.11);
  const legR = mkLeg(0.11);

  // ---------- 上半身（髋 pivot：前倾/驼背/摇晃/坐姿下移）；躯干改锥度筒形，下宽上窄 ----------
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  body.add(upper);

  const w = BUILD_WIDTH[build] ?? 1;
  const torsoLen = outfit === "coat" ? 0.56 : 0.42;
  const torsoHeight = torsoLen + .26;
  const torsoProfile = [[.245, -.5], [.245, -.44], [.205, .12], [.21, .32], [.16, .45], [.095, .5]];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(
    torsoProfile.map(([radius, y]) => new THREE.Vector2(radius, y * torsoHeight)), 12,
  ), cloth);
  torso.position.y = 0.95 - HIP_Y - (outfit === "coat" ? 0.05 : 0);
  torso.scale.set(w, 1, w * 0.86);          // z 向略薄：人体不是圆筒
  upper.add(torso);
  contactMeshes.push(torso);
  // One continuous shoulder/chest outline instead of overlapping cylinder/sphere seams.

  // ── 衣领 + 围巾：打断"球直接插在躯干上"的突兀感 ──
  if (outfit === "uniform") {
    // 校服白领圈 + 深色下摆（保留原设计）
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.9, flatShading: true })
    );
    collar.position.y = 1.24 - HIP_Y;
    const hem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.25, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x2e3a4c, roughness: 0.95, flatShading: true })
    );
    hem.position.y = 0.66 - HIP_Y;
    upper.add(collar, hem);
    contactMeshes.push(hem);
  } else if (outfit === "coat") {
    // 大衣立领 + 暖赭围巾（围脖环 + 向后扬起的尾帕，定格微风）
    const coatCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.125, 0.11, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })
    );
    coatCollar.position.y = 1.32 - HIP_Y;
    upper.add(coatCollar);
    const scarfMat = new THREE.MeshStandardMaterial({ color: 0xa8542e, roughness: 0.98, flatShading: true });
    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.038, 8, 14), scarfMat);
    scarfRing.rotation.x = Math.PI / 2;
    scarfRing.position.y = 1.4 - HIP_Y;
    const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.035), scarfMat);
    scarfTail.position.set(-0.07, 1.24 - HIP_Y, 0.17);
    scarfTail.rotation.x = -0.12;      // 从围脖垂到胸前，不再悬在腰后
    scarfTail.rotation.z = 0.18;
    upper.add(scarfRing, scarfTail);
  } else {
    // 便装简约领圈
    const collarRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.108, 0.06, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })
    );
    collarRing.position.y = 1.3 - HIP_Y;
    upper.add(collarRing);
  }

  let seatedSkirt: THREE.Mesh | undefined;
  // 裙子：腰部伞裙（腿露出下摆）
  if (outfit === "skirt") {
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.36, 0.34, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })
    );
    skirt.position.y = 0.52 - HIP_Y;
    upper.add(skirt);
    contactMeshes.push(skirt);
    seatedSkirt = skirt;
  }

  // ---------- 头（颈 pivot：低头/回头/侧倾）+ 脖颈 ----------
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.52 - HIP_Y;
  upper.add(headGroup);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 8), skin);
  neck.position.y = -0.205;
  headGroup.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
  head.scale.setScalar(preset.headScale);
  head.scale.y *= 1.06;                       // 蛋形头：纵向略长，比正球更像"角色"
  headGroup.add(head);

  const face = createFace(pose, preset.headScale);
  headGroup.add(face.group);

  // ── 发型：短发的帽壳 + 错位刘海 + 后脑盖（打破"光秃球"）──
  const hs = preset.headScale;
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.2 * hs, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.44),
    hairMat
  );
  hairCap.position.set(0, 0.03, -0.01);
  headGroup.add(hairCap);
  // 前额刘海三片（错位高低 + 微前倾）
  const fringeGeo = new THREE.SphereGeometry(1, 8, 6);
  ([[-0.085, 0.105], [0.0, 0.125], [0.085, 0.1]] as const).forEach(([fx, fy], i) => {
    const fringe = new THREE.Mesh(fringeGeo, hairMat);
    fringe.scale.set(.063 * hs, .065 * hs, .034 * hs);
    fringe.position.set(fx * hs, fy * hs, (0.148 - (i === 1 ? 0.006 : 0)) * hs);
    fringe.rotation.x = -0.28;
    fringe.rotation.z = (i - 1) * 0.12;
    headGroup.add(fringe);
  });
  // 后脑盖片
  const backHair = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hairMat);
  backHair.scale.set(.17 * hs, .155 * hs, .075 * hs);
  backHair.position.set(0, -0.015 * hs, -0.135 * hs);
  headGroup.add(backHair);
  if (hairstyle === "long") {
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hairMat);
    back.scale.set(.175 * hs, .27 * hs, .09 * hs);
    back.position.set(0, -0.14 * hs, -0.155 * hs);
    headGroup.add(back);
  } else if (hairstyle === "ponytail") {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * hs, 0.24 * hs, 3, 6), hairMat);
    tail.position.set(0, -0.05 * hs, -0.22 * hs);
    tail.rotation.x = 0.5;
    headGroup.add(tail);
  } else if (hairstyle === "bun") {
    // 盘发发髻：主发包高置后脑 + 两侧小鬓包，避免被帽壳吞掉成"钢盔"
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.105 * hs, 10, 8), hairMat);
    bun.position.set(0, 0.185 * hs, -0.115 * hs);
    const bunSide1 = new THREE.Mesh(new THREE.SphereGeometry(0.055 * hs, 8, 6), hairMat);
    bunSide1.position.set(-0.12 * hs, 0.1 * hs, -0.08 * hs);
    const bunSide2 = bunSide1.clone();
    bunSide2.position.x = 0.12 * hs;
    headGroup.add(bun, bunSide1, bunSide2);
  }

  // ---------- 手臂：肩 → 上臂 → 肘 → 前臂 → 手球 ----------
  const shoulderHalf = 0.24 + (w - 1) * 0.1;
  const mkArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(shoulderHalf * side, SHOULDER_Y - HIP_Y, 0);
    // 肩球：遮住上臂胶囊与躯干相交的硬边，肩部衔接更自然
    const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), cloth);
    shoulderBall.scale.set(1, 0.85, 1);
    shoulder.add(shoulderBall);
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 3, 8), cloth);
    upperArm.position.y = -0.13;
    shoulder.add(upperArm);
    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.18, 3, 8), cloth);
    fore.position.y = -0.11;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), skin);
    hand.position.y = -0.25;
    elbow.add(hand);
    upper.add(shoulder);
    return { shoulder, elbow };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  // 自然站姿默认：双臂微外张，前臂略前摆
  armL.shoulder.rotation.z = -0.08;
  armR.shoulder.rotation.z = 0.08;
  armL.elbow.rotation.x = -0.15;
  armR.elbow.rotation.x = -0.15;

  // ---------- 书包 ----------
  if (backpack) {
    const packMat = new THREE.MeshStandardMaterial({ color: 0xc47a3a, roughness: 0.85, flatShading: true });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.16), packMat);
    pack.position.set(0, 1.0 - HIP_Y, -0.24);
    const strapGeo = new THREE.BoxGeometry(0.05, 0.3, 0.03);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x8a5228, roughness: 0.9 });
    const s1 = new THREE.Mesh(strapGeo, strapMat);
    s1.position.set(-0.1, 1.06 - HIP_Y, -0.13);
    const s2 = new THREE.Mesh(strapGeo, strapMat);
    s2.position.set(0.1, 1.06 - HIP_Y, -0.13);
    upper.add(pack, s1, s2);
  }

  // ---------- 小道具（手机 / 递出的物品，挂在右手随手走） ----------
  let prop: THREE.Object3D | undefined;
  if (pose === "phone" && !externalHandProp) {
    prop = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.13, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x111111, roughness: 0.4,
        emissive: 0x88aaff, emissiveIntensity: 0.35,
      })
    );
    prop.position.set(0.01, -0.27, 0.05);
    prop.rotation.set(0.25, 0, -0.12);
    armR.elbow.add(prop);
  } else if (pose === "handingItem" && !externalHandProp) {
    prop = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.8, flatShading: true })
    );
    prop.position.set(0, -0.27, 0.05);
    armR.elbow.add(prop);
  }

  const handAnchor = new THREE.Group();
  handAnchor.name = 'right-hand-anchor';
  handAnchor.position.set(0, -0.25, 0);
  armR.elbow.add(handAnchor);
  g.userData.handAnchor = handAnchor;

  // Shoes belong exclusively to their animated leg pivots.

  // ---------- 姿态 + 动画 ----------
  const parts: FigureParts = { body, upper, head: headGroup, armL, armR, legL, legR, prop };
  applyPose(parts, pose);
  if (seatContactEnabled && pose === 'sitting') {
    // The old downward-sloping straight legs touched only beyond the chair edge.
    // A horizontal thigh has a real contact strip over the seat, not a remote lowest tip.
    legL.rotation.x = -Math.PI / 2;
    legR.rotation.x = -Math.PI / 2;
    if (seatedSkirt) {
      // Fold the standing skirt onto the lap; a hanging cone outside the seat cannot set hip height.
      seatedSkirt.scale.y = .35;
      seatedSkirt.position.y = .26 - .085 - upper.position.y + .34 * .35 / 2;
    }
  }
  if (preset.hunch) upper.rotation.x += preset.hunch;
  if (seatContactEnabled && pose === 'sitting' && seatedSkirt) {
    // The folded lap stays level even when the elderly torso leans forward.
    const dy = .26 - .085 + .34 * .35 / 2 - upper.position.y;
    seatedSkirt.rotation.x = -upper.rotation.x;
    seatedSkirt.position.set(0, dy * Math.cos(upper.rotation.x), -dy * Math.sin(upper.rotation.x));
  }
  // Measure actual load-bearing vertices, not a guessed hip offset or a rotated AABB.
  g.updateMatrixWorld(true);
  let contactY = Infinity;
  const contactVertex = new THREE.Vector3();
  for (const mesh of contactMeshes) {
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      contactVertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      contactY = Math.min(contactY, contactVertex.y);
    }
  }
  const seatAnchor = new THREE.Group();
  seatAnchor.name = 'seat-contact-anchor';
  seatAnchor.position.y = contactY;
  body.add(seatAnchor);
  g.userData.seatAnchor = seatAnchor;
  g.userData.contactMeshes = contactMeshes;
  g.userData.contactY = contactY;
  if (ANIMATED_POSES.has(pose)) {
    const update = makePoseUpdate(parts, pose);
    if (update) g.userData.update = update;
  } else {
    // P3：静态姿态叠加极轻微 idle——呼吸起伏 + 头部缓慢微转（不破坏锚点与坐姿校准）
    const phase = Math.random() * Math.PI * 2;   // 多人同场呼吸错拍
    const baseHeadY = headGroup.rotation.y;
    const baseUpperZ = upper.rotation.z;
    g.userData.update = (t: number) => {
      const b = Math.sin(t * 1.7 + phase);
      body.scale.y = 1 + b * 0.012;
      headGroup.rotation.y = baseHeadY + Math.sin(t * 0.55 + phase) * 0.055;
      if (seatContactEnabled && pose === 'sitting') {
        // Preserve the contact plane while breathing; only the head turns on a seated body.
        body.position.y = contactY * (1 - body.scale.y);
      } else upper.rotation.z = baseUpperZ + Math.sin(t * 0.9 + phase) * 0.008;
    };
  }

  const updatePose = g.userData.update as ((t: number) => void) | undefined;
  g.userData.update = (t: number) => { updatePose?.(t); face.update(t); };
  g.scale.setScalar(scale * preset.scale);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  return g;
}

/** 行李箱：双色箱体 + 伸缩拉杆 + 四万向轮 + 皮革包角（旅人道具的完整剪影）。 */
export function createLuggage({ color = 0xb05c4a }: { color?: number } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5a3226, roughness: 0.85, flatShading: true });  // 皮革包角
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.2), mat);
  body.position.y = 0.32;
  body.castShadow = true;
  // 箱体合缝线（前后各一条深色细带）
  for (const dz of [0.052, -0.052]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.5, 0.012), trimMat);
    seam.position.set(0, 0.32, dz);
    g.add(seam);
  }
  // 皮革包角：八条短棱（箱体四竖边 + 上下沿）
  const corner = (x: number, y: number, w: number, h: number) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.24), trimMat);
    c.position.set(x, y, 0);
    g.add(c);
  };
  corner(0.16, 0.14, 0.05, 0.12); corner(-0.16, 0.14, 0.05, 0.12);
  corner(0.16, 0.5, 0.05, 0.12); corner(-0.16, 0.5, 0.05, 0.12);
  corner(0, 0.55, 0.36, 0.05); corner(0, 0.09, 0.36, 0.05);
  // 伸缩拉杆：双柱 + 横把
  for (const rx of [-0.07, 0.07]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), metalMat);
    rod.position.set(rx, 0.72, 0);
    g.add(rod);
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.035), metalMat);
  handle.position.set(0, 0.88, 0);
  g.add(handle);
  // 四万向轮（深色小轮贴角）
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
  ([[-0.13, 0.08], [0.13, 0.08], [-0.13, -0.08], [0.13, -0.08]] as const).forEach(([x, z]) => {
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), wheelMat);
    wheel.position.set(x, 0.035, z);
    g.add(wheel);
  });
  return g;
}
