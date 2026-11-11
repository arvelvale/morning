// 本地“虚拟服务器”：路由派发、桌宠、偏好、会话与消息（含流式、看图）、本机用户。
import assert from "node:assert/strict";

import { migrate } from "../src/local/db.ts";
import { COMPANION_FALLBACK } from "../src/local/generated/petPresets.ts";
import { MIGRATIONS } from "../src/local/schema.ts";
import { JPEG_B64, PNG_B64, makeRuntime, nodeSqliteDb, rejects } from "./local-test-kit.mjs";

const status = (code) => (e) => assert.equal(e.status, code, "状态码 " + e.status + " ≠ " + code + "：" + e.message);

// ── 数据库迁移 ──
{
  const db = nodeSqliteDb();
  assert.equal(await migrate(db, MIGRATIONS), MIGRATIONS.length);
  assert.equal((await db.get("PRAGMA user_version")).user_version, MIGRATIONS.length);
  await migrate(db, MIGRATIONS); // 幂等
  await rejects(migrate(db, [{ version: 2, name: "x", sql: "" }]), (e) => assert.match(e.message, /连续递增/));
  await db.run("PRAGMA user_version = 99");
  await rejects(migrate(db, MIGRATIONS), (e) => assert.match(e.message, /请先升级应用/));

  // 迁移失败整体回滚，版本号不前进
  const db2 = nodeSqliteDb();
  await rejects(
    migrate(db2, [{ version: 1, name: "bad", sql: "CREATE TABLE a (x); CREATE TABLE a (x);" }]),
    (e) => assert.ok(e),
  );
  assert.equal((await db2.get("PRAGMA user_version")).user_version, 0);
  assert.equal(await db2.get("SELECT name FROM sqlite_master WHERE name = 'a'"), null, "失败的迁移不能留下半截表");
}

// ── 事务：回滚 + 串行化 ──
{
  const db = nodeSqliteDb();
  await db.exec("CREATE TABLE t (n INTEGER)");
  await rejects(db.transaction(async (tx) => { await tx.run("INSERT INTO t VALUES (1)"); throw new Error("boom"); }), (e) => assert.equal(e.message, "boom"));
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM t")).c, 0);
  // 事务进行中，外部写入要等它结束，不会穿插进事务里
  const slow = db.transaction(async (tx) => {
    await tx.run("INSERT INTO t VALUES (10)");
    await new Promise((r) => setTimeout(r, 30));
    await tx.run("INSERT INTO t VALUES (11)");
  });
  const outside = db.run("INSERT INTO t VALUES (99)");
  await Promise.all([slow, outside]);
  assert.deepEqual((await db.all("SELECT n FROM t ORDER BY rowid")).map((r) => r.n), [10, 11, 99]);
}

