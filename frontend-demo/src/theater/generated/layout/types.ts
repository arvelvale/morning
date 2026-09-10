/**
 * SemanticSceneSpec —— 关系式场景规格（P1）。
 *
 * LLM 只当导演：描述这一幕有什么、东西之间是什么关系，不写任何坐标。
 * 精确 XYZ 由 layout/solve.ts 解算后再交给 assemble.ts 拼装。
 * 与后端 scene_spec.py 的白名单保持一致（改动需两端同步）。
 */
import type { SceneEnv, SceneLighting, Vec3 } from "../spec";

/** 空间关系词表（P2 扩至 11 词；后端 scene_spec.py 白名单同步此清单）。 */
export type SemanticRelation =
  | "on"          // 在某零件上表面（宿主 id）
  | "in"          // 在容器内（宿主 id；inside 的兼容别名）
  | "inside"      // 同 in：容器内
  | "nextTo"      // 紧邻（宿主 id，旁边一个身位）
  | "near"        // 附近（比 nextTo 松散，约两个身位）
  | "inFrontOf"   // 宿主前方
  | "behind"      // 宿主后方
  | "sitOn"       // 人物就坐（宿主须有座位锚点）
  | "facing"      // 人物朝向："toward:<id>" | "camera" | "away"
  | "heldBy"      // 零件被某人物拿在手上（吸附到手部锚点）
  | "at";         // 区位提示 { zone, side, bias? }

export type ZoneBand = "foreground" | "midground" | "background";
export type ZoneSide = "left" | "center" | "right";

/** 区位：z 向三段环带 × x 向左中右。bias 为区内偏移米数 [dx, dz]。 */
export interface SemanticAt {
  zone: ZoneBand;
  side: ZoneSide;
  bias?: [number, number];
}

/** 零件实例：type 命中 props 目录；关系字段与 at 二选一或组合；不写 pos。 */
export interface SemanticPropInstance {
  /** 全局唯一 id；被其他实例的关系引用。缺省由 solve 按 index 补 `prop{i}`。 */
  id?: string;
  type: string;
  params?: Record<string, unknown>;
  on?: string;
  in?: string;
  inside?: string;
  nextTo?: string;
  near?: string;
  inFrontOf?: string;
  behind?: string;
  heldBy?: string;    // 人物 id：放到 TA 手上
  /** 可选显式朝向（弧度）；多数情况由 solve 推导。 */
  rotY?: number;
  /** ⚠️ 已废弃（P2）：视觉大小由 propMeta.visualScale 与几何实测接管，LLM 不再猜。 */
  scale?: number;
  at?: SemanticAt;
}

/**
 * 人物实例。外观字段与绝对版 CharacterInstance 一致；
 * 位置只写 sitOn / nextTo / near / inFrontOf / behind / at / facing 这些关系词。
 */
export interface SemanticCharacterInstance {
  id?: string;
  pose?:
    | "standing" | "sitting" | "phone"
    | "walking" | "waving" | "lookingBack" | "headDown"
    | "handsFolded"
    | "arguing" | "comforting" | "hugging" | "handingItem"
    | "crying" | "sittingGround";
  sitOn?: string;             // 就坐的零件 id
  nextTo?: string;            // 站在谁身旁（人物或零件 id）
  near?: string;              // 在谁附近（更松散的两个身位）
  inFrontOf?: string;         // 站在谁前面
  behind?: string;
  facing?: string;            // "toward:<id>" | "camera" | "away" 或直接对象 id
  at?: SemanticAt;
  /** ⚠️ 已废弃（P2）：身高由 type 预设决定，LLM 不再给 scale。 */
  scale?: number;
  type?: "child" | "student" | "adult" | "elderly";
  build?: "slim" | "average" | "stout";
  outfit?: "casual" | "uniform" | "coat" | "skirt";
  hairstyle?: "short" | "long" | "ponytail" | "bun";
  backpack?: boolean;
  bodyColor?: string;
  skinColor?: string;
  hairColor?: string;
}

/** 关系式规格：kind 标记用于新旧格式检测。除 env 外均可缺省。 */
export interface SemanticSceneSpec {
  kind: "semantic";
  env: SceneEnv;
  /** 可选情绪基调（如 "rainy_night"）；缺省由 env+props 自动推断。 */
  mood?: string;
  props?: SemanticPropInstance[];
  characters?: SemanticCharacterInstance[];
  lighting?: SceneLighting;
}

/** Layout report —— solve 过程记录，dev 预览屏展示。 */
export interface LayoutReport {
  issues?: LayoutIssue[];
  fixes: string[];    // validator 自动修复动作
  warnings: string[]; // 值得人工看一眼的问题（如比例异常、降级）
}

export interface LayoutIssue {
  code: string; objectIds: string[]; severity: 'warning' | 'error';
  status: 'repaired' | 'unresolved' | 'degraded'; expected?: string; actual?: string;
}

/**
 * 解算过程中的节点状态（solve 内部填充，validator 只读）。
 * 类型与 propMeta/validator 共享，避免循环依赖。
 */
export interface LayoutNode {
  kind: "prop" | "char";
  id: string;
  sem: SemanticPropInstance | SemanticCharacterInstance;
  carrier?: { rel: "on" | "in" | "sitOn"; hostId: string };
  dirRef?: { rel: "nextTo" | "inFrontOf" | "behind" | "near" | "heldBy"; hostId: string };
  at?: SemanticAt;
  explicitRotY?: number;
  scale: number;
  pose?: string;
  x: number; y: number; z: number; rotY: number;
  /** props 实测包围盒（chars 无）。 */
  box?: { hw: number; hd: number; h: number; top: number; cx?: number; cz?: number; minY?: number; surface?: { cx: number; cz: number; hw: number; hd: number; ellipse?: boolean } } | undefined;
  supportY: number;
  onSupport: boolean;
  degraded?: string;
  seatFace?: number;
  seatIndex?: number;
  figureAnchors?: { contactY: number; hand: [number, number, number]; handQuaternion: [number, number, number, number]; box?: LayoutNode['box'] };
  /**
   * 画面骨架件（road/water/train 等超大 backdrop）：位置由 placementRules 权威指定，
   * 不参与区位撒布、越界钳制与碰撞推挤。at.bias 作为相对该锚点的偏移仍然生效。
   */
  backdrop?: { x: number; y: number; z: number; rotY?: number };
}
