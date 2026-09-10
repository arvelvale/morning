/**
 * 零件语义锚点表 —— Layout Engine 的摆放依据。
 *
 * 几何尺寸不手标：solve 时对实例现场构造代理体用 Box3 实测（与构造器永不脱节）。
 * 这里只标注「实测量不出来的语义」——座位在哪、容器内部点、承载面修正、
 * 哪些件是氛围粒子、哪些是画面骨架件（backdrop）。
 *
 * 坐姿接触高度由 figure/anchors 实测，不能在这里复制固定臀部高度。
 */
import * as THREE from "three";
import { buildProp } from "../props";

/**
 * 画面骨架件规则：road/water/train 这类远超 ±11m 坐标语义的大件，
 * 位置不交给撒布/钳制/碰撞管线，由锚点权威指定；at.bias 作为相对偏移仍生效。
 */
export interface BackdropRule {
  x: number;
  y?: number;
  z: number;
  rotY?: number;
}

/** 逐件标注的语义锚点（字段全部可缺省；没条目的件只用 BBox 默认值）。 */
export interface PropAnchorMeta {
  /** 承载面 Y 修正（默认取 BBox 顶，如平台顶棚会干扰测量时手写覆盖）。 */
  top?: number;
  surface?: { cx: number; cz: number; hw: number; hd: number; ellipse?: boolean };
  /** 座位：相对零件中心的偏移 + 就坐朝向（face 弧度；缺省继承宿主 rotY 或 0 = 朝 +z）。 */
  seats?: { dx?: number; dz?: number; face?: number }[];
  /** 容器内部落点（inside/in 关系）：dy 为内部地面高度，缺省 0。 */
  innerDy?: number;
  /** 纯地面贴片（road/crosswalk/rug 等）：互相之间不参与碰撞推挤，也当别人的地面。 */
  flatUnderlay?: boolean;
  /** 氛围粒子/远景片（rain/fireflies/water/cityscape/stringLights）：完全跳过碰撞。 */
  ambientOnly?: boolean;
  /** 画面骨架件：权威锚点定位（见 BackdropRule）。 */
  backdrop?: BackdropRule;
  /**
   * 推荐视觉缩放：1 = 构造器默认即为合理尺度。
   * solver 以它乘实例最终 scale；LLM 的 scale 自 P2 起被后端剥离不再传入。
   */
  visualScale?: number;
}

export const PROP_META: Record<string, PropAnchorMeta> = {
  // ── 高频承载件（P1 标注清单）──
  table:    {},                                     // top 用 BBox（桌面 0.74 自动）
  bench:    { top: 0.485, seats: [{ dx: -0.4 }, { dx: 0.4 }] },
  chair:    { top: 0.445, seats: [{ face: 0 }], surface: { cx: 0, cz: 0, hw: .22, hd: .22 } },
  emptyChair: { top: 0.445, seats: [{ face: 0 }], surface: { cx: 0, cz: 0, hw: .22, hd: .22 } },
  sofa:     { top: 0.52, seats: [{ dx: -0.48 }, { dx: 0.48 }] },
  crate:    {},                                     // 顶面 = size（自动）
  rug:      { flatUnderlay: true },
  busStop:  { top: 0.5, seats: [{ dx: -0.8, dz: -0.35, face: 0 }, { dx: 0.4, dz: -0.35, face: 0 }] },
  schoolGate: {},                                   // 地标件：只有 BBox，nextTo/inFrontOf 参照用

  // 顺手补的两处便宜容器锚点（深夜电话亭站进去、帐篷钻进去）
  phoneBooth: { innerDy: 0 },
  tent:       { innerDy: 0 },

  // ── 贴片与氛围件 ──
  road:      { flatUnderlay: true, backdrop: { x: 0, z: 2, rotY: 0 } },
  crosswalk: { flatUnderlay: true, backdrop: { x: 0, z: -1.5 } },
  railing:   { flatUnderlay: true },
  pavement:  { flatUnderlay: true },        // 石砖地微环境贴片
  steppingStones: { flatUnderlay: true },   // 汀步石板路贴片
  wall:      { flatUnderlay: true },   // 背景板，不与前景件互挤
  window:    { flatUnderlay: true },   // 挂墙面：先用 at.bias 贴近，后续补"贴面"关系

  water:     { ambientOnly: true, backdrop: { x: 0, y: -0.1, z: -16 } },
  cityscape: { ambientOnly: true, backdrop: { x: 0, z: -38 } },
  rain:      { ambientOnly: true },
  fireflies: { ambientOnly: true },
  stringLights: { ambientOnly: true },
  curtain:   { flatUnderlay: true },   // 挂墙贴片（背贴墙面 z=0）
  puddle:    { flatUnderlay: true },
  fallenLeaves: { flatUnderlay: true },
  sidewalk:  { flatUnderlay: true },   // 道牙模块（两端开放拼接）

  // ── 超大交通骨架：站台横贯画面 + 列车在站台远侧 ──
  platform:  { top: 0.8, backdrop: { x: 0, z: -6 } },
  train:     { backdrop: { x: 0, z: -10, rotY: Math.PI / 2 } },
};

