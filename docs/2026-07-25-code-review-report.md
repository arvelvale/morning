# Morning 代码审查报告（2026-07-25）

> 全项目只读审查：后端逻辑、前端体验、前后端契约与数据安全。
> 方法：按域并行只读调查 + 关键文件人工亲验 + 动态验证（typecheck / service 层测试 / git diff --check）。
> 严重度：**P0** 隐私红线/安全直破 ｜ **P1** 核心功能失效/高影响 ｜ **P2** 重要缺陷 ｜ **P3** 轻微/卫生。
> 所有发现均给出 `文件:行号` 证据；未修改任何代码。

---

## 0. 总体结论

后端架构分层清晰、隐私体系设计严谨（版本链/焚毁/硬删/门控均有 spec 支撑），前端 design-system 基础层质量高。
但存在 **2 项 P0 隐私红线直破**（vulnerable/core 记忆无过滤进入外部 LLM，每日定时/每次对话触发）、
**约 22 项 P1**（信箱来信被互撞吞掉、周报幂等失效、并发结算双写、前端弱网误登出、核心页面卡死等），
以及一批 P2/P3。修复优先级：**先修 P0（两处过滤器缺失）→ 信箱幂等与时区体系 → 并发原子性 → 前端 401/断线处理**。

---

## 1. P0 —— 隐私红线直破（立即修复）

| # | 位置 | 问题 |
|---|---|---|
| P0-1 | `backend/app/services/memory/content_signals.py:180-192, 222-227` | `_memory_snapshot` 直接取 `layer=profile` 记忆（最近 12 条）的 `surface_text or content` 拼进外部 LLM 的 `existing_profile` 载荷，**无 `filter_for_cloud_prompt`、无 depth/privacy 检查**。profile 层常态含 vulnerable/core 深度记忆（`dreaming.py:242-252` 下沉产物 layer=profile、depth 可 vulnerable/core）。`capture_best_effort` 由每次对话/倾倒/建场景/语音通话后台触发（conversations.py:227,271；brain_dumps.py:79；scenes.py:279,313,379,393,458,470；realtime.py:60），默认开启。违反 Property 9 红线。 |
| P0-2 | `backend/app/graphs/dreaming.py:71-95（recall）、206-218（descend）` | recall 取近 24h **全部**未遗忘记忆（无 depth/privacy/expires_at 过滤）；descend 把 vulnerable **原文** `mem_text` 直接拼进 `get_chat_model()` 的 user_msg。**每日凌晨定时触发**（main.py:70-89）。与 README「私密内容没有任何外发路径」及 `filter_for_cloud_prompt` 的既有口径（context_builder.py:104 唯一正确调用点）直接矛盾。 |

**修复建议**：两处补 `filter_for_cloud_prompt`（或 SQL 层 `depth NOT IN (vulnerable,core) AND privacy != burn_after_read`）；`dreaming.recall` 同时排除未到期 TTL 寄存记忆（P1-22）。为这两条路径补回归测试（现有 `test_phase6.py` 只覆盖 context_builder）。

---

## 2. P1 —— 核心功能失效 / 高影响

### 2.1 信箱与来信

| # | 位置 | 问题 |
|---|---|---|
| P1-1 | `evening_letter.py:96-101` + `inbox.py:190`；`bedtime_reminder.py:55` + `inbox.py:201` | **晚间信/睡前提醒被早间信吞掉**：三个生成方复用 `type` 做幂等键（早间信1=greeting、信2=reminder；晚间信查 greeting；睡前提醒查 reminder）。用户白天打开 App 生成早间信 → 当晚晚间信与睡前提醒**永久跳过**（几乎每个活跃用户每天发生）。反向：晚间信先生成 → `build_letters` 的「当天已有任何类型信就跳过」（inbox.py:170-171）吞掉次日早间信。 |
| P1-2 | `inbox.py:159-171`；`fusion.py:209-222`；`scene_recommend.py:339-346` | 「每日 ≤1-2 封」限额**体系性可绕过**：6 个生成方各自独立幂等；proactive 信号信**完全没有每日检查**（max_daily_triggers 默认 6，每 5 分钟一轮）；加上 scene_invite/晚间/睡前，用户一天可收 8+ 封。`build_letters` 的 check-then-create（inbox.py:162-171, 209-217）无锁无唯一约束，并发双写突破限额。 |
| P1-3 | `routers/mailbox/mailbox.py:62-66` | `POST /api/v1/mailbox/expire` **无鉴权**（无 `Depends(get_current_user)`），任何可触达 API 者可触发全库物理删除扫描。违反 AGENTS.md 硬约定 #3；滥用可反复消耗 SQLite 写锁。 |
| P1-4 | `inbox.py:121-125` + `memory_store.py:152-165` | **被遗忘的寄存记忆永不物理清除**：`expire_ephemeral` 只扫 `is_forgotten == False`；用户手动删除的寄存（`MemoryStore.forget` 只置 is_forgotten、不清 expires_at）永远进不了硬删队列，**含 raw_ref 逐字原文永久残留**（若用户开「保留原文」）。与「寄存=到期真删、不留痕迹」隐私承诺冲突。 |
| P1-5 | `weekly_report.py:49-51, 88-99` | **周报幂等时区 bug**：`_week_start_cst()` 返回东八区 aware datetime，未像 evening/bedtime 那样 `.astimezone(timezone.utc)`；SQLite 方言忽略 tzinfo 直接取字段 → 比较偏移 +8h，幂等检查恒不命中。周日 20:00 发信后任意补跑（多 worker/手动）**立即再发一封**。且窗口是「7 天滑动」非「自然周」，同日 20:30 再触发也重复。 |

