/** 空椅：与 chair 同几何，由摆放与朝向表达"对面无人"的未闭环意象。 */
import * as THREE from "three";
import { hexNum, type PropBuilder } from "../shared";
import { createChair } from "../furniture/createChair";

export const buildEmptyChair: PropBuilder = (p) => {
  return createChair({ color: typeof p.color === "number" ? p.color : 0x6b4a30 });
};
