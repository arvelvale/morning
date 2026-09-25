# 喵灵（Morning）后端 REST API 设计

> 依据《Morning 项目功能文档》反推的领域资源与接口。原则：RESTful、资源名词复数、
> 标准动词（GET/POST/PATCH/DELETE）、状态流转优先用 `PATCH status` 或子资源动作。
> ★ = 黑客松原型核心（文档 §7）；○ = 完善期。

## 0. 全局约定

- **Base path**：`/api/v1`
- **两层关系**：本 REST 是**业务层**；实时/流式能力走已建的 **AI 网关** `/ai/*`
  （`/ai/chat`、`/ai/stt`、`/ai/stt/stream`、`/ai/realtime`）。业务层内部调用 LangGraph +
  AI 网关，不把 key 暴露给前端。
- **用户模型（已定：多用户+账号）**：所有业务资源都加 `Authorization: Bearer <token>`
  并**按登录用户隔离**。URL 里不放 userId（从 token 解析）。见 §1 Auth。
- **AI 重活走 SSE 流式回执（已定）**：睡前分类、场景生成/推进这类耗时任务，创建类接口
  直接返回 `text/event-stream`，边处理边推事件（如逐条 `item.classified` → 最后 `receipt`/`done`），
  同时把结果持久化，之后可用 `GET` 回取。前端体验"边整理边看到结果落位"。
- **通用**：时间 ISO-8601；列表分页 `?limit=&cursor=`；隐私资源软删除；错误体
  `{ "error": { "code", "message" } }`。

---

## A. 账号 Auth（多用户）★

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` ★ | 注册 `{ ... }` → 返回 token |
| POST | `/auth/login` ★ | 登录 → 返回 `{ accessToken, refreshToken? }` |
| POST | `/auth/email/send-code` | ✅ SMTP 邮箱验证码 `{email, purpose: "login" | "bind"}` |
| POST | `/auth/email/login` | ✅ 邮箱登录/首次绑定，返回标准 `access_token/refresh_token/token_type` |
| POST | `/auth/refresh` ○ | 刷新 token |
| POST | `/auth/logout` ○ | 注销 |
| GET | `/users/me` ★ | 当前用户信息 |
| PATCH | `/users/me` ○ | 修改资料 |

> 注册、密码登录、邮箱验证码发送/登录、refresh 不要求 access token（refresh 校验 refresh_token）；其余接口要求 `Authorization: Bearer <token>`，
> 资源按 token 里的用户隔离。桌宠、记忆、信箱等全部 user-scoped。

### A.1 SMTP 邮箱验证码（2026-09-11）

- `POST /auth/email/send-code`：邮箱去首尾空白、转小写；支持常规 ASCII 邮箱。返回 `{message, retry_after:60, expires_in:300}`。不根据是否已绑定返回不同发送结果，避免暴露注册状态。
- `POST /auth/email/login`：`{email, code, purpose:"login"}`；仅独立 `email_identities` 中的已验证邮箱可登录，历史 `users.email` 是未验证资料，不能用来授权。
- 首次绑定：同一路径提交 `{email, code, purpose:"bind", username, password}`，验证码必须按 `bind` 用途申请。核对原账号密码后绑定并返回该账号 token；不会创建新用户。一账号一验证邮箱，不在此接口更换/抢占已有绑定。
- 用户名密码注册仍保留。新用户先注册，已有用户在登录页选择“邮箱验证码 → 首次使用？绑定已有账号”。未新增邮箱自动注册或找回密码。
- 错误响应沿用现有 FastAPI `{detail: ...}`：输入错误 422，验证码/密码验证失败 400，绑定冲突 409，限流 429（附 Retry-After），开关关闭或发信失败 503。
- 验证码 6 位、安全随机数、HMAC 摘要落库、5 分钟有效、最多 5 次错误、成功一次性消费；绑定密码错误也消费验证码。用途隔离，重发替换旧验证码。
- 数据库持久化限额：同邮箱 60 秒 1 次、滚动起算的小时窗口 5 次；同客户端 IP 小时窗口 20 次；全局 24 小时窗口 200 次。校验请求同 IP 小时窗口 60 次。发送失败仍消耗限额。均为初始设计值，不是阿里云套餐配额。
- 当前 SQLite 用短 `BEGIN IMMEDIATE` 写事务串行化额度和消费，SMTP 网络请求在事务之外。若切换数据库需适配并发锁方案。
- IP 使用 Request.client，不自行解析请求头；代理部署必须限制受信任转发来源，避免 IP 伪造或所有用户误共用代理 IP。
- `users.email` 资料编辑不等于更改验证身份；此次未新增个人资料页的验证邮箱管理或解绑入口。
- 开通、配置、回滚见 [backend README 的 SMTP 邮箱登录章节](../README.md#smtp-邮箱登录)。

## 1. 陪伴首页 Companion ★

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/companion/home` ★ | 首页聚合：当前桌宠、它此刻在做什么（behavior：打盹/听歌/歪头…）、是否有轻量邀请 |

