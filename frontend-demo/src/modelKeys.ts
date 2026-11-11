/**
 * 自带模型密钥在手机上的存取。
 *
 * 存在系统的安全存储里（expo-secure-store：Android 用 Keystore 加密），不放 AsyncStorage 明文。
 * 只有原生端支持；web 没有安全存储，自带密钥在 web 上不可用（读到的永远是空）。
 * 启动时读一次进内存（loadModelKeys），之后每个请求从内存取，不反复读存储。
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import {
  EMPTY_KEYS, hasAnyKey, isSecureApiBase, keyHeaders, normalizeKey, type ModelKeys,
} from "./modelKeysPolicy";

const STORE_STEPFUN = "morning.modelkey.stepfun";
const STORE_DEEPSEEK = "morning.modelkey.deepseek";

/** 只给本地联调用：构建时设 EXPO_PUBLIC_ALLOW_INSECURE_KEYS=1 才允许在明文 http 上发密钥。 */
const ALLOW_INSECURE = process.env.EXPO_PUBLIC_ALLOW_INSECURE_KEYS === "1";

let cache: ModelKeys = { ...EMPTY_KEYS };
let loaded = false;

export const modelKeysSupported = Platform.OS !== "web";

async function read(name: string): Promise<string> {
  try {
    return normalizeKey(await SecureStore.getItemAsync(name));
  } catch {
    return "";
  }
}

/** 启动 / 无头任务拉起进程时调用：把密钥读进内存。重复调用只读一次。 */
export async function loadModelKeys(): Promise<ModelKeys> {
  if (loaded || !modelKeysSupported) {
    loaded = true;
    return cache;
  }
  cache = { stepfun: await read(STORE_STEPFUN), deepseek: await read(STORE_DEEPSEEK) };
  loaded = true;
  return cache;
}

export function currentModelKeys(): ModelKeys {
  return cache;
}

/** 存进安全存储并更新内存。空字符串 = 删除那一把。存不上会抛错（调用方提示用户）。 */
export async function saveModelKeys(next: ModelKeys): Promise<void> {
  if (!modelKeysSupported) throw new Error("这个平台不支持保存密钥");
  const clean: ModelKeys = { stepfun: normalizeKey(next.stepfun), deepseek: normalizeKey(next.deepseek) };
  for (const [name, value] of [[STORE_STEPFUN, clean.stepfun], [STORE_DEEPSEEK, clean.deepseek]] as const) {
    if (value) await SecureStore.setItemAsync(name, value);
    else await SecureStore.deleteItemAsync(name);
  }
  cache = clean;
  loaded = true;
}

export async function clearModelKeys(): Promise<void> {
  await saveModelKeys({ ...EMPTY_KEYS });
}

/** 这个后端地址上允不允许发密钥（连接是否加密）。 */
export function keysAllowedOn(apiBase: string): boolean {
  return isSecureApiBase(apiBase, ALLOW_INSECURE);
}

/** 自带密钥此刻是否真的在生效：填了，而且连接允许发。 */
export function ownKeysActive(apiBase: string): boolean {
  return hasAnyKey(cache) && keysAllowedOn(apiBase);
}

/** 每个请求要带的密钥请求头（不允许发或没填时为空）。 */
export function ownKeyHeaders(apiBase: string): Record<string, string> {
  return keyHeaders(cache, keysAllowedOn(apiBase));
}
