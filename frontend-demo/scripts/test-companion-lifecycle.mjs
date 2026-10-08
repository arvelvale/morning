import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCompanionTaskQueue } from "../modules/morning-companion/src/serviceTasks.ts";

const enqueue = createCompanionTaskQueue();
const calls = [];
let finishStop;
const stopped = new Promise(resolve => { finishStop = resolve; });
const stop = enqueue(async () => { calls.push("stop"); await stopped; return true; });
const start = enqueue(async () => { calls.push("start"); return true; });
await Promise.resolve();
assert.deepEqual(calls, ["stop"], "initial stop must finish before native start");
finishStop();
assert.deepEqual(await Promise.all([stop, start]), [true, true]);
assert.deepEqual(calls, ["stop", "start"]);
assert.equal(await enqueue(async () => { throw new Error("native unavailable"); }), false);
assert.equal(await enqueue(async () => true), true, "failure must not block subsequent starts");

// Source guards supplement the device test; they do not prove Android lifecycle behavior.
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const service = read("../modules/morning-companion/android/src/main/java/com/morning/companion/CompanionForegroundService.kt");
const module = read("../modules/morning-companion/android/src/main/java/com/morning/companion/MorningCompanionModule.kt");
assert.match(service, /override fun onCreate\(\)[\s\S]*?startInForeground\(\)/);
const stopBody = module.split('AsyncFunction("stopCompanionService")')[1];
assert.match(stopBody, /ctx\.stopService\(/);
assert.doesNotMatch(stopBody, /ctx\.start(?:Foreground)?Service\(/);
assert.match(service, /stopSelfResult\(startId\)/);
console.log("PASS companion lifecycle queue and native source guards");
