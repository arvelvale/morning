# 代码审查修复计划（2026-07-30）

依据三视角代码审查报告（完整性 / 正确性 / 影响面），按「安全 → 数据链路 → 稳定性 → 隐私红线 → 后端结构 → 前端结构 → 原型」的顺序修复。
部署相关事项（域名 / TLS / 服务器配置）由用户自行处理，本计划只改代码。

## P0 安全鉴权（Critical）

- [x] 1. `/ai/chat`、`/ai/stt`、`/ai/tts` 补 `Depends(get_current_user)`（backend/app/routers/chat.py、stt.py）
- [x] 2. `WS /ai/realtime`、`WS /ai/stt/stream` token 强制校验，无效即 `close(4401)`（realtime.py、stt.py；前端新增 `wsAuthUrl` 配套）
- [x] 3. `POST /api/v1/debug/dream-all` 补鉴权（debug.py）
- [x] 4. CORS：`cors_origins="*"` 时不再携带 `allow_credentials=True`（main.py）
- [x] 5. 非 debug 环境下 JWT 密钥仍为默认值时启动即失败（新增 APP_ENV 配置，prod 下 fail-fast）
- [x] 6. `PATCH /auth/me` 改邮箱前查重，冲突返回 409（auth.py）

## P1 数据链路（Critical）

- [x] 7. 新增 alembic 迁移 `013_scene_render_columns`：scenes 表补 `render_kind/theater_id/bg_image/characters` 四列（幂等守卫）；退役 `scripts/migrate_scene_render_columns.py`（标注已退役，保留应急用）
- [x] 8. 修复 CST/UTC 时区比较错误：`bedtime_reminder`、`evening_letter`、`scene_recommend` 三处统一转 UTC 后比较
- [x] 9. 语音通话 mode 漂移：`useRealtimeCall` 建会话改传 `voice_call`；修正 conversations.py 过期注释

## P2 稳定性（Critical + Warning）

- [x] 10. 四个调度器的同步 LLM 调用改 `asyncio.to_thread`（main.py：dream / scene_recommend / evening_letter / weekly_report / bedtime_reminder）；Dockerfile CMD 旁标注单 worker 假设
- [x] 11. `chat_stream` 补 httpx 超时（stepfun/client.py）
- [x] 12. `regenerate_turn_bg` 生成后重新取出场景并复查状态再提交；替换 `bg_image` 时删除旧文件（scene_turn_images.py）
- [x] 13. 新增静态文件清理：`services/static_cleanup.py` + 每日调度清理 24h 前的 `tts_audio/`
- [x] 14. `GET /brain-dumps/{id}` 的 provenance 过滤下推到 SQL（json_each）

## P3 隐私红线（Warning，AGENTS.md 硬约定）

- [x] 15. `context_builder.build` 记忆列表过 `filter_for_cloud_prompt`（新增，只拦 vulnerable/core + burn_after_read）后再拼 prompt
- [x] 16. `stage.supply` 的 `deep_memories` 过隐私闸门；`candidates confirm` 用户确认时传 `explicit_consent=True` 放行
- [x] 20（提前）. candidates.py：更新假 TODO 注释；`confirmed` 改为场景生成成功后置位

## P4 后端结构（Warning + Suggestion）

- [x] 17. 抽 `app/services/scene_service.py`：合并 `_advance_scene`/`choose` 内联版、`settle_scene`/`play_settle` 双套实现，路由只做校验与组装
- [x] 18. `_sse`、`_get_owned` 抽到 `app/routers/_common.py`（scenes/candidates/theater_ext 复用）
- [x] 19. 后端公开接口补 docstring：`list_scenes/get_scene/delete_scene`、`chat`、`realtime`、`patch_scene/calibrate`、`memory_store.get/list_by_*`
- [x] 20. candidates.py：更新假 TODO 模块注释；`confirmed` 状态改为场景生成成功后置位（已在 P3 完成）
- [x] 21. `_ensure_preference_location_columns` 加守卫：检测到 `alembic_version` 表存在即跳过
- [x] 22. `backend/.env.example` 对齐：`STEPFUN_BASE_URL` 与代码默认值一致并注释两种 plan；补 `STEP_IMAGE_MODEL/DREAMING_ENABLED/PROACTIVE_ENABLED/DATABASE_URL/APP_ENV`

