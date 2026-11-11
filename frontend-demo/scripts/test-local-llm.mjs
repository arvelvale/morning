// 本地模型客户端与提示词组装：和后端逐字/逐条对齐，并覆盖路由、回退、流式、看图。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { IMAGE_PLACEHOLDER } from "../src/local/generated/petPresets.ts";
import {
  LLMError, LLMKeyMissing, buildProviders, createModelClient, parseDeltas, shouldFallback, stripImages,
} from "../src/local/llm.ts";
import { buildCompanionMessages, buildEnvContext } from "../src/local/prompts.ts";
import { fakeFetch, rejects } from "./local-test-kit.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));

// ── 提示词：和后端 _build_messages 的真实输出逐字一致 ──
for (const c of fixture("companion-messages.json")) {
  const i = c.input;
  const got = buildCompanionMessages(i.mode, i.history, {
    fragmentContext: i.fragment_context, memoryContext: i.memory_context, petPrompt: i.pet_prompt, envContext: i.env_context,
  });
  assert.deepEqual(got, c.output, "提示词与后端不一致：" + c.name);
}

// ── 换路判定：和后端 should_fallback 的判定表一致 ──
const table = fixture("llm-fallback.json");
for (const c of table.cases) {
  const error =
    c.kind === "status" ? new LLMError("status", c.status, "x")
    : c.kind === "connection" ? new LLMError("connection", null, "x")
    : c.kind === "timeout" ? new LLMError("timeout", null, "x")
    : c.kind === "key_missing" ? new LLMKeyMissing("stepfun")
    : new Error("x");
  assert.equal(shouldFallback(error), c.fallback, "换路判定不一致：" + JSON.stringify(c));
}

// ── 环境上下文 ──
assert.equal(
  buildEnvContext(new Date(2026, 10, 11, 22, 5), "杭州", { condition: "多云", temperature: 12 }),
  "现在是 11 月 11 日晚上 22 点左右，用户在杭州，天气多云、气温 12°C。",
);
assert.equal(buildEnvContext(new Date(2026, 10, 11, 3, 0), null), "现在是 11 月 11 日凌晨 3 点左右。");

// ── 图片去除 ──
const withImage = [{ role: "user", content: [{ type: "text", text: "看看" }, { type: "image_url", image_url: { url: "data:x" } }] }];
assert.deepEqual(stripImages(withImage), [{ role: "user", content: "看看\n" + IMAGE_PLACEHOLDER }]);
assert.deepEqual(stripImages([{ role: "user", content: "纯文字" }]), [{ role: "user", content: "纯文字" }]);
assert.equal(withImage[0].content.length, 2, "不改原对象");

// ── provider 组装 ──
assert.deepEqual(buildProviders({ stepfun: "", deepseek: "" }), []);
assert.deepEqual(buildProviders({ stepfun: "a", deepseek: "b" }).map((p) => p.name), ["stepfun", "deepseek"]);
assert.deepEqual(buildProviders({ stepfun: "", deepseek: "b" }).map((p) => p.name), ["deepseek"]);

// ── SSE 帧解析 ──
assert.deepEqual(parseDeltas('data: {"choices":[{"delta":{"content":"你"}}]}\n'), ["你"]);
assert.deepEqual(parseDeltas("data: [DONE]"), []);
assert.deepEqual(parseDeltas('data: {"choices":[{"delta":{}}]}'), [], "空增量忽略");
assert.deepEqual(parseDeltas("data: {半截"), [], "坏帧跳过");

const MSG = [{ role: "user", content: "你好" }];
const BOTH = { stepfun: "step-key-123456", deepseek: "ds-key-123456" };
const client = (script, keys = BOTH) => {
  const fetch = fakeFetch(script);
  return { fetch, model: createModelClient({ fetch, keys: () => keys, backoffMs: () => 0 }) };
};
const collect = async (it) => { const out = []; for await (const d of it) out.push(d); return out; };

// ── 非流式：正常 / 请求体 ──
{
  const { fetch, model } = client([{ content: "嗨" }]);
  assert.equal(await model.complete(MSG, { temperature: 0.7, reasoningEffort: "low" }), "嗨");
  const call = fetch.calls[0];
  assert.equal(call.url, "https://api.stepfun.com/v1/chat/completions");
  assert.equal(call.headers.Authorization, "Bearer step-key-123456");
  assert.equal(call.body.model, "step-3.7-flash");
  assert.equal(call.body.reasoning_effort, "low");
  assert.equal(call.body.stream, false);
}

