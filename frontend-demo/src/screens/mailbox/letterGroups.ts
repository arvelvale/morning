/**
 * 信箱的纯函数：信件时间格式化、归类（晚间信 / 有句话 / 周报 / 小纸条）、按天分组、搜索。
 * 不依赖 React Native，scripts/test-mailbox-groups.mjs 直接加载测试。
 */
import type { ApiLetter, Rehearsal, SceneInviteAttachment } from "./shared";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 后端时间可能不带时区（SQLite 时代的旧数据），按 UTC 理解，再转成手机本地时间。 */
export function parseLetterTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO → 「M月D日 · 周X HH:mm」（信纸抬头）；解析失败返回空串。 */
export function _fmtLetterDate(iso: string): string {
  const d = parseLetterTime(iso);
  if (!d) return "";
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${wd} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ─── 信箱改版（2026-10-14）：信件归类 + 按天分组 ─────────────────────────────

/**
 * 信件归类：正经的信单独成卡，一两句话的「小纸条」叠起来。
 * 后端 type：greeting=晚间来信、weekly=周报、scene_invite=有句话、reminder=睡前提醒、proactive=主动陪伴的短讯。
 */
export type LetterKind = "evening" | "rehearse" | "weekly" | "note" | "other";

export const LETTER_KIND_LABEL: Record<LetterKind, string> = {
  evening: "晚间信", rehearse: "有句话", weekly: "周报", note: "小纸条", other: "来信",
};

export function letterKind(l: Pick<ApiLetter, "type" | "attachment">): LetterKind {
  if (l.type === "scene_invite" || l.attachment?.kind === "scene_invite") return "rehearse";
  if (l.type === "greeting") return "evening";
  if (l.type === "weekly") return "weekly";
  if (l.type === "reminder" || l.type === "proactive") return "note";
  return "other";
}

export function letterTime(l: Pick<ApiLetter, "created_at">): Date | null {
  return parseLetterTime(l.created_at);
}

/** 本地日期键 YYYY-MM-DD（按手机时区分天）。 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 分组标题：今天 · 10月14日 周三 / 昨天 · 10月13日 周二 / 10月12日 周一。 */
export function dayLabel(key: string, now = new Date()): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  const base = `${y === now.getFullYear() ? "" : `${y}年`}${m}月${d}日 周${wd}`;
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - date.getTime()) / 86400000);
  if (diff === 0) return `今天 · ${base}`;
  if (diff === 1) return `昨天 · ${base}`;
  return base;
}

export interface LetterDay {
  key: string;
  letters: ApiLetter[]; // 正经的信，新的在前
  notes: ApiLetter[];   // 小纸条，新的在前
}

/** 按天分组（新的一天在前）；解析不了时间的信归到最早，不丢。 */
export function groupLettersByDay(letters: ApiLetter[]): LetterDay[] {
  const map = new Map<string, LetterDay>();
  const sorted = [...letters].sort((a, b) => (letterTime(b)?.getTime() ?? 0) - (letterTime(a)?.getTime() ?? 0));
  for (const l of sorted) {
    const t = letterTime(l);
    const key = t ? dayKey(t) : "0000-01-01";
    let day = map.get(key);
    if (!day) { day = { key, letters: [], notes: [] }; map.set(key, day); }
    (letterKind(l) === "note" ? day.notes : day.letters).push(l);
  }
  return [...map.values()];
}

/** 搜索：标题或正文包含关键词（忽略大小写与空白）。 */
export function matchLetter(l: ApiLetter, q: string): boolean {
  const k = q.replace(/\s+/g, "").toLowerCase();
  if (!k) return true;
  return `${l.title}${l.body}`.replace(/\s+/g, "").toLowerCase().includes(k);
}

export function rehearsalOf(l: ApiLetter): Rehearsal | null {
  const r = (l.attachment as SceneInviteAttachment | null)?.rehearsal;
  return r && Array.isArray(r.openers) && r.openers.length > 0 ? r : null;
}

/** 信件的时分 HH:mm。 */
export function letterClock(l: Pick<ApiLetter, "created_at">): string {
  const d = parseLetterTime(l.created_at);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "";
}

