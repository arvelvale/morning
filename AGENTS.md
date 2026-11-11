# AGENTS.md — 喵灵（仓库/项目代号 Morning）

思绪托管 + 情感陪伴 App（AdventureX 黑客松项目）。一句话：把明天的事还给明天，
把没闭环的过去在片场重演里了结。产品文档：`Morning项目功能文档-精简版.md`。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `backend/` | FastAPI + SQLite + LangGraph 后端（AI 网关 `/ai/*` + 业务层 `/api/v1/*`），详见 `backend/README.md` |
| `backend/app/routers/`、`backend/app/services/` | 按业务域分子包（routers：`ai/ scene/ mailbox/ companion/ memory/ system/`；services：`scene/ mailbox/ pet/ memory/ companion/ signals/ infra/`），新模块归入对应域；导入用绝对路径 `app.services.<域>.X`，子包 `__init__.py` 只写职责说明、不做万能 re-export |
| `backend/docs/api-design.md` | REST 接口契约（各节标注 ✅ 已实现 / 未实现） |
| `.kiro/specs/memory-system/` | 双轴记忆系统 spec（requirements/design/tasks），Phase 0–6 已全部实现 |
| `landing/` | 喵灵官网落地页（Vite + React + TS；`npm run build` 产出 `dist/`，发布到 GitHub Pages：https://arvelvale.github.io/morning-site/ ，用 `deploy/publish_site.py`；yingjiapp.com 已于 2026-10-08 还给映记 / 栖光，`deploy/sync_landing_site.py` 停用）。官网「更新日志」的内容在 `landing/src/changelog.ts`：**发新版（公开发布后）先在数组最前面加一条用户看得懂的更新说明，再跑 `publish_site.py`**，只写已公开发布的版本 |
| `morning-proto/` | 前端 HTML 原型（4-Tab IA，Vite 原型；`npm run dev`） |
| `frontend-demo/` | React Native / Expo 移植版（`npm run web` 浏览器预览 / `npm run android`），详见 `frontend-demo/README.md` |
| `frontend-demo/src/local/` | **本地优先运行时**（手机里的“虚拟服务器”：SQLite + 直连模型服务商，设计见 `docs/specs/2026-11-11-local-first-runtime.md`）。`api.ts` 在本地模式下把接口调用交给它，没实现的接口明确报“本地模式暂不支持”，**不得回退到服务器**。`src/local/generated/` 与 `scripts/fixtures/*.json` 由 `backend/scripts/export_local_fixtures.py` 生成：**改了后端提示词（graphs/companion.py、pet_prompts.py、pet_presets.py）或 llm.py 的换路规则，要重跑它再跑 `npm run test:local`**；记忆/待办这一块同理，对应 `backend/scripts/export_local_memory_fixtures.py`（改了 extractor.py、temporal.py、memory_store.py、privacy.py、context_builder.py、dump_ingest.py、chat_todos.py 就要重跑）。后端新增/改动的接口按 spec 的阶段表移植 |
| `frontend-demo/src/pets/rig/` | 米露/波比角色运行时 `pet-rig.js`（程序化骨骼动画，App、官网、鸿蒙共用一份源码）；改完在 frontend-demo 下 `npm run rig:build` 同步各处副本，不要手改副本。状态演示见 `design-demos/pet-motion/pet.html` |
| `harmony/` | HarmonyOS NEXT 原生客户端（ArkTS + ArkUI），详见 `harmony/README.md`；计划与里程碑见 `docs/2026-08-27-harmonyos-next-development-plan.md` |
| `docs/progress/` | 开发日志：每天一个 `YYYY-MM-DD.md`，双层结构（产品语义优先、实现细节其次），规则与索引见 `docs/progress/_开发日志规范.md` |
| `deploy/` | 后端 Docker 部署（`deploy.py` 一键装 Docker/同步/重建；`docker-compose.yml`） |
| `references/` | 参考架构文档 |
| `.codex/skills/harmony-release-build/` | 鸿蒙签名、Hvigor 构建、Release 产物与 AGC 云调试诊断 Skill；处理相关任务时优先使用 |

线上后端：`http://223.109.142.152:8000`（容器 `morning-backend`）。前端默认连它，
本地联调在 `frontend-demo/.env` 写 `EXPO_PUBLIC_API_BASE`。

## 常用命令

```bash
# 后端
cd backend && uv run uvicorn app.main:app --reload    # 起服务（:8000）
cd backend && uv run alembic upgrade head             # prod 迁移
# 测试脚本：见 backend/README.md「验证」一节；Windows 需 PYTHONUTF8=1，
# service 层脚本需 PYTHONPATH=.
```

## 硬约定（新人必读）

Android release 构建用 PowerShell 与 **Java 17（`D:/jdk`）**，沿用现有签名和 `arm64-v8a` 发布架构。不要直接改用 Java 21：本地 Expo 模块未单独固定 Kotlin 目标，会造成 Java 17 / Kotlin 21 不一致。构建缓存与临时目录使用现有非系统盘路径，环境覆盖结束后恢复原值；不默认 clean。发布/回滚证据见 `docs/releases/`。

