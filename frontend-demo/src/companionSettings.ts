/**
 * 常驻陪伴 / 悬浮米露的本机开关（AsyncStorage，不进后端偏好：它们只和这台手机的系统权限有关）。
 *
 * - companion：常驻通知 + 后台收信。默认开（目的就是防止收不到信）。
 * - overlay：悬浮米露。默认关：它需要系统的「显示在其他应用上层」授权，要用户自己决定。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CompanionSettings {
  companion: boolean;
  overlay: boolean;
}

export const COMPANION_DEFAULTS: CompanionSettings = { companion: true, overlay: false };

const KEY = "morning.companionSettings.v1";

/** 悬浮米露依附常驻服务运行：常驻关掉时它也关；打开悬浮米露时常驻必须开。 */
export function normalizeSettings(raw: Partial<CompanionSettings> | null | undefined): CompanionSettings {
  const companion = typeof raw?.companion === "boolean" ? raw.companion : COMPANION_DEFAULTS.companion;
  const overlay = typeof raw?.overlay === "boolean" ? raw.overlay : COMPANION_DEFAULTS.overlay;
  return { companion, overlay: companion && overlay };
}

export async function loadCompanionSettings(): Promise<CompanionSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return normalizeSettings(raw ? (JSON.parse(raw) as Partial<CompanionSettings>) : null);
  } catch {
    return { ...COMPANION_DEFAULTS };
  }
}

export async function saveCompanionSettings(s: CompanionSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(normalizeSettings(s)));
  } catch {
    /* 存不上只影响下次启动，不影响这次 */
  }
}

/** 应用一次修改，并保持「悬浮依附常驻」这条约束：开悬浮会顺带开常驻，关常驻会顺带关悬浮。 */
export function applyPatch(cur: CompanionSettings, patch: Partial<CompanionSettings>): CompanionSettings {
  const next = { ...cur, ...patch };
  if (patch.overlay === true) next.companion = true;
  return normalizeSettings(next);
}
