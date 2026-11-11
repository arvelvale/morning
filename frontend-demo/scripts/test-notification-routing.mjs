import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIONS, CATEGORIES, CATEGORY_ACTIONS, CHANNELS,
  channelForLetter, openTargetFor, parseNotificationData,
} from "../src/notificationChannels.ts";
import { COMPANION_DEFAULTS, applyPatch, normalizeSettings } from "../src/companionSettings.ts";

// ── 频道：来信类型 → 频道 ──
assert.equal(channelForLetter("greeting"), "letters", "晚间信");
assert.equal(channelForLetter("weekly"), "letters", "周报");
assert.equal(channelForLetter("scene_invite"), "rehearse", "有句话单独一个频道，才能被单独静音");
assert.equal(channelForLetter("proactive"), "companion");
assert.equal(channelForLetter("reminder"), "companion");
assert.equal(channelForLetter(undefined), "letters");
assert.equal(channelForLetter("something-new"), "letters", "未知类型落到来信");

// ── 频道定义：id 不重复；已发布的 id 与级别不能变；待办要弹出 ──
const ids = Object.values(CHANNELS).map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, "频道 id 不能重复");
assert.equal(CHANNELS.letters.id, "morning-letters", "已发布频道 id 不能换");
assert.equal(CHANNELS.letters.importance, "default", "已发布频道级别不能改（用户调过的 App 也改不回来）");
assert.equal(CHANNELS.todo.importance, "high", "待办提醒要弹出来");
assert.equal(CHANNELS.rehearse.vibrate, false, "有句话不振动");

// ── 快捷操作：每个类别的按钮 id 唯一，并且都在 ACTIONS 里 ──
const known = new Set(Object.values(ACTIONS));
for (const [cat, actions] of Object.entries(CATEGORY_ACTIONS)) {
  assert.ok(actions.length >= 1 && actions.length <= 3, `${cat}: 安卓通知最多显示 3 个按钮`);
  for (const a of actions) {
    assert.ok(known.has(a.identifier), `${cat}: ${a.identifier} 未登记`);
    assert.ok(a.buttonTitle.length <= 8, `${cat}: 按钮文字要短（${a.buttonTitle}）`);
  }
}
assert.deepEqual(Object.keys(CATEGORY_ACTIONS).sort(), Object.values(CATEGORIES).sort());

// ── 通知数据解析与点击去向 ──
assert.deepEqual(parseNotificationData({ letterId: 12, type: "greeting" }), { kind: "letter", letterId: 12 });
assert.deepEqual(parseNotificationData({ letterId: "12" }), { kind: "letter", letterId: 12 }, "字符串 id 也认");
assert.deepEqual(parseNotificationData({ type: "todo_reminder", todoId: 7 }), { kind: "todo", todoId: 7 });
assert.deepEqual(parseNotificationData({ type: "todo_reminder" }), { kind: "todo", todoId: null }, "旧版本排的待办提醒没有 todoId");
assert.equal(parseNotificationData(null), null);
assert.equal(parseNotificationData({ foo: 1 }), null);
assert.equal(openTargetFor({ letterId: 1 }), "mailbox");
assert.equal(openTargetFor({ type: "todo_reminder", todoId: 1 }), "todos");
assert.equal(openTargetFor({}), null);

// ── 常驻 / 悬浮开关：悬浮依附常驻 ──
assert.deepEqual(COMPANION_DEFAULTS, { companion: true, overlay: false }, "常驻默认开、悬浮默认关");
assert.deepEqual(normalizeSettings(null), COMPANION_DEFAULTS);
assert.deepEqual(normalizeSettings({ companion: false, overlay: true }), { companion: false, overlay: false }, "常驻关则悬浮也关");
assert.deepEqual(applyPatch({ companion: false, overlay: false }, { overlay: true }), { companion: true, overlay: true }, "开悬浮顺带开常驻");
assert.deepEqual(applyPatch({ companion: true, overlay: true }, { companion: false }), { companion: false, overlay: false }, "关常驻顺带关悬浮");

// ── 源码守卫（补充真机测试；不能证明安卓运行行为）──
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const notif = read("../src/notifications.ts");
const poll = read("../modules/morning-companion/android/src/main/java/com/morning/companion/LetterPollTaskService.kt");
const service = read("../modules/morning-companion/android/src/main/java/com/morning/companion/CompanionForegroundService.kt");
const manifest = read("../modules/morning-companion/android/src/main/AndroidManifest.xml");
const taskKey = /TASK_KEY = "([^"]+)"/.exec(poll)?.[1];
assert.ok(taskKey, "LetterPollTaskService 要声明 TASK_KEY");
assert.ok(notif.includes(`"${taskKey}"`), "JS 无头任务名要和原生 TASK_KEY 一致");
assert.match(notif, /registerHeadlessTask/);
assert.match(notif, /addNotificationResponseReceivedListener/, "通知按钮的响应要在模块加载时就订阅");
assert.match(notif, /opensAppToForeground:\s*false/, "快捷按钮不打开 App");
assert.doesNotMatch(notif, /trigger:\s*null/, "来信通知必须指定频道，不能落到 expo 默认频道");
assert.match(service, /LetterPollTaskService/, "常驻服务要定时拉起无头拉信任务");
assert.match(service, /POLL_IDLE_MS/, "息屏要放慢拉信频率");
for (const piece of ["LetterPollTaskService", "BootReceiver", "SYSTEM_ALERT_WINDOW", "RECEIVE_BOOT_COMPLETED", "WAKE_LOCK"]) {
  assert.ok(manifest.includes(piece), `AndroidManifest 缺 ${piece}`);
}
console.log("PASS notification routing, companion settings and source guards");
