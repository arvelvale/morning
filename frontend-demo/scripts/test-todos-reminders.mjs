// 待办提醒 / 分组 / 「是否该问」 / 夜间气泡 / 随手记整理 的纯函数测试。运行：TZ=Asia/Shanghai node scripts/test-todos-reminders.mjs
import assert from "node:assert/strict";

import {
  clock, dueInfo, dueLabel, dueSpoken, groupTodos, pickNext, pickPrompt, planReminder,
  remindButtonText, remindOnText, remindWhen, toTodo,
} from "../src/screens/todos/todoLogic.ts";
import { buildNotes, evidenceText, sealOfKind } from "../src/screens/todos/notesLogic.ts";
import { inNightWindow, invitationBubble, isNightCopy, stripEmoji } from "../src/screens/today/bubbleText.ts";

process.env.TZ ||= "Asia/Shanghai";
// 「现在」= 2026-10-19 09:00（东八区）
const NOW = new Date("2026-10-19T09:00:00+08:00");
const at = (s) => new Date(`${s}:00+08:00`);
const T = (id, dueAt, extra = {}) => ({ id, text: `事${id}`, dueAt, done: false, createdAt: `2026-10-18T0${id}:00:00Z`, ...extra });

// 1. 事情时间三态：没定 / 只有日期（本地 00:00）/ 有时刻（带 Z、带 +08:00、不带时区都认）
assert.equal(dueInfo(null).kind, "none");
assert.equal(dueInfo("2026-10-20T00:00:00+08:00").kind, "date");
assert.equal(dueInfo("2026-10-19T16:00:00Z").kind, "date", "UTC 16:00 = 东八区次日 00:00，只有日期");
assert.equal(dueInfo("2026-10-19T02:15:00Z").kind, "time", "UTC 02:15 = 10:15");
assert.equal(dueInfo("2026-10-19T02:15:00").kind, "time", "不带时区按 UTC 理解");
assert.equal(clock(dueInfo("2026-10-19T02:15:00Z").at), "10:15");

// 2. 默认提醒时间：设计值「提前 15 分钟 → remindAt = due - 15*60*1000」
assert.deepEqual(planReminder("2026-10-19T10:15:00+08:00", NOW), at("2026-10-19T10:00"), "10:15 的事 → 10:00 提醒");
assert.deepEqual(planReminder("2026-10-19T09:10:00+08:00", NOW), at("2026-10-19T09:10"), "不足 15 分钟 → 到点提醒");
assert.deepEqual(planReminder("2026-10-19T09:15:00+08:00", NOW), at("2026-10-19T09:15"), "正好 15 分钟：提前量落在此刻、不算未来 → 到点提醒");
assert.equal(planReminder("2026-10-19T08:30:00+08:00", NOW), null, "已经过了 → 不提醒");
assert.equal(planReminder("2026-10-19T09:00:00+08:00", NOW), null, "正好此刻 → 已过");
// 只有日期：当天 8 点
assert.deepEqual(planReminder("2026-10-21T00:00:00+08:00", NOW), at("2026-10-21T08:00"));
assert.equal(planReminder("2026-10-19T00:00:00+08:00", NOW), null, "今天只有日期、8 点已过 → 不提醒");
assert.deepEqual(planReminder("2026-10-19T00:00:00+08:00", new Date("2026-10-19T06:00:00+08:00")), at("2026-10-19T08:00"), "今天早上 6 点：当天 8 点");
assert.equal(planReminder("2026-10-18T00:00:00+08:00", NOW), null, "昨天的日期 → 不提醒");
// 没有时间：明早 8 点
assert.deepEqual(planReminder(null, NOW), at("2026-10-20T08:00"));
assert.deepEqual(planReminder(null, new Date("2026-10-19T23:50:00+08:00")), at("2026-10-20T08:00"));

