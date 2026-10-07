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
 * 待办的明早提醒：在本机排一条定时通知（不依赖后端推送）。
 * web 没有系统通知，直接跳过；排失败也不影响后端那边已经记下的截止时间。
 */
export async function scheduleTodoReminder(petName: string, text: string, at: Date): Promise<void> {
  if (Platform.OS === "web" || at.getTime() <= Date.now()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${petName}来叫你啦`,
        body: `说好今早提醒你：${preview(text)}`,
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
  }
}
