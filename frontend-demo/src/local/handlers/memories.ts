/**
 * 记忆系统 REST、记忆审阅、三日寄存、长久珍藏：
 *   backend/app/routers/memory/{memory,memory_review}.py、routers/mailbox/{ephemeral,treasures}.py 的移植。
 * 产品口径：不做诊断、不把推测当事实——只如实返回记忆字段，不输出人格标签/冰山层名。
 */
import { nowIso } from "../db.ts";
import { LocalHttpError, idParam, intQuery, optionalIntQuery, type LocalContext, type LocalRouter } from "../http.ts";
import {
  VALID_DEPTHS, VALID_KINDS, VALID_LAYERS, clearAll, createMemory, expireEphemeral, forgetMemory, getMemory,
  listAllLatest, listByDepth, listByKind, listByLayer, listByRoot, rowToItem, updateMemory, type MemoryItem, type MemoryPatch,
} from "../memoryStore.ts";

function memoryOut(item: MemoryItem) {
  return {
    id: item.id, user_id: item.user_id, layer: item.layer, kind: item.kind, depth: item.depth,
    content: item.content, surface_text: item.surface_text, confidence: item.confidence, version: item.version,
    root_id: item.root_id, is_latest: item.is_latest, is_forgotten: item.is_forgotten,
    visibility_gate: item.visibility_gate, privacy: item.privacy, entities: item.entities, emotion: item.emotion,
    provenance: item.provenance, created_at: item.created_at, updated_at: item.updated_at,
  };
}

/** 取本人记忆或 404（隔离跨用户访问）。 */
async function ownOr404(ctx: LocalContext, id: number): Promise<MemoryItem> {
  const item = await getMemory(ctx.db, id);
  if (!item || item.user_id !== ctx.userId || item.is_forgotten) throw new LocalHttpError(404, "Memory not found");
  return item;
}

const oneOf = (value: unknown, allowed: string[], name: string): string => {
  if (typeof value !== "string" || !allowed.includes(value)) throw new LocalHttpError(422, name + " 不是有效的取值");
  return value;
};

// 审阅面：depth → 面向用户的敏感度软标签（不出现 depth 原名，更不见冰山术语）
const SENSITIVITY_LABELS: Record<string, string> = { surface: "日常", personal: "个人", vulnerable: "较私密", core: "很私密" };
const REVIEW_LAYERS = ["profile", "state"];

