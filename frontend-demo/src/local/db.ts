/**
 * 本地数据库的最小抽象。
 *
 * 业务 SQL 只写一份：线上用 expo-sqlite（db.expo.ts），测试用 node:sqlite（scripts/local-test-kit.mjs），
 * 两边都经过这里的 SerialDb，保证同一时刻只有一个操作在连接上执行，事务不会被别的调用穿插。
 */

export type SqlValue = string | number | null;
export type Row = Record<string, any>;

/** 底层驱动：只管把一条语句跑起来，不管并发。 */
export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  all(sql: string, params: SqlValue[]): Promise<Row[]>;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** fn 里用传入的 tx 访问数据库；抛错整体回滚。不要在 fn 里再用外层 db（会死锁）。 */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

function wrap(driver: Driver): Db {
  return {
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    all: (sql, params = []) => driver.all(sql, params) as Promise<any[]>,
    get: async (sql, params = []) => ((await driver.all(sql, params))[0] ?? null) as any,
    transaction: () => Promise.reject(new Error("事务里不能再开事务")),
  };
}

/** 串行化包装：外部调用排队；transaction 期间独占连接。 */
export function createDb(driver: Driver): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
  const inner = wrap(driver);
  return {
    exec: (sql) => enqueue(() => inner.exec(sql)),
    run: (sql, params) => enqueue(() => inner.run(sql, params)),
    all: (sql, params) => enqueue(() => inner.all(sql, params)),
    get: (sql, params) => enqueue(() => inner.get(sql, params)),
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      enqueue(async () => {
        await driver.exec("BEGIN");
        try {
          const result = await fn(inner);
          await driver.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            await driver.exec("ROLLBACK");
          } catch {
            /* 回滚失败时保留原始错误 */
          }
          throw error;
        }
      }),
  };
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** 按 PRAGMA user_version 顺序执行尚未执行的迁移；每个迁移一个事务。版本号必须从 1 连续递增。 */
export async function migrate(db: Db, migrations: Migration[]): Promise<number> {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`迁移版本号必须从 1 连续递增：第 ${i + 1} 个是 ${m.version}`);
  });
  const row = await db.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  if (current > migrations.length) {
    throw new Error(`本地数据库版本 ${current} 比应用认识的 ${migrations.length} 新，请先升级应用`);
  }
  for (const m of migrations.slice(current)) {
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return migrations.length;
}

// ── 小工具 ────────────────────────────────────────────────────────────────

/** ISO-8601 UTC，与服务器 API 输出同形（带 Z）。 */
export const nowIso = (date: Date = new Date()): string => date.toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (value: unknown): string | null => (value == null ? null : JSON.stringify(value));
