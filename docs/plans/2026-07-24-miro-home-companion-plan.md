# 米露陪伴首页实施计划

## 实施目标

在不改变其他页面和其他桌宠表现的前提下，让 `preset_id === "miro"` 的当前桌宠在陪伴首页立即显示透明静态图，并在动画资源就绪后每隔 5–12 秒播放一次舔爪动画。减少动态效果、资源错误或非米露场景均使用安全降级。

## 实施边界

- 只修改 React Native / Expo 前端。
- 不修改后端接口和数据库。
- 不修改聊天页、选宠页、个人页中的 emoji/占位图。
- 不直接打包原始 HEVC 视频。
- 不新增第三方运行时依赖。

## 任务 1：制作并校验动画素材

### 输入

- 动作参考：`C:\Users\32275\Desktop\adventureX\微信视频2026-07-24_184511_871.mp4`
- 静态母图：`frontend-demo/assets/pets/miro/miro-groom.png`

### 输出

- 静态待机图：`frontend-demo/assets/pets/miro/miro-idle.png`
- 动画帧目录：`frontend-demo/assets/pets/miro/groom/`
- 帧命名：`frame-00.png` 至最终帧，连续且补零。

### 处理步骤

1. 从 3 秒视频按 12 fps 抽取约 36 帧。
2. 以画布边缘的黑色作为背景种子做连通区域抠图，避免简单黑色键控误删米露身体内部的深色毛发。
3. 对 Alpha 边缘做 1 px 收缩与轻量羽化，清除黑边。
4. 将所有帧统一到同一正方形画布、缩放比例和底部锚点，确保动画不跳动。
5. 按首页实际显示尺寸导出合理分辨率，保留 2x 像素密度；不把 1254 px 母图原尺寸复制到每一帧。
6. 使用第一帧或最自然的静止帧生成 `miro-idle.png`。
7. 在浅色和深色检查底上合成预览，检查黑边、裁切、透明孔洞和位置漂移。

### 验证

- 所有帧尺寸和像素格式一致，均为 RGBA PNG。
- 四角 Alpha 为 0。
- 米露主体包围盒在各帧之间没有无意抖动。
- 浅色背景上无黑色矩形底，深色背景上轮廓仍可辨识。

## 任务 2：建立前端桌宠素材注册表

### 新增文件

- `frontend-demo/src/pets/assets.ts`

### 内容

- 导出米露静态图 `MIRO_IDLE_SOURCE`。
- 使用静态 `require(...)` 明确列出舔爪帧，导出 `MIRO_GROOM_FRAMES`。
- 导出按 `presetId` 查询素材的最小注册表。
- 只注册 `miro`，未知 ID 返回 `undefined`。

### 原因

Metro 需要可静态分析的资源路径，不能依赖运行时字符串拼接。注册表把资源声明从 UI 组件中分离，后续增加动作时不会继续扩大首页组件。

## 任务 3：保留 `preset_id` 到首页

### 修改文件

- `frontend-demo/App.tsx`

### 变更

1. 将 `PetInfo` 增加 `presetId: string | null`。
2. `petFromPreset` 使用预设的 `id` 填入 `presetId`。
3. `petFromOwned` 使用后端返回的 `preset_id` 填入 `presetId`。
4. 默认米露数据设置 `presetId: "miro"`。
5. 只向 `CompanionIdle` 新增传递 `petPresetId={pet.presetId}`。
6. 不改变其他页面的 props，避免扩大本次影响面。

### 验证

- 登录后后端返回的米露实例仍能通过 `preset_id` 找到素材。
- DEV bypass 默认米露可以直接预览。
- 自定义或未知桌宠不会因为名称相同而误用米露素材。

## 任务 4：实现首页桌宠组件

### 新增文件

- `frontend-demo/src/components/HomePetArtwork.tsx`

### Props

```ts
type HomePetArtworkProps = {
  presetId: string | null;
  fallbackEmoji: string;
  size?: number;
};
```

### 行为

1. 非 `miro` 或注册表无素材时渲染现有 `PetPlaceholder`。
2. 米露首次渲染立即显示 `miro-idle.png`。
3. 监听 `AccessibilityInfo.isReduceMotionEnabled()` 及其变化事件。
4. 允许动画时，在 5–12 秒随机延迟后进入 `grooming`。
5. 以约 12 fps 顺序显示舔爪帧，播放一次后恢复静态图。
6. 下一轮重新计算随机等待时间。
7. 监听 `AppState`；非 `active` 状态停止帧推进和下一轮计时。
8. 组件卸载时清除所有 timeout，避免离开首页后继续运行。
9. 任一动画帧加载失败后标记本次会话为降级，只显示静态图。
10. 静态图加载失败时渲染 `PetPlaceholder`。

### 布局

- 保持当前桌宠区域占位尺寸，避免首页其他元素跳动。
- 使用 `resizeMode="contain"`。
- 米露图片不放进现有白色圆形占位球，但保留轻微暖色光晕以兼容日间和夜间主题。
- `pointerEvents="none"`，点击行为继续由外层 `Pressable` 负责。

## 任务 5：接入陪伴首页

### 修改文件

- `frontend-demo/src/screens/Companion.tsx`

### 变更

1. 导入 `HomePetArtwork`。
2. 给 `CompanionIdle` 增加 `petPresetId` prop。
3. 将首页唯一一处 `<PetPlaceholder size={215} ... />` 替换成：

```tsx
<HomePetArtwork
  presetId={petPresetId}
  fallbackEmoji={petEmoji}
  size={215}
/>
```

4. 不修改聊天页中的 `PetPlaceholder`、`AgentBubble` 或 emoji。
5. 不修改点击桌宠进入语音通话的现有行为。

## 任务 6：验证与回归

### 静态检查

在 `frontend-demo/` 执行：

```powershell
npx tsc --noEmit
```

### Web 验收

运行：

```powershell
npm run web -- --non-interactive
```

打开 `?screen=companion`，检查：

1. 首屏立即显示米露静态图。
2. 5–12 秒内播放一次舔爪动作。
3. 动画结束后回到静态图。
4. 连续观察两轮，动作不连续循环。
5. 切换日间/夜间主题，边缘均无明显黑底或绿边。
6. 离开首页再返回，不从中间帧继续。

### 降级验收

- 临时传入 `presetId="bobi"`：显示原占位图。
- 启用系统减少动态效果：米露保持静态。
- 临时破坏一帧引用进行开发验证：组件回退静态图；验证后恢复引用。
- 快速切换页面多次：无计时器警告或卸载后状态更新警告。

### Android 实机

1. 执行 `npm run android`。
2. 检查首屏速度、动画流畅度与页面切换。
3. App 切后台 15 秒再返回，确认后台未播放且返回后从静态状态重新计时。
4. 连续运行 5 分钟，确认没有明显内存增长。

## 提交顺序

1. `feat: add Miro companion artwork assets`
2. `feat: animate Miro on companion home`
3. 如验证产生独立修复，再提交 `fix: stabilize Miro home animation`

每次提交前运行 `git diff --check`，只暂存本任务文件，不包含用户或队友的无关改动。

## 完成定义

- 设计文档中的 8 条验收标准全部满足。
- TypeScript 静态检查通过。
- Web 与 Android 至少各完成一次人工验收。
- 米露素材、注册表、首页组件和调用方均已提交。
- 工作区没有本任务产生的临时检查图或色键中间文件。
