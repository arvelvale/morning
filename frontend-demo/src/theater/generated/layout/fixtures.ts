/**
 * 关系版回归夹具 —— 六份手写 samples 的 SemanticSceneSpec 改写。
 *
 * 双重用途：
 *  1. Layout Engine 的回归输入：每份对应一张人工调过构图的绝对坐标基准
 *     （../samples.ts），解算结果应「构图不差于」基准；
 *  2. 后端 few-shot 的素材源（后端 scene_spec.py 里内嵌其精简版字符串，
 *     改这份文件时记得同步那边——两端各留一行注释互相指认）。
 */
import type { SemanticSceneSpec } from "./types";

/** 露营·深夜·篝火旁打电话。 */
export const fixtureCampfireNight: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "outdoor", time: "night", stars: true, moon: { angle: 0.5, height: 40 }, mountains: { color: "#0d1728", count: 8 } },
  props: [
    { id: "tent1", type: "tent", at: { zone: "background", side: "left" }, params: { color: "#c46a3a" } },
    { id: "fire1", type: "campfire", at: { zone: "midground", side: "center", bias: [0.5, -1.5] } },
    { id: "tree1", type: "pineTree", nextTo: "tent1", params: { height: 4 } },
    { id: "tree2", type: "pineTree", behind: "tree1", params: { height: 3.4 } },
    { id: "rock1", type: "rock", inFrontOf: "fire1", params: { size: 0.4 } },
    { id: "bush1", type: "bush", at: { zone: "midground", side: "left" } },
  ],
  characters: [
    { id: "caller", pose: "phone", facing: "away", at: { zone: "midground", side: "center", bias: [1.3, -0.6] }, bodyColor: "#7a8ba8" },
  ],
};

/** 家中餐桌·白天·母子对坐喝茶（完整房间构图：墙窗贴后沿，桌椅居毯，双杯对饮）。 */
export const fixtureDiningDay: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "indoor", time: "day", ground: { color: "#b8a884" } },
  props: [
    { id: "wallBack", type: "wall", at: { zone: "background", side: "center", bias: [-0.4, -2.9] }, params: { width: 7, height: 2.8, color: "#e2d4bc" } },
    { id: "win1", type: "window", at: { zone: "background", side: "center", bias: [-2.5, -2.82] }, params: { glow: "#eaf2ff" } },
    { id: "rugA", type: "rug", at: { zone: "midground", side: "center", bias: [0.15, -0.3] }, params: { width: 3.4, depth: 2.6, color: "#9a5344" } },
    { id: "table1", type: "table", at: { zone: "midground", side: "center", bias: [0.1, -0.85] }, params: { width: 1.5, depth: 0.9 } },
    { id: "chairMom", type: "chair", at: { zone: "midground", side: "center", bias: [0.1, 0.28] }, rotY: Math.PI },
    { id: "chairKid", type: "chair", at: { zone: "midground", side: "center", bias: [1.45, -0.85] }, rotY: -Math.PI / 2 },
    { id: "cupA", type: "teacup", on: "table1" },
    { id: "cupB", type: "teacup", on: "table1" },
  ],
  characters: [
    { id: "mom", pose: "sitting", sitOn: "chairMom", facing: "toward:kid", type: "adult", bodyColor: "#a88a7a" },
    { id: "kid", pose: "sitting", sitOn: "chairKid", facing: "toward:mom", type: "child", bodyColor: "#8a97ad" },
  ],
};

