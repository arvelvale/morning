/**
 * 姿态定义：把人物骨架摆成某个姿态，并为动画姿态产出逐帧 update。
 *
 * 骨架约定（见 index.ts）：
 * - parts.upper  上半身 pivot（髋部），负责前倾 / 驼背 / 摇晃 / 整体升降（坐姿）
 * - parts.head   颈部 pivot，负责低头 / 回头 / 侧倾
 * - armL/armR    肩 → 肘两段式
 * - legL/legR    髋 pivot（站姿在 HIP_Y，坐姿会下移）
 */
import * as THREE from "three";
import type { FigurePose } from "./presets";

export interface FigureArm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
}

export interface FigureParts {
  body: THREE.Group;
  upper: THREE.Group;
  head: THREE.Group;
  armL: FigureArm;
  armR: FigureArm;
  legL: THREE.Group;
  legR: THREE.Group;
  /** 膝 pivot（大腿 → 小腿）：坐姿时小腿下垂，走路时后腿弯曲。 */
  kneeL?: THREE.Group;
  kneeR?: THREE.Group;
  /** 手机 / 递出的物品等小道具（可选）。 */
  prop?: THREE.Object3D;
}

/** 把骨架摆成指定姿态（静态部分；动画部分由 makePoseUpdate 叠加）。 */
export function applyPose(p: FigureParts, pose: FigurePose) {
  const { upper, head, armL, armR, legL, legR, kneeL, kneeR } = p;

  switch (pose) {
    case "sitting":
      // 紧凑坐姿：上半身上下移，大腿前伸、手朝膝头
      upper.position.y -= 0.36;
      legL.position.y = 0.26;
      legR.position.y = 0.26;
      legL.rotation.x = -1.4;
      legR.rotation.x = -1.4;
      if (kneeL && kneeR) kneeL.rotation.x = kneeR.rotation.x = 1.25;   // 小腿垂下，脚点地
      armL.shoulder.rotation.x = -0.35;
      armL.elbow.rotation.x = -0.75;
      armR.shoulder.rotation.x = -0.35;
      armR.elbow.rotation.x = -0.75;
      break;
    case "sittingGround":
      // 坐地上：腿向前伸直，手撑在身侧
      upper.position.y -= 0.5;
      legL.position.y = 0.12;
      legR.position.y = 0.12;
      legL.rotation.x = -1.5;
      legR.rotation.x = -1.45;
      legL.rotation.z = 0.08;
      legR.rotation.z = -0.08;
      if (kneeL && kneeR) kneeL.rotation.x = kneeR.rotation.x = .22;     // 腿伸直但膝盖不锁死
      armL.shoulder.rotation.x = 0.3;
      armR.shoulder.rotation.x = 0.3;
      armL.shoulder.rotation.z = -0.35;
      armR.shoulder.rotation.z = 0.35;
      break;
    case "phone":
      // 右臂打电话：上臂贴身略前收，肘弯，前臂竖向耳侧；头微倾向手机
      armR.shoulder.rotation.set(-0.75, 0, 0.12);
      armR.elbow.rotation.set(-2.85, 0, -0.45);
      armL.shoulder.rotation.z = -0.1;
      armL.elbow.rotation.x = -0.18;
      head.rotation.set(0.06, 0, -0.14);
      break;
    case "walking":
      break; // 纯动画姿态
    case "waving":
      // 右手举起到头侧，update 里摆动
      armR.shoulder.rotation.z = 2.7;
      armR.elbow.rotation.z = -0.35;
      break;
    case "lookingBack":
      // 回头：越过肩膀往后看
      head.rotation.y = 2.4;
      upper.rotation.y = 0.3;
      break;
    case "headDown":
      head.rotation.x = 0.5;
      upper.rotation.x = 0.12;
      break;
    case "arguing":
      upper.rotation.x = 0.14;
      armR.shoulder.rotation.x = -1.2;
      armR.elbow.rotation.x = -0.4;
      armL.shoulder.rotation.x = -0.6;
      armL.elbow.rotation.x = -0.5;
      break;
    case "comforting":
      // 右手前伸，轻拍对方肩膀
      armR.shoulder.rotation.x = -1.1;
      armR.elbow.rotation.x = -0.25;
      break;
    case "hugging":
      // 双臂前环抱
      armL.shoulder.rotation.x = -1.15;
      armR.shoulder.rotation.x = -1.15;
      armL.shoulder.rotation.z = 0.5;
      armR.shoulder.rotation.z = -0.5;
      armL.elbow.rotation.x = -0.6;
      armR.elbow.rotation.x = -0.6;
      break;
    case "handingItem":
      // 右手向前递出（道具挂在右手肘部末端）
      armR.shoulder.rotation.x = -1.35;
      armR.elbow.rotation.x = -0.15;
      break;
    case "handsFolded":
      // 双手温和交叠在身前（迎接/等候），头微低
      armL.shoulder.rotation.x = -0.5;
      armR.shoulder.rotation.x = -0.5;
      armL.elbow.rotation.x = -1.15;
      armR.elbow.rotation.x = -1.15;
      armL.elbow.rotation.z = 0.3;      // 前臂向中线内收 → 两手相叠
      armR.elbow.rotation.z = -0.3;
      head.rotation.x = 0.1;
      upper.rotation.x = 0.04;
      break;
    case "crying":
      // 低头、双手抬到脸前、肩膀抽泣抖动
      head.rotation.x = 0.5;
      upper.rotation.x = 0.15;
      armL.shoulder.rotation.x = -1.1;
      armR.shoulder.rotation.x = -1.1;
      armL.elbow.rotation.x = -2.3;
      armR.elbow.rotation.x = -2.3;
      break;
    default: // standing
      break;
  }
}

