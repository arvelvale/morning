/**
 * solveLayout —— 关系 → 绝对坐标的解算引擎（P1）。
 *
 * 三段流水线：
 *   ① 锚点吸附：on / in / sitOn 直接落到宿主的承载面/容器内/座位锚点；
 *   ② 关系排布：nextTo / inFrontOf / behind 按宿主朝向推一个身位；
 *   ③ 自由件撒布：at.zone 区位 + 种子伪随机撒布（同 spec 结果恒定）。
 * 之后统一做碰撞消解、贴地、越界钳制与朝向推导。全程纯数字运算，
 * 不依赖渲染器；只有测量一步经 propMeta 现场构造代理体取 BBox。
 *
 * 失败哲学与 _sanitize 一致：关系成环/悬空引用→降级为自由件保留区位提示，
 * 宁可摆得朴素也不报错。
 */
import type { SceneSpec, SceneEnv, PropInstance, CharacterInstance } from "../spec";
import { TYPE_PRESETS } from "../../figure/presets";
import * as THREE from 'three';
import { measureFigureAnchors } from '../../figure/anchors';
import { PROP_GRIPS } from '../grips';
import { PROP_META, propMeta, metaKind, measureProp, type MeasuredBox } from "./propMeta";
import { addIssue } from './report';
import { runChecks, checkCameraVisibility } from "./validator";
import { boundsOverlap, worldBounds } from './bounds';
import { normalizeRoom, roomInterior, zoneBox, edgeAnchorU, type RoomSpec } from './room';
import type {
  SemanticSceneSpec,
  SemanticPropInstance,
  SemanticCharacterInstance,
  SemanticAt,
  LayoutReport,
} from "./types";
import type { LayoutNode } from "./types";

/** 判断一份从后端来的 scene_spec 是语义版还是旧绝对坐标版。 */
export function isSemanticSpec(x: unknown): x is SemanticSceneSpec {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  if (s.kind === "semantic") return true;
  // 兼容无 kind 的历史脏数据：任何 props/characters 条目带关系词且不带 pos 即视为语义版
  const hasRel = (o: Record<string, unknown>) =>
    ["on", "in", "inside", "sitOn", "nextTo", "near", "inFrontOf", "behind", "heldBy", "at"].some((k) => k in o) && !("pos" in o);
  const props = Array.isArray(s.props) ? (s.props as Record<string, unknown>[]) : [];
  const chars = Array.isArray(s.characters) ? (s.characters as Record<string, unknown>[]) : [];
  return props.some(hasRel) || chars.some(hasRel);
}

// ─── 内部节点 ────────────────────────────────────────────────────────────────

type LNode = LayoutNode;

const COORD_LIMIT = 11;
const CHAR_RADIUS = 0.34;

