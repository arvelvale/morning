/**
 * 待办的时间与提醒规则（纯函数，不依赖 React Native，node 脚本可直接测：scripts/test-todos-reminders.mjs）。
 *
 * 两个时间必须分开：
 * - 事情时间 dueAt：后端 due_date，「事情发生的时刻」（10:15 开会）；
 * - 提醒时间 remindAt：本机算出来、本机存的，「什么时候叫你」。提醒不写回后端，不覆盖事情本身的时间。
 *
 * 后端 due_date 的约定：本地时间 00:00 = 只有日期、没有具体时刻；没有 due_date = 没定时间。
 * 后端时间可能不带时区（SQLite），按 UTC 理解。
 */

export type TodoItem = {
  id: number;
  text: string;
  /** 事情时间（后端原样的 ISO 字符串）；没定时间为 null。 */
  dueAt: string | null;
  done: boolean;
  createdAt: string;
};

/** 默认提前量：设计值「提前 15 分钟」→ remindAt = due - 15*60*1000。 */
export const LEAD_MS = 15 * 60 * 1000;
/** 只有日期 / 没有时间的提醒钟点：设计值「早上 8 点」→ setHours(8, 0, 0, 0)。 */
export const MORNING_HOUR = 8;

/** 后端时间可能不带时区（SQLite），按 UTC 理解。 */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 明早 8 点（本机时区）。 */
export function tomorrowMorning(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR, 0, 0, 0);
}

/** 后端条目 → TodoItem；已取消的返回 null（不展示）。 */
export function toTodo(raw: any): TodoItem | null {
  if (!raw || raw.id == null) return null;
  if (raw.status === "canceled") return null;
  return {
    id: Number(raw.id),
    text: String(raw.surface_text || raw.content || "").trim(),
    dueAt: raw.due_date ? String(raw.due_date) : null,
    done: raw.status === "done",
    createdAt: String(raw.created_at ?? ""),
  };
}

export type DueInfo =
  | { kind: "none" }
  | { kind: "date"; at: Date }
  /** 只有日期：at 是当天 00:00（本地） */
  | { kind: "time"; at: Date };

/** 事情时间分三种：没定 / 只有日期（本地 00:00）/ 有具体时刻。 */
export function dueInfo(dueAt: string | null | undefined): DueInfo {
  const d = parseServerTime(dueAt);
  if (!d) return { kind: "none" };
  if (d.getHours() === 0 && d.getMinutes() === 0) return { kind: "date", at: startOfDay(d) };
  return { kind: "time", at: d };
}

/**
 * 默认提醒时间；null = 不该再提醒（已经过了）。
 * - 有具体时刻：提前 15 分钟（due - LEAD_MS）；离现在不足 15 分钟则到点提醒（due）；已过 → null；
 * - 只有日期：当天早上 8 点；已过（含当天已过 8 点）→ null；
 * - 没有时间：明早 8 点。
 */
export function planReminder(dueAt: string | null | undefined, now = new Date()): Date | null {
  const info = dueInfo(dueAt);
  const t = now.getTime();
  if (info.kind === "none") return tomorrowMorning(now);
  if (info.kind === "date") {
    const at = new Date(info.at.getFullYear(), info.at.getMonth(), info.at.getDate(), MORNING_HOUR, 0, 0, 0);
    return at.getTime() > t ? at : null;
  }
  const due = info.at.getTime();
  const lead = due - LEAD_MS;
  if (lead > t) return new Date(lead);
  return due > t ? new Date(due) : null;
}

// ───────── 文案 ─────────

const pad2 = (n: number) => String(n).padStart(2, "0");
export const clock = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function dayDiff(d: Date, now: Date): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

