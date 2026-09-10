---
tags: [Morning, 场景系统, 生成式3D, spec]
created: 2026-08-27
status: draft
---

# Spec：场景生成重构 —— 关系式布局（SemanticSpec → Layout Engine → Validator）

> 2026-09-06 实现复核：关系式链路已接入，但 sitOn、宿主排序和 heldBy 已复现功能缺陷。下文 P1/P2「已实现」指当时代码落地，不代表几何或真机验收完成。后续修复与验收见[执行计划](../plans/2026-09-06-generated-3d-reliability.md)。当前入库存储语义规格，解算在前端内存执行；下文背景与旧阶段描述按其历史日期理解。

## 0. 一句话

### 2026-09-07 当前运行契约（覆盖下文历史阶段描述）

- 位置依赖含承载与 heldBy，宿主先落位；固定 ID 下使用稳定座位分配，超员改为站在旁边并报告。宿主碰撞、边界处理后重放硬约束。
- 内部解算输出：PropInstance 可选 `id/heldBy/supportId`，CharacterInstance 可选 `id/seatContactEnabled`；不属于模型需要生成的新字段，不修改后端白名单/存量数据库。旧绝对规格未启用语义坐姿几何修正。
- `figure/anchors.ts` 从与渲染相同的姿态网格测量接触高度和手部矩阵。语义就坐使用水平腿段与膝部折叠裙装，呼吸保留接触平面。`grips.ts` 标定手机、雨伞、书、茶杯、背包、行李箱、相框握点；无专用握点或右手已占用则明确降级。持物保持资产缩放，雨伞/杯/包保持直立，其余随手旋转；承载子件随父件一起动。
- LayoutReport 的可选 `issues` 含 `code/objectIds/severity/status/expected?/actual?`，兼容 `fixes/warnings`；统一记录原始关系未应用、布局/构造失败、残余碰撞、接触/范围/容器高度、软关系与朝向残差。重复问题按代码、对象与状态去重，避免逐帧无限追加。装配报告与解算报告共享。
- 坐姿接触容差 0.05m×人物比例，承载水平范围容差 0.02m，软关系理想点残差 0.6m，朝向容差 15°；阈值是检查语义，不是缩小物件或放宽实际穿模的指令。椭圆桌面额外检查椭圆范围。
- 碰撞包含独立 X/Z 范围、旋转中心与 Y 范围，以承载子树平移并最终重放；最后校验只读。无法消解的保守 AABB 重叠保留 unresolved，不能标为已修复。相机只在最终解算后预检人物包围盒（默认 aspect=0.5、FOV=50°、NDC±0.8），真实视口构图留 S4。
- S2 的数值、真实几何射线与多时刻骨架验收见[执行计划](../plans/2026-09-06-generated-3d-reliability.md)；尚无真机/跨视口视觉完成声明。历史描述中的“渲染层零改动”不再适用于此阶段。

LLM 只当「导演」：输出**这一幕有什么、东西之间什么关系**；代码当「舞美」：
由 Layout Engine 解算出精确 XYZ，再由 Validator 纯代码校验修复。**产物仍是现行 SceneSpec，
Three.js 渲染层零改动。**

## 1. 背景与问题

现状链路：`backend/app/services/scene/scene_spec.py` 单次 LLM 调用直接产出含绝对坐标的
SceneSpec → 存 `scenes.scene_spec` → 前端 `frontend-demo/src/theater/generated/assemble.ts`
按坐标原样拼装，零件构造器注册于同目录 `props.ts`。

两个已确认的缺陷：

1. **上下文随零件库线性膨胀**：prompt 必须携带零件白名单 + 大量「怎么搭」的文字规则
   （road 搭路、busStop 等车、oldHouse 配黄昏……），且零件需前后端两处手工同步；
   零件越多规则越长。一旦未来改成 agent 工具调用形态还会被反复携带。
2. **绝对坐标无依据**：LLM 不知道零件尺寸与锚点（默认尺寸从茶杯 0.08m 到 road 长 40m、
   water 60×60），只能瞎猜坐标；组合语义（杯子在桌上、车在路上）全靠文字经验暗示。
   `_sanitize` 只做范围钳制，无重叠/悬空/构图校验——错了也不报错，静默产出坏场景。

