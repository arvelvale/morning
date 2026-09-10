# Morning 前端视觉重构阶段 0 实施计划

## 实施目标

在不改变任何页面视觉、业务功能、接口、文案和导航流程的前提下，建立后续视觉重构所需的可靠基线：

1. 锁定当前 TypeScript 零错误状态。
2. 建立唯一的新主题 API。
3. 将现有 `theme.ts` 降级为迁移期兼容入口，确保旧页面无需同时改造。
4. 让 Web 页面直达参数具备运行时校验。
5. 建立可重复执行的手机与桌面基线验收清单。

本阶段不应用新配色、不迁移页面样式、不新增响应式布局。

## 当前事实

- 正式前端位于 `frontend-demo/`。
- 当前执行 `npx tsc --noEmit` 已零错误。
- 正式前端目前只使用 `src/theme.ts`；此前实验性的 `design-tokens.ts`、`design-hooks.ts` 和 `design-components.tsx` 不在正式前端目录中。
- `App.tsx` 已支持 Web 使用 `?screen=<screen-id>` 直达页面，但当前直接把任意字符串断言为 `Screen`，缺少运行时校验。
- 当前没有统一的 `typecheck` npm script，也没有正式的跨尺寸页面基线清单。

## 实施边界

- 只修改 `frontend-demo/` 和本实施计划相关文档。
- 不修改后端、数据库、剧场数据和素材。
- 不改变当前日间或夜间的任何颜色值。
- 不批量修改现有页面的主题导入。
- 不从仓库外 `design-system/` 目录复制实验代码。
- 不新增第三方依赖。

## 任务 1：锁定静态检查命令

### 修改文件

- `frontend-demo/package.json`

### 变更

新增：

```json
"typecheck": "tsc --noEmit"
```

保留现有 `start`、`web`、`android` 和 `ios` scripts。

### 验证

在 `frontend-demo/` 执行：

```powershell
npm run typecheck
```

预期退出码为 0。

## 任务 2：建立唯一主题实现入口

### 新增文件

- `frontend-demo/src/design-system/theme.ts`
- `frontend-demo/src/design-system/index.ts`

### `design-system/theme.ts`

职责：

- 持有 `NightCtx`。
- 导出迁移期仍需要的 `useNight()`。
- 保存当前 `NK`、`DAY` 和旧颜色常量的精确值，保证页面视觉不变。
- 保留 `palette(night)` 供旧页面使用。
- 新增稳定的 `useTheme()`，作为新代码的唯一主题 Hook。

`useTheme()` 返回稳定语义：

```ts
type ThemeMode = "light" | "dark";

type Theme = {
  mode: ThemeMode;
  isNight: boolean;
  colors: {
    background: string;
    surface: string;
    border: string;
    divider: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    placeholder: string;
    accent: string;
  };
};
```

本阶段这些语义字段只映射到当前颜色，不使用新设计方案的颜色；新视觉 token 在阶段 1 调整。

### `design-system/index.ts`

只暴露后续新代码允许使用的公共入口：

```ts
export {
  NightCtx,
  useTheme,
  type Theme,
  type ThemeMode,
} from "./theme";
```

不从此入口导出 `palette`、`NK`、`DAY`、`CREAM` 等旧 API，避免新代码继续依赖旧语义。

### 验证

- 新入口可以通过 TypeScript 编译。
- `useTheme()` 只在 React 组件或自定义 Hook 中使用。
- 本阶段不要求旧页面迁移到 `useTheme()`。

## 任务 3：将旧 `theme.ts` 改为兼容层

### 修改文件

- `frontend-demo/src/theme.ts`

### 变更

删除重复实现，改为从 `./design-system/theme` 重新导出：

- `NightCtx`
- `useNight`
- `NK`
- `DAY`
- `palette`
- `CREAM`
- `CREAM_SOFT`
- `PEACH_SOFT`
- `SAGE_SOFT`
- `GOLD_DEEP`

文件顶部明确标注：

- 这是迁移期兼容入口。
- 新代码必须从 `src/design-system` 使用 `useTheme()`。
- 旧导出在所有页面迁移完成前不得删除。

### 原因

这样只有一份主题实现，同时不要求当前所有页面在一个任务中重写导入，避免视觉和业务回归。

### 验证

- 当前所有旧导入继续编译。
- `App.tsx` 中的 `NightCtx.Provider` 行为不变。
- 日间和夜间页面颜色在本阶段不发生变化。

## 任务 4：校验 Web 页面直达参数

### 修改文件

- `frontend-demo/App.tsx`

### 变更

1. 使用只读 `SCREEN_IDS` 常量维护全部合法页面 ID。
2. 从该常量派生 `Screen` 类型，避免类型列表和运行时列表分离。
3. 新增 `isScreen(value)` 类型守卫。
4. 只有合法的 `?screen=` 值才启用 DEV bypass 并直达页面。
5. 非法或空值回退到默认 `onboard-1`，且不绕过登录。
6. 不改变合法页面的现有直达行为。

### 验证

- `?screen=companion` 等合法值仍可直达。
- `?screen=not-a-screen` 不渲染空白页面，也不启用开发登录绕过。
- 原生端不访问 `window`。

## 任务 5：建立视觉基线验收清单

### 新增文件

- `frontend-demo/docs/frontend-visual-baseline.md`

### 内容

记录：

- 启动命令与 `typecheck` 命令。
- 全部合法页面直达 URL。
- 手机检查宽度：375、390、430px。
- Web 检查宽度：1280、1440、1920px。
- 阶段 0 的代表页面：
  - `companion`
  - `chat`
  - `mailbox`
  - `scene`
  - `profile`
- 每个代表页面检查：
  - 页面可渲染。
  - 控制台无新增错误。
  - 日间可见。
  - 夜间入口仍能切换。
  - 主要按钮可点击。
  - 无横向溢出或全屏空白。
- 截图命名规范：
  - `<screen>-mobile-390-light.png`
  - `<screen>-desktop-1440-light.png`
  - 夜间基线按需增加 `-dark`。

阶段 0 只记录现状，不把已有视觉缺陷当作本阶段失败；运行错误、空白页和不可操作属于失败。

## 任务 6：静态与运行验证

### 静态检查

在 `frontend-demo/` 执行：

```powershell
npm run typecheck
git diff --check
```

### Web 验证

运行：

```powershell
npm run web
```

至少检查：

1. `?screen=companion`
2. `?screen=mailbox`
3. `?screen=scene`
4. `?screen=profile`
5. `?screen=not-a-screen`

代表尺寸：

- 手机：390 × 844
- 桌面：1440 × 1000

### 回归重点

- 合法直达页继续使用开发数据进入。
- 非法直达参数不会绕过登录。
- 日间/夜间切换仍由同一个 Context 驱动。
- 本阶段前后代表页面主色、背景和控件外观不变。

## 提交顺序

1. `docs: add frontend redesign phase 0 plan`
2. `refactor: establish frontend theme migration baseline`

提交前：

- 运行 `npm run typecheck`。
- 运行 `git diff --check`。
- 只暂存本阶段文件，不带入无关改动。

## 完成定义

- `npm run typecheck` 退出码为 0。
- 正式前端只有一份主题实现。
- 新代码有唯一的 `src/design-system` 公共主题入口。
- 旧页面通过兼容层继续工作。
- 合法与非法 `?screen=` 参数行为明确且已验证。
- 视觉基线文档覆盖目标尺寸和代表页面。
- Web 代表页面无新增运行错误或空白。
- 没有引入新视觉、业务逻辑或第三方依赖。