const { runtime: api, db, fetch, images } = await makeRuntime({
  script: [
    { deltas: ["你", "好", "呀"] },            // 第一条消息（流式）
    { content: "非流式的回复" },                 // 第二条（非流式）
    { deltas: ["看到了", "一只猫"] },            // 带图片
    { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, // 流式失败（无备用 → 重试 5 次）
  ],
});

// ── 路由 ──
await rejects(api.request("GET", "/api/v1/nope"), status(501));
await rejects(api.request("GET", "/api/v1/scenes"), (e) => { status(501)(e); assert.match(e.detail, /本地模式暂不支持/); });
await rejects(api.stream("/api/v1/scenes?stream=true", { title: "x" }, () => {}), status(501));

// ── 本机用户 ──
{
  const me = await api.request("GET", "/api/v1/users/me");
  assert.equal(me.id, 1);
  assert.equal(me.is_active, true);
  assert.equal(await api.request("POST", "/api/v1/users/me/active"), null);
  const patched = await api.request("PATCH", "/api/v1/users/me", { display_name: "晨熠" });
  assert.equal(patched.display_name, "晨熠");
  const t = await api.request("POST", "/api/v1/auth/login", { username: "a", password: "b" });
  assert.equal(t.access_token, "local");
}

// ── 桌宠 ──
{
  const presets = await api.request("GET", "/api/v1/pets/presets");
  assert.deepEqual(presets.map((p) => p.id), ["miro", "bobi"]);
  await rejects(api.request("GET", "/api/v1/pets/active"), (e) => { status(404)(e); assert.equal(e.detail, "还没有主桌宠"); });
  assert.deepEqual(await api.request("GET", "/api/v1/pets"), []);

  const first = await api.request("PUT", "/api/v1/pets/active", { petId: "miro" });
  assert.equal(first.pet.name, "米露");
  assert.equal(first.pet.is_active, true);
  assert.equal(first.handoff, null);
  assert.ok(first.pet.system_prompt.length > 100);
  // 再次传同一预设：复用，不重复新建
  const again = await api.request("PUT", "/api/v1/pets/active", { petId: "miro" });
  assert.equal(again.pet.id, first.pet.id);
  assert.equal((await api.request("GET", "/api/v1/pets")).length, 1);
  // 切到另一个预设；主桌宠只有一只
  const bobi = await api.request("PUT", "/api/v1/pets/active", { petId: "bobi" });
  assert.equal(bobi.pet.name, "波比");
  const all = await api.request("GET", "/api/v1/pets");
  assert.equal(all.filter((p) => p.is_active).length, 1);
  assert.equal((await api.request("GET", "/api/v1/pets/active")).id, bobi.pet.id);
  // 字面量路由 /pets/active 优先于 /pets/{id}
  assert.equal((await api.request("GET", "/api/v1/pets/" + first.pet.id)).name, "米露");
  // 按整数 id 切回
  assert.equal((await api.request("PUT", "/api/v1/pets/active", { petId: first.pet.id })).pet.id, first.pet.id);
  await rejects(api.request("PUT", "/api/v1/pets/active", { petId: "nobody" }), status(404));
  await rejects(api.request("PUT", "/api/v1/pets/active", { petId: 999 }), status(404));
  await rejects(api.request("PUT", "/api/v1/pets/active", {}), status(422));
  // 定制
  const renamed = await api.request("PATCH", "/api/v1/pets/" + first.pet.id, { name: "小露", actions: ["挥手"] });
  assert.equal(renamed.name, "小露");
  assert.deepEqual(renamed.actions, ["挥手"]);
  await rejects(api.request("PATCH", "/api/v1/pets/" + first.pet.id, { name: "" }), status(422));
  await rejects(api.request("PATCH", "/api/v1/pets/" + first.pet.id, { personality: "x".repeat(301) }), status(422));
  // 删除主桌宠后 active 回到 404
  await api.request("DELETE", "/api/v1/pets/" + first.pet.id);
  await rejects(api.request("GET", "/api/v1/pets/active"), status(404));
  await rejects(api.request("GET", "/api/v1/pets/" + first.pet.id), status(404));
  await api.request("PUT", "/api/v1/pets/active", { petId: bobi.pet.id });
}

// ── 偏好 ──
{
  const prefs = await api.request("GET", "/api/v1/preferences");
  assert.equal(prefs.proactive_frequency, "温和");
  assert.equal(prefs.evening_letter_enabled, true);
  assert.deepEqual(prefs.proactive_schedule_times, ["08:00", "15:00", "20:00"]);
  const out = await api.request("PATCH", "/api/v1/preferences", { evening_letter_enabled: false, evening_letter_time: "22:10", proactive_schedule_times: ["20:00", "08:00", "08:00"] });
  assert.equal(out.evening_letter_enabled, false);
  assert.equal(out.evening_letter_time, "22:10");
  assert.deepEqual(out.proactive_schedule_times, ["08:00", "20:00"]);
  assert.equal((await api.request("GET", "/api/v1/preferences")).evening_letter_enabled, false, "确实存下来了");
  await rejects(api.request("PATCH", "/api/v1/preferences", {}), status(400));
  await rejects(api.request("PATCH", "/api/v1/preferences", { evening_letter_time: "25:00" }), (e) => { status(422)(e); assert.match(e.detail, /HH:MM/); });
  await rejects(api.request("PATCH", "/api/v1/preferences", { proactive_frequency: "疯狂" }), status(422));
  await rejects(api.request("PATCH", "/api/v1/preferences", { ephemeral_ttl_days: 31 }), status(422));
  await rejects(api.request("PATCH", "/api/v1/preferences", { font_size: "巨大" }), status(422));
  await rejects(api.request("PATCH", "/api/v1/preferences", { max_daily_triggers: 0 }), status(422));
  await rejects(api.request("PATCH", "/api/v1/preferences", { is_muted: "yes" }), status(422));
  // 只读字段被忽略 → 等于没传
  await rejects(api.request("PATCH", "/api/v1/preferences", { driving_mode_active: true }), status(400));
  // null 视为没传
  assert.equal((await api.request("PATCH", "/api/v1/preferences", { font_size: "大", is_muted: null })).font_size, "大");
  assert.deepEqual(await api.request("POST", "/api/v1/preferences/location", { lat: 30.2, lon: 120.1, city: "杭州" }), { ok: true, city: "杭州" });
  assert.deepEqual(await api.request("POST", "/api/v1/preferences/location", { lat: 30.3, lon: 120.2 }), { ok: true, city: "杭州" }, "没给城市沿用上次的");
  await rejects(api.request("POST", "/api/v1/preferences/location", { lat: 91, lon: 0 }), status(422));
}

// ── 对话：创建 / 列表 / 校验 ──
const events = [];
let conv;
{
  conv = await api.request("POST", "/api/v1/conversations", { pet_id: null, mode: "free_chat" });
  assert.equal(conv.mode, "free_chat");
  assert.equal(conv.title, null);
  await rejects(api.request("POST", "/api/v1/conversations", { mode: "review_fragment" }), (e) => { status(422)(e); assert.match(e.detail, /fragment_id/); });
  await rejects(api.request("POST", "/api/v1/conversations", { mode: "weird" }), status(422));
  assert.equal(await api.request("GET", "/api/v1/conversations/latest"), null, "还没有用户消息：没有可续聊的");
  await rejects(api.request("GET", "/api/v1/conversations/9999"), (e) => { status(404)(e); assert.equal(e.detail, "会话不存在"); });
}

// ── 发消息（流式） ──
{
  await api.stream("/api/v1/conversations/" + conv.id + "/messages?stream=true", { text: "有点累" }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.event), ["token", "token", "token", "done"]);
  assert.equal(events.map((e) => e.data.delta ?? "").join(""), "你好呀");
  const done = events.at(-1).data;
  assert.equal(done.content, "你好呀");

  const detail = await api.request("GET", "/api/v1/conversations/" + conv.id);
  assert.equal(detail.title, "有点累");
  assert.deepEqual(detail.messages.map((m) => [m.role, m.content]), [["user", "有点累"], ["assistant", "你好呀"]]);
  assert.equal(detail.messages[1].id, done.message_id);

  // 请求体：系统提示在最前，带上了桌宠人格（当前主桌宠 = 波比）和环境
  const body = fetch.calls[0].body;
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /你的人格与角色/);
  assert.match(body.messages[0].content, /11 月 11 日下午 14 点左右/);
  assert.deepEqual(body.messages.slice(1), [{ role: "user", content: "有点累" }]);
  assert.equal(body.temperature, 0.7);

  // 续聊入口取到这段
  const latest = await api.request("GET", "/api/v1/conversations/latest");
  assert.equal(latest.id, conv.id);
  assert.equal(latest.messages.length, 2);
}