### 2.2 片场状态机

| # | 位置 | 问题 |
|---|---|---|
| P1-6 | `scenes.py:411-412, 480-481` + `scene_service.py:40-66` + `stage.py:89-163` | **settlement 并发不幂等**：settled 检查是 check-then-act，`stage.settle` 内多次独立 commit，场景置 settled 在最后。双击结算/双端点并发/超时重试 → 行动/领悟/结算卡记忆、珍藏、role.notes **全部执行两次**，无唯一约束兜底。 |
| P1-7 | `scenes.py:156-187` | **SSE 流式推进写回已结算场景**：`_advance_stream_gen` 用新 session 重取场景，只查 `sc is None`，不查 `sc.status == "settled"`；流生成期间用户结算后仍把 beats/history 追加写回，`sc.turn = turn` 用请求时快照（并发推进丢失更新）。 |

### 2.3 信号系统

| # | 位置 | 问题 |
|---|---|---|
| P1-8 | `fusion.py:53-62` + `detectors.py:527-541` | **手机使用异常（usage_anomaly）几乎永远无法投递**：权重 0.5 × 阈值 0.4 → 基础分需 ≥0.8（四条件全中才可能）；深夜刷手机 3 小时（0.55 基础分）×0.5=0.275 被拦。该功能默认配置下形同虚设。 |
| P1-9 | `fusion.py:331-334` | **安静时段对非定时信号是直接丢弃而非顺延**：usage_anomaly 恰在夜间检测，23:00-07:00 默认安静时段内生成即 expired，白天不重检——与 P1-8 叠加，深夜刷手机场景永无投递。文档注释（fusion.py:12「其它信号一律顺延/过期」）与实现不符。 |
| P1-10 | `fusion.py:284-421` + `runner.py:113-139` + `main.py:276` | **process_pending 无锁 read-modify-write**：5 分钟 runner 与 HTTP 即时触发（/tick、/signals/motion）并发 → 同一批 pending 双投递、每日上限击穿（max=6 实际 7-12 条）；多 worker 部署必然重复（main.py:276 注释已承认）。`dedupe_key` 仅普通索引（signal.py:54）无唯一约束兜底。 |
| P1-11 | `decision.py:92-95, 176-185` | **AI 决策失败「一律 suppress」且兜底文案从未实现**：`FALLBACK_MESSAGES` 定义后全仓库无引用（死代码）。LLM 短暂故障覆盖 08:00±6min 窗口 → 用户设定的早安问候整窗静默丢失，信号置 processed 永不重试。 |

### 2.4 未提交新功能

| # | 位置 | 问题 |
|---|---|---|
| P1-12 | `routers/memory/profile.py:117-121` + `content_signals.py:222` | `POST /profile/signals/backfill?limit=200` **同步循环逐条调 LLM（最多 200 次）**：Step Plan RPM=10 下请求必然超时/大量失败；无频率限制可反复调用 → 配额滥用。 |
| P1-13 | `routers/system/debug.py:27-36` | `POST /api/v1/debug/dream-all` 任意**登录**用户即可触发**全库**所有用户做梦作业（消耗服务端 LLM 配额）；且 debug 路由生产环境无条件挂载（main.py:371）。 |

### 2.5 敏感数据外发（见 P0，此处为 P1 级补充）

