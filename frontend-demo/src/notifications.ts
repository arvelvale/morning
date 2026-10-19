/**
 * 内容推送②（先轮询兜底方案）。
 *
 * 无需任何推送账号（JPush/FCM）：前端每 60s 拉一次后端信箱，发现有新的未读来信
 * （含每晚 21:30 的 LLM 晚间来信）就触发一条本地系统通知。等以后接了 JPush/FCM，
 * 把 startLetterPolling 换成监听推送即可，通知渲染这套不用改。
 *
 * 仅在真机（原生）生效；web 下 expo-notifications 无系统通知能力，会自动降级为 no-op。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { listLetters } from "./api";

const LAST_SEEN_KEY = "morning.lastSeenLetterId";
const CHANNEL_ID = "morning-letters";
const POLL_MS = 60_000;
const BODY_PREVIEW = 60;

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

/** 申请通知权限 + 建安卓通知渠道。返回是否已授权。 */
export async function initNotifications(): Promise<boolean> {
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "来信提醒",
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: true,
    });
  }
  return granted;
}

function preview(body: string): string {
  const s = (body ?? "").replace(/\s+/g, " ").trim();
  return s.length > BODY_PREVIEW ? `${s.slice(0, BODY_PREVIEW)}…` : s;
}

async function checkNewLetters(): Promise<void> {
  try {
    const letters = await listLetters("?unread=true&limit=20");
    if (!Array.isArray(letters) || letters.length === 0) return;

    const maxId = letters.reduce((m: number, l: any) => Math.max(m, l.id), 0);
    const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
    const lastSeen = raw ? parseInt(raw, 10) : 0;

    // 首次运行只记基线，不为历史未读信补一堆通知。
    if (lastSeen === 0) {
      await AsyncStorage.setItem(LAST_SEEN_KEY, String(maxId));
      return;
    }

    // 列表按 id 倒序（新的在前）；正序发通知让最新的排在最上面。
    const fresh = letters.filter((l: any) => l.id > lastSeen).reverse();
    for (const l of fresh) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: l.title || "米露来信",
          body: preview(l.body),
          data: { letterId: l.id, type: l.type },
        },
        trigger: null, // 立即
      });
    }
    if (maxId > lastSeen) await AsyncStorage.setItem(LAST_SEEN_KEY, String(maxId));
  } catch {
    /* 网络/鉴权抖动：忽略，下个周期再拉 */
  }
}

/** 登录后调用：立即拉一次并开始 60s 轮询。重复调用安全。 */
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
 * `at` 是提醒时间（不是事情时间）；`dueClock` 是事情的具体时刻（如 "10:15"），有就写进通知正文。
 * 返回通知 id（取消时用）；web / 已过点 / 排失败返回 null。
 */
export async function scheduleTodoReminder(petName: string, text: string, at: Date, dueClock?: string): Promise<string | null> {
  if (Platform.OS === "web" || at.getTime() <= Date.now()) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `${petName}来叫你啦`,
        body: dueClock ? `${dueClock}  ${preview(text)}` : `说好提醒你：${preview(text)}`,
        data: { type: "todo_reminder" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: CHANNEL_ID,
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
