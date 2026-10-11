/**
 * 单房间骨架（纯几何，不依赖 three）。
 *
 * 「先定房间、再往里放家具」：LLM 只给房间的大小和门窗，墙/地/洞口的尺寸与位置由这里算，
 * 构造器（props/furniture/room.ts）、求解器（solve.ts）、校验器（validator.ts）三处读同一份结果，
 * 所以"门在哪、窗在哪、屋里能放到哪"不会各算各的。
 *
 * 坐标：房间中心在原点，地面 y=0，x∈[-W/2,W/2]、z∈[-D/2,D/2]。
 * 镜头在 (+x,+z) 一侧往里看，因此只画 **后墙(back, z=-D/2)** 和 **左墙(left, x=-W/2)**，
 * 右墙/前墙不画（剖开的玩偶屋），但家具仍被限制在四面墙以内。
 *
 * 洞口位置 offset ∈ [-1,1]：站在镜头一侧看这面墙，-1 是最左端、+1 是最右端、0 居中。
 *   后墙：offset 向右 = +x；左墙：offset 向右 = -z（朝后墙方向）。
 */

export type RoomWall = "back" | "left";
export type RoomOpeningKind = "window" | "door";

/** 语义规格里的房间（LLM 可写的全部字段）。 */
export interface SemanticRoom {
  width?: number;    // x 方向，米
  depth?: number;    // z 方向，米
  height?: number;   // 墙高，米
  wallColor?: string;
  floorColor?: string;
  openings?: SemanticOpening[];
}

export interface SemanticOpening {
  kind: RoomOpeningKind;
  /** 画出来的两面墙之一；right/front 会被就近改到 back/left（见 normalizeRoom 的说明）。 */
  wall?: RoomWall | "right" | "front";
  offset?: number;
  width?: number;
  /** 仅窗：窗台高、窗高。 */
  sill?: number;
  height?: number;
}

export interface Opening {
  kind: RoomOpeningKind;
  wall: RoomWall;
  /** 沿墙中心位置（米，墙局部坐标 u，向右为正）。 */
  u: number;
  width: number;
  sill: number;    // 门 = 0
  height: number;  // 洞口净高
}

export interface RoomSpec {
  width: number;
  depth: number;
  height: number;
  wallColor: string;
  floorColor: string;
  openings: Opening[];
}

export const WALL_T = 0.12;           // 墙厚（内表面落在房间边界上，墙体向外长）
export const ROOM_LIMITS = { width: [3, 9], depth: [3, 8], height: [2.4, 3.4] } as const;
export const ROOM_DEFAULT = { width: 5.2, depth: 4.6, height: 2.8, wallColor: "#e2d4bc", floorColor: "#b8996e" } as const;
const MARGIN = 0.18;                  // 洞口离墙端/洞口之间的最小净距

