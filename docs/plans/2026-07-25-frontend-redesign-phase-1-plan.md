# Morning 前端视觉重构阶段 1 实施计划

## 实施目标

建立后续所有新组件和页面迁移共同使用的设计基础：

1. 定义正式的日间语义色板。
2. 为保留的夜间模式提供基本语义映射。
3. 定义排版、间距、圆角、阴影、层级和动效 token。
4. 升级 `useTheme()`，让新代码只依赖稳定语义。
5. 定义统一响应式断点、视口分类和导航位置规则。
6. 保持所有尚未迁移的旧页面视觉不变。

本阶段只建立基础能力，不实现 `AppShell`、导航或页面组件；这些属于阶段 2。

## 当前基线

- `npm run typecheck` 已通过。
- `src/design-system/theme.ts` 是唯一主题实现。
- `src/theme.ts` 是旧页面兼容入口。
- 旧页面继续使用 `palette()` 和旧常量。
- 新代码应从 `src/design-system` 导入 `useTheme()`。
- 阶段 0 的手机、桌面、非法直达和夜间切换运行基线已通过。

## 实施边界

- 只修改 `frontend-demo/src/design-system/` 和必要的阶段文档。
- 不批量迁移任何现有页面。
- 不改变旧 `palette()`、`NK`、`DAY` 和旧颜色常量的返回值。
- 不修改导航、页面结构、业务逻辑、接口、文案或素材。
- 不引入第三方依赖或外部字体。
- 不把仓库外实验设计系统代码复制进正式前端。

## 任务 1：建立基础 token

### 新增文件

- `frontend-demo/src/design-system/tokens.ts`

### 颜色

定义 `lightColors`，使用已批准的日间方向：

| 语义 | 值 |
|---|---:|
| `background` | `#F7F2E8` |
| `backgroundSubtle` | `#EFE7DA` |
| `surface` | `#FFFCF6` |
| `surfaceElevated` | `#FFFFFF` |
| `textPrimary` | `#403A35` |
| `textSecondary` | `#756C63` |
| `textMuted` | `#9D9389` |
| `textOnAccent` | `#FFF9F5` |
| `border` | `#E4DACE` |
| `divider` | `#E4DACE` |
| `accent` | `#B9654A` |
| `accentSoft` | `#F3DED3` |
| `support` | `#718879` |
| `focus` | `#9B4E38` |

补充交互和状态语义：

- `surfaceHover`
- `surfacePressed`
- `accentHover`
- `accentPressed`
- `disabledSurface`
- `disabledText`
- `success`
- `warning`
- `error`
- `overlay`
- `scrim`

定义 `darkColors`，目标是基本可读和可操作，而不是完整重设计。优先沿用当前夜间背景与文字关系，并为所有日间语义提供对应字段。

### 排版

使用系统默认无衬线字体，不设置项目级特色 `fontFamily`。

定义：

- `fontSizes`
- `fontWeights`
- `lineHeights`
- `letterSpacings`
- `textStyles`

`textStyles` 覆盖：

- `display`
- `pageTitle`
- `sectionTitle`
- `body`
- `bodyStrong`
- `caption`
- `label`

所有行高使用明确像素值，避免 React Native 与 Web 对比例行高解释不同。

### 间距与尺寸

定义：

```ts
spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
}
```

补充：

- `controlHeights`
- `iconSizes`
- `touchTarget`

触摸目标最小值为 44px。

### 圆角、阴影和层级

定义：

- `radii.control`
- `radii.card`
- `radii.dialog`
- `radii.pill`
- `shadows.none`
- `shadows.soft`
- `shadows.floating`
- `zIndices`

普通卡片默认使用 `shadows.none`；明显阴影只供浮层和确有悬浮语义的组件使用。

### 动效

定义：

- `motion.durations.press`
- `motion.durations.state`
- `motion.durations.enter`
- `motion.durations.exit`
- `motion.durations.ambient`
- `motion.distances.subtle`
- `motion.distances.standard`
- `motion.curves`

时长范围遵循已批准方案：

- 按钮反馈：120–180ms。
- 状态切换：180–240ms。
- 页面与浮层：240–320ms。

## 任务 2：升级主题语义

### 修改文件

- `frontend-demo/src/design-system/theme.ts`

### 变更

