/**
 * 待办提醒的本机存储（AsyncStorage）：
 * - 提醒是否已设、什么时候提醒：只存本机，按待办 id，不写回后端（后端 due_date 是「事情时间」，不能被提醒时间覆盖）；
 * - 「不用」提醒的待办 id：记下来，今日页不再问这一条。
 *
 * 后端记忆走版本链：PATCH 一次（改状态、改时间）会生成新版本、换一个 id，
 * 所以每次 PATCH 返回新 id 后要调 migrateId 把这两份记录跟着搬过去，否则提醒状态会丢。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ReminderMap } from "./todoLogic";

const REMINDERS_KEY = "morning.todoReminders.v1";
const DISMISSED_KEY = "morning.todoPromptDismissed.v1";
/** 「不用」名单最多记多少条（防无限增长，旧的先丢）。 */
const DISMISSED_MAX = 300;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不上只影响下次启动时的状态，不影响这次 */
  }
}

export async function loadReminders(): Promise<ReminderMap> {
  const map = await readJson<ReminderMap>(REMINDERS_KEY, {});
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export const saveReminders = (map: ReminderMap) => writeJson(REMINDERS_KEY, map);

export async function loadDismissed(): Promise<number[]> {
  const list = await readJson<number[]>(DISMISSED_KEY, []);
  return Array.isArray(list) ? list.filter((x) => Number.isFinite(x)) : [];
}

export const saveDismissed = (ids: number[]) => writeJson(DISMISSED_KEY, ids.slice(-DISMISSED_MAX));
