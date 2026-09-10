/**
 * 统一材质库 —— 喵灵 3D 世界材质语言的唯一定义处（P3 Step 1）。
 *
 * 目标：所有组件使用同一套 roughness/metalness/透明度语义，同一类材质允许轻微
 * 色差但不允许风格漂移；避免「每个 builder 随手 new Material」造成的编译开销
 * 与观感割裂。
 *
 * 性能设计：preset+color 相同的材质**全局共享同一个实例**（cache 命中直接返回），
 * 场景卸载时由 Scene3D 的 disposeObject 跳过 `userData.__shared` 标记的材质，
 * 因此缓存实例常驻、跨场景复用零重建成本。
 */
import * as THREE from "three";

export type MatPreset =
  | "wood"          // 木材：哑光偏糙
  | "paintedWood"   // 漆木/家具漆面：略平滑
  | "fabric"        // 布料织物：全哑光
  | "metal"         // 金属结构：中反光
  | "glass"         // 玻璃：低粗糙高透
  | "ceramic"       // 陶瓷：光滑但非金属
  | "stone"         // 石材：全糙
  | "foliage"       // 植物：哑光+轻透感（低多边形下以 flatShading 表达）
  | "skin"          // 皮肤
  | "hair"
  | "roadSurf"      // 路面沥青
  | "emissive"      // 自发光（灯罩/屏面/窗光）
  | "standard";     // 兜底通用

/** 每个 preset 的物理基调（颜色由调用方传，色相归情绪、质感归这里）。
 *  粗糙度区间遵循 3D 资产规范：0.5~0.8 哑光质感带（例外：玻璃/路面）。 */
const BASE: Record<MatPreset, { roughness: number; metalness: number; opacity?: number }> = {
  wood:        { roughness: 0.74, metalness: 0.02 },
  paintedWood: { roughness: 0.6, metalness: 0.02 },
  fabric:      { roughness: 0.82, metalness: 0.0 },
  metal:       { roughness: 0.42, metalness: 0.45 },   // 无 envmap，过高 metalness 大面会发黑
  glass:       { roughness: 0.12, metalness: 0.0, opacity: 0.28 },
  ceramic:     { roughness: 0.3, metalness: 0.0 },
  stone:       { roughness: 0.85, metalness: 0.0 },
  foliage:     { roughness: 0.82, metalness: 0.0 },
  skin:        { roughness: 0.7, metalness: 0.0 },
  hair:        { roughness: 0.8, metalness: 0.0 },
  roadSurf:    { roughness: 0.92, metalness: 0.0 },
  emissive:    { roughness: 0.5, metalness: 0.0 },
  standard:    { roughness: 0.72, metalness: 0.0 },
};

/** hex 字符串("#1a2340")或数值 → 数值色；无效回落。 */
export function hexNum(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v.replace("#", ""), 16);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

const MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 取共享材质。flatShading 保持低多边形调性；
 * emissive preset 映射为 MeshBasicMaterial 语义的替代（暖自发光不用真实光源），
 * 这里统一 MeshStandardMaterial + emissive 通道，受色调映射影响更温和。
 */
export function mat(
  preset: MatPreset,
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {},
): THREE.MeshStandardMaterial {
  const key = `${preset}|${color}|${opts.emissive ?? ""}|${opts.emissiveIntensity ?? ""}|${opts.opacity ?? ""}`;
  const hit = MAT_CACHE.get(key);
  if (hit) return hit;

  const b = BASE[preset];
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: b.roughness,
    metalness: b.metalness,
    flatShading: preset !== "glass",
  });
  if (b.opacity !== undefined || opts.transparent) {
    m.transparent = true;
    m.opacity = opts.opacity ?? b.opacity ?? 1;
  }
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  m.userData.__shared = true;   // disposeObject 跳过释放
  MAT_CACHE.set(key, m);
  return m;
}

/**
 * 旧代码桥接：props.ts 原有的 hexNum(v, fb) + flatMat(color, roughness) 快速迁移通道。
 * 按粗糙度粗分到最近 preset，保持既有观感的同时纳入共享体系。
 */
export function legacyFlat(color: number, roughness = 0.95): THREE.MeshStandardMaterial {
  if (roughness <= 0.3) return mat("metal", color);
  if (roughness <= 0.55) return mat("paintedWood", color);
  return mat("wood", color);
}
