# Morning 根 README 设计规格

## 目标

为仓库新增一个适合 GitHub 首页的根目录 `README.md`，兼顾产品介绍与开发者上手。
README 采用中英双语，公开范围安全，不包含密钥、内部提示词、个人路径或敏感实现细节。

## 受众与定位

- 主要受众：希望了解 Morning 产品的人，以及第一次拉取仓库的开发者。
- 当前状态：开发中的原型。功能链路基本完整，但仍在持续打磨和验证。
- 文案基调：温暖、清晰、可信，不使用治疗、诊断或夸大能力的表达。

## 顶部展示

- 使用仓库现有的 `logo.jpg`，不替换 Logo 文件。
- Logo 居中展示，不添加产品截图。
- 标题使用 `喵灵`（Morning 为仓库/项目代号，2026-07-25 定名）。
- 中文介绍：
  “一个以桌宠为入口，帮你倾倒思绪、整理生活、安心练习重要表达的陪伴 Agent。”
- 英文介绍：
  “A companion agent that helps you unload thoughts, organize daily life, and safely rehearse meaningful conversations.”
- 展示四个简洁徽章：Prototype、Expo、React Native、FastAPI。
- 提供中文与 English 的页内跳转。
- 不添加 Mermaid 架构图。

## 内容结构

README 先提供中文完整版，再提供信息完整对应的英文版。

两种语言均包含：

1. 项目简介。
2. 核心理念与产品边界。
3. 四个主要模块：陪伴、信箱、片场、我的。
4. 核心体验路径。
5. 技术架构与技术栈表格。
6. 仓库目录说明。
7. 快速开始。
8. 环境变量与隐私说明。
9. 当前状态与已知限制。
10. 子项目文档链接。

## 快速开始

提供两条并列路径。

### 只查看前端界面

- 进入 `frontend-demo/`。
- 安装依赖并运行 Expo Web。
- 说明可通过 `?screen=companion` 等合法页面参数直达代表页面。
- 明确直达参数是开发与验收入口，不代表生产路由。

### 前后端完整体验

- 要求 Python 3.11+、`uv`、Node.js 和 npm。
- 复制 `backend/.env.example` 为 `backend/.env`，只列出变量名称和用途，不展示真实值。
- 使用 `uv sync` 安装后端依赖。
- 使用 `uv run uvicorn app.main:app --reload` 启动后端。
- 安装并启动 `frontend-demo/`。
- 说明 Web 默认连接 `http://localhost:8000`。
- 说明 Android/iOS 真机需要把 `frontend-demo/src/api.ts` 中的 `LAN_HOST`
  改为运行后端电脑的局域网 IPv4 地址。

## 公开与隐私边界

- 可以公开技术栈、目录、启动命令、主要模块和隐私原则。
- 不公开真实 API key、JWT 密钥、内部提示词、用户数据、数据库内容或开发者个人路径。
- 明确产品不提供心理诊断，不把推测包装成事实。
- 说明本地记忆、原始倾诉焚除和临时内容到期删除等原则，但不展开内部敏感策略。
- 不添加 License 章节，因为仓库当前没有许可证文件。

## 子项目文档

- 保留并链接 `backend/README.md`。
- 保留并链接 `theater/README.md`。
- 删除已经过时的 `frontend-demo/README.md`。
- 前端运行、结构、响应式设计和真机连接说明统一写入根目录 README。

## 验证与交付

- 检查 README 中的全部相对链接和 Logo 路径。
- 对照实际 `package.json`、`pyproject.toml` 和 `.env.example` 检查命令与版本要求。
- 运行 `frontend-demo` 的 `npm run typecheck`。
- 运行 `git diff --check`。
- 扫描 README，确保没有密钥、个人绝对路径或未完成占位符。
- 先向用户展示最终 README，用户明确确认后再提交并推送 GitHub。
