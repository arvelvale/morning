/**
 * 双轴提取：backend/app/graphs/extractor.py 的移植（提示词来自 generated/memoryPrompts.ts，逐字同源）。
 * 输入一次倾倒全文（或聊天里的一句话）→ 输出结构化事实列表 [{layer, kind, depth, ...}]。
 * 单次提取不产出 core 深度（Property 3）。失败返回空列表，绝不抛错。
 */
import { cstParts, nowContextText } from "./clock.ts";
import { CHAT_TODO_PROMPT, EXTRACTOR_FEW_SHOT_TEMPLATE, EXTRACTOR_SYSTEM_PROMPT } from "./generated/memoryPrompts.ts";
import type { ChatMessage, ModelClient } from "./llm.ts";
import { VALID_KINDS, VALID_LAYERS } from "./memoryStore.ts";

/** core 不由提取产出。 */
const VALID_DEPTHS_EXTRACT = ["surface", "personal", "vulnerable"];

export interface Fact {
  layer: string;
  kind: string;
  depth: string;
  content: any;
  surface_text: any;
  confidence: number;
  evidence: any;
  entities: any[];
  emotion: any;
  due_at: string | null;
  has_time: boolean;
}

const replaceAll = (text: string, from: string, to: string) => text.split(from).join(to);
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDay = (p: { year: number; month: number; day: number }) => String(p.year).padStart(4, "0") + "-" + pad2(p.month) + "-" + pad2(p.day);

/** 按「现在」生成示例，日期随调用时刻变化，不写死。 */
export function buildFewShot(now: Date): string {
  const today = cstParts(now);
  const tomorrow = cstParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  let out = EXTRACTOR_FEW_SHOT_TEMPLATE;
  out = replaceAll(out, "{现在}", nowContextText(now));
  out = replaceAll(out, "{今天中文}", today.month + "月" + today.day + "日");
  out = replaceAll(out, "{明天中文}", tomorrow.month + "月" + tomorrow.day + "日");
  out = replaceAll(out, "{今天}", isoDay(today));
  out = replaceAll(out, "{明天}", isoDay(tomorrow));
  return out;
}

export function buildExtractorMessages(dumpText: string, profileContext: string | null | undefined, now: Date, todoOnly: boolean): ChatMessage[] {
  if (todoOnly) {
    return [
      { role: "system", content: CHAT_TODO_PROMPT + "\n" + nowContextText(now) },
      { role: "user", content: dumpText },
    ];
  }
  return [
    { role: "system", content: EXTRACTOR_SYSTEM_PROMPT + "\n" + buildFewShot(now) },
    {
      role: "user",
      content:
        nowContextText(now) + "。原文里的相对时间都以此为准换算成具体日期。\n\n" +
        "原始倾诉：\n" + dumpText + "\n\n" +
        "下面的既有理解只用于帮助消歧和沿用用户自己的称呼，不可覆盖原文、" +
        "不可据此新增事实；冲突时以本次原文为准：\n" +
        (profileContext || "（无）"),
    },
  ];
}

/** due_at 只接受非空字符串，其余一律当没有。 */
const normDueAt = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** 解析模型输出为结构化事实列表，丢弃越界条目。 */
export function parseExtractorOutput(raw: string): { facts: Fact[]; error: string } {
  if (!raw) return { facts: [], error: "empty LLM output" };
  // 提取 JSON 数组（兼容 markdown code fence）
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.split("\n").filter((line) => !line.trim().startsWith("```")).join("\n");
  }
  let items: unknown;
  try {
    items = JSON.parse(text);
  } catch (e: any) {
    return { facts: [], error: "JSON parse error: " + e?.message };
  }
  if (!Array.isArray(items)) return { facts: [], error: "LLM output is not a JSON array" };

  const valid: Fact[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const it = item as Record<string, any>;
    const layer = it.layer ?? "";
    const kind = it.kind ?? "";
    const depth = it.depth ?? "";
    // 越界检查：core 不允许，枚举必须合法
    if (!VALID_DEPTHS_EXTRACT.includes(depth)) continue;
    if (!VALID_LAYERS.includes(layer)) continue;
    if (!VALID_KINDS.includes(kind)) continue;
    // Python 里 bool 也是 int：True 当 1、False 当 0，这里保持一致
    let confidence: number = typeof it.confidence === "boolean" ? Number(it.confidence) : it.confidence;
    if (typeof confidence !== "number" || Number.isNaN(confidence)) confidence = 0.8;
    confidence = Math.max(0, Math.min(1, confidence));
    valid.push({
      layer, kind, depth,
      content: it.content ?? "",
      surface_text: it.surface_text ?? "",
      confidence,
      evidence: it.evidence ?? "",
      entities: it.entities || [],
      emotion: it.emotion ?? null,
      due_at: normDueAt(it.due_at),
      has_time: it.has_time !== false,
    });
  }
  return { facts: valid, error: "" };
}

/** 运行提取，返回结构化事实列表。失败返回空列表。 */
export async function runExtractor(
  model: ModelClient, dumpText: string,
  opts: { profileContext?: string | null; now: Date; todoOnly?: boolean },
): Promise<Fact[]> {
  const todoOnly = opts.todoOnly ?? false;
  const messages = buildExtractorMessages(dumpText, opts.profileContext, opts.now, todoOnly);
  let output = "";
  try {
    // 聊天待办：短超时、不重试、低思考量（不能拖慢聊天）；倾倒：默认
    output = await model.complete(messages, todoOnly
      ? { temperature: 0.1, timeoutMs: 8000, maxRetries: 0, reasoningEffort: "low" }
      : { temperature: 0.1 });
  } catch {
    return [];
  }
  return parseExtractorOutput(output).facts;
}
