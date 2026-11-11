/**
 * 记忆存储：backend/app/services/memory/memory_store.py 的移植。
 * 所有记忆读写的唯一入口，封装版本链与历史落库，保证：
 * - 任何写操作必伴随一条 memory_history（Property 4）
 * - UPDATE 走版本链（Property 5）
 *
 * 每个函数拿一个 Db（可以是事务里的 tx），自己负责把多条语句放进同一个事务。
 */
import { nowIso, parseJson, toJson, type Db, type SqlValue } from "./db.ts";

export type Layer = "episodic" | "profile" | "state";
export type Kind = "待办" | "小结" | "灵感" | "情绪" | "片段";
export type Depth = "surface" | "personal" | "vulnerable" | "core";

export const VALID_LAYERS = ["episodic", "profile", "state"];
export const VALID_KINDS = ["待办", "小结", "灵感", "情绪", "片段"];
export const VALID_DEPTHS = ["surface", "personal", "vulnerable", "core"];

/** 深度 → 默认门控与隐私（创建时落库）。vulnerable/core 默认 local，不进外发路径。 */
export const DEPTH_DEFAULTS: Record<string, { visibility_gate: number; privacy: string }> = {
  surface: { visibility_gate: 0.0, privacy: "cloud" },
  personal: { visibility_gate: 0.3, privacy: "local" },
  vulnerable: { visibility_gate: 0.6, privacy: "local" },
  core: { visibility_gate: 0.85, privacy: "local" },
};

export interface MemoryItem {
  id: number;
  user_id: number;
  layer: string;
  kind: string;
  depth: string;
  content: string;
  surface_text: string;
  confidence: number;
  status: string | null;
  due_date: string | null;
  version: number;
  parent_id: number | null;
  root_id: number | null;
  is_latest: boolean;
  is_forgotten: boolean;
  forget_reason: string | null;
  expires_at: string | null;
  relation_type: string | null;
  relation_to_id: number | null;
  entities: any[] | null;
  emotion: Record<string, any> | null;
  provenance: any[] | null;
  visibility_gate: number;
  privacy: string;
  raw_ref: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToItem(row: any): MemoryItem {
  return {
    ...row,
    is_latest: !!row.is_latest,
    is_forgotten: !!row.is_forgotten,
    entities: parseJson(row.entities, null),
    emotion: parseJson(row.emotion, null),
    provenance: parseJson(row.provenance, null),
  };
}

export interface CreateMemory {
  userId: number;
  layer: string;
  kind: string;
  depth: string;
  content: string;
  surfaceText?: string;
  confidence?: number;
  entities?: any[] | null;
  emotion?: Record<string, any> | null;
  provenance?: any[] | null;
  rawRef?: string | null;
  expiresAt?: Date | null;
  status?: string | null;
  dueDate?: Date | null;
  relationType?: string | null;
  relationToId?: number | null;
  actor?: string;
  historyMeta?: Record<string, any> | null;
  now: Date;
}

export async function writeHistory(
  db: Db, memoryId: number, event: string, now: Date,
  opts: { actor?: string; oldContent?: string | null; newContent?: string | null; meta?: Record<string, any> | null } = {},
): Promise<void> {
  await db.run(
    "INSERT INTO memory_history (memory_id, event, actor, old_content, new_content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [memoryId, event, opts.actor ?? "system", opts.oldContent ?? null, opts.newContent ?? null, toJson(opts.meta ?? null), nowIso(now)],
  );
}

export async function getMemory(db: Db, id: number): Promise<MemoryItem | null> {
  const row = await db.get("SELECT * FROM memory_items WHERE id = ?", [id]);
  return row ? rowToItem(row) : null;
}

/** 创建一条记忆，同步写 ADD 历史。自动按 depth 填充默认门控/隐私。 */
export async function createMemory(db: Db, c: CreateMemory): Promise<MemoryItem> {
  const defaults = DEPTH_DEFAULTS[c.depth];
  if (!defaults) throw new Error("'" + c.depth + "' 不是有效的 depth");
  const now = nowIso(c.now);
  return await db.transaction(async (tx) => {
    const r = await tx.run(
      "INSERT INTO memory_items (user_id, layer, kind, depth, content, surface_text, confidence, status, due_date, version, " +
        "is_latest, is_forgotten, expires_at, relation_type, relation_to_id, entities, emotion, provenance, visibility_gate, privacy, raw_ref, " +
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        c.userId, c.layer, c.kind, c.depth, c.content, c.surfaceText || c.content, c.confidence ?? 1.0,
        c.status ?? null, c.dueDate ? nowIso(c.dueDate) : null,
        c.expiresAt ? nowIso(c.expiresAt) : null, c.relationType ?? null, c.relationToId ?? null,
        toJson(c.entities ?? null), toJson(c.emotion ?? null), toJson(c.provenance ?? null),
        defaults.visibility_gate, defaults.privacy, c.rawRef ?? null, now, now,
      ],
    );
    const id = r.lastInsertRowId;
    await tx.run("UPDATE memory_items SET root_id = ? WHERE id = ?", [id, id]); // root_id 指向自身
    await writeHistory(tx, id, "ADD", c.now, { actor: c.actor, newContent: c.content, meta: c.historyMeta });
    return (await getMemory(tx, id))!;
  });
}