| # | 位置 | 问题 |
|---|---|---|
| P1-14 | `dreaming.py:73-79` | recall 无 `expires_at` 过滤：TTL 寄存（情绪/片段 7 天、片场即焚卡 1 小时）到期**前**会被召回进入外部 LLM。 |
| P1-15 | `handoff_letter.py:29-41, 73-78` | 交接信注释称「只取 surface 层」，实际 `list_by_kind(todo/summary)` **无 depth 过滤**；kind=小结 可含 vulnerable 深度（extractor 可标 vulnerable 小结），`surface_text or content` 拼进外部 LLM。 |
| P1-16 | `candidates.py:89-90` + `stage.py:66-75` | **confirm 的 explicit_consent 授权范围漂移**：用户确认片段时从未预览 deep_memories，但 `explicit_consent=True` 放行 supply 自动匹配的**全部**相关 vulnerable/core 记忆（entities 交集或角色名命中，未限量）进剧本生成 prompt。确认片段 ≠ 授权未展示的深层记忆。 |

### 2.6 前端认证与核心体验

| # | 位置 | 问题 |
|---|---|---|
| P1-17 | `src/api.ts:163-190` + `App.tsx:134` | **401 刷新失败后 UI 登录态不联动**：`clearTokens()` 只清内部 token，App 的 `tokens` state 无通知机制 → 界面停留「已登录」但所有请求持续 401，无「请重新登录」提示。 |
| P1-18 | `src/api.ts:148-161` | **refresh 网络错误被误判为 refresh 无效**：catch 把断网/后端不可达与 HTTP 401 一视同仁 → 用户弱网即被**强制登出**（token 清除，需重输密码）。 |
| P1-19 | `useRealtimeCall.ts:308-319` + `VoiceCall.tsx:150-155` | **语音通话断线错误被 onclose 覆盖成「通话结束」**（onerror 未置 closedRef），无重试按钮、connecting 无超时。核心交互页面最严重可用性缺陷。 |
| P1-20 | `screens/scene/ScenePlay.tsx:279-285, 246-249` | 加载失败/无 sceneId 时**永久显示「正在进入场景…」**（无错误渲染、无重试）；演绎中推进失败 error 只在 paused 面板渲染，playing 界面点了选项毫无反应。 |
| P1-21 | `screens/scene/SceneCreateFlow.tsx:238` | **空提交用占位示例文本当真实口述**：`onConfirm(text || placeholder)` 把「我想回到上周和朋友吵架之后…」当真，创建出用户从未说过的场景并触发文生图（最长 240s 超时）。 |
| P1-22 | `screens/companion/CompanionChat.tsx:74-100, 102-157` | **续聊历史加载竞态吞掉用户刚发的消息**：`setMessages(history)` 整体覆盖加载期间用户已发送的消息（后端已收到，前端消失）。 |
| P1-23 | `screens/Profile.tsx:401-409` | **「清空全部记忆」无二次确认**：右上角一键 `clearMemories()` 删除全部记忆，无 Alert、无 loading 防重，误触不可恢复。 |
| P1-24 | `screens/mailbox/MailboxScreen.tsx:67-77, 135-153` | **信箱四区无任何 loading/失败态**：失败静默（注释「网络异常保持当前」），空列表被误认为真实空数据——离线打开信箱看到「今天的信还在路上」等假空态。 |

---

## 3. P2 —— 重要缺陷（节选，完整清单见 §6）