1. **dev 库 `backend/morning.db` 由 create_all 建**，不加列；改列手动 ALTER 或删库。
   模型/字段变更必须同步写 `backend/alembic/versions/` 迁移（revision id ≤ 32 字符）。
2. 新模型注册 `backend/app/models/__init__.py`；新 router / service 放进 `routers/` `services/` 对应业务域子包（无合适域再新建），新 router 还需在 `backend/app/main.py` 按域导入并 `include_router`。
3. 所有业务接口必须 `Depends(get_current_user)` 做用户隔离，URL 不放 userId。
4. 伦理红线：不诊断、不贴人格标签、不把推测当事实；vulnerable/core 记忆
   默认 local 不外发（走 `app/services/memory/privacy.py` 判定）；进云端模型 prompt 的口径是
   「只在用户自己提起时用，米露绝不主动翻出」：用户发起的聊天里，仅当**当前这条消息**与某条
   vulnerable/core 相关才放入（`privacy.select_user_raised_sensitive`，有条数/字符预算，仅
   `context_builder.build(user_initiated=True, user_text=…)` 显式打开）；晚间来信、周报、问候/信号、
   自动推荐片场、做梦等米露主动路径一律不用；burn_after_read 任何路径都不放。
5. `morning.db*`、`.env` 不入库（见 `.gitignore`）。
6. 生成式 3D（SceneSpec）的零件/人物字段同步（改动需跨这些位置）：
   `backend/app/services/scene/scene_spec.py`（白名单 + 导演 prompt）、
   `frontend-demo/src/theater/generated/spec.ts`（绝对坐标版类型）、
   `frontend-demo/src/theater/generated/layout/types.ts`（语义版关系词表）、
   `frontend-demo/src/theater/generated/props.ts` 与 `frontend-demo/src/theater/figure/`（实现，
   新增可承载零件记得在 `layout/propMeta.ts` 补座位/承载锚点）。

## 前端设计与迁移规则

前端视觉规格是 `docs/specs/2026-07-25-morning-frontend-visual-redesign.md`，
2026-10 改版第二稿 `docs/specs/2026-10-07-app-redesign-v2.md` 覆盖其中的配色、字体、首页与引导（两者冲突以第二稿为准）。
修改 `frontend-demo/` 时必须遵守：

1. Web 与移动端同等重要，使用同一套 React Native / Expo 代码响应式适配。
   `>= 1024px` 使用桌面侧栏，较窄视口使用手机底部导航；不能只把手机界面拉宽。
2. 视觉方向是温暖、安静、治愈和克制。日间模式完整打磨；夜间模式至少保证
   可读、可操作和语义色完整。
3. 标题与米露说的话用随包字体 Miaoling Kai（霞鹜文楷子集，`scripts/build-font-subset.py` 生成），正文、按钮、输入框用系统无衬线；手写体样式字重一律 400。分工见第二稿 §3。
4. 新页面和已迁移页面只能从 `frontend-demo/src/design-system/` 使用主题、token
   和公共组件。不得重新引入旧 `palette`、颜色常量或旧万能组件。
5. 桌面侧栏与手机底栏的选中态是 `accent` 实心胶囊（日间深靛、夜间浅薰衣草）垫在图标下；
   金色 `star` 只给「被接住的东西」，不作通用强调。
6. 迁移只改变视觉、响应式布局与交互反馈；保留业务逻辑、API、数据状态、
   用户文案和素材语义。需要改变业务行为时必须先取得用户确认。
7. 高频交互不添加装饰性动画。按压反馈约 `scale(0.97)`；普通 UI 动画不超过
   300ms，并支持 reduced motion。
8. 不为每个阶段重复创建计划文档；在现有规格下直接按阶段执行。
9. 每组页面完成后至少运行 `npm run typecheck`、`git diff --check`，并通过
   `?screen=<screen-id>` 检查 390×844 手机视口、1440×900 桌面视口和基本夜间可用性。
10. 不删除或覆盖队友的无关改动；提交按逻辑阶段拆分，工作区保持干净。

## 远程仓库

`https://github.com/arvelvale/morning`。任务看板：Linear Dayfire 团队 morning 项目。

## 文档维护

文档入口见 [docs/README.md](docs/README.md)。规格正本在 `docs/specs/`，计划在 `docs/plans/`，有实质变化时更新当天 `docs/progress/` 日志；长期约束更新对应正本，日志链接它。

Obsidian `D:/文档存放/wisdom/Aerchen/项目/Morning` 保留产品回顾与审阅笔记。只有产品方向、阶段结论或审阅材料变化时更新相应笔记并链接仓库正本，不要求每次代码修改复制一篇笔记。2026-07-30 的盘点属于历史快照。
