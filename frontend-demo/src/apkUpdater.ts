/** 自有服务器 APK 更新：DownloadManager 后台下载，原生校验后交给系统安装器。 */
import type { AppVersionInfo } from "./api";
import {
  canRequestPackageInstalls,
  consumeNotificationInstallRequest,
  getDownloadState,
  inspectAndInstall,
  isApkUpdaterAvailable,
  openInstallPermissionSettings,
  startDownload,
  type ApkDownloadState as NativeApkDownloadState,
  type ApkDownloadStatus,
  type ApkInstallResult,
} from "morning-updater";

export { isApkUpdaterAvailable };

export type ApkUpdatePhase =
  | "idle"
  | "downloading"
  | "downloaded"
  | "verifying"
  | "permission_required"
  | "installer_opened"
  | "error";

export type ApkUpdateState = {
  phase: ApkUpdatePhase;
  progress: number;
  downloadedUri: string | null;
  downloadStatus: ApkDownloadStatus | null;
  taskId: string | null;
  error: string | null;
};

export const INITIAL_APK_UPDATE_STATE: ApkUpdateState = {
  phase: "idle",
  progress: 0,
  downloadedUri: null,
  downloadStatus: null,
  taskId: null,
  error: null,
};

export function updateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/^Error:\s*/i, "").trim() || "更新失败了，请稍后重试";
}

export function stateFromDownload(
  snapshot: NativeApkDownloadState,
  expectedVersion?: string,
): ApkUpdateState {
  if (expectedVersion && snapshot.version && snapshot.version !== expectedVersion) {
    return INITIAL_APK_UPDATE_STATE;
  }
  if (snapshot.status === "successful" && snapshot.fileUri) {
    return {
      phase: "downloaded",
      progress: 1,
      downloadedUri: snapshot.fileUri,
      downloadStatus: snapshot.status,
      taskId: snapshot.taskId,
      error: null,
    };
  }
  if (snapshot.status === "failed") {
    return {
      phase: "error",
      progress: 0,
      downloadedUri: null,
      downloadStatus: snapshot.status,
      taskId: snapshot.taskId,
      error: "安装包下载失败，点击重新下载",
    };
  }
  if (snapshot.status === "pending" || snapshot.status === "running" || snapshot.status === "paused") {
    return {
      phase: "downloading",
      progress: Math.max(0, Math.min(1, snapshot.progress || 0)),
      downloadedUri: null,
      downloadStatus: snapshot.status,
      taskId: snapshot.taskId,
      error: null,
    };
  }
  return INITIAL_APK_UPDATE_STATE;
}

export async function downloadApkUpdate(info: AppVersionInfo): Promise<ApkUpdateState> {
  if (!info.apk_url) throw new Error("服务端没有提供安装包地址");
  return stateFromDownload(await startDownload(info.apk_url, info.latest), info.latest);
}

export async function restoreApkUpdateDownload(expectedVersion: string): Promise<ApkUpdateState> {
  return stateFromDownload(await getDownloadState(), expectedVersion);
}

export async function consumeApkInstallNotification(): Promise<boolean> {
  return consumeNotificationInstallRequest();
}

export async function installDownloadedApk(
  uri: string,
  info: AppVersionInfo,
): Promise<ApkInstallResult> {
  return inspectAndInstall(uri, info.apk_sha256, info.size_bytes);
}

export async function requestApkInstallPermission(): Promise<boolean> {
  if (await canRequestPackageInstalls()) return true;
  await openInstallPermissionSettings();
  return false;
}
