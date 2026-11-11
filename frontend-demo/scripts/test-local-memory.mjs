// 本地记忆与待办：和后端逐行为对齐（黄金数据来自真实后端），并覆盖接口、版本链、隐私、聊天记待办。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { captureChatTodos } from "../src/local/chatTodos.ts";
import { cnDate, cnDateWeekday, hasSpecificTime, nowContextText, parseDueAt } from "../src/local/clock.ts";
import { migrate, toJson } from "../src/local/db.ts";
import { buildExtractorMessages, buildFewShot, parseExtractorOutput } from "../src/local/extractor.ts";
import { createModelClient } from "../src/local/llm.ts";
import { buildMemoryContext, selectUserRaisedSensitive } from "../src/local/memoryContext.ts";
import { createMemory, rowToItem } from "../src/local/memoryStore.ts";
import { MIGRATIONS } from "../src/local/schema.ts";
import { fakeFetch, makeRuntime, nodeSqliteDb, rejects } from "./local-test-kit.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/memory-golden.json", import.meta.url), "utf8"));
const NOW = new Date(golden.now_utc);
const status = (code) => (e) => assert.equal(e.status, code, e.status + "≠" + code + "：" + e.message);
const iso0 = (d) => (d ? d.toISOString().replace(/\.\d{3}Z$/, ".000Z") : null);
const ROW_KEYS = [
  "id", "layer", "kind", "depth", "content", "surface_text", "confidence", "status", "due_date", "version", "parent_id", "root_id",
  "is_latest", "is_forgotten", "forget_reason", "expires_at", "relation_type", "relation_to_id", "entities", "emotion", "provenance",
  "visibility_gate", "privacy", "raw_ref", "created_at", "updated_at",
];
const rowsOf = async (db) =>
  (await db.all("SELECT * FROM memory_items WHERE user_id = 1 ORDER BY id")).map((r) => {
    const item = rowToItem(r);
    return Object.fromEntries(ROW_KEYS.map((k) => [k, item[k]]));
  });
const historyOf = async (db) =>
  (await db.all("SELECT * FROM memory_history ORDER BY id")).map((h) => ({
    memory_id: h.memory_id, event: h.event, actor: h.actor, old_content: h.old_content, new_content: h.new_content,
    meta: h.meta ? JSON.parse(h.meta) : null,
  }));

// ═══ 时间口径 ═══
for (const c of golden.temporal.parse_due_at) {
  assert.equal(iso0(parseDueAt(c.value, c.has_time)), c.out, "parseDueAt " + JSON.stringify(c));
}
assert.equal(nowContextText(NOW), golden.temporal.now_context_text);
assert.equal(nowContextText(new Date("2026-10-19T00:30:00Z")), golden.temporal.now_context_text_given);
for (const c of golden.temporal.cn_date) {
  const at = new Date(c.at);
  assert.equal(cnDate(at), c.out);
  assert.equal(cnDateWeekday(at), c.wd);
}
for (const c of golden.temporal.has_specific_time) assert.equal(hasSpecificTime(new Date(c.at)), c.out, c.at);

// ═══ 提取：提示词与输出解析 ═══
for (const c of golden.extractor.prompts) {
  const got = buildExtractorMessages(c.input.dump_text, c.input.profile_context, NOW, c.input.todo_only);
  assert.deepEqual(got, c.messages, "提取提示词与后端不一致：" + c.name);
}
assert.equal(buildFewShot(NOW), golden.extractor.few_shot);
for (const c of golden.extractor.parse) {
  const got = parseExtractorOutput(c.raw);
  assert.deepEqual(got.facts, c.out.facts, "解析结果不一致：" + c.name);
  // 错误文案只用于日志；后端对“空输出”的错误串是个空串（调用方只看 facts），不比较
  if (c.name !== "空输出") assert.equal(got.error === "", c.out.error === "", "错误标记不一致：" + c.name);
}