/** ISO → 列表里的短时间：今天 21:30 / 昨天 21:30 / 10月13日（往期来信行）。 */
export function letterListTime(iso: string, now = new Date()): string {
  const d = parseLetterTime(iso);
  if (!d) return "";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ─── 整理（多选清理 / 一键清理，2026-10）：纯逻辑，页面只管渲染 ───────────────

/** 往期筛选：全部或某一类。 */
export type PastFilter = "all" | LetterKind;

/** 往期按筛选后的样子：筛「小纸条」时纸条逐张当信列出；其余筛选下纸条收起。 */
export function shownDays(days: LetterDay[], filter: PastFilter): LetterDay[] {
  return days.map((d) => {
    if (filter === "note") return { ...d, letters: d.notes, notes: [] };
    if (filter === "all") return d;
    return { ...d, letters: d.letters.filter((l) => letterKind(l) === filter), notes: [] };
  }).filter((d) => d.letters.length > 0 || d.notes.length > 0);
}

/** 一组分天里所有信（含小纸条）的 id。 */
export function idsOfDays(days: LetterDay[]): number[] {
  return days.flatMap((d) => [...d.letters, ...d.notes].map((l) => l.id));
}

/** 点一下勾选圈：在就拿掉，不在就加上（返回新集合，不改原集合）。 */
export function toggleId(sel: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(sel);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** 当前可见的这些 id 是不是都选了（空列表不算全选，避免「全选」按钮在没有信时亮着）。 */
export function isAllSelected(ids: number[], sel: ReadonlySet<number>): boolean {
  return ids.length > 0 && ids.every((id) => sel.has(id));
}

/** 「全选 / 取消全选」：都选了就清空，否则选中所有可见的。 */
export function toggleSelectAll(ids: number[], sel: ReadonlySet<number>): Set<number> {
  return isAllSelected(ids, sel) ? new Set() : new Set(ids);
}

/** 列表变了（删了、刷新了）之后，把选中里已经不存在的 id 去掉。 */
export function pruneSelection(sel: ReadonlySet<number>, letters: ApiLetter[]): Set<number> {
  const alive = new Set(letters.map((l) => l.id));
  return new Set([...sel].filter((id) => alive.has(id)));
}

/** 乐观删除：把这些 id 从列表拿掉。 */
export function removeLetters(letters: ApiLetter[], ids: ReadonlySet<number>): ApiLetter[] {
  return letters.filter((l) => !ids.has(l.id));
}

/** 删除失败回滚：把拿掉的信放回当前列表（去重，保持新的在前——后端按 id 倒序）。 */
export function restoreLetters(current: ApiLetter[], removed: ApiLetter[]): ApiLetter[] {
  const have = new Set(current.map((l) => l.id));
  return [...current, ...removed.filter((l) => !have.has(l.id))].sort((a, b) => b.id - a.id);
}

/** 一键清理的时间界：只清「我看到的最新一封」及更早的；之后才到的信不会被误清（毫秒加一秒容差）。 */
export function clearBefore(letters: ApiLetter[]): string | null {
  let max = -Infinity;
  for (const l of letters) {
    const t = letterTime(l)?.getTime();
    if (t != null && t > max) max = t;
  }
  return Number.isFinite(max) ? new Date(max + 1000).toISOString() : null;
}

export function unreadCountOf(letters: ApiLetter[]): number {
  return letters.filter((l) => !l.is_read).length;
}

/** 乐观「全部标为已读」。 */
export function markAllReadLocal(letters: ApiLetter[]): ApiLetter[] {
  return letters.map((l) => (l.is_read ? l : { ...l, is_read: true }));
}

/** 标已读失败回滚：只把原来没读的那些改回没读。 */
export function revertRead(letters: ApiLetter[], unreadIds: ReadonlySet<number>): ApiLetter[] {
  return letters.map((l) => (unreadIds.has(l.id) && l.is_read ? { ...l, is_read: false } : l));
}

/** 批量删除前的确认文案。 */
export function deleteSelectedConfirm(n: number): { title: string; body: string } {
  return { title: `删掉这 ${n} 封信？`, body: "删掉后在信箱里就看不到了。「我留下的」不受影响。" };
}

/** 清空全部的确认文案；loaded 为已加载的封数（满页时可能还有更早的，只说「都」）。 */
export function clearAllConfirm(loaded: number, pageLimit = 100): { title: string; body: string } {
  const what = loaded >= pageLimit ? "信箱里的信" : `信箱里的 ${loaded} 封信`;
  return { title: `把${what}都清掉？`, body: "清掉后在信箱里就看不到了，收不回来。「我留下的」不受影响。" };
}