// ─── 确定性随机 ──────────────────────────────────────────────────────────────

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** spec 内容哈希作种子——同一份入库数据无论解算多少次结果一致。 */
function seedOf(spec: SemanticSceneSpec): number {
  const stable = JSON.stringify({
    env: spec.env,
    room: spec.room,
    p: (spec.props ?? []).map((p) => [p.id, p.type, p.on, p.inside, p.heldBy, p.nextTo, p.near, p.inFrontOf, p.behind, p.at]),
    c: (spec.characters ?? []).map((c) => [c.id, c.pose, c.sitOn, c.nextTo, c.near, c.inFrontOf, c.behind, c.facing, c.at]),
  });
  return fnv1a(stable);
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

export interface SolveResult {
  spec: SceneSpec;      // 解算后的绝对坐标规格，直接喂 assembleScene
  report: LayoutReport;
}

export function solveLayout(sem: SemanticSceneSpec): SolveResult {
  const report: LayoutReport = { fixes: [], warnings: [], issues: [] };
  const seed = seedOf({ ...sem,
    props: [...(sem.props ?? [])].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
    characters: [...(sem.characters ?? [])].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
  });
  const measureCache = new Map<string, MeasuredBox | null>();

  // ── 房间骨架：先定房间、再摆家具。房间作为 backdrop 零件进节点表，之后的区位/限位都按屋内算。 ──
  let room: RoomSpec | undefined;
  let propsIn: SemanticPropInstance[] = sem.props ?? [];
  if (sem.room && typeof sem.room === 'object') {
    const norm = normalizeRoom(sem.room);
    room = norm.room;
    for (const note of norm.notes) {
      addIssue(report, { code: note.code, objectIds: note.objectIds, severity: 'warning', status: note.status, actual: note.text }, `${note.code}：${note.text}`);
    }
    // 参数里放原始 room（构造器会用同一个 normalizeRoom 得到同样的结果）
    propsIn = [{ id: '__room', type: 'room', params: sem.room as unknown as Record<string, unknown> }, ...propsIn];
  }
  const interior = room ? roomInterior(room) : undefined;

  /** 依赖某宿主的全部节点（闭包于本次解算的 nodes）。 */
  function dependentsOf(hostId: string): LNode[] {
    return nodes.filter((n) => n.carrier?.hostId === hostId).sort((a, b) => a.id.localeCompare(b.id));
  }
  /** 试摆点是否撞上已有实心件。 */
  function hitsSolid(n: LNode, x: number, z: number): boolean {
    const probe = { ...n, x, z } as LNode;
    return nodes.some((o) => located.has(o.id) && o !== n && collisionKind(o) === "solid" && overlapPair(probe, o) !== null);
  }

  /**
   * 承载定位（place 与碰撞推挤后的重放共用同一份逻辑——推走宿主时子件必须跟随）。
   * 返回 false 表示宿主无对应锚点（调用方降级）。
   */
  function snapToCarrier(n: LNode): boolean {
    const host = n.carrier ? byId.get(n.carrier.hostId) : undefined;
    if (!host || !host.box) return false;
    const hs = host.sem as SemanticPropInstance;
    const meta = propMeta(hs.type, hs.params);
    if (n.carrier!.rel === "on") {
      if (!n.box) return false;
      const dwl = dependentsOf(host.id).filter((d) => d.carrier?.rel === "on").indexOf(n);
      n.rotY = n.explicitRotY ?? host.rotY;
      const surface = host.box.surface ?? { cx: host.box.cx ?? 0, cz: host.box.cz ?? 0, hw: host.box.hw, hd: host.box.hd };
      const relative = n.rotY - host.rotY;
      const rw = Math.abs(Math.cos(relative)) * n.box.hw + Math.abs(Math.sin(relative)) * n.box.hd;
      const rd = Math.abs(Math.sin(relative)) * n.box.hw + Math.abs(Math.cos(relative)) * n.box.hd;
      const off = onHostOffset(dwl, { ...n.box, hw: rw, hd: rd }, { ...host.box, ...surface });
      const [dx, dz] = rotateLocal(off.dx + surface.cx, off.dz + surface.cz, host.rotY);
      const [cx, cz] = rotateLocal(n.box.cx ?? 0, n.box.cz ?? 0, n.rotY);
      n.x = host.x + dx - cx; n.z = host.z + dz - cz;
      n.y = host.y + host.box.top - (n.box.minY ?? 0);
      n.rotY = n.explicitRotY ?? host.rotY;
      n.supportY = n.y; n.onSupport = true;
      return true;
    }
    if (n.carrier!.rel === "in") {
      const m = meta;
      if (m?.innerDy === undefined) return false;
      n.x = host.x; n.z = host.z;
      n.y = host.y + m.innerDy * host.scale - (n.box?.minY ?? 0);
      n.rotY = n.explicitRotY ?? host.rotY;
      n.supportY = n.y; n.onSupport = true;
      return true;
    }
    // sitOn（人物）
    const seats = meta?.seats;
    if (seats && n.seatIndex !== undefined && n.seatIndex < seats.length) {
      const seat = seats[n.seatIndex];
      const [wx, wz] = rotateLocal((seat.dx ?? 0) * host.scale, (seat.dz ?? 0) * host.scale, host.rotY);
      n.x = host.x + wx; n.z = host.z + wz;
      const seatTopWorld = host.y + host.box.top;
      n.y = seatTopWorld - (n.figureAnchors?.contactY ?? 0);
      n.seatFace = (seat.face ?? 0) + host.rotY;
      n.supportY = n.y; n.onSupport = true;
      return true;
    }
    return false;
  }

  // ── 0. 归一化 + 建索引 ──
  const nodes: LNode[] = [];
  const byId = new Map<string, LNode>();
  let pi = 0, ci = 0;

  for (const sp of propsIn) {
    const base = `prop${pi}`;
    let id = sp.id || base;
    while (byId.has(id)) { id = `${base}-${++pi}-dup`; addIssue(report, { code: 'ID_RENAMED', objectIds: [String(sp.id), id], severity: 'warning', status: 'repaired' }, `id 冲突：${sp.id} 重名，已改名 ${id}`); }
    pi++;
    const n: LNode = {
      kind: "prop", id, sem: sp,
      explicitRotY: typeof sp.rotY === "number" ? sp.rotY : undefined,
      scale: clampNum(sp.scale, 0.2, 4, 1) * (PROP_META[sp.type]?.visualScale ?? 1),
      x: 0, y: 0, z: 0, rotY: typeof sp.rotY === "number" ? sp.rotY : 0,
      supportY: 0, onSupport: false,
    };
    nodes.push(n); byId.set(id, n);
  }
  for (const sc of sem.characters ?? []) {
    const base = `char${ci}`;
    let id = sc.id || base;
    while (byId.has(id)) { id = `${base}-${++ci}-dup`; addIssue(report, { code: 'ID_RENAMED', objectIds: [String(sc.id), id], severity: 'warning', status: 'repaired' }, `id 冲突：${sc.id} 重名，已改名 ${id}`); }
    ci++;
    const presetScale = TYPE_PRESETS[sc.type ?? "adult"]?.scale ?? 1;
    const totalScale = clampNum(sc.scale, 0.5, 1.5, 1) * presetScale;
    const n: LNode = {
      kind: "char", id, sem: sc, scale: totalScale,
      pose: sc.pose ?? "standing",
      x: 0, y: 0, z: 0, rotY: 0,
      supportY: 0, onSupport: false,
    };
    nodes.push(n); byId.set(id, n);
  }

  // 关系解析 + 承载依赖收集
  const carrierRels = ["on", "inside", "in", "sitOn"] as const;
  const dirRels = ["nextTo", "near", "inFrontOf", "behind", "heldBy"] as const;
  for (const n of nodes) {
    const semAny = n.sem as Record<string, unknown>;
    for (const rel of carrierRels) {
      const hostId = semAny[rel];
      if (typeof hostId !== "string") continue;
      const host = byId.get(hostId);
      if (!host || host === n || host.kind !== "prop") { n.degraded = `引用的宿主 ${hostId} 不存在、自引用或非零件`; continue; }
      if (n.carrier) { n.degraded = `冲突承载 ${rel} 已忽略`; continue; }
      if (n.kind === "char" && rel === "sitOn") n.carrier = { rel, hostId };
      else if (n.kind === "prop" && rel !== "sitOn") n.carrier = { rel: rel === "inside" ? "in" : rel, hostId };
      else n.degraded = `人物不支持 ${rel}`;
    }
    for (const rel of dirRels) {
      const hostId = semAny[rel];
      if (typeof hostId === "string") {
        const host = byId.get(hostId);
        if (!host || host.id === n.id) { n.degraded = `${rel} 引用的宿主 ${hostId} 无效`; continue; }
        // heldBy 仅零件→人物；其余方向关系两种方向都合法
        if (rel === "heldBy" && !(n.kind === "prop" && host.kind === "char")) {
          n.degraded = `heldBy 只能由零件指向人物`; continue;
        }
        if (rel === "heldBy" && n.carrier) { n.degraded = 'heldBy 与承载冲突，保留承载'; continue; }
        if (n.dirRef && rel !== "heldBy") { n.degraded = `冲突方向 ${rel} 已忽略`; continue; }
        n.dirRef = { rel, hostId };
      }
    }
    if (semAny.at && isAt(semAny.at)) n.at = semAny.at as SemanticAt;
    const f = semAny.facing;
    if (n.kind === "char" && typeof f === "string") n.sem = { ...(n.sem as SemanticCharacterInstance), facing: f };
  }

  // 先分配座位，索引只由宿主和人物 ID 决定，重放不会改变槽位。
  for (const host of nodes) {
    const hp = host.sem as SemanticPropInstance;
    const seats = host.kind === 'prop' ? propMeta(hp.type, hp.params)?.seats ?? [] : [];
    dependentsOf(host.id).filter(n => n.carrier?.rel === 'sitOn').forEach((n, i) => {
      if (i < seats.length) {
        n.seatIndex = i;
        if (n.pose !== 'sitting') addIssue(report, { code: 'SEATED_POSE_NORMALIZED', objectIds: [n.id], severity: 'warning', status: 'repaired', actual: `${n.pose} → sitting` }, `就坐姿态：${n.id} → sitting`);
        n.pose = 'sitting';
      } else {
        n.degraded = `${host.id} 无可用座位，改为站在旁边`;
        n.carrier = undefined;
        n.pose = 'standing';
        n.dirRef = { rel: 'nextTo', hostId: host.id };
      }
    });
  }

  // One right hand supports one declared prop. Unsupported grip types stay visible beside the host.
  const occupiedHands = new Set<string>();
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (n.dirRef?.rel !== 'heldBy') continue;
    const hostId = n.dirRef.hostId;
    if (!PROP_GRIPS[(n.sem as SemanticPropInstance).type] || occupiedHands.has(hostId)) {
      n.degraded = `heldBy 无专用握点或右手已占用，改为放在 ${hostId} 旁边`;
      n.dirRef = { rel: 'nextTo', hostId };
    } else occupiedHands.add(hostId);
  }
  for (const n of nodes.filter(n => n.kind === 'char')) {
    const sc = n.sem as SemanticCharacterInstance;
    n.figureAnchors = measureFigureAnchors({ ...sc, bodyColor: undefined, skinColor: undefined, hairColor: undefined,
      scale: clampNum(sc.scale, .5, 1.5, 1), pose: n.pose as CharacterInstance['pose'] });
  }

  // ── ①/②/③ 按拓扑序落位：包含自由宿主和人物持物依赖 ──
  const placed = new Set<string>();
  const located = new Set<string>();
  const order: LNode[] = [];
  const visit = (n: LNode, chain: Set<string>) => {
    if (placed.has(n.id)) return;
    chain.add(n.id);
    const hostId = n.carrier?.hostId ?? n.dirRef?.hostId;
    const host = hostId ? byId.get(hostId) : undefined;
    if (host && chain.has(host.id)) {
      n.degraded = `位置依赖成环，${n.id} → ${host.id} 已降级`;
      n.carrier = undefined; n.dirRef = undefined;
    } else if (host) {
      visit(host, chain);
    }
    chain.delete(n.id);
    placed.add(n.id);
    order.push(n);
  };
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) visit(n, new Set());

  for (const n of order) { place(n); located.add(n.id); }

  function place(n: LNode) {
    const spTyped = n.sem as SemanticPropInstance;
    const raw = n.kind === "prop"
      ? measureProp(spTyped.type, spTyped.params, n.scale, measureCache)
      : n.figureAnchors?.box;
    const box = raw ?? undefined;
    n.box = box;

    // —— ① 承载锚点吸附 ——
    if (n.carrier) {
      if (snapToCarrier(n)) return;
      n.degraded = `${n.carrier.hostId} 无可用锚点，${n.carrier.rel} 已降级`;
      n.carrier = undefined;
      if (n.pose === 'sitting') {
        n.pose = 'standing';
        const sc = n.sem as SemanticCharacterInstance;
        n.figureAnchors = measureFigureAnchors({ type: sc.type, build: sc.build, outfit: sc.outfit, scale: clampNum(sc.scale, .5, 1.5, 1), pose: 'standing' });
      }
    }
    // —— ② 方向排布 ——
    if (n.dirRef) {
      const host = byId.get(n.dirRef.hostId)!;

      // heldBy：零件吸附到人物手部锚点（手前伸位置随人物朝向）；量不出 BBox 的件降级走撒布
      if (n.dirRef.rel === "heldBy" && host.kind === "char" && n.box) {
        const grip = PROP_GRIPS[spTyped.type];
        const anchors = host.figureAnchors!;
        const [hx, hz] = rotateLocal(anchors.hand[0], anchors.hand[2], host.rotY);
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), host.rotY);
        const orientation = grip.upright ? yaw : yaw.multiply(new THREE.Quaternion().fromArray(anchors.handQuaternion));
        const offset = new THREE.Vector3(...grip.point).multiplyScalar(n.scale).applyQuaternion(orientation);
        n.x = host.x + hx - offset.x; n.z = host.z + hz - offset.z;
        n.y = host.y + anchors.hand[1] - offset.y;
        n.rotY = n.explicitRotY ?? host.rotY;
        n.supportY = n.y; n.onSupport = true;   // 以手为支撑，不参与贴地修正
        return;
      }

      const flatHost = host.kind === "prop" && metaKind(PROP_META[(host.sem as SemanticPropInstance).type]) === "flat";
      if (!flatHost) {
        const fwdX = Math.sin(host.rotY), fwdZ = Math.cos(host.rotY);
        const sideX = Math.cos(host.rotY), sideZ = -Math.sin(host.rotY);
        const hostHalf = halfExtent(host);
        const myHalf = halfExtent(n);
        // nextTo 紧邻一个身位；near 松散约两个身位
        const gap = n.dirRef.rel === "near" ? 1.1 : 0.4;
        const d = hostHalf + myHalf + gap;
        let vx = 0, vz = 0;
        if (n.dirRef.rel === "inFrontOf") { vx = fwdX * d; vz = fwdZ * d; }
        else if (n.dirRef.rel === "behind") { vx = -fwdX * d; vz = -fwdZ * d; }
        else { vx = sideX * d; vz = sideZ * d; }   // nextTo / near 都走侧向，near 更远
        n.x = host.x + vx; n.z = host.z + vz; n.y = groundY(n);
        n.onSupport = false; n.supportY = n.y; // near a raised object does not imply standing on it
        // 零件保持默认朝向；人物转过来面向宿主（回头呼唤的自然感）
        if (n.explicitRotY !== undefined) n.rotY = n.explicitRotY;
        else if (n.kind === "char") n.rotY = angleTo(n, host);
        else n.rotY = 0;
        return;
      }
      n.degraded = `${host.id} 是贴片，方向关系降级`;
    }
    // —— ③ 画面骨架特批 → 区位撒布 ——
    const bd = n.kind === "prop" ? PROP_META[spTyped.type]?.backdrop : undefined;
    if (bd) {
      // 权威锚点定位；at.bias 作为相对偏移仍生效（如"路再往前景一点"）
      n.backdrop = { x: bd.x, y: bd.y ?? 0, z: bd.z, rotY: bd.rotY };
      n.x = bd.x + (n.at?.bias?.[0] ?? 0);
      n.y = bd.y ?? 0;
      n.z = bd.z + (n.at?.bias?.[1] ?? 0);
      n.rotY = n.explicitRotY ?? bd.rotY ?? 0;
      return;
    }
    scatter(n);
  }

  /**
   * 区位撒布。bias 语义（P3 定稿）：**世界坐标意图**——给定 bias 时 [x,z] 即期望的
   * 绝对位置（仅受全局边界钳制），zone/side 只在无 bias 时决定随机撒布区域。
   * 夹具/LLM 用 bias 精确构图（贴墙、桌沿、对坐位），自由件仍走种子随机。
   */
  function scatter(n: LNode) {
    const rand = mulberry32(seed ^ fnv1a(n.id));
    const at = n.at ?? defaultZoneFor(n);
    if (room && n.kind === "prop" && at.edge) { placeAgainstWall(n, at); return; }
    // 窗帘必须挂在墙上：没写靠墙就自动贴到第一扇窗所在的墙、对齐窗的位置（不然会飘在屋子中间）
    if (room && n.kind === "prop" && (n.sem as SemanticPropInstance).type === "curtain") {
      const win = room.openings.find(o => o.kind === "window");
      placeAgainstWall(n, { ...at, edge: win?.wall ?? "back" }, win?.u);
      return;
    }
    if (at.edge && !room) {
      addIssue(report, { code: 'EDGE_WITHOUT_ROOM', objectIds: [n.id], severity: 'warning', status: 'degraded', actual: '规格里没有 room，at.edge 已忽略' }, `靠墙无效：${n.id}（规格里没有 room）`);
    }
    // 有房间：三等分屋内；没有：沿用旧的固定区位带
    const cell = room ? zoneBox(room, at.zone, at.side) : undefined;
    const zb = cell ? cell.z : ZONE_Z[at.zone], xb = cell ? cell.x : SIDE_X[at.side];
    const marginZ = room ? 0.35 : 0.9, marginX = room ? 0.35 : 0.8;
    const myHalf = halfExtent(n);
    const lim = interior
      ? { x0: interior.minX + myHalf, x1: interior.maxX - myHalf, z0: interior.minZ + myHalf, z1: interior.maxZ - myHalf }
      : { x0: -COORD_LIMIT + myHalf, x1: COORD_LIMIT - myHalf, z0: -COORD_LIMIT + myHalf, z1: COORD_LIMIT - myHalf };
    const biased = at.bias !== undefined;
    for (let i = 0; i < 8; i++) {
      const jx = biased ? at.bias![0] : lerp(xb[0] + Math.min(marginX, (xb[1] - xb[0]) / 2), xb[1] - Math.min(marginX, (xb[1] - xb[0]) / 2), rand());
      const jz = biased ? at.bias![1] : lerp(zb[0] + Math.min(marginZ, (zb[1] - zb[0]) / 2), zb[1] - Math.min(marginZ, (zb[1] - zb[0]) / 2), rand());
      const x = clampRange(jx, Math.min(lim.x0, lim.x1), Math.max(lim.x0, lim.x1));
      const z = clampRange(jz, Math.min(lim.z0, lim.z1), Math.max(lim.z0, lim.z1));
      if (biased || i === 7 || !hitsSolid(n, x, z)) { n.x = x; n.z = z; break; }
    }
    n.y = groundY(n); n.supportY = n.y;
    n.rotY = n.explicitRotY ?? (n.kind === "prop" ? 0 : faceTowardCameraDefault());
  }

  /**
   * 靠墙：贴着 at.edge 那面墙的内表面摆，正面朝屋内。
   * 沿墙位置 = side 的三等分中心 + bias[0]（镜头看去向右为正）；贴合用旋转后的真实包围盒算，
   * 所以不管家具厚薄，背面都恰好挨着墙。
   */
  function placeAgainstWall(n: LNode, at: SemanticAt, alongOverride?: number) {
    const r = room!, edge = at.edge!;
    // 正面（+z）朝屋内：后墙 0；左墙 +x → π/2；右墙 -x → -π/2
    const faceRot = edge === "back" ? 0 : edge === "left" ? Math.PI / 2 : -Math.PI / 2;
    n.rotY = n.explicitRotY ?? faceRot;
    const probe = { ...n, x: 0, z: 0 } as LNode;
    const wb = worldBounds(probe);
    const along = alongOverride ?? edgeAnchorU(r, edge, at.side) + (at.bias?.[0] ?? 0);
    const gap = 0.005;
    if (edge === "back") { n.x = along - (wb.minX + wb.maxX) / 2; n.z = -r.depth / 2 + gap - wb.minZ; }
    else if (edge === "left") { n.z = -along - (wb.minZ + wb.maxZ) / 2; n.x = -r.width / 2 + gap - wb.minX; }
    else { n.z = along - (wb.minZ + wb.maxZ) / 2; n.x = r.width / 2 - gap - wb.maxX; }
    n.y = groundY(n); n.supportY = n.y;
  }

  // ── 碰撞消解（solid 对 solid；flat 给 solid 让路；ambient 不参与）──
  resolveOverlaps();

  function resolveOverlaps() {
    const rootOf = (node: LNode) => {
      let root = node;
      const seen = new Set<string>();
      while (!seen.has(root.id)) {
        seen.add(root.id);
        const parent = root.carrier?.hostId ?? (root.dirRef?.rel === 'heldBy' ? root.dirRef.hostId : undefined);
        if (!parent || !byId.has(parent)) break;
        root = byId.get(parent)!;
      }
      return root;
    };
    const solids = nodes.filter((n) => collisionKind(n) === "solid" && n.dirRef?.rel !== 'heldBy').sort((a, b) => a.id.localeCompare(b.id));
    for (let iter = 0; iter < 10; iter++) {
      let moved = false;
      for (let i = 0; i < solids.length; i++) {
        for (let j = i + 1; j < solids.length; j++) {
          const a = solids[i], b = solids[j];
          const rootA = rootOf(a), rootB = rootOf(b);
          // Members in one support tree cannot be separated by moving the root.
          if (rootA === rootB || (rootA.backdrop && rootB.backdrop)) continue;
          const pa = overlapPair(a, b);
          if (!pa) continue;
          // 沿最小穿透轴推开移动量小的那个
          const mover = rootA.backdrop ? b : rootB.backdrop ? a : mass(rootA) <= mass(rootB) ? a : b;
          const other = mover === a ? b : a;
          const mb = worldBounds(mover), ob = worldBounds(other);
          const pushX = pa.axis === "x" ? (pa.depth + .002) * (mb.minX + mb.maxX >= ob.minX + ob.maxX ? 1 : -1) : 0;
          const pushZ = pa.axis === "z" ? (pa.depth + .002) * (mb.minZ + mb.maxZ >= ob.minZ + ob.maxZ ? 1 : -1) : 0;
          const root = rootOf(mover);
          for (const child of nodes) if (rootOf(child) === root) { child.x += pushX; child.z += pushZ; }
          moved = true;
          addIssue(report, { code: 'COLLISION_TRANSLATED', objectIds: [root.id, other.id], severity: 'warning', status: 'repaired', expected: '承载子树一起移动；最终残差另行复核' }, `碰撞平移：${root.id} 承载子树`);
        }
      }
      if (!moved) break;
    }
    // 推完把承载着重放回宿主（x/z 跟随宿主新位置 + 高度重投，彻底解决"推走椅子人悬空"）
    for (const n of order) {
      if (n.onSupport && n.carrier) {
        snapToCarrier(n);
      }
    }
  }

  // ── 边界钳制 + 贴地（backdrop 骨架件豁免：road/water 本来就横越坐标语义）──
  for (const n of nodes) {
    if (room && !n.backdrop && !n.carrier && n.dirRef?.rel !== 'heldBy') {
      // 屋内限位：按旋转后的真实包围盒把整件推回四面墙以内；比屋子还大的件在校验里报 ROOM_OBJECT_TOO_BIG
      const b = worldBounds(n), i = interior!;
      const dx = b.minX < i.minX ? i.minX - b.minX : b.maxX > i.maxX ? i.maxX - b.maxX : 0;
      const dz = b.minZ < i.minZ ? i.minZ - b.minZ : b.maxZ > i.maxZ ? i.maxZ - b.maxZ : 0;
      if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) {
        addIssue(report, { code: 'BOUNDARY_CLAMPED', objectIds: [n.id], severity: 'warning', status: 'repaired', actual: '推回屋内' }, `推回屋内：${n.id}`);
        n.x += dx; n.z += dz;
      }
    } else if (!n.backdrop && !n.carrier && n.dirRef?.rel !== 'heldBy') {
      const h = halfExtent(n);
      const nx = clampRange(n.x, -COORD_LIMIT + h, COORD_LIMIT - h);
      const nz = clampRange(n.z, -COORD_LIMIT + h, COORD_LIMIT - h);
      if (nx !== n.x || nz !== n.z) { addIssue(report, { code: 'BOUNDARY_CLAMPED', objectIds: [n.id], severity: 'warning', status: 'repaired' }, `越界钳回：${n.id}`); n.x = nx; n.z = nz; }
    }
    if (!n.onSupport && !n.backdrop) n.y = groundY(n);
  }

  // ── 朝向推导（位置定完才有"互相面向"可言）──
  deriveFacings(report);

  // 宿主经过碰撞、边界及转向后，再按依赖顺序重放全部附属物。
  for (const n of order) {
    if (n.carrier) snapToCarrier(n);
    else if (n.dirRef?.rel === 'heldBy') place(n);
    if (n.degraded) {
      addIssue(report, { code: 'RELATION_DEGRADED', objectIds: [n.id], severity: 'warning', status: 'degraded', actual: n.degraded }, `关系降级：${n.id}：${n.degraded}`);
    }
  }

  function deriveFacings(r: LayoutReport) {
    const chars = nodes.filter((n) => n.kind === "char");
    for (const c of chars) {
      const want = (c.sem as SemanticCharacterInstance).facing;
      if (typeof want === "string" && want.length > 0) {
        if (want === "camera") { c.rotY = faceTowardCameraDefault(); continue; }
        if (want === "away") { c.rotY = faceTowardCameraDefault() + Math.PI; continue; }
        const targetId = want.startsWith("toward:") ? want.slice(7) : want;
        const t = byId.get(targetId);
        if (t && t !== c) { c.rotY = angleTo(c, t); continue; }
        addIssue(r, { code: 'FACING_TARGET_INVALID', objectIds: [c.id, targetId], severity: 'warning', status: 'degraded' }, `facing 目标无效：${targetId}`);
      }
      if (c.seatFace !== undefined) { c.rotY = c.seatFace; continue; }
      // 默认：就近对话配对相向；否则面朝镜头方向
      const near = chars.find((o) => o !== c && dist(o, c) < 2.4);
      if (near && CONV_POSES.has(c.pose ?? "") && near.rotY !== undefined) {
        c.rotY = angleTo(c, near);
        if (CONV_POSES.has(near.pose ?? "")) near.rotY = angleTo(near, c);
      } else {
        c.rotY = c.rotY || faceTowardCameraDefault();
      }
    }
  }

  // ── Validator 五项检查（穿模兜底已在 resolveOverlaps 处理过，这里复核并产出报告）──
  runChecks(nodes, sem, report, room);

  // ── 组装绝对坐标 SceneSpec ──
  const props: PropInstance[] = [];
  const characters: CharacterInstance[] = [];
  for (const n of nodes) {
    if (n.kind === "prop") {
      const sp = n.sem as SemanticPropInstance;
      props.push({
        id: n.id,
        ...(n.dirRef?.rel === 'heldBy' ? { heldBy: n.dirRef.hostId } : {}),
        ...(n.carrier ? { supportId: n.carrier.hostId } : {}),
        type: sp.type,
        pos: round3([n.x, n.y, n.z]),
        rotY: roundAngle(n.rotY),
        // 视觉大小 = metadata 推荐值 × （LLM 输入；P2 起后端已剥离，通常为 1）
        scale: n.scale,
        params: sp.params,
      });
    } else {
      const sc = n.sem as SemanticCharacterInstance;
      characters.push({
        id: n.id,
        seatContactEnabled: n.carrier?.rel === 'sitOn',
        pos: round3([n.x, n.y, n.z]),
        rotY: roundAngle(n.rotY),
        ...(sc.scale !== undefined ? { scale: clampNum(sc.scale, .5, 1.5, 1) } : {}),
        pose: n.pose as CharacterInstance['pose'],
        type: sc.type, build: sc.build, outfit: sc.outfit, hairstyle: sc.hairstyle,
        backpack: sc.backpack,
        bodyColor: sc.bodyColor, skinColor: sc.skinColor, hairColor: sc.hairColor,
      });
    }
  }
  if (report.warnings.length) report.warnings.unshift(`解算完成，${nodes.length} 个对象`);
  const spec: SceneSpec = { env: sem.env as SceneEnv, props, characters };
  if (sem.mood) (spec as { mood?: string }).mood = sem.mood;   // mood 透传给 assemble 的灯光系统
  // Validate the final camera, never label an unverified look-only shift as a repair.
  spec.camera = fitCamera(nodes, sem);
  if (spec.camera) checkCameraVisibility(nodes, spec.camera, report);
  return { spec, report };
}

