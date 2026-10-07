/**
 * 「今天接住了几件事」的数据层。
 *
 * 后端没有单独的「今日」接口，这里把四类存储（待办 / 灵感 / 情绪 / 片段）各拉一次，
 * 按本机时区筛出今天新增的，合起来就是今天接住的事。倾倒刚产出的条目先记进本机缓存，
 * 网络慢或断开时首页数字也不会倒退。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { listCandidates, listEmotions, listIdeas, listTodos, updateTodo } from "../../api";

export type CaughtKind = "todo" | "idea" | "mood" | "frag";

export type CaughtItem = {
  id: number;
  kind: CaughtKind;
  text: string;
  /** 待办的提醒时间（ISO）；没设为 null。 */
  remindAt: string | null;
  createdAt: string;
};

export const KIND_ORDER: CaughtKind[] = ["todo", "idea", "mood", "frag"];

/** 后端中文 kind → 前端四类；小结等其余类别不计入「接住」。 */
export function kindFromServer(kind: string): CaughtKind | null {
  switch (kind) {
    case "待办": return "todo";
    case "灵感": return "idea";
    case "情绪": return "mood";
    case "片段": return "frag";
    default: return null;
  }
}

export const KIND_LABEL: Record<CaughtKind, string> = {
  todo: "待办",
  idea: "灵感",
  mood: "情绪",
  frag: "片段",
};

/** 每类被放到了哪儿（展开「今天接住的」时的一行说明）。 */
export const KIND_WHERE: Record<CaughtKind, string> = {
  todo: "收进待办",
  idea: "收进灵感",
  mood: "听见了，先替你寄存着",
  frag: "先静静收着，想回看就去片场",
};

/** 后端时间可能不带时区（SQLite），按 UTC 理解。 */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 明早 8 点（本机时区）。 */
export function tomorrowMorning(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
}

function dayKey(now = new Date()): string {
  return `morning.caught.${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function readCache(): Promise<CaughtItem[]> {
  try {
    const raw = await AsyncStorage.getItem(dayKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeCache(items: CaughtItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(dayKey(), JSON.stringify(items));
  } catch {
    /* 缓存只是兜底 */
  }
}

function toItem(raw: any, kind: CaughtKind): CaughtItem {
  return {
    id: Number(raw.id),
    kind,
    text: String(raw.surface_text || raw.content || "").trim(),
    remindAt: kind === "todo" && raw.due_date ? String(raw.due_date) : null,
    createdAt: String(raw.created_at ?? ""),
  };
}

/** 拉今天接住的事：服务器为准，本机缓存补上服务器暂时还没返回的条目。 */
export async function loadTodayCaught(): Promise<CaughtItem[]> {
  const since = startOfToday().getTime();
  const sources: [() => Promise<any>, CaughtKind][] = [
    [() => listTodos(""), "todo"],
    [listIdeas, "idea"],
    [listEmotions, "mood"],
    [listCandidates, "frag"],
  ];
  const results = await Promise.allSettled(sources.map(([load]) => load()));
  const cached = await readCache();
  if (results.every((r) => r.status === "rejected")) return cached;

  const fromServer: CaughtItem[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
    for (const raw of r.value) {
      const at = parseServerTime(raw?.created_at);
      if (at && at.getTime() >= since) fromServer.push(toItem(raw, sources[i][1]));
    }
  });
  const ids = new Set(fromServer.map((x) => x.id));
  // 只补那些所属类别这次没拉成功的缓存条目；拉成功了却不在列表里，说明已被删除或处理
  const failedKinds = new Set(sources.filter((_, i) => results[i].status === "rejected").map(([, k]) => k));
  const merged = [...fromServer, ...cached.filter((c) => !ids.has(c.id) && failedKinds.has(c.kind))];
  merged.sort((a, b) => (parseServerTime(a.createdAt)?.getTime() ?? 0) - (parseServerTime(b.createdAt)?.getTime() ?? 0));
  void writeCache(merged);
  return merged;
}

/**
 * 让它明早提醒：待办的截止时间设成明早 8 点；本地通知由调用方另行安排。
 * 后端记忆走版本链，改一次会生成新版本、换一个 id，所以返回更新后的条目。
 * 截止时间只能设、不能用 PATCH 清空（后端忽略 null），按钮因此是单向的。
 */
export async function setTodoReminder(item: CaughtItem, at: Date): Promise<CaughtItem> {
  const updated = await updateTodo(item.id, { due_date: at.toISOString() });
  return updated?.id ? { ...toItem(updated, "todo"), createdAt: item.createdAt } : { ...item, remindAt: at.toISOString() };
}

/** 提醒时间是否落在明天（首页「接下来」只显示明早的提醒）。 */
export function isTomorrow(iso: string | null, now = new Date()): boolean {
  const d = parseServerTime(iso);
  if (!d) return false;
  const start = startOfToday(now).getTime() + 86_400_000;
  return d.getTime() >= start && d.getTime() < start + 86_400_000;
}
