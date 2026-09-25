# 喵灵（Morning）后端

FastAPI + SQLAlchemy(SQLite) + LangGraph。分两层：

- **AI 网关 `/ai/*`**：阶跃星辰的文本/语音转写/实时通话封装，API key 只留服务端。
- **业务层 `/api/v1/*`**：账号、对话、睡前倾倒、双轴记忆、信箱、桌宠等，全部
  `Authorization: Bearer <token>` 按用户隔离。接口契约见 [docs/api-design.md](docs/api-design.md)，
  记忆系统规格见 `../.kiro/specs/memory-system/`。

## 阶跃模型接入

| 能力 | 模型 | 端点 / 入口 |
|---|---|---|
| 文本 | `step-3.5-flash` | `POST /ai/chat`；服务端内部走 `app/llm.py`（对话/倾倒抽取/来信/剧本/场景整理/主动决策/结算摘要） |
| 语音合成 | `stepaudio-2.5-tts` | `POST /ai/tts` → 转存 `/static/tts_audio/*.mp3` |
| 语音转写 | `stepaudio-2.5-asr` / `-asr-stream` | `POST /ai/stt`、`WS /ai/stt/stream`（中继） |
| 实时语音通话 | `stepaudio-2.5-realtime` | `WS /ai/realtime`（中继） |
| 文生图 | `step-image-edit-2` | `image.generate_and_store` → `/static/scene_images/*.png` |
| 图生图/改图 | `step-image-edit-2` | `image.edit_and_store`（`/v1/images/edits`，1–2s，剧情推进时按需换图） |

### ⚠️ Step Plan 与标准 /v1 的模型清单不同

`STEPFUN_BASE_URL` 可以指向两处，**可用模型不一样**：

| base_url | chat | 生图/改图 | TTS |
|---|:---:|:---:|---|
| `https://api.stepfun.com/v1` | ✅ | ✅ | `step-tts-mini` ✅ / `stepaudio-2.5-tts` ✅ |
| `https://api.stepfun.com/step_plan/v1` | ✅ | ✅ | 只有 `stepaudio-2.5-tts`；`step-tts-mini` → **404 model_invalid** |

所以 `step_tts_model` 固定用 `stepaudio-2.5-tts`（两边都可用）。
换 `STEPFUN_BASE_URL` 后**必须**跑一遍 `uv run python scripts/test_stepfun_caps.py`
（文本/TTS/转写/生图四项全测），别只看 `/health` —— 它不体检各能力。

Step Plan 是阶梯限速（实测 RPM=10）。一次用户操作常连打多次 LLM，
`app/llm.py` 已把 `max_retries` 提到 5 让 SDK 自己退避重试；
调用方仍保留兜底文案，重试用尽还是会降级。

## 快速开始

```bash
cd backend
cp .env.example .env          # 填 STEPFUN_API_KEY；JWT_SECRET 生产必改
uv sync                       # 装依赖（或直接 .venv/Scripts/python.exe）
uv run uvicorn app.main:app --reload   # 默认 http://127.0.0.1:8000
```

启动时自动 `create_all` 建表（dev）；生产走 Alembic：`uv run alembic upgrade head`。

## 线上部署（Docker）

### SMTP 邮箱登录

沿用阿里云邮件推送 SMTP（不是阿里邮箱，也不需要 AccessKey）。配置示例在 `.env.example`：

