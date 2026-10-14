/**
 * 信箱模块公共：主题映射 hook、待办/珍藏/来信类型、后端映射与日期工具。
 */
import { useTheme } from "../../design-system";

/** 把设计系统 theme 映射成信箱内部沿用的紧凑色名（C.*），并透出 night 标记。 */
export function useMailboxSurface() {
  const theme = useTheme();
  return {
    theme,
    night: theme.isNight,
    C: {
      bg: theme.colors.background,
      text: theme.colors.textPrimary,
      text2: theme.colors.textSecondary,
      text3: theme.colors.textMuted,
      muted: theme.colors.textMuted,
      placeholder: theme.colors.placeholder,
      glass: theme.colors.surface,
      glassBorder: theme.colors.border,
      cardBg: theme.colors.surface,
      divider: theme.colors.divider,
      rowDivider: theme.colors.divider,
      chevron: theme.colors.textMuted,
      lsPri: theme.colors.textPrimary,
      lsSec: theme.colors.textSecondary,
      lsTer: theme.colors.textMuted,
      gold: theme.colors.warning,
    },
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Task {
  id: string; title: string; date: string; time: string;
  source: string; completed: boolean;
}

export interface Keepsake {
  id: string;
  type: "letter" | "insight" | "scene" | "music" | "quote" | "moment";
  title: string; excerpt: string; savedAt: string;
  petName: string; source: string;
}

/** 无截止日的待办归到「今天」（本地日期，避免写死某一天导致真实数据全落到过去）。 */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 当日日期（模块加载时即 App 启动时确定），供周视图/待办归位统一使用。
export const TODAY_DATE = todayISO();

/** 后端 StoreItemOut(待办) → 前端 Task */
export function mapTodo(t: any): Task {
  const due: string | null = t?.due_date ?? null;
  const date = due ? String(due).slice(0, 10) : TODAY_DATE;
  const hhmm = due ? String(due).slice(11, 16) : "";
  return {
    id: String(t.id),
    title: t.surface_text || t.content || "",
    date,
    time: hhmm && hhmm !== "00:00" ? hhmm : "",
    source: "来自整理",
    completed: t.status === "done",
  };
}

/** date + time(HH:MM 或自由文本) → 后端 due_date（datetime 字符串） */
export function dueFrom(date: string, time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  const hh = m ? m[1].padStart(2, "0") : "00";
  const mm = m ? m[2] : "00";
  return `${date}T${hh}:${mm}:00`;
}

/** 临时思绪剩余保存时间文案（默认保存一个月，后端 EPHEMERAL_TTL_DAYS） */
export function remainText(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "已到期";
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}天后到期`;
  return `${Math.max(1, Math.floor(ms / 3600000))}小时后到期`;
}

// 后端 TreasureOut → 前端 Keepsake
const _TREASURE_TYPE: Record<string, Keepsake["type"]> = {
  summary: "insight", idea: "insight", memory: "quote", scene: "scene", ephemeral: "moment",
};
const _TREASURE_SOURCE: Record<string, string> = {
  summary: "今日小结", idea: "灵感收藏", memory: "记忆", scene: "场景结算", ephemeral: "临时思绪",
};
export function mapTreasure(t: any): Keepsake {
  const st = String(t?.source_type || "");
  return {
    id: String(t.id),
    type: _TREASURE_TYPE[st] || "insight",
    title: t.title || t.content || "",
    excerpt: t.title ? (t.content || "") : "",
    savedAt: t.created_at ? String(t.created_at).slice(5, 10).replace("-", "月") + "日" : "",
    petName: "",
    source: _TREASURE_SOURCE[st] || "珍藏",
  };
}

// ─── Week helpers ────────────────────────────────────────────────────────────

export const WEEKDAYS_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const DAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function shiftDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// ─── Letter types ──────────────────────────────────────────────────────────

export type LetterState = "waiting" | "sealed" | "opening" | "opened" | "saved";

/** scene_invite 信件附件（后端 scene_recommend.generate_scene_invite 写入） */
export interface SceneInviteAttachment {
  kind: "scene_invite";
  render_kind: "preset_3d" | "dynamic_image";
  theater_id: string | null;
  seed: { title?: string; people?: string[]; place?: string; plot?: string; intent?: string };
  confidence?: number;
  scene_id?: number; // 接受后回写
}

/** 后端 LetterOut */
export interface ApiLetter {
  id: number;
  type: string;
  title: string;
  body: string;
  pet_id: number | null;
  ref_memory_id: number | null;
  attachment:
    | ({ label?: string; title?: string; artist?: string; reason?: string } & Partial<SceneInviteAttachment>)
    | null;
  is_read: boolean;
  created_at: string;
}

/** 是否 scene_invite 场景邀请信。 */
export function isSceneInvite(letter: ApiLetter): boolean {
  return letter.type === "scene_invite" || letter.attachment?.kind === "scene_invite";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 后端时间可能不带时区（SQLite 时代的旧数据），按 UTC 理解，再转成手机本地时间。 */
function parseLetterTime(iso: string | null | undefined): Date | null {
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