## P5 前端结构（Critical：>1k 行拆分 + Warning）

- [x] 23. 拆分 `Companion.tsx`（1011 行）→ `screens/companion/` 四组件 + `shared.ts`；四个导出组件补注释（已 typecheck 通过，barrel 保留原导入路径）
- [x] 24. `Mailbox.tsx`（1356 行）：已拆为 `screens/mailbox/`（shared/TasksTab/Keepsakes/Letters/MailboxScreen）+ barrel；修 `TODAY_DATE` 写死日期、删除死 mock `INITIAL_KEEPSAKES`、清理 SealedEnvelope/handleOpenLetter 的 setTimeout（typecheck 通过）。硬编码色值（含 night 分支）按原样保留，待视觉验证后迁移。
- [x] 25. `Scene.tsx`（1545 行）：已拆为 `screens/scene/`（shared/BuildOverlays/SceneCreateFlow/SceneScreen/ScenePlay/SceneEnd）+ barrel；清理 CharacterSetupSheet/advanceCb 的 setTimeout（ScenePlay 背景轮询本已正确 clearInterval，保留原内联）。硬编码色值同 Mailbox 待视觉验证后迁移。typecheck 通过。
- [x] 26. 拆分后运行 `npm run typecheck` 验证（Companion / Mailbox / Scene 均已通过）

## P6 原型（低优先级）

- [x] 27. `morning-proto/src/app/App.tsx`（3788 行）：改用 **Python codemod 按顶层声明精确切分 + 自动推导跨模块 import**（避开就地删除分隔线匹配问题），拆为 `theme.ts` + `primitives.tsx` + `screens/`（Onboarding/Companion/Dump/Mailbox/Scene/Profile）+ App.tsx（228 行路由壳）。`npm run build` 通过（产物与基线一致，功能等价）。

## 色值迁移（P5 遗留项，已完成）

- [x] 新增 design-system `paperColors`（拟物奶油纸面文字色，日夜同值，独立于主题 ColorTokens，符合 tokens.ts「素材色不进主题 token」的既定边界）。
- [x] 迁移 Mailbox/Scene 子文件的 9 个高频纸面文字 hex（#484145/#4D4249/#62575D/#655D61/#847D72/#7E7479/#8C8187/#A39A9F/#463F3C）→ `paperColors.*`，共 66 处（codemod 完成，**值完全相同→零视觉变化**，typecheck 通过）。
- 保留（按评审豁免 / 内容语义）：内容强调色（音乐紫/场景陶土/TYPE_META）、影院暗层与场景渐变、待办周视图的日/夜三元分支值。

## 待续说明（P5 物理拆分 / P6）

剩余三处 >1k 行文件的**物理拆分**（Mailbox / Scene / proto App）属纯结构搬运，量大且需逐文件保持 typecheck 绿；
Mailbox/Scene 的硬编码色值迁移含 night 分支，改单一 token 可能回退夜间视觉，需视觉验证后再做。
建议作为聚焦的后续任务逐个执行（Companion 已完成，可作为拆分范式参照）。

## 明确不做（需用户决策 / 部署侧）

- `api.ts` 硬编码 `http://223.109.142.152:8000`：换域名 + TLS 属部署侧，由用户处理；代码保留 `EXPO_PUBLIC_API_BASE` 覆盖机制不动
- 调度器多 worker 领导锁：当前单 worker 部署，先在 Dockerfile CMD 旁加注释说明假设即可（并入任务 10）

## 验证方式

- 后端：`cd backend && uv run python -c "import app.main"` 冒烟导入；关键改动用现有 scripts 下测试脚本抽查
- 前端：`cd frontend-demo && npm run typecheck`
- 不做构建、浏览器端到端与部署（用户自行处理）
