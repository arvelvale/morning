/**
 * 人物几何小工具：所有部件先做成「带颜色的片」，同一个 pivot 下的片合并成一个 mesh（顶点色），
 * 这样细节多了，mesh 数反而更少，也不需要给每块布料单独建材质。
 */
import * as THREE from 'three';

export interface Piece {
  geo: THREE.BufferGeometry;
  color: number | THREE.Color;
  /** 用来摆放这片的矩阵（先于合并烘进顶点）。 */
  matrix?: THREE.Matrix4;
  /** 顶部受光强调：>0 时朝上的面更亮（头发、肩头的体积感）。 */
  top?: number;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _n = new THREE.Vector3(), _col = new THREE.Color();

/** 位置 + 欧拉角 + 缩放 → 矩阵。 */
export function place(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
}

/** 椭球：半径 rx/ry/rz。 */
export function ellipsoid(rx: number, ry: number, rz: number, w = 10, h = 7, phiStart = 0, phiLen = Math.PI * 2, thStart = 0, thLen = Math.PI) {
  const g = new THREE.SphereGeometry(1, w, h, phiStart, phiLen, thStart, thLen);
  g.scale(rx, ry, rz);
  return g;
}

/** 锥形圆柱（沿 y，顶 rTop 底 rBot，中心在原点）。 */
export function taper(rTop: number, rBot: number, h: number, seg = 10, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
}

/** 旋转体：points 为 [半径, y]（从下往上）；x/z 方向可分别缩放（躯干更薄）。 */
export function lathe(points: [number, number][], seg = 18, sx = 1, sz = 1) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(sx, 1, sz);
  return g;
}

/**
 * 把若干片合成一个几何：烘进矩阵与顶点色。
 * 顶点色 = 片的颜色 × (1 + top × 法线朝上的程度)，让头发/肩头有被头顶光照亮的感觉，却不增加任何灯光。
 */
export function mergePieces(pieces: Piece[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const piece of pieces) {
    let g = piece.geo.index ? piece.geo.toNonIndexed() : piece.geo.clone();
    if (piece.matrix) g.applyMatrix4(piece.matrix);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    _col.set(piece.color as THREE.ColorRepresentation);
    const top = piece.top ?? 0;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      _n.set(n.getX(i), n.getY(i), n.getZ(i));
      nor.push(_n.x, _n.y, _n.z);
      const k = 1 + top * Math.max(-.4, _n.y);
      col.push(Math.min(1, _col.r * k), Math.min(1, _col.g * k), Math.min(1, _col.b * k));
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/** 颜色乘一个系数（做深/浅一档）。 */
export function shade(color: number, k: number): number {
  _col.set(color); _col.multiplyScalar(k); return _col.getHex();
}

/** 两个颜色混合。 */
export function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

