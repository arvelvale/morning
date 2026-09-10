/**
 * Morning 前端接口层。见 backend/docs/api-design.md。
 *
 * - token 持久化：AsyncStorage 存 access/refresh，启动 loadTokens() 恢复登录态；401 自动 refresh 重试一次。
 * - 流式（聊天/倾倒/片场）：用 ./sse 的 streamSSE（expo/fetch 流式）。
 * - 普通请求：request() 带 Bearer 头 + FastAPI 错误体解析 + 15s 超时。
 *
 * ⚙️ 后端地址优先级：
 *   1. EXPO_PUBLIC_API_BASE 环境变量（推荐；web/APK 构建时注入，含协议与端口）
 *   2. DEFAULT_API_BASE —— 线上 Docker 实例，见 deploy/README.md
 *   本地联调：在 frontend-demo/.env 写 EXPO_PUBLIC_API_BASE=http://127.0.0.1:8000
 *   （Android 真机改成那台电脑的 WLAN IPv4，模拟器用 http://10.0.2.2:8000），然后重启 Expo。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { streamSSE, type SSEEvent } from "./sse";

export { streamSSE };
export type { SSEEvent };

/** 线上后端（223.109.142.152 上的 morning-backend 容器，8000 端口）。 */
const DEFAULT_API_BASE = "http://223.109.142.152:8000";

function resolveApiBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE;
  const base = (fromEnv && fromEnv.trim()) || DEFAULT_API_BASE;
  return base.replace(/\/+$/, "");
}

export const API_BASE = resolveApiBase();

/** 由 API_BASE 推导 WebSocket 地址（http->ws / https->wss）。 */
export function wsUrl(path: string): string {
  return `${API_BASE.replace(/^http/, "ws")}${path}`;
}

/** 带鉴权的 WebSocket 地址：附加 ?token=<access_token>（后端 WS 强制校验，无效即 4401 关闭）。 */
export function wsAuthUrl(path: string): string {
  const t = _tokens?.access_token;
  return t ? `${wsUrl(path)}?token=${encodeURIComponent(t)}` : wsUrl(path);
}

/** 把后端下发的 /static 相对路径拼成可访问的绝对 URL；已是 http(s) 则原样返回。 */
export function absUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export class ApiError extends Error {}

// ─── token 存储 ────────────────────────────────────────────────────────────
const TOKEN_KEY = "morning.tokens";
let _tokens: Tokens | null = null;

export function currentTokens(): Tokens | null {
  return _tokens;
}

/** 启动时调用：从存储恢复登录态。 */
export async function loadTokens(): Promise<Tokens | null> {
  if (_tokens) return _tokens;
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (raw) _tokens = JSON.parse(raw) as Tokens;
  } catch {
    /* ignore */
  }
  return _tokens;
}