/** Parametric seat centres follow the actual furniture builders. */
export function propMeta(type: string, params: Record<string, unknown> = {}): PropAnchorMeta | undefined {
  const base = PROP_META[type];
  const width = typeof params.width === 'number' && Number.isFinite(params.width) && params.width > 0 ? params.width : undefined;
  if (type === 'table') {
    const w = width ?? 1.4, d = typeof params.depth === 'number' && params.depth > 0 ? params.depth : .8;
    return { ...base, surface: { cx: 0, cz: 0, hw: w * (w === d ? .64 : .5), hd: d * (w === d ? .64 : .5), ellipse: true } };
  }
  if (type === 'bench') {
    const w = width ?? 1.6;
    return { ...base, seats: [{ dx: -w * .32 }, { dx: w * .32 }], surface: { cx: 0, cz: 0, hw: w * .445, hd: .21 } };
  }
  if (type === 'sofa') {
    const w = width ?? 2;
    return { ...base, seats: [{ dx: -w * .24, dz: .04 }, { dx: w * .24, dz: .04 }], surface: { cx: 0, cz: .04, hw: w * .46, hd: .36 } };
  }
  if (type === 'busStop') return { ...base, surface: { cx: -.2, cz: -.35, hw: 1.2, hd: .2 } };
  return base;
}

/** 人物系统锚点（figure 不走 PROP_META，这里单独一张常量表）。 */
export const CHARACTER_META = {
  /** 手部持物点：站姿手前伸位置（递物/heldBy 小物的吸附锚，相对人物原点）。 */
  handDy: 0.92,
  handDz: 0.3,
};

/** 实例实测包围盒摘要（solve 内部使用）。 */
export interface MeasuredBox {
  surface?: { cx: number; cz: number; hw: number; hd: number; ellipse?: boolean };
  cx?: number; cz?: number; minY?: number;
  hw: number; hd: number;   // 半宽/半深（x/z）
  h: number;                // 总高
  top: number;              // 承载面 Y（meta.top 覆盖优先）
}

/** 类型分级：参与碰撞的强度（ambient 完全跳过，flat 只与非 flat 互挤）。 */
export function metaKind(meta: PropAnchorMeta | undefined): "solid" | "flat" | "ambient" {
  if (!meta) return "solid";
  if (meta.ambientOnly) return "ambient";
  if (meta.flatUnderlay) return "flat";
  return "solid";
}

/**
 * 现场测量一个零件实例的真实包围盒。
 * 构造代理体→设参→setFromObject→丢弃。同类同参数走缓存（同一 solve 会话内复用）。
 * 测量失败返回 null（调用方按「不可承载、仅按声明位处理」兜底）。
 */
export function measureProp(
  type: string,
  params: Record<string, unknown> | undefined,
  scale: number,
  cache: Map<string, MeasuredBox | null>,
): MeasuredBox | null {
  const key = `${type}|${JSON.stringify(params ?? {})}|${scale}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: MeasuredBox | null = null;
  try {
    const obj = buildProp(type, params ?? {});
    if (obj) {
      const box = new THREE.Box3().setFromObject(obj);
      const meta = propMeta(type, params);
      result = {
        ...(meta?.surface ? { surface: { ...meta.surface, cx: meta.surface.cx * scale, cz: meta.surface.cz * scale, hw: meta.surface.hw * scale, hd: meta.surface.hd * scale } } : {}),
        cx: (box.min.x + box.max.x) / 2 * scale,
        cz: (box.min.z + box.max.z) / 2 * scale,
        minY: box.min.y * scale,
        // 测量的是未缩放的代理体，这里统一乘上实例 scale
        hw: Math.max(0.05, ((box.max.x - box.min.x) / 2) * scale),
        hd: Math.max(0.05, ((box.max.z - box.min.z) / 2) * scale),
        h: Math.max(0.02, (box.max.y - box.min.y) * scale),
        top: meta?.top !== undefined
          ? meta.top * scale
          : Math.max(0.01, box.max.y * scale),
      };
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}
