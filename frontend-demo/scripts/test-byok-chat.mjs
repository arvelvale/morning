import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEADER_DEEPSEEK, HEADER_STEPFUN, MAX_KEY_LEN, allProvidedOk, hasAnyKey, isSecureApiBase,
  keyHeaders, keyProblem, maskKey, normalizeKey, testMessage,
} from "../src/modelKeysPolicy.ts";
import {
  FALLBACK_SIDE, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, MAX_SIDE, base64Bytes, fitWithin, sseErrorDetail,
} from "../src/chatImages.ts";

const STEP = "step-key-abcdefgh12345678";
const DS = "sk-deepseek-abcdefgh1234";

// ── 密钥格式 ──
assert.equal(normalizeKey("  " + STEP + "\n"), STEP, "粘贴时带的空白和换行要去掉");
assert.equal(keyProblem(""), null, "没填不算错");
assert.equal(keyProblem(STEP), null);
assert.match(keyProblem("short"), /太短/);
assert.match(keyProblem("a".repeat(MAX_KEY_LEN + 1)), /太长/);
assert.match(keyProblem("sk-abc def-ghijk"), /空格/);
assert.match(keyProblem("密钥密钥密钥密钥密钥"), /字符/);
assert.equal(hasAnyKey({ stepfun: "", deepseek: "" }), false);
assert.equal(hasAnyKey({ stepfun: " ", deepseek: DS }), true);

// ── 只在加密连接上发密钥 ──
assert.equal(isSecureApiBase("https://api.example.com"), true);
assert.equal(isSecureApiBase("https://223.109.142.152:8443"), true);
assert.equal(isSecureApiBase("http://223.109.142.152:8000"), false, "线上明文地址：不能发");
assert.equal(isSecureApiBase("http://192.168.1.8:8000"), false, "局域网明文：默认也不能发");
assert.equal(isSecureApiBase("http://192.168.1.8:8000", true), true, "显式打开联调开关才行");
for (const local of ["http://localhost:8000", "http://127.0.0.1:8000", "http://10.0.2.2:8000"]) {
  assert.equal(isSecureApiBase(local), true, `${local} 不出手机，可以发`);
}
assert.equal(isSecureApiBase("ftp://x"), false);
assert.equal(isSecureApiBase(""), false);
assert.equal(isSecureApiBase("http://localhost.evil.com"), false, "不能被形似 localhost 的域名骗过");

// ── 请求头 ──
assert.deepEqual(keyHeaders({ stepfun: STEP, deepseek: DS }, true), { [HEADER_STEPFUN]: STEP, [HEADER_DEEPSEEK]: DS });
assert.deepEqual(keyHeaders({ stepfun: STEP, deepseek: "" }, true), { [HEADER_STEPFUN]: STEP });
assert.deepEqual(keyHeaders({ stepfun: STEP, deepseek: DS }, false), {}, "连接没加密：一把都不发");
assert.deepEqual(keyHeaders({ stepfun: "bad key with space", deepseek: "" }, true), {}, "格式不对的不发");
assert.deepEqual(keyHeaders({ stepfun: "", deepseek: "" }, true), {});

// ── 显示与测试结果 ──
assert.equal(maskKey(STEP), "step••••5678");
assert.equal(maskKey("12345678"), "••••", "太短的整个遮住");
assert.equal(maskKey(""), "");
assert.ok(!maskKey(STEP).includes("abcdefgh"), "遮罩后不能露出中间部分");
const ok = { provided: true, ok: true, reason: null };
const bad = { provided: true, ok: false, reason: "invalid_key" };
const none = { provided: false, ok: false, reason: null };
assert.equal(allProvidedOk({ stepfun: ok, deepseek: none }), true);
assert.equal(allProvidedOk({ stepfun: ok, deepseek: bad }), false, "填了的都要通过");
assert.equal(allProvidedOk({ stepfun: none, deepseek: none }), false, "一把都没填不算通过");
assert.match(testMessage("阶跃星辰", bad), /不对|失效/);
assert.match(testMessage("阶跃星辰", { provided: true, ok: false, reason: "no_balance" }), /余额/);
assert.match(testMessage("阶跃星辰", { provided: true, ok: false, reason: "timeout" }), /连不上/);
assert.match(testMessage("阶跃星辰", { provided: true, ok: true, reason: "rate_limited" }), /可用/);
assert.equal(testMessage("阶跃星辰", none), "");