> 首页"每日新鲜感"的桌宠行为由服务端按时间/上下文计算，前端只读。

## 2. 桌宠 Pets ★ — ✅ 已实现

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/pets/presets` ★ | 预设桌宠列表（性格/语气/动作组合） |
| GET | `/pets` ★ | 我拥有/已定制的桌宠 |
| GET | `/pets/{id}` ★ | 桌宠详情 |
| PATCH | `/pets/{id}` ○ | 修改定制 |
| DELETE | `/pets/{id}` ○ | 删除 |
| GET | `/pets/active` ★ | 当前主桌宠 |
| PUT | `/pets/active` ★ | 切换主桌宠 `{petId}` → **触发交接信生成**，响应带最新 handoff |

> 已实现（`app/routers/pets.py`、`app/services/pet_store.py` + `pet_presets.py` + `handoff_letter.py`、
> `app/models/pet.py`）。4 个内置预设；`PUT /pets/active` 的 petId 传预设 id 时先实例化再激活；
> 交接信由 LLM 生成、失败退模板，不阻断切换。


| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/handoffs` ★ | 历次交接信（切换桌宠时"朋友间的交接信"，只概括计划/趋势，不复述敏感细节） |
| GET | `/handoffs/{id}` | 单封详情 |## 3. 交接信 Handoffs ★


## 4. 对话 Conversations ★ — ✅ 已实现