export async function saveTokens(t: Tokens): Promise<void> {
  _tokens = t;
  try {
    await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export async function clearTokens(): Promise<void> {
  _tokens = null;
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(): Record<string, string> {
  return _tokens ? { Authorization: `Bearer ${_tokens.access_token}` } : {};
}

// ─── 通用请求 ──────────────────────────────────────────────────────────────
function extractDetail(data: any): string | null {
  if (!data) return null;
  const d = data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  return null;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** 普通接口超时。AI 重活（生图/剧本/整理）必须显式传更长的值，否则会被误判成断网。 */
const DEFAULT_TIMEOUT_MS = 15000;
/** 纯 LLM 文本（场景整理/角色整理）：一次调用几秒到几十秒。 */
export const LLM_TIMEOUT_MS = 90000;
/** LLM + 文生图（建场景要并发出两张图）：实测 60–90s，留足余量。 */
export const IMAGE_TIMEOUT_MS = 240000;

async function rawFetch(
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body != null ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    // 超时（AbortError）和真正的网络错误要分开说，否则用户以为是断网
    if (e?.name === "AbortError") {
      throw new ApiError(`等太久了（超过 ${Math.round(timeoutMs / 1000)} 秒），再试一次`);
    }
    throw new ApiError("连接不上服务器，检查下网络或后端地址");
  } finally {
    clearTimeout(timer);
  }
}

async function tryRefresh(): Promise<boolean> {
  if (!_tokens?.refresh_token) return false;
  try {
    const res = await rawFetch("POST", "/api/v1/auth/refresh", {
      refresh_token: _tokens.refresh_token,
    });
    if (!res.ok) return false;
    const t = (await res.json()) as Tokens;
    await saveTokens(t);
    return true;
  } catch {
    return false;
  }
}

async function request<T = any>(
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _retried = false
): Promise<T> {
  let res = await rawFetch(method, path, body, timeoutMs);

  if (res.status === 401 && !_retried && _tokens?.refresh_token) {
    if (await tryRefresh()) {
      res = await rawFetch(method, path, body, timeoutMs);
    } else {
      await clearTokens();
    }
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* 空 / 非 JSON */
  }
  if (!res.ok) {
    throw new ApiError(extractDetail(data) || "出了点问题，待会儿再试试");
  }
  return data as T;
}

const get = <T = any>(p: string) => request<T>("GET", p);
const post = <T = any>(p: string, b?: unknown, timeoutMs?: number) =>
  request<T>("POST", p, b, timeoutMs);
const patch = <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b);
const put = <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b);
const del = <T = any>(p: string) => request<T>("DELETE", p);

function sseUrl(path: string): string {
  return `${API_BASE}${path}`;
}
function sseHeaders(): Record<string, string> {
  return authHeaders();
}

// ─── 账号 Auth ───────────────────────────────────────────────────────────
export async function register(username: string, password: string): Promise<Tokens> {
  const t = await post<Tokens>("/api/v1/auth/register", { username, password });
  await saveTokens(t);
  return t;
}
export async function login(username: string, password: string): Promise<Tokens> {
  const t = await post<Tokens>("/api/v1/auth/login", { username, password });
  await saveTokens(t);
  return t;
}
export async function logout(): Promise<void> {
  try {
    await post("/api/v1/auth/logout");
  } catch {
    /* 无状态注销，本地清除即可 */
  }
  await clearTokens();
}
export const getMe = () => get("/api/v1/users/me");

// ─── 陪伴 / 对话 ─────────────────────────────────────────────────────────
export const getCompanionHome = () => get("/api/v1/companion/home");
export const listConversations = () => get("/api/v1/conversations");
export const createConversation = (petId: number | null, mode: string) =>
  post("/api/v1/conversations", { pet_id: petId, mode });
export const getConversation = (id: number) => get(`/api/v1/conversations/${id}`);
export const deleteConversation = (id: number) => del<void>(`/api/v1/conversations/${id}`);
/** 发消息并逐字流式接收桌宠回复。onToken 拿增量，返回完整回复。 */
export async function streamChatReply(
  convId: number,
  text: string,
  onToken: (delta: string) => void
): Promise<void> {
  await streamSSE(
    sseUrl(`/api/v1/conversations/${convId}/messages?stream=true`),
    { text },
    (e: SSEEvent) => {
      if (e.event === "token" && e.data?.delta) onToken(e.data.delta);
    },
    { headers: sseHeaders() }
  );
}

// ─── 睡前倾倒 ────────────────────────────────────────────────────────────
/** 提交倾倒，逐条 item.classified + 末尾 receipt 事件。 */
export async function streamBrainDump(
  text: string,
  onEvent: (e: SSEEvent) => void
): Promise<void> {
  await streamSSE(sseUrl("/api/v1/brain-dumps"), { text }, onEvent, {
    headers: sseHeaders(),
  });
}
export const getBrainDump = (id: number) => get(`/api/v1/brain-dumps/${id}`);

// ─── 五类存储（待办等）──────────────────────────────────────────────────
export const listTodos = (q = "") => get(`/api/v1/todos${q}`);
export const createTodo = (b: any) => post("/api/v1/todos", b);
export const updateTodo = (id: number, b: any) => patch(`/api/v1/todos/${id}`, b);
export const deleteTodo = (id: number) => del(`/api/v1/todos/${id}`);
export const listIdeas = () => get("/api/v1/ideas");
export const listSummaries = () => get("/api/v1/summaries");
export const listEmotions = () => get("/api/v1/emotions");

// ─── 信箱 ────────────────────────────────────────────────────────────────
export const getMailbox = () => get("/api/v1/mailbox");
export const listLetters = (q = "") => get(`/api/v1/letters${q}`);
export const getLetter = (id: number) => get(`/api/v1/letters/${id}`);
export const markLetterRead = (id: number) => patch(`/api/v1/letters/${id}`, { read: true });
export const ackLetter = (id: number) => post<{ message: string }>(`/api/v1/letters/${id}/ack`, {});
/** 接受场景邀请信：幂等创建场景，返回 { scene_id, render_kind, theater_id, already_accepted }。 */
export const acceptSceneInvite = (id: number) =>
  post<{ scene_id: number; render_kind: string; theater_id: string | null; already_accepted: boolean }>(
    `/api/v1/letters/${id}/accept-scene`
  );
export const listEphemeral = () => get("/api/v1/ephemeral");
export const keepEphemeral = (id: number) => post(`/api/v1/ephemeral/${id}/keep`);
export const dropEphemeral = (id: number) => del(`/api/v1/ephemeral/${id}`);
export const listTreasures = () => get("/api/v1/treasures");
export const createTreasure = (b: any) => post("/api/v1/treasures", b);
export const deleteTreasure = (id: number) => del(`/api/v1/treasures/${id}`);

// ─── 片场 ────────────────────────────────────────────────────────────────
export const listSceneTemplates = () => get("/api/v1/scenes/templates");

/** 「场景整理」：把用户口述的场景描述交给后端 LLM 抽成结构化字段（不落库）。 */
export interface SceneParseResult {
  title: string;
  place: string;
  people: string;
  relation: string;
  counterpart_action: string;
  counterpart_traits: string[];
  counterpart_traits_text: string;
  intent: string;
  /** false 表示 LLM 不可用、字段是退化结果，需要用户自己补 */
  parsed: boolean;
  /** 用户没提到、建议补充的字段名 */
  missing: string[];
  items: { key: string; label: string; value: string }[];
}
export const parseSceneNarration = (text: string) =>
  post<SceneParseResult>("/api/v1/scenes/parse", { text }, LLM_TIMEOUT_MS);

/** 「TA 在这场对话中」：把用户对角色的介绍整理成行为倾向（只写行为，不贴人格标签）。 */
export const parseSceneRole = (b: {
  name?: string;
  relation?: string;
  desc?: string;
  extra_traits?: string[];
}) => post<{ traits: string[]; parsed: boolean }>("/api/v1/scenes/parse-role", b, LLM_TIMEOUT_MS);

export const listScenes = () => get("/api/v1/scenes");
export const getScene = (id: number) => get(`/api/v1/scenes/${id}`);
/** 删除场景（仅属主，后端 204）。 */
export const deleteScene = (id: number) => del<void>(`/api/v1/scenes/${id}`);
/** 非流即时建场景（方案B 一键进入用）：可带 theater_id，返回含 scene_id/theater_id 的 SceneOut。
 *
 * render_kind=dynamic_image 时后端要跑「剧本 LLM + 两张文生图」，实测 60–90s，
 * 所以走 IMAGE_TIMEOUT_MS（默认 15s 会直接超时，把用户踢回角色设定第一步，别改回去）。 */
export const createScene = (fields: {
  title?: string;
  people?: string;
  place?: string;
  plot?: string;
  intent?: string;
  theater_id?: string | null;
  render_kind?: string | null;
}) =>
  post<{ id: number; theater_id: string | null; render_kind: string; [k: string]: any }>(
    "/api/v1/scenes",
    fields,
    IMAGE_TIMEOUT_MS
  );
export const updateScene = (id: number, b: any) => patch(`/api/v1/scenes/${id}`, b);
export const listCandidates = () => get("/api/v1/candidates");
export const dismissCandidate = (id: number) => del(`/api/v1/candidates/${id}`);
/** 创建场景并逐字生成开场（token/choices/done 事件）。 */
export async function streamCreateScene(fields: any, onEvent: (e: SSEEvent) => void): Promise<void> {
  await streamSSE(sseUrl("/api/v1/scenes?stream=true"), fields, onEvent, { headers: sseHeaders() });
}
/** 通话中·单句实时场景意图识别（方案B）。命中返回 worth:true + seed/theater_id/confidence，否则 worth:false。 */
export interface IntentSeed {
  title?: string;
  people?: string;
  place?: string;
  plot?: string;
  intent?: string;
}
export interface DetectIntentResult {
  worth: boolean;
  seed?: IntentSeed | null;
  render_kind?: string | null;
  theater_id?: string | null;
  confidence?: number | null;
}
export const detectSceneIntent = (text: string) =>
  post<DetectIntentResult>("/api/v1/scenes/detect-intent", { text });
/** 确认候选并逐字揭幕开场。 */
export async function streamConfirmCandidate(id: number, onEvent: (e: SSEEvent) => void): Promise<void> {
  await streamSSE(sseUrl(`/api/v1/candidates/${id}/confirm?stream=true`), null, onEvent, {
    headers: sseHeaders(),
  });
}
/** 提交选择并逐字推进剧情。 */
export async function streamSceneChoice(
  sceneId: number,
  choiceId: string,
  onEvent: (e: SSEEvent) => void
): Promise<void> {
  await streamSSE(
    sseUrl(`/api/v1/scenes/${sceneId}/choices?stream=true`),
    { choice_id: choiceId },
    onEvent,
    { headers: sseHeaders() }
  );
}
/** 「自己说」：提交自由输入的回应并逐字推进剧情。 */
export async function streamSceneCustom(
  sceneId: number,
  customText: string,
  onEvent: (e: SSEEvent) => void
): Promise<void> {
  await streamSSE(
    sseUrl(`/api/v1/scenes/${sceneId}/choices?stream=true`),
    { custom_text: customText },
    onEvent,
    { headers: sseHeaders() }
  );
}
export const calibrateScene = (id: number, roleName: string, adjustment: string) =>
  post(`/api/v1/scenes/${id}/calibrate`, { role_name: roleName, adjustment });
export const settleScene = (id: number, b: any) => post(`/api/v1/scenes/${id}/settlement`, b);
export const getSceneSummary = (id: number) => post(`/api/v1/scenes/${id}/summary`, {});

// ─── 桌宠 / 交接信 ────────────────────────────────────────────────────────
export const listPets = () => get("/api/v1/pets");
export const listPetPresets = () => get("/api/v1/pets/presets");
export const getActivePet = () => get("/api/v1/pets/active");
export const setActivePet = (petId: number | string) => put("/api/v1/pets/active", { petId });
export const listHandoffs = () => get("/api/v1/handoffs");

// ─── 记忆 / 偏好 ─────────────────────────────────────────────────────────
export const listMemories = () => get("/api/v1/memories");
export const deleteMemory = (id: number) => del(`/api/v1/memories/${id}`);
export const clearMemories = () => del("/api/v1/memories");
export const getMemoryReview = (q = "") => get(`/api/v1/memory-review${q}`);
export const getPreferences = () => get("/api/v1/preferences");
export const updatePreferences = (b: any) => patch("/api/v1/preferences", b);
export type UserProfileItem = {
  id: number;
  category: string;
  statement: string;
  confidence: number;
  evidence_count: number;
  evidence_sources: string[];
  sensitivity: string;
  updated_at: string;
};
export type UserProfile = { learning_enabled: boolean; items: UserProfileItem[] };
export const getUserProfile = () => get<UserProfile>("/api/v1/profile");
export const correctUserProfile = (id: number, statement: string) =>
  patch<UserProfileItem>(`/api/v1/profile/${id}`, { statement });
export const deleteUserProfile = (id: number) => del(`/api/v1/profile/${id}`);
/** 上报最近一次模糊位置（供后端天气/环境上下文）。 */
export const reportLocation = (lat: number, lon: number, city?: string) =>
  post("/api/v1/preferences/location", { lat, lon, city });

// ─── 语音 ────────────────────────────────────────────────────────────────
/** 上传录音文件到 AI 网关 /ai/stt，返回 { text, usage }。 */
export async function sttOnce(
  uri: string,
  type = "wav"
): Promise<{ text: string; usage?: any }> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    form.append("file", blob, `recording.${type}`);
  } else {
    form.append("file", { uri, name: `recording.${type}`, type: `audio/${type}` } as any);
  }
  form.append("type", type);

  const res = await fetch(`${API_BASE}/ai/stt`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new ApiError(extractDetail(data) || "语音转文字失败");
  }
  return data as { text: string; usage?: any };
}

/** 桌宠语音回复：文本 -> 阶跃 TTS，返回可播放的 {url}（失败时 url 为 null）。 */
export const synthTts = (text: string, voice?: string) =>
  post<{ url: string | null }>("/ai/tts", { text, voice });

/** 应用版本发布信息（公开接口，启动检查更新）。 */
export interface AppVersionInfo {
  latest: string;
  min_supported: string;
  version_code: number | null;
  apk_url: string;
  apk_sha256: string;
  size_bytes: number | null;
  size_mb: number | null;
  mandatory: boolean;
  changelog: string[];
}

/** 拉取最新版本信息（无需登录）；前端据此与本地包版本比较是否提示更新。 */
export const getAppVersion = () => get<AppVersionInfo>("/api/v1/app/version");
