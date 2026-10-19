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

/**
 * 圆形头像的取景：静态图是 600×600 的全身像，猫在下半部分，直接缩进圆里只看到身子。
 * cx / cy = 头部中心（源图像素），span = 取景框边长（源图像素）；渲染时按 size/span 缩放并平移，使头部居中。
 * 数值对着 miro-idle / bobi-idle 的头部包围盒量的（米露头在 x130–450、y11–370，波比头在 x150–440、y94–410）。
 */
export type AvatarCrop = { cx: number; cy: number; span: number };

const AVATAR_CROPS: Record<string, AvatarCrop> = {
  miro: { cx: 292, cy: 225, span: 450 },
  bobi: { cx: 295, cy: 265, span: 400 },
};
export const PET_STILL_SIZE = 600;

/** 头像用的图 + 取景；没有 presetId（或不是内置桌宠）时退回米露。 */
export function getPetHeadAvatar(presetId: string | null | undefined): { source: ImageSourcePropType; crop: AvatarCrop } {
  const id = presetId && PET_STILLS[presetId] ? presetId : "miro";
  return { source: PET_STILLS[id].idle, crop: AVATAR_CROPS[id] };
}