### 后端
- **来信域**：ack 非幂等每次调 LLM（letters.py:104-129）；reply 先落库后 LLM 失败致 500+幽灵会话（letters.py:136-180）；accept-scene 并发双场景（letters.py:202-274）；keep 与 expire_ephemeral 竞态（ephemeral_store.py:53-70）；硬删后 letter/treasure 引用悬空（inbox.py:84-112 + letter.py:28-30）；`build_letters` 的「今天」用 UTC 0 点与东八区口径不一致（inbox.py:157）。
- **信号域**：天气按天去重键被低分占用致午后暴雨丢失（detectors.py:395 + fusion.py:99-101）；driving 低置信档（<60km/h）永不过 0.4 阈值（detectors.py:287-291）；深夜保护拦截用户自定义深夜定时窗口（fusion.py:357-363 与 scheduled 可突破安静时段自相矛盾）；三张审计/投递表（SignalEvent/DecisionLog/DeliveryEvent）**无任何清理**，DecisionLog.context 存完整上下文（fusion.py:394），DeliveryEvent 无过期状态（signals.py:252-269）；客户端未来时间戳样本永久驻留检测窗口（signals.py:60 + detectors.py:266-273）；冷却计数不区分 status 误拦后续（fusion.py:102-112）。
- **片场域**：候选确认并发重复建场景（candidates.py:54-58, 88-105, 118-146）；`related_memory_ids` 无归属校验可引用他人记忆 id（stage.py:104,115,127-129）；plays 入口缺 custom_text 支持（scenes.py:354-373）；流式建场景静默忽略 render_kind（scenes.py:284-308）；已结算场景仍可 PATCH/summary（theater_ext.py:111-126, scenes.py:494-508）；背景图重生成线程无合并竞态删图（scene_turn_images.py:51-56, 78-80）；settle 待办不设 due_date 当天即进「今日待启」（stage.py:110-116 + inbox.py:44-50）；detect-intent 每请求一次 LLM 无频控（scenes.py:210-230）。
- **新功能**：隐私词典仅 14 词（privacy_terms_zh.json），「自杀/抑郁」等高敏词漏判（content_signals.py:60-67）；ContentSignal 表无清理策略长期膨胀；用户纠正后画像永久 protected 无解除机制（profile_consolidation.py:70-75）。
- **记忆/提醒**：`build_today` 无日期过滤，「今日待启」含全部历史待办（inbox.py:44-50）；提醒服务「今天」按 UTC 计算偏移 8 小时（reminder.py:29-32, 96-98）。
- **契约**：SSE 错误路径把原始 JSON 当 message 显示（sse.ts:38-46）；错误体契约未兑现（api-design.md:19 约定 `{error:{code,message}}`，实际 FastAPI 默认 `{detail}`）。
- **测试**：`test_stage.py:71` 断言与实现漂移——stage.supply 默认 explicit_consent=False 时 vulnerable 被隐私闸门拦截（正确行为），测试仍期望返回 → **测试失败**；且 confirm 路径（explicit_consent=True）的宽匹配无测试覆盖（已亲验复现）。

### 前端
- 流式回复无超时：聊天/倾倒/片场/语音四处可能永久卡「处理中」且无取消（sse.ts:21-68 + 各调用方）。
- `sttOnce` 裸 fetch 无超时（api.ts:437-467）；WS 4401/断线无 token 刷新重连（useRealtimeCall.ts:258）；`onerror` 状态被 onclose 覆盖（useRealtimeCall.ts:308-319）；卸载清理不完整 recorder 未 stop（useVoiceInput.ts:101-104）。
- 信箱乐观更新失败全部静默不恢复（MailboxScreen.tsx:156-176）；无分页无下拉刷新；ack 失败也提示成功文案（104-116）；任务删除无二次确认（TasksTab.tsx:129-132）；多个按钮无 onPress 死按钮、「替我留着」不落库（Letters.tsx:103-109, Keepsakes.tsx:107-121）。
- 倾倒空提交可提交（Dump.tsx:177）；整理失败显示「已替你接住 0 个念头」无失败说明（Dump.tsx:278-322）；往日列表失败无重试（CompanionJournal.tsx:39-51）；记忆/画像加载失败被渲染成空态（Profile.tsx:377-389, UserProfile.tsx:28-35）；学习开关无 pending 锁（UserProfile.tsx:37-47）；Dump/角色设定页无 KeyboardAvoidingView 键盘遮挡。
- 响应式/合规：场景主页桌面缺响应式卡片网格（SceneScreen.tsx:228-249，规格 §5.4 硬性要求）；夜间对比度不足（darkColors.accent #D28E80 约 2.7:1、UpdateSheet changelog 约 2.5:1）；页面级硬编码日夜分支与旧色残留（Profile.tsx:94,115-117,139-140、TasksTab.tsx:63-68、Keepsakes.tsx:114/Letters.tsx:160-161 的 #6E5A28、SceneCreateFlow.tsx:206）；App 切换动画 90ms 不尊重 reducedMotion（App.tsx:224-227）、CharacterArtwork bounce 无 reduced motion（ScenePlay.tsx:85-96）；Card 按压 0.99 反馈无感（content.tsx:84）。

---

## 4. P3 —— 轻微/卫生（汇总）