- `EMAIL_LOGIN_ENABLED=true` 开启；默认 false。关闭只阻止邮箱验证码发送/登录，密码登录及已有 JWT 不受影响。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_EMAIL`、`SMTP_PASSWORD`、`SMTP_SENDER_NAME`。465 使用证书验证的 SSL；secure=false 时强制 STARTTLS，禁止明文认证。每次网络操作超时 10 秒。
- 本地已沿用既有项目发信地址/SMTP 密码，显示名称为喵灵；源项目未改。共享发信地址也共享额度和信誉，正式使用建议在同账号下独立创建喵灵发信地址及密码。
- 凭证只放后端 `.env`/环境变量，禁止写入前端、Git、日志。部署时安全配置目标服务器，不把示例中的空值覆盖到已有配置。
- 数据库新增迁移 `019_email_auth`（三个新表，不改旧用户列）。开发启动通过 create_all 建新表；已有生产库先备份，再运行 `alembic upgrade head`。本轮没有对真实数据库执行迁移。
- 必须先配置客户端到后端的 HTTPS，再面向真实用户启用；SMTP 的 SSL 不能保护 App 到后端的 HTTP 链路。
- 首次绑定需邮箱验证码和原账号密码，绑定后仍使用同一 user_id。详情见 [API §A.1](docs/api-design.md#a1-smtp-邮箱验证码2026-09-11)。Android/Web 登录页已接入；鸿蒙原生页尚未接入。
- 回滚优先关闭开关，不删除邮箱绑定表；关闭邮箱登录不影响原密码登录。

隔离验证（不发邮件，不改开发库）：在 backend 下设置 `PYTHONPATH=.`、`PYTHONUTF8=1`，执行 `.venv/Scripts/python.exe scripts/test_email_auth.py`。真实验收需授权测试收件地址，检查实际收件、垃圾箱、重发、绑定后原数据以及限流；SMTP 接受不等于收件箱送达。

### Docker 部署

线上实例：`http://223.109.142.152:8000`（容器 `morning-backend`，见 `../deploy/`）。

```bash
# 仓库根目录，密码只从环境变量读、不入库
$env:MORNING_SSH_PASSWORD='...'
uv run --with paramiko python deploy/deploy.py --step all     # docker→sync→up→status
uv run --with paramiko python deploy/deploy.py --step sync    # 只同步代码
uv run --with paramiko python deploy/deploy.py --step up      # 重建容器
```

服务器上看日志：`cd /opt/morning && docker compose logs -f backend`。
SQLite 与静态文件在命名卷 `morning_morning-data` / `morning_morning-static`，重建容器不丢。
首次启动由 `docker-entrypoint.sh` 用 `create_all` 落基线并 `alembic stamp head`，
之后每次启动跑 `alembic upgrade head`。

⚠️ 当前是 HTTP 明文、8000 端口对公网开放、注册接口无限制，仅适合演示，别放真实用户数据。

## 业务接口一览（/api/v1）

| 资源 | 路径 | 状态 |
|---|---|---|
| 账号 | `/auth/register|login|refresh|logout`、`/users/me` | ✅ |
| 对话 | `/conversations[/{id}[/messages]]`（`?stream=true` 走 SSE） | ✅ |
| 睡前倾倒 | `POST /brain-dumps`（SSE 流式回执）、`GET /brain-dumps/{id}` | ✅ |
| 五类存储 | `/todos`、`/summaries`、`/ideas`、`/emotions` | ✅ |
| 记忆 | `/memories`（CRUD+清空）、`/memory-review`（审阅面·软标签） | ✅ |
| 信箱 | `/mailbox`、`/letters`、`/ephemeral`、`/treasures` | ✅ |
| 桌宠 | `/pets[/presets|/active|/{id}]`（切换触发交接信） | ✅ |
| 交接信 | `/handoffs[/{id}]`（只读） | ✅ |
| 片场 | `/candidates`、`/scenes`（含 templates/parse/parse-role/plays/calibrate/settlement） | ✅ |
| 偏好 | `/preferences`（含定时窗口/安静时段/分信号开关/每日上限）、`/preferences/location` | ✅ |
| 主动信号 | `/signals`（motion/usage/tick/deliveries/ack/events/decisions） | ✅ |

### 主动触发信号（非日记类）

时间窗口、法定节假日、定位（驾车/天气/城市变化）、手机使用异常六类信号，
经融合引擎评分 → AI 决策网关 → 投递事件。详见 `docs/api-design.md §10.1`，
实现在 `app/services/signals/`：

| 文件 | 职责 |
|---|---|
| `date_context.py` | 内置国务院放假安排表（含调休），判工作日/周末/节假日/节前 |
| `detectors.py` | 六类检测器，产出 0~1 基础分 + 证据 + 冷却 + 优先级 |
| `context.py` | 决策上下文（本地时间/日期/天气/城市/运动/使用摘要/桌宠/表层素材） |
| `decision.py` | AI 决策网关 allow/suppress + 投递方式，失败一律 suppress |
| `fusion.py` | 归一化评分、冷却去重、每日上限、安静时段、深夜保护、投递 |
| `runner.py` | 5 分钟调度入口 + 速度样本清理 |