// ── 发消息（非流式）+ 历史带入 ──
{
  const r = await api.request("POST", "/api/v1/conversations/" + conv.id + "/messages", { text: "再聊聊" });
  assert.equal(r.conversation_id, conv.id);
  assert.equal(r.reply.role, "assistant");
  assert.equal(r.reply.content, "非流式的回复");
  const sent = fetch.calls[1].body.messages;
  assert.deepEqual(sent.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(fetch.calls[1].body.stream, false);
  const list = await api.request("GET", "/api/v1/conversations/" + conv.id + "/messages?limit=2");
  assert.equal(list.length, 2);
  const next = await api.request("GET", "/api/v1/conversations/" + conv.id + "/messages?cursor=" + list[1].id);
  assert.equal(next[0].id > list[1].id, true);
}

// ── 发消息校验 ──
{
  await rejects(api.request("POST", "/api/v1/conversations/" + conv.id + "/messages", { text: "   " }), (e) => { status(422)(e); assert.equal(e.detail, "说点什么，或者发张图片吧"); });
  await rejects(api.stream("/api/v1/conversations/" + conv.id + "/messages?stream=true", { text: "" }, () => {}), status(422));
  await rejects(api.request("POST", "/api/v1/conversations/9999/messages", { text: "hi" }), status(404));
  const calls = fetch.calls.length;
  // 图片不合要求：在开始回复之前就拒收，不调模型、不留消息
  const before = (await api.request("GET", "/api/v1/conversations/" + conv.id)).messages.length;
  for (const [images, re] of [
    [[{ data: JPEG_B64 }, { data: JPEG_B64 }, { data: JPEG_B64 }, { data: JPEG_B64 }], /最多发 3 张/],
    [[{ data: "" }], /图片是空的/],
    [[{ data: "not base64!!" }], /没传完整/],
    [[{ data: Buffer.from("hello world, not an image").toString("base64") }], /只支持 JPG、PNG、WebP/],
    [[{ data: JPEG_B64, mime: "image/png" }], /格式有点问题/],
    [[{ data: Buffer.alloc(1_500_001, 0xff).toString("base64") }], /太大/],
  ]) {
    await rejects(api.request("POST", "/api/v1/conversations/" + conv.id + "/messages", { text: "看图", images }), (e) => { status(422)(e); assert.match(e.detail, re); });
  }
  assert.equal(fetch.calls.length, calls, "被拒收的图片不能触发模型调用");
  assert.equal((await api.request("GET", "/api/v1/conversations/" + conv.id)).messages.length, before, "被拒收时不留消息");
  assert.equal(images.files.size, 0, "被拒收时不留图片文件");
  const voice = await api.request("POST", "/api/v1/conversations", { mode: "voice_call" });
  await rejects(api.request("POST", "/api/v1/conversations/" + voice.id + "/messages", { text: "x", images: [{ data: JPEG_B64 }] }), (e) => { status(422)(e); assert.match(e.detail, /通话里/); });
}

// ── 带图片的消息 ──
let imageMessageId;
{
  const ev = [];
  await api.stream("/api/v1/conversations/" + conv.id + "/messages?stream=true",
    { text: "这是什么", images: [{ data: "data:image/jpeg;base64," + JPEG_B64, mime: "image/jpeg" }, { data: PNG_B64 }] }, (e) => ev.push(e));
  assert.equal(ev.at(-1).data.content, "看到了一只猫");
  const sent = fetch.calls.at(-1).body.messages;
  assert.match(sent[0].content, /用户这次发了图片/, "系统提示里有看图说明");
  const last = sent.at(-1);
  assert.equal(last.role, "user");
  assert.deepEqual(last.content.map((p) => p.type), ["text", "image_url", "image_url"]);
  assert.equal(last.content[1].image_url.url, "data:image/jpeg;base64," + JPEG_B64);

  const detail = await api.request("GET", "/api/v1/conversations/" + conv.id);
  const msg = detail.messages.find((m) => m.content === "这是什么");
  imageMessageId = msg.id;
  assert.equal(msg.images.length, 2);
  assert.match(msg.images[0], /^file:\/\/\/images\/1\/[0-9]{32}\.jpg$/);
  assert.match(msg.images[1], /\.png$/);
  assert.equal(images.files.size, 2);
  const got = await api.request("GET", "/api/v1/conversations/" + conv.id + "/messages/" + msg.id + "/images/1");
  assert.equal(got.uri, msg.images[1]);
  await rejects(api.request("GET", "/api/v1/conversations/" + conv.id + "/messages/" + msg.id + "/images/5"), status(404));
  await rejects(api.request("GET", "/api/v1/conversations/" + conv.id + "/messages/" + msg.id + "/images/-1"), status(404));
}

// ── 只有图片没有文字：标题用 [图片]；更早的图片只留说明，只带最近 2 条带图消息 ──
{
  const only = await api.request("POST", "/api/v1/conversations", { mode: "free_chat" });
  const small = [{ data: JPEG_B64 }];
  const script = [{ content: "1" }, { content: "2" }, { content: "3" }, { content: "4" }];
  // 复用同一个运行时的 fetch 脚本：补充脚本
  const { runtime: r2, fetch: f2, images: im2 } = await makeRuntime({ script });
  const c2 = await r2.request("POST", "/api/v1/conversations", { mode: "free_chat" });
  for (let i = 0; i < 3; i++) await r2.request("POST", "/api/v1/conversations/" + c2.id + "/messages", { text: i === 0 ? "" : "第" + (i + 1) + "张", images: small });
  assert.equal((await r2.request("GET", "/api/v1/conversations/" + c2.id)).title, "[图片]");
  const third = f2.calls[2].body.messages.slice(1).filter((m) => m.role === "user");
  assert.ok(Array.isArray(third[2].content) && Array.isArray(third[1].content), "最近两条带图");
  assert.equal(third[0].content, "（这里发过图片，现在不再附上）", "更早的只留说明");
  // 文件丢了：那张图当没有，不报错
  im2.files.clear();
  const after = await r2.request("POST", "/api/v1/conversations/" + c2.id + "/messages", { text: "图片文件没了还能聊" });
  assert.equal(after.reply.content, "4");
  const lost = f2.calls[3].body.messages.slice(1).filter((m) => m.role === "user");
  assert.ok(lost.every((m) => typeof m.content === "string"), "文件丢了：那些图当没有，不报错");
  void only;
}

// ── 模型失败：温和兜底，仍然存下助手消息 ──
{
  const ev = [];
  await api.stream("/api/v1/conversations/" + conv.id + "/messages?stream=true", { text: "还在吗" }, (e) => ev.push(e));
  assert.equal(ev.at(-1).event, "done");
  assert.equal(ev.at(-1).data.content, COMPANION_FALLBACK);
  assert.ok(!JSON.stringify(ev).includes("500"), "不暴露技术错误");
}
{
  const { runtime: r3 } = await makeRuntime({ script: [{ status: 401 }], keys: { stepfun: "", deepseek: "" } });
  const c3 = await r3.request("POST", "/api/v1/conversations", { mode: "free_chat" });
  const r = await r3.request("POST", "/api/v1/conversations/" + c3.id + "/messages", { text: "没有密钥" });
  assert.equal(r.reply.content, COMPANION_FALLBACK, "没有密钥也给温和兜底");
}

// ── 删除会话：连图片文件一起删 ──
{
  assert.ok(images.files.size > 0);
  assert.equal(await api.request("DELETE", "/api/v1/conversations/" + conv.id), null);
  assert.equal(images.files.size, 0, "删会话时图片文件一并清掉");
  await rejects(api.request("GET", "/api/v1/conversations/" + conv.id), status(404));
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM conversation_messages WHERE conversation_id = ?", [conv.id])).c, 0);
  await rejects(api.request("DELETE", "/api/v1/conversations/" + conv.id), status(404));
  void imageMessageId;
}

// ── 会话列表分页 ──
{
  for (let i = 0; i < 3; i++) await api.request("POST", "/api/v1/conversations", { mode: "free_chat" });
  const page1 = await api.request("GET", "/api/v1/conversations?limit=2");
  assert.equal(page1.length, 2);
  assert.ok(page1[0].id > page1[1].id, "最新在前");
  const page2 = await api.request("GET", "/api/v1/conversations?limit=2&cursor=" + page1[1].id);
  assert.ok(page2.every((c) => c.id < page1[1].id));
  await rejects(api.request("GET", "/api/v1/conversations?limit=0"), status(422));
}

// ── 首页聚合 ──
{
  const home = await api.request("GET", "/api/v1/companion/home");
  assert.equal(home.pet.name, "波比");
  assert.equal(home.behavior, "歪头看你"); // 14:30
  assert.equal(home.invitation, null);
}

// ── 密钥相关接口 ──
{
  assert.deepEqual(await api.request("PUT", "/api/v1/users/me/own-key", { enabled: true }), { uses_own_key: true });
  assert.deepEqual(await api.request("POST", "/api/v1/tick"), { accepted: false, reason: "local" });
  const policy = await api.request("GET", "/api/v1/ai/keys/policy");
  assert.equal(policy.byok_required, true);
  assert.equal(policy.text_model, "step-3.7-flash");
}

console.log("PASS local api: migrations, router, users, pets, preferences, conversations, images");
