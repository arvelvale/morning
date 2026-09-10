# Morning 前端视觉基线验收

## 用途

本文用于前端视觉重构期间的重复验收。阶段 0 只记录现有表现：已有的视觉缺陷不阻塞阶段 0，新增运行错误、空白页面、不可操作或主题失效会阻塞后续阶段。

## 启动与静态检查

在 `frontend-demo/` 执行：

```powershell
npm run typecheck
npm run web
```

Expo Web 默认地址通常为 `http://localhost:8081`。如果终端给出其他端口，以终端地址为准。

## 页面直达

Web 验收可以使用 `?screen=<screen-id>` 绕过登录并直达合法页面。非法或空页面 ID 不得启用绕过。

| 页面 | 参数 |
|---|---|
| 登录 / 注册 | `?screen=auth` |
| 引导欢迎 | `?screen=onboard-1` |
| 引导说明 | `?screen=onboard-2` |
| 选择伙伴 | `?screen=onboard-3` |
| 权限说明 | `?screen=onboard-4` |
| 陪伴首页 | `?screen=companion` |
| 聊天 | `?screen=chat` |
| 语音通话 | `?screen=voice-call` |
| 睡前倾倒 | `?screen=sleep-dump` |
| 处理中 | `?screen=processing` |
| 回执 | `?screen=receipt` |
| 信箱 | `?screen=mailbox` |
| 任务详情 | `?screen=task-detail` |
| 收纳详情 | `?screen=storage-detail` |
| 场景主页 | `?screen=scene` |
| 场景播放 | `?screen=scene-play` |
| 场景结束 | `?screen=scene-end` |
| 个人资料 | `?screen=profile` |
| 更换伙伴 | `?screen=pet-change` |
| 伙伴交接 | `?screen=pet-handoff` |
| 记忆列表 | `?screen=memory-list` |
| 记忆回顾 | `?screen=memory-review` |
| 设计系统预览（开发） | `?screen=design-system` |

非法参数回归：

```text
?screen=not-a-screen
?screen=
```

两者都应回到正常认证入口，不能显示空白页或绕过登录。

## 已知非阻塞警告

阶段 0 运行时存在以下 Web 平台警告，当前不阻塞视觉重构：

- `expo-notifications` 提示 Web 尚未完整支持 push token change listener。
- React Native Web 提示 `useNativeDriver` 不可用并回退到 JavaScript 动画。

后续任务如果没有增加这些警告的出现范围或引发运行错误，不将它们判定为新回归。任何新的 error 级控制台信息仍然属于阻塞问题。

## 目标视口

### 手机精细检查

- 375px
- 390px
- 430px

### 平板兼容检查

- 768px
- 1024px

### Web 精细检查

- 1280px
- 1440px
- 1920px

阶段 0 的代表视口：

- 手机：390 × 844
- 桌面：1440 × 1000

## 阶段 0 代表页面

至少检查：

1. `companion`
2. `chat`
3. `mailbox`
4. `scene`
5. `profile`

每个页面检查：

- 页面可以渲染，没有全屏空白。
- 控制台没有本阶段新增的错误。
- 日间内容可见。
- 存在主题切换入口的页面仍能切换夜间模式。
- 主要按钮可以点击。
- 没有本阶段新增的横向溢出或内容遮挡。

## 截图命名

```text
<screen>-mobile-390-light.png
<screen>-desktop-1440-light.png
<screen>-mobile-390-dark.png
<screen>-desktop-1440-dark.png
```

夜间截图只在页面具备切换入口或当前任务明确要求时生成。

## 每个页面组的交付记录

每次迁移记录：

- 修改前截图。
- 修改后截图。
- 检查过的视口。
- TypeScript 结果。
- 控制台结果。
- 核心交互结果。
- 日间视觉结果。
- 夜间基本可用性结果。
- 合理保留的页面专用颜色或布局例外。
