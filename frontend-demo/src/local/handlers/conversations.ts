/**
 * 对话：backend/app/routers/companion/conversations.py + conversation_store.py 的移植。
 *
 * 范围：会话与消息的增删查、桌宠回复（含看图、流式）、记忆召回与聊天记待办。
 * 发消息时顺带做的：记忆召回进提示词、聊天里记待办（P2）。
 * 未移植：内容信号 → 用户画像（P2b，见 spec）。
 */
import { nowIso, parseJson, toJson } from "../db.ts";
import { captureChatTodos } from "../chatTodos.ts";
import { COMPANION_FALLBACK } from "../generated/petPresets.ts";
import {
  LocalHttpError, idParam, intQuery, optionalIntQuery,
  type LocalContext, type LocalEvent, type LocalRouter,
} from "../http.ts";
import { checkImages, ImageRejected, MAX_IMAGES_PER_MESSAGE } from "../imageRules.ts";
import { buildMemoryContext } from "../memoryContext.ts";
import { getMemory } from "../memoryStore.ts";
import { buildCompanionMessages, buildEnvContext, type HistoryItem } from "../prompts.ts";
import { getActivePet, getPet } from "./pets.ts";
import { getOrCreatePrefs } from "./preferences.ts";

const MODES = ["free_chat", "brain_dump", "hard_thing", "review_fragment", "voice_call"];

/** 发给模型时，最近几条带图片的用户消息把图片一起附上；更早的只留一句说明，不再重复上传。 */
export const RESEND_IMAGE_MESSAGES = 2;
export const OLD_IMAGE_NOTE = "（这里发过图片，现在不再附上）";
/** 回复时带上的最近消息条数。 */
const HISTORY_LIMIT = 24;

type Attachment = { file: string; mime: string; bytes?: number };

function convOut(row: any) {
  return {
    id: row.id,
    mode: row.mode,
    pet_id: row.pet_id ?? null,
    fragment_id: row.fragment_id ?? null,
    title: row.title ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function messageOut(ctx: LocalContext, row: any) {
  const attachments = parseJson<Attachment[]>(row.attachments, []);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    images: attachments.map((a) => ctx.images.uri(ctx.userId, a.file)),
  };
}

async function requireConversation(ctx: LocalContext, convId: number) {
  const conv = await ctx.db.get<any>("SELECT * FROM conversations WHERE id = ? AND user_id = ?", [convId, ctx.userId]);
  if (!conv) throw new LocalHttpError(404, "会话不存在");
  return conv;
}

async function addMessage(ctx: LocalContext, convId: number, role: string, content: string, attachments?: Attachment[]) {
  const now = nowIso(ctx.now());
  return await ctx.db.transaction(async (tx) => {
    const r = await tx.run(
      "INSERT INTO conversation_messages (conversation_id, role, content, attachments, created_at) VALUES (?, ?, ?, ?, ?)",
      [convId, role, content, attachments?.length ? toJson(attachments) : null, now],
    );
    if (role === "user") {
      await tx.run("UPDATE conversations SET updated_at = ? WHERE id = ?", [now, convId]);
      const title = content.slice(0, 40) || (attachments?.length ? "[图片]" : null);
      if (title) await tx.run("UPDATE conversations SET title = ? WHERE id = ? AND title IS NULL", [title, convId]);
    }
    return (await tx.get<any>("SELECT * FROM conversation_messages WHERE id = ?", [r.lastInsertRowId]))!;
  });
}

/** 取最近 limit 条（到 through 为止），按时间正序。 */
async function recentMessages(ctx: LocalContext, convId: number, limit: number, through: number) {
  const rows = await ctx.db.all<any>(
    "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id <= ? ORDER BY id DESC LIMIT ?",
    [convId, through, limit],
  );
  return rows.reverse();
}

/** 把历史里的图片附件换成给模型看的 data URL（最近 RESEND_IMAGE_MESSAGES 条），更早的改成一句说明。 */
async function historyForModel(ctx: LocalContext, rows: any[]): Promise<HistoryItem[]> {
  const items: HistoryItem[] = rows.map((r) => ({ role: r.role, content: r.content }));
  let kept = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const attachments = parseJson<Attachment[]>(rows[i].attachments, []);
    if (!attachments.length || rows[i].role !== "user") continue;
    if (kept < RESEND_IMAGE_MESSAGES) {
      const urls: string[] = [];
      for (const a of attachments) {
        const url = await ctx.images.asDataUrl(ctx.userId, a.file, a.mime);
        if (url) urls.push(url);
      }
      if (urls.length) {
        items[i].images = urls;
        kept += 1;
        continue;
      }
    }
    items[i].content = (items[i].content ? items[i].content + "\n" : "") + OLD_IMAGE_NOTE;
  }
  return items;
}

