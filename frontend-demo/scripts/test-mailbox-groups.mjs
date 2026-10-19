// 信箱改版的纯函数：归类、按天分组、标题、搜索、时间。运行：TZ=Asia/Shanghai node scripts/test-mailbox-groups.mjs
import assert from "node:assert/strict";

import {
  _fmtLetterDate, dayKey, dayLabel, groupLettersByDay, letterClock, letterKind, letterListTime,
  matchLetter, rehearsalOf,
  shownDays, idsOfDays, toggleId, isAllSelected, toggleSelectAll, pruneSelection, removeLetters,
  restoreLetters, clearBefore, unreadCountOf, markAllReadLocal, revertRead, deleteSelectedConfirm, clearAllConfirm,
} from "../src/screens/mailbox/letterGroups.ts";

process.env.TZ ||= "Asia/Shanghai";
const L = (id, type, created_at, extra = {}) => ({
  id, type, title: `t${id}`, body: `b${id}`, pet_id: null, ref_memory_id: null, attachment: null, is_read: true, created_at, ...extra,
});

// 1. 归类：后端 type → 晚间信 / 有句话 / 周报 / 小纸条
assert.equal(letterKind(L(1, "greeting", "")), "evening");
assert.equal(letterKind(L(1, "scene_invite", "")), "rehearse");
assert.equal(letterKind(L(1, "music", "", { attachment: { kind: "scene_invite" } })), "rehearse", "按附件也能认出有句话");
assert.equal(letterKind(L(1, "weekly", "")), "weekly");
assert.equal(letterKind(L(1, "reminder", "")), "note");
assert.equal(letterKind(L(1, "proactive", "")), "note");
assert.equal(letterKind(L(1, "relationship", "")), "other");

// 2. 按手机本地日分组：UTC 16:30 已是东八区次日 00:30
const letters = [
  L(1, "greeting", "2026-10-13T13:30:00Z"),            // 10-13 21:30
  L(2, "reminder", "2026-10-13T16:10:00Z"),            // 10-14 00:10
  L(3, "scene_invite", "2026-10-14T01:30:00+00:00"),   // 10-14 09:30
  L(4, "proactive", "2026-10-14T00:00:00"),            // 无时区 → 按 UTC → 10-14 08:00
  L(5, "weekly", "坏时间"),
];
const days = groupLettersByDay(letters);
assert.deepEqual(days.map((d) => d.key), ["2026-10-14", "2026-10-13", "0000-01-01"], "新的一天在前，坏时间不丢、排最后");
assert.deepEqual(days[0].letters.map((l) => l.id), [3]);
assert.deepEqual(days[0].notes.map((l) => l.id), [4, 2], "小纸条单独一叠，新的在前");
assert.deepEqual(days[1].letters.map((l) => l.id), [1]);

// 3. 分组标题与时间
const now = new Date("2026-10-14T12:00:00+08:00");
assert.equal(dayLabel("2026-10-14", now), "今天 · 10月14日 周三");
assert.equal(dayLabel("2026-10-13", now), "昨天 · 10月13日 周二");
assert.equal(dayLabel("2026-10-12", now), "10月12日 周一");
assert.equal(dayLabel("2025-12-31", now), "2025年12月31日 周三");
assert.equal(letterClock(letters[0]), "21:30");
assert.equal(_fmtLetterDate("2026-10-13T13:30:00"), "10月13日 · 周二 21:30");
assert.equal(letterListTime("2026-10-14T01:30:00Z", now), "今天 09:30");
assert.equal(dayKey(new Date("2026-10-13T16:10:00Z")), "2026-10-14");

// 4. 搜索：标题或正文，忽略空白与大小写
const hit = L(9, "greeting", "", { title: "晚风 吹凉了", body: "Hello 杭州" });
assert.ok(matchLetter(hit, "晚风吹"));
assert.ok(matchLetter(hit, "hello杭"));
assert.ok(!matchLetter(hit, "北京"));
assert.ok(matchLetter(hit, "  "), "空关键词全部命中");