// ── 聊天图片 ──
assert.equal(MAX_IMAGES_PER_MESSAGE, 3);
assert.equal(MAX_IMAGE_BYTES, 1_500_000, "与后端 chat_images.MAX_IMAGE_BYTES 一致");
assert.ok(FALLBACK_SIDE < MAX_SIDE);
assert.deepEqual(fitWithin(4000, 3000, 1280), { width: 1280 }, "横图按宽缩");
assert.deepEqual(fitWithin(3000, 4000, 1280), { height: 1280 }, "竖图按高缩");
assert.equal(fitWithin(800, 600, 1280), null, "本来就小的不放大");
assert.equal(fitWithin(1280, 1280, 1280), null);
assert.equal(fitWithin(0, 0, 1280), null);
assert.equal(base64Bytes(""), 0);
assert.equal(base64Bytes(Buffer.from("a").toString("base64")), 1);
assert.equal(base64Bytes(Buffer.from("ab").toString("base64")), 2);
assert.equal(base64Bytes(Buffer.alloc(1000).toString("base64")), 1000);
assert.equal(sseErrorDetail(new Error('{"detail":"图片太大了，换一张小一点的"}')), "图片太大了，换一张小一点的");
assert.equal(sseErrorDetail(new Error('{"detail":[{"msg":"字段不对"}]}')), "字段不对");
assert.equal(sseErrorDetail(new Error("SSE 请求失败 (500)")), null);
assert.equal(sseErrorDetail(null), null);

// ── 源码守卫（补充真机测试；不能证明运行行为）──
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const keys = read("../src/modelKeys.ts");
const api = read("../src/api.ts");
const notif = read("../src/notifications.ts");
const chat = read("../src/screens/companion/CompanionChat.tsx");
const backendKeys = read("../../backend/app/llm_keys.py");
const backendImages = read("../../backend/app/services/companion/chat_images.py");

assert.match(keys, /expo-secure-store/, "密钥要放系统安全存储");
assert.doesNotMatch(keys, /async-storage|AsyncStorage\.(set|get)Item/, "密钥不能放 AsyncStorage 明文");
assert.doesNotMatch(keys, /console\.(log|warn|error)/, "密钥模块不打日志");
assert.match(api, /\.\.\.ownKeyHeaders\(API_BASE\)/, "请求头统一从 ownKeyHeaders 取（它会判断连接是否加密）");
assert.ok(backendKeys.includes(`b"${HEADER_STEPFUN.toLowerCase()}"`), "请求头名要和后端一致（阶跃）");
assert.ok(backendKeys.includes(`b"${HEADER_DEEPSEEK.toLowerCase()}"`), "请求头名要和后端一致（DeepSeek）");
assert.match(backendImages, /MAX_IMAGE_BYTES = 1_500_000/, "图片大小上限前后端一致");
assert.match(backendImages, /MAX_IMAGES_PER_MESSAGE = 3/, "图片张数上限前后端一致");
assert.match(notif, /usingOwnKeys\(\)\) await tickOwnKeyJobs\(\)/, "自带密钥时轮询要顺带触发定时活");
assert.match(notif, /await loadModelKeys\(\)/, "无头任务里要先把密钥读进内存");
assert.match(chat, /detectSceneIntent\(text, "chat"\)/, "文字聊天用带关键词粗筛的识别");
assert.match(chat, /takeChatPhoto/, "聊天里要有拍照入口");
assert.match(read("../src/chatImagePicker.ts"), /requestCameraPermissionsAsync/, "拍照前要先申请相机权限");
assert.match(read("../android/app/src/main/AndroidManifest.xml"), /android\.permission\.CAMERA"\/>/, "清单里要声明相机权限");
assert.match(chat, /if \(replyDone\)/, "邀请卡片等回复说完再出现");
for (const f of ["../src/useRealtimeCall.ts", "../src/useVoiceInput.ts"]) {
  assert.match(read(f), /wsKeyOptions\(\)/, `${f}: 语音转写的 WebSocket 要带上自带密钥`);
}
console.log("PASS byok keys policy, chat images, scene invite and source guards");
