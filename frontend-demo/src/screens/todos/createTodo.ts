import type { TodoItem } from "./todoLogic";

export type TodoDraft = { text: string; date: string; time: string; remind: boolean };
export type TodoPayload = { content: string; surface_text: string; due_date: string | null };

/** 与后端日期约定一致：北京时间 00:00 表示仅日期，不冒充精确的午夜提醒。 */
export function todoPayload(draft: TodoDraft, now = new Date()): TodoPayload {
  const text = draft.text.trim();
  if (!text) throw new Error("先写下要做的事吧");
  if (text.length > 500) throw new Error("事情写在 500 字以内就好");
  const date = draft.date.trim();
  const time = draft.time.trim();
  if (!date) {
    if (time) throw new Error("选个日期，我才知道是哪一天");
    return { content: text, surface_text: text, due_date: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期请写成 YYYY-MM-DD，例如 2026-11-05");
  const midnight = new Date(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(midnight.getTime()) || new Date(midnight.getTime() + 8 * 3600_000).toISOString().slice(0, 10) !== date) {
    throw new Error("这个日期不存在，再看看吧");
  }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("时间请写成 HH:mm，例如 09:30");
  if (time === "00:00") throw new Error("零点目前会被记为只有日期，请选其他时刻");
  const due = new Date(`${date}T${time || "00:00"}:00+08:00`);
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (date < today || (time && due.getTime() <= now.getTime())) throw new Error("这个时间已经过去了，选个之后的时间吧");
  return { content: text, surface_text: text, due_date: due.toISOString() };
}

/** 先保存，再设提醒。提醒失败不能把已保存的待办当成失败，避免重试产生重复条目。 */
export async function saveManualTodo(
  payload: TodoPayload,
  shouldRemind: boolean,
  deps: {
    create: (payload: TodoPayload) => Promise<TodoItem>;
    onSaved: (todo: TodoItem) => void;
    remind: (todo: TodoItem) => Promise<boolean>;
  },
): Promise<{ todo: TodoItem; reminded: boolean }> {
  const todo = await deps.create(payload);
  deps.onSaved(todo);
  let reminded = false;
  if (shouldRemind) {
    try { reminded = await deps.remind(todo); } catch { /* 保存已成功，提醒可在列表里重试 */ }
  }
  return { todo, reminded };
}
