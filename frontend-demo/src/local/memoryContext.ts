/**
 * 记忆的隐私口径 + 上下文构建：
 *   backend/app/services/memory/privacy.py 与 context_builder.py 的移植（逐行为对齐，见 memory-golden.json）。
 *
 * 云端模型 prompt 的口径（产品拍板）：脆弱记忆（vulnerable/core）**只在用户自己提起时用，米露绝不主动翻出**：
 * - 米露主动发起的路径（晚间来信、周报、问候、推荐场景、做梦等）一律用 filterForCloudPrompt：
 *   剔除 vulnerable/core 与 burn_after_read；
 * - 用户发起的对话（只有聊天）可用 selectUserRaisedSensitive：仅当用户当前这条消息与某条 vulnerable/core
 *   相关时放进本次 prompt，有条数/字符预算；
 * - burn_after_read 任何路径都不放。
 */
import { cnDate, cnClock, hasSpecificTime, nowContextText, parseStoredTime } from "./clock.ts";
import type { Db } from "./db.ts";
import { BACKREF_SOURCE, STOP_CHARS, USER_RAISED_NOTE } from "./generated/memoryPrompts.ts";
import { listByDepth, listByLayer, type MemoryItem } from "./memoryStore.ts";

const EXTERNAL_FORBIDDEN_DEPTHS = new Set(["vulnerable", "core"]);

/** 云端模型 prompt 前过滤：剔除 vulnerable/core 与即焚记忆。 */
export function filterForCloudPrompt(items: MemoryItem[]): MemoryItem[] {
  return items.filter((i) => !EXTERNAL_FORBIDDEN_DEPTHS.has(i.depth) && i.privacy !== "burn_after_read");
}

// ─── 用户发起时的脆弱记忆放行 ───────────────────────────────────────────────
/** 相关度打分：实体命中 3 分，不含停用字的二字组命中 1 分/个。 */
export const USER_RAISED_MIN_SCORE = 3;
/** 预算：最多 2 条、合计 300 字符（比普通 episodic 的 5 条/600 字更紧）。 */
export const USER_RAISED_MAX_ITEMS = 2;
export const USER_RAISED_MAX_CHARS = 300;

const STOP = new Set([...STOP_CHARS]);
const BACKREF = new RegExp(BACKREF_SOURCE);

/** 文本里「有区分度」的相邻二字组（含 ASCII 词的整词，长度>=2）。 */
function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.match(/[A-Za-z0-9]{2,}/g) ?? []) out.add(word.toLowerCase());
  for (const seg of text.match(/[一-鿿]+/g) ?? []) {
    const chars = [...seg];
    for (let i = 0; i + 1 < chars.length; i++) {
      if (!STOP.has(chars[i]) && !STOP.has(chars[i + 1])) out.add(chars[i] + chars[i + 1]);
    }
  }
  return out;
}

/** 这条记忆与用户当前消息的相关度（确定性、纯本地，不调模型）。 */
export function userRaisedRelevance(item: MemoryItem, cueText: string): number {
  if (!cueText) return 0;
  let score = 0;
  for (const e of item.entities ?? []) {
    if (typeof e === "string" && [...e].length >= 2 && !e.startsWith("signal-key:") && cueText.includes(e)) score += 3;
  }
  const target = (item.content || "") + "\n" + (item.surface_text || "");
  const a = bigrams(cueText);
  for (const g of bigrams(target)) if (a.has(g)) score += 1;
  return score;
}

/** 用户是否在回指「之前说过的那件事」。 */
export const hasBackrefCue = (cueText: string | null | undefined): boolean => !!cueText && BACKREF.test(cueText);

export function selectUserRaisedSensitive(
  items: MemoryItem[],
  cueText: string | null | undefined,
  opts: { maxItems?: number; maxChars?: number; minScore?: number } = {},
): MemoryItem[] {
  const { maxItems = USER_RAISED_MAX_ITEMS, maxChars = USER_RAISED_MAX_CHARS, minScore = USER_RAISED_MIN_SCORE } = opts;
  if (!cueText || !cueText.trim()) return [];
  const sensitive = items.filter((i) => EXTERNAL_FORBIDDEN_DEPTHS.has(i.depth) && i.privacy !== "burn_after_read" && !i.is_forgotten);
  const hits = sensitive
    .map((i) => ({ score: userRaisedRelevance(i, cueText), item: i }))
    .filter((x) => x.score >= minScore)
    .sort((x, y) => y.score - x.score || (y.item.id || 0) - (x.item.id || 0));
  let picked = hits.map((x) => x.item);
  if (!picked.length && hasBackrefCue(cueText) && sensitive.length) {
    picked = [sensitive.reduce((best, i) => ((i.id || 0) > (best.id || 0) ? i : best))]; // id 自增，最大即最近
  }
  const out: MemoryItem[] = [];
  let used = 0;
  for (const i of picked.slice(0, maxItems)) {
    const n = [...(i.surface_text || i.content || "")].length;
    if (used + n > maxChars) break;
    out.push(i);
    used += n;
  }
  return out;
}

// ─── 上下文构建 ───────────────────────────────────────────────────────────
export const FENCE_OPEN = "<memory-context>";
export const FENCE_CLOSE = "</memory-context>";