> 文本对话 + 历史持久化走 REST；**实时语音**走 `/ai/realtime`（前端直连网关）。
> 已实现（`app/routers/conversations.py`、`app/services/conversation_store.py`、
> 桌宠回应走 LangGraph `app/graphs/companion.py`，LLM 失败有温和兜底）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/conversations` ★ | 开启对话，`{petId, mode}`；mode ∈ `free_chat`(自由聊聊) / `brain_dump`(一股脑倒) / `hard_thing`(说件放不下的事) / `review_fragment`(回看片段, 带 fragmentId) |
| GET | `/conversations` ○ | 历史会话列表 |
| GET | `/conversations/{id}` ★ | 会话详情 + 消息 |
| DELETE | `/conversations/{id}` ○ | 删除当前用户的一段会话及其全部消息 |
| POST | `/conversations/{id}/messages` ★ | 发消息 → 返回桌宠回应（内部走 LangGraph）。`?stream=true` 走 SSE |
| GET | `/conversations/{id}/messages` | 消息分页 |

### 用户画像观察层

| Method | Path | 说明 |
|---|---|---|
| GET | `/profile/signals` | 查看当前用户的结构化内容信号（观察层，非最终画像） |
| POST | `/profile/signals/backfill` | 对当前用户历史聊天/倾倒/片场输入做有界幂等回填 |
| GET | `/profile` | 用户可见的“喵灵对我的理解”及学习开关状态 |
| POST | `/profile/consolidate` | 审阅暂存候选，通过证据与安全门控后写入稳定画像 |
| PATCH | `/profile/{id}` | 用户纠正一条画像（走记忆版本链） |
| DELETE | `/profile/{id}` | 用户删除一条画像（走遗忘历史） |

> `PROFILE_LEARNING_ENABLED` 是用户级“暂停继续学习”偏好；暂停不会删除已有画像。
> `USER_PROFILE_ENABLED=false` 是服务端灰度/紧急回滚开关，画像消费链会退化为原有行为。
>
> 观察链采用本地 VAD 词典（效价/唤醒度/控制感）与模型结构化语义分工：VAD
> 不负责主题、关系或意图判断；模型不可用时只保存 VAD，不用关键词补造语义。
> 长期画像不依赖 embedding/rerank：模型基于有界画像快照提出 ADD/UPDATE/NOOP
> 候选，本地门控校验证据原文、独立信号数、置信度、敏感度、重复项、用户纠正和
> 容量预算。自动 DELETE 永不执行，用户删除仍只走 `DELETE /profile/{id}`。

## 5. 睡前思绪整理 Brain Dumps ★（核心闭环）— ✅ 已实现

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/brain-dumps` ★ | 一次倾倒：`{text}` 或 `{audioRef}` 或 `{conversationId}`。**返回 `text/event-stream`**：边分类边推 `item.classified`（含 kind + 资源 id），末尾推 `receipt` + `done`。结果同时持久化 |
| GET | `/brain-dumps/{id}` ★ | 事后回取：回执 + 产出项引用（todos/summary/ideas/emotions/candidates 的 id）。`status: processing\|done` |

> 已实现（`app/routers/brain_dumps.py`、`app/services/dump_ingest.py`）。
> `status` 为真实语义（root 创建时 processing、收尾置 done，原地更新不走版本链）；
> `outputs` 按 kind 映射五类产出引用（片段→candidates）；GET 已带鉴权与用户隔离。
> 语音倾倒：前端可先用 `/ai/stt` 转文字再提交，或直接传 `audioRef` 由后端转写。
> 原始语音、重复语句在处理后删除（隐私红线，非接口，是后端规则）。

## 6. 分类产出：五个存储 — ✅ 已实现

睡前整理把内容分流到下面五类资源；也支持手动增改。
已实现（`app/routers/stores.py`，底层复用 memory_items + kind 专属字段 status/due_date）。

### 6.1 待办 Todos ★（在信箱「思绪」层展示）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/todos` ★ | `?status=pending\|done&due=today`（`due=today` 过滤当天到期项） |
| POST | `/todos` ○ | 手动新建 |
| GET | `/todos/{id}` | 详情 |
| PATCH | `/todos/{id}` ★ | 改内容/截止/状态（完成/取消，保留至完成或取消） |
| DELETE | `/todos/{id}` ○ | 删除 |

### 6.2 今日小结 Summaries ★（日卡）
| GET `/summaries` ★（`?date=`） · GET `/summaries/{id}` · PATCH `/summaries/{id}` ○ · DELETE ○ |

### 6.3 灵感 Ideas ★
| GET `/ideas` ★ · POST `/ideas` ○ · GET/PATCH/DELETE `/ideas/{id}` |

### 6.4 情绪 Emotions ★
| GET `/emotions` ★ · GET `/emotions/{id}` · DELETE `/emotions/{id}` |
> 只承接不强转任务；一般不编辑，可删除（隐私）。默认进"临时思绪"（30 天到期硬删）。

## 7. 片场 Theater ★

### 7.1 候选片段 Candidates ★ — ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/candidates` ★ | 待确认候选（当晚静默入草稿箱，**次日提醒**） |
| GET | `/candidates/{id}` ★ | 详情 |
| POST | `/candidates/{id}/confirm` ★ | 确认 → 转为正式 scene，响应返回新 scene（副作用动作，故用子资源而非 PATCH） |
| DELETE | `/candidates/{id}` ★ | 忽略/删除 |

