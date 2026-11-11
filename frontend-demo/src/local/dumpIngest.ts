/**
 * 睡前倾倒编排：backend/app/services/memory/dump_ingest.py 的移植。
 * 流程：raw_ref 落库 → 调提取 → 逐条创建记忆 → 构建回执。
 * 失败兜底：提取失败仍保留 raw_ref，返回「已收到」回执（Property 1）。
 */
import { parseDueAt } from "./clock.ts";
import type { Db } from "./db.ts";
import { runExtractor, type Fact } from "./extractor.ts";
import type { LocalEvent } from "./http.ts";
import type { ModelClient } from "./llm.ts";
import { buildMemoryContext } from "./memoryContext.ts";
import { burnRawRef, createMemory, setStatus } from "./memoryStore.ts";

/** 入「寄存」并落 TTL 的 kind：情绪、未确认片段（候选）。待办/小结/灵感是可行动产出，进各自存储、不过期。 */
export const EPHEMERAL_KINDS = ["情绪", "片段"];
const DEFAULT_TTL_DAYS = 7;

/** kind → 产出引用键：片段即片场候选片段 */
export const KIND_TO_OUTPUT: Record<string, string> = {
  待办: "todos", 小结: "summary", 灵感: "ideas", 情绪: "emotions", 片段: "candidates",
};
export const OUTPUT_KEYS = ["todos", "summary", "ideas", "emotions", "candidates"];

async function prefs(db: Db, userId: number) {
  return await db.get<any>("SELECT keep_raw_dump, ephemeral_ttl_days FROM user_preferences WHERE user_id = ?", [userId]);
}

/** 用户「保留原始倾诉」开关；无偏好行时默认保留（不焚）。 */
async function shouldKeepRaw(db: Db, userId: number): Promise<boolean> {
  const pref = await prefs(db, userId);
  return pref ? !!pref.keep_raw_dump : true;
}

async function ttlDaysFor(db: Db, userId: number): Promise<number> {
  const pref = await prefs(db, userId);
  return pref ? pref.ephemeral_ttl_days : DEFAULT_TTL_DAYS;
}

function emptyOutputs(): Record<string, number[]> {
  return Object.fromEntries(OUTPUT_KEYS.map((k) => [k, [] as number[]]));
}

/** 解析 fact 的 due_at；任何异常都当没有截止时间（只丢截止时间，绝不丢这条记忆）。 */
function safeDueDate(fact: Fact): Date | null {
  try {
    return parseDueAt(fact.due_at, fact.has_time);
  } catch {
    return null;
  }
}

/** 抽取元信息，写进 ADD 历史：evidence=原话片段，due_at=模型原始截止串。 */
function historyMeta(fact: Fact, keepEvidence: boolean): Record<string, any> | null {
  const meta: Record<string, any> = {};
  if (keepEvidence && fact.evidence) meta.evidence = String(fact.evidence).slice(0, 500);
  if (fact.due_at) {
    meta.due_at = fact.due_at;
    meta.has_time = !!fact.has_time;
  }
  return Object.keys(meta).length ? meta : null;
}

export interface DumpDeps {
  db: Db;
  model: ModelClient;
  userId: number;
  now: () => Date;
}

/** 边处理边产出事件：item.classified（每分类成功一条）→ receipt → done。 */
export async function* ingestDump(deps: DumpDeps, dumpText: string, rawRef?: string | null): AsyncGenerator<LocalEvent> {
  const { db, model, userId } = deps;
  const now = deps.now();
  const ttlDays = await ttlDaysFor(db, userId);

  // 1. raw_ref 落库（创建一条 root 记忆作为倾倒原始记录）
  const rawItem = await createMemory(db, {
    userId, layer: "episodic", kind: "片段", depth: "surface",
    content: "[原始倾倒] " + [...dumpText].slice(0, 200).join("") + "...",
    surfaceText: "你昨晚的一段倾诉", confidence: 1.0,
    rawRef: rawRef || dumpText, status: "processing", actor: "dump_ingest", now,
  });
  const dumpId = rawItem.id;

  // 2. 提取（画像只用来帮助消歧）
  let facts: Fact[] = [];
  try {
    const profileContext = await buildMemoryContext(db, userId, { mode: "profile", now });
    facts = await runExtractor(model, dumpText, { profileContext, now });
  } catch {
    facts = [];
  }

  // 3. 提取失败 → 兜底回执（处理流程已结束，状态仍为 done）
  if (!facts.length) {
    await setStatus(db, dumpId, "done", now, "dump_ingest");
    yield {
      event: "receipt",
      data: { dump_id: dumpId, total: 0, kind_counts: {}, outputs: emptyOutputs(), fallback: true, error: "提取为空或失败，原始倾诉已安全保留", items: [] },
    };
    yield { event: "done", data: {} };
    return;
  }

  // 4. 逐条写入 + 流式推送
  const items: { kind: string; content: any; memory_id: number }[] = [];
  const kindCounts: Record<string, number> = {};
  const keepRaw = await shouldKeepRaw(db, userId); // 「原文即焚」时，逐字原话片段也不留
  for (const fact of facts) {
    // 情绪 / 未确认片段入寄存并落 TTL（按用户偏好天数，到期真删）
    const ttl = EPHEMERAL_KINDS.includes(fact.kind) ? new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000) : null;
    const mem = await createMemory(db, {
      userId, layer: fact.layer, kind: fact.kind, depth: fact.depth,
      content: fact.content, surfaceText: fact.surface_text ?? "", confidence: fact.confidence,
      entities: fact.entities, emotion: fact.emotion, provenance: [dumpId], rawRef: null,
      expiresAt: ttl, dueDate: safeDueDate(fact), actor: "extractor",
      historyMeta: historyMeta(fact, keepRaw), now,
    });
    items.push({ kind: fact.kind, content: fact.content, memory_id: mem.id });
    kindCounts[fact.kind] = (kindCounts[fact.kind] ?? 0) + 1;
    yield {
      event: "item.classified",
      data: {
        memory_id: mem.id, layer: fact.layer, kind: fact.kind, depth: fact.depth,
        content: fact.content, surface_text: fact.surface_text ?? "",
      },
    };
  }

  // 5. 回执（含产出项引用）
  const outputs = emptyOutputs();
  for (const item of items) {
    const key = KIND_TO_OUTPUT[item.kind];
    if (key) outputs[key].push(item.memory_id);
  }
  await setStatus(db, dumpId, "done", now, "dump_ingest");

  // 6. 原文即焚：提取成功、已有整理后 surface 可替代原话时，按用户开关抹掉逐字原文
  if (!(await shouldKeepRaw(db, userId))) await burnRawRef(db, dumpId, now, "dump_ingest");

  yield {
    event: "receipt",
    data: { dump_id: dumpId, total: items.length, kind_counts: kindCounts, outputs, fallback: false, error: "", items },
  };
  yield { event: "done", data: {} };
}
