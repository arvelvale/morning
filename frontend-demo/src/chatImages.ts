/**
 * 聊天图片的纯逻辑：尺寸、大小、错误信息（不依赖 RN / expo，方便单测）。
 * 限制与后端 services/companion/chat_images.py 一致：每条消息最多 3 张，单张 1.5 MB 以内。
 * 图片只用于这次对话里让桌宠看图回应，不进记忆。
 */

export const MAX_IMAGES_PER_MESSAGE = 3;
export const MAX_IMAGE_BYTES = 1_500_000;
/** 发之前把长边压到这个尺寸：看图够用，流量和模型的 token 都省。 */
export const MAX_SIDE = 1280;
/** 压一次还超限时再试一档更小的。 */
export const FALLBACK_SIDE = 960;

export interface PickedImage {
  /** 本机文件地址，只用来显示缩略图。 */
  uri: string;
  /** base64（不带 data: 前缀），发给后端。 */
  data: string;
  mime: string;
}

/** 把 w×h 等比缩到长边不超过 maxSide；本来就够小返回 null（不用缩）。只给出要改的那一边。 */
export function fitWithin(w: number, h: number, maxSide: number): { width: number } | { height: number } | null {
  if (!(w > 0) || !(h > 0)) return null;
  if (Math.max(w, h) <= maxSide) return null;
  return w >= h ? { width: maxSide } : { height: maxSide };
}

/** base64 字符串解码后的字节数。 */
export function base64Bytes(b64: string): number {
  const s = b64.replace(/\s+/g, "");
  if (!s) return 0;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** 流式接口失败时抛的是响应原文（JSON）；取出后端给用户看的那句话，取不到返回 null。 */
export function sseErrorDetail(err: unknown): string | null {
  const raw = (err as { message?: unknown } | null)?.message;
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return null;
  try {
    const detail = JSON.parse(raw)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;
  } catch {
    /* 不是 JSON */
  }
  return null;
}
