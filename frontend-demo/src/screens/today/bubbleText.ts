/**
 * 首页桌宠气泡的文案取舍（纯函数，node 可测：scripts/test-todos-reminders.mjs）。
 *
 * 气泡上的话来自后端 GET /companion/home 的 invitation.text：有未读来信时就是「最新一封未读信的标题」。
 * 睡前提醒这封信的标题是「该歇一歇了 🌙」，用户睡前没拆、第二天早上打开 App 它还是最新未读，
 * 米露就在大清早说「该歇一歇了」。所以夜间类文案只在夜里放行。
 */

/** 夜间窗口：设计值「20:00 – 次日 5:00」→ hour >= 20 || hour < 5。 */
export function inNightWindow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 20 || h < 5;
}

/** 睡前 / 晚安一类只适合夜里说的话。 */
export function isNightCopy(text: string): boolean {
  return /歇|睡|晚安|🌙/.test(text);
}

/** 去掉 emoji（设计口径：米露的话里不放 emoji；标题是后端生成的，在这里兜底）。 */
export function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
}

/** 返回该冒泡的文案；夜间类内容在白天返回 null（不冒泡）。 */
export function invitationBubble(text: unknown, now = new Date()): string | null {
  if (typeof text !== "string") return null;
  const t = stripEmoji(text);
  if (!t) return null;
  if (isNightCopy(text) && !inNightWindow(now)) return null;
  return t;
}