1. 从 `tokens.ts` 导入 `lightColors`、`darkColors` 和共享基础 token。
2. 将 `Theme["colors"]` 改为完整语义色板类型。
3. `useTheme()` 根据 `NightCtx` 返回 `lightTheme` 或 `darkTheme`。
4. `Theme` 同时提供：
   - `colors`
   - `typography`
   - `spacing`
   - `radii`
   - `shadows`
   - `motion`
   - `zIndices`
5. 主题对象在模块级创建并冻结引用；Hook 只选择对象，不在每次渲染重建 token。
6. 完整保留 `NK`、`DAY`、`palette()` 和旧常量的值与导出。

### 原因

新组件获得正式设计语言，旧页面仍通过兼容 API 保持当前视觉。这样可以逐页迁移，避免阶段 1 造成全站突然换色。

## 任务 3：建立响应式工具

### 新增文件

- `frontend-demo/src/design-system/responsive.ts`

### 断点

采用三类布局：

```ts
compact: width < 768
medium: 768 <= width < 1024
expanded: width >= 1024
```

规则：

- `compact` 使用底部导航。
- `medium` 默认使用底部导航；具体页面只在后续有充分理由时分栏。
- `expanded` 使用左侧导航。

### 导出

- `breakpoints`
- `viewportTargets`
- `classifyViewport(width)`
- `getNavigationPlacement(width)`
- `useResponsive()`
- `ViewportClass`
- `NavigationPlacement`

`useResponsive()` 返回：

- `width`
- `height`
- `viewportClass`
- `isCompact`
- `isMedium`
- `isExpanded`
- `navigationPlacement`
- `isLandscape`

本阶段不返回页面 padding 或字体缩放，避免每个屏幕按比例放大内容。页面宽度和留白将在 `AppShell` 与 `PageContainer` 中定义。

## 任务 4：支持减少动态效果

### 新增文件

- `frontend-demo/src/design-system/accessibility.ts`

### 导出

- `useReducedMotion()`

行为：

1. 首次读取 `AccessibilityInfo.isReduceMotionEnabled()`。
2. 监听 `reduceMotionChanged`。
3. 组件卸载时移除监听。
4. 异步读取失败时安全回退为 `false`。

本阶段只建立 Hook，不批量替换旧动画。

## 任务 5：收紧公共导出

### 修改文件

- `frontend-demo/src/design-system/index.ts`

### 导出

- `useTheme`
- `NightCtx`
- `Theme`
- `ThemeMode`
- `lightColors`
- `darkColors`
- 共享基础 token
- 响应式工具与类型
- `useReducedMotion`

### 不导出

- `NK`
- `DAY`
- `palette`
- `CREAM`
- 其他旧常量

旧 API 只能从迁移期 `src/theme.ts` 访问。

## 任务 6：静态验证

在 `frontend-demo/` 执行：

```powershell
npm run typecheck
git diff --check
```

检查：

- 所有 token 都是只读常量。
- 日间和夜间颜色对象拥有完全相同的键。
- `Theme` 不依赖旧 `palette()` 的字段命名。
- 旧页面导入不变且继续编译。
- 响应式分类在 767、768、1023、1024 边界无空档和重叠。

## 任务 7：运行回归

启动：

```powershell
npx expo start --offline
```

代表页面：

- `?screen=companion`
- `?screen=mailbox`
- `?screen=scene`
- `?screen=profile`

代表尺寸：

- 390 × 844
- 桌面可用宽度约 1280px

检查：

- 页面仍可渲染。
- 阶段 1 没有新增 error 级控制台信息。
- 旧页面颜色、布局和导航没有因新 token 自动变化。
- 夜间切换仍然有效。
- 陪伴页素材仍能正常显示。

## 提交顺序

1. `docs: add frontend redesign phase 1 plan`
2. `feat: add frontend design foundations`

提交前只暂存本阶段文件，并执行：

```powershell
npm run typecheck
git diff --check
```

## 完成定义

- 正式日间语义色板与基础夜间色板已定义。
- 排版、间距、尺寸、圆角、阴影、层级和动效 token 已定义。
- `useTheme()` 返回完整稳定的新设计语义。
- 旧页面继续通过兼容层保持现有视觉。
- 响应式断点与导航位置只有一个定义来源。
- 减少动态效果 Hook 可供后续组件使用。
- TypeScript 零错误。
- 代表页面无新增运行错误。
- 未修改业务功能、页面结构或素材。
