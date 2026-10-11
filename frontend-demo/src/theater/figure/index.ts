/**
 * 风格化人物/行李箱。圆润的玩偶质感，不追求写实——"假"恰恰给人安全感。
 *
 * 这个文件是「总调度」：只负责按骨架（髋 → 膝、肩 → 肘、颈）把各模块的产物装起来，
 *   head.ts  头骨 / 发型        face.ts  五官与表情        body.ts  躯干 / 衣服 / 手臂 / 腿 / 鞋
 *   geo.ts   几何小工具（每个 pivot 下的部件合并成一个顶点色 mesh，所以细节多了 mesh 数反而少）
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
import { buildHair, buildHeadSkin } from './head';
import { buildArm, buildBackpack, buildLeg, buildSkirt, buildTorso, type Colors } from './body';
import { mergePieces, shade, type Piece } from './geo';

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

/** 各服装的配套：裤子 / 鞋 / 点缀色。 */
const GEAR: Record<FigureOutfit, { trouser: number; shoe: number; accent: number }> = {
  casual: { trouser: 0x4a5878, shoe: 0xf1ebe0, accent: 0xd9604f },
  uniform: { trouser: 0x2c374e, shoe: 0x2e2825, accent: 0xb8453f },
  coat: { trouser: 0x3a3430, shoe: 0x2b2420, accent: 0xa8542e },
  skirt: { trouser: 0, shoe: 0x6a3f3a, accent: 0xe9b4a0 },
};
/** 脖子根（头部转动的轴）和头心的世界高度。 */
const NECK_Y = 1.285, HEAD_CENTER_Y = 1.52;

export function createFigure({
  type = "adult",
  build = "average",
  outfit = "casual",
  hairstyle = "short",
  backpack = false,
  pose = "standing",
  scale = 1,
  bodyColor,
  skinColor = 0xeccaa6,
  hairColor,
  externalHandProp = false,
  seatContactEnabled = false,
}: CreateFigureOptions = {}) {
  const preset = TYPE_PRESETS[type] ?? TYPE_PRESETS.adult;
  const clothColor = bodyColor ?? OUTFIT_COLORS[outfit] ?? OUTFIT_COLORS.casual;
  const finalHair = hairColor ?? preset.hairColor ?? 0x3a3230;
  const gear = GEAR[outfit] ?? GEAR.casual;
  const colors: Colors = { cloth: clothColor, skin: skinColor, trouser: gear.trouser, shoe: gear.shoe, sole: 0xe6dccb, accent: gear.accent };
  const w = BUILD_WIDTH[build] ?? 1;

  const g = new THREE.Group();
  const body = new THREE.Group(); // 整体升降（走路起伏）
  const contactMeshes: THREE.Mesh[] = [];
  g.add(body);

  // 全身只用三种材质：衣服/皮肤（顶点色）、头发（略带光泽）、裙摆（双面）
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0 });
  const hairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: 0 });
  const skirtMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  const mesh = (pieces: Piece[], mat: THREE.Material = vc, name?: string) => {
    const m = new THREE.Mesh(mergePieces(pieces), mat);
    if (name) m.name = name;
    return m;
  };

  // ---------- 腿（髋 pivot → 膝 pivot）----------
  const mkLeg = (side: 1 | -1) => {
    const parts = buildLeg(outfit, colors, side);
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.105, HIP_Y, 0);
    const thigh = mesh(parts.thigh);
    pivot.add(thigh);
    contactMeshes.push(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.28;
    knee.add(mesh(parts.shin));
    // One continuous shoe silhouette per leg, never a second static foot on the floor.
    knee.add(mesh(parts.shoe, vc, side < 0 ? 'shoe-left' : 'shoe-right'));
    pivot.add(knee);
    body.add(pivot);
    return { pivot, knee };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // ---------- 上半身（髋 pivot：前倾/驼背/摇晃/坐姿下移）----------
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  body.add(upper);
  upper.add(mesh(buildTorso(outfit, w, colors)));

  // 连衣裙的裙摆：独立 mesh，坐姿时压平到大腿上
  let seatedSkirt: THREE.Mesh | undefined;
  if (outfit === "skirt") {
    const skirt = mesh(buildSkirt(clothColor), skirtMat);
    skirt.position.y = 0.52 - HIP_Y;
    upper.add(skirt);
    contactMeshes.push(skirt);
    seatedSkirt = skirt;
  }

  // ---------- 头（颈 pivot：低头/回头/侧倾）----------
  const headGroup = new THREE.Group();
  headGroup.position.y = NECK_Y - HIP_Y;
  upper.add(headGroup);
  headGroup.add(mesh([{ geo: new THREE.CylinderGeometry(.054, .062, .12, 12), color: shade(skinColor, .95) }], vc, 'neck'));
  const hs = preset.headScale;
  const headShape = new THREE.Group();            // 蛋形头 + 头发，一起按类型缩放（儿童头更大）
  headShape.position.y = HEAD_CENTER_Y - NECK_Y;
  headShape.scale.setScalar(hs);
  headShape.add(mesh(buildHeadSkin(skinColor), vc, 'head'));
  headShape.add(mesh(buildHair(hairstyle, finalHair, gear.accent), hairMat, 'hair'));
  headGroup.add(headShape);
  const face = createFace(pose, hs, { skin: skinColor, glasses: type === 'elderly' });
  face.group.position.y = HEAD_CENTER_Y - NECK_Y;
  headGroup.add(face.group);

  // ---------- 手臂：肩 → 上臂 → 肘 → 前臂 → 手 ----------
  const shoulderHalf = 0.226 + (w - 1) * 0.1;
  const mkArm = (side: 1 | -1) => {
    const parts = buildArm(outfit, colors, side);
    const shoulder = new THREE.Group();
    shoulder.position.set(shoulderHalf * side, SHOULDER_Y - HIP_Y, 0);
    shoulder.add(mesh(parts.upper));
    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    shoulder.add(elbow);
    elbow.add(mesh(parts.fore));
    elbow.add(mesh(parts.hand));
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
  if (backpack) upper.add(mesh(buildBackpack(), vc, 'backpack'));

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

  // ---------- 姿态 + 动画 ----------
  const parts: FigureParts = {
    body, upper, head: headGroup, armL, armR, legL: legL.pivot, legR: legR.pivot, kneeL: legL.knee, kneeR: legR.knee, prop,
  };
  applyPose(parts, pose);
  if (seatContactEnabled && pose === 'sitting') {
    // The old downward-sloping straight legs touched only beyond the chair edge.
    // A horizontal thigh has a real contact strip over the seat, not a remote lowest tip.
    legL.pivot.rotation.x = -Math.PI / 2;
    legR.pivot.rotation.x = -Math.PI / 2;
    legL.knee.rotation.x = legR.knee.rotation.x = .5;       // 小腿自然向下垂一点，脚不再平伸
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
  for (const m of contactMeshes) {
    const positions = m.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      contactVertex.fromBufferAttribute(positions, i).applyMatrix4(m.matrixWorld);
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
  g.add(body);
  return g;
}
