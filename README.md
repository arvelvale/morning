<div align="center">
  <img src="./logo.jpg" alt="喵灵 Logo" width="168" />

  # Morning/喵灵

  **一个以桌宠为入口，帮你倾倒思绪、整理生活、安心练习重要表达的陪伴 Agent。**

  **A companion agent that helps you unload thoughts, organize daily life, and safely rehearse meaningful conversations.**

  [![Status: Prototype](https://img.shields.io/badge/status-prototype-F0D477?style=flat-square&labelColor=403A35)](#项目状态)
  [![Expo](https://img.shields.io/badge/Expo-53-000020?style=flat-square&logo=expo&logoColor=white)](https://expo.dev/)
  [![React Native](https://img.shields.io/badge/React%20Native-0.79-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactnative.dev/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

  [中文](#中文) · [English](#english)
</div>

---

## 中文

### 项目简介

喵灵 是一个以桌宠为入口的情感陪伴 Agent。它帮助用户一次说出混杂的计划、担忧、灵感与感受，将内容整理到合适的位置，并把值得重新面对的经历转化为可安全练习的互动场景。

喵灵 不催促用户完成任务，不制造情感绑架，也不提供心理诊断。它更像一位安静的伙伴：先接住，再整理，把决定权留给用户。

> 当前项目处于开发中的原型阶段。核心产品链路已经可以运行，界面、模型效果、移动端体验和工程化能力仍在持续完善。

### 核心理念

- **陪伴**：桌宠通过行为、对话和低频邀请回应用户，但不催促、不评判。
- **清空**：用户可以在睡前一次说完，Agent 负责自动整理，不要求逐条确认。
- **接住**：计划、灵感、感受和片段各归其位，让用户放心暂时放下。
- **体验**：通过互动剧情尝试不同表达和选择，而不是篡改或重构真实记忆。
- **边界**：不输出心理诊断，不把推测包装成事实，敏感信息遵循本地优先和用户可控原则。

### 核心模块

| 模块 | 说明 |
| --- | --- |
| 陪伴 | 桌宠首页、日常对话、实时语音、睡前倾倒与快捷陪伴模式 |
| 信箱 | 来信与思绪两层（游戏邮箱式），「我留下的」安静入口 |
| 片场 | 场景候选、人物设定、互动演练、自由回应、校准与结算 |
| 我的 | 伙伴切换、交接信、记忆管理、隐私审阅和体验偏好 |

### 核心体验路径

1. **日常陪伴**：打开应用 → 看桌宠正在做什么 → 文字或语音聊天 → 获得简短回应。
2. **睡前清空**：一次说完混杂思绪 → Agent 自动分类 → 收到整理回执 → 安心离开。
3. **次日接回**：打开信箱 → 读来信、看思绪 → 完成、珍藏或放下。
4. **场景演练**：确认候选片段或主动创建 → 补充人物与情境 → 尝试不同表达 → 保存结算卡或清除场景。
5. **更换伙伴**：选择新桌宠 → 阅读粗粒度交接信 → 无需重新解释近况 → 继续陪伴。

### 技术栈

| 层级 | 技术 |
| --- | --- |
| 跨端前端 | Expo、React Native、React Native Web、TypeScript |
| 前端设计系统 | 语义化主题 Token、响应式布局、公共组件、Reduced Motion |
| 后端 | FastAPI、SQLAlchemy、Pydantic Settings、JWT |
| Agent 编排 | LangGraph、OpenAI-compatible AI gateway |
| 数据存储 | SQLite（开发环境）、Alembic（生产迁移） |
| 流式交互 | SSE、WebSocket、实时语音与语音转写 |
| 场景渲染 | Three.js、React Three Fiber、程序化低多边形场景 |

### 仓库结构

```text
morning/
├─ backend/          # FastAPI 后端、AI 网关、业务 API 与本地记忆系统
├─ frontend-demo/    # Expo / React Native 主前端，Web 与移动端共用代码
├─ morning-proto/    # 早期 Web 交互原型
├─ design-system/    # 设计探索与辅助资料
├─ docs/             # 产品、设计、API、规格与实施文档
├─ scripts/          # 仓库级辅助脚本
├─ AGENTS.md         # 仓库协作与前端设计约束
└─ logo.jpg          # 项目 Logo
```

### 快速开始

#### 路径一：只查看前端界面

适合快速查看响应式界面，不要求先配置 AI 服务。

```bash
cd frontend-demo
npm install
npm run web
```

Expo 启动后，可以在浏览器访问：

```text
http://localhost:8081/?screen=companion
```

常用开发直达页面：

```text
?screen=companion
?screen=mailbox
?screen=scene
?screen=profile
?screen=design-system
```

`?screen=<id>` 是 Web 开发与验收入口，不是生产环境路由。未启动后端时，依赖真实数据的功能可能显示空状态或网络提示。

#### 路径二：前后端完整体验

准备环境：

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- Node.js 与 npm
- 可用的 AI Provider API key

启动后端：

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

打开 `backend/.env`，至少配置：

| 变量 | 用途 |
| --- | --- |
| `STEPFUN_API_KEY` | 文本、语音与实时能力的服务端凭据 |
| `JWT_SECRET` | 账号令牌签名密钥；生产环境必须替换为随机长字符串 |
| `CORS_ORIGINS` | 允许访问后端的前端来源 |

模型名称、语音和服务地址可以继续使用 `.env.example` 中的默认项，或按部署环境覆盖。

后端默认运行在：

```text
http://127.0.0.1:8000
```

另开一个终端启动前端：

```bash
cd frontend-demo
npm install
npm run web
```

Web 端默认连接 `http://localhost:8000`。Android/iOS 真机调试时，请把 [`frontend-demo/src/api.ts`](frontend-demo/src/api.ts) 中的 `LAN_HOST` 修改为运行后端电脑的局域网 IPv4 地址，并确保设备与电脑处于同一网络。

其他前端命令：

```bash
npm start          # Expo Go
npm run android    # Android 设备或模拟器
npm run typecheck  # TypeScript 静态检查
```

### 隐私与产品边界

- API key 只保留在后端，前端不直接持有第三方模型凭据。
- 用户可查看和删除记忆；需要长期保留的内容由用户主动决定。
- 临时寄存内容到期后删除，不保留具体人物、地点、原话与事件。
- 用户关闭原始倾诉保留时，提取成功后会清除原始引用，只留下整理后的表层文本。
- 敏感记忆默认本地优先；外发前必须经过隐私策略判断。
- 产品不提供心理诊断、治疗结论或人格定性，也不把模型推测当作事实。

### 项目状态

Morning 当前是一个**开发中的原型**：

- 已完成账号、对话、睡前倾倒、信箱、记忆、伙伴切换和片场等主要链路。
- 已建立 Web 与移动端共用的响应式设计系统。
- 日间界面已完成主要视觉重构；夜间模式当前以可读和可操作为目标。
- Web 端适合功能开发与快速验收，移动端仍需持续进行真机兼容性与性能测试。
- 当前未提供生产部署、应用商店发布或多环境配置的完整方案。

### 相关文档

- [后端说明与 API 验证](backend/README.md)
- [项目功能说明](Morning项目功能文档-精简版.md)
- [前端视觉重构规格](docs/superpowers/specs/2026-07-25-morning-frontend-visual-redesign.md)

---

## English

### Overview

Morning is a companion agent built around a virtual pet. It gives users a place to unload mixed thoughts—plans, worries, ideas, and emotions—organizes them into appropriate destinations, and turns experiences worth revisiting into interactive scenes for safe rehearsal.

Morning does not pressure users into completing tasks, create emotional dependency, or provide psychological diagnoses. It behaves more like a quiet companion: receive first, organize second, and leave the final decision to the user.

> Morning is currently a prototype under active development. Its core product flows are operational, while the interface, model behavior, mobile experience, and production readiness continue to evolve.

### Principles

- **Companionship**: The virtual pet responds through behavior, conversation, and low-frequency invitations without pressure or judgment.
- **Unload**: Users can say everything at once before sleep; the agent organizes it without requiring item-by-item confirmation.
- **Hold**: Plans, ideas, emotions, and moments are placed where they belong so users can safely set them aside.
- **Rehearse**: Interactive scenes help users try different expressions and choices without claiming to rewrite real memories.
- **Boundaries**: The product avoids diagnosis, never presents speculation as fact, and keeps sensitive information local-first and user-controlled.

### Core Modules

| Module | Description |
| --- | --- |
| Companion | Virtual-pet home, everyday chat, realtime voice, bedtime unloading, and quick companion modes |
| Mailbox | A two-layer game-style mailbox (letters + thoughts), with a quiet "kept by me" entry |
| Scene | Scene candidates, character setup, interactive rehearsal, free-form responses, calibration, and settlement |
| Profile | Companion switching, handoff letters, memory management, privacy review, and experience preferences |

### Core Experience Flows

1. **Everyday companionship**: Open the app → see what the pet is doing → talk by text or voice → receive a concise response.
2. **Bedtime unloading**: Share mixed thoughts at once → let the agent organize them → receive a short receipt → leave with less mental load.
3. **Next-day return**: Open the mailbox → read letters and review thoughts → complete, keep, or release them.
4. **Scene rehearsal**: Confirm a candidate or create a scene → add people and context → try different expressions → keep the settlement card or clear the scene.
5. **Companion switching**: Choose a new pet → read a coarse-grained handoff letter → continue without explaining everything again.

### Technology

| Layer | Technology |
| --- | --- |
| Cross-platform frontend | Expo, React Native, React Native Web, TypeScript |
| Frontend design system | Semantic theme tokens, responsive layouts, shared components, reduced-motion support |
| Backend | FastAPI, SQLAlchemy, Pydantic Settings, JWT |
| Agent orchestration | LangGraph, OpenAI-compatible AI gateway |
| Data | SQLite for development, Alembic for production migrations |
| Streaming | SSE, WebSocket, realtime voice, and speech transcription |
| Scene rendering | Three.js, React Three Fiber, and procedural low-poly environments |

### Repository Layout

```text
morning/
├─ backend/          # FastAPI backend, AI gateway, business APIs, and local memory
├─ frontend-demo/    # Main Expo / React Native app shared by Web and mobile
├─ morning-proto/    # Early Web interaction prototype
├─ design-system/    # Design explorations and supporting material
├─ docs/             # Product, design, API, specification, and implementation docs
├─ scripts/          # Repository-level helper scripts
├─ AGENTS.md         # Collaboration and frontend design rules
└─ logo.jpg          # Project Logo
```

### Quick Start

#### Option 1: Preview the UI Only

Use this path to inspect the responsive interface without configuring the AI service first.

```bash
cd frontend-demo
npm install
npm run web
```

Once Expo starts, open:

```text
http://localhost:8081/?screen=companion
```

Useful direct-preview screens:

```text
?screen=companion
?screen=mailbox
?screen=scene
?screen=profile
?screen=design-system
```

`?screen=<id>` is a Web development and acceptance-testing hook, not a production router. Screens that rely on real data may show empty states or network notices when the backend is not running.

#### Option 2: Run the Full Stack

Prerequisites:

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- Node.js and npm
- An AI Provider API key

Start the backend:

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure at least the following values in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `STEPFUN_API_KEY` | Server-side credential for text, speech, and realtime capabilities |
| `JWT_SECRET` | Signing secret for account tokens; replace it with a long random value in production |
| `CORS_ORIGINS` | Frontend origins allowed to access the backend |

Model names, voice settings, and service URLs can use the defaults in `.env.example` or be overridden for the target environment.

The backend runs at:

```text
http://127.0.0.1:8000
```

Start the frontend in another terminal:

```bash
cd frontend-demo
npm install
npm run web
```

The Web app connects to `http://localhost:8000` by default. For Android/iOS device testing, update `LAN_HOST` in [`frontend-demo/src/api.ts`](frontend-demo/src/api.ts) to the LAN IPv4 address of the computer running the backend, and keep both devices on the same network.

Additional frontend commands:

```bash
npm start          # Expo Go
npm run android    # Android device or emulator
npm run typecheck  # TypeScript static check
```

### Privacy and Product Boundaries

- API keys stay on the backend; the frontend does not hold third-party model credentials.
- Users can review and delete memories, and they decide what should be kept long term.
- Temporary stored items are deleted after expiry without retaining specific people, places, quotes, or events.
- When raw-dump retention is disabled, raw references are removed after successful extraction and only organized surface text remains.
- Sensitive memories are local-first and must pass privacy policy checks before any external transfer.
- Morning does not provide psychological diagnoses, treatment conclusions, or personality labels, and it never presents model speculation as fact.

### Project Status

Morning is a **prototype under active development**:

- Core flows for accounts, chat, bedtime unloading, mailbox, memory, companion switching, and scenes are implemented.
- A responsive design system supports both Web and mobile from one codebase.
- The daytime interface has completed its primary visual redesign; the current night mode focuses on readability and operability.
- The Web build is suitable for feature development and rapid acceptance testing; mobile still requires continued device compatibility and performance testing.
- Production deployment, app-store release, and complete multi-environment configuration are not yet documented.

### Documentation

- [Backend guide and API verification](backend/README.md)
- [Product feature overview (Chinese)](Morning项目功能文档-精简版.md)
- [Frontend visual redesign specification (Chinese)](docs/superpowers/specs/2026-07-25-morning-frontend-visual-redesign.md)
