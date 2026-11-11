/**
 * 时间口径：backend/app/services/memory/temporal.py 的移植。
 * 产品面向国内用户，时间一律按东八区（CST，UTC+8）理解；库里存 UTC。
 *
 * 约定（前后端共用）：
 * - 记忆的 due_date 为「带时区的 UTC 时刻」。
 * - 只有日期没有具体时刻的截止，存当天东八区 00:00（即前一天 16:00Z）；
 *   东八区本地时间恰为 00:00 视为「没有具体时刻」。
 *
 * 不用 Intl / 设备时区：手机时区可能不是东八区，而这里的口径必须固定。
 */

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = "一二三四五六日";

export interface CstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = 周一 … 6 = 周日（与 Python 的 weekday() 一致）。 */
  weekday: number;
}

export function cstParts(date: Date): CstParts {
  const shifted = new Date(date.getTime() + CST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 库里取出的时间（ISO 字符串）→ Date。没带时区的按 UTC。 */
export function parseStoredTime(value: string | Date): Date {
  if (value instanceof Date) return value;
  const text = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + "Z";
  return new Date(text);
}

/** 「10月13日」（东八区）。 */
export function cnDate(value: string | Date): string {
  const p = cstParts(parseStoredTime(value));
  return p.month + "月" + p.day + "日";
}

/** 「10月19日周一」（东八区）。 */
export function cnDateWeekday(value: string | Date): string {
  const p = cstParts(parseStoredTime(value));
  return p.month + "月" + p.day + "日周" + WEEKDAYS[p.weekday];
}

/** 「HH:MM」（东八区）。 */
export function cnClock(value: string | Date): string {
  const p = cstParts(parseStoredTime(value));
  return pad(p.hour) + ":" + pad(p.minute);
}

/** 喂给模型的「现在」：现在是 2026-10-19 周一 08:30（东八区）。 */
export function nowContextText(now: Date): string {
  const p = cstParts(now);
  return "现在是 " + pad(p.year, 4) + "-" + pad(p.month) + "-" + pad(p.day) + " 周" + WEEKDAYS[p.weekday] + " " + pad(p.hour) + ":" + pad(p.minute) + "（东八区）";
}

/** 东八区本地时刻不是 00:00 → 有具体时刻。 */
export function hasSpecificTime(value: string | Date): boolean {
  const p = cstParts(parseStoredTime(value));
  return !(p.hour === 0 && p.minute === 0);
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * ISO-8601 解析（对应 Python 的 datetime.fromisoformat 常见写法）。
 * 没带时区的按 naiveAsCst 决定东八区还是 UTC。非法（含 2 月 30 日这类不存在的日期）返回 null。
 */
export function parseIsoDatetime(text: string, naiveAsCst: boolean): Date | null {
  const m = ISO_RE.exec(text.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const second = m[6] ? Number(m[6]) : 0;
  const millis = m[7] ? Number((m[7] + "000").slice(0, 3)) : 0;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null; // 2 月 30 日之类
  let offsetMinutes: number;
  const tz = m[8];
  if (!tz) {
    offsetMinutes = naiveAsCst ? 480 : 0;
  } else if (tz.toUpperCase() === "Z") {
    offsetMinutes = 0;
  } else {
    const digits = tz.slice(1).replace(":", "");
    const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0");
    offsetMinutes = (tz[0] === "-" ? -1 : 1) * minutes;
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
  return new Date(utcMs);
}

/**
 * 把抽取结果里的 due_at 换算成可入库的 UTC 时刻；非法返回 null（调用方不写，绝不丢记忆）。
 * 换算示例（设计值 → 代码）：
 *   "2026-10-19T10:15:00+08:00"（今天10点15，东八区）→ 2026-10-19T02:15:00Z
 *   "2026-10-20"（明天，只有日期）或 has_time=false   → 2026-10-19T16:00:00Z（20 日东八区 00:00）
 * 无时区的 ISO 串按东八区解释（模型说的是本地时间）。
 */
export function parseDueAt(value: unknown, hasTime: unknown = true): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = parseIsoDatetime(value.trim(), true);
  if (!parsed) return null;
  const local = cstParts(parsed);
  if (!(local.year >= 2000 && local.year <= 2100)) return null;
  // has_time 只认明确的 false（模型漏写时按有时刻处理，由 00:00 约定兜底）
  const noTime = hasTime === false || (typeof hasTime === "string" && hasTime.trim().toLowerCase() === "false");
  if (noTime) {
    const midnightCst = Date.UTC(local.year, local.month - 1, local.day) - CST_OFFSET_MS;
    return new Date(midnightCst);
  }
  return parsed;
}

/** 东八区的「今天」日期（年月日），用于比较先后。 */
export function cstDay(date: Date): number {
  const p = cstParts(date);
  return p.year * 10000 + p.month * 100 + p.day;
}
