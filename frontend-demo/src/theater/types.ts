/**
 * theater 场景库公共类型。
 * 每个场景模块导出 create(): TheaterScene —— 纯 three.js，无 DOM 依赖，
 * 因此可同时跑在 Web 与 expo-gl（@react-three/fiber/native）。
 */
import type * as THREE from "three";

export interface TheaterCamera {
  pos: [number, number, number];
  look: [number, number, number];
}

/** 需要挂到真实 THREE.Scene 的环境项（R3F 里由 Scene3D 负责应用与卸载时还原）。 */
export interface TheaterSceneSetup {
  fog?: THREE.Fog | THREE.FogExp2;
  /** 渲染器曝光偏移（叠加在 ACESFilmic 基线上）。 */
  exposureBias?: number;
}

export interface TheaterScene {
  group: THREE.Group;
  /** 每帧驱动场景内动画（火焰/蒸汽/海浪等），t 为秒。 */
  update: (t: number) => void;
  camera: TheaterCamera;
  /** Runtime-only framing subjects; no change to stored SceneSpec. */
  framing?: import('./generated/vision/framing').SceneFraming;
  /** 可选：mood 系统推导出的场景级雾/曝光（预置六场景可不返回，行为不变）。 */
  sceneSetup?: TheaterSceneSetup;
}

/** 六个预置场景 id，与 theater/dist 的 URL hash 一致。 */
export type TheaterSceneId =
  | "campsite"   // 深夜通话 · 露营地（篝火/帐篷/星空）
  | "bedroom"    // 深夜通话 · 卧室窗前（月夜城市剪影）
  | "seaside"    // 深夜通话 · 海边（月光海面/浪沫）
  | "dining"     // 那晚 · 家中餐桌（白天，双人物对坐）
  | "airport"    // 离开的路上 · 机场候机厅（白天）
  | "station";   // 离开的路上 · 高铁站台（白天）
