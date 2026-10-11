/**
 * theater 场景库。
 * 每个场景为纯 three.js 构建：create() → { group, update(t), camera }，
 * 由 Scene3D.tsx 通过 R3F 的 <primitive> 挂载并逐帧驱动 update。
 */
import * as campsite from "./scenes/campsite";
import * as bedroomWindow from "./scenes/bedroomWindow";
import * as seaside from "./scenes/seaside";
import * as diningRoom from "./scenes/diningRoom";
import * as airport from "./scenes/airport";
import * as trainStation from "./scenes/trainStation";
import type { TheaterScene, TheaterSceneId } from "./types";

export type { TheaterScene, TheaterSceneId, TheaterCamera } from "./types";

// 生成式场景（方案 A）：LLM 产 SceneSpec → assembleScene 拼装；PROP_TYPES 供 prompt/校验。
export { assembleScene } from "./generated/assemble";
export { buildProp, PROP_TYPES } from "./generated/props";
export { SCENE_SAMPLES } from "./generated/samples";
export type { SceneSpec, SceneEnv, PropInstance, CharacterInstance } from "./generated/spec";

// 关系式布局（P1）：新格式语义 spec → 解算 → 绝对坐标 → 同一渲染管线。
export { assembleAnySpec } from "./generated/auto";
export type { AssembleResult } from "./generated/auto";
export { isSemanticSpec, solveLayout } from "./generated/layout/solve";
export { SEMANTIC_FIXTURES } from "./generated/layout/fixtures";
export type { SemanticSceneSpec, LayoutReport } from "./generated/layout/types";
export { reviewSpec, reviewScore, reviewItems } from "./generated/layout/review";

export const THEATER_SCENES: Record<TheaterSceneId, () => TheaterScene> = {
  campsite: campsite.create,
  bedroom: bedroomWindow.create,
  seaside: seaside.create,
  dining: diningRoom.create,
  airport: airport.create,
  station: trainStation.create,
};

export const THEATER_SCENE_IDS = Object.keys(THEATER_SCENES) as TheaterSceneId[];