// 3. 文案
assert.equal(dueLabel("2026-10-19T10:15:00+08:00", NOW), "今天 10:15");
assert.equal(dueLabel("2026-10-20T15:00:00+08:00", NOW), "明天 · 15:00");
assert.equal(dueLabel("2026-10-21T00:00:00+08:00", NOW), "10月21日");
assert.equal(dueLabel("2026-10-21T15:00:00+08:00", NOW), "10月21日 15:00");
assert.equal(dueLabel("2026-10-19T00:00:00+08:00", NOW), "今天");
assert.equal(dueLabel("2026-10-20T00:00:00+08:00", NOW), "明天");
assert.equal(dueLabel("2027-01-02T00:00:00+08:00", NOW), "2027年1月2日");
assert.equal(dueLabel(null, NOW), "没定时间");
assert.equal(dueSpoken("2026-10-19T10:15:00+08:00", NOW), "10:15");
assert.equal(dueSpoken("2026-10-20T15:00:00+08:00", NOW), "明天 15:00");
assert.equal(remindButtonText(at("2026-10-19T10:00"), NOW), "10:00 提醒我");
assert.equal(remindButtonText(at("2026-10-20T08:00"), NOW), "明早 8 点提醒我");
assert.equal(remindButtonText(at("2026-10-21T08:00"), NOW), "10月21日 8 点提醒我");
assert.equal(remindOnText(at("2026-10-19T10:00"), NOW), "10:00 叫你");
assert.equal(remindOnText(at("2026-10-20T08:00"), NOW), "明早 8 点叫你");
assert.equal(remindOnText(at("2026-10-19T08:00"), NOW), "已提醒", "提醒时间已过");
assert.equal(remindWhen(at("2026-10-19T08:00"), new Date("2026-10-19T06:00:00+08:00")), "今早 8 点");

// 4. 分组：今天 / 之后 / 没定时间 / 已完成
const todos = [
  T(1, "2026-10-19T15:00:00+08:00"),
  T(2, "2026-10-19T10:15:00+08:00"),
  T(3, "2026-10-19T00:00:00+08:00"),          // 今天只有日期：排在今天有时刻的后面
  T(4, "2026-10-22T09:00:00+08:00"),
  T(5, "2026-10-21T00:00:00+08:00"),
  T(6, null),
  T(7, null, { createdAt: "2026-10-19T01:00:00Z" }),
  T(8, "2026-10-19T10:00:00+08:00", { done: true }),
  T(9, "2026-10-17T00:00:00+08:00"),           // 过期没做：放今天，文案会写出日期
];
const g = groupTodos(todos, NOW);
assert.deepEqual(g.today.map((t) => t.id), [9, 2, 1, 3]);
assert.deepEqual(g.later.map((t) => t.id), [5, 4]);
assert.deepEqual(g.undated.map((t) => t.id), [7, 6], "没定时间的：新记的在前");
assert.deepEqual(g.done.map((t) => t.id), [8]);

// 5. 「接下来」：最近一件还没过的；没有则退回没定时间的最近一件
assert.equal(pickNext(todos, NOW).id, 2);
assert.equal(pickNext([T(1, "2026-10-19T08:00:00+08:00"), T(6, null)], NOW).id, 6, "时刻已过的不算 → 退回没定时间");
assert.equal(pickNext([T(3, "2026-10-19T00:00:00+08:00")], NOW).id, 3, "今天只有日期仍算还没过");
assert.equal(pickNext([T(9, "2026-10-17T00:00:00+08:00"), T(8, null, { done: true })], NOW), null);
assert.equal(pickNext([], NOW), null);

// 6. 「该不该问」：有时刻、没过、没设提醒、没点「不用」；多条取最近
const cand = [
  T(1, "2026-10-19T15:00:00+08:00"),
  T(2, "2026-10-19T10:15:00+08:00"),
  T(3, "2026-10-19T08:00:00+08:00"),                    // 已过
  T(4, "2026-10-20T00:00:00+08:00"),                    // 只有日期
  T(5, null),
  T(6, "2026-10-19T09:30:00+08:00", { done: true }),    // 已完成
];
assert.equal(pickPrompt(cand, {}, new Set(), NOW).id, 2, "多条只问最近的一条");
assert.equal(pickPrompt(cand, { 2: { at: "x" } }, new Set(), NOW).id, 1, "已设提醒的不问，换下一条");
assert.equal(pickPrompt(cand, {}, new Set([2]), NOW).id, 1, "点过「不用」的不再问");
assert.equal(pickPrompt(cand, { 2: { at: "x" } }, new Set([1]), NOW), null, "都处理过 → 不问");
assert.equal(pickPrompt([cand[2], cand[3], cand[4], cand[5]], {}, new Set(), NOW), null, "已过 / 只有日期 / 没时间 / 已完成都不问");

