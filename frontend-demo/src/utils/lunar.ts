/**
 * 页眉环境历法：农历日期 + 节气（含"几日后"）+ 时段意境词。
 *
 * 农历：solarlunar（无依赖小包，1900-2100 压缩表，精确）。
 * 节气：21 世纪通用公式（floor(y%100*0.2422 + C) - floor((y%100-1)/4)），
 *       个别年份可能偏差一天——页眉展示用途可接受（如实标注）。
 */
import solarlunar from "solarlunar";

/** 24 节气 21 世纪 C 值（小寒起，index<12 为 1~12 月上半月节气）。 */
const TERMS: [string, number][] = [
  ["小寒", 5.4055], ["大寒", 20.12], ["立春", 3.87], ["雨水", 18.73],
  ["惊蛰", 5.63], ["春分", 20.646], ["清明", 4.81], ["谷雨", 20.1],
  ["立夏", 5.52], ["小满", 21.04], ["芒种", 5.678], ["夏至", 21.37],
  ["小暑", 7.108], ["大暑", 22.83], ["立秋", 7.5], ["处暑", 23.13],
  ["白露", 7.646], ["秋分", 23.042], ["寒露", 8.318], ["霜降", 23.438],
  ["立冬", 7.438], ["小雪", 22.36], ["大雪", 7.18], ["冬至", 21.94],
];

function termDate(year: number, idx: number): Date {
  const [, c] = TERMS[idx];
  const month = idx < 12 ? idx + 1 : idx - 11;
  const y100 = year % 100;
  const day = Math.floor(y100 * 0.2422 + c) - Math.floor((y100 - 1) / 4);
  return new Date(year, month - 1, day);
}

/** 当前节气名；若下一个节气在 3 天内，返回「处暑 三日后」式提示。 */
function termLine(now: Date): string {
  const y = now.getFullYear();
  const all: { name: string; date: Date }[] = [];
  for (const yy of [y, y + 1]) {
    TERMS.forEach(([name], idx) => all.push({ name, date: termDate(yy, idx) }));
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  let current = all[0]?.name ?? "";
  let next: { name: string; date: Date } | undefined;
  for (let i = 0; i < all.length; i++) {
    if (all[i].date.getTime() <= now.getTime()) current = all[i].name;
    else { next = all[i]; break; }
  }
  if (next) {
    const days = Math.round((next.date.getTime() - now.getTime()) / 86400000);
    if (days <= 3) return `${next.name} ${days}日后`;
  }
  return current;
}

/** 时段意境词（对应原型的「午后 / 亥时 · 灯下」气质）。 */
function daypart(now: Date): string {
  const h = now.getHours();
  if (h < 1) return "子夜";
  if (h < 5) return "夜阑";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 13) return "正午";
  if (h < 17) return "午后";
  if (h < 19) return "黄昏";
  return "灯下";
}

export interface AmbientCalendar {
  /** 例：八月廿五 */
  lunar: string;
  /** 例：处暑 或 白露 三日后 */
  term: string;
  /** 例：午后 */
  daypart: string;
}

export function ambientCalendar(now: Date = new Date()): AmbientCalendar {
  return { lunar: lunarLine(now), term: termLine(now), daypart: daypart(now) };
}

/**
 * 农历行。solarlunar 的真实 API 是 solar2lunar(y, m, d)（数字年月日），
 * 曾有人误调不存在的 solarToLunar 导致启动闪退（2026-09-03 线上事故），
 * 因此这里必须 try/catch + 公历兜底：日期文案永远不值得崩一次首页。
 */
function lunarLine(now: Date): string {
  try {
    const l = solarlunar.solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
    if (l && typeof l.monthCn === "string" && typeof l.dayCn === "string") {
      // monthCn 自带"月"（如"七月"/"闰七月"），直接拼接即可
      return `${l.monthCn}${l.dayCn}`;
    }
  } catch {
    // 保持兜底
  }
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
}
