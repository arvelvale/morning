/**
 * 头部：蛋形头骨（下颌收窄）+ 耳朵 + 鼻子 + 脖子，以及四种发型。
 * 坐标系：头的中心为原点，+z 朝前，+y 朝上；尺寸以「成人头」为单位，类型的头部缩放由外层 group 统一乘。
 * 五官都按头骨表面算好位置（faceSurfaceZ），不会再有「眼睛一半陷进头里」。
 */
import * as THREE from 'three';
import { ellipsoid, mergePieces, mix, place, shade, taper, type Piece } from './geo';
import type { FigureHair } from './presets';

export const HEAD = { rx: .225, ry: .235, rz: .212 };

/** 下颌收窄系数：y<0 时逐渐往里收，头骨从球变成蛋。 */
const jaw = (y: number) => (y < 0 ? 1 - .24 * Math.pow(Math.min(1, -y / HEAD.ry), 1.7) : 1);

/** 头骨表面在 (x,y) 处的 z。 */
export function faceSurfaceZ(x: number, y: number) {
  const k = jaw(y), u = x / (HEAD.rx * k), v = y / HEAD.ry;
  return HEAD.rz * k * Math.sqrt(Math.max(0, 1 - u * u - v * v));
}

function skullGeometry() {
  const g = ellipsoid(HEAD.rx, HEAD.ry, HEAD.rz, 20, 14);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = jaw(p.getY(i));
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  g.computeBoundingSphere();
  return g;   // 法线沿用椭球法线：下颌变形很小，平滑过渡更干净
}

/** 皮肤部分：头骨 + 耳 + 鼻 + 脖子。 */
export function buildHeadSkin(skin: number): Piece[] {
  const ear = shade(skin, .95), nose = mix(skin, 0xf0a090, .16);
  return [
    { geo: skullGeometry(), color: skin, top: .06 },
    { geo: ellipsoid(.026, .044, .02, 6, 5), color: ear, matrix: place(-HEAD.rx * .985, -.02, .004, 0, 0, .12) },
    { geo: ellipsoid(.026, .044, .02, 6, 5), color: ear, matrix: place(HEAD.rx * .985, -.02, .004, 0, 0, -.12) },
    { geo: ellipsoid(.017, .016, .017, 6, 5), color: nose, matrix: place(0, -.05, faceSurfaceZ(0, -.05) + .004) },
    { geo: taper(.054, .06, .14, 12), color: shade(skin, .96), matrix: place(0, -.235, -.012) },
  ];
}

/** 发帽：包住头顶的椭球壳，前额/两侧/后脑各按自己的发际线裁掉下缘。
 *  前额的发际线是一条「侧分扫过去」的曲线（左低右高）+ 轻微起伏，所以不需要再堆刘海小球，轮廓干净。 */
function hairCap(color: number): Piece {
  const rx = HEAD.rx * 1.075, ry = HEAD.ry * 1.06, rz = HEAD.rz * 1.085;
  const g = new THREE.SphereGeometry(1, 24, 9, 0, Math.PI * 2, 0, Math.PI * .8);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const smooth = (e0: number, e1: number, x: number) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.max(.0001, Math.hypot(x, z)), c = z / h, s = x / h;            // c: 1 前 / 0 侧 / -1 后；s: -1 左 … 1 右
    const fringe = THREE.MathUtils.lerp(.19, .46, smooth(-.9, .75, s)) + .03 * Math.sin(s * 8.5 + .6);
    const edge = c > 0 ? THREE.MathUtils.lerp(-.2, fringe, Math.pow(c, 1.3)) : THREE.MathUtils.lerp(-.2, -.56, Math.pow(-c, 1.1));
    if (y < edge) {
      const r2 = Math.sqrt(Math.max(.0004, 1 - edge * edge));
      x = (x / h) * r2; z = (z / h) * r2; y = edge;
    }
    p.setXYZ(i, x * rx, y * ry, z * rz);
  }
  // 法线按最终位置的椭球梯度重算：裁边后的顶点仍落在椭球面上，明暗是连续的
  for (let i = 0; i < n.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nn = new THREE.Vector3(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
    n.setXYZ(i, nn.x, nn.y, nn.z);
  }
  return { geo: g, color, top: .55 };
}

export function buildHair(style: FigureHair, color: number, accent = 0xd9604f): Piece[] {
  const dark = shade(color, .82);
  const out: Piece[] = [hairCap(color)];
  const sideLock = (side: number, len: number, y: number) => ({
    geo: ellipsoid(.034, len, .066, 7, 5), color, top: .4, matrix: place(side * (HEAD.rx * 1.0), y, .018, 0, 0, side * -.05),
  });
  if (style === 'long') {
    out.push(sideLock(-1, .15, -.14), sideLock(1, .15, -.14));
    out.push({ geo: ellipsoid(.215, .27, .115, 10, 7), color, top: .5, matrix: place(0, -.2, -.105) });
    out.push({ geo: ellipsoid(.17, .2, .095, 9, 6), color: dark, top: .3, matrix: place(0, -.46, -.11) });
  } else if (style === 'ponytail') {
    out.push(sideLock(-1, .07, -.04), sideLock(1, .07, -.04));
    out.push({ geo: ellipsoid(.2, .13, .085, 10, 6), color, top: .4, matrix: place(0, -.13, -.15) });
    out.push({ geo: new THREE.TorusGeometry(.04, .014, 4, 10), color: accent, matrix: place(0, .06, -.235, Math.PI / 2 - .5, 0, 0) });
    out.push({ geo: ellipsoid(.052, .16, .052, 7, 6), color, top: .5, matrix: place(0, -.07, -.3, .62, 0, 0) });
    out.push({ geo: ellipsoid(.04, .1, .04, 6, 5), color: dark, top: .3, matrix: place(0, -.2, -.385, .85, 0, 0) });
  } else if (style === 'bun') {
    out.push(sideLock(-1, .07, -.04), sideLock(1, .07, -.04));
    out.push({ geo: ellipsoid(.2, .12, .08, 10, 6), color, top: .4, matrix: place(0, -.1, -.15) });
    out.push({ geo: ellipsoid(.105, .1, .1, 9, 7), color, top: .6, matrix: place(0, .24, -.12) });
    out.push({ geo: new THREE.TorusGeometry(.085, .012, 4, 12), color: accent, matrix: place(0, .2, -.12, Math.PI / 2, 0, 0) });
  } else {
    // 短发：发帽两侧压在耳上沿，只补后脑一圈，轮廓干净，耳朵露出来
    out.push({ geo: ellipsoid(.2, .13, .09, 10, 6), color, top: .4, matrix: place(0, -.1, -.145) });
  }
  return out;
}

export { mergePieces };
