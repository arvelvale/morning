/**
 * 桌宠回应的消息组装：backend/app/graphs/companion.py `_build_messages` 的逐字移植。
 * 人设底色、各 mode 提示在 generated/petPresets.ts（由后端导出，不要手改）。
 * 黄金对照：scripts/fixtures/companion-messages.json（scripts/test-local-llm.mjs 逐字比对）。
 */
import { BASE_PERSONA, MODE_HINTS } from "./generated/petPresets.ts";
import type { ChatMessage, ChatPart } from "./llm.ts";

export interface HistoryItem {
  role: string;
  content: string;
  /** 要发给模型看的图片（data URL），由调用方挑好放进来。 */
  images?: string[];
}

export interface PromptContext {
  fragmentContext?: string | null;
  memoryContext?: string | null;
  petPrompt?: string | null;
  envContext?: string | null;
}

const DEFAULT_HINT = MODE_HINTS["free_chat"];

export function buildCompanionMessages(mode: string, history: HistoryItem[], ctx: PromptContext = {}): ChatMessage[] {
  let system = BASE_PERSONA;
  if (ctx.petPrompt) system += "\n\n## 你的人格与角色\n" + ctx.petPrompt;
  system += "\n" + (MODE_HINTS[mode] ?? DEFAULT_HINT);
  if (ctx.memoryContext) {
    system +=
      "\n\n下面是你对这位用户的一些记忆，只作背景参考、自然地融入对话，" +
      "不要机械复述、更不要提及「记忆」「系统」「上下文」这类字眼。" +
      "其中的长期理解可能不完整或已经过时，只能当作待验证线索；" +
      "除非用户当下明确确认，否则用试探语气，绝不能断言用户是什么样的人：\n" +
      ctx.memoryContext;
  }
  if (ctx.envContext) {
    system += "\n\n## 此刻的环境（自然融入对话即可，别生硬报时报天气）\n" + ctx.envContext;
  }
  if (mode === "review_fragment" && ctx.fragmentContext) {
    system += "\n\n要一起回看的片段：\n" + ctx.fragmentContext;
  }
  system +=
    "\n\n真实操作由应用执行，并单独展示保存回执。你的回复只负责对话，" +
    "请别说已经帮对方记下、存好、托着这件事或会提醒对方，也别复述保存回执。";

  if (history.some((m) => m.images && m.images.length)) {
    system +=
      "\n\n用户这次发了图片。先自然地说说你在图里看到了什么，再回应对方的心情或问题；" +
      "看不清、拿不准的地方就直说，不要编造图里没有的细节，也不要对图里的人做评判。";
  }

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "assistant") {
      messages.push({ role: "assistant", content: m.content ?? "" });
      continue;
    }
    const content = m.content ?? "";
    const images = m.images ?? [];
    if (images.length) {
      const parts: ChatPart[] = content ? [{ type: "text", text: content }] : [];
      for (const url of images) parts.push({ type: "image_url", image_url: { url } });
      messages.push({ role: "user", content: parts });
    } else {
      messages.push({ role: "user", content });
    }
  }
  return messages;
}

/** 此刻的环境（时间段 + 城市 + 天气）。后端是东八区；本地模式用手机本地时间。 */
export function buildEnvContext(
  now: Date,
  city: string | null | undefined,
  weather?: { condition?: string | null; temperature?: number | null } | null,
): string {
  const h = now.getHours();
  const period = h < 6 ? "凌晨" : h < 11 ? "早上" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上";
  const parts = ["现在是 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日" + period + " " + h + " 点左右"];
  if (city) parts.push("用户在" + city);
  if (weather?.condition) {
    parts.push("天气" + weather.condition + (weather.temperature != null ? "、气温 " + weather.temperature + "°C" : ""));
  }
  return parts.join("，") + "。";
}