// ── 阶跃限流 → 重试 1 次后换 DeepSeek（有备用路由时只重试 1 次）；DeepSeek 路去掉 reasoning_effort 与图片 ──
{
  const { fetch, model } = client([{ status: 429 }, { status: 429 }, { content: "备用回复" }]);
  const text = await model.complete(
    [{ role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:i" } }] }],
    { reasoningEffort: "low" },
  );
  assert.equal(text, "备用回复");
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[0].url.startsWith("https://api.stepfun.com"), true);
  assert.equal(fetch.calls[2].url, "https://api.deepseek.com/chat/completions");
  assert.equal(fetch.calls[2].headers.Authorization, "Bearer ds-key-123456");
  assert.equal("reasoning_effort" in fetch.calls[2].body, false, "DeepSeek 不认 reasoning_effort");
  assert.equal(fetch.calls[2].body.messages[0].content, "看图\n" + IMAGE_PLACEHOLDER, "DeepSeek 看不了图");
  assert.ok(Array.isArray(fetch.calls[0].body.messages[0].content), "阶跃那路仍带图片");
}

// ── 没有备用路由时重试 5 次（共 6 次请求）才放弃 ──
{
  const { fetch, model } = client(Array(6).fill({ status: 503 }), { stepfun: "step-key-123456", deepseek: "" });
  await rejects(model.complete(MSG), (e) => assert.equal(e.status, 503));
  assert.equal(fetch.calls.length, 6);
  assert.equal(fetch.remaining(), 0);
}

// ── 请求本身有问题（400/422）：不重试、不换路 ──
for (const status of [400, 422]) {
  const { fetch, model } = client([{ status }]);
  await rejects(model.complete(MSG), (e) => assert.equal(e.status, status));
  assert.equal(fetch.calls.length, 1);
}

// ── key 无效（401）：立刻换路，不重试 ──
{
  const { fetch, model } = client([{ status: 401 }, { content: "ds" }]);
  assert.equal(await model.complete(MSG), "ds");
  assert.equal(fetch.calls.length, 2);
}

// ── 连不上 / 超时：换路 ──
{
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const { model } = client([{ throws: new TypeError("Network request failed") }, { throws: abort }, { content: "ok" }]);
  assert.equal(await model.complete(MSG), "ok");
}

// ── 两条路都失败：抛最后一条路的错误 ──
{
  const { model } = client([{ status: 401 }, { status: 401 }, { status: 401 }]);
  await rejects(model.complete(MSG), (e) => assert.ok(e instanceof LLMError));
}

// ── 没有任何密钥 ──
{
  const { fetch, model } = client([], { stepfun: "", deepseek: "" });
  await rejects(model.complete(MSG), (e) => assert.ok(e instanceof LLMKeyMissing));
  await rejects(collect(model.stream(MSG)), (e) => assert.ok(e instanceof LLMKeyMissing));
  assert.equal(fetch.calls.length, 0, "没有密钥不发任何请求");
}

// ── 只有 DeepSeek 的密钥：只走 DeepSeek ──
{
  const { fetch, model } = client([{ content: "只有备用" }], { stepfun: "", deepseek: "ds-key-123456" });
  assert.equal(await model.complete(MSG), "只有备用");
  assert.equal(fetch.calls[0].url.startsWith("https://api.deepseek.com"), true);
}

// ── 流式：正常 ──
{
  const { fetch, model } = client([{ deltas: ["你", "好", "呀"] }]);
  assert.deepEqual(await collect(model.stream(MSG)), ["你", "好", "呀"]);
  assert.equal(fetch.calls[0].body.stream, true);
  assert.equal(fetch.calls[0].headers.Accept, "text/event-stream");
}

// ── 流式：一个字没吐就失败 → 换路 ──
{
  const { model } = client([{ status: 500 }, { status: 500 }, { deltas: ["备", "用"] }]);
  assert.deepEqual(await collect(model.stream(MSG)), ["备", "用"]);
}

// ── 流式：吐到一半断了 → 抛错，不接别家的话 ──
{
  const { fetch, model } = client([{ deltas: ["你", "好", "呀"], cutAfter: 2 }, { deltas: ["不该出现"] }]);
  const got = [];
  await rejects((async () => { for await (const d of model.stream(MSG)) got.push(d); })(), (e) => assert.ok(e));
  assert.deepEqual(got, ["你", "好"]);
  assert.equal(fetch.calls.length, 1, "不能换路接话");
}

// ── 错误信息不带响应正文和密钥 ──
{
  const { model } = client([{ status: 400, text: "echo step-key-123456 你好" }]);
  await rejects(model.complete(MSG), (e) => {
    assert.ok(!String(e.message).includes("step-key"), "错误信息不能带密钥");
    assert.ok(!String(e.message).includes("你好"), "错误信息不能带响应正文");
  });
}

console.log("PASS local llm: golden prompts, fallback table, routing, streaming, images");