### 7.2 场景 Scenes ★ — ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/scenes` ★ | 我的场景 |
| POST | `/scenes` ★ | 主动创建：`{title, people, place, plot, intent}`（补充人物/地点/经过/想尝试的表达） |
| GET | `/scenes/{id}` ★ | 详情（含视觉小说节点/脚本） |
| PATCH | `/scenes/{id}` ★ | 补充细节（标题/设定） |
| DELETE | `/scenes/{id}` ★ | 删除 |
| GET | `/scenes/templates` ★ | 内置模板（深夜通话/家中餐桌/离开的路上；对齐前端卡片） |
| POST | `/scenes/parse` ★ | **场景整理**：自由描述 → 结构化字段（不落库），供确认页回读 |
| POST | `/scenes/parse-role` ★ | **角色整理**：对 TA 的介绍 → 行为倾向列表（不落库） |

**POST `/scenes/parse`** — 请求 `{text}`（用户口述/输入的那段话，1–2000 字）。
响应：

```json
{"title":"学校门口叫住朋友","place":"学校门口","people":"朋友","relation":"朋友",
 "counterpart_action":"准备打车离开",
 "counterpart_traits":["平时比较敏感","生气后假装不在意","希望对方先道歉"],
 "counterpart_traits_text":"平时比较敏感、生气后假装不在意、希望对方先道歉",
 "intent":"想把她叫住","parsed":true,"missing":[],
 "items":[{"key":"place","label":"地点","value":"学校门口"}, ...]}
```

- `items` 是「场景整理」卡片的渲染顺序（地点/人物/对方当前行动/对方性格/你想尝试），前端直接遍历。
- **用户没提到的字段返回空串并计入 `missing`，服务端绝不编造**；`missing` 由服务端按实际内容重算，不信模型自报。
- `parsed=false` 表示 LLM 不可用、字段是退化结果，前端应提示用户手填。
- 伦理红线：`counterpart_traits` 只写可观察的行为倾向，不贴人格标签、不做诊断（AGENTS.md §4）。

**POST `/scenes/parse-role`** — 请求 `{name, relation, desc, extra_traits}`，
响应 `{"traits":["说话直，不擅长表达关心", ...],"parsed":true}`（最多 5 条，每条 ≤24 字）。
`desc` 为空时直接回落 `extra_traits`（通常来自 `/scenes/parse` 的结果），不调 LLM。

### 7.3 场景体验 Scene Play ★（视觉小说互动）— ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/scenes/{id}/plays` ★ | 开始一次体验 → 返回首个剧情节点 |
| GET | `/scenes/{id}/plays/{playId}` ★ | 当前剧情节点（背景/角色/对话/可选回应） |
| POST | `/scenes/{id}/plays/{playId}/choices` ★ | 提交一次回应选择 → 推进剧情（体验另一种表达） |
| POST | `/scenes/{id}/plays/{playId}/settlement` ★ | 结束 → 生成**结算卡** |

**POST `/scenes/{id}/summary`** —— 为「走出片场」生成回看引导。响应包含：

- `key_quote`：用户表达原句；路由会用真实 history 做确定性兜底
- `reflection_options`：3 条可被用户否定的第一人称视角候选
- `companion_comment`、`action_hint`：陪伴落款与可选小动作
- `response_count`、`custom_response_count`、`setting_label`：由场景记录确定，不交给模型推断

**POST `/scenes/{id}/settlement`** —— 用户最后确认后才写入视角卡。只有请求明确携带
`action_text` 时才创建待办；前端选择「只是看见就好」时不发送该字段。