// 5. 有句话结构：至少一句开口才算，否则退回读正文
assert.equal(rehearsalOf(L(1, "scene_invite", "", { attachment: { rehearsal: { openers: [] } } })), null);
assert.equal(rehearsalOf(L(1, "scene_invite", "")), null);
assert.ok(rehearsalOf(L(1, "scene_invite", "", { attachment: { rehearsal: { openers: ["妈"], replies: [] } } })));

// 6. 整理：筛选后的可见集合、勾选、全选、乐观删除与回滚
const mixed = [
  L(11, "greeting", "2026-10-13T13:30:00Z", { is_read: false }),
  L(12, "weekly", "2026-10-13T14:30:00Z"),
  L(13, "reminder", "2026-10-13T15:30:00Z", { is_read: false }),
  L(14, "scene_invite", "2026-10-12T01:30:00Z", { is_read: false }),
];
const mDays = groupLettersByDay(mixed);
assert.deepEqual(idsOfDays(shownDays(mDays, "all")).sort(), [11, 12, 13, 14]);
assert.deepEqual(idsOfDays(shownDays(mDays, "weekly")), [12], "按类筛选后只剩这一类");
assert.deepEqual(idsOfDays(shownDays(mDays, "note")), [13], "筛小纸条时纸条逐张列出");
assert.deepEqual(shownDays(mDays, "other"), [], "没有的类别不留空分组");

let sel = new Set();
sel = toggleId(sel, 11);
assert.deepEqual([...sel], [11]);
assert.deepEqual([...toggleId(sel, 11)], [], "再点一次取消");
assert.deepEqual([...sel], [11], "toggleId 不改原集合");
const vis = idsOfDays(shownDays(mDays, "all"));
assert.equal(isAllSelected(vis, sel), false);
assert.equal(isAllSelected([], new Set()), false, "空列表不算全选");
sel = toggleSelectAll(vis, sel);
assert.equal(sel.size, 4);
assert.equal(isAllSelected(vis, sel), true);
assert.equal(toggleSelectAll(vis, sel).size, 0, "全选后再点 = 取消全选");
assert.deepEqual([...pruneSelection(new Set([11, 99]), mixed)], [11], "已不存在的 id 从选中里去掉");

const gone = new Set([11, 13]);
const left = removeLetters(mixed, gone);
assert.deepEqual(left.map((l) => l.id), [12, 14]);
const back = restoreLetters(left, mixed.filter((l) => gone.has(l.id)));
assert.deepEqual(back.map((l) => l.id), [14, 13, 12, 11], "回滚后恢复，新的（id 大的）在前");
assert.deepEqual(restoreLetters(mixed, mixed).map((l) => l.id), [14, 13, 12, 11], "重复放回不产生重复");

// 一键清理的时间界：最新一封之后 1 秒；没有信、坏时间都返回 null
assert.equal(clearBefore(mixed), "2026-10-13T15:30:01.000Z");
assert.equal(clearBefore([]), null);
assert.equal(clearBefore([L(1, "greeting", "坏时间")]), null);

// 全部已读：乐观更新与回滚只动原本没读的
assert.equal(unreadCountOf(mixed), 3);
const readAll = markAllReadLocal(mixed);
assert.equal(unreadCountOf(readAll), 0);
assert.equal(unreadCountOf(mixed), 3, "不改原数组");
assert.equal(readAll[1], mixed[1], "本来就读过的不重建对象");
assert.deepEqual(revertRead(readAll, new Set([11, 14])).filter((l) => !l.is_read).map((l) => l.id), [11, 14]);

// 确认文案：写清数量与后果
assert.match(deleteSelectedConfirm(3).title, /3 封/);
assert.match(deleteSelectedConfirm(3).body, /我留下的/);
assert.match(clearAllConfirm(43).title, /43 封/);
assert.match(clearAllConfirm(43).body, /我留下的.*不受影响/);
assert.doesNotMatch(clearAllConfirm(100).title, /100/, "满页时不报具体数字");

console.log("mailbox groups: all assertions passed");
