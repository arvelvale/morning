// 本地记忆与待办接口：待办增删改、版本链、遗忘、审阅、寄存/珍藏、倾倒回取、聊天里记待办（端到端）。
import assert from "node:assert/strict";

import { makeRuntime, rejects } from "./local-test-kit.mjs";

const status = (code) => (e) => assert.equal(e.status, code, e.status + "≠" + code + "：" + e.message);
const NOW = new Date("2026-11-11T14:30:00+08:00");

const { runtime: api, db, fetch } = await makeRuntime({
  script: [
    // 聊天记待办：先一次提取，再一次聊天回复（流式）
    { content: JSON.stringify([{ layer: "episodic", kind: "待办", depth: "surface", content: "参加面试", surface_text: "参加面试", confidence: 0.95, evidence: "我明天上午11点有面试", entities: [], emotion: null, due_at: "2026-11-12T11:00:00+08:00", has_time: true }]) },
    { deltas: ["加油", "呀"] },
    // 非流式再来一次：提取 + 回复
    { content: "[]" },
    { content: "好的" },
    // 倾倒
    { content: JSON.stringify([
      { layer: "episodic", kind: "小结", depth: "surface", content: "今天过得不错", surface_text: "今天过得不错", confidence: 0.9, evidence: "今天过得不错", entities: [], emotion: null, due_at: null, has_time: false },
      { layer: "episodic", kind: "情绪", depth: "personal", content: "有点累", surface_text: "你有点累", confidence: 0.9, evidence: "有点累", entities: [], emotion: { label: "累", intensity: 0.5 }, due_at: null, has_time: false },
      { layer: "state", kind: "灵感", depth: "surface", content: "做个日记功能", surface_text: "做个日记功能", confidence: 0.9, evidence: "日记", entities: ["日记"], emotion: null, due_at: null, has_time: false },
    ]) },
  ],
});