> 剧情生成与推进（`plays`、`choices`）同样可返回 `text/event-stream`，逐句吐视觉小说文本。
> 场景不设固定最大轮数，也不会由模型强制结束。推进完成的 `done` 事件保持
> `ended: false`；从第 2 轮起可通过 `closure_ready: true` 提示前端展示自然收束建议，
> 用户仍可继续回应，并可随时主动进入 `settlement`。完整历史持久化，模型推理仅使用最近窗口，
> 避免长场景撑大上下文。
> MVP 下 **plays 子资源复用 Scene 的当前状态**（`play_id` 映射到 `scene_id`），
> 既保留 REST 契约，又避免新增独立 Play 表。后续如需支持同一 Scene 多次重玩，再拆分模型。

## 8. 信箱 Mailbox ★

信箱是四类内容的聚合视图，底层复用各资源。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/mailbox` ★ | 聚合概览：今日待启数、未读来信（`unread_letters_count`）、思绪概况（30 天，`ephemeral_count`）、珍藏入口（`treasures_count`） |

### 8.1 桌宠来信 Letters ★（主动陪伴产物）— ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/letters` ★ | `?type=music\|movie\|book\|greeting\|relationship\|scene_invite\|weekly&unread=true` |
| GET | `/letters/{id}` ★ | 详情 |
| PATCH | `/letters/{id}` ★ | 标记已读 `{read:true}` |
| POST | `/letters/{id}/ack` ★ | **「收到啦」**：标记已读 + 当前桌宠 agent 回一句轻回应 |
| POST | `/letters/{id}/reply` ★ | **「回它一句」**：以来信为上下文开一段对话 + 桌宠续写 |
| DELETE | `/letters/{id}` ○ | 删除 |

**POST `/letters/{id}/ack`** —— 无请求体。响应：

```json
{"ok": true, "letter_id": 3, "is_read": true,
 "reply": "收到啦。今天的月光分你一半。", "pet_name": "米露"}
```

- 回应经 `run_companion`（BASE_PERSONA 红线 + 激活桌宠 `system_prompt` 人格层）生成，
  与聊天同一套人格，**不是通用文案**；限 20 字内、不复述来信、不追问、不给建议。
- 与 `/reply` 的区别：ack **不开会话、不留对话记录**，只要一句就地显示的短反馈。
- LLM 失败返回 `reply: null`（HTTP 仍 200），前端退回兜底提示，不报错。

> 生成是服务端主动行为（定时/触发），非公开写接口；落库创建统一走 `LetterStore.create_generated`（内部入口）。来源幂等键彼此独立（同一来源同天只有一封），不设每日数量上限、无内容不发。
> `type=weekly` 为每周小结：每周日 20:00（东八区）由 `weekly_report.run_weekly_reports_all` 投递，聚合本周情绪走向/完成待办；只取 depth=surface 素材，不含被焚原话。
> ✅ 已实现（`app/routers/letters.py`、`app/services/letter_store.py`、`app/services/weekly_report.py`、`app/models/letter.py`）。

### 8.2 临时思绪 Ephemeral ★（30 天 TTL）— ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ephemeral` ★ | 临时思绪（情绪/生活片段/未确认候选），每项带 `expiresAt`（默认 30 天） |
| POST | `/ephemeral/{id}/keep` ★ | 用户主动留下 → 转入长久珍藏（副作用动作） |
| DELETE | `/ephemeral/{id}` ○ | 立即删除 |
> 到期**硬删**：物理删除记忆行 + 其历史行，不保留人物/地点/原话/具体事件（隐私红线）。
> 这是记忆系统「软删+历史审计」(Property 4) 的受限例外，仅对到期思绪生效。
> ✅ 已实现：TTL 由 `dump_ingest` 在创建情绪/片段时落（`inbox.EPHEMERAL_TTL_DAYS=30`）；
> 到期硬删走 `inbox.expire_ephemeral`（`_hard_delete_memory`，含 FK 断链）。

### 8.3 长久珍藏 Treasures ★ — ✅ 已实现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/treasures` ★ | 用户主动留下的总结/灵感/重要记忆 |
| POST | `/treasures` ○ | 主动收藏（from summary/idea/memory） |
| GET/DELETE | `/treasures/{id}` | 详情/删除 |
> ✅ 已实现（`app/routers/treasures.py`、`app/services/treasure_store.py`、`app/models/treasure.py`）。珍藏 = 来源引用 + 内容快照。

