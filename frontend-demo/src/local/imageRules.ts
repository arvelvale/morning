/**
 * 聊天图片的校验：backend/app/services/companion/chat_images.py 的移植（同样的上限、同样的中文提示）。
 * 只做校验与文件头识别；落盘由 ImageStore（runtime.ts）负责。
 */

export const MAX_IMAGES_PER_MESSAGE = 3;
export const MAX_IMAGE_BYTES = 1_500_000;
/** base64 比原始数据长约 1/3；先按字符数挡一道，免得为超大输入白白解码。 */
export const MAX_IMAGE_BASE64_CHARS = Math.floor((MAX_IMAGE_BYTES * 4) / 3) + 16;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const extOf = (mime: string): string => EXT[mime] ?? "jpg";

/** 校验不通过；message 是可以直接给用户看的中文。 */
export class ImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejected";
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 严格 base64（要求 4 的倍数、正确补位）的实际字节数；格式不对返回 -1。 */
export function strictBase64Length(text: string): number {
  if (text.length === 0 || text.length % 4 !== 0) return -1;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return -1;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - pad;
}

/** 只解开前 n 个字节（认文件头用，不必解整张图）。 */
export function decodeBase64Prefix(text: string, n: number): number[] {
  const out: number[] = [];
  const chars = Math.ceil((n * 4) / 3);
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < chars && i < text.length && out.length < n; i++) {
    const v = B64.indexOf(text[i]);
    if (v < 0) break;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** 按文件头认类型；认不出返回 null。 */
export function sniffMime(head: number[]): string | null {
  const at = (i: number) => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => at(i) === b)) return "image/png";
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (riff.every((b, i) => at(i) === b) && webp.every((b, i) => at(8 + i) === b)) return "image/webp";
  return null;
}

export interface CheckedImage {
  /** 纯 base64（已去掉 data: 前缀）。 */
  base64: string;
  mime: string;
  bytes: number;
}

/** [{data, mime}] → 校验过的图片；任何一张不合要求就整体拒收。 */
export function checkImages(items: { data?: string; mime?: string | null }[]): CheckedImage[] {
  if (items.length > MAX_IMAGES_PER_MESSAGE) {
    throw new ImageRejected("一次最多发 " + MAX_IMAGES_PER_MESSAGE + " 张图片");
  }
  return items.map((item) => {
    let text = (item.data ?? "").trim();
    if (text.startsWith("data:")) text = text.slice(text.indexOf(",") + 1);
    if (!text) throw new ImageRejected("图片是空的，重新选一张试试");
    if (text.length > MAX_IMAGE_BASE64_CHARS) throw new ImageRejected("图片太大了，换一张小一点的");
    const bytes = strictBase64Length(text);
    if (bytes < 0) throw new ImageRejected("图片没传完整，重新发一次试试");
    if (bytes > MAX_IMAGE_BYTES) throw new ImageRejected("图片太大了，换一张小一点的");
    const mime = sniffMime(decodeBase64Prefix(text, 16));
    if (mime === null) throw new ImageRejected("只支持 JPG、PNG、WebP 图片");
    const declared = item.mime?.toLowerCase();
    if (declared && declared in EXT && declared !== mime) throw new ImageRejected("图片格式有点问题，换一张试试");
    return { base64: text, mime, bytes };
  });
}

/** 附件文件名必须是 32 位小写十六进制 + 扩展名：防目录穿越。 */
export const SAFE_FILE = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