/** 黄昏·长椅旁道别：学生坐长椅挥手，大人拎行李回头（路灯光斑下的"留守 vs 远行"）。 */
export const fixtureDuskFarewell: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "outdoor", time: "dusk", moon: false, mountains: { count: 6, color: "#5a4550" } },
  props: [
    { id: "pave1", type: "pavement", at: { zone: "midground", side: "center", bias: [0.3, -0.55] }, params: { width: 5.6, depth: 3.4 } },
    { id: "walk1", type: "sidewalk", at: { zone: "midground", side: "center", bias: [-1.4, -2.0] } },
    { id: "walk2", type: "sidewalk", at: { zone: "midground", side: "center", bias: [0.6, -2.0] } },
    { id: "sign1", type: "signBoard", at: { zone: "midground", side: "right", bias: [2.3, -1.6] } },
    { id: "bin1", type: "trashBin", at: { zone: "midground", side: "right", bias: [2.95, -1.0] } },
    { id: "bench1", type: "bench", at: { zone: "midground", side: "center", bias: [-0.5, -0.7] }, params: { width: 1.8 } },
    { id: "lamp1", type: "streetlight", nextTo: "bench1", params: { intensity: 1.6 } },
    { id: "bag1", type: "luggage", nextTo: "adult1", params: { color: "#b05c4a" } },
    { id: "grass1", type: "wildgrass", at: { zone: "midground", side: "center", bias: [-2.5, 0.6] } },
    { id: "grass2", type: "wildgrass", at: { zone: "midground", side: "center", bias: [2.7, -1.9] } },
    { id: "bush1", type: "bush", at: { zone: "midground", side: "right" } },
    { id: "rock1", type: "rock", at: { zone: "foreground", side: "left" }, params: { size: 0.35 } },
  ],
  characters: [
    { id: "student1", pose: "waving", sitOn: "bench1", facing: "camera", type: "student", outfit: "uniform", backpack: true, bodyColor: "#4a6a9a" },
    { id: "adult1", pose: "lookingBack", behind: "student1", facing: "toward:student1", type: "adult", outfit: "coat", bodyColor: "#9a8a72" },
  ],
};

/** 雨夜海边·告别（展示 water/cityscape/rain 这些氛围件的区位放法）。 */
export const fixtureRainyPier: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "outdoor", time: "night", stars: false, moon: { angle: 0.2, height: 30 } },
  props: [
    { id: "sea1", type: "water", at: { zone: "background", side: "center" }, params: { width: 60, depth: 40 } },
    { id: "city1", type: "cityscape", at: { zone: "background", side: "center" }, params: { count: 8, window: "#ffcf8a" } },
    { id: "rain1", type: "rain", at: { zone: "midground", side: "center" }, params: { count: 260, area: 14 } },
    { id: "puddle1", type: "puddle", at: { zone: "midground", side: "left", bias: [-1.6, 1.1] }, params: { size: 0.5 } },
    { id: "puddle2", type: "puddle", at: { zone: "midground", side: "right", bias: [1.7, -0.4] }, params: { size: 0.36 } },
    { id: "lamp1", type: "streetlight", nextTo: "chairEmpty", params: { intensity: 1.4 } },
    { id: "umbrella1", type: "umbrella", behind: "chairEmpty", params: { closed: true } },
    { id: "chairEmpty", type: "emptyChair", at: { zone: "midground", side: "left", bias: [-0.8, 0.6] } },
  ],
  characters: [
    { id: "me1", pose: "phone", facing: "camera", at: { zone: "midground", side: "center", bias: [0.6, 0.6] }, bodyColor: "#8a7a9a" },
  ],
};

/** 黄昏校门口·孩子哭了大人蹲下安慰。 */
export const fixtureSchoolComfort: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "outdoor", time: "dusk" },
  props: [
    { id: "gate1", type: "schoolGate", at: { zone: "background", side: "center", bias: [0, -4] } },
    { id: "road1", type: "road", at: { zone: "midground", side: "center" }, params: { width: 10 } },
    { id: "lamp1", type: "streetlight", nextTo: "gate1", params: { intensity: 1.3 } },
    { id: "bush1", type: "bush", at: { zone: "background", side: "right", bias: [2.6, -2] } },
  ],
  characters: [
    { id: "teacher", pose: "comforting", inFrontOf: "gate1", facing: "toward:kid", type: "adult", outfit: "coat", bodyColor: "#7a6a58" },
    { id: "kid", pose: "crying", nextTo: "teacher", facing: "toward:teacher", type: "child", outfit: "uniform", backpack: true },
  ],
};

