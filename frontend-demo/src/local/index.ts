/**
 * 本地运行时入口：把各组处理函数装进一个路由，并提供 request / stream 两个调用口。
 * 不依赖 React Native：测试里用 node:sqlite + 假 fetch 直接跑；线上由 runtime.ts 接上 expo-sqlite 等。
 */
import { migrate, type Db } from "./db.ts";
import { registerBrainDumps } from "./handlers/brainDumps.ts";
import { registerConversations } from "./handlers/conversations.ts";
import { registerMemories } from "./handlers/memories.ts";
import { registerPets } from "./handlers/pets.ts";
import { registerPreferences } from "./handlers/preferences.ts";
import { registerStores } from "./handlers/stores.ts";
import { registerSystem } from "./handlers/system.ts";
import { registerUsers } from "./handlers/users.ts";
import { LocalHttpError, LocalRouter, type ImageStore, type LocalContext, type LocalEvent, type Method } from "./http.ts";
import { createModelClient, type FetchLike, type ModelKeys } from "./llm.ts";
import { expireEphemeral } from "./memoryStore.ts";
import { LOCAL_USER_ID, MIGRATIONS } from "./schema.ts";

export { LocalHttpError } from "./http.ts";
export type { LocalEvent, Method } from "./http.ts";

export interface LocalRuntimeDeps {
  db: Db;
  fetch: FetchLike;
  keys: () => ModelKeys;
  images: ImageStore;
  now?: () => Date;
  /** 测试里把重试退避压到 0。 */
  backoffMs?: (attempt: number) => number;
}

export interface LocalRuntime {
  request<T = any>(method: Method, path: string, body?: unknown): Promise<T>;
  stream(path: string, body: unknown, onEvent: (e: LocalEvent) => void, method?: Method): Promise<void>;
}

export function buildRouter(deps: Pick<LocalRuntimeDeps, "fetch" | "keys">): LocalRouter {
  const router = new LocalRouter();
  registerUsers(router);
  registerPets(router);
  registerPreferences(router);
  registerConversations(router);
  registerStores(router);
  registerMemories(router);
  registerBrainDumps(router);
  registerSystem(router, deps);
  return router;
}

export async function createLocalRuntime(deps: LocalRuntimeDeps): Promise<LocalRuntime> {
  await migrate(deps.db, MIGRATIONS);
  const router = buildRouter(deps);
  const now = deps.now ?? (() => new Date());
  await expireEphemeral(deps.db, now()).catch(() => 0); // 启动时把到期的寄存真删掉
  const ctx: LocalContext = {
    db: deps.db,
    userId: LOCAL_USER_ID,
    now,
    model: createModelClient({ fetch: deps.fetch, keys: deps.keys, backoffMs: deps.backoffMs }),
    images: deps.images,
  };
  return {
    request: (method, path, body) => router.request(ctx, method, path, body),
    stream: (path, body, onEvent, method = "POST") => router.stream(ctx, method, path, body, onEvent),
  };
}

/** 接口里的模型错误统一翻译成给用户看的话（不带上游细节）。 */
export function friendlyDetail(error: unknown): string {
  if (error instanceof LocalHttpError) return error.detail;
  return "出了点问题，待会儿再试试";
}