/**
 * 动画姿态的逐帧驱动；静态姿态返回 null。
 * baseY 为 body/upper 的初始高度（坐姿类不会被动画姿态使用，直接取当前值）。
 */
export function makePoseUpdate(p: FigureParts, pose: FigurePose): ((t: number) => void) | null {
  const { body, upper, head, armL, armR, legL, legR, kneeL, kneeR } = p;
  const baseBodyY = body.position.y;
  const baseUpperY = upper.position.y;
  const baseHeadX = head.rotation.x;
  const baseShoulderRX = armR.shoulder.rotation.x;
  const baseShoulderRZ = armR.shoulder.rotation.z;

  switch (pose) {
    case "walking":
      return (t) => {
        const s = Math.sin(t * 4.5);
        legL.rotation.x = s * 0.55;
        legR.rotation.x = -s * 0.55;
        armL.shoulder.rotation.x = -s * 0.45;
        armR.shoulder.rotation.x = s * 0.45;
        armL.elbow.rotation.x = -0.3;
        armR.elbow.rotation.x = -0.3;
        body.position.y = baseBodyY + Math.abs(Math.cos(t * 4.5)) * 0.04;
        // 摆腿向前的那一侧屈膝，落地的那一侧伸直
        if (kneeL && kneeR) { kneeL.rotation.x = Math.max(0, -Math.cos(t * 4.5)) * 0.65; kneeR.rotation.x = Math.max(0, Math.cos(t * 4.5)) * 0.65; }
      };
    case "waving":
      return (t) => {
        armR.shoulder.rotation.z = baseShoulderRZ + Math.sin(t * 5.5) * 0.25;
        armR.elbow.rotation.z = -0.35 + Math.sin(t * 5.5 + 0.8) * 0.3;
      };
    case "arguing":
      return (t) => {
        armR.shoulder.rotation.x = baseShoulderRX + Math.sin(t * 6) * 0.45;
        armL.shoulder.rotation.x = -0.6 + Math.sin(t * 6 + Math.PI) * 0.3;
        head.rotation.z = Math.sin(t * 3) * 0.06;
      };
    case "comforting":
      return (t) => {
        // 轻拍
        armR.elbow.rotation.x = -0.25 + Math.sin(t * 4.5) * 0.18;
      };
    case "hugging":
      return (t) => {
        // 轻轻摇晃
        upper.rotation.z = Math.sin(t * 1.4) * 0.03;
      };
    case "handingItem":
      return (t) => {
        // 往前递出的小幅推送
        armR.shoulder.rotation.x = baseShoulderRX + Math.sin(t * 2) * 0.1;
        if (p.prop) p.prop.position.z = 0.05 + Math.sin(t * 2) * 0.03;
      };
    case "crying":
      return (t) => {
        // 抽泣：肩膀抖动
        upper.position.y = baseUpperY + Math.sin(t * 9) * 0.008;
        head.rotation.x = baseHeadX + Math.sin(t * 9) * 0.025;
      };
    default:
      return null;
  }
}
