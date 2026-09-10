/**
 * Mood System —— 场景情绪 → 光照/雾/曝光的一体化预设（P3 Step 1）。
 *
 * 设计原则：LLM 只表达 `mood`（可选）；缺省时由 env.time × mode × 天气信号自动推断。
 * 旧 TIME_PRESETS 的三档基调被本系统吸收为 fallback 源；spec.lighting 显式覆盖仍最高优先。
 *
 * 灯光结构（cinematic rig）：
 *   HemisphereLight（天空/地面环境底色） + Key DirectionalLight（投影主光）
 *   + Fill DirectionalLight（反方向无阴影补光，消除纯黑死角）
 *   + 实用光（practical lights）由零件自带，经 lightBudget 裁剪。
 */
import * as THREE from "three";
import type { SceneSpec, Vec3 } from "../spec";

export interface MoodPreset {
  /** 天空渐变：top 天顶 / bottom 兜底；mid/horizon 提供时走三段暮色（sky shader）。 */
  sky: {
    top: number; bottom: number;
    mid?: number; horizon?: number;
    /** 太阳方位晚霞加成强度（0~1，配 sunDir=key 光方向）。 */
    sunGlowStrength?: number;
    sunTint?: number;
  };
  /** 地面基色。 */
  ground: number;
  hemi: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number; pos: [number, number, number] };
  fill: { color: number; intensity: number };
  /** 场景雾：indoor 用远雾制造深度即可，outdoor 视天气。 */
  fog?: { color: number; near: number; far: number } | { density: number };
  /** 曝光微调（叠加在渲染器 ACESFilmic 基线 1.1 上）。 */
  exposureBias?: number;
}

export const MOOD_PRESETS = {
  warm_day: {
    sky: { top: 0x8fb3e0, bottom: 0xe6eef6 }, ground: 0x8a9a78,
    hemi: { sky: 0xbdd4ee, ground: 0x9a8a70, intensity: 0.85 },
    key: { color: 0xfff2d8, intensity: 1.35, pos: [18, 32, 22] },
    fill: { color: 0xdce8f5, intensity: 0.35 },
    fog: { color: 0xdfe8f0, near: 30, far: 110 },
  },
  sunset: {
    // 黄昏：暮紫天顶 → 晚霞粉橙 → 地平线暖金；太阳方位晚霞加成勾勒金色轮廓感
    sky: { top: 0x2b1b3d, bottom: 0xd35400, mid: 0xb0566a, horizon: 0xf1c40f, sunGlowStrength: 0.85, sunTint: 0xffa050 },
    ground: 0x6a5a4c,
    hemi: { sky: 0xc7a0b8, ground: 0x8a6a52, intensity: 0.95 },
    key: { color: 0xffa060, intensity: 1.75, pos: [-28, 14, 22] },
    fill: { color: 0xc09a92, intensity: 0.55 },
    fog: { color: 0xe8a878, near: 34, far: 120 },
    exposureBias: 0.05,
  },
  night_calm: {
    sky: { top: 0x070d1f, bottom: 0x16223d }, ground: 0x35493f,
    hemi: { sky: 0xadc4df, ground: 0x596d7c, intensity: 1.15 },
    key: { color: 0xb6c9e8, intensity: 1.05, pos: [20, 35, 25] },
    fill: { color: 0x9fb9d6, intensity: 0.65 },
  },
  rainy: {
    // 阴雨：低对比冷灰蓝 + 近雾压缩纵深
    sky: { top: 0x3a4552, bottom: 0x5d6a76 }, ground: 0x3c4442,
    hemi: { sky: 0x5d6d80, ground: 0x39413e, intensity: 0.9 },
    key: { color: 0xaebcc8, intensity: 0.65, pos: [12, 26, 14] },
    fill: { color: 0x46505a, intensity: 0.42 },
    fog: { color: 0x55606a, near: 10, far: 60 },
    exposureBias: -0.04,
  },
  rainy_night: {
    sky: { top: 0x05080f, bottom: 0x121a24 }, ground: 0x141a18,
    hemi: { sky: 0x91a9c2, ground: 0x506371, intensity: 1.1 },
    key: { color: 0xa4bedb, intensity: 1, pos: [-14, 30, 20] },
    fill: { color: 0x91a8c1, intensity: 0.65 },
    fog: { color: 0x11181f, near: 9, far: 48 },
    exposureBias: 0.08,
  },
  cozy_indoor_day: {
    // 白天室内：窗口方向冷调天光为主光，室内偏暖
    sky: { top: 0x8fb3e0, bottom: 0xe6eef6 }, ground: 0xb8a884,
    hemi: { sky: 0xcfdcee, ground: 0xa89374, intensity: 0.9 },
    key: { color: 0xf2ead8, intensity: 1.15, pos: [-8, 22, 10] },
    fill: { color: 0xe8dcc8, intensity: 0.5 },
  },
  cozy_indoor_night: {
    // 夜晚室内：暖灯主光包围感
    sky: { top: 0x1a1410, bottom: 0x2c2018 }, ground: 0x40342a,
    hemi: { sky: 0xc6b49e, ground: 0x80715f, intensity: 1.05 },
    key: { color: 0xffcf96, intensity: 1.25, pos: [6, 18, 8] },
    fill: { color: 0xffb878, intensity: 0.42 },
    exposureBias: 0.04,
  },
  campfire_night: {
    // 篝火夜：黑夜氛围但主体可读——冷色月夜环境打底（帐篷/树/地面轮廓可见），
    // 篝火是画面唯一暖焦点，"火边最亮、远处渐暗"的层次由实用光衰减自然形成
    sky: { top: 0x0a1020, bottom: 0x182234 }, ground: 0x35453c,
    hemi: { sky: 0xadc4df, ground: 0x596b78, intensity: 1.15 },
    key: { color: 0xb1c6e4, intensity: 1, pos: [-16, 30, 18] },
    fill: { color: 0x9fb6d1, intensity: 0.65 },
    fog: { color: 0x101823, near: 14, far: 70 },
    exposureBias: 0.12,
  },
} satisfies Record<string, MoodPreset>;