## 2. 目标与非目标

**目标**

- 同一份场景 seed 的产出构图质量显著提升（贴合、朝向、不穿模、主角入画）；
- prompt 与零件库解耦：加零件不再需要改 prompt 规则段落；
- LLM 输出非法内容时静默降级可用（沿用现有 sanitize 哲学）；
- 渲染确定性：同一 spec 多次渲染结果一致。

**非目标（本期不做）**

- 不改 `assemble.ts` / `figure/` 渲染实现；
- 不引入 agent 多轮循环（生成仍是单次调用 + 纯代码后处理）；
- 不做通用约束求解器、不做物理仿真；
- 不动 Prefab/Zone 分层模板库（见 §10 P2 触发条件）。

## 3. 架构总图

```
用户剧情 seed (title/place/people/plot/intent)
   ↓  LLM 场景导演（单次调用；prompt 只含关系词表 + few-shot，不含几何知识）
SemanticSceneSpec（JSON：env + props[] + characters[]，只写关系不写坐标）
   ↓  入库 scenes.scene_spec（语义版）
   ↓  前端 Layout Engine（TS，纯代码）          ← 开发期决策修订（2026-08-27）：解算在前端执行
      ① 锚点吸附 → ② 关系排布 → ③ 自由件撒布 + 重叠消解 + 边界钳制
   ↓  Validator（纯代码；失败本地修复，绝不回炉 LLM）
最终 SceneSpec（绝对坐标，内存中）
   ↓  assembleScene() 渲染（入口改为「检测新旧格式」的包装函数，内部零改动）
```

**关键决策修订（2026-08-27，评审后定案）**：Layout Engine 放在**前端 TS** 执行，
`scenes.scene_spec` 直接存语义版。理由：
1. 零件几何只存在于前端 TS 构造器里——BBox 实测（Box3.setFromObject）必须发生在
   几何所在的一侧；若放后端则需「node 脚本量尺寸→提交 JSON→后端读」的跨语言产物链，
   每次 props.ts 微调都要记得重新生成，漂移了还静默错位。
2. 免除整套布局数学的 Python 复刻，P1 代码量与后续维护面减半。
3. 渲染确定性不受影响：解算种子 = hash(spec 内容)，同一份入库数据每次解算结果一致。

兼容策略：渲染入口改为包装函数——检测到带 `pos` 的旧格式直接走原 assembleScene；
检测到关系字段的新格式先解算再拼装。存量数据与新数据在同一列共存，零迁移。

## 4. SemanticSceneSpec Schema 与关系词表

```jsonc
{
  "env": { "mode": "outdoor", "time": "dusk", "stars": true }        // 与现 env 相同，透传
  "props": [
    {
      "id": "bench1",                 // 全局唯一；引用用
      "type": "bench",
      "params": { "color": "#6b4a30" },          // 外观参数，与现 params 一致
      "on": "ground",                 // 承载：另一 prop 的 id 或 ground
      "at": { "zone": "midground", "side": "left", "bias": [0.5, -0.3] },
                                      // 粗粒度区位 + 区内偏移（米），可选
      "rotYHint": "facingRoad"        // 可选；多数情况由 layout 推导
    }
  ],
  "characters": [
    { "id": "girl", "pose": "sitting", "sitOn": "bench1", "facing": "toward:boy",
      "type": "student", "outfit": "uniform", "backpack": true }
  ]
}
```

**关系词表白名单（锁定，8 个，多余丢弃并告警）：**

| 词 | 语义 | 解算 |
|---|---|---|
| `on` | 在某件上表面 | 锚点吸附 |
| `in` | 在容器内 | 锚点吸附（取容器内点） |
| `sitOn` | 人物就坐 | 座位锚点 + 自动朝向 |
| `nextTo` | 紧邻（宿主 BBox 半径外推一个身位） | 关系排布 |
| `inFrontOf` | 宿主前方 | 关系排布 |
| `behind` | 宿主后方 | 关系排布 |
| `facing` | 朝向某对象 / toward:camera/left/right | 旋转推导 |
| `at.zone/side` | 前景 midground background × left center right 区位 | 区域撒布 |

