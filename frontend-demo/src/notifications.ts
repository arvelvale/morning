/**
 * 通知：分频道、带快捷操作、后台也能收信。
 *
 * 来信推送是「轮询兜底」方案（无需 JPush/FCM 账号）：拉后端信箱，发现新的未读来信就发一条本地系统通知。
 * 关键点：RN 的 JS 定时器在 App 退到后台后会停（JavaTimerManager 在 host pause 时清掉帧回调），
 * 所以光靠 setInterval 后台收不到信。后台由原生常驻前台服务（morning-companion）每隔一阵起一次
 * 无头 JS 任务 "MorningLetterPoll"，跑下面的 backgroundPoll()；setInterval 只在没有常驻服务时兜底。
 * 等以后接了 JPush/FCM，把轮询换成监听推送即可，通知渲染这套不用改。
 *
 * 仅在真机（原生）生效；web 下 expo-notifications 无系统通知能力，会自动降级为 no-op。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppRegistry, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { updateCompanionState } from "morning-companion";

import {
  currentTokens, listLetters, loadTokens, markLetterRead, tickOwnKeyJobs, updateTodo, usingOwnKeys,
} from "./api";
import { loadModelKeys } from "./modelKeys";
import {
  ACTIONS,
  CATEGORIES,
  CATEGORY_ACTIONS,
  CHANNELS,
  LETTER_LATER_SECONDS,
  TODO_SNOOZE_SECONDS,
  channelForLetter,
  openTargetFor,
  parseNotificationData,
  type ChannelSpec,
  type NotificationOpenTarget,
} from "./notificationChannels";
import { loadReminders, saveReminders } from "./screens/todos/reminderStore";

const LAST_SEEN_KEY = "morning.lastSeenLetterId";
const POLL_MS = 60_000;
/** 两次拉信的最短间隔：前台定时器、无头任务、手动触发都走同一道，避免重复请求与重复通知。 */
const MIN_POLL_GAP_MS = 45_000;
const BODY_PREVIEW = 60;
/** 无头 JS 任务名，要和原生 LetterPollTaskService.TASK_KEY 一致。 */
const HEADLESS_TASK = "MorningLetterPoll";

let timer: ReturnType<typeof setInterval> | null = null;

// 前台收到通知时也展示横幅（默认前台不弹）。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

function importanceOf(spec: ChannelSpec) {
  return spec.importance === "high"
    ? Notifications.AndroidImportance.HIGH
    : Notifications.AndroidImportance.DEFAULT;
}

/** 建安卓通知频道与带按钮的通知类别。幂等：重复调用只会更新名称 / 描述，已建频道的级别用户说了算。 */
async function ensureChannelsAndCategories(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const spec of Object.values(CHANNELS) as ChannelSpec[]) {
    await Notifications.setNotificationChannelAsync(spec.id, {
      name: spec.name,
      description: spec.description,
      importance: importanceOf(spec),
      enableVibrate: spec.vibrate,
    });
  }
  for (const [id, actions] of Object.entries(CATEGORY_ACTIONS)) {
    await Notifications.setNotificationCategoryAsync(
      id,
      actions.map((a) => ({
        identifier: a.identifier,
        buttonTitle: a.buttonTitle,
        // 按钮在不打开 App 的情况下直接办完（回调里调接口 / 重排通知）
        options: { opensAppToForeground: false },
      })),
    );
  }
}

/** 申请通知权限 + 建安卓通知频道。返回是否已授权。 */
export async function initNotifications(): Promise<boolean> {
  // 安卓 13 起，要先有频道系统才会弹授权框，所以先建频道再申请权限
  try {
    await ensureChannelsAndCategories();
  } catch {
    /* 频道建不上不影响申请权限 */
  }
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  return granted;
}

function preview(body: string): string {
  const s = (body ?? "").replace(/\s+/g, " ").trim();
  return s.length > BODY_PREVIEW ? `${s.slice(0, BODY_PREVIEW)}…` : s;
}

let checking = false;
let lastCheckAt = 0;
let lastPushedUnread = -1;

/**
 * 拉一次信箱：有新未读来信就发通知，并把未读数同步给常驻通知 / 悬浮米露。
 * 重复调用安全（有防重入与最短间隔）；force 绕过最短间隔（用户刚在通知上点了「标为已读」时用）。
 */