// ── 待办：增 / 查 / 改 / 删 ──
let todo;
{
  assert.deepEqual(await api.request("GET", "/api/v1/todos"), []);
  todo = await api.request("POST", "/api/v1/todos", { content: "买牛奶", due_date: "2026-11-12T10:30:00+08:00" });
  assert.equal(todo.kind, "待办");
  assert.equal(todo.status, "pending");
  assert.equal(todo.due_date, "2026-11-12T02:30:00.000Z", "带时区的截止时间换算成 UTC");
  assert.equal(todo.has_time, true);
  const dateOnly = await api.request("POST", "/api/v1/todos", { content: "交作业", due_date: "2026-11-12T16:00:00Z" });
  assert.equal(dateOnly.has_time, false, "东八区 00:00 视为只有日期");
  const naive = await api.request("POST", "/api/v1/todos", { content: "无时区", due_date: "2026-11-13T08:00:00" });
  assert.equal(naive.due_date, "2026-11-13T08:00:00.000Z", "不带时区按 UTC（与后端一致）");
  const noDue = await api.request("POST", "/api/v1/todos", { content: "没有截止" });
  assert.equal(noDue.due_date, null);
  assert.equal(noDue.has_time, false);
  await rejects(api.request("POST", "/api/v1/todos", {}), status(422));
  await rejects(api.request("POST", "/api/v1/todos", { content: "x", due_date: "乱写" }), status(422));
  await rejects(api.request("POST", "/api/v1/todos", { content: "x", due_date: 12345 }), status(422));

  assert.equal((await api.request("GET", "/api/v1/todos")).length, 4);
  assert.equal((await api.request("GET", "/api/v1/todos/" + todo.id)).content, "买牛奶");

  // 改动走版本链：id 变了，旧版本不再出现在列表里
  const done = await api.request("PATCH", "/api/v1/todos/" + todo.id, { status: "done" });
  assert.notEqual(done.id, todo.id);
  assert.equal(done.status, "done");
  assert.equal(done.content, "买牛奶");
  await rejects(api.request("GET", "/api/v1/todos/" + todo.id), status(404));
  assert.deepEqual((await api.request("GET", "/api/v1/todos?status=done")).map((t) => t.id), [done.id]);
  assert.equal((await api.request("GET", "/api/v1/todos?status=pending")).length, 3);
  const versions = await api.request("GET", "/api/v1/memories/" + done.id + "/versions");
  assert.deepEqual(versions.map((v) => [v.version, v.is_latest]), [[1, false], [2, true]]);
  const history = await db.all("SELECT event FROM memory_history WHERE memory_id IN (?, ?) ORDER BY id", [todo.id, done.id]);
  assert.deepEqual(history.map((h) => h.event), ["ADD", "UPDATE"], "每次写入都留历史");

  await rejects(api.request("PATCH", "/api/v1/todos/" + done.id, {}), status(400));
  await rejects(api.request("PATCH", "/api/v1/todos/" + done.id, { content: 5 }), status(422));
  const moved = await api.request("PATCH", "/api/v1/todos/" + done.id, { due_date: "2026-11-20T01:00:00Z", content: "买两盒牛奶" });
  assert.equal(moved.content, "买两盒牛奶");
  assert.equal(moved.status, "done", "没改的字段沿用");
  assert.equal(moved.due_date, "2026-11-20T01:00:00.000Z");

  // 今日待启
  const today = await api.request("GET", "/api/v1/todos?due=today");
  assert.deepEqual(today, [], "今天（UTC 11-11）没有截止的");
  const t2 = await api.request("POST", "/api/v1/todos", { content: "今天的事", due_date: "2026-11-11T09:00:00Z" });
  assert.deepEqual((await api.request("GET", "/api/v1/todos?due=today")).map((t) => t.id), [t2.id]);

  // 删除是遗忘：不再出现，但历史还在
  assert.equal(await api.request("DELETE", "/api/v1/todos/" + t2.id), null);
  await rejects(api.request("GET", "/api/v1/todos/" + t2.id), status(404));
  await rejects(api.request("DELETE", "/api/v1/todos/" + t2.id), status(404));
  const del = await db.get("SELECT event, actor FROM memory_history WHERE memory_id = ? ORDER BY id DESC", [t2.id]);
  assert.deepEqual({ ...del }, { event: "DELETE", actor: "user" });
  assert.equal((await db.get("SELECT is_forgotten, forget_reason FROM memory_items WHERE id = ?", [t2.id])).forget_reason, "user_delete");
  await rejects(api.request("GET", "/api/v1/ideas/" + noDue.id), status(404), "别的 kind 的条目不能从这里读");
}

// ── 聊天里记待办（流式）：回执、todo.saved、待办落库 ──
{
  const conv = await api.request("POST", "/api/v1/conversations", { mode: "free_chat" });
  const events = [];
  await api.stream("/api/v1/conversations/" + conv.id + "/messages?stream=true", { text: "我明天上午11点有面试哈" }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.event), ["todo.saved", "token", "token", "token", "done"]);
  const full = events.at(-1).data.content;
  assert.equal(full, "已记到待办：参加面试（11月12日 11:00）。\n\n加油呀");
  assert.equal(events[1].data.delta, "已记到待办：参加面试（11月12日 11:00）。\n\n");
  const todos = await api.request("GET", "/api/v1/todos");
  const interview = todos.find((t) => t.content === "参加面试");
  assert.ok(interview, "聊天里说的安排确实进了待办列表");
  assert.equal(interview.due_date, "2026-11-12T03:00:00.000Z");
  // 提取请求与聊天请求是两次独立调用，聊天那次的系统提示要求别重复说“已记下”
  assert.match(fetch.calls[1].body.messages[0].content, /请别说已经帮对方记下/);

  // 非流式
  const r = await api.request("POST", "/api/v1/conversations/" + conv.id + "/messages", { text: "明天要去图书馆" });
  assert.equal(r.reply.content, "好的", "没记到待办就没有回执");
  // 其它 mode 的对话不记待办（脚本里不会有多余的请求）
  const hard = await api.request("POST", "/api/v1/conversations", { mode: "hard_thing" });
  assert.equal(fetch.remaining(), 1, "还剩给倾倒的那一条");
  void hard;
}