// 7. 后端条目 → TodoItem
assert.deepEqual(toTodo({ id: 5, surface_text: "开会", due_date: "2026-10-19T02:15:00Z", status: "done", created_at: "x" }), { id: 5, text: "开会", dueAt: "2026-10-19T02:15:00Z", done: true, createdAt: "x" });
assert.equal(toTodo({ id: 5, status: "canceled" }), null);
assert.equal(toTodo({ id: 5, content: "c", status: null }).done, false, "没显式状态的视为 pending");

// 8. 气泡：夜间类文案只在 20:00–次日 5:00 放行
const H = (h, m = 0) => new Date(2026, 9, 19, h, m);
assert.equal(inNightWindow(H(19, 59)), false);
assert.equal(inNightWindow(H(20, 0)), true);
assert.equal(inNightWindow(H(4, 59)), true);
assert.equal(inNightWindow(H(5, 0)), false);
assert.equal(isNightCopy("该歇一歇了 🌙"), true);
assert.equal(isNightCopy("早点睡"), true);
assert.equal(isNightCopy("晚安，今天辛苦了"), true);
assert.equal(isNightCopy("今天有 3 件事等你接住"), false);
assert.equal(invitationBubble("该歇一歇了 🌙", H(8, 30)), null, "早上不显示睡前提醒");
assert.equal(invitationBubble("该歇一歇了 🌙", H(14, 0)), null);
assert.equal(invitationBubble("该歇一歇了 🌙", H(22, 30)), "该歇一歇了", "夜里显示，且去掉 emoji");
assert.equal(invitationBubble("今天有 3 件事等你接住", H(8, 30)), "今天有 3 件事等你接住", "普通邀请白天照常");
assert.equal(invitationBubble("", H(8)), null);
assert.equal(invitationBubble(undefined, H(8)), null);
assert.equal(stripEmoji("晚上好 ✨ 米露"), "晚上好 米露");

// 9. 随手记：三个来源合一列，瞬间合并候选的 evidence
assert.equal(sealOfKind("情绪"), "情");
assert.equal(sealOfKind("片段"), "瞬");
assert.equal(sealOfKind("fragment"), "瞬");
assert.equal(sealOfKind("灵感"), "想");
assert.equal(evidenceText("  当时说的话 "), "当时说的话");
assert.equal(evidenceText([{ text: "a" }, "b"]), "a\nb");
assert.equal(evidenceText(null), null);
const notes = buildNotes(
  [{ id: 1, surface_text: "想做个小游戏", created_at: "2026-10-19T01:00:00Z" }],
  [
    { id: 2, kind: "情绪", surface_text: "有点累", created_at: "2026-10-19T02:00:00Z", expires_at: "2026-11-18T00:00:00Z" },
    { id: 3, kind: "片段", surface_text: "地铁里的夕阳", created_at: "2026-10-19T03:00:00Z", expires_at: "2026-11-18T00:00:00Z" },
    { id: 9, kind: "待办", surface_text: "不该出现", created_at: "2026-10-19T04:00:00Z", expires_at: "2026-11-18T00:00:00Z" },
  ],
  [
    { id: 3, surface_text: "地铁里的夕阳", evidence: "今天地铁上看到夕阳，好想拍下来", created_at: "2026-10-19T03:00:00Z" },
    { id: 4, surface_text: "只在候选里的瞬间", created_at: "2026-10-19T05:00:00Z" },
  ],
);
assert.deepEqual(notes.map((n) => n.id), [4, 3, 2, 1], "新的在前，待办不混进来，同 id 合并");
const m3 = notes.find((n) => n.id === 3);
assert.equal(m3.seal, "瞬");
assert.equal(m3.evidence, "今天地铁上看到夕阳，好想拍下来");
assert.equal(m3.keepable, true, "合并后仍保留寄存的珍藏/放下");
assert.equal(notes.find((n) => n.id === 4).keepable, false);
assert.equal(notes.find((n) => n.id === 2).evidence, null, "没有原话就是 null，详情里不显示");

console.log("test-todos-reminders: all passed");