export async function checkNewLetters(opts?: { force?: boolean }): Promise<void> {
  if (checking) return;
  if (!opts?.force && Date.now() - lastCheckAt < MIN_POLL_GAP_MS) return;
  checking = true;
  try {
    lastCheckAt = Date.now();
    // 自带密钥的手机：晚间信、睡前提醒这些不再由服务端定时生成，要靠手机带着密钥来触发。
    // 后端立刻返回、在后台慢慢做（一封信要等模型十几秒）；做好的信在之后的轮询里拿到。
    if (usingOwnKeys()) await tickOwnKeyJobs();
    const letters = await listLetters("?unread=true&limit=20");
    if (!Array.isArray(letters)) return;

    const maxId = letters.reduce((m: number, l: any) => Math.max(m, l.id), 0);
    const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
    const lastSeen = raw ? parseInt(raw, 10) : 0;

    let freshCount = 0;
    if (letters.length > 0 && lastSeen === 0) {
      // 首次运行只记基线，不为历史未读信补一堆通知。
      await AsyncStorage.setItem(LAST_SEEN_KEY, String(maxId));
    } else if (letters.length > 0) {
      // 列表按 id 倒序（新的在前）；正序发通知让最新的排在最上面。
      const fresh = letters.filter((l: any) => l.id > lastSeen).reverse();
      for (const l of fresh) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: l.title || "米露来信",
            body: preview(l.body),
            data: { letterId: l.id, type: l.type },
            categoryIdentifier: CATEGORIES.letter,
          },
          trigger: { channelId: CHANNELS[channelForLetter(l.type)].id },
        });
      }
      freshCount = fresh.length;
      if (maxId > lastSeen) await AsyncStorage.setItem(LAST_SEEN_KEY, String(maxId));
    }

    // 未读数变了或有新信才通知原生，免得每分钟都去碰一次服务
    if (letters.length !== lastPushedUnread || freshCount > 0) {
      lastPushedUnread = letters.length;
      void updateCompanionState({ unread: letters.length, wiggle: freshCount > 0 });
    }
  } catch {
    /* 网络/鉴权抖动：忽略，下个周期再拉 */
  } finally {
    checking = false;
  }
}

/** 登录后调用：立即拉一次并开始 60s 轮询（仅在 App 前台时有效，后台由常驻服务的无头任务接手）。重复调用安全。 */
export function startLetterPolling(): void {
  if (timer) return;
  void checkNewLetters();
  timer = setInterval(() => void checkNewLetters(), POLL_MS);
}

/** 注销/退出时调用：停止轮询。 */
export function stopLetterPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastPushedUnread = -1;
}

/**
 * 无头 JS 任务的入口：App 在后台时，原生常驻服务每隔一阵起一次。
 * 进程可能是被服务从零拉起的，所以要先从存储恢复登录态；没登录就什么都不做。
 */
async function backgroundPoll(): Promise<void> {
  await loadTokens();
  if (!currentTokens()) return;
  await loadModelKeys(); // 进程可能是被服务从零拉起的，密钥也要从安全存储读一次
  await checkNewLetters();
}

if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask(HEADLESS_TASK, () => backgroundPoll);
}

/**
 * 设提醒前确认通知权限（第一次点「提醒我」时才会弹系统授权框）。
 * web 没有系统通知，视为可用（只为了能在浏览器里走通界面）。被拒绝返回 false，由调用方 toast 提示去系统设置打开；
 * 拒绝后系统不会再弹框，所以这里不会反复打扰用户。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  try {
    return await initNotifications();
  } catch {
    return false;
  }
}

/**
 * 待办提醒：在本机排一条定时通知（不依赖后端推送）。
 * `at` 是提醒时间（不是事情时间）；`dueClock` 是事情的具体时刻（如 "10:15"），有就写进通知正文；
 * `todoId` 写进通知数据，通知上的「完成了」按钮靠它找到这条待办。
 * 返回通知 id（取消时用）；web / 已过点 / 排失败返回 null。
 */
export async function scheduleTodoReminder(
  petName: string,
  text: string,
  at: Date,
  dueClock?: string,
  todoId?: number,
): Promise<string | null> {
  if (Platform.OS === "web" || at.getTime() <= Date.now()) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `${petName}来叫你啦`,
        body: dueClock ? `${dueClock}  ${preview(text)}` : `说好提醒你：${preview(text)}`,
        data: { type: "todo_reminder", todoId },
        categoryIdentifier: CATEGORIES.todo,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: CHANNELS.todo.id,
      },
    });
  } catch {
    /* 没有通知权限等：忽略 */
    return null;
  }
}

/** 取消一条已排的待办提醒（待办完成 / 删除 / 关掉提醒时）。 */
export async function cancelTodoReminder(notifId: string | null | undefined): Promise<void> {
  if (!notifId || Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notifId);
  } catch {
    /* 已触发或已不存在：忽略 */
  }
}