/** 可以走版本链更新的字段。值为 undefined 表示沿用旧值；null 是有意义的值（清空）。 */
export interface MemoryPatch {
  layer?: string;
  kind?: string;
  depth?: string;
  content?: string;
  surface_text?: string;
  confidence?: number;
  status?: string | null;
  due_date?: string | null;
  entities?: any[] | null;
  emotion?: Record<string, any> | null;
  provenance?: any[] | null;
  expires_at?: string | null;
  relation_type?: string | null;
  relation_to_id?: number | null;
  visibility_gate?: number;
  privacy?: string;
}

/** 更新一条记忆：旧版本 is_latest=false，创建 version+1 新版本。 */
export async function updateMemory(
  db: Db, id: number, patch: MemoryPatch, now: Date, actor = "system",
): Promise<MemoryItem> {
  return await db.transaction(async (tx) => {
    const old = await getMemory(tx, id);
    if (!old) throw new Error("MemoryItem " + id + " not found");
    if (!old.is_latest) throw new Error("MemoryItem " + id + " is not the latest version");
    const pick = <K extends keyof MemoryPatch>(key: K, fallback: any) => (key in patch && patch[key] !== undefined ? patch[key] : fallback);
    const stamp = nowIso(now);
    await tx.run("UPDATE memory_items SET is_latest = 0 WHERE id = ?", [old.id]);
    const content = pick("content", old.content) as string;
    const values: SqlValue[] = [
      old.user_id, pick("layer", old.layer), pick("kind", old.kind), pick("depth", old.depth), content,
      pick("surface_text", old.surface_text), pick("confidence", old.confidence), pick("status", old.status),
      pick("due_date", old.due_date), old.version + 1, old.id, old.root_id,
      pick("expires_at", old.expires_at), pick("relation_type", old.relation_type), pick("relation_to_id", old.relation_to_id),
      toJson(pick("entities", old.entities)), toJson(pick("emotion", old.emotion)), toJson(pick("provenance", old.provenance)),
      pick("visibility_gate", old.visibility_gate), pick("privacy", old.privacy), old.raw_ref, stamp, stamp,
    ] as SqlValue[];
    const r = await tx.run(
      "INSERT INTO memory_items (user_id, layer, kind, depth, content, surface_text, confidence, status, due_date, version, " +
        "parent_id, root_id, is_latest, is_forgotten, expires_at, relation_type, relation_to_id, entities, emotion, provenance, " +
        "visibility_gate, privacy, raw_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      // 注意占位顺序：…version, parent_id, root_id, [is_latest, is_forgotten 固定值], expires_at …
      values,
    );
    await writeHistory(tx, r.lastInsertRowId, "UPDATE", now, {
      actor, oldContent: old.content, newContent: content, meta: { parent_id: old.id, version: old.version + 1 },
    });
    return (await getMemory(tx, r.lastInsertRowId))!;
  });
}

/**
 * 原地更新状态标记（如倾倒处理进度 processing→done）。
 * 内容未变，id 必须保持稳定（dump_id 即 root id），故不走版本链，但仍写一条 UPDATE 历史。
 */
export async function setStatus(db: Db, id: number, status: string, now: Date, actor = "system"): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getMemory(tx, id);
    if (!item) throw new Error("MemoryItem " + id + " not found");
    await tx.run("UPDATE memory_items SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(now), id]);
    await writeHistory(tx, id, "UPDATE", now, { actor, meta: { field: "status", old: item.status, new: status } });
  });
}

