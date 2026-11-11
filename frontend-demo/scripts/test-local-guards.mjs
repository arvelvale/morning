// 本地模式的源码守卫：补充测试，防止以后改动悄悄让本地模式把数据发到服务器。
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
  const rel = dir + "/" + n;
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
});

const api = read("api.ts");
assert.match(api, /isLocalMode\(\) && !path\.startsWith\("\/api\/v1\/app\/"\)/, "普通请求：本地模式只放行版本检查去服务器");
assert.match(api, /if \(!isLocalMode\(\)\) return remoteStreamSSE/, "流式请求：本地模式不走服务器");
assert.equal((api.match(/remoteStreamSSE\(/g) ?? []).length, 1, "只有这一处能发起服务器 SSE");
assert.match(api, /if \(isLocalMode\(\)\) \{\s*\/\/ 本地模式：手机直接去问模型服务商/, "测试密钥：本地模式不发给服务器");
assert.match(api, /access_token === LOCAL_TOKENS\.access_token\) return/, "本地占位令牌不落盘");
assert.match(api, /path\.startsWith\("file:\/\/"\)\) return \{ uri: path, headers: \{\} \}/, "本地图片不带令牌");

// 本地运行时的代码里不能出现服务器地址，也不能打日志
for (const file of walk("local").filter((f) => /\.(ts|tsx)$/.test(f))) {
  const text = read(file);
  assert.doesNotMatch(text, /API_BASE|223\.109\.142\.152|morning-site/, file + "：本地运行时不能依赖喵灵服务器");
  assert.doesNotMatch(text, /console\.(log|warn|error|info|debug)/, file + "：本地运行时不打日志（数据和密钥都在里面）");
}

// 模型服务商只能是这两家的 https 地址
const llm = read("local/llm.ts");
const urls = [...llm.matchAll(/"(https?:\/\/[^"]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(urls, ["https://api.deepseek.com", "https://api.stepfun.com/v1"]);

// 本地模式的开关只存本机，不进后端偏好
const mode = read("localMode.ts");
assert.match(mode, /AsyncStorage/);
assert.doesNotMatch(mode, /updatePreferences|\/api\/v1\/preferences/);

// 记忆隐私红线：米露主动路径不得打开 userInitiated；它只在聊天里的 memoryContextFor 出现
const withUserInitiated = walk("local").filter((f) => /\.ts$/.test(f) && /userInitiated\s*:\s*true/.test(read(f)));
assert.deepEqual(withUserInitiated, ["local/handlers/conversations.ts"], "只有聊天（用户发起）可以放行脆弱记忆");
// 聊天里的图片不进记忆：提取只看文字
const chatSrc = read("local/handlers/conversations.ts");
assert.match(chatSrc, /captureChatTodos\([^)]*\},\s*text\)/, "聊天记待办只传文字");
// 所有写记忆的路径都经过 memoryStore（保证历史落库），其它文件不直接写 memory_items
for (const f of walk("local").filter((f) => /\.ts$/.test(f) && f !== "local/memoryStore.ts" && f !== "local/schema.ts")) {
  assert.doesNotMatch(read(f), /(INSERT INTO|DELETE FROM) memory_items|UPDATE memory_items SET (content|is_latest|is_forgotten)/, f + "：不要绕过 memoryStore 直接写记忆");
}
// 更新 expires_at（保留寄存）是唯一允许在 handler 里直接改的记忆列
assert.match(read("local/handlers/memories.ts"), /UPDATE memory_items SET expires_at = NULL/);

console.log("PASS local mode source guards");
