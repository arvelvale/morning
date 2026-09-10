/**
 * 乡村老房子：双坡人字顶（三角山墙封顶 + 挑檐瓦坡）+ 砖烟囱（炊烟从囱口出）
 * + 立体门窗（门框/门槛/三级石阶/对联木牌）+ 暖窗光。原点贴地。
 */
import * as THREE from "three";
import { mat, flatMat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildOldHouse: PropBuilder = (p) => {
  const g = new THREE.Group();
  const w = numOf(p.width, 4), d = numOf(p.depth, 3), wallH = numOf(p.height, 1.9);

  // ── 墙体 + 勒脚 ──
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), flatMat(hexNum(p.color, 0xd8cbb4), 1));
  body.position.y = wallH / 2;
  body.castShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.24, d + 0.12), flatMat(hexNum(p.base, 0x8a8078), 1));
  base.position.y = 0.12;
  g.add(body, base);

  // ── 双坡人字顶：山墙三角（封死墙顶）+ 两块斜坡瓦面（带厚度、挑檐 0.25）──
  const atticH = Math.min(1.1, d * 0.38);            // 屋顶直边三角的高
  const roofColor = hexNum(p.roof, 0x4a4a52);
  const roofMat = flatMat(roofColor, 0.9);
  // 山墙（前后两面三角形）：Shape → ShapeGeometry，贴墙面
  const gableShape = new THREE.Shape([
    new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, atticH),
  ]);
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  for (const dz of [d / 2 - 0.005, -(d / 2 - 0.005)]) {
    const gable = new THREE.Mesh(gableGeo, flatMat(hexNum(p.color, 0xcabfa8), 1));
    gable.position.set(0, wallH, dz);
    if (dz < 0) gable.rotation.y = Math.PI;
    gable.castShadow = true;
    g.add(gable);
  }
  // 两块坡面：斜 Box（长 = 屋长 + 挑檐，宽 = 斜坡长，厚 0.09），屋脊相接
  const slopeLen = Math.hypot(d / 2 + 0.25, atticH) + 0.1;
  const slopeAngle = Math.atan2(atticH, d / 2 + 0.25);
  for (const side of [1, -1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.09, slopeLen), roofMat);
    slope.position.set(0, wallH + atticH / 2, side * (d / 4 + 0.02));
    slope.rotation.x = side * slopeAngle;
    slope.castShadow = true;
    g.add(slope);
    // 坡面瓦楞：两条横向压条随坡旋转（贴着坡面，不再悬空）
    for (const t of [0.35, 0.7]) {
      const batt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.52, 0.035, 0.06), roofMat);
      batt.position.set(0, wallH + atticH * (1 - t) + 0.06, side * ((d / 2 + 0.25) * t));
      batt.rotation.x = side * slopeAngle;
      g.add(batt);
    }
  }
  // 屋脊压条
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.56, 0.09, 0.18), roofMat);
  ridge.position.y = wallH + atticH + 0.03;
  g.add(ridge);

  // ── 砖烟囱：红砖身 + 顶帽，明确从坡面穿出，炊烟起点 = 囱口 ──
  const chimneyX = w * 0.28;
  const chimneyBaseY = wallH + atticH * 0.55;
  const chimneyH = 0.85;
  const brick = mat("stone", 0x8a4a3a);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, chimneyH, 0.3), brick);
  chimney.position.set(chimneyX, chimneyBaseY + chimneyH / 2 - 0.1, -d * 0.08);
  chimney.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.4), brick);
  cap.position.set(chimneyX, chimneyBaseY + chimneyH - 0.06, -d * 0.08);
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.24), flatMat(0x6a3a2a, 1));
  capTop.position.set(chimneyX, chimneyBaseY + chimneyH - 0.005, -d * 0.08);
  g.add(chimney, cap, capTop);
  const chimneyMouthY = chimneyBaseY + chimneyH;

  // ── 门：门框 + 门槛 + 门板 + 三级石台阶 + 对联木牌 ──
  const doorMat = flatMat(hexNum(p.door, 0x6a4a30), 0.85);
  const frameMat = flatMat(0x4a3a28, 0.9);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.07), doorMat);
  door.position.set(0, 0.65, d / 2 + 0.02);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.3, 0.02), flatMat(0x3a2a1a, 1));
  seam.position.set(0, 0.65, d / 2 + 0.062);
  // 门框：左右柱 + 顶梁
  ([[-0.46], [0.46]] as const).forEach(([fx]) => {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.42, 0.1), frameMat);
    jamb.position.set(fx, 0.71, d / 2 + 0.03);
    g.add(jamb);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.1), frameMat);
  lintel.position.set(0, 1.4, d / 2 + 0.03);
  // 门槛
  const sill = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.16), frameMat);
  sill.position.set(0, 0.035, d / 2 + 0.08);
  g.add(door, seam, lintel, sill);
  // 对联木牌（微贴门框，深底浅字块）
  const coupletMat = mat("wood", 0x8a2f24);
  for (const dx of [-0.68, 0.68]) {
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.03), coupletMat);
    plaque.position.set(dx, 0.75, d / 2 + 0.045);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.012), flatMat(0xe8d8b0, 1));
    strip.position.set(dx, 0.75, d / 2 + 0.065);
    g.add(plaque, strip);
  }
  // 三级石台阶（渐宽渐矮）
  const stepStone = flatMat(0x9a938a, 1);
  for (let i = 0; i < 3; i++) {
    const stepW = 1.2 + i * 0.18, stepH = 0.09, stepZ = d / 2 + 0.18 + i * 0.16;
    const step = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH, 0.18), stepStone);
    step.position.set(0, stepH / 2 + (2 - i) * 0.09 * 0, stepZ);
    step.position.y = 0.045 + (2 - i) * 0.09;
    g.add(step);
  }

  // ── 窗：厚深框 + 十字棂 + 窗台 + 暖光玻璃（lit 时自发光）──
  const lit = p.lit !== false;
  const winMat = lit
    ? mat("emissive", hexNum(p.window, 0xffcf8a), { emissive: hexNum(p.window, 0xffcf8a), emissiveIntensity: 0.9 })
    : new THREE.MeshStandardMaterial({ color: hexNum(p.window, 0x3a3f4c), roughness: 0.4 });
  const winFrameMat = flatMat(0x4a3826, 0.9);
  ([-w * 0.28, w * 0.28] as const).forEach((x) => {
    const zFace = d / 2 + 0.01;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.66, 0.1), winFrameMat);
    frame.position.set(x, wallH * 0.62, zFace);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), winMat);
    pane.position.set(x, wallH * 0.62, zFace + 0.052);
    // 十字棂 + 窗台板
    const mullV = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 0.03), winFrameMat);
    mullV.position.set(x, wallH * 0.62, zFace + 0.055);
    const mullH = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.03), winFrameMat);
    mullH.position.set(x, wallH * 0.62, zFace + 0.055);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.14), winFrameMat);
    board.position.set(x, wallH * 0.62 - 0.36, zFace + 0.04);
    g.add(frame, pane, mullV, mullH, board);
  });
  // 门前暖光：奶奶屋里亮着灯、在门口迎接（单 PointLight，预算内）
  if (lit) {
    const porch = new THREE.PointLight(0xffb060, 1.3, 6.5, 1.5);
    porch.position.set(0, 1.25, d / 2 + 0.7);
    g.add(porch);
  }

  // ── 炊烟：从烟囱口升起，随风斜飘、变大变淡 ──
  const smoke = p.smoke !== false;
  if (smoke) {
    const puffGeo = new THREE.BufferGeometry();
    const count = 10;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = Math.random();
    puffGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const puffs = new THREE.Points(puffGeo, new THREE.PointsMaterial({
      color: 0xe2ddd6, size: 0.34, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    g.add(puffs);
    g.userData.update = (t: number) => {
      const arr = puffGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const life = (t * 0.11 + seed[i]) % 1;
        arr[i * 3] = chimneyX + Math.sin(seed[i] * 30 + t * 0.6) * (0.06 + life * 0.42) + life * 0.55;
        arr[i * 3 + 1] = chimneyMouthY + 0.1 + life * 2.1;
        arr[i * 3 + 2] = -d * 0.08 + Math.cos(seed[i] * 24 + t * 0.5) * (0.05 + life * 0.3);
      }
      puffGeo.attributes.position.needsUpdate = true;
      puffs.material.opacity = 0.5 + Math.sin(t * 0.9) * 0.07;
    };
  }
  return markShadows(g);
};