/** 置 is_forgotten 并写历史。用户删除复用此路径（event=DELETE）。 */
export async function forgetMemory(
  db: Db, id: number, now: Date, opts: { reason?: string; event?: string; actor?: string } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getMemory(tx, id);
    if (!item) throw new Error("MemoryItem " + id + " not found");
    await tx.run(
      "UPDATE memory_items SET is_forgotten = 1, forget_reason = ?, is_latest = 0, updated_at = ? WHERE id = ?",
      [opts.reason ?? "", nowIso(now), id],
    );
    await writeHistory(tx, id, opts.event ?? "FORGET", now, {
      actor: opts.actor, oldContent: item.content, meta: { reason: opts.reason ?? "" },
    });
  });
}

async function listWhere(db: Db, userId: number, column: string, value: string, latest: boolean): Promise<MemoryItem[]> {
  const rows = await db.all(
    "SELECT * FROM memory_items WHERE user_id = ? AND " + column + " = ? AND is_forgotten = 0" + (latest ? " AND is_latest = 1" : "") + " ORDER BY id ASC",
    [userId, value],
  );
  return rows.map(rowToItem);
}

/** 用户某 layer 的未遗忘记忆；latest=true 只取最新版。 */
export const listByLayer = (db: Db, userId: number, layer: string, latest = true) => listWhere(db, userId, "layer", layer, latest);
/** 用户某 kind（待办/小结/片段…）的未遗忘记忆。 */
export const listByKind = (db: Db, userId: number, kind: string, latest = true) => listWhere(db, userId, "kind", kind, latest);
/** 用户某 depth 的未遗忘记忆。 */
export const listByDepth = (db: Db, userId: number, depth: string, latest = true) => listWhere(db, userId, "depth", depth, latest);

/** 一条记忆的完整版本链。 */
export async function listByRoot(db: Db, rootId: number): Promise<MemoryItem[]> {
  return (await db.all("SELECT * FROM memory_items WHERE root_id = ? ORDER BY version", [rootId])).map(rowToItem);
}

/** 用户全部最新、未遗忘的记忆（供记忆审阅/清空使用），新的在前。 */
export async function listAllLatest(db: Db, userId: number): Promise<MemoryItem[]> {
  const rows = await db.all(
    "SELECT * FROM memory_items WHERE user_id = ? AND is_latest = 1 AND is_forgotten = 0 ORDER BY id DESC", [userId],
  );
  return rows.map(rowToItem);
}

/** 清空用户全部记忆（走 forget，保留 history）。返回清空条数。 */
export async function clearAll(db: Db, userId: number, now: Date, actor = "user"): Promise<number> {
  const items = await listAllLatest(db, userId);
  for (const item of items) await forgetMemory(db, item.id, now, { reason: "user_clear_all", event: "DELETE", actor });
  return items.length;
}

/**
 * 原始倾诉即焚：清空 raw_ref，仅保留整理后的 surface_text。
 * raw_ref 属原文快照、非版本链内容，原地清空并写一条 UPDATE 历史。
 */
export async function burnRawRef(db: Db, id: number, now: Date, actor = "system"): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const item = await getMemory(tx, id);
    if (!item || !item.raw_ref) return false;
    await tx.run("UPDATE memory_items SET raw_ref = NULL, updated_at = ? WHERE id = ?", [nowIso(now), id]);
    await writeHistory(tx, id, "UPDATE", now, { actor, meta: { field: "raw_ref", action: "burn", old_len: item.raw_ref.length } });
    return true;
  });
}

/**
 * 物理删除一条记忆及其历史（隐私红线：到期真删，不留任何痕迹）。
 * 先断开所有指向本条的引用（其它记忆的 parent/root/relation 及自身自引用），否则外键会拦截。
 */
export async function hardDeleteMemory(db: Db, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("UPDATE memory_items SET parent_id = NULL WHERE parent_id = ?", [id]);
    await tx.run("UPDATE memory_items SET root_id = NULL WHERE root_id = ?", [id]);
    await tx.run("UPDATE memory_items SET relation_to_id = NULL WHERE relation_to_id = ?", [id]);
    await tx.run("DELETE FROM memory_history WHERE memory_id = ?", [id]);
    await tx.run("DELETE FROM memory_items WHERE id = ?", [id]);
  });
}

/** 扫描过期的寄存内容，到期真删。幂等安全。返回删除条数。 */
export async function expireEphemeral(db: Db, now: Date): Promise<number> {
  const rows = await db.all<{ id: number }>(
    "SELECT id FROM memory_items WHERE expires_at IS NOT NULL AND expires_at <= ?", [nowIso(now)],
  );
  for (const r of rows) await hardDeleteMemory(db, r.id);
  return rows.length;
}
