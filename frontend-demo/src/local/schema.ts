/**
 * 本地库的表结构。列名与后端 SQLAlchemy 模型保持一致（见 backend/app/models/*），
 * 这样从服务器导出的数据（P6）可以按列直接导入，移植查询时也不用改名。
 *
 * 类型约定：布尔 = INTEGER 0/1；JSON = TEXT；时间 = TEXT（ISO-8601 UTC，带 Z）。
 * 每个迁移只追加，不改已发布的迁移。version 从 1 连续递增。
 */
import type { Migration } from "./db.ts";

/** 本地模式只有一个本机用户，所有表的 user_id 固定为它。 */
export const LOCAL_USER_ID = 1;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "P0/P1：本机用户、桌宠、偏好、会话与消息",
    sql: `
CREATE TABLE local_user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT
);

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  preset_id TEXT,
  name TEXT NOT NULL,
  personality TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  actions TEXT,
  system_prompt TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_pets_user ON pets (user_id);

CREATE TABLE user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  proactive_enabled INTEGER NOT NULL DEFAULT 1,
  proactive_frequency TEXT NOT NULL DEFAULT '温和',
  sleep_reminder_time TEXT NOT NULL DEFAULT '22:30',
  evening_letter_enabled INTEGER NOT NULL DEFAULT 1,
  evening_letter_time TEXT NOT NULL DEFAULT '21:30',
  keep_raw_dump INTEGER NOT NULL DEFAULT 1,
  profile_learning_enabled INTEGER NOT NULL DEFAULT 1,
  ephemeral_ttl_days INTEGER NOT NULL DEFAULT 7,
  font_size TEXT NOT NULL DEFAULT '标准',
  companion_tone TEXT NOT NULL DEFAULT '温和',
  reduce_transparency INTEGER NOT NULL DEFAULT 0,
  last_lat REAL,
  last_lon REAL,
  last_city TEXT,
  location_updated_at TEXT,
  proactive_schedule_times TEXT,
  quiet_hours_start TEXT NOT NULL DEFAULT '23:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  is_muted INTEGER NOT NULL DEFAULT 0,
  scheduled_checkin_enabled INTEGER NOT NULL DEFAULT 1,
  holiday_greeting_enabled INTEGER NOT NULL DEFAULT 1,
  motion_detection_enabled INTEGER NOT NULL DEFAULT 1,
  driving_alert_enabled INTEGER NOT NULL DEFAULT 1,
  weather_alert_enabled INTEGER NOT NULL DEFAULT 1,
  usage_anomaly_enabled INTEGER NOT NULL DEFAULT 1,
  max_daily_triggers INTEGER NOT NULL DEFAULT 6,
  driving_mode_active INTEGER NOT NULL DEFAULT 0,
  last_motion_signal_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'free_chat',
  pet_id INTEGER,
  fragment_id INTEGER,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_conv_user_updated ON conversations (user_id, updated_at);

CREATE TABLE conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_msg_conv ON conversation_messages (conversation_id);
`,
  },
  {
    version: 2,
    name: "P2：记忆、记忆历史、珍藏",
    sql: `
CREATE TABLE memory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  layer TEXT NOT NULL,
  kind TEXT NOT NULL,
  depth TEXT NOT NULL,
  content TEXT NOT NULL,
  surface_text TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0,
  status TEXT,
  due_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  parent_id INTEGER REFERENCES memory_items (id),
  root_id INTEGER REFERENCES memory_items (id),
  is_latest INTEGER NOT NULL DEFAULT 1,
  is_forgotten INTEGER NOT NULL DEFAULT 0,
  forget_reason TEXT,
  expires_at TEXT,
  relation_type TEXT,
  relation_to_id INTEGER REFERENCES memory_items (id),
  entities TEXT,
  emotion TEXT,
  provenance TEXT,
  visibility_gate REAL NOT NULL DEFAULT 0.0,
  privacy TEXT NOT NULL DEFAULT 'cloud',
  raw_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_memory_user_layer_latest ON memory_items (user_id, layer, is_latest);
CREATE INDEX ix_memory_user_kind ON memory_items (user_id, kind);
CREATE INDEX ix_memory_user_depth ON memory_items (user_id, depth);
CREATE INDEX ix_memory_root ON memory_items (root_id);

CREATE TABLE memory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL REFERENCES memory_items (id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  old_content TEXT,
  new_content TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_memory_history_memory ON memory_history (memory_id);

CREATE TABLE treasures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_treasures_user ON treasures (user_id);
`,
  },
];
