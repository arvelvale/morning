/**
 * 人物系统的类型与预设：人物类型 / 体型 / 服装 / 发型 / 姿态枚举。
 * 与后端 app/services/scene/scene_spec.py 的白名单保持一致（改动需两端同步）。
 */

/** 人物类型：儿童 / 学生 / 成人 / 老人（决定身高比例与默认特征）。 */
export type FigureType = "child" | "student" | "adult" | "elderly";

/** 体型。 */
export type FigureBuild = "slim" | "average" | "stout";

/** 服装：便装 / 校服 / 外套 / 裙子。 */
export type FigureOutfit = "casual" | "uniform" | "coat" | "skirt";

/** 发型：短发 / 长发 / 马尾 / 发髻。 */
export type FigureHair = "short" | "long" | "ponytail" | "bun";

/**
 * 姿态与情感动作。
 * 静态：standing / sitting / phone / lookingBack / headDown / sittingGround
 * 动画（userData.update 驱动）：walking / waving / arguing / comforting / hugging / handingItem / crying
 */
export type FigurePose =
  | "standing"
  | "sitting"
  | "phone"
  | "walking"
  | "waving"
  | "lookingBack"
  | "headDown"
  | "handsFolded"
  | "arguing"
  | "comforting"
  | "hugging"
  | "handingItem"
  | "crying"
  | "sittingGround";

/** 带动画（需要逐帧 update）的姿态。 */
export const ANIMATED_POSES: ReadonlySet<FigurePose> = new Set([
  "walking", "waving", "arguing", "comforting", "hugging", "handingItem", "crying",
]);

export interface TypePreset {
  /** 整体身高缩放（在 createFigure 的 scale 之上再乘）。 */
  scale: number;
  /** 头部相对放大（儿童头大）。 */
  headScale: number;
  /** 驼背前倾角（老人）。 */
  hunch?: number;
  /** 默认发色（老人灰白）。 */
  hairColor?: number;
}

export const TYPE_PRESETS: Record<FigureType, TypePreset> = {
  child: { scale: 0.68, headScale: 1.3 },     // 学龄前：约七成身高 + 大头，不再"缩水成半人"
  student: { scale: 0.82, headScale: 1.1 },
  adult: { scale: 1, headScale: 1 },
  elderly: { scale: 0.93, headScale: 1.02, hunch: 0.18, hairColor: 0x9a948e },
};

/** 各服装的默认衣色（bodyColor 缺省时）。 */
export const OUTFIT_COLORS: Record<FigureOutfit, number> = {
  casual: 0x8a97ad,
  uniform: 0x4a6a9a,
  coat: 0x6a5a4a,
  skirt: 0xa85a6a,
};

/** 体型对躯干宽度的缩放。 */
export const BUILD_WIDTH: Record<FigureBuild, number> = {
  slim: 0.85,
  average: 1,
  stout: 1.28,
};

/** 关键关节高度（成人基准，米）。 */
export const HIP_Y = 0.56;
export const SHOULDER_Y = 1.18;
export const HEAD_Y = 1.52;
