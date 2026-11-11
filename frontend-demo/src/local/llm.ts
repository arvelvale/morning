/**
 * 模型客户端：后端 app/llm.py 的移植。路由（阶跃优先、DeepSeek 备用）+ 看图 + 流式。
 *
 * 规则与后端逐条对齐（黄金对照见 scripts/fixtures/llm-fallback.json）：
 * - 401/402/403/404/408/409/429、5xx、超时、连不上、没有 key → 换路；其余 4xx（请求本身有问题）不换。
 * - 流式只在“一个字都还没吐”时换路；吐到一半断了就抛错，不接别家的话。
 * - DeepSeek 看不了图：换路时图片换成占位句；reasoning_effort 对 DeepSeek 去掉。
 * - 有备用路由时第一条路只重试 1 次，没有则 5 次（429/5xx 指数退避）。
 */
import { IMAGE_PLACEHOLDER } from "./generated/petPresets.ts";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
}

export interface ModelKeys {
  stepfun: string;
  deepseek: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 阶跃专有；DeepSeek 路会去掉。 */
  reasoningEffort?: "low" | "medium" | "high";
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 覆盖每条路的重试次数（聊天待办识别要快：0 次）。不给就按默认规则。 */
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface ModelClient {
  /** 完整回复（非流式）。 */
  complete(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  /** 逐段增量。 */
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<string>;
}

export class LLMError extends Error {
  status: number | null;
  /** connection | timeout | status | key_missing */
  kind: string;
  constructor(kind: string, status: number | null, message: string) {
    super(message);
    this.name = "LLMError";
    this.kind = kind;
    this.status = status;
  }
}

export class LLMKeyMissing extends LLMError {
  constructor(provider = "any") {
    super("key_missing", null, provider === "any" ? "没有可用的模型密钥" : "没有可用的 " + provider + " 密钥");
    this.name = "LLMKeyMissing";
  }
}

const FALLBACK_STATUS = new Set([401, 402, 403, 404, 408, 409, 429]);

/** 这个错误值不值得换一条路再试。 */
export function shouldFallback(error: unknown): boolean {
  if (error instanceof LLMKeyMissing) return true;
  if (!(error instanceof LLMError)) return false;
  if (error.kind === "connection" || error.kind === "timeout") return true;
  if (error.kind === "status" && error.status != null) {
    return FALLBACK_STATUS.has(error.status) || error.status >= 500;
  }
  return false;
}

export function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const texts: string[] = [];
    let hadImage = false;
    for (const part of m.content) {
      if (part.type === "text") texts.push(part.text || "");
      else if ((part as any).type === "image_url" || (part as any).type === "image") hadImage = true;
    }
    if (hadImage) texts.push(IMAGE_PLACEHOLDER);
    return { ...m, content: texts.filter(Boolean).join("\n") };
  });
}

export interface Provider {
  name: "stepfun" | "deepseek";
  baseUrl: string;
  model: string;
  key: string;
}

export const STEPFUN_BASE_URL = "https://api.stepfun.com/v1";
export const STEPFUN_TEXT_MODEL = "step-3.7-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-chat";

export function buildProviders(keys: ModelKeys): Provider[] {
  const providers: Provider[] = [];
  if (keys.stepfun) {
    providers.push({ name: "stepfun", baseUrl: STEPFUN_BASE_URL, model: STEPFUN_TEXT_MODEL, key: keys.stepfun });
  }
  if (keys.deepseek) {
    providers.push({ name: "deepseek", baseUrl: DEEPSEEK_BASE_URL, model: DEEPSEEK_MODEL, key: keys.deepseek });
  }
  return providers;
}

/** fetch 的最小形状：线上用 expo/fetch（能流式读 body），测试里注入假的。 */
export type FetchLike = (url: string, init: any) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}>;

