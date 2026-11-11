/**
 * 线上（手机）运行时：把 expo-sqlite、expo-file-system、expo/fetch 和安全存储里的密钥接进本地运行时。
 * 只在本地模式打开时才会被加载（见 localMode.ts 的动态 import）。
 */
import * as FileSystem from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

import { currentModelKeys, loadModelKeys } from "../modelKeys";
import { openExpoDb } from "./db.expo.ts";
import { extOf, SAFE_FILE } from "./imageRules.ts";
import type { ImageStore } from "./http.ts";
import { createLocalRuntime, type LocalRuntime } from "./index.ts";

function hex32(): string {
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** 聊天图片放在应用私有目录 documentDirectory/chat-images/<user_id>/，数据库里只存文件名。 */
export function createFileImageStore(): ImageStore {
  const root = () => {
    if (!FileSystem.documentDirectory) throw new Error("没有可用的应用存储目录");
    return FileSystem.documentDirectory + "chat-images/";
  };
  const dir = (userId: number) => root() + String(Math.trunc(userId)) + "/";
  return {
    async save(userId, mime, base64) {
      await FileSystem.makeDirectoryAsync(dir(userId), { intermediates: true });
      const file = hex32() + "." + extOf(mime);
      await FileSystem.writeAsStringAsync(dir(userId) + file, base64, { encoding: FileSystem.EncodingType.Base64 });
      return { file, mime };
    },
    async asDataUrl(userId, file, mime) {
      if (!SAFE_FILE.test(file)) return null;
      try {
        const base64 = await FileSystem.readAsStringAsync(dir(userId) + file, { encoding: FileSystem.EncodingType.Base64 });
        return "data:" + mime + ";base64," + base64;
      } catch {
        return null;
      }
    },
    async remove(userId, files) {
      for (const file of files) {
        if (!SAFE_FILE.test(file)) continue;
        await FileSystem.deleteAsync(dir(userId) + file, { idempotent: true }).catch(() => undefined);
      }
    },
    uri: (userId, file) => (SAFE_FILE.test(file) ? dir(userId) + file : ""),
  };
}

let runtimePromise: Promise<LocalRuntime> | null = null;

/** 打开数据库、跑迁移、装好模型客户端。同一进程只做一次；失败后下次调用会重试。 */
export function getLocalRuntime(): Promise<LocalRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await loadModelKeys(); // 进程可能是被服务从零拉起的：密钥要先从安全存储读进内存
      return createLocalRuntime({
        db: await openExpoDb(),
        fetch: expoFetch as any,
        keys: currentModelKeys,
        images: createFileImageStore(),
      });
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}