- 无任何关系的自由件：进入区域撒布，位置由 **spec 内容哈希为种子的伪随机数**决定
  （保证同一 spec 渲染一致），再用重叠检测推挤到合法位置。
- 引用解析按拓扑排序执行（被依赖者先落位）；**成环或悬空引用 → 该关系降级为自由件**
  （保留 at.zone 提示），不报错。

## 5. 组件 Metadata（轻量，能自动就不手标）

原则：**几何尺寸不手标**。解算时对每个零件实例现场构造代理体并
`Box3().setFromObject(obj)` 实测包围盒（几何与测量同在前端 TS 侧，天然零漂移）——
零维护成本、永不与实现脱节。（现构造器已普遍遵守「原点贴地」约定，BBox 即天然覆盖面。）

人工标注仅限**语义锚点**，集中在 `generated/layout/propMeta.ts` 一张表：

```ts
anchors?: {
  top?: number;          // 上表面承载高度（默认取 BBox 顶）
  seat?: Vec3;           // 就坐点（含座面高度）；可多座位 seats?: Vec3[]
  inner?: Vec3;          // 容器内部点（in 用）
  interact?: Vec3;       // 手部交互参考点（递物等，P2 启用）
}
```

P1 只标注高频承载件约 8 个：`table / bench / chair / platform / crate / rug /
busStop / schoolGate`，其余一律走 BBox 默认值。标注集中在 props.ts 注册项旁，
新增零件时顺手可补。

## 6. Layout Engine 三段流水线

1. **锚点吸附**：有 `on/in/sitOn` 且宿主合法 → 直接放在宿主锚点（含宿主变换），
   一次吸收 80% 高频场景（杯在桌上、人在椅上）；
2. **关系排布**：`nextTo/inFrontOf/behind` 按宿主 BBox 半径 + 关系偏移量计算，
   已被占用的目标点沿环向找下一个空位（记录占用集合防叠罗汉）；
3. **自由件撒布**：按 zone（前景 y∈[2,5]、中景 [-2,2]、背景 <-2 米的 z 向环带，
   x 左中右三段）以哈希种子均匀撒布 → 两两 AABB 重叠则沿最小穿透轴迭代推开
   （上限 10 轮）→ 整体钳回 ±COORD_LIMIT。

人物特殊逻辑：`sitOn` 后自动面向 seat 前方除非显式 `facing`；站立人物相邻两人
若为对话型姿态（arguing/comforting/hugging/handingItem）自动相向。多人协同姿态
（如 handingItem 对位递接点）精确编排放 P2，P1 先做相向。

## 7. Validator（纯代码，失败本地修复）

| 检查 | 判定 | 动作 |
|---|---|---|
| 穿模 | 两件 AABB 相交体积比 > 15% | 沿最小穿透轴推开（与 §6.③ 共用代码） |
| 悬空 | 底部离地（或承载面）> 0.15m 且无 on 关系 | 贴地重投 |
| 越界 | \|x\|,\|z\| > COORD_LIMIT | 钳回最近合法点 |
| 出画 | 主角（首个人物）投影 NDC 超出 ±0.8 | 微调 camera.lookAt/pos 直至框住（复用 assemble.ts 默认机位逻辑） |
| 比例异常 | 相邻件实测高差比超阈值（如茶杯旁立 40m 路） | P1 仅记日志观察 |

Validator 通过后才输出最终 SceneSpec。所有修复记入 debug 日志便于观测质量。

## 8. Prompt 改造

`SPEC_SYSTEM_PROMPT` 大幅瘦身：

- **删除**全部「怎么搭环境」文字规则（街道怎么搭、乡村配什么——这些知识进 Zone 默认/
  few-shot 样例，进代码 single source of truth）；
- 输出 schema 替换为 §4 关系版；词表 + 零件名单保留；
- 附 **1~2 个 few-shot**：从 `samples.ts` 六份手写 spec 中选代表改写为关系版
  （这些样例是人工调过构图的，正是模型最缺的构图先验）；
- 零件名单按 seed 场景类型裁剪下发（每类挂 tag，如乡村场景只发自然+乡村件；
  裁剪映射放后端代码一处维护）。P1 只需把 tag 表建起来。

