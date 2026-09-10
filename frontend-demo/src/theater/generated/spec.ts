/**
 * SceneSpec —— 「描述 → 3D 场景」的声明式规格（方案 A）。
 *
 * 后续由 LLM 依据用户口述产出这份 JSON；前端 assemble.ts 读它、用 props.ts 的
 * 低多边形零件目录程序化拼装成 theater 的 `{ group, update, camera }`。
 * 设计原则：字段少而正交、颜色用 CSS hex 字符串（LLM 友好）、未知字段可缺省、
 * 未知零件跳过而非报错，保证「假但安全」的低多边形调性与离线可运行。
 */

export type Vec3 = [number, number, number];

/** 时段：决定默认天空/地面/灯光基调（可被 env 内字段覆盖）。 */
export type TimeOfDay = "day" | "dusk" | "night";

/** 环境：室内外 + 时段 + 可选的天空/地面/星月山雾。颜色均为 CSS hex（如 "#16223d"）。 */
export interface SceneEnv {
  mode: "indoor" | "outdoor";
  time: TimeOfDay;
  sky?: { top?: string; bottom?: string };
  ground?: { color?: string };
  stars?: boolean;                                  // 户外夜晚星空
  moon?: boolean | { angle?: number; height?: number; size?: number };
  /** 太阳（白天/黄昏可见；黄昏默认开——低角度暖阳 + 光晕，避免"黄昏像半夜"）。 */
  sun?: boolean | { angle?: number; height?: number; size?: number; color?: string };
  mountains?: boolean | { color?: string; count?: number };
  fog?: { color?: string; near?: number; far?: number };
}

/** 零件实例：type 命中 props.ts 目录；pos/rotY/scale 为摆放；params 透传给该零件构造器。 */
export interface PropInstance {
  id?: string;
  /** 解算器保留的人物引用，装配时挂到真实手部骨架。 */
  heldBy?: string;
  /** Internal solver attachment, preserving support subtrees through hand animation. */
  supportId?: string;
  type: string;
  pos?: Vec3;
  rotY?: number;
  scale?: number;
  params?: Record<string, unknown>;
}

/**
 * 人物实例（复用 figure.createFigure）。颜色为 CSS hex。
 * pose 含情感动作；type/build/outfit/hairstyle/backpack 描述人物形象。
 */
export interface CharacterInstance {
  id?: string;
  seatContactEnabled?: boolean;
  pos?: Vec3;
  rotY?: number;
  scale?: number;
  pose?:
    | "standing" | "sitting" | "phone"
    | "walking" | "waving" | "lookingBack" | "headDown"
    | "handsFolded"
    | "arguing" | "comforting" | "hugging" | "handingItem"
    | "crying" | "sittingGround";
  /** 人物类型：儿童/学生/成人/老人（决定身高与默认特征）。 */
  type?: "child" | "student" | "adult" | "elderly";
  build?: "slim" | "average" | "stout";
  outfit?: "casual" | "uniform" | "coat" | "skirt";
  hairstyle?: "short" | "long" | "ponytail" | "bun";
  backpack?: boolean;
  bodyColor?: string;
  skinColor?: string;
  hairColor?: string;
}

/** 灯光覆盖（缺省时按 time 给合理默认）。 */
export interface SceneLighting {
  ambient?: { color?: string; intensity?: number };
  dir?: { color?: string; intensity?: number; pos?: Vec3 };
}

/** 一份完整场景规格。除 env 外均可缺省。 */
export interface SceneSpec {
  env: SceneEnv;
  props?: PropInstance[];
  characters?: CharacterInstance[];
  lighting?: SceneLighting;
  camera?: { pos: Vec3; look: Vec3 };
}
