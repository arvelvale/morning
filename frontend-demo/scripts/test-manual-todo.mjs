import assert from "node:assert/strict";
import { todoPayload, saveManualTodo } from "../src/screens/todos/createTodo.ts";
import { planReminder, toTodo } from "../src/screens/todos/todoLogic.ts";

process.env.TZ = "Asia/Shanghai";
const now = new Date("2026-11-03T10:00:00+08:00");
const draft = { text: "  打印申请表  ", date: "2026-11-04", time: "09:30", remind: true };
const payload = todoPayload(draft, now);
assert.deepEqual(payload, { content: "打印申请表", surface_text: "打印申请表", due_date: "2026-11-04T01:30:00.000Z" });
assert.equal(planReminder(payload.due_date, now).toISOString(), "2026-11-04T01:15:00.000Z", "沿用提前 15 分钟规则");
assert.equal(todoPayload({ ...draft, time: "" }, now).due_date, "2026-11-03T16:00:00.000Z", "只有日期按东八区午夜序列化");
assert.equal(todoPayload({ ...draft, date: "", time: "" }, now).due_date, null);
assert.equal(planReminder(null, now).toISOString(), "2026-11-04T00:00:00.000Z", "未定时间沿用明早 8 点");
assert.equal(planReminder("2026-11-03T02:08:00Z", now).toISOString(), "2026-11-03T02:08:00.000Z", "不足 15 分钟到点提醒");
assert.equal(planReminder(todoPayload({ ...draft, date: "2026-11-03", time: "" }, now).due_date, now), null, "今天已过早八点仍可记下，不能谎报提醒已排");
for (const [patch, message] of [
  [{ text: "  " }, /先写/], [{ text: "事".repeat(501) }, /500/],
  [{ date: "2026/11/04" }, /日期请/], [{ date: "2026-02-30" }, /日期不存在/],
  [{ date: "", time: "09:30" }, /选个日期/], [{ time: "25:00" }, /时间请/],
  [{ time: "09:60" }, /时间请/], [{ time: "00:00" }, /零点/],
  [{ date: "2026-11-02" }, /已经过去/], [{ date: "2026-11-03", time: "09:59" }, /已经过去/],
]) assert.throws(() => todoPayload({ ...draft, ...patch }, now), message);
assert.doesNotThrow(() => todoPayload({ ...draft, date: "2028-02-29" }, now), "合法闰日");

// 真正执行保存编排，验证返回的服务器 id 被用于提醒；创建失败不能排幽灵提醒。
const todo = toTodo({ id: 42, ...payload, status: "pending", created_at: now.toISOString() });
const order = [];
const deps = {
  create: async (body) => { assert.deepEqual(body, payload); order.push("create"); return todo; },
  onSaved: (saved) => { assert.equal(saved.id, 42); order.push("saved"); },
  remind: async (saved) => { assert.equal(saved.id, 42); assert.equal(saved.dueAt, payload.due_date); order.push("remind"); return true; },
};
assert.deepEqual(await saveManualTodo(payload, true, deps), { todo, reminded: true });
assert.deepEqual(order, ["create", "saved", "remind"]);
order.length = 0;
assert.equal((await saveManualTodo(payload, false, deps)).reminded, false);
assert.deepEqual(order, ["create", "saved"], "关闭提醒只保存");
order.length = 0;
assert.equal((await saveManualTodo(payload, true, { ...deps, remind: async () => false })).todo.id, 42, "权限被拒绝仍返回已保存结果");
assert.deepEqual(order, ["create", "saved"]);
assert.equal((await saveManualTodo(payload, true, { ...deps, remind: async () => { throw Error("native unavailable"); } })).reminded, false, "原生提醒异常不回滚待办");
order.length = 0;
await assert.rejects(saveManualTodo(payload, true, { ...deps, create: async () => { throw Error("offline"); } }), /offline/);
assert.deepEqual(order, [], "保存失败不更新列表、不排通知");
console.log("PASS 手动待办：输入/北京时间/提醒规则/关闭提醒/权限拒绝/网络失败/先保存后提醒");
