/**
 * 首页聚合与模型密钥相关接口。
 *
 * - /companion/home：backend/app/routers/companion/companion.py。邀请（未读来信 / 今日待办）依赖来信与待办，
 *   P2/P3 才有，所以现在 invitation 恒为 null。
 * - /ai/keys/*：本地模式下密钥就在手机上，没有“服务器口径”可言；policy 如实说明，test 直接探测模型服务商。
 * - /users/me/own-key、/tick：服务器模式下为自带密钥服务的接口，本地模式不需要，返回无害结果。
 */
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, STEPFUN_BASE_URL, STEPFUN_TEXT_MODEL, type FetchLike, type ModelKeys } from "../llm.ts";
import type { LocalContext, LocalRouter } from "../http.ts";
import { getActivePet } from "./pets.ts";

const BEHAVIORS: [number, number, string][] = [
  [0, 6, "打盹"], [6, 9, "伸懒腰"], [9, 12, "听歌"], [12, 14, "午睡"], [14, 18, "歪头看你"], [18, 22, "发呆"], [22, 24, "等你说话"],
];

export function behaviorFor(hour: number): string {
  return BEHAVIORS.find(([from, to]) => hour >= from && hour < to)?.[2] ?? "待着";
}

export interface KeyProbe {
  provided: boolean;
  ok: boolean;
  reason: string | null;
}

/** 列一次模型（不花 token）。只回报结论，不回显密钥和上游的原始报错。 */
export async function probeKey(fetchFn: FetchLike, baseUrl: string, key: string): Promise<KeyProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetchFn(baseUrl.replace(/\/+$/, "") + "/models", {
      method: "GET",
      headers: { Authorization: "Bearer " + key },
      signal: controller.signal,
    });
    if (res.status === 200) return { provided: true, ok: true, reason: null };
    if (res.status === 401 || res.status === 403) return { provided: true, ok: false, reason: "invalid_key" };
    if (res.status === 402) return { provided: true, ok: false, reason: "no_balance" };
    // 限流说明 key 是被认的，只是此刻太频繁
    if (res.status === 429) return { provided: true, ok: true, reason: "rate_limited" };
    return { provided: true, ok: false, reason: "http_" + res.status };
  } catch (error: any) {
    return { provided: true, ok: false, reason: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export interface SystemDeps {
  fetch: FetchLike;
  keys: () => ModelKeys;
}

export function registerSystem(router: LocalRouter, deps: SystemDeps): void {
  router.add("GET", "/api/v1/companion/home", async (ctx: LocalContext) => {
    const pet = await getActivePet(ctx);
    const now = ctx.now();
    return {
      pet: pet ? { id: pet.id, name: pet.name, personality: pet.personality, preset_id: pet.preset_id ?? null } : null,
      behavior: behaviorFor(now.getHours()),
      status_text: "在等你",
      invitation: null,
      server_time: now.toISOString(),
    };
  });

  router.add("GET", "/api/v1/ai/keys/policy", async () => ({
    byok_required: true,
    server_key_available: false,
    text_model: STEPFUN_TEXT_MODEL,
    fallback_model: DEEPSEEK_MODEL,
  }));

  router.add("POST", "/api/v1/ai/keys/test", async (_ctx, req) => {
    // 本地模式下，要测的密钥由界面放在请求体里（不经任何服务器）
    const given: Partial<ModelKeys> = req.body?.keys ?? deps.keys();
    const out: Record<string, KeyProbe> = {};
    for (const [name, base] of [["stepfun", STEPFUN_BASE_URL], ["deepseek", DEEPSEEK_BASE_URL]] as const) {
      const key = given[name];
      out[name] = key ? await probeKey(deps.fetch, base, key) : { provided: false, ok: false, reason: null };
    }
    return out;
  });

  router.add("PUT", "/api/v1/users/me/own-key", async (_ctx, req) => ({ uses_own_key: !!req.body?.enabled }));
  router.add("POST", "/api/v1/tick", async () => ({ accepted: false, reason: "local" }));
}
