/**
 * 通知的分频道、快捷操作与点击去向（纯逻辑，不依赖 RN / expo，方便单测）。
 *
 * 为什么分频道：安卓的通知频道是用户能单独调的最小单位。把「待办提醒」（要准时、要弹出来）
 * 和「有句话」（轻轻的邀请、最容易想关掉）、「来信」「陪伴问候」分开，用户就能只关掉其中一类，
 * 而不是嫌吵就把喵灵的通知整个关掉。
 *
 * 频道重要程度建好之后 App 改不回来（用户调过的更是），所以已发布过的频道 id 不换、级别不改：
 *   morning-letters   已存在（0.3.x 起），保持 DEFAULT。
 * 新增的频道只在首次安装 / 首次升级时按下面的级别建立。
 */

export type ChannelImportance = "default" | "high";

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: ChannelImportance;
  vibrate: boolean;
}

export const CHANNELS = {
  /** 晚间来信、周报、其他来信。 */
  letters: {
    id: "morning-letters",
    name: "来信提醒",
    description: "米露写给你的晚间来信和周报",
    importance: "default",
    vibrate: true,
  },
  /** 「有句话」：把没说出口的话邀请进一个小场景，轻轻的，不振动。 */
  rehearse: {
    id: "morning-rehearse",
    name: "有句话",
    description: "米露邀请你把一句没说出口的话说出来",
    importance: "default",
    vibrate: false,
  },
  /** 主动陪伴的短讯、睡前提醒。 */
  companion: {
    id: "morning-companion-msg",
    name: "陪伴问候",
    description: "天气、节日、睡前的几句问候",
    importance: "default",
    vibrate: false,
  },
  /** 待办提醒：用户自己设的时间，要准时、弹出来。 */
  todo: {
    id: "morning-todo",
    name: "待办提醒",
    description: "你设了提醒的待办，到点叫你",
    importance: "high",
    vibrate: true,
  },
} as const satisfies Record<string, ChannelSpec>;

export type ChannelKey = keyof typeof CHANNELS;

/** 后端来信类型 → 频道。greeting=晚间信、weekly=周报、scene_invite=有句话、proactive/reminder=陪伴短讯。 */
export function channelForLetter(type: string | null | undefined): ChannelKey {
  switch (type) {
    case "scene_invite":
      return "rehearse";
    case "proactive":
    case "reminder":
      return "companion";
    default:
      return "letters";
  }
}

// ─── 快捷操作 ────────────────────────────────────────────────────────────────

/** 通知上的按钮。identifier 同时是点击回调里的 actionIdentifier。 */
export const ACTIONS = {
  letterRead: "morning_letter_read",
  letterLater: "morning_letter_later",
  todoDone: "morning_todo_done",
  todoSnooze: "morning_todo_snooze",
} as const;

export const CATEGORIES = {
  letter: "morning-letter",
  todo: "morning-todo",
} as const;

export interface CategoryAction {
  identifier: string;
  buttonTitle: string;
}

export const CATEGORY_ACTIONS: Record<string, CategoryAction[]> = {
  [CATEGORIES.letter]: [
    { identifier: ACTIONS.letterRead, buttonTitle: "标为已读" },
    { identifier: ACTIONS.letterLater, buttonTitle: "晚点再看" },
  ],
  [CATEGORIES.todo]: [
    { identifier: ACTIONS.todoDone, buttonTitle: "完成了" },
    { identifier: ACTIONS.todoSnooze, buttonTitle: "10分钟后再提醒" },
  ],
};

/** 「晚点再看」：1 小时后再提醒一次。 */
export const LETTER_LATER_SECONDS = 60 * 60;
/** 「10 分钟后再叫我」。 */
export const TODO_SNOOZE_SECONDS = 10 * 60;

// ─── 通知数据与点击去向 ──────────────────────────────────────────────────────

export type NotificationOpenTarget = "mailbox" | "todos";

export type ParsedNotification =
  | { kind: "letter"; letterId: number }
  | { kind: "todo"; todoId: number | null };

function finiteNumber(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** 从通知 data 里认出这是哪一类（信 / 待办提醒）；认不出返回 null。 */
export function parseNotificationData(data: unknown): ParsedNotification | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type === "todo_reminder") return { kind: "todo", todoId: finiteNumber(d.todoId) };
  const letterId = finiteNumber(d.letterId);
  if (letterId != null) return { kind: "letter", letterId };
  return null;
}

/** 点通知本体（不是按钮）后去哪个页面。 */
export function openTargetFor(data: unknown): NotificationOpenTarget | null {
  const parsed = parseNotificationData(data);
  if (!parsed) return null;
  return parsed.kind === "todo" ? "todos" : "mailbox";
}
