/** 桌宠：backend/app/routers/companion/pets.py + services/pet/pet_store.py 的移植。 */
import { nowIso, parseJson, toJson } from "../db.ts";
import { PET_PRESETS, type PetPreset } from "../generated/petPresets.ts";
import { LocalHttpError, idParam, type LocalContext, type LocalRouter } from "../http.ts";

export function petOut(row: any) {
  return {
    id: row.id,
    preset_id: row.preset_id ?? null,
    name: row.name,
    personality: row.personality ?? "",
    tone: row.tone ?? "",
    actions: parseJson<string[]>(row.actions, []),
    system_prompt: row.system_prompt ?? null,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const getPet = (ctx: LocalContext, petId: number) =>
  ctx.db.get<any>("SELECT * FROM pets WHERE id = ? AND user_id = ?", [petId, ctx.userId]);

export const getActivePet = (ctx: LocalContext) =>
  ctx.db.get<any>("SELECT * FROM pets WHERE user_id = ? AND is_active = 1", [ctx.userId]);

async function requirePet(ctx: LocalContext, petId: number) {
  const pet = await getPet(ctx, petId);
  if (!pet) throw new LocalHttpError(404, "桌宠不存在");
  return pet;
}

async function createFromPreset(ctx: LocalContext, preset: PetPreset) {
  const now = nowIso(ctx.now());
  const r = await ctx.db.run(
    "INSERT INTO pets (user_id, preset_id, name, personality, tone, actions, system_prompt, is_active, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [ctx.userId, preset.id, preset.name, preset.personality, preset.tone, toJson(preset.actions ?? []), preset.system_prompt, now, now],
  );
  return (await getPet(ctx, r.lastInsertRowId))!;
}

export function registerPets(router: LocalRouter): void {
  router.add("GET", "/api/v1/pets/presets", async () => PET_PRESETS);

  router.add("GET", "/api/v1/pets", async (ctx) => {
    const rows = await ctx.db.all("SELECT * FROM pets WHERE user_id = ? ORDER BY id DESC", [ctx.userId]);
    return rows.map(petOut);
  });

  router.add("GET", "/api/v1/pets/active", async (ctx) => {
    const pet = await getActivePet(ctx);
    if (!pet) throw new LocalHttpError(404, "还没有主桌宠");
    return petOut(pet);
  });

  // 切换主桌宠。petId 是整数 → 我已拥有的桌宠；是字符串 → 预设 id，先实例化再激活。
  // 后端会在这里生成「交接信」（P3：来信）；P1 里 handoff 为 null，界面按“没有交接信”处理。
  router.add("PUT", "/api/v1/pets/active", async (ctx, req) => {
    const raw = req.body?.pet_id ?? req.body?.petId;
    if (raw === undefined || raw === null || raw === "") throw new LocalHttpError(422, "缺少 petId");
    const result = await ctx.db.transaction(async (tx) => {
      const scoped: LocalContext = { ...ctx, db: tx };
      let pet: any;
      if (typeof raw === "number") {
        pet = await getPet(scoped, raw);
        if (!pet) throw new LocalHttpError(404, "桌宠不存在");
      } else {
        const preset = PET_PRESETS.find((p) => p.id === String(raw));
        if (!preset) throw new LocalHttpError(404, "预设不存在");
        // 复用该用户已由此预设实例化的桌宠，没有才新建（避免重复堆积同名桌宠）
        pet =
          (await tx.get<any>(
            "SELECT * FROM pets WHERE user_id = ? AND preset_id = ? ORDER BY is_active DESC, id ASC",
            [ctx.userId, preset.id],
          )) ?? (await createFromPreset(scoped, preset));
      }
      await tx.run("UPDATE pets SET is_active = 0 WHERE user_id = ?", [ctx.userId]);
      await tx.run("UPDATE pets SET is_active = 1 WHERE id = ?", [pet.id]);
      return await getPet(scoped, pet.id);
    });
    return { pet: petOut(result), handoff: null };
  });

  router.add("GET", "/api/v1/pets/{pet_id}", async (ctx, req) => petOut(await requirePet(ctx, idParam(req, "pet_id"))));

  router.add("PATCH", "/api/v1/pets/{pet_id}", async (ctx, req) => {
    const pet = await requirePet(ctx, idParam(req, "pet_id"));
    const body = req.body ?? {};
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const text = (key: string, max: number, min = 0) => {
      if (body[key] === undefined) return;
      const v = body[key];
      if (v !== null && (typeof v !== "string" || v.length > max || v.length < min)) {
        throw new LocalHttpError(422, key + " 长度须在 " + min + "–" + max + " 之间");
      }
      if (v === null && key === "name") throw new LocalHttpError(422, "name 不能为空");
      sets.push(key + " = ?");
      values.push(v);
    };
    text("name", 100, 1);
    text("personality", 300);
    text("tone", 300);
    if (body.actions !== undefined) {
      if (body.actions !== null && !(Array.isArray(body.actions) && body.actions.every((a: unknown) => typeof a === "string"))) {
        throw new LocalHttpError(422, "actions 须是字符串列表");
      }
      sets.push("actions = ?");
      values.push(toJson(body.actions));
    }
    if (body.system_prompt !== undefined) {
      sets.push("system_prompt = ?");
      values.push(body.system_prompt === null ? null : String(body.system_prompt));
    }
    if (sets.length) {
      sets.push("updated_at = ?");
      values.push(nowIso(ctx.now()), pet.id);
      await ctx.db.run("UPDATE pets SET " + sets.join(", ") + " WHERE id = ?", values);
    }
    return petOut(await requirePet(ctx, pet.id));
  });

  router.add("DELETE", "/api/v1/pets/{pet_id}", async (ctx, req) => {
    const pet = await requirePet(ctx, idParam(req, "pet_id"));
    await ctx.db.run("DELETE FROM pets WHERE id = ?", [pet.id]);
    return null;
  });
}
