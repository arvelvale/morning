import type { ImageSourcePropType } from "react-native";

export type PetArtworkAssets = {
  /** 静态兜底：动图首帧。动图加载失败或系统要求减弱动态时显示。 */
  idle: ImageSourcePropType;
  /** 日间动图：醒着抱星星（GIF，Fresco 循环播放）。 */
  motionDay: ImageSourcePropType;
  /** 夜间动图：抱着星星打瞌睡。夜间不是换装，是同一只猫困了。 */
  motionNight: ImageSourcePropType;
};

// 米露 3.0：黑毛小猫，抱一颗星星。日间醒着，夜里打盹——
// 与「夜间是同一盏灯调暗」的骨架同构。
const PET_ARTWORK: Record<string, PetArtworkAssets> = {
  miro: {
    idle: require("../../assets/pets/miro/animations/miro-star-hug-frame0.png"),
    motionDay: require("../../assets/pets/miro/animations/miro-star-hug.gif"),
    motionNight: require("../../assets/pets/miro/animations/miro-dozing.gif"),
  },
};

const PET_AVATARS: Record<string, ImageSourcePropType> = {
  miro: require("../../assets/pets/avatars/miro-avatar-v2.png"),
  // 波比 v2：暖橘晨光猫，与喵灵猫形象统一；v1 金毛犬仅作历史备份。
  bobi: require("../../assets/pets/avatars/bobi-avatar-v2.png"),
};

export function getPetArtwork(presetId: string | null): PetArtworkAssets | undefined {
  return presetId ? PET_ARTWORK[presetId] : undefined;
}

export function getPetAvatar(presetId: string | null): ImageSourcePropType | undefined {
  return presetId ? PET_AVATARS[presetId] : undefined;
}
