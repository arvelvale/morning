/**
 * 单房间骨架：地板 + 后墙 + 左墙（带真实洞口）+ 门窗。
 * 尺寸、洞口位置全部来自 layout/room.ts 的 normalizeRoom（与求解器、校验器同一份数据）。
 * 墙/地/踢脚线合成一个顶点色 mesh；门窗是少量独立小件。原点 = 房间中心的地面。
 * 墙只接收阴影、不投影——否则主光从后墙一侧来时整间屋子会被自己的墙罩黑。
 */
import * as THREE from "three";
import { mat } from "../shared";
import type { PropBuilder } from "../shared";
import { mergePieces, place, shade, type Piece } from "../../../figure/geo";
import { normalizeRoom, WALL_T, type Opening, type RoomSpec, type RoomWall, type SemanticRoom } from "../../layout/room";
import { buildDoor } from "./door";

interface Seg { u0: number; u1: number; y0: number; y1: number }

/** 把一面墙按洞口切成若干矩形（u 沿墙、y 向上）。 */
function wallSegments(L0: number, L1: number, H: number, openings: Opening[]): Seg[] {
  const out: Seg[] = [];
  let cursor = L0;
  for (const o of [...openings].sort((a, b) => a.u - b.u)) {
    const a = o.u - o.width / 2, b = o.u + o.width / 2;
    if (a > cursor) out.push({ u0: cursor, u1: a, y0: 0, y1: H });
    if (o.sill > 0) out.push({ u0: a, u1: b, y0: 0, y1: o.sill });
    if (o.sill + o.height < H) out.push({ u0: a, u1: b, y0: o.sill + o.height, y1: H });
    cursor = b;
  }
  if (cursor < L1) out.push({ u0: cursor, u1: L1, y0: 0, y1: H });
  return out;
}

/** 墙局部 (u, y, 沿法线方向的偏移 n) → 世界。n>0 指向屋内。 */
function wallPlace(r: RoomSpec, wall: RoomWall, u: number, y: number, n: number): [number, number, number] {
  return wall === "back" ? [u, y, -r.depth / 2 - WALL_T / 2 + n] : [-r.width / 2 - WALL_T / 2 + n, y, -u];
}

export const buildRoom: PropBuilder = (p) => {
  const { room } = normalizeRoom(p as SemanticRoom);
  const g = new THREE.Group();
  const W = room.width, D = room.depth, H = room.height;
  const wallC = new THREE.Color(room.wallColor).getHex();
  const floorC = new THREE.Color(room.floorColor).getHex();
  const trimC = shade(wallC, 0.82);
  const pieces: Piece[] = [];

  // 地板：一块底板 + 一排略错色的木板条（缝里露出底板的深色）
  pieces.push({ geo: new THREE.BoxGeometry(W + WALL_T, 0.1, D + WALL_T), color: shade(floorC, 0.7), matrix: place(-WALL_T / 2, -0.04, -WALL_T / 2) });
  const plankW = 0.34;
  const planks = Math.max(3, Math.round(W / plankW));
  const pw = W / planks;
  for (let i = 0; i < planks; i++) {
    pieces.push({
      geo: new THREE.BoxGeometry(pw - 0.012, 0.006, D),
      color: shade(floorC, i % 2 ? 0.95 : 1.04),
      matrix: place(-W / 2 + pw * (i + 0.5), 0.008, 0),
    });
  }

  // 墙：后墙向左多伸出一个墙厚，把墙角封上
  const addWall = (wall: RoomWall, L0: number, L1: number) => {
    const ops = room.openings.filter(o => o.wall === wall);
    for (const s of wallSegments(L0, L1, H, ops)) {
      const len = s.u1 - s.u0, h = s.y1 - s.y0;
      if (len < 0.01 || h < 0.01) continue;
      const mid = (s.u0 + s.u1) / 2;
      const [x, y, z] = wallPlace(room, wall, mid, s.y0 + h / 2, 0);
      const size: [number, number, number] = wall === "back" ? [len, h, WALL_T] : [WALL_T, h, len];
      pieces.push({ geo: new THREE.BoxGeometry(...size), color: wallC, matrix: place(x, y, z), top: 0.18 });
      if (s.y0 === 0) {   // 踢脚线只铺在贴地的墙段上，门洞处断开
        const [bx, by, bz] = wallPlace(room, wall, mid, 0.06, WALL_T / 2 + 0.012);
        const bs: [number, number, number] = wall === "back" ? [len, 0.12, 0.026] : [0.026, 0.12, len];
        pieces.push({ geo: new THREE.BoxGeometry(...bs), color: trimC, matrix: place(bx, by, bz) });
      }
    }
  };
  addWall("back", -W / 2 - WALL_T, W / 2);
  addWall("left", -D / 2, D / 2);

  const shell = new THREE.Mesh(mergePieces(pieces), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  shell.name = "room-shell";
  shell.receiveShadow = true;
  g.add(shell);

  // 门窗：每个洞口一个小组，放在墙厚中面上，朝向屋内
  for (const o of room.openings) {
    const holder = new THREE.Group();
    holder.name = `room-${o.kind}`;
    const [x, , z] = wallPlace(room, o.wall, o.u, 0, 0);
    holder.position.set(x, 0, z);
    holder.rotation.y = o.wall === "back" ? 0 : Math.PI / 2;
    if (o.kind === "door") {
      holder.add(buildDoor({ width: o.width, height: o.height, color: "#b99a74", frame: "#6e583f" }));
    } else {
      holder.add(buildOpeningWindow(o, wallC));
    }
    g.add(holder);
  }
  g.userData.room = room;
  return g;
};

/** 窗：四根窗框 + 十字窗棂 + 窗台 + 半透明玻璃（洞是真的，天空能透过来）。 */
function buildOpeningWindow(o: Opening, wallC: number): THREE.Object3D {
  const w = o.width, h = o.height, f = 0.06;
  const frameMat = mat("wood", shade(wallC, 0.55));
  const grp = new THREE.Group();
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat);
    m.position.set(x, y, z);
    grp.add(m);
  };
  const cy = o.sill + h / 2;
  box(w + 2 * f, f, 0.1, 0, o.sill + f / 2, 0);                       // 下框
  box(w + 2 * f, f, 0.1, 0, o.sill + h - f / 2, 0);                           // 上框
  box(f, h, 0.1, -w / 2 + f / 2, cy, 0);                                      // 左框
  box(f, h, 0.1, w / 2 - f / 2, cy, 0);                                       // 右框
  box(0.035, h - f, 0.05, 0, cy, 0.01);                                       // 竖棂
  box(w - f, 0.035, 0.05, 0, cy, 0.01);                                       // 横棂
  box(w + 0.2, 0.05, 0.16, 0, o.sill - 0.02, 0.07);                           // 窗台（探出墙面）
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w - f, h - f),
    mat("emissive", 0xdfeaff, { emissive: 0xdfeaff, emissiveIntensity: 0.45, opacity: 0.34, transparent: true }),
  );
  glass.position.set(0, cy, 0);
  grp.add(glass);
  return grp;
}
