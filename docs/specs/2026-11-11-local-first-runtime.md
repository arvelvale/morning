# 喵灵本地优先运行时（Local-First Runtime）

状态：P0 + P1（聊天）+ P2（记忆与待办）已实现，默认关闭，未出包验证（2026-11-11）
作者：晨熠 / Claude

## 1. 目标与非目标

**目标**：用户填入自己的模型密钥后，喵灵的核心功能**不再依赖喵灵服务器**——对话、记忆、待办、来信、场景都在手机本地运行，数据存在手机上，手机直连模型服务商（阶跃 / DeepSeek，均为 HTTPS）。

动机（按重要性）：
1. 隐私：对话和记忆不出手机，只有用户自己的密钥、自己的额度。
2. 成本：build in public 带来的新用户不消耗作者的额度，也不需要作者运营服务器。
3. 绕开现状限制：服务器没有 HTTPS 域名，密钥无法安全地经服务器转发；直连模型服务商不需要。

**非目标**（本方案不做）：
- 多设备同步、账号体系（本地模式只有一个本机用户）。
- 服务端继续作为“默认模式”被删除——现有服务器模式保留，两种模式并存，本地模式稳定后再决定去留。
- 鸿蒙端（只做 Android；鸿蒙端沿用服务器模式）。
- 换手机迁移的云端方案（只做“导出 / 导入文件”，见 §9）。

## 2. 总体架构：手机里的“虚拟服务器”

关键决定：**不改界面代码**。现在所有界面都通过 `src/api.ts` 里的 `get/post/patch/del` 和几个 `streamXxx` 访问 `/api/v1/...` 接口。本地模式在 `api.ts` 的最底层换掉传输：

```
界面 ──> api.ts ──┬─ 服务器模式：fetch(API_BASE + path)         （现状）
                  └─ 本地模式：  localDispatch(method, path, body) ──> src/local/handlers/*
                                                                         │
                                       SQLite（expo-sqlite）<────────────┤
                                       模型客户端（直连 阶跃 / DeepSeek）<─┘
```

- `src/local/http.ts`：路由表 + 派发。处理函数签名 `(ctx, req) => json`；流式接口返回 `AsyncIterable<{event, data}>`，和现在 SSE 事件一一对应（`token` / `done` / `todo.saved` / `item.classified` …），所以界面里的事件处理不用改。
- 错误沿用服务器的形状：抛 `LocalHttpError(status, detail)`，`api.ts` 照常转成 `ApiError(detail)`。
- **本地模式下没实现的接口一律失败并说明“本地模式暂不支持”，绝不悄悄回退到服务器**——否则用户以为数据没出手机，实际发出去了。
- 开关：`localMode`（AsyncStorage，本机）。第 1 阶段起可在“我的 → 模型与密钥”里打开（实验功能），默认关；达到 §10 的“可替代”标准前不默认开启。

## 3. 本地数据

- 引擎：`expo-sqlite`（SDK 53 对应 ~15.2.14，原生模块，需要重新出包）。
- 单用户：所有表的 `user_id` 固定为 `1`，保留这一列是为了让从服务器导入的数据和现有查询逻辑一一对应，减少移植时的改写。
- 类型映射（Postgres/SQLAlchemy → SQLite）：`JSON` → `TEXT`（读写时 `JSON.parse/stringify`）；`DateTime(timezone=True)` → `TEXT`（ISO-8601 UTC，带 `Z`，和服务器 API 输出一致）；`Boolean` → `INTEGER 0/1`。
- 迁移：`PRAGMA user_version` + 顺序迁移列表（`src/local/schema.ts`），应用启动时 `migrate()`，每个迁移在事务里执行。
- 数据库适配层 `Db` 接口（`exec / run / all / get / transaction`）有两个实现：`expo-sqlite`（线上）和 `node:sqlite`（测试）。**业务 SQL 只写一份，在 Node 里就能跑完整测试**。
- 图片：聊天图片存应用私有目录 `documentDirectory/chat-images/`，数据库里只存文件名（和服务器一致）；读取接口返回本地 `file://` 地址，界面里的 `authedImageSource` 在本地模式下直接用它。

