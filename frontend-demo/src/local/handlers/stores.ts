/**
 * 五类存储的 REST 视图：backend/app/routers/memory/stores.py 的移植。
 * Todos / Summaries / Ideas / Emotions 不是独立表，而是记忆按 kind 的视图。
 * 均按本机用户隔离、只操作最新未遗忘条目、删除走 forget。
 */
import { hasSpecificTime, parseIsoDatetime, parseStoredTime } from "../clock.ts";
import { LocalHttpError, idParam, type LocalContext, type LocalRequest, type LocalRouter } from "../http.ts";
import { createMemory, forgetMemory, getMemory, listByKind, updateMemory, type MemoryItem, type MemoryPatch } from "../memoryStore.ts";

export function storeItemOut(item: MemoryItem) {
  return {
    id: item.id,
    kind: item.kind,
    layer: item.layer,
    depth: item.depth,
    content: item.content,
    surface_text: item.surface_text,
    status: item.status,
    due_date: item.due_date,
    entities: item.entities,
    emotion: item.emotion,
    provenance: item.provenance,
    created_at: item.created_at,
    updated_at: item.updated_at,
    // due_date 是否带具体时刻。约定：东八区本地恰为 00:00 视为「只有日期」。
    has_time: item.due_date !== null && hasSpecificTime(item.due_date),
  };
}

async function ownOfKindOr404(ctx: LocalContext, id: number, kind: string): Promise<MemoryItem> {
  const item = await getMemory(ctx.db, id);
  if (!item || item.user_id !== ctx.userId || item.is_forgotten || !item.is_latest || item.kind !== kind) {
    throw new LocalHttpError(404, "Not found");
  }
  return item;
}

/** 入库前统一成 UTC ISO。带时区的按其时区换算，不带时区的按 UTC；非法 422。 */
function dueToUtc(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new LocalHttpError(422, "due_date 须是日期时间");
  const parsed = parseIsoDatetime(value, false);
  if (!parsed) throw new LocalHttpError(422, "due_date 不是有效的日期时间");
  return parsed.toISOString();
}

function nonEmptyPatch(patch: MemoryPatch): MemoryPatch {
  if (!Object.keys(patch).length) throw new LocalHttpError(400, "No fields to update");
  return patch;
}

/** 请求体里 null 视为没传（与后端 exclude_none 一致）；文本字段必须是字符串。 */
function pickText(body: any, key: "content" | "surface_text" | "status"): string | undefined {
  const v = body?.[key];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string") throw new LocalHttpError(422, key + " 须是文字");
  return v;
}

function viewRoutes(
  router: LocalRouter, base: string, kind: string,
  opts: { create?: (ctx: LocalContext, req: LocalRequest) => Promise<MemoryItem>; patch?: (req: LocalRequest) => MemoryPatch },
) {
  router.add("GET", base + "/{item_id}", async (ctx, req) => storeItemOut(await ownOfKindOr404(ctx, idParam(req, "item_id"), kind)));
  router.add("DELETE", base + "/{item_id}", async (ctx, req) => {
    const item = await ownOfKindOr404(ctx, idParam(req, "item_id"), kind);
    await forgetMemory(ctx.db, item.id, ctx.now(), { reason: "user_delete", event: "DELETE", actor: "user" });
    return null;
  });
  if (opts.create) {
    router.add("POST", base, async (ctx, req) => storeItemOut(await opts.create!(ctx, req)));
  }
  if (opts.patch) {
    router.add("PATCH", base + "/{item_id}", async (ctx, req) => {
      const item = await ownOfKindOr404(ctx, idParam(req, "item_id"), kind);
      const patch = nonEmptyPatch(opts.patch!(req));
      return storeItemOut(await updateMemory(ctx.db, item.id, patch, ctx.now(), "user"));
    });
  }
}

/** 后端 _is_today：按 UTC 日期比较（保持一致）。 */
function isToday(dueDate: string | null, now: Date): boolean {
  if (!dueDate) return false;
  return parseStoredTime(dueDate).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

export function registerStores(router: LocalRouter): void {
  // ── Todos（待办）──
  router.add("GET", "/api/v1/todos", async (ctx, req) => {
    const status = req.query.status;
    const due = req.query.due;
    const items = await listByKind(ctx.db, ctx.userId, "待办");
    return items
      .filter((it) => !status || (it.status || "pending") === status) // 未显式置状态的（如倾倒产出）视为 pending
      .filter((it) => due !== "today" || isToday(it.due_date, ctx.now()))
      .map(storeItemOut);
  });
  viewRoutes(router, "/api/v1/todos", "待办", {
    create: async (ctx, req) => {
      const content = req.body?.content;
      if (typeof content !== "string") throw new LocalHttpError(422, "content 不能为空");
      const surface = req.body?.surface_text;
      if (surface !== undefined && surface !== null && typeof surface !== "string") throw new LocalHttpError(422, "surface_text 须是文字");
      const due = dueToUtc(req.body?.due_date);
      return await createMemory(ctx.db, {
        userId: ctx.userId, layer: "episodic", kind: "待办", depth: "surface", content, surfaceText: surface ?? "",
        status: "pending", dueDate: due ? new Date(due) : null, actor: "user", now: ctx.now(),
      });
    },
    patch: (req) => {
      const patch: MemoryPatch = {};
      for (const key of ["content", "surface_text", "status"] as const) {
        const v = pickText(req.body, key);
        if (v !== undefined) patch[key] = v;
      }
      const due = dueToUtc(req.body?.due_date);
      if (due !== null) patch.due_date = due;
      return patch;
    },
  });

  // ── Summaries（小结 / 日卡）──
  router.add("GET", "/api/v1/summaries", async (ctx, req) => {
    const date = req.query.date;
    const items = await listByKind(ctx.db, ctx.userId, "小结");
    return items.filter((i) => !date || i.created_at.slice(0, 10) === date).map(storeItemOut);
  });
  const textPatch = (req: LocalRequest): MemoryPatch => {
    const patch: MemoryPatch = {};
    for (const key of ["content", "surface_text"] as const) {
      const v = pickText(req.body, key);
      if (v !== undefined) patch[key] = v;
    }
    return patch;
  };
  viewRoutes(router, "/api/v1/summaries", "小结", { patch: textPatch });

  // ── Ideas（灵感）──
  router.add("GET", "/api/v1/ideas", async (ctx) => (await listByKind(ctx.db, ctx.userId, "灵感")).map(storeItemOut));
  viewRoutes(router, "/api/v1/ideas", "灵感", {
    create: async (ctx, req) => {
      const content = req.body?.content;
      if (typeof content !== "string") throw new LocalHttpError(422, "content 不能为空");
      return await createMemory(ctx.db, {
        userId: ctx.userId, layer: "state", kind: "灵感", depth: "surface", content,
        surfaceText: typeof req.body?.surface_text === "string" ? req.body.surface_text : "", actor: "user", now: ctx.now(),
      });
    },
    patch: textPatch,
  });

  // ── Emotions（情绪）：只承接不强转，一般不编辑，可删除（隐私）──
  router.add("GET", "/api/v1/emotions", async (ctx) => (await listByKind(ctx.db, ctx.userId, "情绪")).map(storeItemOut));
  viewRoutes(router, "/api/v1/emotions", "情绪", {});
}