/** 黄昏·乡下老家：瓦房炊烟、木栅栏小院、汀步石板路、柴火垛；奶奶门口迎接、孩子跑回来。 */
export const fixtureGrandmaHouse: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "outdoor", time: "dusk", mountains: { count: 5, color: "#6a4a4a" } },
  props: [
    { id: "house1", type: "oldHouse", at: { zone: "background", side: "center", bias: [0, -3.5] }, params: { width: 4.4, depth: 3.2 } },
    { id: "path1", type: "steppingStones", at: { zone: "midground", side: "center", bias: [0.2, 0.4] }, params: { length: 4.2 } },
    { id: "fence1", type: "railing", at: { zone: "midground", side: "center", bias: [-2.6, 0.2] }, rotY: Math.PI / 2, params: { wooden: true, length: 3.6, height: 0.8 } },
    { id: "fence2", type: "railing", at: { zone: "midground", side: "center", bias: [2.6, 0.2] }, rotY: Math.PI / 2, params: { wooden: true, length: 3.6, height: 0.8 } },
    { id: "wood1", type: "firewood", nextTo: "house1", at: { zone: "background", side: "left", bias: [-1.9, -2.1] } },
    { id: "grass1", type: "wildgrass", at: { zone: "midground", side: "left", bias: [-2.2, -0.9] } },
    { id: "grass2", type: "wildgrass", at: { zone: "midground", side: "right", bias: [2.4, -1.4] } },
    { id: "bush1", type: "bush", at: { zone: "background", side: "right", bias: [2.8, -2.2] } },
    { id: "rock1", type: "rock", at: { zone: "midground", side: "left", bias: [-2.0, -0.4] }, params: { size: 0.35 } },
  ],
  characters: [
    { id: "grandma", pose: "handsFolded", inFrontOf: "house1", facing: "toward:kid2", type: "elderly", outfit: "coat", hairstyle: "bun", bodyColor: "#7a7268" },
    { id: "kid2", pose: "walking", facing: "toward:grandma", at: { zone: "midground", side: "center", bias: [0.35, 1.9] }, type: "child", outfit: "uniform", backpack: true },
  ],
};

/** 深夜书房（单房间骨架）：后墙一扇窗、左墙一扇门；书桌/书架靠后墙，床靠左墙，人坐在桌前。 */
export const fixtureStudyNight: SemanticSceneSpec = {
  kind: "semantic",
  env: { mode: "indoor", time: "night" },
  mood: "cozy_indoor_night",
  room: {
    width: 5.4, depth: 4.6, height: 2.8, wallColor: "#d9cdb8", floorColor: "#a9855d",
    openings: [
      { kind: "window", wall: "back", offset: 0.15, width: 1.3, sill: 1.0, height: 1.2 },
      { kind: "door", wall: "left", offset: -0.6, width: 0.95 },
    ],
  },
  props: [
    { id: "desk1", type: "desk", at: { zone: "background", side: "center", edge: "back", bias: [0.4, 0] } },
    { id: "shelf1", type: "bookshelf", at: { zone: "background", side: "right", edge: "back" } },
    { id: "bed1", type: "bed", at: { zone: "midground", side: "right", edge: "left" } },
    { id: "rug1", type: "rug", at: { zone: "midground", side: "center", bias: [0.3, 0.2] }, params: { width: 2.2, depth: 1.5, color: "#7a5a58" } },
    { id: "chair1", type: "chair", inFrontOf: "desk1", rotY: Math.PI },
    { id: "lamp1", type: "lamp", on: "desk1" },
    { id: "photo1", type: "photoFrame", on: "desk1" },
  ],
  characters: [
    { id: "me", pose: "sitting", sitOn: "chair1", facing: "toward:desk1", type: "student", bodyColor: "#8a97ad" },
  ],
};

/** 夹具注册表（预览屏按 key 切换）。 */
export const SEMANTIC_FIXTURES: Record<string, SemanticSceneSpec> = {
  campfireNight: fixtureCampfireNight,
  diningDay: fixtureDiningDay,
  duskFarewell: fixtureDuskFarewell,
  rainyPier: fixtureRainyPier,
  schoolComfort: fixtureSchoolComfort,
  grandmaHouse: fixtureGrandmaHouse,
  studyNight: fixtureStudyNight,
};
