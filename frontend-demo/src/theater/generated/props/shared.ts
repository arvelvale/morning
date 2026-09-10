/**
 * 组件共享工具 —— 拆分后的 props/ 各文件统一从这里拿：
 * 类型、参数读取、颜色转换、材质桥接、阴影标记。
 * 材质语义本体在 vision/materials.ts（全局共享缓存），这里只是便捷转发。
 */
import * as THREE from "three";
import { mat, legacyFlat, hexNum as _hexNum } from "../vision/materials";

/** 组件外观/尺寸参数（来自 SceneSpec.params，原样透传）。 */
export type Params = Record<string, unknown>;

/** 组件构造器统一签名。 */
export type PropBuilder = (p: Params) => THREE.Object3D;

/** 取数值参数，缺省用 fallback。 */
export function numOf(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

/** hex 字符串("#1a2340")或数值 → 数值色。 */
export const hexNum = _hexNum;

/** 旧风格粗糙度材质桥接（映射到最近的材质预设，纳入全局共享池）。 */
export function flatMat(color: number, roughness = 0.95): THREE.MeshStandardMaterial {
  return legacyFlat(color, roughness);
}

/** 具名材质直通（比 flatMat 语义明确，新代码优先用这个）。 */
export { mat };

/** 递归把组内所有 mesh 标记为投影体。 */
export function markShadows(o: THREE.Object3D) {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
  return o;
}
