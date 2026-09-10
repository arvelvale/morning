/** 木椅：座面/靠背/四腿（餐桌与通用坐具；座面顶 0.445，为 propMeta 座位锚点基准，勿随意改动）。 */
import * as THREE from "three";
import { mat } from "../../vision/materials";
import { createChair } from "./createChair";

/** 兼容旧调用方的具名构造（scenes/diningRoom 等预置场景也用）。 */
export { createChair };

/** SceneSpec type="chair"（type="emptyChair" 同款，仅摆放语义不同）。 */
export function buildChair(p: { color?: unknown } = {}): THREE.Object3D {
  return createChair({ color: typeof p.color === "number" ? p.color : 0x6b4a30 });
}
