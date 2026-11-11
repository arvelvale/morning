/**
 * 本地模式开关（只存这台手机，不进后端偏好）。
 *
 * 打开后，api.ts 里的接口调用改为交给手机里的“虚拟服务器”（src/local），数据存在本机 SQLite，
 * 模型由手机用自己的密钥直连。没实现的接口会明确报“本地模式暂不支持”，不会悄悄回退到喵灵服务器。
 * 设计见 docs/specs/2026-11-11-local-first-runtime.md。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { LocalEvent, Method } from "./local/index";

const KEY = "morning.localMode";

/** 本地库用 expo-sqlite（原生）；网页版不支持。 */
export const localModeSupported = Platform.OS !== "web";

let enabled = false;
let loaded = false;

export const isLocalMode = (): boolean => enabled;

export async function loadLocalMode(): Promise<boolean> {
  if (loaded) return enabled;
  loaded = true;
  if (!localModeSupported) return false;
  try {
    enabled = (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    enabled = false;
  }
  return enabled;
}

export async function setLocalMode(on: boolean): Promise<void> {
  if (on && !localModeSupported) throw new Error("这个平台暂不支持本地模式");
  await AsyncStorage.setItem(KEY, on ? "1" : "0");
  enabled = on;
  loaded = true;
}

async function runtime() {
  // 动态加载：没打开本地模式时，不会去碰 expo-sqlite
  const { getLocalRuntime } = await import("./local/runtime");
  return getLocalRuntime();
}

export async function localRequest<T = any>(method: Method, path: string, body?: unknown): Promise<T> {
  return (await runtime()).request<T>(method, path, body);
}

export async function localStream(path: string, body: unknown, onEvent: (e: LocalEvent) => void): Promise<void> {
  return (await runtime()).stream(path, body, onEvent);
}