// ── 记忆被召回进聊天提示词（用户发起路径） ──
{
  const m = await api.request("POST", "/api/v1/memories", {
    layer: "episodic", kind: "片段", depth: "surface", content: "和阿明去了西湖", surface_text: "你和阿明去了西湖", entities: ["阿明"],
  });
  const sensitive = await api.request("POST", "/api/v1/memories", {
    layer: "profile", kind: "情绪", depth: "vulnerable", content: "害怕被抛下", surface_text: "你有时害怕被抛下", entities: ["被抛下"],
  });
  assert.equal(sensitive.privacy, "local");
  assert.equal(sensitive.visibility_gate, 0.6);
  assert.equal(m.privacy, "cloud");
  const { runtime: chat, fetch: f2 } = await makeRuntime({ script: [{ content: "嗯" }, { content: "好" }] });
  const note = (text) => chat.request("POST", "/api/v1/memories", text);
  await note({ layer: "episodic", kind: "片段", depth: "surface", content: "和阿明去了西湖", surface_text: "你和阿明去了西湖", entities: ["阿明"] });
  await note({ layer: "profile", kind: "情绪", depth: "vulnerable", content: "害怕被抛下", surface_text: "你有时害怕被抛下", entities: ["被抛下"] });
  const c2 = await chat.request("POST", "/api/v1/conversations", { mode: "hard_thing" });
  await chat.request("POST", "/api/v1/conversations/" + c2.id + "/messages", { text: "今天和阿明聊了会儿天" });
  const sys1 = f2.calls[0].body.messages[0].content;
  assert.match(sys1, /你和阿明去了西湖/, "相关记忆被带进提示词");
  assert.doesNotMatch(sys1, /被抛下/, "没提到的脆弱记忆不放");
  assert.doesNotMatch(sys1, /较私密的事/, "没有用户提起就没有脆弱记忆那一段");
  await chat.request("POST", "/api/v1/conversations/" + c2.id + "/messages", { text: "我又在想被抛下这件事" });
  assert.match(f2.calls[1].body.messages[0].content, /你有时害怕被抛下/, "用户自己提起时，相关脆弱记忆才放进来");
}

// ── 倾倒：流式回执 + 事后回取 + 各类存储视图 ──
let dumpId;
{
  const events = [];
  await api.stream("/api/v1/brain-dumps", { text: "今天过得不错，有点累，想做个日记功能" }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.event), ["item.classified", "item.classified", "item.classified", "receipt", "done"]);
  const receipt = events.at(-2).data;
  dumpId = receipt.dump_id;
  assert.equal(receipt.total, 3);
  assert.deepEqual(receipt.kind_counts, { 小结: 1, 情绪: 1, 灵感: 1 });
  assert.equal(receipt.outputs.summary.length, 1);

  const back = await api.request("GET", "/api/v1/brain-dumps/" + dumpId);
  assert.equal(back.status, "done");
  assert.equal(back.total, 3);
  assert.deepEqual(back.outputs, receipt.outputs, "事后回取与当时的回执一致");
  await rejects(api.request("GET", "/api/v1/brain-dumps/99999"), status(404));
  await rejects(api.stream("/api/v1/brain-dumps", {}, () => {}), (e) => assert.match(e.message, /需要 text 或 conversation_id/));
  await rejects(api.stream("/api/v1/brain-dumps", { conversation_id: 99999 }, () => {}), (e) => assert.match(e.message, /会话不存在/));

  const [summary] = await api.request("GET", "/api/v1/summaries");
  assert.equal(summary.content, "今天过得不错");
  assert.equal((await api.request("GET", "/api/v1/summaries?date=2026-11-11")).length, 1);
  assert.equal((await api.request("GET", "/api/v1/summaries?date=2026-11-10")).length, 0);
  const edited = await api.request("PATCH", "/api/v1/summaries/" + summary.id, { surface_text: "今天挺好的" });
  assert.equal(edited.surface_text, "今天挺好的");
  const emotion = (await api.request("GET", "/api/v1/emotions")).find((e) => e.content === "有点累");
  assert.equal(emotion.emotion.label, "累");
  await rejects(api.request("PATCH", "/api/v1/emotions/" + emotion.id, { content: "x" }), status(501), "情绪不开放编辑");
  const idea = await api.request("POST", "/api/v1/ideas", { content: "做个播客" });
  assert.equal(idea.layer, "state");
  assert.equal((await api.request("GET", "/api/v1/ideas")).length, 2);
}

