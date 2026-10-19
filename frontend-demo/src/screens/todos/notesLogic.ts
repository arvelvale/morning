/**
 * 「随手记」的数据整理（纯函数，node 可测：scripts/test-todos-reminders.mjs）。
 *
 * 三个来源合成一列：
 * - 灵感 GET /ideas；
 * - 带保存期的寄存 GET /ephemeral（情绪、片段……，有 expires_at，可珍藏 / 放下）；
 * - 记下的瞬间 GET /candidates（片段，可能带 evidence = 用户原话）。
 * 同一个 id 的瞬间可能同时出现在寄存和候选里，合并成一行，候选里的字段优先（它才有 evidence）。
 */

export type NoteSeal = "想" | "情" | "瞬";

export const SEAL_LABEL: Record<NoteSeal, string> = { 想: "灵感", 情: "情绪", 瞬: "瞬间" };

export type NoteRow = {
  key: string;
  id: number;
  seal: NoteSeal;
  /** 整理后的话（surface_text，没有就用 content） */
  text: string;
  /** 用户原话；后端没给就是 null，详情里就不显示这一块 */
  evidence: string | null;
  createdAt: string;
  /** 寄存条目的到期时间；没有保存期为 null */
  expiresAt: string | null;
  /** 有保存期的才能珍藏 / 放下 */
  keepable: boolean;
};

/** 后端 kind → 单字章（情绪→情，片段/候选→瞬，其余→想）。 */
export function sealOfKind(kind: string): NoteSeal {
  if (kind === "emotion" || kind === "情绪") return "情";
  if (kind === "fragment" || kind === "片段" || kind === "候选") return "瞬";
  return "想";
}

/** evidence 可能是字符串，也可能是 {text}/{quote} 或它们的数组；取出能给人看的原话。 */
export function evidenceText(raw: any): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw)) {
    const parts = raw.map(evidenceText).filter((x): x is string => !!x);
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof raw === "object") return evidenceText(raw.text ?? raw.quote ?? raw.content ?? null);
  return null;
}

const textOf = (it: any) => String(it?.surface_text || it?.content || "").trim();

function parseTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const momentTime = parseTime;

/** 「10月19日 21:05」 */
export function clockText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 合成随手记的列表，新的在前。 */
export function buildNotes(ideas: any[], ephem: any[], candidates: any[]): NoteRow[] {
  const byId = new Map<number, NoteRow>();
  for (const it of ideas) {
    const id = Number(it.id);
    byId.set(id, {
      key: `idea-${id}`, id, seal: "想", text: textOf(it), evidence: evidenceText(it.evidence),
      createdAt: String(it.created_at ?? ""), expiresAt: null, keepable: false,
    });
  }
  for (const it of ephem) {
    const kind = String(it.kind || "");
    if (kind === "待办" || kind === "小结") continue; // 待办在「待办」页，不重复
    const id = Number(it.id);
    byId.set(id, {
      key: `eph-${id}`, id, seal: sealOfKind(kind), text: textOf(it), evidence: evidenceText(it.evidence),
      createdAt: String(it.created_at ?? ""), expiresAt: it.expires_at ?? null, keepable: true,
    });
  }
  for (const it of candidates) {
    const id = Number(it.id);
    const prev = byId.get(id);
    byId.set(id, {
      key: prev?.key ?? `cand-${id}`, id, seal: "瞬", text: textOf(it) || prev?.text || "",
      evidence: evidenceText(it.evidence) ?? prev?.evidence ?? null,
      createdAt: String(it.created_at ?? prev?.createdAt ?? ""),
      expiresAt: prev?.expiresAt ?? null, keepable: prev?.keepable ?? false,
    });
  }
  return [...byId.values()]
    .filter((r) => r.text)
    .sort((a, b) => (parseTime(b.createdAt)?.getTime() ?? 0) - (parseTime(a.createdAt)?.getTime() ?? 0));
}