// ─── 点击通知 / 通知上的快捷操作 ────────────────────────────────────────────

const openListeners = new Set<(target: NotificationOpenTarget) => void>();
let lastClaimedKey = "";

/** 同一次点击可能经「实时回调」和「冷启动补发」各来一次，用这个只认一次。 */
function claim(r: Notifications.NotificationResponse): boolean {
  const key = `${r.notification.request.identifier}|${r.notification.date}|${r.actionIdentifier}`;
  if (key === lastClaimedKey) return false;
  lastClaimedKey = key;
  return true;
}

/** 订阅「用户点了通知本体，该去哪个页面」。返回取消订阅函数。 */
export function onNotificationOpen(cb: (target: NotificationOpenTarget) => void): () => void {
  openListeners.add(cb);
  return () => {
    openListeners.delete(cb);
  };
}

/** 冷启动时：App 是被点通知拉起来的，取出那次点击该去的页面（没有返回 null）。 */
export async function takeInitialOpenTarget(): Promise<NotificationOpenTarget | null> {
  if (Platform.OS === "web") return null;
  try {
    const r = await Notifications.getLastNotificationResponseAsync();
    if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER || !claim(r)) return null;
    await Notifications.clearLastNotificationResponseAsync();
    return openTargetFor(r.notification.request.content.data);
  } catch {
    return null;
  }
}

async function dismiss(r: Notifications.NotificationResponse): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(r.notification.request.identifier);
  } catch {
    /* 已经不在通知栏：忽略 */
  }
}

async function snooze(r: Notifications.NotificationResponse, seconds: number, channelId: string): Promise<string | null> {
  const { title, body, data, categoryIdentifier } = r.notification.request.content;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: title ?? undefined,
        body: body ?? undefined,
        data: (data ?? {}) as Record<string, unknown>,
        categoryIdentifier: categoryIdentifier ?? undefined,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId },
    });
  } catch {
    return null;
  }
}

/** 处理一次通知点击：点本体 → 通知界面跳转；点按钮 → 在这里直接办完。 */
async function handleResponse(r: Notifications.NotificationResponse): Promise<void> {
  const data = r.notification.request.content.data;
  const parsed = parseNotificationData(data);

  if (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    if (!claim(r)) return;
    const target = openTargetFor(data);
    if (target) openListeners.forEach((cb) => cb(target));
    return;
  }
  if (!parsed) return;

  switch (r.actionIdentifier) {
    case ACTIONS.letterRead: {
      if (parsed.kind !== "letter") return;
      await loadTokens();
      try {
        await markLetterRead(parsed.letterId);
      } catch {
        return; // 没标成：留着通知，让用户还能点开看
      }
      await dismiss(r);
      await checkNewLetters({ force: true }); // 未读数少了一封，同步给常驻通知 / 悬浮米露
      return;
    }
    case ACTIONS.letterLater: {
      if (parsed.kind !== "letter") return;
      const type = (data as Record<string, unknown>)?.type as string | undefined;
      await snooze(r, LETTER_LATER_SECONDS, CHANNELS[channelForLetter(type)].id);
      await dismiss(r);
      return;
    }
    case ACTIONS.todoDone: {
      if (parsed.kind !== "todo" || parsed.todoId == null) return;
      await loadTokens();
      try {
        await updateTodo(parsed.todoId, { status: "done" });
      } catch {
        return; // 没改成：留着通知
      }
      // 本机提醒记录里这条也清掉（通知已经响过了，不用再取消）
      const map = await loadReminders();
      if (map[String(parsed.todoId)]) {
        delete map[String(parsed.todoId)];
        await saveReminders(map);
      }
      await dismiss(r);
      return;
    }
    case ACTIONS.todoSnooze: {
      if (parsed.kind !== "todo") return;
      const notifId = await snooze(r, TODO_SNOOZE_SECONDS, CHANNELS.todo.id);
      if (parsed.todoId != null && notifId) {
        // 把本机记录里的「下一次提醒」改成这一条，之后在 App 里取消提醒才取得消
        const map = await loadReminders();
        const key = String(parsed.todoId);
        if (map[key]) {
          map[key] = { at: new Date(Date.now() + TODO_SNOOZE_SECONDS * 1000).toISOString(), notifId };
          await saveReminders(map);
        }
      }
      await dismiss(r);
      return;
    }
  }
}

if (Platform.OS !== "web") {
  // 模块加载时就订阅：无头任务拉起进程、没有任何界面时，通知上的按钮也能响应
  Notifications.addNotificationResponseReceivedListener((r) => {
    void handleResponse(r);
  });
}
