import type { StyleProp, ViewStyle } from "react-native";

/** 桌宠状态：与 pet-rig.js 的 MOODS 一一对应。 */
export type PetMood = "idle" | "listening" | "thinking" | "speaking" | "happy" | "sleep";

export type PetRigKind = "miro" | "bobi";

export type PetRigProps = {
  pet: PetRigKind;
  mood?: PetMood;
  /** 夜间：米露的眼睛和星星变成光源。 */
  night?: boolean;
  /** 0~1。倾听时传用户音量；说话时可不传，运行时会自己合成说话节奏。 */
  level?: number;
  /** 系统「减弱动态」：定格在安静姿势，只在状态变化时重画。 */
  reduceMotion?: boolean;
  /** 后台 / 不可见时暂停渲染。 */
  paused?: boolean;
  /** 每次变化触发一次「被戳」反应。 */
  pokeKey?: number;
  /** 第一帧画好之后回调，用来撤掉静态兜底图。 */
  onReady?: () => void;
  /** 运行时加载失败（例如 WebView 不可用）。 */
  onError?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** 支持骨骼动画的预设。 */
export function isRigPet(presetId: string | null | undefined): presetId is PetRigKind {
  return presetId === "miro" || presetId === "bobi";
}
