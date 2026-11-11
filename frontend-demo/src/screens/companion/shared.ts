/**
 * 陪伴模块公共：历史会话类型、模式标签与日期/分组工具。
 */

export type ConversationSummary = {
  id: number;
  mode: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export const MODE_LABELS: Record<string, string> = {
  free_chat: "自由聊聊",
  brain_dump: "一股脑倒",
  hard_thing: "放不下的事",
  review_fragment: "回看片段",
};

export const WEEKDAYS_CN = "日一二三四五六";

/** 模式机器值 → 中文标签；未知回退「自由聊聊」。 */
export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? "自由聊聊";
}

/** 卡片/气泡上的短标题：后端默认取首条用户消息前 40 字，兜底用模式名。 */
export function shortTitle(conv: ConversationSummary): string {
  const raw = conv.title?.trim() || modeLabel(conv.mode);
  return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
}

/** ISO → 「M月D日 · 周X」。 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEKDAYS_CN[d.getDay()]}`;
}

/** ISO → 「HH:MM」。 */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type DayGroup = { label: string; items: ConversationSummary[] };

/** 接口按 id 翻页，展示按最近聊天时间分组。 */
export function groupByDay(list: ConversationSummary[]): DayGroup[] {
  const byActivity = [...list].sort((a, b) =>
    Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at) || b.id - a.id
  );
  const groups: DayGroup[] = [];
  for (const conv of byActivity) {
    const label = dayLabel(conv.updated_at || conv.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(conv);
    else groups.push({ label, items: [conv] });
  }
  return groups;
}
