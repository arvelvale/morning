/**
 * assembleAnySpec —— 渲染统一入口：自动识别新旧两种 spec 格式。
 *
 * 旧格式（绝对坐标，含存量入库数据）直接走原 assembleScene；
 * 新格式（关系式 SemanticSceneSpec）先经 solveLayout 解算成绝对坐标再拼装。
 * 解算发生在渲染前内存中，入库数据保持语义版不变（见 layout/ 头注释）。
 */
import type { TheaterScene } from "../types";
import { assembleScene } from "./assemble";
import type { SceneSpec } from "./spec";
import { isSemanticSpec, solveLayout } from "./layout/solve";
import type { LayoutReport } from "./layout/types";

export interface AssembleResult extends TheaterScene {
  /** 仅当输入是语义版时携带解算报告，dev 预览屏展示。 */
  layoutReport?: LayoutReport;
}

export function assembleAnySpec(input: unknown): AssembleResult {
  if (isSemanticSpec(input)) {
    const { spec, report } = solveLayout(input);
    return { ...assembleScene(spec, report), layoutReport: report };
  }
  return assembleScene(input as SceneSpec);
}
