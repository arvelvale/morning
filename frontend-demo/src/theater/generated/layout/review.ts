/**
 * 校验回传环：把 solve/validator 产出的报告交还给"导演"（LLM）改一轮规格。
 *
 * 为什么放在前端：布局解算和校验都在端上跑（TypeScript），后端是 Python，没有第二份求解器；
 * 所以由端上先解一遍、挑出"改规格能解决"的问题，发给后端让模型改稿，再在端上重解、比分。
 *
 * 三条硬规则（防止"越改越糟/改没了人"）：
 *  1. 只看 unresolved / degraded 的问题；repaired（引擎已自动修好）不算；
 *  2. 只有"改规格能解决"的问题计分（CODE_WEIGHT）；相机取景、座位锚点这类引擎自己的事不算；
 *  3. 候选稿必须分数严格更低、人物一个不少、env 的室内外与时段不变，才会被采纳——否则丢弃，保留原稿。
 *
 * code → 权重这张表与后端 scene_spec.py 的 REVISE_HINTS 同步（后端按 code 配改稿提示，未知 code 会被丢弃）。
 */
import type { LayoutIssue, LayoutReport, SemanticSceneSpec } from "./types";
import { solveLayout } from "./solve";

/** 能靠改规格解决的问题及其分值（越大越该先改）。 */
export const CODE_WEIGHT: Record<string, number> = {
  RESIDUAL_OVERLAP: 3,          // 两件东西叠在一起
  RELATION_DEGRADED: 3,         // 关系没生效（引用无效、没座位、不能手持…）
  SUPPORT_FOOTPRINT_OVERFLOW: 3, // 东西比承载它的台面还大
  DOOR_BLOCKED: 3,              // 家具堵在门前
  ROOM_OBJECT_TOO_BIG: 3,       // 家具比房间还大
  CONTAINER_HEIGHT_OVERFLOW: 2, // 容器装不下
  WINDOW_BLOCKED: 2,            // 高柜遮窗
  ROOM_OBJECT_OUTSIDE: 2,
  OUT_OF_BOUNDS: 2,
  FACING_TARGET_INVALID: 2,
  ROOM_OPENING_DROPPED: 2,      // 门窗放不进墙
  EDGE_WITHOUT_ROOM: 2,         // 写了靠墙却没有房间
  SOFT_RELATION_RESIDUAL: 1,
  FACING_RESIDUAL: 1,
};
const PREFIX_WEIGHT: [string, number][] = [["RELATION_NOT_APPLIED_", 2]];

export function issueWeight(code: string): number {
  if (code in CODE_WEIGHT) return CODE_WEIGHT[code];
  return PREFIX_WEIGHT.find(([p]) => code.startsWith(p))?.[1] ?? 0;
}

const open = (i: LayoutIssue) => i.status === "unresolved" || i.status === "degraded";

/** 报告总分：只数还在、且改规格能解决的问题；0 = 没什么可让模型改的。 */
export function reviewScore(report: Pick<LayoutReport, "issues">): number {
  return (report.issues ?? []).reduce((s, i) => s + (open(i) ? issueWeight(i.code) : 0), 0);
}

export interface ReviewItem { code: string; ids: string[]; expected?: string; actual?: string; weight: number }

/** 发给模型的问题清单：按分值从高到低，最多 8 条，去重。 */
export function reviewItems(report: Pick<LayoutReport, "issues">, cap = 8): ReviewItem[] {
  const seen = new Set<string>();
  const items: ReviewItem[] = [];
  for (const i of report.issues ?? []) {
    const weight = open(i) ? issueWeight(i.code) : 0;
    if (!weight) continue;
    const key = i.code + "|" + i.objectIds.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ code: i.code, ids: i.objectIds.slice(0, 3), expected: i.expected, actual: i.actual, weight });
  }
  return items.sort((a, b) => b.weight - a.weight).slice(0, cap);
}

export const MAX_ROUNDS = 2;

/** 这份规格还值不值得让模型再改：语义版、没改满轮数、且确有可改的问题。 */
export function needsReview(spec: unknown, score: number): spec is SemanticSceneSpec {
  const s = spec as SemanticSceneSpec | null;
  return !!s && s.kind === "semantic" && score > 0 && (s.review?.rounds ?? 0) < MAX_ROUNDS;
}

/** 候选稿能不能被采纳（不看分数）：人物一个不少、室内外与时段不变。 */
export function candidateIsSafe(original: SemanticSceneSpec, candidate: SemanticSceneSpec): string | null {
  if (!candidate || candidate.kind !== "semantic") return "候选稿不是语义版规格";
  const ids = new Set((candidate.characters ?? []).map(c => c.id));
  const lost = (original.characters ?? []).filter(c => c.id && !ids.has(c.id));
  if (lost.length) return `候选稿删掉了人物：${lost.map(c => c.id).join("、")}`;
  if (candidate.env?.mode !== original.env?.mode || candidate.env?.time !== original.env?.time) return "候选稿改了室内外或时段";
  return null;
}

export interface ReviewDeps {
  /** 解算并给出报告；默认用真正的 solveLayout。测试里可注入。 */
  solve?: (spec: SemanticSceneSpec) => { report: LayoutReport };
  /** 请求模型按问题清单改稿；返回 null 表示这轮没拿到可用稿。 */
  revise: (spec: SemanticSceneSpec, items: ReviewItem[], round: number) => Promise<SemanticSceneSpec | null>;
}

export interface ReviewOutcome {
  spec: SemanticSceneSpec;
  /** 实际向模型要了几轮稿（含被拒绝的）。 */
  rounds: number;
  before: number;
  after: number;
  /** 每一轮发生了什么，写进日志/报告，不进 UI。 */
  log: string[];
}

/**
 * 回传环主流程：解算 → 挑问题 → 让模型改 → 重新解算 → 只收更好的 → 最多 MAX_ROUNDS 轮。
 * 返回的 spec 带 review 记录（即使一轮都没改进也记，避免下次打开又重复烧模型）。
 */
export async function reviewSpec(input: SemanticSceneSpec, deps: ReviewDeps): Promise<ReviewOutcome> {
  const solve = deps.solve ?? ((s: SemanticSceneSpec) => solveLayout(s));
  const log: string[] = [];
  const startRounds = input.review?.rounds ?? 0;
  let best = input;
  let report = solve(best).report;
  const before = reviewScore(report);
  let bestScore = before;
  let rounds = 0;

  while (bestScore > 0 && startRounds + rounds < MAX_ROUNDS) {
    const round = startRounds + rounds + 1;
    rounds++;
    const items = reviewItems(report);
    let candidate: SemanticSceneSpec | null = null;
    try { candidate = await deps.revise(best, items, round); } catch (e) { log.push(`第 ${round} 轮改稿请求失败：${String(e)}`); break; }
    if (!candidate) { log.push(`第 ${round} 轮没拿到可用稿`); continue; }
    const unsafe = candidateIsSafe(best, candidate);
    if (unsafe) { log.push(`第 ${round} 轮弃稿：${unsafe}`); continue; }
    const next = solve(candidate).report;
    const score = reviewScore(next);
    if (score < bestScore) {
      log.push(`第 ${round} 轮采纳：${bestScore} → ${score}`);
      best = candidate; report = next; bestScore = score;
    } else {
      log.push(`第 ${round} 轮弃稿：分数 ${score} 没有低于 ${bestScore}`);
    }
  }
  const spec: SemanticSceneSpec = { ...best, review: { rounds: startRounds + rounds, before, after: bestScore } };
  return { spec, rounds, before, after: bestScore, log };
}
