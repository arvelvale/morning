/**
 * 本机用户。本地模式没有账号体系：恒登录，user_id 固定。
 * 对应服务器的 /users/me、/users/me/active 与 /auth/*（只保留不让界面报错的最小形状）。
 */
import { nowIso } from "../db.ts";
import { LocalHttpError, type LocalContext, type LocalRouter } from "../http.ts";

export const LOCAL_USERNAME = "local";

export async function ensureLocalUser(ctx: LocalContext) {
  const existing = await ctx.db.get("SELECT * FROM local_user WHERE id = ?", [ctx.userId]);
  if (existing) return existing;
  const now = nowIso(ctx.now());
  await ctx.db.run(
    "INSERT INTO local_user (id, username, display_name, email, created_at, last_active_at) VALUES (?, ?, NULL, NULL, ?, ?)",
    [ctx.userId, LOCAL_USERNAME, now, now],
  );
  return (await ctx.db.get("SELECT * FROM local_user WHERE id = ?", [ctx.userId]))!;
}

function userOut(row: any) {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    display_name: row.display_name ?? null,
    is_active: true,
    created_at: row.created_at,
  };
}

export function registerUsers(router: LocalRouter): void {
  router.add("GET", "/api/v1/users/me", async (ctx) => userOut(await ensureLocalUser(ctx)));

  router.add("PATCH", "/api/v1/users/me", async (ctx, req) => {
    await ensureLocalUser(ctx);
    const body = req.body ?? {};
    if (body.display_name !== undefined && body.display_name !== null) {
      await ctx.db.run("UPDATE local_user SET display_name = ? WHERE id = ?", [String(body.display_name), ctx.userId]);
    }
    if (body.email !== undefined && body.email !== null) {
      await ctx.db.run("UPDATE local_user SET email = ? WHERE id = ?", [String(body.email), ctx.userId]);
    }
    return userOut(await ensureLocalUser(ctx));
  });

  router.add("POST", "/api/v1/users/me/active", async (ctx) => {
    await ensureLocalUser(ctx);
    await ctx.db.run("UPDATE local_user SET last_active_at = ? WHERE id = ?", [nowIso(ctx.now()), ctx.userId]);
    return null;
  });

  // 本地模式恒登录：这些接口只为让登录相关的界面流程不报错。
  router.add("POST", "/api/v1/auth/logout", async () => null);
  router.add("POST", "/api/v1/auth/refresh", async () => localTokens());
  for (const path of ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/email/login"]) {
    router.add("POST", path, async (ctx) => {
      await ensureLocalUser(ctx);
      return localTokens();
    });
  }
  router.add("POST", "/api/v1/auth/email/send-code", async () => {
    throw new LocalHttpError(501, "本地模式不需要邮箱登录");
  });
}

/** 占位令牌：本地模式从不把它发给任何服务器。 */
export function localTokens() {
  return { access_token: "local", refresh_token: "local", token_type: "bearer" };
}
