/** 偏好设置：backend/app/routers/system/preferences.py 的移植（校验规则与中文提示一致）。 */
import { nowIso, parseJson, toJson } from "../db.ts";
import { LocalHttpError, type LocalContext, type LocalRouter } from "../http.ts";

export const DEFAULT_SCHEDULE_TIMES = ["08:00", "15:00", "20:00"];
const FREQUENCIES = ["安静", "温和", "活跃"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const BOOL_FIELDS = [
  "proactive_enabled", "evening_letter_enabled", "keep_raw_dump", "profile_learning_enabled",
  "reduce_transparency", "is_muted", "scheduled_checkin_enabled", "holiday_greeting_enabled",
  "motion_detection_enabled", "driving_alert_enabled", "weather_alert_enabled", "usage_anomaly_enabled",
] as const;
const STRING_FIELDS = [
  "proactive_frequency", "sleep_reminder_time", "evening_letter_time", "font_size", "companion_tone",
  "quiet_hours_start", "quiet_hours_end",
] as const;
const INT_FIELDS = ["ephemeral_ttl_days", "max_daily_triggers"] as const;
/** 客户端不可改，只读（driving_mode_active / last_motion_signal_at 由系统信号写入）。 */
const READ_ONLY = ["driving_mode_active", "last_motion_signal_at"] as const;

export async function getOrCreatePrefs(ctx: LocalContext): Promise<any> {
  let row = await ctx.db.get<any>("SELECT * FROM user_preferences WHERE user_id = ?", [ctx.userId]);
  if (!row) {
    const now = nowIso(ctx.now());
    await ctx.db.run(
      "INSERT INTO user_preferences (user_id, proactive_schedule_times, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [ctx.userId, toJson(DEFAULT_SCHEDULE_TIMES), now, now],
    );
    row = await ctx.db.get<any>("SELECT * FROM user_preferences WHERE user_id = ?", [ctx.userId]);
  } else if (row.proactive_schedule_times == null) {
    await ctx.db.run("UPDATE user_preferences SET proactive_schedule_times = ? WHERE id = ?", [toJson(DEFAULT_SCHEDULE_TIMES), row.id]);
    row = await ctx.db.get<any>("SELECT * FROM user_preferences WHERE user_id = ?", [ctx.userId]);
  }
  return row;
}

export function prefsOut(row: any) {
  const out: Record<string, unknown> = {};
  for (const k of BOOL_FIELDS) out[k] = !!row[k];
  for (const k of STRING_FIELDS) out[k] = row[k];
  for (const k of INT_FIELDS) out[k] = row[k];
  out.proactive_schedule_times = parseJson<string[] | null>(row.proactive_schedule_times, null);
  out.driving_mode_active = !!row.driving_mode_active;
  out.last_motion_signal_at = row.last_motion_signal_at ?? null;
  return out;
}

export function registerPreferences(router: LocalRouter): void {
  router.add("GET", "/api/v1/preferences", async (ctx) => prefsOut(await getOrCreatePrefs(ctx)));

  router.add("PATCH", "/api/v1/preferences", async (ctx, req) => {
    const pref = await getOrCreatePrefs(ctx);
    const body = req.body ?? {};
    // 与后端一致：值为 null 视为没传（exclude_none）；只读字段忽略
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === null || v === undefined) continue;
      if ((READ_ONLY as readonly string[]).includes(k)) continue;
      patch[k] = v;
    }
    const allowed = new Set<string>([...BOOL_FIELDS, ...STRING_FIELDS, ...INT_FIELDS, "proactive_schedule_times"]);
    for (const k of Object.keys(patch)) if (!allowed.has(k)) delete patch[k];
    if (Object.keys(patch).length === 0) throw new LocalHttpError(400, "No fields to update");

    for (const k of BOOL_FIELDS) if (k in patch && typeof patch[k] !== "boolean") throw new LocalHttpError(422, k + " 须是开关值");
    for (const k of INT_FIELDS) if (k in patch && !Number.isInteger(patch[k])) throw new LocalHttpError(422, k + " 须是整数");
    for (const k of STRING_FIELDS) if (k in patch && typeof patch[k] !== "string") throw new LocalHttpError(422, k + " 须是文字");

    if ("proactive_frequency" in patch && !FREQUENCIES.includes(patch.proactive_frequency)) {
      throw new LocalHttpError(422, "频率档位须为 " + FREQUENCIES.join("/"));
    }
    if ("sleep_reminder_time" in patch && !TIME_RE.test(patch.sleep_reminder_time)) {
      throw new LocalHttpError(422, "时间格式须为 HH:MM");
    }
    if ("evening_letter_time" in patch && !TIME_RE.test(patch.evening_letter_time)) {
      throw new LocalHttpError(422, "来信时间格式须为 HH:MM（00:00–23:59）");
    }
    if ("ephemeral_ttl_days" in patch && !(patch.ephemeral_ttl_days >= 1 && patch.ephemeral_ttl_days <= 30)) {
      throw new LocalHttpError(422, "寄存天数须在 1–30 天之间");
    }
    if ("font_size" in patch && !["小", "标准", "大"].includes(patch.font_size)) {
      throw new LocalHttpError(422, "字体须为 小/标准/大");
    }
    for (const k of ["quiet_hours_start", "quiet_hours_end"]) {
      if (k in patch && !TIME_RE.test(patch[k])) throw new LocalHttpError(422, k + " 格式须为 HH:MM");
    }
    if ("proactive_schedule_times" in patch) {
      const times = patch.proactive_schedule_times;
      if (!Array.isArray(times) || times.length < 1 || times.length > 6) throw new LocalHttpError(422, "定时窗口须为 1–6 个时刻");
      for (const t of times) {
        if (typeof t !== "string" || !TIME_RE.test(t)) throw new LocalHttpError(422, "定时窗口格式须为 HH:MM");
      }
      patch.proactive_schedule_times = [...new Set<string>(times)].sort();
    }
    if ("max_daily_triggers" in patch && !(patch.max_daily_triggers >= 1 && patch.max_daily_triggers <= 12)) {
      throw new LocalHttpError(422, "每日主动触达上限须在 1–12 次之间");
    }

    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(k + " = ?");
      values.push(k === "proactive_schedule_times" ? toJson(v) : typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
    sets.push("updated_at = ?");
    values.push(nowIso(ctx.now()), pref.id);
    await ctx.db.run("UPDATE user_preferences SET " + sets.join(", ") + " WHERE id = ?", values);
    return prefsOut(await getOrCreatePrefs(ctx));
  });

  // 前端上报最近一次模糊位置（供环境上下文）。只存最近一次，不存轨迹。
  router.add("POST", "/api/v1/preferences/location", async (ctx, req) => {
    const pref = await getOrCreatePrefs(ctx);
    const { lat, lon, city } = req.body ?? {};
    if (typeof lat !== "number" || lat < -90 || lat > 90) throw new LocalHttpError(422, "lat 须在 -90 到 90 之间");
    if (typeof lon !== "number" || lon < -180 || lon > 180) throw new LocalHttpError(422, "lon 须在 -180 到 180 之间");
    const newCity = typeof city === "string" && city ? city : pref.last_city;
    await ctx.db.run(
      "UPDATE user_preferences SET last_lat = ?, last_lon = ?, last_city = ?, location_updated_at = ?, updated_at = ? WHERE id = ?",
      [lat, lon, newCity ?? null, nowIso(ctx.now()), nowIso(ctx.now()), pref.id],
    );
    return { ok: true, city: newCity ?? null };
  });
}