## 9. 记忆与隐私 Memories ○ — ✅ 已实现

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/memories` | 查看全部记忆（用户可查看/修改/删除全部记忆） |
| GET | `/memories/{id}` | 单条 |
| PATCH | `/memories/{id}` | 修改 |
| DELETE | `/memories/{id}` | 删除单条 |
| DELETE | `/memories` | 清空全部 |
> 交接信共享的正是这些"用户允许保留的记忆"。产品不做诊断、不把推测当事实。
> ✅ 已实现（`app/routers/memory.py`）。修改走 UPDATE 版本链、删除走 FORGET，均保留 history。
>
> 另有面向用户的审阅面 **`GET /memory-review`**（spec phase 6，`app/routers/memory_review.py`）：
> 只列 profile/state 层，输出 surface_text + provenance + 敏感度软标签（日常/个人/较私密/很私密），
> 不暴露轴名与任何诊断/人格标签，支持敏感度/kind 过滤。


---

## 10. 偏好设置 Preferences ★ — ✅ 已实现

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/preferences` ★ | 读取（不存在时按默认创建） |
| PATCH | `/preferences` ★ | 部分修改 |
| POST | `/preferences/location` ★ | 上报最近一次模糊位置 `{lat, lon, city}`（只存最近一次，不存轨迹） |

基础字段：`proactive_enabled`（同步写 TrustState，信任门控读那边）、`proactive_frequency`
（安静/温和/活跃）、`sleep_reminder_time`、`keep_raw_dump`、`ephemeral_ttl_days`（1–30）、
`font_size`、`companion_tone`、`reduce_transparency`。

主动触发（信号融合引擎）字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `proactive_schedule_times` | `["08:00","15:00","20:00"]` | 定时陪伴窗口，1–6 个 `HH:MM`，±6min 容差命中 |
| `quiet_hours_start` / `end` | `23:00` / `07:00` | 安静时段；只有定时类信号能突破 |
| `is_muted` | false | 临时静音，所有主动触达一律不发 |
| `scheduled_checkin_enabled` | true | 定时陪伴开关 |
| `holiday_greeting_enabled` | true | 节假日祝福开关 |
| `motion_detection_enabled` | true | 运动/速度采集开关 |
| `driving_alert_enabled` | true | 驾车陪伴开关 |
| `weather_alert_enabled` | true | 恶劣天气关心开关 |
| `usage_anomaly_enabled` | true | 手机使用异常关心开关 |
| `max_daily_triggers` | 6 | 每日主动触达硬上限（1–12，所有信号合计） |
| `driving_mode_active` | false | **只读**，由 `/signals/motion` 回写 |
| `last_motion_signal_at` | null | **只读**，最近一次速度上报时间 |

## 10.1 主动触发信号 Signals ★ — ✅ 已实现

