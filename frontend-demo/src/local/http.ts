/**
 * 手机里的“虚拟服务器”：把 (method, path, body) 派发给本地处理函数。
 *
 * - 返回值与服务器接口同形（字段名、状态码语义一致），界面不用改。
 * - 流式接口返回 AsyncIterable<LocalEvent>，事件名与服务器 SSE 一致（token / done / todo.saved …）。
 * - 没注册的接口抛 501：本地模式绝不悄悄回退到服务器。
 */
import type { Db } from "./db.ts";
import type { ModelClient } from "./llm.ts";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export class LocalHttpError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "LocalHttpError";
    this.status = status;
    this.detail = detail;
  }
}

export interface LocalEvent {
  event: string;
  data: any;
}

/** 处理函数拿到的运行环境。 */
export interface LocalContext {
  db: Db;
  userId: number;
  /** 当前时间，测试里可以注入固定值。 */
  now: () => Date;
  model: ModelClient;
  /** 聊天图片的读写（文件系统），测试里用内存实现。 */
  images: ImageStore;
}

export interface ImageStore {
  save(userId: number, mime: string, base64: string): Promise<{ file: string; mime: string }>;
  /** 返回 data URL；文件丢了返回 null。 */
  asDataUrl(userId: number, file: string, mime: string): Promise<string | null>;
  remove(userId: number, files: string[]): Promise<void>;
  /** 界面用来显示图片的地址（本地 file://）。 */
  uri(userId: number, file: string): string;
}

export interface LocalRequest {
  method: Method;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

export type Handler = (ctx: LocalContext, req: LocalRequest) => Promise<any> | AsyncIterable<LocalEvent>;

interface Route {
  method: Method;
  parts: string[];
  streaming: boolean;
  handler: Handler;
}

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? "" : pair.slice(idx + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

export function unsupported(method: string, path: string): LocalHttpError {
  return new LocalHttpError(501, "本地模式暂不支持这个功能（" + method + " " + path.split("?")[0] + "）");
}

export class LocalRouter {
  private routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler, opts: { streaming?: boolean } = {}): this {
    this.routes.push({ method, parts: split(pattern), streaming: opts.streaming ?? false, handler });
    return this;
  }

  /** 找到匹配的路由。字面量段优先于参数段（/pets/active 先于 /pets/{id}）。同一路径可以各有一个普通版和一个流式版。 */
  match(method: Method, rawPath: string, streaming: boolean): { route: Route; req: LocalRequest } | null {
    const qIdx = rawPath.indexOf("?");
    const pathOnly = qIdx === -1 ? rawPath : rawPath.slice(0, qIdx);
    const queryString = qIdx === -1 ? "" : rawPath.slice(qIdx + 1);
    const parts = split(pathOnly);
    let best: { route: Route; params: Record<string, string>; literals: number } | null = null;
    for (const route of this.routes) {
      if (route.method !== method || route.streaming !== streaming || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let literals = 0;
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const want = route.parts[i];
        if (want.startsWith("{") && want.endsWith("}")) {
          params[want.slice(1, -1)] = decodeURIComponent(parts[i]);
        } else if (want === parts[i]) {
          literals += 1;
        } else {
          ok = false;
          break;
        }
      }
      if (ok && (!best || literals > best.literals)) best = { route, params, literals };
    }
    if (!best) return null;
    return {
      route: best.route,
      req: { method, path: pathOnly, params: best.params, query: parseQuery(queryString), body: undefined },
    };
  }

  /** 普通接口。 */
  async request(ctx: LocalContext, method: Method, path: string, body?: unknown): Promise<any> {
    const hit = this.match(method, path, false);
    if (!hit) throw unsupported(method, path);
    hit.req.body = body;
    return await hit.route.handler(ctx, hit.req);
  }

  /** 流式接口：逐个事件回调；处理函数抛错就让调用方收到错误。 */
  async stream(
    ctx: LocalContext, method: Method, path: string, body: unknown, onEvent: (e: LocalEvent) => void,
  ): Promise<void> {
    const hit = this.match(method, path, true);
    if (!hit) throw unsupported(method, path);
    hit.req.body = body;
    for await (const event of hit.route.handler(ctx, hit.req) as AsyncIterable<LocalEvent>) onEvent(event);
  }
}

/** 查询参数转整数并夹在范围内；缺省用 fallback。 */
export function intQuery(req: LocalRequest, name: string, fallback: number, min: number, max: number): number {
  const raw = req.query[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new LocalHttpError(422, name + " 须是 " + min + "–" + max + " 之间的整数");
  }
  return n;
}

export function optionalIntQuery(req: LocalRequest, name: string): number | null {
  const raw = req.query[name];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new LocalHttpError(422, name + " 须是整数");
  return n;
}

export function idParam(req: LocalRequest, name: string): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new LocalHttpError(422, name + " 不是有效的编号");
  return n;
}