async function petPromptFor(ctx: LocalContext, petId: number | null): Promise<string | null> {
  const pet = (petId != null ? await getPet(ctx, petId) : null) ?? (await getActivePet(ctx));
  return pet?.system_prompt ?? null;
}

async function envContextFor(ctx: LocalContext): Promise<string | null> {
  try {
    const pref = await getOrCreatePrefs(ctx);
    return buildEnvContext(ctx.now(), pref.last_city);
  } catch {
    return null;
  }
}

/** 校验并保存本次的图片，写入用户消息。图片不合要求在回复开始之前就抛错。 */
async function acceptUserMessage(ctx: LocalContext, conv: any, body: any) {
  const text = typeof body?.text === "string" ? body.text : "";
  const rawImages: { data?: string; mime?: string | null }[] = Array.isArray(body?.images) ? body.images : [];
  if (rawImages.length && conv.mode === "voice_call") {
    throw new LocalHttpError(422, "通话里暂时不能发图片");
  }
  let checked;
  try {
    checked = checkImages(rawImages);
  } catch (error) {
    if (error instanceof ImageRejected) throw new LocalHttpError(422, error.message);
    throw error;
  }
  if (!text.trim() && !checked.length) throw new LocalHttpError(422, "说点什么，或者发张图片吧");

  const saved: Attachment[] = [];
  try {
    for (const image of checked) {
      const file = await ctx.images.save(ctx.userId, image.mime, image.base64);
      saved.push({ file: file.file, mime: file.mime, bytes: image.bytes });
    }
    const message = await addMessage(ctx, conv.id, "user", text, saved);
    return { message, text };
  } catch (error) {
    await ctx.images.remove(ctx.userId, saved.map((a) => a.file)).catch(() => undefined); // 消息没存上：不留没人认领的图片
    throw error;
  }
}

/** review_fragment 模式下取片段文本，注入桌宠上下文。只在片段属于同一用户时才带入（隐私隔离）。 */
async function fragmentContextFor(ctx: LocalContext, conv: any): Promise<string | null> {
  if (conv.mode !== "review_fragment" || conv.fragment_id == null) return null;
  const frag = await getMemory(ctx.db, conv.fragment_id);
  if (!frag || frag.user_id !== conv.user_id || frag.is_forgotten) return null;
  return frag.surface_text || frag.content;
}

/**
 * 按当前输入召回记忆上下文（关键词/实体匹配）。best-effort，无实际记忆则返回 null。
 * 这是**用户发起**的对话（用户刚发来这条消息），所以是唯一打开 userInitiated 的入口：
 * 与这条消息相关的 vulnerable/core 记忆可以带进 prompt，米露才接得上用户自己提起的事。
 */
async function memoryContextFor(ctx: LocalContext, query: string): Promise<string | null> {
  try {
    const text = await buildMemoryContext(ctx.db, ctx.userId, { mode: "full", query, userInitiated: true, userText: query, now: ctx.now() });
    return text.includes("- [") ? text : null; // 无记忆行时不注入空围栏
  } catch {
    return null; // 记忆上下文失败绝不阻断对话
  }
}