新年份的放假安排：往 `date_context.HOLIDAY_RANGES` / `MAKEUP_WORKDAYS` 各加一行即可。

## 验证（需先启动服务）

```bash
uv run python scripts/smoke_test.py          # 网关：/health + /ai/chat
uv run python scripts/ws_smoke.py            # 网关：/ai/realtime 链路
uv run python scripts/auth_smoke.py          # 账号全流程
uv run python scripts/test_conversations.py  # 对话 + 从会话生成倾倒
uv run python scripts/test_brain_dumps.py    # 倾倒 SSE + 回执回取
uv run python scripts/test_pets.py           # 桌宠 + 交接信
uv run python scripts/test_mailbox_ext.py    # 来信/临时思绪/珍藏
uv run python scripts/test_memories.py       # 记忆 CRUD
uv run python scripts/test_stores.py         # 五类存储（待办/小结/灵感/情绪）
uv run python scripts/handoff_smoke.py       # 交接信
uv run python scripts/test_phase2.py         # 记忆 phase2（信箱交还）
uv run python scripts/test_phase3.py         # 记忆 phase3（做梦 Agent）
uv run python scripts/test_signals.py        # 主动触发信号（检测器+融合+HTTP 端到端）
uv run python scripts/test_scene_parse.py    # 场景整理/角色整理（走 LLM、不编造、不贴标签）
```

> `test_scene_parse.py` 默认打线上（`MORNING_API_BASE` 可覆盖成 `http://127.0.0.1:8000`）。
> `test_signals.py` 含 service 层单测，需 `PYTHONPATH=.`。

service 层测试（免启动服务，需 `PYTHONPATH=.`）：

```bash
uv run python scripts/test_stage.py            # 片场供给/结算
uv run python scripts/test_proactive.py        # 信任门控
uv run python scripts/test_phase6.py           # 隐私/上下文/审阅（含 HTTP 段，需服务）
uv run python scripts/test_burn_raw.py         # keep_raw_dump→burn_raw_ref 焚原文 + 情绪落 30 天 TTL
uv run python scripts/test_ephemeral_weekly.py # 到期硬删（行+历史）+ 周报生成/幂等
```

> Windows 控制台跑脚本请加 `PYTHONUTF8=1`（否则 emoji print 报 GBK 编码错）。

## 开发约定（踩过的坑）

1. **dev 库由 `create_all` 建**：不会给已存在的表加列。改列需手动 ALTER 或删
   `morning.db` 重建；新表无需处理。Alembic 迁移（`alembic/versions/`）是 prod 路径，
   模型/字段变更要同步写迁移，revision id ≤ 32 字符。
2. **新模型要注册** `app/models/__init__.py`；**新 router 要挂载** `app/main.py`。
3. `--reload` 监视整个目录：写 `scripts/*.py` 会触发重启，先建好文件再测。
4. 桌宠/片段等跨表引用暂用裸 Integer + 名称快照，不设 FK（与 user_id 先例一致）。

## 红线

- 不向用户输出心理诊断/人格标签/冰山层名；深层假设一律不确定措辞 + provenance。
- vulnerable/core 记忆默认 privacy=local，外发（同步/外部 Provider）必须过
  `app/services/privacy.py` 的 `can_send_external`。
- **检索纯本地、无向量库**：召回 = 结构化分层 + 关键词/实体匹配，
  做梦聚类 = 纯 entity 交集。私密内容没有任何外发路径。
- 来信不设每日数量上限（游戏邮箱口径），但各来源靠 generation_key 幂等，同一来源同天只有一封；每周日 20:00（东八区）投一封周报（`type=weekly`，只取 surface 素材）。
- 临时思绪保存 30 天（`inbox.EPHEMERAL_TTL_DAYS`）到期**硬删**：物理删记忆行 + 历史行，不留人物/地点/原话/事件
  （`inbox._hard_delete_memory`；Property 4 的受限例外，仅到期思绪）。
- 原始倾诉按用户 `keep_raw_dump` 开关：关则提取成功后即焚 `raw_ref`（含语音，走 `privacy.burn_raw_ref`），
  仅留整理后的 `surface_text`；提取失败不焚（先接住用户）。agent 上下文只读 `surface_text`，焚原文不影响记忆连续性。
