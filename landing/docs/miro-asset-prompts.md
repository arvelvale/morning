# 官网米露素材 · 已停用

2026-09-25 起，官网与 App 的米露/波比都改为程序化骨骼动画（`frontend-demo/src/pets/rig/pet-rig.js`，
官网加载同步过来的 `public/pet-rig.js`），不再使用生成图，本文档里的生图提示词不再适用。

- 改角色：只改 `frontend-demo/src/pets/rig/pet-rig.js`，然后在 frontend-demo 下 `npm run rig:build`。
- 静态图（头像、兜底）：`public/assets/pets/{miro,bobi}-{idle,sleep}.png`，由运行时渲染导出，与 App 的 `frontend-demo/assets/pets/rig/` 同源。
- 状态演示：`design-demos/pet-motion/pet.html`；短片：`design-demos/pet-motion/index.html`。

说明见 `docs/progress/2026-09-25.md`。
