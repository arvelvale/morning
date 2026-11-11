/**
 * 晚间来信的设置与「今天的信什么时候到」的文案口径。
 *
 * 后端：user_preferences.evening_letter_enabled / evening_letter_time（HH:MM，东八区，默认开启 + 21:30）。
 * 调度每分钟 tick：设定时间到了就写；错过时间点（后端重启等）在设定时间之后 60 分钟内补发，超过当晚不补。
 * 所以前端把一天分三段：没到点 / 写信中（到点后 60 分钟内）/ 今天已错过（显示明天的时间）。
 */
export type EveningLetterPlan = { enabled: boolean; time: string };

export const DEFAULT_EVENING_LETTER: EveningLetterPlan = { enabled: true, time: "21:30" };

/** 与后端 CATCHUP_WINDOW_MINUTES 保持一致。 */
export const CATCHUP_WINDOW_MINUTES = 60;

export type LetterPhase = "waiting" | "writing" | "missed";

export function planFromPreferences(p?: { evening_letter_enabled?: boolean; evening_letter_time?: string } | null): EveningLetterPlan {
  return {
    enabled: p?.evening_letter_enabled ?? DEFAULT_EVENING_LETTER.enabled,
    time: p?.evening_letter_time || DEFAULT_EVENING_LETTER.time,
  };
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 30);
}

export function letterPhase(plan: EveningLetterPlan, now = new Date()): LetterPhase {
  const delta = now.getHours() * 60 + now.getMinutes() - minutesOf(plan.time);
  if (delta < 0) return "waiting";
  return delta <= CATCHUP_WINDOW_MINUTES ? "writing" : "missed";
}

/** 「今晚 21:30」「今天 08:00」「明晚 21:30」：18 点以后叫晚上，其余叫今天/明天。 */
export function letterWhen(plan: EveningLetterPlan, phase: LetterPhase): string {
  const evening = minutesOf(plan.time) >= 18 * 60;
  const day = phase === "missed" ? (evening ? "明晚" : "明天") : (evening ? "今晚" : "今天");
  return `${day} ${plan.time}`;
}
