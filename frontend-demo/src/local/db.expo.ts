/** expo-sqlite 驱动。只在运行时（runtime.ts）里加载，测试不碰它。 */
import { openDatabaseAsync } from "expo-sqlite";

import { createDb, type Db, type Driver, type Row, type SqlValue } from "./db.ts";

export const DB_FILE = "morning-local.db";

export async function openExpoDb(fileName: string = DB_FILE): Promise<Db> {
  const sqlite = await openDatabaseAsync(fileName);
  await sqlite.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const driver: Driver = {
    exec: (sql) => sqlite.execAsync(sql),
    run: async (sql, params: SqlValue[]) => {
      const r = await sqlite.runAsync(sql, params);
      return { lastInsertRowId: Number(r.lastInsertRowId), changes: r.changes };
    },
    all: (sql, params: SqlValue[]) => sqlite.getAllAsync<Row>(sql, params),
  };
  return createDb(driver);
}
