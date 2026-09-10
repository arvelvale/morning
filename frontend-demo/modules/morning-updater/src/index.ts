/** Android 自有服务器 APK 更新的原生桥接；非 Android/未编入模块时安全降级。 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type ApkInstallStatus = "permission_required" | "installer_opened";

export type ApkInstallResult = {
  status: ApkInstallStatus;
  packageName: string;
  versionCode: number;
  versionName: string | null;
  sha256: string;
  sizeBytes: number;
};

export type ApkDownloadStatus =
  | "idle"
  | "pending"
  | "running"
  | "paused"
  | "successful"
  | "failed";

export type ApkDownloadState = {
  taskId: string | null;
  status: ApkDownloadStatus;
  bytesWritten: number;
  totalBytes: number;
  progress: number;
  fileUri: string | null;
  reason: number | null;
  version: string | null;
};

type MorningUpdaterModule = {
  startDownload: (url: string, versionName: string) => Promise<ApkDownloadState>;
  getDownloadState: () => Promise<ApkDownloadState>;
  consumeNotificationInstallRequest: () => Promise<boolean>;
  canRequestPackageInstalls: () => Promise<boolean>;
  openInstallPermissionSettings: () => Promise<boolean>;
  inspectAndInstall: (
    fileUri: string,
    expectedSha256: string | null,
    expectedSizeBytes: number | null,
  ) => Promise<ApkInstallResult>;
};

const Native = requireOptionalNativeModule<MorningUpdaterModule>("MorningUpdater");

export const isApkUpdaterAvailable = Platform.OS === "android" && Native != null;

export async function startDownload(
  url: string,
  versionName: string,
): Promise<ApkDownloadState> {
  if (!Native) throw new Error("当前安装包不支持后台更新");
  return Native.startDownload(url, versionName);
}

export async function getDownloadState(): Promise<ApkDownloadState> {
  if (!Native) {
    return {
      taskId: null,
      status: "idle",
      bytesWritten: 0,
      totalBytes: 0,
      progress: 0,
      fileUri: null,
      reason: null,
      version: null,
    };
  }
  return Native.getDownloadState();
}

export async function consumeNotificationInstallRequest(): Promise<boolean> {
  return Native ? Native.consumeNotificationInstallRequest() : false;
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  return Native ? Native.canRequestPackageInstalls() : false;
}

export async function openInstallPermissionSettings(): Promise<boolean> {
  return Native ? Native.openInstallPermissionSettings() : false;
}

export async function inspectAndInstall(
  fileUri: string,
  expectedSha256?: string | null,
  expectedSizeBytes?: number | null,
): Promise<ApkInstallResult> {
  if (!Native) throw new Error("当前安装包不支持应用内更新");
  return Native.inspectAndInstall(
    fileUri,
    expectedSha256?.trim() || null,
    expectedSizeBytes && expectedSizeBytes > 0 ? expectedSizeBytes : null,
  );
}
