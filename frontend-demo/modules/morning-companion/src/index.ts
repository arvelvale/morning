/**
 * 常驻陪伴前台服务①的 JS 侧封装。
 *
 * 仅 Android 原生生效；web / iOS / 未编进原生的场景下 requireOptionalNativeModule
 * 返回 null，这里所有调用降级为 no-op，不会崩。
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

type MorningCompanionModule = {
  startCompanionService: (petName: string) => Promise<boolean>;
  stopCompanionService: () => Promise<boolean>;
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

/** 拉起常驻陪伴通知：「{petName}正在陪伴你 · 已运行 X 分钟」+ 暂停/打开按钮。 */
export async function startCompanion(petName: string): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.startCompanionService(petName);
  } catch {
    return false;
  }
}

/** 停止常驻陪伴通知（等同用户点「暂停陪伴」）。 */
export async function stopCompanion(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.stopCompanionService();
  } catch {
    return false;
  }
}
