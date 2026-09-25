import type { ImageSourcePropType } from "react-native";

/**
 * 米露 / 波比的静态图都由骨骼动画渲染导出（design-demos/pet-motion，pet-rig.js 同源），
 * 与动画第一帧同机位，淡入切换时不会跳。
 * 旧的 GPT 立绘与 GIF 仍留在 assets/pets 里作历史备份，已不再引用。
 */
const PET_STILLS: Record<string, { idle: ImageSourcePropType; sleep: ImageSourcePropType }> = {
  miro: {
    idle: require("../../assets/pets/rig/miro-idle.png"),
    sleep: require("../../assets/pets/rig/miro-sleep.png"),
  },
  bobi: {
    idle: require("../../assets/pets/rig/bobi-idle.png"),
    sleep: require("../../assets/pets/rig/bobi-sleep.png"),
  },
};

/** 动画加载前 / 加载失败时的静态兜底：醒着或打盹两种姿势。 */
export function getPetStill(presetId: string, pose: "idle" | "sleep"): ImageSourcePropType | undefined {
  return PET_STILLS[presetId]?.[pose];
}

/** 头像：与立绘同一张全身像，各处都按 contain 显示。 */
export function getPetAvatar(presetId: string | null): ImageSourcePropType | undefined {
  return presetId ? PET_STILLS[presetId]?.idle : undefined;
}
