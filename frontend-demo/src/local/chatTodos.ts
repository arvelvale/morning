/**
 * 聊天里记待办：backend/app/services/companion/chat_todos.py 的移植。
 * 识别并保存用户当前这句话里的明确安排（「我明天上午11点有面试哈」→「参加面试」）。
 * 只对确实写进待办的事返回描述；任何失败都吞掉，不影响聊天。
 */
import { cnClock, cstDay, cstParts, hasSpecificTime, parseDueAt } from "./clock.ts";
import type { Db } from "./db.ts";
import { runExtractor } from "./extractor.ts";
import { CHAT_TODO_CUE_SOURCE } from "./generated/memoryPrompts.ts";
import type { ModelClient } from "./llm.ts";
import { createMemory } from "./memoryStore.ts";

/** 没有时间或动作线索的闲聊不调模型，避免每轮多一次调用。 */
const CUE = new RegExp(CHAT_TODO_CUE_SOURCE);
const REPLY_PREFIX = "（我在回复你刚写给我的信：";
const MAX_TITLE = 120;
const MIN_CONFIDENCE = 0.85;
const MAX_PER_MESSAGE = 3;

export interface ChatTodoDeps {
  db: Db;
  model: ModelClient;
  userId: number;
  now: () => Date;
}

/** Python 的 " ".join(s.split()).strip("。！! ") */
function normalizeTitle(title: string): string {
  const collapsed = title.split(/\s+/).filter(Boolean).join(" ");
  return collapsed.replace(/^[。！! ]+|[。！! ]+$/g, "");
}

export async function captureChatTodos(deps: ChatTodoDeps, message: string): Promise<string[]> {
  if (message.startsWith(REPLY_PREFIX) || !CUE.test(message)) return [];
  const { db, userId } = deps;
  const now = deps.now();
  const saved: string[] = [];
  try {
    const facts = await runExtractor(deps.model, message, { now, todoOnly: true });
    for (const fact of facts.slice(0, MAX_PER_MESSAGE)) {
      let title = fact.content;
      const evidence = fact.evidence;
      if (
        fact.kind !== "待办" || fact.layer !== "episodic" || fact.confidence < MIN_CONFIDENCE ||
        typeof title !== "string" || typeof evidence !== "string" || !evidence.trim() || !message.includes(evidence.trim())
      ) continue;
      title = normalizeTitle(title);
      if (!title || [...title].length > MAX_TITLE) continue;

      const due = parseDueAt(fact.due_at, fact.has_time);
      if (fact.due_at && due === null) continue;
      if (due !== null) {
        // 已经过去的日期 / 今天已过去的时刻不记
        if (cstDay(due) < cstDay(now) || (hasSpecificTime(due) && due.getTime() < now.getTime())) continue;
      }

      // 同一件事（标题 + 截止时间都相同、还没做完）不重复记
      const dupe = await db.get(
        "SELECT id FROM memory_items WHERE user_id = ? AND kind = '待办' AND is_latest = 1 AND is_forgotten = 0 AND content = ? AND " +
          (due ? "due_date = ?" : "due_date IS NULL") + " AND (status = 'pending' OR status IS NULL) LIMIT 1",
        due ? [userId, title, due.toISOString()] : [userId, title],
      );
      if (!dupe) {
        await createMemory(db, {
          userId, layer: "episodic", kind: "待办", depth: fact.depth, content: title, status: "pending",
          dueDate: due, confidence: fact.confidence, actor: "chat_todo", now,
        });
      }

      let label = title;
      if (due !== null) {
        const local = cstParts(due);
        label += "（" + local.month + "月" + local.day + "日";
        if (hasSpecificTime(due)) label += " " + cnClock(due);
        label += "）";
      }
      if (!saved.includes(label)) saved.push(label);
    }
  } catch {
    // 记待办失败不影响聊天
  }
  return saved;
}