// ── 寄存：情绪带 7 天期限；留下 → 进珍藏；删除；到期真删 ──
{
  const list = await api.request("GET", "/api/v1/ephemeral");
  assert.ok(list.length >= 1);
  const e = list.find((x) => x.kind === "情绪");
  assert.equal(e.expires_at, "2026-11-18T06:30:00.000Z", "默认 7 天");
  const kept = await api.request("POST", "/api/v1/ephemeral/" + e.id + "/keep");
  assert.equal(kept.kept_memory_id, e.id);
  assert.equal(kept.message, "已转入长久珍藏");
  assert.equal((await api.request("GET", "/api/v1/ephemeral")).some((x) => x.id === e.id), false, "留下后不再是寄存");
  const treasures = await api.request("GET", "/api/v1/treasures");
  assert.equal(treasures.length, 1);
  assert.equal(treasures[0].title, "留下的情绪");
  assert.equal(treasures[0].content, "你有点累");
  assert.equal((await api.request("GET", "/api/v1/treasures/" + treasures[0].id)).source_type, "ephemeral");

  await rejects(api.request("POST", "/api/v1/ephemeral/99999/keep"), status(404));
  await rejects(api.request("DELETE", "/api/v1/ephemeral/99999"), status(404));

  // 手动收藏：缺省取来源快照；来源类型/内容校验
  const idea = (await api.request("GET", "/api/v1/ideas"))[0];
  const t = await api.request("POST", "/api/v1/treasures", { source_type: "idea", source_id: idea.id });
  assert.equal(t.title, "留下的灵感");
  await rejects(api.request("POST", "/api/v1/treasures", { source_type: "bogus" }), status(422));
  await rejects(api.request("POST", "/api/v1/treasures", { source_type: "scene" }), status(422));
  await rejects(api.request("POST", "/api/v1/treasures", { source_type: "idea", source_id: 99999 }), status(404));
  assert.equal(await api.request("DELETE", "/api/v1/treasures/" + t.id), null);
  await rejects(api.request("GET", "/api/v1/treasures/" + t.id), status(404));

  // 到期真删：时间过了，记忆和历史都物理消失
  const tmp = await api.request("POST", "/api/v1/memories", { layer: "episodic", kind: "片段", depth: "surface", content: "会过期的" });
  await db.run("UPDATE memory_items SET expires_at = ? WHERE id = ?", ["2026-11-10T00:00:00.000Z", tmp.id]);
  const after = await api.request("GET", "/api/v1/ephemeral");
  assert.equal(after.some((x) => x.id === tmp.id), false);
  assert.equal(await db.get("SELECT id FROM memory_items WHERE id = ?", [tmp.id]), null, "物理删除");
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM memory_history WHERE memory_id = ?", [tmp.id])).c, 0, "历史一并删除");
}

