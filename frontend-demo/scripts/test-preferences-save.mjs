import assert from "node:assert/strict";
import { saveConfirmedPreferences } from "../src/preferencesSave.ts";

let prefs = { evening_letter_enabled: true, evening_letter_time: "21:30" };
let resolve;
const pending = new Promise(r => { resolve = r; });
const save = saveConfirmedPreferences({ evening_letter_enabled: false }, async patch => {
  assert.deepEqual(patch, { evening_letter_enabled: false });
  return pending;
}, saved => { prefs = saved; });
assert.equal(prefs.evening_letter_enabled, true, "请求未确认不能先显示已关闭");
resolve({ evening_letter_enabled: false, evening_letter_time: "21:30" });
await save;
assert.equal(prefs.evening_letter_enabled, false, "保存确认后才关闭");
await assert.rejects(saveConfirmedPreferences({ evening_letter_enabled: true }, async () => {
  throw new Error("offline");
}, saved => { prefs = saved; }), /offline/);
assert.equal(prefs.evening_letter_enabled, false, "网络失败不改界面状态");
await saveConfirmedPreferences({ evening_letter_enabled: true }, async () => ({ ...prefs, evening_letter_enabled: true }), saved => { prefs = saved; });
assert.equal(prefs.evening_letter_enabled, true, "失败后可再次保存");
assert.equal(prefs.evening_letter_time, "21:30", "开关不改原来时间");
console.log("PASS preferences: wait for confirmation / failure preserves state / retry / time unchanged");