## 4. 模型调用

- `src/local/llm.ts` 是后端 `app/llm.py` 的移植：
  - 路由：阶跃优先（`step-3.7-flash`，`https://api.stepfun.com/v1`），DeepSeek 备用；`should_fallback` 的判定规则逐条照搬（401/402/403/404/408/409/429/5xx/超时/连接失败换路；400 不换；流式只在“一个字没吐”时换路）；DeepSeek 看不了图，换路时把图片换成占位句；`reasoning_effort` 对 DeepSeek 去掉。
  - 流式用 `expo/fetch`（已在 `sse.ts` 用过）读 OpenAI 兼容的 SSE。
  - 超时/重试：有备用路由时第一条路只重试 1 次，没有则 5 次（指数退避），和后端一致。
- 密钥：复用现有 `modelKeys.ts`（Android Keystore）。本地模式下**不需要“只在 https 上发送”的限制**——目标就是模型服务商的 https 地址；该限制只针对喵灵自己的服务器。
- 提示词**原样移植**，不改写：`BASE_PERSONA`、各 mode 提示、米露/波比人格提示、记忆抽取提示等。保真方式见 §8“黄金对照测试”。

## 5. 接口移植清单与阶段

前端实际用到的接口约 75 个（`src/api.ts`）。按依赖关系分阶段，每个阶段结束都是“可单独使用”的状态：

| 阶段 | 内容 | 对应接口（节选） | 后端参考代码 |
|---|---|---|---|
| **P0 地基** | `Db` 适配层、迁移、路由派发、模型客户端、本机用户、`localMode` 开关 | `auth/*`（本地恒登录）、`users/me`、`users/me/active`、`app/version`（仍问服务器，可选）、`ai/keys/*`（本地只做探测） | `llm.py` `llm_keys.py` `routers/system/byok.py` |
| **P1 聊天** | 桌宠、偏好、会话与消息、桌宠回复（含看图）、首页 | `pets*`、`preferences*`、`conversations*`、`companion/home` | `graphs/companion.py` `routers/companion/*` `services/pet/*` `services/companion/*` |
| **P2 记忆与待办** | 记忆存取/召回、记忆抽取、聊天里记待办、倾倒、待办/灵感/情绪/小结/档案/宝藏 | `memories*`、`todos*`、`brain-dumps`、`profile*`、`summaries` `emotions` `ideas` `treasures` `memory-review` `ephemeral*` | `graphs/extractor.py` `services/memory/*` `routers/memory/*` |
| **P3 来信** | 信箱、晚间来信/睡前提醒/周报/交接信的本地生成，由手机定时触发（复用常驻服务与无头任务） | `letters*` `mailbox` `handoffs` `tick` | `services/mailbox/*` `services/infra/user_jobs.py` |
| **P4 场景** | 场景创建/推进/结算、剧场、生图（阶跃图像接口） | `scenes*` `candidates*` `detect-intent` | `routers/scene/*` `services/scene/*` `graphs/theater.py` |
| **P5 语音与天气** | TTS、转写、实时通话直连阶跃 WebSocket；天气换成不需要密钥的服务（Open-Meteo） | `/ai/tts` `sttOnce` `useVoiceInput` `useRealtimeCall` | `stepfun/*` `routers/ai/*` `services/infra/weather.py` |
| **P6 迁移** | 从服务器导出/导入（见 §9）、应用内备份文件 | — | — |

不移植的部分：JWT/邮箱登录/验证码、服务端定时任务调度（`engagement.py`、`user_jobs.py` 的“每个用户”逻辑，本地只有一个用户）、PostgreSQL 与 Alembic、`ws_relay`（中继）、`/static` 下载。

## 6. 后台与定时内容

服务器模式下，晚间来信、睡前提醒、周报由服务端定时生成。本地模式改为手机触发：
- 复用 0.3.21 的“常驻陪伴”前台服务 + 无头 JS 任务轮询；到点（用户设置的晚间来信时间等）由本地调度器判断“今天是否已生成”（`job_runs` 本地表，沿用“每天只生成一次、失败有冷却”的规则）后调用本地生成函数。
- 手机被系统杀掉后台时会晚到，和 BYOK 方案的说明一致；设置页文案沿用。
- 主动信号（`services/signals/*`）依赖位置/运动/天气等，放在 P3 之后评估，不是首批。