function dateText(d: Date, now: Date): string {
  const y = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 事情时间：「今天 10:15」「明天 · 15:00」「10月21日」「没定时间」。 */
export function dueLabel(dueAt: string | null | undefined, now = new Date()): string {
  const info = dueInfo(dueAt);
  if (info.kind === "none") return "没定时间";
  const diff = dayDiff(info.at, now);
  if (info.kind === "date") {
    if (diff === 0) return "今天";
    if (diff === 1) return "明天";
    return dateText(info.at, now);
  }
  if (diff === 0) return `今天 ${clock(info.at)}`;
  if (diff === 1) return `明天 · ${clock(info.at)}`;
  return `${dateText(info.at, now)} ${clock(info.at)}`;
}

/** 横幅里的口语时间：「10:15」「明天 15:00」「10月21日 15:00」。 */
export function dueSpoken(dueAt: string | null | undefined, now = new Date()): string {
  const info = dueInfo(dueAt);
  if (info.kind !== "time") return dueLabel(dueAt, now);
  const diff = dayDiff(info.at, now);
  if (diff === 0) return clock(info.at);
  if (diff === 1) return `明天 ${clock(info.at)}`;
  return `${dateText(info.at, now)} ${clock(info.at)}`;
}

/** 提醒时间：「10:00」「明早 8 点」「明天 09:30」「10月21日 8:00」。 */
export function remindWhen(at: Date, now = new Date()): string {
  const diff = dayDiff(at, now);
  const isMorning8 = at.getHours() === MORNING_HOUR && at.getMinutes() === 0;
  if (diff === 0) return isMorning8 ? "今早 8 点" : clock(at);
  if (diff === 1) return isMorning8 ? "明早 8 点" : `明天 ${clock(at)}`;
  return `${dateText(at, now)} ${isMorning8 ? "8 点" : clock(at)}`;
}

/** 「10:00 提醒我」「明早 8 点提醒我」：以「点」结尾的口语钟点不再加空格。 */
function joinVerb(when: string, verb: string): string {
  return /点$/.test(when) ? `${when}${verb}` : `${when} ${verb}`;
}

export function remindButtonText(at: Date, now = new Date()): string {
  return joinVerb(remindWhen(at, now), "提醒我");
}

/** 已设置：「10:00 叫你」；提醒时间已过则是「已提醒」。 */
export function remindOnText(at: Date, now = new Date()): string {
  if (at.getTime() <= now.getTime()) return "已提醒";
  return joinVerb(remindWhen(at, now), "叫你");
}

// ───────── 分组 ─────────

export type TodoGroups = {
  today: TodoItem[];
  later: TodoItem[];
  undated: TodoItem[];
  done: TodoItem[];
};

/** 排序键：有具体时刻按时刻；只有日期排在当天所有有时刻的后面。 */
function sortKey(t: TodoItem): number {
  const info = dueInfo(t.dueAt);
  if (info.kind === "none") return Number.MAX_SAFE_INTEGER;
  if (info.kind === "time") return info.at.getTime();
  return info.at.getTime() + 86_400_000 - 1;
}

const byCreatedDesc = (a: TodoItem, b: TodoItem) =>
  (parseServerTime(b.createdAt)?.getTime() ?? 0) - (parseServerTime(a.createdAt)?.getTime() ?? 0);

/**
 * 待办页分组：今天 / 之后 / 没定时间 / 已完成。
 * 今天 = 事情日期 ≤ 今天（已过期但没做的也放这里，时间文案会写出它的日期）；已完成不分日期，新的在前。
 */
export function groupTodos(todos: TodoItem[], now = new Date()): TodoGroups {
  const g: TodoGroups = { today: [], later: [], undated: [], done: [] };
  const todayStart = startOfDay(now).getTime();
  for (const t of todos) {
    if (t.done) { g.done.push(t); continue; }
    const info = dueInfo(t.dueAt);
    if (info.kind === "none") { g.undated.push(t); continue; }
    (startOfDay(info.at).getTime() <= todayStart ? g.today : g.later).push(t);
  }
  g.today.sort((a, b) => sortKey(a) - sortKey(b));
  g.later.sort((a, b) => sortKey(a) - sortKey(b));
  g.undated.sort(byCreatedDesc);
  g.done.sort(byCreatedDesc);
  return g;
}

/**
 * 首页「接下来」要展示哪一件：没做完、事情时间还没过的里最近的一件；
 * 都没有就退回最近记下的「没定时间」的一件；再没有返回 null。
 * 「还没过」：有时刻看时刻；只有日期看是不是今天及以后。
 */
export function pickNext(todos: TodoItem[], now = new Date()): TodoItem | null {
  const t = now.getTime();
  const todayStart = startOfDay(now).getTime();
  const upcoming = todos
    .filter((x) => {
      if (x.done) return false;
      const info = dueInfo(x.dueAt);
      if (info.kind === "none") return false;
      return info.kind === "time" ? info.at.getTime() > t : info.at.getTime() >= todayStart;
    })
    .sort((a, b) => sortKey(a) - sortKey(b));
  if (upcoming.length) return upcoming[0];
  return todos.filter((x) => !x.done && dueInfo(x.dueAt).kind === "none").sort(byCreatedDesc)[0] ?? null;
}

// ───────── 「要不要提醒」的判定 ─────────

/** 本机记下的提醒：待办 id → 提醒时间（ISO）。 */
export type ReminderMap = Record<string, { at: string; notifId?: string | null }>;

/** 这条待办此刻能不能设提醒（没做完 + 默认提醒时间还没过）。 */
export function canRemind(t: TodoItem, now = new Date()): boolean {
  return !t.done && planReminder(t.dueAt, now) !== null;
}

/**
 * 今日页顶部那句「要提醒你吗」问哪一条；null = 不问。
 * 只问：有具体时刻、还没过、还没设提醒、没被点过「不用」的待办；多条只取最近的一条。
 */
export function pickPrompt(
  todos: TodoItem[],
  reminders: ReminderMap,
  dismissed: ReadonlySet<number>,
  now = new Date(),
): TodoItem | null {
  const t = now.getTime();
  let best: { todo: TodoItem; due: number } | null = null;
  for (const todo of todos) {
    if (todo.done || dismissed.has(todo.id) || reminders[String(todo.id)]) continue;
    const info = dueInfo(todo.dueAt);
    if (info.kind !== "time" || info.at.getTime() <= t) continue;
    if (!best || info.at.getTime() < best.due) best = { todo, due: info.at.getTime() };
  }
  return best?.todo ?? null;
}
