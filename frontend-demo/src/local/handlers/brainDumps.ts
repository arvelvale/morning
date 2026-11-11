/**
 * 睡前倾倒：backend/app/routers/memory/brain_dumps.py 的移植。
 * POST /brain-dumps  → 流式回执（边分类边推 item.classified → receipt → done）
 * GET  /brain-dumps/{id} → 事后回取回执（status + 产出项引用）
 */
import { ingestDump, KIND_TO_OUTPUT, OUTPUT_KEYS } from "../dumpIngest.ts";
import { LocalHttpError, idParam, type LocalContext, type LocalEvent, type LocalRouter } from "../http.ts";
import { getMemory, rowToItem } from "../memoryStore.ts";

/** 决定这次倾倒的原始文本：显式 text 优先，其次从会话拼装用户发言。 */
async function assembleDumpText(ctx: LocalContext, body: any): Promise<string> {
  if (typeof body?.text === "string" && body.text.trim()) return body.text;
  const convId = body?.conversation_id;
  if (convId !== undefined && convId !== null) {
    const conv = await ctx.db.get("SELECT id FROM conversations WHERE id = ? AND user_id = ?", [convId, ctx.userId]);
    if (!conv) throw new LocalHttpError(404, "会话不存在");
    const rows = await ctx.db.all<{ content: string }>(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND role = 'user' ORDER BY id ASC", [convId],
    );
    const turns = rows.map((r) => r.content).filter((c) => c.trim());
    if (!turns.length) throw new LocalHttpError(422, "会话里没有可整理的发言");
    return turns.join("\n");
  }
  throw new LocalHttpError(422, "需要 text 或 conversation_id");
}

async function* streamDump(ctx: LocalContext, body: any): AsyncGenerator<LocalEvent> {
  const dumpText = await assembleDumpText(ctx, body);
  yield* ingestDump({ db: ctx.db, model: ctx.model, userId: ctx.userId, now: ctx.now }, dumpText, body?.audio_ref ?? null);
}

export function registerBrainDumps(router: LocalRouter): void {
  router.add("POST", "/api/v1/brain-dumps", (ctx, req) => streamDump(ctx, req.body), { streaming: true });

  router.add("GET", "/api/v1/brain-dumps/{dump_id}", async (ctx, req) => {
    const dumpId = idParam(req, "dump_id");
    const root = await getMemory(ctx.db, dumpId);
    if (!root || root.user_id !== ctx.userId) throw new LocalHttpError(404, "Dump not found");
    const rows = await ctx.db.all(
      "SELECT * FROM memory_items WHERE user_id = ? AND is_forgotten = 0 AND is_latest = 1 AND " +
        "EXISTS (SELECT 1 FROM json_each(memory_items.provenance) WHERE json_each.value = ?) ORDER BY id ASC",
      [root.user_id, dumpId],
    );
    const children = rows.map(rowToItem);
    const kindCounts: Record<string, number> = {};
    const outputs: Record<string, number[]> = Object.fromEntries(OUTPUT_KEYS.map((k) => [k, [] as number[]]));
    for (const c of children) {
      kindCounts[c.kind] = (kindCounts[c.kind] ?? 0) + 1;
      const key = KIND_TO_OUTPUT[c.kind];
      if (key) outputs[key].push(c.id);
    }
    return {
      dump_id: dumpId,
      status: root.status || "done", // 旧数据无标记，视为已完成
      total: children.length,
      kind_counts: kindCounts,
      outputs,
      items: children.map((c) => ({
        memory_id: c.id, layer: c.layer, kind: c.kind, depth: c.depth, content: c.content, surface_text: c.surface_text,
      })),
    };
  });
}