## 7. 安全与隐私

- 密钥只在 Keystore；日志里不打印密钥、不打印完整请求/响应正文（本地模式下的错误日志只记状态码与错误类型）。
- 数据库放应用私有目录；不做应用内加密（系统层面的设备加密 + 应用沙盒），README 里如实说明。
- 备份导出文件是明文 JSON（含对话与记忆），导出前明示风险，不含密钥。
- 本地模式不再向喵灵服务器发送任何用户内容；只保留两类对服务器的请求：①版本/更新检查 ②（若用户在服务器模式）原有请求。设置页显示当前模式。

## 8. 测试策略

1. **单元/集成（Node）**：`node:sqlite` 做 `Db`，注入假的 `fetch`，直接调用 `localDispatch`，覆盖每个移植接口的成功/失败/隔离路径。放在 `frontend-demo/scripts/test-local-*.mjs`，纳入 `npm run test:local`。
2. **黄金对照测试**：用 Python 一次性导出后端在固定输入下的真实输出（提示词、消息组装、`should_fallback` 判定表、抽取结果的校验规则），存成 `frontend-demo/scripts/fixtures/*.json`；TS 测试逐字比对。后端提示词一旦修改，对照测试会失败，提醒同步。
3. **接口形状对照**：用后端 `openapi.json` 校验本地返回的字段名与类型（防止界面读不到字段）。
4. **真机**：模拟器/真机上的启动迁移、拍照发图、后台触发——**这部分我没法在当前环境验证**，每个阶段的交付说明里单列。

## 9. 数据迁移（P6）

- 服务器新增一个只读的 `GET /api/v1/export`（登录后导出自己的全部数据：对话、记忆、待办、信、场景、宠物、偏好，不含密码哈希/令牌），客户端在“我的 → 模型与密钥 → 把数据搬到手机”里调用并写入本地库。
- 搬完之后提示用户可以在服务器模式里“删除我的服务器数据”（需要新增接口；不做自动删除）。
- 本地模式的备份：导出为单个 `.json`（或 sqlite 文件）到用户选的位置；导入同理。

## 10. “可替代”标准（才允许默认开启本地模式）

- P0–P3 全部完成并通过测试，P5 语音至少 TTS+转写可用。
- 真机上连续使用 3 天无数据丢失、无迁移失败。
- 现有服务器模式用户可一键迁移（P6）。
- 场景（P4）可以晚于默认开启，但本地模式下场景入口必须明确提示“暂不支持”。

## 11. 风险与待确认

| 风险 | 说明 / 对策 |
|---|---|
| 工作量 | 后端约 1.7 万行，其中提示词与存取逻辑为主，LangGraph 部分很薄（本质是一次模型调用）。按阶段交付；P0+P1 约 3–5 天，P2 约 1 周，P3 约 3–5 天，P4 约 1–2 周。 |
| 记忆召回质量 | 服务端用 jieba 分词做关键词/实体匹配。RN 里没有 jieba；先用字/二元组匹配 + 实体表，黄金对照里评估召回差异，必要时换成模型打分。 |
| 阶跃限流 | 用户用自己的 key，RPM 由用户账号决定；建场景一次会连打多次，保留后端的串行/降级策略。 |
| 后台限制 | 厂商省电会杀进程，晚间信可能晚到；沿用 0.3.21 的说明与“忽略电池优化”引导。 |
| 卸载即丢数据 | 本地库随应用卸载消失。P6 备份文件是缓解；首次进入本地模式时明确告知。 |
| 原生依赖变更 | 引入 `expo-sqlite` 需要重新构建 APK；JS 层改动 OTA 不可行（项目无 OTA），每个阶段要出包验证。 |
| 密钥暴露面 | 手机丢失/被 root 后密钥可被取出；与“服务器保存密钥”相比并不更差，但要在说明里写清。 |

