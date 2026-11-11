// 本地运行时测试的公用件：node:sqlite 驱动、假 fetch、内存图片仓库。
import { DatabaseSync } from "node:sqlite";

import { createDb } from "../src/local/db.ts";
import { createLocalRuntime } from "../src/local/index.ts";

process.removeAllListeners("warning"); // node:sqlite 的实验性提示

export function nodeSqliteDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return createDb({
    exec: async (sql) => void sqlite.exec(sql),
    run: async (sql, params) => {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    all: async (sql, params) => sqlite.prepare(sql).all(...params).map((row) => ({ ...row })),
  });
}

export function memoryImages() {
  const files = new Map();
  let n = 0;
  return {
    files,
    async save(userId, mime, base64) {
      n += 1;
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const file = String(n).padStart(32, "0") + "." + ext;
      files.set(userId + "/" + file, { mime, base64 });
      return { file, mime };
    },
    async asDataUrl(userId, file, mime) {
      const f = files.get(userId + "/" + file);
      return f ? "data:" + mime + ";base64," + f.base64 : null;
    },
    async remove(userId, list) {
      for (const f of list) files.delete(userId + "/" + f);
    },
    uri: (userId, file) => "file:///images/" + userId + "/" + file,
  };
}

const enc = new TextEncoder();

/** 构造一个 OpenAI 兼容的流式响应体。 */
export function sseBody(deltas, { cutAfter = null } = {}) {
  const frames = deltas.map((d) => "data: " + JSON.stringify({ choices: [{ delta: { content: d } }] }) + "\n\n");
  frames.push("data: [DONE]\n\n");
  let i = 0;
  return {
    getReader: () => ({
      async read() {
        if (cutAfter !== null && i >= cutAfter) throw new Error("连接断了");
        if (i >= frames.length) return { done: true };
        return { done: false, value: enc.encode(frames[i++]) };
      },
    }),
  };
}

/**
 * 假 fetch：按顺序消费 script（每项 { status, deltas?, content?, throws?, cutAfter? }），记录每次请求。
 * script 用完后再请求会报错，防止测试悄悄多打请求。
 */
export function fakeFetch(script) {
  const calls = [];
  const queue = [...script];
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers: init.headers, body });
    const step = queue.shift();
    if (!step) throw new Error("fakeFetch: 脚本用完了，多打了一次请求：" + url);
    if (step.throws) throw step.throws;
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => step.text ?? "",
      json: async () => step.json ?? { choices: [{ message: { content: step.content ?? "" } }] },
      body: step.deltas ? sseBody(step.deltas, { cutAfter: step.cutAfter ?? null }) : null,
    };
  };
  fetch.calls = calls;
  fetch.remaining = () => queue.length;
  return fetch;
}

export async function makeRuntime({ script = [], keys = { stepfun: "step-key-123456", deepseek: "" }, now } = {}) {
  const db = nodeSqliteDb();
  const fetch = fakeFetch(script);
  const images = memoryImages();
  const runtime = await createLocalRuntime({
    db, fetch, keys: () => keys, images,
    now: now ?? (() => new Date("2026-11-11T14:30:00+08:00")),
    backoffMs: () => 0,
  });
  return { runtime, db, fetch, images };
}

export async function rejects(promise, check) {
  try {
    await promise;
  } catch (error) {
    check(error);
    return;
  }
  throw new Error("本应抛错但没有");
}

export const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).toString("base64");
export const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