export type MoodId = keyof typeof MOOD_PRESETS;

/** 显式 mood 词表（与后端 ALLOWED_MOODS 同步；越权词回落自动推断）。 */
export const ALLOWED_MOODS = new Set([
  "warm_day", "sunset", "night_calm", "rainy", "rainy_night",
  "cozy_indoor_day", "cozy_indoor_night", "campfire_night",
]);

/**
 * 解析最终生效的 mood：
 * LLM 显式声明 > 场景信号推断（props 有 rain→雨系 / campfire→篝火夜）> time×mode 基础档。
 */
export function resolveMood(spec: SceneSpec): MoodPreset {
  const hint = (spec as { mood?: string }).mood;
  if (typeof hint === "string" && ALLOWED_MOODS.has(hint)) return MOOD_PRESETS[hint as MoodId];

  const props = (spec.props ?? []).map((p) => p.type);
  const hasRain = props.includes("rain");
  const hasFire = props.includes("campfire");
  const indoor = spec.env.mode === "indoor";
  const night = spec.env.time === "night";
  if (hasRain) return night ? MOOD_PRESETS.rainy_night : MOOD_PRESETS.rainy;
  if (hasFire && night) return MOOD_PRESETS.campfire_night;
  if (indoor) return night ? MOOD_PRESETS.cozy_indoor_night : MOOD_PRESETS.cozy_indoor_day;
  if (spec.env.time === "dusk") return MOOD_PRESETS.sunset;
  return night ? MOOD_PRESETS.night_calm : MOOD_PRESETS.warm_day;
}

/**
 * 把 mood 应用为 THREE 对象集合：Hemisphere+Key+Fill 光、scene fog 配置与曝光偏差。
 * 返回 fog/exposure 给 sceneSetup（需要挂到真实 Scene 上），灯光对象由调用方 add 进 group。
 * spec.lighting 显式覆盖在 assemble 层处理（最高优先级，行为不变）。
 */
export function buildMoodRig(preset: MoodPreset): {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  fog?: THREE.Fog | THREE.FogExp2;
  exposureBias?: number;
} {
  const hemi = new THREE.HemisphereLight(preset.hemi.sky, preset.hemi.ground, preset.hemi.intensity);

  const key = new THREE.DirectionalLight(preset.key.color, preset.key.intensity);
  key.position.set(...preset.key.pos);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);          // 预算：单张 1k 平行光阴影足够低模
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 90;
  const S = 16;                                 // 阴影相机覆盖 ±16m 主活动区
  key.shadow.camera.left = -S; key.shadow.camera.right = S;
  key.shadow.camera.top = S; key.shadow.camera.bottom = -S;
  key.shadow.bias = -0.0006;                    // 防 acne
  key.shadow.radius = 4;                        // PCFSoft 下柔和边缘

  const fill = new THREE.DirectionalLight(preset.fill.color, preset.fill.intensity);
  fill.position.set(-preset.key.pos[0], preset.key.pos[1], -preset.key.pos[2]);

  let fog: THREE.Fog | THREE.FogExp2 | undefined;
  const f = preset.fog as { color?: number; near?: number; far?: number; density?: number } | undefined;
  if (f) {
    fog = f.density !== undefined
      ? new THREE.FogExp2(f.color ?? 0x222833, f.density)
      : new THREE.Fog(f.color ?? 0x222833, f.near ?? 20, f.far ?? 100);
  }
  return { hemi, key, fill, fog, exposureBias: preset.exposureBias };
}