非日记类主动触发（多维信号融合引擎）。链路：
**检测器 → 融合评分 → AI 决策网关 → 投递事件**。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/signals/motion` ★ | 批量上报速度样本，命中驾车即时走一轮决策 |
| POST | `/signals/usage` ★ | 上报手机使用日摘要（同一本地日期覆盖） |
| POST | `/signals/tick` ★ | 手动跑一轮当前用户的检测+决策（调试/演示） |
| GET | `/signals/deliveries` ★ | 轮询待投递主动消息（`?status=pending\|delivered\|all`） |
| POST | `/signals/deliveries/{id}/ack` ★ | 消费完确认，避免重复展示 |
| GET | `/signals/events` ★ | 最近信号事件（含 evidence + final_score），排查「为什么发了/没发」 |
| GET | `/signals/decisions` ★ | 最近 AI 决策日志（allow/suppress + 理由） |

**六类信号**（`app/services/signals/detectors.py`）：

| 类型 | 维度 | 触发条件 | 权重 | 冷却 |
|---|---|---|---:|---:|
| `scheduled` | 时间 | 命中用户配置的定时窗口 ±6min | 0.8 | 120min |
| `holiday` | 日期 | 法定节假日首日 09:00 / 节前最后工作日 18:00 | 1.0 | 12h |
| `driving` | 定位 | 速度 ≥30km/h 持续 ≥2min（基础分 ×0.6 折扣） | 0.9 | 15min |
| `weather` | 定位 | 恶劣天气 / ≥35℃ / ≤0℃（白天 7–21 点） | 0.8 | 6h |
| `location_change` | 定位 | 上报城市与上次不同（首次只落基线不打扰） | 0.6 | 12h |
| `usage_anomaly` | 手机使用 | 夜间>60min / 屏幕时间>7日均值1.5倍 / 拿起>2倍 / 单社交App>120min | 0.5 | 120min |

**融合规则**（`app/services/signals/fusion.py`）：
`最终得分 = 基础分 × 类型权重 × 新鲜度衰减`（5min 内满分，之后 30min 线性衰减到 0），
≥0.4 才进 AI 决策。

> ⚠️ 改权重或改检测器基础分前先算乘积：`基础分 × 权重 < 0.4` 的信号永远不会触发，
> 只会在 `signal_events` 里堆 pending 直到过期。例如天气的中雨（0.45×0.8=0.36）
> 就是被有意过滤掉的——不为一场中雨打扰用户。

安全约束：每日上限、安静时段（仅定时类可突破）、
深夜保护（本地 00:00–06:00 仅 score>0.8）、分类型开关、全局静音；
同一用户每轮最多触发一次，其余标 processed。

**投递通道**：`bubble`（桌宠气泡）/ `letter`（额外落一封 `type=proactive` 的信箱来信）/
`voice`（气泡+语音，payload 带 `speak_text`；驾车场景强制此通道且文案硬截断 40 字）/ `silent`。

**调度**：`main.py` 的 `_proactive_signal_scheduler` 每 5 分钟跑一轮 `runner.run_tick_all`；
速度样本保留 30 天，由 `_motion_cleanup_scheduler` 每天清理。

> 日记/图片驱动的触发（情绪突变 VAD 向量、极端关键词、日记事件）**未迁移**，不在本节范围。

## 11. 与 AI 网关的分工（已建）

| 场景 | 走哪条 |
|---|---|
| 文本对话（要持久化历史） | REST `POST /conversations/{id}/messages` |
| 实时语音陪伴 | 前端直连 `WS /ai/realtime` |
| 睡前语音倾倒转文字 | `WS /ai/stt/stream` 或 `POST /ai/stt` → 再 `POST /brain-dumps` |
| 服务端内部推理（分类/来信/剧情） | LangGraph 图内用 `app/llm.py` 直连阶跃 |

## 12. 设计决策记录

- ✅ **用户模型 = 多用户+账号**：全局 `Authorization`，资源按用户隔离（见 §A）。
- ✅ **AI 重活 = SSE 流式回执**：brain-dump 分类、场景生成/推进边处理边推事件（见 §5、§7.3）。
- 🔵 **状态流转风格（我的默认）**：副作用动作用子资源（`/confirm` `/keep` `/settlement`），
  纯字段更新用 `PATCH`。想统一成 `PATCH status` 可调。
- 🔵 **对话与倾倒边界（我的默认）**：睡前倾倒是独立 `POST /brain-dumps`，也接受
  `conversationId` 把一段对话喂进来；两者并存不互斥。
- ✅ **检索 = 纯本地无向量**：已移除 RAG P2（DashScope embedding /
  qwen3-rerank / Zilliz）。召回靠 context_builder 的结构化分层 + 关键词/实体匹配，
  做梦聚类走纯 entity 交集——私密内容从此没有任何外发路径。