/**
 * fitCameraToScene —— 以「主角 + 可聚焦零件」的包围球反解相机距离。
 *
 * 参与取景：人物 + 实心/贴片零件；排除 ambient 氛围件与 backdrop 骨架
 * （海面/城市剪影延伸出画本是正常构图，算进去会把镜头推到天边）。
 * 看点 = 主角位置向群体质心插值，保证重要人物居中。
 * 竖屏水平半视角按保守 tan≈0.233 反解：d = r / tan(halfFov)，钳制 [3.8, 18] 米。
 */
function fitCamera(nodes: LNode[], sem: SemanticSceneSpec): SceneSpec["camera"] | undefined {
  const mode = (sem.env?.mode ?? "outdoor") === "indoor" ? "indoor" : "outdoor";
  const focusable = nodes.filter((n) => {
    if (n.kind === "char") return true;
    const meta = PROP_META[(n.sem as SemanticPropInstance).type];
    if (meta?.ambientOnly || n.backdrop) return false;
    // flat 贴片（墙/地毯/路面）不参与取景：墙面把包围球撑大会把镜头推离主体
    return metaKind(meta) === "solid";
  });
  if (focusable.length === 0) return undefined;

  const hero = nodes.find((n) => n.kind === "char") ?? focusable[0];
  let cx = hero.x, cz = hero.z, w = 1;
  for (const n of focusable) {
    if (n === hero) continue;
    cx += n.x; cz += n.z; w++;
  }
  cx /= w; cz /= w;

  let r = 1.6;   // 最小球半径留呼吸空间
  for (const n of focusable) {
    r = Math.max(r, Math.hypot(n.x - cx, n.z - cz) + halfExtent(n));
    // 高度只按 35% 折算参与包围球（路灯/树再高也不该把镜头推到天边）
    if (n.kind === "prop" && n.box) r = Math.max(r, n.box.h * 0.35);
  }
  // 默认机位方向向量（保持两档室内外既有气质），长度=包围球反解
  const dirBase = mode === "outdoor" ? [4.5, 1.9, 5] : [3.2, 1.7, 4];   // y 压低：轻微仰视，人物更高大
  const lookY = 0.9;
  let dl = Math.hypot(dirBase[0], dirBase[1], dirBase[2]);
  dl = Math.max(0.001, dl);
  const d = Math.min(11, Math.max(3.6, r / 0.233));   // 上限收紧：中景特写而非全景空场
  return {
    pos: [
      Math.round((cx + (dirBase[0] / dl) * d) * 100) / 100,
      Math.round(((dirBase[1] / dl) * d + lookY) * 100) / 100,
      Math.round((cz + (dirBase[2] / dl) * d) * 100) / 100,
    ],
    look: [Math.round(cx * 100) / 100, lookY, Math.round(cz * 100) / 100],
  };
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 自由件的 y：贴地（-minY）。挂墙件的离地高度在构造器里，不能再被抹成 0 以下。 */
function groundY(n: LNode): number {
  if (n.kind === 'prop' && PROP_META[(n.sem as SemanticPropInstance).type]?.hung) return 0;
  return -(n.box?.minY ?? 0);
}

const CONV_POSES = new Set(["arguing", "comforting", "hugging", "handingItem", "waving", "lookingBack"]);

const ZONE_Z: Record<string, [number, number]> = {
  background: [-9, -3.4], midground: [-2.6, 2.4], foreground: [2.8, 6.5],
};
const SIDE_X: Record<string, [number, number]> = {
  left: [-7.5, -2.2], center: [-1.8, 1.8], right: [2.2, 7.5],
};

function defaultZoneFor(n: LNode): SemanticAt {
  if (n.kind === "char") return { zone: "midground", side: "center" };
  return { zone: "background", side: "left" };
}

function clampNum(v: unknown, lo: number, hi: number, fb: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  return Number.isNaN(n) ? fb : Math.min(hi, Math.max(lo, n));
}
function clampRange(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rotateLocal(dx: number, dz: number, ry: number): [number, number] {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [dx * c + dz * s, -dx * s + dz * c];
}
function round3(v: [number, number, number]): [number, number, number] {
  return [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
}
function roundAngle(a: number): number { return Math.round(a * 1000) / 1000; }

function isAt(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.zone === "string" && o.zone in ZONE_Z
    && typeof o.side === "string" && o.side in SIDE_X;
}

function halfExtent(n: LNode): number {
  if (n.kind === "char") return CHAR_RADIUS * Math.max(0.6, n.scale);
  return Math.max(n.box?.hw ?? 0.5, n.box?.hd ?? 0.5);
}

function onHostOffset(idx: number, dep: MeasuredBox, host: MeasuredBox): { dx: number; dz: number } {
  const roomX = Math.max(0, host.hw - dep.hw - 0.06);
  const roomZ = Math.max(0, host.hd - dep.hd - 0.06);
  if (idx === 0) return { dx: 0, dz: 0 };
  const ring = [
    { dx: roomX * 0.8, dz: 0 }, { dx: -roomX * 0.8, dz: 0 },
    { dx: 0, dz: roomZ * 0.8 }, { dx: 0, dz: -roomZ * 0.8 },
    { dx: roomX * 0.55, dz: roomZ * 0.55 }, { dx: -roomX * 0.55, dz: -roomZ * 0.55 },
  ];
  return ring[(idx - 1) % ring.length];
}

function collisionKind(n: LNode): "solid" | "flat" | "ambient" | "char" {
  if (n.kind === "char") return "solid";
  return metaKind(PROP_META[(n.sem as { type?: string }).type ?? ""]);
}

function mass(n: LNode): number {
  if (n.kind === "char") return 10;                       // 人物尽量不被推开
  const b = n.box;
  return b ? b.hw * b.hd : 0.25;
}

interface OverlapHit { axis: "x" | "z"; depth: number }

function overlapPair(a: LNode, b: LNode): OverlapHit | null {
  // backdrop 骨架件不推挤别人、也不被推（road/water/platform 横越坐标语义）
  if (a.backdrop || b.backdrop) return null;
  const ka = collisionKind(a), kb = collisionKind(b);
  if (ka === "ambient" || kb === "ambient") return null;
  if ((ka === "flat") !== (kb === "flat")) return null;   // flat 只和 flat 互查（路面之间本来就少见重叠）
  if (ka === "flat" && kb === "flat") return null;
  return boundsOverlap(a, b);
}

function angleTo(from: LNode, to: LNode): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
function dist(a: LNode, b: LNode): number { return Math.hypot(a.x - b.x, a.z - b.z); }
/** 默认镜头在 (+,+,+) 象限看向原点，取其水平反向即"面向观众"。 */
function faceTowardCameraDefault(): number { return Math.atan2(4.5, 5); }