// ═══ 记忆上下文：真实数据库里的真实记忆 → 真实输出 ═══
{
  const db = nodeSqliteDb();
  await migrate(db, MIGRATIONS);
  const cols = ROW_KEYS.concat(["user_id", "raw_ref"]).filter((v, i, a) => a.indexOf(v) === i);
  for (const item of golden.context.items) {
    const row = { ...item, user_id: 1 };
    for (const k of ["entities", "emotion", "provenance"]) row[k] = toJson(row[k]);
    for (const k of ["is_latest", "is_forgotten"]) row[k] = row[k] ? 1 : 0;
    await db.run("INSERT INTO memory_items (" + cols.join(", ") + ") VALUES (" + cols.map(() => "?").join(", ") + ")", cols.map((k) => row[k] ?? null));
  }
  for (const c of golden.context.cases) {
    const a = c.args;
    const got = await buildMemoryContext(db, 1, {
      mode: a.mode, query: a.query, userInitiated: a.user_initiated, userText: a.user_text, now: NOW,
    });
    assert.equal(got, c.out, "记忆上下文与后端不一致：" + c.name);
  }
  // 隐私红线（独立于黄金数据再断言一遍）
  const all = golden.context.cases.map((c) => c.out).join("\n");
  assert.ok(!all.includes("即焚内容"), "即焚记忆任何路径都不放");
  assert.ok(!all.includes("已遗忘"), "遗忘的不召回");
  const defaultPaths = golden.context.cases.filter((c) => !c.args.user_initiated).map((c) => c.out).join("\n");
  assert.ok(!defaultPaths.includes("担心自己不够格") && !defaultPaths.includes("想被认可") && !defaultPaths.includes("妈妈"), "米露主动路径不放脆弱记忆");
  assert.deepEqual(selectUserRaisedSensitive([], "任何话"), []);
  assert.deepEqual(selectUserRaisedSensitive(golden.context.items.map(rowToItem), ""), [], "没有当前消息就等于关闭");
}

// ═══ 倾倒编排：模型输出 → 事件流 + 记忆行 + 历史行 ═══
for (const c of golden.dump) {
  const { runtime, db, fetch } = await makeRuntime({ script: [{ content: c.llm_output }] });
  await db.run("INSERT INTO local_user (id, username, created_at) VALUES (1, 'local', ?)", [golden.now_utc]);
  await db.run(
    "INSERT INTO user_preferences (user_id, keep_raw_dump, ephemeral_ttl_days, proactive_schedule_times, created_at, updated_at) VALUES (1, ?, ?, '[\"08:00\"]', ?, ?)",
    [c.keep_raw ? 1 : 0, c.ttl_days, golden.now_utc, golden.now_utc],
  );
  await createMemory(db, {
    userId: 1, layer: "profile", kind: "片段", depth: "surface", content: "喜欢拿铁", surfaceText: "你喜欢拿铁",
    now: new Date("2026-11-03T00:00:00Z"),
  });
  const events = [];
  await runtime.stream("/api/v1/brain-dumps", { text: c.text, audio_ref: c.raw_ref }, (e) => events.push(e));
  assert.deepEqual(events, c.events, "倾倒事件流与后端不一致：" + c.name);
  assert.deepEqual(await rowsOf(db), c.rows, "倾倒落库的记忆与后端不一致：" + c.name);
  assert.deepEqual(await historyOf(db), c.history, "倾倒的历史与后端不一致：" + c.name);
  if (c.messages) assert.deepEqual(fetch.calls[0].body.messages, c.messages, "倾倒的提取提示词与后端不一致：" + c.name);
}

// ═══ 聊天里记待办：回执 + 落库 ═══
for (const c of golden.chat_todo) {
  const db = nodeSqliteDb();
  await migrate(db, MIGRATIONS);
  const fetch = fakeFetch(c.model_called ? [{ content: c.raw ?? JSON.stringify(c.llm_output) }] : []);
  const model = createModelClient({ fetch, keys: () => ({ stepfun: "step-key-123456", deepseek: "" }), backoffMs: () => 0 });
  if (c.preexisting) {
    await createMemory(db, {
      userId: 1, layer: "episodic", kind: "待办", depth: "surface", content: "参加面试", status: "pending",
      dueDate: parseDueAt("2026-11-12T11:00:00+08:00", true), now: NOW,
    });
  }
  const labels = await captureChatTodos({ db, model, userId: 1, now: () => NOW }, c.message);
  assert.deepEqual(labels, c.labels, "聊天待办回执与后端不一致：" + c.name);
  assert.equal(fetch.calls.length, c.model_called ? 1 : 0, "该不该调模型：" + c.name);
  assert.deepEqual(await rowsOf(db), c.rows, "聊天待办落库与后端不一致：" + c.name);
  assert.deepEqual(await historyOf(db), c.history, "聊天待办历史与后端不一致：" + c.name);
  if (c.model_called) {
    const body = fetch.calls[0].body;
    assert.equal(body.temperature, 0.1);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.stream, false);
  }
}

console.log("PASS local memory: temporal, extractor, context, dump ingest, chat todos (golden)");