async function prepareReply(ctx: LocalContext, conv: any, userMessageId: number, text: string) {
  const history = await historyForModel(ctx, await recentMessages(ctx, conv.id, HISTORY_LIMIT, userMessageId));
  // 聊天里说出明确安排会写进待办（只看文字，图片不参与）
  const todos = conv.mode === "free_chat"
    ? await captureChatTodos({ db: ctx.db, model: ctx.model, userId: ctx.userId, now: ctx.now }, text)
    : [];
  const receipt = todos.length ? "已记到待办：" + todos.join("、") + "。" : "";
  const messages = buildCompanionMessages(conv.mode, history, {
    fragmentContext: await fragmentContextFor(ctx, conv),
    memoryContext: await memoryContextFor(ctx, text),
    petPrompt: await petPromptFor(ctx, conv.pet_id),
    envContext: await envContextFor(ctx),
  });
  return { messages, receipt };
}

async function* streamReply(ctx: LocalContext, convId: number, body: any): AsyncGenerator<LocalEvent> {
  const conv = await requireConversation(ctx, convId);
  const { message, text } = await acceptUserMessage(ctx, conv, body);
  const { messages, receipt } = await prepareReply(ctx, conv, message.id, text);

  const parts: string[] = [];
  if (receipt) {
    yield { event: "todo.saved", data: {} };
    parts.push(receipt + "\n\n");
    yield { event: "token", data: { delta: parts[0] } };
  }
  try {
    for await (const delta of ctx.model.stream(messages, { temperature: 0.7 })) {
      parts.push(delta);
      yield { event: "token", data: { delta } };
    }
  } catch {
    // 失败时给一句温和的兜底，不暴露技术错误（与后端 stream_companion 一致）
    parts.push(COMPANION_FALLBACK);
    yield { event: "token", data: { delta: COMPANION_FALLBACK } };
  }
  const content = parts.join("");
  const reply = await addMessage(ctx, convId, "assistant", content);
  yield { event: "done", data: { message_id: reply.id, content } };
}