export function registerMemories(router: LocalRouter): void {
  router.add("POST", "/api/v1/memories", async (ctx, req) => {
    const b = req.body ?? {};
    if (typeof b.content !== "string") throw new LocalHttpError(422, "content 不能为空");
    const item = await createMemory(ctx.db, {
      userId: ctx.userId,
      layer: oneOf(b.layer, VALID_LAYERS, "layer"), kind: oneOf(b.kind, VALID_KINDS, "kind"), depth: oneOf(b.depth, VALID_DEPTHS, "depth"),
      content: b.content, surfaceText: typeof b.surface_text === "string" ? b.surface_text : "",
      confidence: typeof b.confidence === "number" ? b.confidence : 1.0,
      entities: Array.isArray(b.entities) ? b.entities : null, emotion: b.emotion ?? null, provenance: Array.isArray(b.provenance) ? b.provenance : null,
      rawRef: typeof b.raw_ref === "string" ? b.raw_ref : null, actor: "user", now: ctx.now(),
    });
    return memoryOut(item);
  });

  router.add("GET", "/api/v1/memories", async (ctx, req) => {
    const { layer, kind, depth } = req.query;
    const items = layer ? await listByLayer(ctx.db, ctx.userId, layer)
      : kind ? await listByKind(ctx.db, ctx.userId, kind)
      : depth ? await listByDepth(ctx.db, ctx.userId, depth)
      : await listAllLatest(ctx.db, ctx.userId);
    return items.map(memoryOut);
  });

  // 清空本人全部记忆（走遗忘，保留 history）
  router.add("DELETE", "/api/v1/memories", async (ctx) => ({ cleared: await clearAll(ctx.db, ctx.userId, ctx.now(), "user") }));

  router.add("GET", "/api/v1/memories/{memory_id}", async (ctx, req) => memoryOut(await ownOr404(ctx, idParam(req, "memory_id"))));

  router.add("PATCH", "/api/v1/memories/{memory_id}", async (ctx, req) => {
    const item = await ownOr404(ctx, idParam(req, "memory_id"));
    const b = req.body ?? {};
    const patch: MemoryPatch = {};
    if (b.content != null) { if (typeof b.content !== "string") throw new LocalHttpError(422, "content 须是文字"); patch.content = b.content; }
    if (b.surface_text != null) { if (typeof b.surface_text !== "string") throw new LocalHttpError(422, "surface_text 须是文字"); patch.surface_text = b.surface_text; }
    if (b.confidence != null) { if (typeof b.confidence !== "number") throw new LocalHttpError(422, "confidence 须是数字"); patch.confidence = b.confidence; }
    if (b.entities != null) { if (!Array.isArray(b.entities)) throw new LocalHttpError(422, "entities 须是列表"); patch.entities = b.entities; }
    if (b.emotion != null) patch.emotion = b.emotion;
    if (!Object.keys(patch).length) throw new LocalHttpError(400, "No fields to update");
    try {
      return memoryOut(await updateMemory(ctx.db, item.id, patch, ctx.now(), "user"));
    } catch (error: any) {
      throw new LocalHttpError(404, String(error?.message ?? "Memory not found")); // 旧版本不能再改（与后端一致）
    }
  });

  router.add("DELETE", "/api/v1/memories/{memory_id}", async (ctx, req) => {
    const item = await ownOr404(ctx, idParam(req, "memory_id"));
    await forgetMemory(ctx.db, item.id, ctx.now(), { reason: "user_delete", event: "DELETE", actor: "user" });
    return null;
  });

  // 一条记忆的完整版本链
  router.add("GET", "/api/v1/memories/{memory_id}/versions", async (ctx, req) => {
    const item = await ownOr404(ctx, idParam(req, "memory_id"));
    return (await listByRoot(ctx.db, item.root_id || item.id)).map(memoryOut);
  });

  // ── 记忆审阅「我的·记忆」──
  router.add("GET", "/api/v1/memory-review", async (ctx, req) => {
    const items: MemoryItem[] = [];
    for (const layer of REVIEW_LAYERS) items.push(...(await listByLayer(ctx.db, ctx.userId, layer)));
    let reviews = items.map((i) => ({
      id: i.id, kind: i.kind, surface_text: i.surface_text || i.content,
      sensitivity: SENSITIVITY_LABELS[i.depth] ?? "个人", provenance: i.provenance, updated_at: i.updated_at,
    }));
    if (req.query.sensitivity) reviews = reviews.filter((r) => r.sensitivity === req.query.sensitivity);
    if (req.query.kind) reviews = reviews.filter((r) => r.kind === req.query.kind);
    return reviews.sort((a, b) => b.id - a.id);
  });

  // ── 三日寄存 ──
  router.add("GET", "/api/v1/ephemeral", async (ctx, req) => {
    const limit = intQuery(req, "limit", 50, 1, 200);
    await expireEphemeral(ctx.db, ctx.now()); // 到期真删
    const rows = await ctx.db.all(
      "SELECT * FROM memory_items WHERE user_id = ? AND expires_at IS NOT NULL AND is_forgotten = 0 AND is_latest = 1 ORDER BY expires_at ASC LIMIT ?",
      [ctx.userId, limit],
    );
    return rows.map(rowToItem).map((i) => ({
      id: i.id, kind: i.kind, content: i.content, surface_text: i.surface_text, expires_at: i.expires_at, created_at: i.created_at || "",
    }));
  });

  // 主动留下：清除过期时间（转为长久保存）+ 生成一条珍藏
  router.add("POST", "/api/v1/ephemeral/{memory_id}/keep", async (ctx, req) => {
    const item = await ownOr404Ephemeral(ctx, idParam(req, "memory_id"));
    const treasure = await ctx.db.transaction(async (tx) => {
      await tx.run("UPDATE memory_items SET expires_at = NULL, updated_at = ? WHERE id = ?", [nowIso(ctx.now()), item.id]);
      const r = await tx.run(
        "INSERT INTO treasures (user_id, source_type, source_id, title, content, created_at) VALUES (?, 'ephemeral', ?, ?, ?, ?)",
        [ctx.userId, item.id, "留下的" + item.kind, item.surface_text || item.content, nowIso(ctx.now())],
      );
      return r.lastInsertRowId;
    });
    return { kept_memory_id: item.id, treasure_id: treasure, message: "已转入长久珍藏" };
  });

  router.add("DELETE", "/api/v1/ephemeral/{memory_id}", async (ctx, req) => {
    const item = await ownOr404Ephemeral(ctx, idParam(req, "memory_id"));
    await forgetMemory(ctx.db, item.id, ctx.now(), { reason: "user_deleted_ephemeral", event: "DELETE", actor: "user" });
    return null;
  });

  // ── 长久珍藏 ──
  const SOURCE_TYPES = ["summary", "idea", "memory", "ephemeral", "conversation", "scene", "letter"];
  const MEMORY_BACKED = ["memory", "ephemeral", "summary", "idea"];
  const requireTreasure = async (ctx: LocalContext, id: number) => {
    const t = await ctx.db.get("SELECT * FROM treasures WHERE id = ? AND user_id = ?", [id, ctx.userId]);
    if (!t) throw new LocalHttpError(404, "珍藏不存在");
    return t;
  };

  router.add("GET", "/api/v1/treasures", async (ctx, req) => {
    const limit = intQuery(req, "limit", 50, 1, 100);
    const cursor = optionalIntQuery(req, "cursor");
    return await ctx.db.all(
      "SELECT * FROM treasures WHERE user_id = ?" + (cursor != null ? " AND id < ?" : "") + " ORDER BY id DESC LIMIT ?",
      cursor != null ? [ctx.userId, cursor, limit] : [ctx.userId, limit],
    );
  });

  router.add("POST", "/api/v1/treasures", async (ctx, req) => {
    const b = req.body ?? {};
    if (!SOURCE_TYPES.includes(b.source_type)) throw new LocalHttpError(422, "未知珍藏来源: " + b.source_type);
    let title: string | undefined = b.title ?? undefined;
    let content: string | undefined = b.content ?? undefined;
    const sourceId: number | null = Number.isInteger(b.source_id) ? b.source_id : null;
    // 记忆类来源可缺省取快照（校验归属）；conversation/scene 需显式给 title/content
    if (MEMORY_BACKED.includes(b.source_type) && sourceId !== null && (title === undefined || content === undefined)) {
      const mem = await getMemory(ctx.db, sourceId);
      if (!mem || mem.user_id !== ctx.userId || mem.is_forgotten) throw new LocalHttpError(404, "来源记忆不存在");
      title = title || "留下的" + mem.kind;
      content = content || mem.surface_text || mem.content;
    }
    if (!title || !content) throw new LocalHttpError(422, "title 与 content 必填（或提供可快照的 source_id）");
    const r = await ctx.db.run(
      "INSERT INTO treasures (user_id, source_type, source_id, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [ctx.userId, b.source_type, sourceId, title, content, nowIso(ctx.now())],
    );
    return await requireTreasure(ctx, r.lastInsertRowId);
  });

  router.add("GET", "/api/v1/treasures/{treasure_id}", async (ctx, req) => requireTreasure(ctx, idParam(req, "treasure_id")));

  router.add("DELETE", "/api/v1/treasures/{treasure_id}", async (ctx, req) => {
    const t = await requireTreasure(ctx, idParam(req, "treasure_id"));
    await ctx.db.run("DELETE FROM treasures WHERE id = ?", [t.id]);
    return null;
  });
}

async function ownOr404Ephemeral(ctx: LocalContext, id: number): Promise<MemoryItem> {
  const item = await getMemory(ctx.db, id);
  if (!item || item.user_id !== ctx.userId || item.is_forgotten) throw new LocalHttpError(404, "寄存内容不存在");
  return item;
}
