# 2026-09-10 开发日志

## 前端可点性与 AI 味图标整改

### 产品语义

用户反馈登录页：左上角 Sparkles 图标很有 AI 味；主按钮「进来坐坐」默认看起来像不能点。根因不是业务 disabled，而是设计系统主按钮默认用了半透明 `accentSurface` 浅金底 + 浅色 `textOnAccent`，对比度过低。本次从 design-system 层修掉，并顺手清掉几处 emoji 当图标的地方。

### 技术实现

- `design-system/components/controls.tsx`：`Button` primary 默认底色 `accentSurface` → 实心 `accent`（hover 仍 `accentHover`，pressed 仍 `accentPressed`）。全站 primary 按钮一并生效。
- `Auth.tsx`：品牌位 `Sparkles` → 应用 `assets/icon.png`；桌面权益列表第二项 `Sparkles` → `BookOpen`。
- `UpdateSheet.tsx`：主 CTA 同样改实心 accent；标题徽标去掉 `✨`，改用 icon.png。
- `Onboarding.tsx`：权限三卡 emoji（🧠🔐🔕）→ lucide（HeartHandshake/Lock/BellOff）；选中勾选底色改实心 accent。
- `ModeSheet.tsx`：四种陪伴模式 emoji → lucide（Cloud/Waves/Mountain/Clapperboard）。
- `Letters.tsx`：音乐附件 `🎵` → 已有 lucide `Music`。

### 验证

- `npm run typecheck` 退出 0。
- 提交 `d7d495a`（分支 `polish/frontend-ui-pass`，已 fast-forward 到 main）。

### 如实说明

- 未做真机/浏览器截图验收；建议 `npm run web` 过一遍 Auth、引导、更新抽屉、模式选择。
- 未改业务逻辑与文案语义；未动鸿蒙端。
