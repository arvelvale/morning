/**
 * 常驻陪伴前台服务①的 JS 侧封装。
 *
 * 仅 Android 原生生效；web / iOS / 未编进原生的场景下 requireOptionalNativeModule
 * 返回 null，这里所有调用降级为 no-op，不会崩。
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";
import { createCompanionTaskQueue } from "./serviceTasks";

type MorningCompanionModule = {
  startCompanionService: (petName: string, petKind: string | null, force: boolean | null) => Promise<boolean>;
  stopCompanionService: () => Promise<boolean>;
  isCompanionPaused: () => Promise<boolean>;
  hasOverlayPermission: () => Promise<boolean>;
  requestOverlayPermission: () => Promise<boolean>;
  setOverlayEnabled: (enabled: boolean) => Promise<boolean>;
  updateCompanionState: (unread: number, petName: string | null, petKind: string | null, wiggle: boolean | null) => Promise<boolean>;
  consumeLaunchTarget: () => Promise<string | null>;
};

const Native = requireOptionalNativeModule<MorningCompanionModule>("MorningCompanion");

// ─── 麦克风裸 PCM 采集（MorningPcm）───────────────────────────────────────────

/** onAudioChunk 事件负载：base64=PCM16 分片，rms=该片归一化音量(0~1)。 */
export interface AudioChunk {
  base64: string;
  rms: number;
}

type MorningPcmModule = {
  start: () => Promise<boolean>;
  /** 停止并返回整段录音的 base64 PCM（16k/mono/PCM16）。 */
  stop: () => Promise<string>;
  addListener: (event: "onAudioChunk", cb: (e: AudioChunk) => void) => EventSubscription;
};

const Pcm = requireOptionalNativeModule<MorningPcmModule>("MorningPcm");

/** 原生 PCM 采集是否可用（真机 Android build 才为 true）。 */
export const isPcmAvailable = Pcm != null;

/** 开始麦克风采集；采集前请先取得 RECORD_AUDIO 权限。不可用时返回 false。 */
export async function startPcmCapture(): Promise<boolean> {
  if (!Pcm) return false;
  try {
    return await Pcm.start();
  } catch {
    return false;
  }
}

/** 停止采集，返回整段 base64 PCM；不可用或失败返回 null。 */
export async function stopPcmCapture(): Promise<string | null> {
  if (!Pcm) return null;
  try {
    return await Pcm.stop();
  } catch {
    return null;
  }
}

/** 订阅实时 PCM 分片；不可用时返回一个 no-op 订阅。 */
export function addAudioChunkListener(cb: (e: AudioChunk) => void): EventSubscription {
  if (!Pcm) return { remove() {} } as EventSubscription;
  return Pcm.addListener("onAudioChunk", cb);
}

/** 原生前台服务是否可用（真机 Android build 才为 true）。 */
export const isCompanionAvailable = Native != null;

// Token restoration and pet updates can overlap at launch. Preserve call order so
// an initial stop cannot overtake a later foreground start on native async queues.
const enqueueCompanion = createCompanionTaskQueue();

/**
 * 拉起常驻陪伴通知：「{petName}在陪着你」+ 暂停/打开按钮；同时负责后台收信与悬浮米露的宿主。
 * force=true 表示用户在设置里明确要开，会清掉「已暂停」；默认遵守用户点过的「暂停陪伴」。
 * 返回 false 表示没起来（不可用或处于暂停）。
 */
export async function startCompanion(petName: string, petKind?: string | null, force = false): Promise<boolean> {
  if (!Native) return false;
  return enqueueCompanion(() => Native.startCompanionService(petName, petKind ?? null, force));
}

/** 停止常驻陪伴（登录退出、设置里关掉时用；同时让开机自启不再拉起）。 */
export async function stopCompanion(): Promise<boolean> {
  if (!Native) return false;
  return enqueueCompanion(() => Native.stopCompanionService());
}

/** 用户是否在通知上点过「暂停陪伴」。 */
export async function isCompanionPaused(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.isCompanionPaused();
  } catch {
    return false;
  }
}

/** 是否已允许「显示在其他应用上层」（悬浮米露需要）。原生不可用时返回 false。 */
export async function hasOverlayPermission(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.hasOverlayPermission();
  } catch {
    return false;
  }
}

/** 打开系统的授权页，只能用户自己去开。 */
export async function requestOverlayPermission(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.requestOverlayPermission();
  } catch {
    return false;
  }
}

/** 打开 / 关闭悬浮米露（服务在跑时立即生效；没在跑则下次拉起时生效）。 */
export async function setOverlayEnabled(enabled: boolean): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.setOverlayEnabled(enabled);
  } catch {
    return false;
  }
}

/** 把未读数、当前桌宠同步给通知和悬浮米露；wiggle=true 表示刚来了新信（悬浮米露晃一下）。 */
export async function updateCompanionState(state: {
  unread: number;
  petName?: string | null;
  petKind?: string | null;
  wiggle?: boolean;
}): Promise<void> {
  if (!Native) return;
  try {
    await Native.updateCompanionState(state.unread, state.petName ?? null, state.petKind ?? null, state.wiggle ?? false);
  } catch {
    /* 原生没起来时静默，下次同步再带上 */
  }
}

/** 取走「点悬浮米露要去哪」的一次性交接（目前只有 "mailbox"）；没有返回 null。 */
export async function consumeLaunchTarget(): Promise<string | null> {
  if (!Native) return null;
  try {
    return await Native.consumeLaunchTarget();
  } catch {
    return null;
  }
}
