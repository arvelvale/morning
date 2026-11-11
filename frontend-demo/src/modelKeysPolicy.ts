/**
 * 自带模型密钥（BYOK）的纯逻辑：格式校验、能不能发、发什么请求头（不依赖 RN / expo，方便单测）。
 *
 * 口径（2026-11）：
 * - 密钥只存在这台手机上；每次请求用请求头带给喵灵后端，后端只在这一次请求里转交给模型服务商，不保存。
 * - 文字默认走阶跃（step-3.7-flash），阶跃暂时不可用时退到 DeepSeek（DeepSeek 的 key 选填）。
 * - **密钥只在加密连接（https）上发送。** 明文 http 下同一个 Wi-Fi 里的人都能截到，所以直接不发：
 *   这时自带密钥整体不生效，界面上会说明原因。本机调试地址（loopback）不出手机，可以发。
 */

export interface ModelKeys {
  stepfun: string;
  deepseek: string;
}

export const EMPTY_KEYS: ModelKeys = { stepfun: "", deepseek: "" };

/** 与后端 app/llm_keys.py 的 MIN_KEY_LEN / MAX_KEY_LEN 一致。 */
export const MIN_KEY_LEN = 8;
export const MAX_KEY_LEN = 256;

export const HEADER_STEPFUN = "X-Stepfun-Key";
export const HEADER_DEEPSEEK = "X-Deepseek-Key";

/** 去掉首尾空白（粘贴时常带换行）。 */
export function normalizeKey(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/** 这把 key 的格式问题（给用户看的话）；没问题或没填返回 null。 */
export function keyProblem(raw: string | null | undefined): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (key.length < MIN_KEY_LEN) return "密钥太短了，是不是没复制完整？";
  if (key.length > MAX_KEY_LEN) return "密钥太长了，检查一下是不是多粘贴了别的内容";
  // 只收可见 ASCII：密钥里不会有空格、换行和中文
  if (!/^[\x21-\x7e]+$/.test(key)) return "密钥里有空格或不认识的字符，重新复制一次试试";
  return null;
}

export function hasAnyKey(keys: ModelKeys): boolean {
  return Boolean(normalizeKey(keys.stepfun) || normalizeKey(keys.deepseek));
}

/**
 * 这个后端地址上能不能发密钥。
 * https → 能；本机回环地址（localhost / 127.0.0.1 / 模拟器的 10.0.2.2）→ 能（不出手机）；
 * 其余明文 http → 不能，除非构建时显式打开 allowInsecure（只给本地联调用）。
 */
export function isSecureApiBase(apiBase: string, allowInsecure = false): boolean {
  const m = /^(https?):\/\/([^/:?#]+)/i.exec(apiBase.trim());
  if (!m) return false;
  if (m[1].toLowerCase() === "https") return true;
  const host = m[2].toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "10.0.2.2") return true;
  return allowInsecure;
}

/** 要带上的请求头。不允许发（连接没加密）或没填时返回空对象。 */
export function keyHeaders(keys: ModelKeys, allowed: boolean): Record<string, string> {
  if (!allowed) return {};
  const out: Record<string, string> = {};
  const stepfun = normalizeKey(keys.stepfun);
  const deepseek = normalizeKey(keys.deepseek);
  if (stepfun && !keyProblem(stepfun)) out[HEADER_STEPFUN] = stepfun;
  if (deepseek && !keyProblem(deepseek)) out[HEADER_DEEPSEEK] = deepseek;
  return out;
}

/** 界面上显示用：只露头 4 位和尾 4 位。 */
export function maskKey(raw: string | null | undefined): string {
  const key = normalizeKey(raw);
  if (!key) return "";
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export type KeyTestReason = "invalid_key" | "no_balance" | "timeout" | "network" | "rate_limited" | string | null;

export interface KeyTestResult {
  provided: boolean;
  ok: boolean;
  reason: KeyTestReason;
}

/** 后端测试结果 → 给用户看的一句话。 */
export function testMessage(name: string, r: KeyTestResult | undefined): string {
  if (!r || !r.provided) return "";
  if (r.ok) return r.reason === "rate_limited" ? `${name}的密钥可用（此刻有点忙）` : `${name}的密钥可用`;
  switch (r.reason) {
    case "invalid_key":
      return `${name}的密钥不对，或者已经失效了`;
    case "no_balance":
      return `${name}的账户余额不足`;
    case "timeout":
    case "network":
      return `现在连不上${name}，稍后再试一次`;
    default:
      return `${name}返回了错误，稍后再试一次`;
  }
}

/** 测试结果里，填了的密钥是不是都能用。 */
export function allProvidedOk(results: Record<string, KeyTestResult | undefined>): boolean {
  const provided = Object.values(results).filter((r): r is KeyTestResult => Boolean(r?.provided));
  return provided.length > 0 && provided.every((r) => r.ok);
}