`_sanitize` 改为校验 SemanticSceneSpec：id 冲突 / 未知 type / 未知 relation /
悬空引用的处理策略见 §4；env 透传逻辑不变。

## 9. 测试与验收

- **回归夹具**：六份 samples.ts 手写 spec 改写为关系版 JSON 固定下来（`layout/fixtures.ts`），
  兼作 few-shot 素材源与 Layout Engine 回归输入；
- **后端脚本测试**：沿用仓库惯例 `uv run python scripts/test_scene_semantic.py`
  （免启动服务，`PYTHONPATH=.`、`PYTHONUTF8=1`），覆盖语义 schema 清洗
  （id 冲突/环引用/未知词/悬空引用降级）；
- **前端**：`npm run typecheck`；纯函数解算逻辑经 typecheck + 夹具目检，
  视觉效果走 dev 预览屏人工验收；
- **dev 预览屏**：扩展现有 `screens/Scene3DPreview.tsx`——支持关系版夹具切换 +
  粘贴任意 SemanticSpec，渲染最终结果并显示 validator 报告；
- **验收清单**（每条真实渲染比对）：
  1. 杯子落在桌面正中，无悬浮穿插；
  2. 两人对坐长椅，座面贴合、姿态朝向正确；
  3. 「雨夜公交站告别」产出构图不差于现行手工 SceneSpec；
  4. 同一 spec 连续渲染两次位置一致；
  5. 故意喂未知零件/环引用 → 降级渲染仍可看。

## 10. 分期

**P1（已实现，2026-08-27）**：Schema+词表、锚点标注、Layout Engine 三段、Validator 五项、
prompt 瘦身 + few-shot、samples 回归夹具、dev 预览屏。详见 §4-§9。

**P2（同日启动，四刀已完成前三刀代码，待视觉验收）**：

| 刀 | 内容 | 状态 |
|---|---|---|
| 1 | 大件 backdrop 特批道：PROP_META.placementRules（road/crosswalk/water/cityscape/platform/train 权威锚点定位），豁免撒布/钳制/碰撞；at.bias 作相对偏移仍生效 | ✅ 代码完成 |
| 2 | scale 去猜测化：后端 sanitize 剥离 LLM 的 props/characters scale，前端以 metadata.visualScale（当前全 1，留槽位）统一接管 | ✅ 代码完成 |
| 3 | fitCameraToScene：主角+可聚焦件包围球 → d=r/tan(halfFovEff) 反解距离，look=主角向质心插值；validator 出画修复优先于自适应取景 | ✅ 代码完成 |
| 4 | 词表扩充 inside(=in 别名)/near/heldBy + propMeta.CHARACTER_META 手部持物锚点；BE 测试增 3 例 | ✅ 代码完成 |

验证口径：BE scripts/test_scene_semantic.py 13 项 PASS；FE typecheck/git diff --check 净；
六夹具与真实 LLM 输出的渲染肉眼验收仍待浏览器跑一轮。

**存量兼容决定**：旧绝对坐标 scene_spec 数据不迁移不重建（用户拍板），原样直执行，
其中的历史摆放问题只在场景被重新生成时自然消失。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 锚点数值要肉眼调 | dev 预览页快速迭代；首批只标 8 件 |
| 伪随机不确定性导致刷新跳变 | 种子 = hash(spec)，入库的是解算后的绝对坐标 spec，实际一锤定音 |
| LLM 输出脏 id / 幻觉 relation | 白名单外丢弃 + 降级为自由件，沿用静默兜底哲学 |
| 关系过度约束（一杯同时 on A 又 nextTo B） | 优先级：承载 > 位邻 > 区位；冲突时后者降级 |
| 存量数据兼容 | API 签名不变、产物格式不变；migration 无需改动 |

## 相关文件

- 正本仓库路径：`docs/superpowers/specs/2026-08-27-scene-relational-layout.md`
- 待改核心：`backend/app/services/scene/scene_spec.py`、
  `frontend-demo/src/theater/generated/props.ts`、`generated/assemble.ts`、
  新增 `frontend-demo/src/theater/generated/layout/`（layout engine + validator）