export interface ClientDeps {
  fetch: FetchLike;
  keys: () => ModelKeys;
  sleep?: (ms: number) => Promise<void>;
  /** 测试里可以把退避等待压到 0。 */
  backoffMs?: (attempt: number) => number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const RETRIES_WITH_FALLBACK = 1;
const DEFAULT_RETRIES = 5;
const DEEPSEEK_RETRIES = 2;

function requestBody(provider: Provider, messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: provider.name === "deepseek" ? stripImages(messages) : messages,
    stream,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
  if (opts.reasoningEffort && provider.name !== "deepseek") body.reasoning_effort = opts.reasoningEffort;
  return body;
}

/** 能重试的：连接/超时、限流、服务端错误（与 openai SDK 的自动重试一致）。 */
function retryable(error: LLMError): boolean {
  if (error.kind === "connection" || error.kind === "timeout") return true;
  const s = error.status;
  return error.kind === "status" && s != null && (s === 408 || s === 409 || s === 429 || s >= 500);
}

export function createModelClient(deps: ClientDeps): ModelClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = deps.backoffMs ?? ((attempt: number) => Math.min(8000, 500 * 2 ** attempt));

  async function open(provider: Provider, messages: ChatMessage[], opts: ChatOptions, stream: boolean, retries: number) {
    let lastError: LLMError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt - 1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const res = await deps.fetch(provider.baseUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + provider.key,
            ...(stream ? { Accept: "text/event-stream" } : {}),
          },
          body: JSON.stringify(requestBody(provider, messages, opts, stream)),
          signal: controller.signal,
        });
        if (!res.ok) {
          // 只带状态码，不带响应正文：正文里可能回显用户内容或密钥片段
          throw new LLMError("status", res.status, provider.name + " 返回 " + res.status);
        }
        return { res, clear: () => clearTimeout(timer) };
      } catch (error: any) {
        clearTimeout(timer);
        lastError = error instanceof LLMError
          ? error
          : error?.name === "AbortError"
            ? new LLMError("timeout", null, provider.name + " 超时")
            : new LLMError("connection", null, provider.name + " 连不上");
        if (opts.signal?.aborted || !retryable(lastError)) throw lastError;
      }
    }
    throw lastError!;
  }

  function retriesFor(provider: Provider, hasFallback: boolean, override?: number): number {
    if (override !== undefined) return override;
    return provider.name === "deepseek" ? DEEPSEEK_RETRIES : hasFallback ? RETRIES_WITH_FALLBACK : DEFAULT_RETRIES;
  }

  return {
    async complete(messages, opts = {}) {
      const providers = buildProviders(deps.keys());
      if (!providers.length) throw new LLMKeyMissing();
      for (let i = 0; i < providers.length; i++) {
        try {
          const { res, clear } = await open(providers[i], messages, opts, false, retriesFor(providers[i], providers.length > 1, opts.maxRetries));
          try {
            const data = await res.json();
            return String(data?.choices?.[0]?.message?.content ?? "");
          } finally {
            clear();
          }
        } catch (error) {
          if (i === providers.length - 1 || !shouldFallback(error)) throw error;
        }
      }
      throw new LLMKeyMissing();
    },

    async *stream(messages, opts = {}) {
      const providers = buildProviders(deps.keys());
      if (!providers.length) throw new LLMKeyMissing();
      for (let i = 0; i < providers.length; i++) {
        let started = false;
        try {
          const { res, clear } = await open(providers[i], messages, opts, true, retriesFor(providers[i], providers.length > 1, opts.maxRetries));
          try {
            if (!res.body) throw new LLMError("connection", null, providers[i].name + " 没有返回数据流");
            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buf = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let sep: number;
              while ((sep = buf.indexOf("\n\n")) !== -1) {
                const frame = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                for (const delta of parseDeltas(frame)) {
                  started = true;
                  yield delta;
                }
              }
            }
            for (const delta of parseDeltas(buf)) {
              started = true;
              yield delta;
            }
            return;
          } finally {
            clear();
          }
        } catch (error) {
          if (started || i === providers.length - 1 || !shouldFallback(error)) throw error;
        }
      }
    },
  };
}

/** 一个 SSE 帧里的增量文本（OpenAI 兼容格式）。[DONE] 和空增量忽略。 */
export function parseDeltas(frame: string): string[] {
  const out: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) out.push(delta);
    } catch {
      /* 半截帧或心跳，跳过 */
    }
  }
  return out;
}