// ── 记忆接口：校验 / 审阅 / 清空 ──
{
  await rejects(api.request("POST", "/api/v1/memories", { layer: "x", kind: "待办", depth: "surface", content: "a" }), status(422));
  await rejects(api.request("POST", "/api/v1/memories", { layer: "state", kind: "待办", depth: "secret", content: "a" }), status(422));
  const review = await api.request("GET", "/api/v1/memory-review");
  assert.ok(review.length >= 2);
  assert.ok(review.every((r) => ["日常", "个人", "较私密", "很私密"].includes(r.sensitivity)), "只用软标签");
  assert.ok(review.every((r, i) => i === 0 || review[i - 1].id > r.id), "新的在前");
  assert.ok(review.every((r) => !("depth" in r) && !("layer" in r)), "不暴露 depth / layer 原名");
  assert.deepEqual((await api.request("GET", "/api/v1/memory-review?sensitivity=很私密")), []);
  assert.ok((await api.request("GET", "/api/v1/memory-review?kind=灵感")).every((r) => r.kind === "灵感"));

  const mem = await api.request("POST", "/api/v1/memories", { layer: "state", kind: "灵感", depth: "personal", content: "旧", surface_text: "旧" });
  const upd = await api.request("PATCH", "/api/v1/memories/" + mem.id, { content: "新" });
  assert.equal(upd.version, 2);
  assert.equal(upd.root_id, mem.id);
  assert.equal(upd.visibility_gate, 0.3);
  await rejects(api.request("PATCH", "/api/v1/memories/" + mem.id, { content: "再改旧版本" }), status(404), "旧版本已不是最新（也不再对外可见）");
  await rejects(api.request("PATCH", "/api/v1/memories/" + upd.id, {}), status(400));
  await rejects(api.request("GET", "/api/v1/memories/99999"), status(404));
  assert.ok((await api.request("GET", "/api/v1/memories?kind=灵感")).every((m) => m.kind === "灵感"));
  assert.ok((await api.request("GET", "/api/v1/memories?depth=personal")).every((m) => m.depth === "personal"));

  const cleared = await api.request("DELETE", "/api/v1/memories");
  assert.ok(cleared.cleared > 5);
  assert.deepEqual(await api.request("GET", "/api/v1/memories"), []);
  assert.deepEqual(await api.request("GET", "/api/v1/todos"), []);
  assert.ok((await db.get("SELECT COUNT(*) AS c FROM memory_history WHERE event = 'DELETE'")).c >= cleared.cleared, "清空走遗忘，历史保留");
}

// ── 用户隔离：别人的数据读不到（本地只有一个用户，直接改库造一条别人的）──
{
  await db.run(
    "INSERT INTO memory_items (user_id, layer, kind, depth, content, surface_text, created_at, updated_at) VALUES (2, 'episodic', '待办', 'surface', '别人的', '别人的', ?, ?)",
    ["2026-11-11T00:00:00.000Z", "2026-11-11T00:00:00.000Z"],
  );
  const other = (await db.get("SELECT id FROM memory_items WHERE user_id = 2")).id;
  await rejects(api.request("GET", "/api/v1/todos/" + other), status(404));
  await rejects(api.request("DELETE", "/api/v1/memories/" + other), status(404));
  await rejects(api.request("GET", "/api/v1/memories/" + other), status(404));
  assert.deepEqual(await api.request("GET", "/api/v1/todos"), []);
  await db.run("INSERT INTO treasures (user_id, source_type, title, content, created_at) VALUES (2, 'memory', 'x', 'y', ?)", ["2026-11-11T00:00:00.000Z"]);
  const mine = await api.request("GET", "/api/v1/treasures");
  assert.ok(mine.every((t) => t.user_id === 1 && t.content !== "y"), "珍藏只看得到自己的");
  await rejects(api.request("GET", "/api/v1/treasures/" + (await db.get("SELECT id FROM treasures WHERE user_id = 2")).id), status(404));
}

void NOW;
console.log("PASS local memory api: todos, chat todos, recall, dump, ephemeral, treasures, review, isolation");
