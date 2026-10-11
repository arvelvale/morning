/**
 * PROP_BUILDERS 注册表 —— SceneSpec type 字符串到组件构造器的唯一映射。
 *
 * 新增组件：在对应域目录建 `<name>.ts` 导出 `build<Name>`，在此 import 并注册一行。
 * 外部一律 `import { buildProp, PROP_TYPES } from "../../generated/props"`（目录 index）。
 */
import type { PropBuilder, Params } from "./shared";

// furniture
import { buildChair } from "./furniture/chair";
import { buildTable } from "./furniture/table";
import { buildBench } from "./furniture/bench";
import { buildCrate } from "./furniture/crate";
import { buildRug } from "./furniture/rug";
import { buildWall } from "./furniture/wall";
import { buildWindow } from "./furniture/window";
import { buildLamp } from "./furniture/lamp";
import { buildBed } from "./furniture/bed";
import { buildSofa } from "./furniture/sofa";
import { buildDesk } from "./furniture/desk";
import { buildDoor } from "./furniture/door";
import { buildCurtain } from "./furniture/curtain";
import { buildBedsideTable } from "./furniture/bedsideTable";
import { buildBookshelf } from "./furniture/bookshelf";
import { buildCabinet } from "./furniture/cabinet";
import { buildMirror } from "./furniture/mirror";
import { buildStairs } from "./furniture/stairs";
import { buildRoom } from "./furniture/room";
// nature
import { buildPineTree } from "./nature/pineTree";
import { buildRock } from "./nature/rock";
import { buildBush } from "./nature/bush";
import { buildCampfire } from "./nature/campfire";
import { buildTent } from "./nature/tent";
import { buildWildgrass } from "./nature/wildgrass";
import { buildSteppingStones } from "./nature/steppingStones";
import { buildFirewood } from "./nature/firewood";
// environment
import { buildRoad } from "./environment/road";
import { buildCrosswalk } from "./environment/crosswalk";
import { buildSchoolGate } from "./environment/schoolGate";
import { buildRailing } from "./environment/railing";
import { buildBuilding } from "./environment/building";
import { buildOldHouse } from "./environment/oldHouse";
import { buildWater } from "./environment/water";
import { buildCityscape } from "./environment/cityscape";
import { buildPlatform } from "./environment/platform";
import { buildPavement } from "./environment/pavement";
import { buildPuddle } from "./environment/puddle";
import { buildFallenLeaves } from "./environment/fallenLeaves";
import { buildSidewalk } from "./environment/sidewalk";
import { buildDoorway } from "./environment/doorway";
// urban
import { buildStreetlight } from "./urban/streetlight";
import { buildBusStop } from "./urban/busStop";
import { buildPhoneBooth } from "./urban/phoneBooth";
import { buildVendingMachine } from "./urban/vendingMachine";
import { buildCafeTable } from "./urban/cafeTable";
import { buildParasol } from "./urban/parasol";
import { buildAirportSeats } from "./urban/airportSeats";
import { buildDepartureBoard } from "./urban/departureBoard";
import { buildSignBoard } from "./urban/signBoard";
import { buildTrashBin } from "./urban/trashBin";
// vehicle
import { buildCar } from "./vehicle/car";
import { buildTrain } from "./vehicle/train";
import { buildLuggage } from "./vehicle/luggage";
// decor（情感锚点小物）
import { buildEmptyChair } from "./decor/emptyChair";
import { buildPhotoFrame } from "./decor/photoFrame";
import { buildTeacup } from "./decor/teacup";
import { buildUmbrella } from "./decor/umbrella";
import { buildPhone } from "./decor/phone";
import { buildBook } from "./decor/book";
import { buildBackpack } from "./decor/backpack";
// ambient（氛围粒子）
import { buildRain } from "./ambient/rain";
import { buildFireflies } from "./ambient/fireflies";
import { buildStringLights } from "./ambient/stringLights";

/** 零件注册表：type → 构造器。 */
export const PROP_BUILDERS: Record<string, PropBuilder> = {
  // 基础件
  pineTree: buildPineTree,
  rock: buildRock,
  bush: buildBush,
  chair: buildChair,
  table: buildTable,
  bench: buildBench,
  crate: buildCrate,
  rug: buildRug,
  wall: buildWall,
  window: buildWindow,
  lamp: buildLamp,
  sofa: buildSofa,
  desk: buildDesk,
  door: buildDoor,
  curtain: buildCurtain,
  bedsideTable: buildBedsideTable,
  bookshelf: buildBookshelf,
  cabinet: buildCabinet,
  mirror: buildMirror,
  stairs: buildStairs,
  room: buildRoom,   // 单房间骨架：由语义规格的 room 字段展开，LLM 不直接选这个 type
  streetlight: buildStreetlight,
  tent: buildTent,
  wildgrass: buildWildgrass,
  steppingStones: buildSteppingStones,
  firewood: buildFirewood,
  campfire: buildCampfire,
  luggage: buildLuggage,
  // 抽自现有场景的大件（背景/地标）
  water: buildWater,
  bed: buildBed,
  cityscape: buildCityscape,
  platform: buildPlatform,
  train: buildTrain,
  airportSeats: buildAirportSeats,
  departureBoard: buildDepartureBoard,
  // 氛围动画
  rain: buildRain,
  stringLights: buildStringLights,
  fireflies: buildFireflies,
  // 情感锚点小物
  emptyChair: buildEmptyChair,
  photoFrame: buildPhotoFrame,
  teacup: buildTeacup,
  umbrella: buildUmbrella,
  phone: buildPhone,
  book: buildBook,
  backpack: buildBackpack,
  // 街道 / 校门
  road: buildRoad,
  crosswalk: buildCrosswalk,
  pavement: buildPavement,
  puddle: buildPuddle,
  fallenLeaves: buildFallenLeaves,
  sidewalk: buildSidewalk,
  doorway: buildDoorway,
  schoolGate: buildSchoolGate,
  railing: buildRailing,
  building: buildBuilding,
  // 乡村
  oldHouse: buildOldHouse,
  // 城市设施
  busStop: buildBusStop,
  car: buildCar,
  phoneBooth: buildPhoneBooth,
  vendingMachine: buildVendingMachine,
  cafeTable: buildCafeTable,
  parasol: buildParasol,
  signBoard: buildSignBoard,
  trashBin: buildTrashBin,
};

/** 所有可用零件 type，供 LLM prompt / 校验使用。 */
export const PROP_TYPES = Object.keys(PROP_BUILDERS);

/** 按 type 构造零件；未知 type 返回 null（调用方跳过并告警）。 */
export function buildProp(type: string, params: Params = {}): ReturnType<PropBuilder> | null {
  const builder = PROP_BUILDERS[type];
  return builder ? builder(params) : null;
}