## 12. 实现进度

### 已完成（2026-11-11，commit 见 git log）
- `src/local/`：`db.ts`（Db 抽象 + 串行化 + 迁移）、`db.expo.ts`、`schema.ts`（迁移 1）、`http.ts`（路由派发）、`llm.ts`（路由/回退/流式/看图）、`prompts.ts`、`imageRules.ts`、`handlers/{users,pets,preferences,conversations,system}.ts`、`runtime.ts`（expo-sqlite / expo-file-system / expo/fetch）、`index.ts`。
- `src/localMode.ts` 开关；`api.ts` 接入（普通请求、流式、占位令牌、图片地址、密钥测试）；“模型与密钥”页加了“本地模式（实验）”开关，切换后需重新打开应用。
- 后端 `scripts/export_local_fixtures.py` 导出提示词与换路判定的黄金数据。
- 测试 `npm run test:local`：黄金对照（7 组提示词、18 项换路判定）、路由与换路/重试/流式行为、迁移与事务、桌宠/偏好/会话/图片全流程、源码守卫。已验证测试能抓出故意改坏的逻辑。
- Metro 打包通过（`expo export --platform android`），包内含本地库表结构与新文案。

### P2 记忆与待办（2026-11-11）
- 迁移 2：`memory_items`、`memory_history`、`treasures`。
- `clock.ts`（东八区时间口径）、`memoryStore.ts`（版本链/历史/遗忘/即焚/到期真删）、`memoryContext.ts`（隐私过滤 + 记忆召回）、`extractor.ts`（提取提示词与输出校验）、`dumpIngest.ts`（睡前倾倒）、`chatTodos.ts`（聊天里记待办）。
- 接口：`/todos` `/summaries` `/ideas` `/emotions` `/memories`（含版本链、清空）`/memory-review` `/brain-dumps`（流式 + 回取）`/ephemeral` `/treasures`。
- 聊天接入：发消息时召回记忆放进提示词（用户自己提起时才放相关的脆弱记忆）、说出明确安排会记进待办并出回执和 `todo.saved` 事件、回看片段模式带入片段。
- 对照后端的方式：`backend/scripts/export_local_memory_fixtures.py` 把时间冻结在 2026-11-11 14:30，让**真实后端**跑一遍（真实数据库、假模型输出），导出 `scripts/fixtures/memory-golden.json`：时间换算 21 组、提取提示词 3 组、输出校验 14 组、记忆上下文 12 组、倾倒编排 5 组（事件流 + 落库的行 + 历史行逐项比对）、聊天记待办 17 组。TS 版必须逐项一致。
- `npm run test:local` 共 5 个脚本；`test-local-memory-api.mjs` 另测了接口行为（版本链、遗忘、今日待启、寄存到期真删、珍藏、审阅软标签、用户隔离、聊天记待办的端到端流）。

### 已知缺口（接口在本地模式下返回 501）
用户画像（P2b：每条聊天消息的“内容信号”提取 + 画像整合 → `/profile*`、“了解你”页）；信箱、交接信、晚间来信等（P3，首页的来信/待办邀请也在此）；场景（P4）；TTS/转写/实时通话、天气（P5）；数据迁移（P6）。通知轮询在本地模式下会因 `/letters` 返回 501 而静默跳过。

### 没有验证的
expo-sqlite 在真机上的打开/迁移/写入、`expo/fetch` 直连阶跃与 DeepSeek 的流式、拍照/选图后的落盘与显示、切换开关后的重启流程。Node 测试用 `node:sqlite` 与假 fetch 代替。

## 12.1 最初的范围说明（2026-11-11）

- 本文档。
- P0：`Db` 适配层与迁移、路由派发、模型客户端（路由/回退/流式/看图）、本机用户、`localMode` 开关接入 `api.ts`。
- P1 的一部分：桌宠、偏好、会话与消息、桌宠回复流式（不含记忆召回与聊天记待办，这两项属于 P2）。
- 不含：任何 UI 变化的默认开启、APK 出包、服务器改动。