/** layer → [条数上限, 字符预算] */
export const DEFAULT_BUDGETS: Record<string, [number, number]> = {
  profile: [5, 600],
  state: [5, 400],
  episodic: [5, 600],
};

/**
 * 待办的截止提示。已过期且还没完成的待办标「已过期」而不是丢掉：
 * 用户可能正问「那个材料交了吗」，丢掉会答非所问。
 */
function dueNote(m: MemoryItem, now: Date): string {
  if (!m.due_date || m.kind !== "待办") return "";
  const due = parseStoredTime(m.due_date);
  const when = cnDate(due) + (hasSpecificTime(due) ? " " + cnClock(due) : "");
  if ((m.status || "pending") === "pending" && due.getTime() < now.getTime()) {
    return "（已过期，原定" + when + "，不要当作还没到的事）";
  }
  return "（截止" + when + "）";
}

/** 按预算裁剪一组记忆为文本行。每条标上记下的日期（东八区），避免旧事被当成「刚说的」。 */
function render(items: MemoryItem[], budget: [number, number], now: Date): string[] {
  const [maxItems, maxChars] = budget;
  const lines: string[] = [];
  let used = 0;
  for (const m of items.slice(0, maxItems)) {
    const noted = m.created_at ? " · " + cnDate(m.created_at) + "记下" : "";
    const line = "- [" + m.kind + noted + "] " + (m.surface_text || m.content) + dueNote(m, now);
    const size = [...line].length;
    if (used + size > maxChars) break;
    lines.push(line);
    used += size;
  }
  return lines;
}

/** 中英文混合分词：英文按空格，中文按字符 bigram。 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (/^[\x00-\x7f]*$/.test(word)) {
      if (word.length >= 2) tokens.push(word.toLowerCase());
    } else {
      const chars = [...word].filter((c) => !/\s/.test(c));
      for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i] + chars[i + 1]);
      if (chars.length === 1) tokens.push(chars[0]); // 单字也保留（短查询兜底）
    }
  }
  return tokens;
}

/** 召回打分：entities 命中权重高，bigram 命中权重低。 */
export function keywordScore(query: string, item: MemoryItem): number {
  let score = 0;
  for (const e of item.entities ?? []) if (e && typeof e === "string" && query.includes(e)) score += 3;
  const target = item.content + item.surface_text;
  for (const tok of tokenize(query)) if (target.includes(tok)) score += 1;
  return score;
}

export interface BuildContextOptions {
  mode?: "profile" | "query" | "full";
  query?: string | null;
  budgets?: Record<string, [number, number]>;
  /** 仅「用户发起的对话」显式传入（默认关闭）。米露主动路径不得传。 */
  userInitiated?: boolean;
  userText?: string | null;
  now: Date;
}

/** 组装记忆上下文（围栏包裹的字符串）。任何一段检索失败都只丢该段，绝不阻断主流程。 */
export async function buildMemoryContext(db: Db, userId: number, opts: BuildContextOptions): Promise<string> {
  const mode = opts.mode ?? "full";
  const budgets = opts.budgets ?? DEFAULT_BUDGETS;
  const sections: string[] = [];
  const seen = new Set<number>();

  const take = (layer: string, items: MemoryItem[]) => {
    // 隐私红线：默认路径（米露主动）vulnerable/core 与即焚记忆一律不进 prompt
    const fresh = filterForCloudPrompt(items).filter((m) => !seen.has(m.id));
    for (const m of fresh) seen.add(m.id);
    sections.push(...render(fresh, budgets[layer] ?? [5, 400], opts.now));
  };

  if (mode === "profile" || mode === "full") {
    try { take("profile", await listByLayer(db, userId, "profile")); } catch { /* 退化为空段 */ }
    try { take("state", await listByLayer(db, userId, "state")); } catch { /* 退化为空段 */ }
  }
  if ((mode === "query" || mode === "full") && opts.query) {
    try {
      const episodic = await listByLayer(db, userId, "episodic");
      const hits = episodic
        .map((m, index) => ({ score: keywordScore(opts.query!, m), m, index }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index) // 同分保持原顺序（与 Python 稳定排序一致）
        .map((x) => x.m);
      take("episodic", hits);
    } catch { /* 退化为空段 */ }
  }
  if (opts.userInitiated && opts.userText && (mode === "query" || mode === "full")) {
    try {
      const sensitive: MemoryItem[] = [];
      for (const depth of ["vulnerable", "core"]) sensitive.push(...(await listByDepth(db, userId, depth)));
      const raised = selectUserRaisedSensitive(sensitive, opts.userText).filter((m) => !seen.has(m.id));
      if (raised.length) {
        for (const m of raised) seen.add(m.id);
        sections.push(USER_RAISED_NOTE);
        sections.push(...raised.map((m) => "- [" + m.kind + "] " + (m.surface_text || m.content)));
      }
    } catch { /* 退化为空段 */ }
  }

  let body = sections.join("\n");
  if (sections.length) {
    // 告诉模型「今天」，记忆里的相对说法（明天/下周）才能对着记下日期推算
    body = "（" + nowContextText(opts.now) + "；下列条目标注的是记下的日期，已过去的事不要说成明天）\n" + body;
  }
  return FENCE_OPEN + "\n" + body + "\n" + FENCE_CLOSE;
}