- **认证**：access 7 天/refresh 30 天无轮换无吊销、logout 占位；注册/登录无限流（README 已知）；register 用户名查重非原子；token 无 iss/aud/jti。
- **安全面**：WS 鉴权 token 走 URL query（realtime.py:80、stt.py:67，可能入代理日志）；`/static/*` 音频/场景图为公开 URL 无鉴权（UUID 文件名，演示可接受）；`.env`/`morning.db`/static 均已 gitignore 且 prod 校验默认 JWT 密钥（main.py:27）✓。
- **迁移/数据**：alembic 文件名前缀重复（两个 008/两个 009，revision id 唯一、链完整）；`user_profile_enabled` 灰度开关未在 profile 路由层生效；ephemeral `to_dict` 时间无时区标记（前端显示偏差 8h）；「三日寄存」文档 72h vs 实际默认 7 天不一致；create_treasure 来源校验可绕过（treasures.py:68-81）；版本链旧版本残留（inbox.py:84-112）。
- **契约**：api-design.md 文档漂移（accessToken/petId/ack reply/expiresAt）；约 25 个后端接口前端未接入（signals deliveries 无人轮询致堆积、reminders、weather、pets/{id}、plays、role-profiles、memories 版本链等）。
- **前端**：并发 401 无 single-flight；DEV_BYPASS 假 token 401 死循环；notifications 轮询 401 静默；synthTts 15s 超时可能误报；SSE 尾部未 flush decoder/无 buf 上限/onEvent 异常不 cancel；TODAY_DATE 模块级固定（跨午夜错）；信封无 accessibilityRole、24×24 按钮低于触控标准；夜间硬编码浅色纸面（Letters/Keepsakes/SceneCreateFlow）；散乱按压 scale 0.94-0.99 不统一；多个页面裸字号/间距（10px 字号低于规格下限）；ContentSignal 表无清理。
- **信号**：motion 幂等非原子 IntegrityError 500；`_get_or_create_pref` 无锁；quiet_hours 脏数据静默 fallback；scheduled 跨午夜 ±6min 窗口不命中；`max_daily_triggers or 6` 无法用 0 禁用；runner 一轮循环只取一次 local 时间；节假日表仅 2026 年；驾驶检测「持续 ≥2min」含停车段；AI allow+silent 时审计口径不一致；/tick 无频控。

---

## 5. 动态验证结果

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit`（frontend-demo） | ✅ 无类型错误 |
| `git diff --check` | ✅ 干净 |
| `scripts/test_proactive.py`（信任门控） | ✅ ALL PASS |
| `scripts/test_content_signals.py`（内容信号 4 项） | ✅ ALL PASS |
| `scripts/test_profile_signal_sources.py`（画像 4 项） | ✅ ALL PASS |
| `scripts/test_profile_write_gate.py`（写入门控 3 项） | ✅ ALL PASS |
| `scripts/test_profile_consumption.py`（画像消费 4 项） | ✅ ALL PASS |
| `scripts/test_stage.py`（片场供给/结算） | ❌ **失败**：`supply` 的 deep_memories 断言与实际不符——测试过时（隐私闸门加入后未更新），见 P2-测试 |
| `scripts/test_phase6.py` / `test_signals.py` / `test_burn_raw.py` 等 | ⏭ 跳过：需本地 HTTP 服务（README 已注明「含 HTTP 段，需服务」），本轮未启动服务 |

---

## 6. 修复优先级建议

1. **P0 隐私红线（立即）**：`content_signals._memory_snapshot` 与 `dreaming.recall→descend` 补 `filter_for_cloud_prompt`；recall 加 `expires_at` 过滤；补回归测试。
2. **信箱体系（高）**：统一「每用户每天 N 封」单一入口或 `(user_id, date, type)` 唯一约束；晚间/睡前/早间幂等键解耦；周报时区转 UTC + 自然周窗口；`/mailbox/expire` 补鉴权。
3. **并发原子性（高）**：settlement/accept-scene/候选确认/process_pending 改条件更新（`UPDATE ... WHERE status='active'`）或加唯一约束；SSE 推进前复查 settled。
4. **前端认证（高）**：`tryRefresh` 区分网络错误与 401；全局 401 事件联动 App 登录态；WS 4401 刷新重连。
5. **信号校准（中）**：usage_anomaly 权重/阈值重算；安静时段改顺延或补发；实现 `FALLBACK_MESSAGES` 或让 scheduled/holiday 在 AI 失败时降级直发；审计表加清理任务。
6. **体验（中）**：语音通话断线错误保留 + 重试入口；ScenePlay 失败态与重试；空提交校验；清空记忆二次确认；信箱 loading/失败态；SSE 统一超时与取消。
7. **卫生（低）**：测试脚本同步（test_stage）；文档漂移修订；死代码清理（FALLBACK_MESSAGES）；灰度开关生效；迁移文件名规范化。

---

*报告生成方式：并行只读子代理调查（按业务域）+ 人工亲验全部 P0/P1 证据 + 动态验证。审查过程未修改任何代码文件。*