export function registerConversations(router: LocalRouter): void {
  router.add("POST", "/api/v1/conversations", async (ctx, req) => {
    const mode = req.body?.mode ?? "free_chat";
    if (!MODES.includes(mode)) throw new LocalHttpError(422, "mode 不是有效的对话类型");
    const fragmentId = req.body?.fragment_id ?? null;
    if (mode === "review_fragment" && fragmentId == null) throw new LocalHttpError(422, "回看片段模式需要 fragment_id");
    const now = nowIso(ctx.now());
    const r = await ctx.db.run(
      "INSERT INTO conversations (user_id, mode, pet_id, fragment_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      [ctx.userId, mode, req.body?.pet_id ?? null, fragmentId, now, now],
    );
    return convOut(await requireConversation(ctx, r.lastInsertRowId));
  });

  router.add("GET", "/api/v1/conversations", async (ctx, req) => {
    const limit = intQuery(req, "limit", 20, 1, 100);
    const cursor = optionalIntQuery(req, "cursor");
    const rows = await ctx.db.all(
      "SELECT * FROM conversations WHERE user_id = ?" + (cursor != null ? " AND id < ?" : "") + " ORDER BY id DESC LIMIT ?",
      cursor != null ? [ctx.userId, cursor, limit] : [ctx.userId, limit],
    );
    return rows.map(convOut);
  });

  // 最近一次用过的自由聊天（至少有一条用户消息）；没有返回 null
  router.add("GET", "/api/v1/conversations/latest", async (ctx) => {
    const conv = await ctx.db.get<any>(
      "SELECT c.* FROM conversations c WHERE c.user_id = ? AND c.mode = 'free_chat' " +
        "AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id AND m.role = 'user') " +
        "ORDER BY (SELECT MAX(m.id) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.role = 'user') DESC LIMIT 1",
      [ctx.userId],
    );
    if (!conv) return null;
    const rows = await ctx.db.all("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC", [conv.id]);
    return { ...convOut(conv), messages: rows.map((r) => messageOut(ctx, r)) };
  });

  router.add("GET", "/api/v1/conversations/{conv_id}", async (ctx, req) => {
    const conv = await requireConversation(ctx, idParam(req, "conv_id"));
    const rows = await ctx.db.all("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC", [conv.id]);
    return { ...convOut(conv), messages: rows.map((r) => messageOut(ctx, r)) };
  });

  router.add("DELETE", "/api/v1/conversations/{conv_id}", async (ctx, req) => {
    const conv = await requireConversation(ctx, idParam(req, "conv_id"));
    const rows = await ctx.db.all<any>(
      "SELECT attachments FROM conversation_messages WHERE conversation_id = ? AND attachments IS NOT NULL", [conv.id],
    );
    const files = rows.flatMap((r) => parseJson<Attachment[]>(r.attachments, []).map((a) => a.file));
    await ctx.db.transaction(async (tx) => {
      await tx.run("DELETE FROM conversation_messages WHERE conversation_id = ?", [conv.id]);
      await tx.run("DELETE FROM conversations WHERE id = ?", [conv.id]);
    });
    await ctx.images.remove(ctx.userId, files); // 库里删成了再删文件
    return null;
  });

  router.add("GET", "/api/v1/conversations/{conv_id}/messages", async (ctx, req) => {
    const conv = await requireConversation(ctx, idParam(req, "conv_id"));
    const limit = intQuery(req, "limit", 50, 1, 200);
    const cursor = optionalIntQuery(req, "cursor");
    const rows = await ctx.db.all(
      "SELECT * FROM conversation_messages WHERE conversation_id = ?" + (cursor != null ? " AND id > ?" : "") + " ORDER BY id ASC LIMIT ?",
      cursor != null ? [conv.id, cursor, limit] : [conv.id, limit],
    );
    return rows.map((r) => messageOut(ctx, r));
  });

  // 发消息。流式版本（?stream=true）在下面同一路径另注册，由调用方式区分。
  router.add("POST", "/api/v1/conversations/{conv_id}/messages", async (ctx, req) => {
    const conv = await requireConversation(ctx, idParam(req, "conv_id"));
    const { message, text } = await acceptUserMessage(ctx, conv, req.body);
    const { messages, receipt } = await prepareReply(ctx, conv, message.id, text);
    let replyText: string;
    try {
      replyText = await ctx.model.complete(messages, { temperature: 0.7 });
      if (!replyText) replyText = COMPANION_FALLBACK;
    } catch {
      replyText = COMPANION_FALLBACK;
    }
    if (receipt) replyText = receipt + "\n\n" + replyText;
    const reply = await addMessage(ctx, conv.id, "assistant", replyText);
    return { conversation_id: conv.id, reply: messageOut(ctx, reply) };
  });

  router.add("POST", "/api/v1/conversations/{conv_id}/messages", (ctx, req) =>
    streamReply(ctx, idParam(req, "conv_id"), req.body), { streaming: true });

  // 图片文件由 ImageStore 直接以 file:// 提供，不再有读取接口；越界下标按 404 处理以保持形状一致
  router.add("GET", "/api/v1/conversations/{conv_id}/messages/{message_id}/images/{index}", async (ctx, req) => {
    const conv = await requireConversation(ctx, idParam(req, "conv_id"));
    const row = await ctx.db.get<any>(
      "SELECT attachments FROM conversation_messages WHERE id = ? AND conversation_id = ?", [idParam(req, "message_id"), conv.id],
    );
    const attachments = parseJson<Attachment[]>(row?.attachments, []);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= attachments.length) throw new LocalHttpError(404, "图片不存在");
    return { uri: ctx.images.uri(ctx.userId, attachments[index].file) };
  });
}

export { MAX_IMAGES_PER_MESSAGE };