const num = (v: unknown, lo: number, hi: number, fb: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
const hex = (v: unknown, fb: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb);

export interface RoomNote { code: string; objectIds: string[]; status: "repaired" | "degraded"; text: string }

/** 墙的可用长度。 */
export const wallLength = (r: Pick<RoomSpec, "width" | "depth">, wall: RoomWall) => (wall === "back" ? r.width : r.depth);

/**
 * 把 LLM 给的房间收成可建造的 RoomSpec，并如实记录改动。
 * - 尺寸钳在 ROOM_LIMITS；颜色只收 #RRGGBB。
 * - 洞口 wall=right/front：这两面不画，改到 back/left 并记 repaired（不悄悄丢，也不假装画出来了）。
 * - 洞口放不进墙（太宽、与别的洞口重叠、超出墙端）：丢弃并记 degraded，交给校验报告让模型改。
 */
export function normalizeRoom(raw: SemanticRoom): { room: RoomSpec; notes: RoomNote[] } {
  const notes: RoomNote[] = [];
  const room: RoomSpec = {
    width: num(raw.width, ROOM_LIMITS.width[0], ROOM_LIMITS.width[1], ROOM_DEFAULT.width),
    depth: num(raw.depth, ROOM_LIMITS.depth[0], ROOM_LIMITS.depth[1], ROOM_DEFAULT.depth),
    height: num(raw.height, ROOM_LIMITS.height[0], ROOM_LIMITS.height[1], ROOM_DEFAULT.height),
    wallColor: hex(raw.wallColor, ROOM_DEFAULT.wallColor),
    floorColor: hex(raw.floorColor, ROOM_DEFAULT.floorColor),
    openings: [],
  };
  const list = Array.isArray(raw.openings) ? raw.openings.slice(0, 6) : [];
  list.forEach((o, i) => {
    const name = `${o?.kind ?? "opening"}#${i + 1}`;
    if (!o || (o.kind !== "window" && o.kind !== "door")) {
      notes.push({ code: "ROOM_OPENING_DROPPED", objectIds: [name], status: "degraded", text: "洞口类型只能是 window / door" });
      return;
    }
    let wall: RoomWall;
    if (o.wall === "left" || o.wall === "back") wall = o.wall;
    else {
      wall = o.wall === "front" ? "left" : "back";   // 未写默认后墙；right→back，front→left
      if (o.wall) notes.push({ code: "ROOM_OPENING_REMAPPED", objectIds: [name], status: "repaired", text: `${o.wall} 墙不画（镜头一侧），${o.kind} 改放到 ${wall} 墙` });
    }
    const L = wallLength(room, wall);
    const isDoor = o.kind === "door";
    const width = num(o.width, isDoor ? 0.8 : 0.6, isDoor ? 1.4 : 2.4, isDoor ? 1.0 : 1.2);
    const height = isDoor ? Math.min(2.1, room.height - 0.3) : num(o.height, 0.6, 1.8, 1.2);
    const sill = isDoor ? 0 : num(o.sill, 0.5, Math.max(0.5, room.height - height - 0.3), 1.0);
    const usable = L - 2 * MARGIN - width;
    if (usable < 0) {
      notes.push({ code: "ROOM_OPENING_DROPPED", objectIds: [name], status: "degraded", text: `${o.kind} 宽 ${width}m 放不进 ${wall} 墙（长 ${L.toFixed(1)}m）` });
      return;
    }
    const u = num(o.offset, -1, 1, 0) * (usable / 2);
    const clash = room.openings.find(p => p.wall === wall && Math.abs(p.u - u) < (p.width + width) / 2 + MARGIN);
    if (clash) {
      notes.push({ code: "ROOM_OPENING_DROPPED", objectIds: [name], status: "degraded", text: `${o.kind} 与同墙的 ${clash.kind} 重叠，已丢弃` });
      return;
    }
    room.openings.push({ kind: o.kind, wall, u, width, sill, height });
  });
  return { room, notes };
}

/** 屋内可放东西的范围（墙内表面）。 */
export function roomInterior(r: Pick<RoomSpec, "width" | "depth">) {
  return { minX: -r.width / 2, maxX: r.width / 2, minZ: -r.depth / 2, maxZ: r.depth / 2 };
}

/** 墙局部坐标 u（向右为正）→ 世界 (x,z) 与朝向屋内的法线。 */
export function wallPoint(r: Pick<RoomSpec, "width" | "depth">, wall: RoomWall, u: number) {
  return wall === "back"
    ? { x: u, z: -r.depth / 2, nx: 0, nz: 1 }
    : { x: -r.width / 2, z: -u, nx: 1, nz: 0 };
}

/** 洞口在世界里占的矩形（沿墙方向展开 width，进墙厚度方向取墙厚），供校验和家具避让用。 */
export function openingRect(r: Pick<RoomSpec, "width" | "depth">, o: Opening) {
  const p = wallPoint(r, o.wall, o.u);
  return o.wall === "back"
    ? { minX: p.x - o.width / 2, maxX: p.x + o.width / 2, minZ: p.z, maxZ: p.z + WALL_T }
    : { minX: p.x, maxX: p.x + WALL_T, minZ: p.z - o.width / 2, maxZ: p.z + o.width / 2 };
}

/** at.zone × at.side → 屋内的区位格（三等分）。没有房间时调用方继续用旧的固定带。 */
export function zoneBox(r: Pick<RoomSpec, "width" | "depth">, zone: string, side: string) {
  const i = roomInterior(r);
  const zi = zone === "background" ? 0 : zone === "foreground" ? 2 : 1;
  const xi = side === "left" ? 0 : side === "right" ? 2 : 1;
  const dz = (i.maxZ - i.minZ) / 3, dx = (i.maxX - i.minX) / 3;
  return { x: [i.minX + dx * xi, i.minX + dx * (xi + 1)] as [number, number], z: [i.minZ + dz * zi, i.minZ + dz * (zi + 1)] as [number, number] };
}

/** at.edge 靠墙：沿墙方向的锚点（side 三等分的中心）。返回墙局部 u。 */
export function edgeAnchorU(r: Pick<RoomSpec, "width" | "depth">, wall: RoomWall | "right", side: string): number {
  const L = wall === "back" ? r.width : r.depth;
  const k = side === "left" ? -1 : side === "right" ? 1 : 0;
  return (k * L) / 3;
}
