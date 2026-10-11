/**
 * 躯干 / 衣服 / 手臂 / 腿 / 鞋：每个函数只管自己那一块，返回「带颜色的片」，
 * 由 index.ts 这位「总调度」按 pivot（髋、肩、肘、膝）装配。
 * 约定：y 以世界高度（站姿）书写，进 upper 的部件统一减 HIP_Y。
 */
import * as THREE from 'three';
import { ellipsoid, lathe, mix, place, shade, taper, type Piece } from './geo';
import { HIP_Y } from './presets';
import type { FigureOutfit } from './presets';

const Y = (wy: number) => wy - HIP_Y;

export interface Colors { cloth: number; skin: number; trouser: number; shoe: number; sole: number; accent: number }

/** 躯干轮廓（半径, 世界 y），从下往上。 */
const PROFILE: Record<FigureOutfit, [number, number][]> = {
  casual: [[0, .575], [.150, .575], [.178, .6], [.19, .66], [.172, .78], [.16, .88], [.178, 1.0], [.192, 1.1], [.2, 1.16], [.17, 1.225], [.105, 1.27], [.06, 1.3], [0, 1.305]],
  uniform: [[0, .52], [.17, .52], [.19, .58], [.19, .7], [.17, .82], [.175, .95], [.19, 1.08], [.2, 1.16], [.17, 1.225], [.105, 1.27], [.06, 1.3], [0, 1.305]],
  coat: [[0, .40], [.205, .40], [.235, .46], [.215, .6], [.19, .78], [.172, .86], [.185, .98], [.198, 1.1], [.205, 1.16], [.17, 1.225], [.105, 1.27], [.06, 1.3], [0, 1.305]],
  skirt: [[0, .64], [.17, .64], [.172, .72], [.158, .84], [.172, .96], [.19, 1.08], [.2, 1.16], [.17, 1.225], [.105, 1.27], [.06, 1.3], [0, 1.305]],
};
const radiusAt = (outfit: FigureOutfit, wy: number) => {
  const pts = PROFILE[outfit];
  for (let i = 1; i < pts.length; i++) if (wy <= pts[i][1]) {
    const [r0, y0] = pts[i - 1], [r1, y1] = pts[i]; return r0 + (r1 - r0) * ((wy - y0) / Math.max(1e-6, y1 - y0));
  }
  return pts[pts.length - 1][0];
};

export function buildTorso(outfit: FigureOutfit, w: number, c: Colors): Piece[] {
  const zs = w * .8;                                           // 躯干前后更薄
  const body = lathe(PROFILE[outfit].map(([r, y]) => [r, Y(y)] as [number, number]), 16, w, zs);
  const zf = (wy: number) => radiusAt(outfit, wy) * zs;         // 该高度的前表面 z
  const white = 0xf3efe6, dark = 0x2d2628;
  const out: Piece[] = [{ geo: body, color: c.cloth, top: .26 }];
  const ring = (R: number, tube: number, wy: number, color: number) => ({
    geo: new THREE.TorusGeometry(R, tube, 4, 14), color, matrix: place(0, Y(wy), -.004, Math.PI / 2, 0, 0, w, zs / 1, 1),
  });
  if (outfit === 'casual') {
    out.push({ geo: lathe([[.153, Y(.575)], [.181, Y(.6)], [.196, Y(.655)], [.194, Y(.662)]], 16, w, zs), color: shade(c.cloth, .78) });
    out.push(ring(.083, .017, 1.253, mix(c.cloth, 0xffffff, .22)));
  } else if (outfit === 'uniform') {
    out.push({ geo: lathe([[.172, Y(.52)], [.192, Y(.58)], [.196, Y(.62)], [.194, Y(.628)]], 16, w, zs), color: shade(c.cloth, .72) });
    out.push({ geo: ellipsoid(.058, .12, .03, 6, 5), color: white, matrix: place(0, Y(1.12), zf(1.12) - .004, -.06, 0, 0) });
    for (const s of [-1, 1]) out.push({ geo: ellipsoid(.052, .024, .02, 5, 4), color: white, matrix: place(s * .052, Y(1.235), zf(1.235) - .002, .1, s * -.3, s * .55) });
    out.push({ geo: ellipsoid(.018, .09, .013, 5, 5), color: c.accent, matrix: place(0, Y(1.075), zf(1.075) + .006, -.06, 0, 0) });
    out.push({ geo: ellipsoid(.027, .03, .013, 5, 5), color: c.accent, matrix: place(0, Y(1.17), zf(1.17) + .006, 0, 0, 0) });
    for (const wy of [.86, .75]) out.push({ geo: ellipsoid(.014, .014, .008, 5, 4), color: dark, matrix: place(0, Y(wy), zf(wy) + .003) });
  } else if (outfit === 'coat') {
    out.push({ geo: new THREE.CylinderGeometry(1, 1, .05, 16, 1), color: shade(c.cloth, .6), matrix: place(0, Y(.855), 0, 0, 0, 0, .181 * w, 1, .181 * zs) });
    for (const s of [-1, 1]) out.push({ geo: ellipsoid(.048, .12, .02, 6, 5), color: shade(c.cloth, .8), matrix: place(s * .056, Y(1.11), zf(1.11) - .002, 0, s * -.2, s * .3) });
    for (const wy of [.98, .76, .6]) out.push({ geo: ellipsoid(.015, .015, .009, 5, 4), color: dark, matrix: place(0, Y(wy), zf(wy) + .004) });
    out.push(ring(.1, .03, 1.275, c.cloth));
    out.push({ geo: new THREE.TorusGeometry(.112, .042, 6, 14), color: c.accent, top: .3, matrix: place(0, Y(1.325), -.004, Math.PI / 2, 0, 0, 1, .92, 1) });
    out.push({ geo: ellipsoid(.052, .17, .024, 6, 5), color: c.accent, top: .2, matrix: place(.06, Y(1.17), zf(1.2) + .014, -.1, 0, -.14) });
    out.push({ geo: ellipsoid(.045, .12, .02, 6, 5), color: shade(c.accent, .82), matrix: place(-.04, Y(1.2), zf(1.2) + .028, -.12, 0, .2) });
  } else {
    // 连衣裙的上身：圆领白领口 + 腰间浅色束带
    out.push(ring(.116, .02, 1.245, white));
    out.push({ geo: new THREE.CylinderGeometry(1, 1, .04, 16, 1), color: mix(c.cloth, 0xffffff, .38), matrix: place(0, Y(.845), 0, 0, 0, 0, .162 * w, 1, .162 * zs) });
    out.push({ geo: ellipsoid(.03, .022, .012, 5, 4), color: mix(c.cloth, 0xffffff, .2), matrix: place(0, Y(.845), zf(.845) + .006) });
  }
  return out;
}

/** 连衣裙的裙摆（独立 mesh：坐姿时压平到大腿上）；中心在原点，高 .34。 */
export function buildSkirt(cloth: number): Piece[] {
  return [
    { geo: lathe([[.168, .17], [.205, .09], [.27, -.04], [.335, -.165]], 18), color: cloth, top: .25 },
    { geo: lathe([[.331, -.125], [.336, -.17], [.34, -.17]], 18), color: mix(cloth, 0xffffff, .3) },
  ];
}

/** 手臂：肩 → 上臂 → 肘 → 前臂 → 手。每段是一个旋转体（肩头/肘头的圆润直接长在里面，没有接缝），返回各自 pivot 本地坐标里的片。 */
export function buildArm(outfit: FigureOutfit, c: Colors, side: 1 | -1) {
  const short = outfit === 'skirt';
  const sleeve = c.cloth;
  const cuffColor = outfit === 'uniform' ? 0xf3efe6 : outfit === 'coat' ? shade(c.cloth, .6) : mix(c.cloth, 0xffffff, .22);
  // 上臂：肩头圆帽 + 渐细
  const full: [number, number][] = [[0, .056], [.03, .052], [.05, .038], [.061, .014], [.064, -.012], [.06, -.045], [.056, -.12], [.051, -.2], [.049, -.262], [0, -.262]];
  const upper: Piece[] = short
    ? [
      { geo: lathe([[0, .056], [.03, .052], [.05, .038], [.061, .014], [.064, -.012], [.061, -.04], [.059, -.105], [0, -.105]], 10), color: sleeve, top: .3 },
      { geo: lathe([[0, -.095], [.054, -.1], [.051, -.2], [.049, -.262], [0, -.262]], 10), color: c.skin },
    ]
    : [{ geo: lathe(full, 10), color: sleeve, top: .3 }];
  // 前臂：肘头 + 渐细到手腕
  const fore: Piece[] = [
    { geo: lathe([[0, .05], [.032, .045], [.049, .02], [.05, -.01], [.047, -.06], [.043, -.15], [.039, -.21], [0, -.21]], 10), color: short ? c.skin : sleeve },
  ];
  if (!short) fore.push({ geo: taper(.0415, .0415, .018, 10), color: cuffColor, matrix: place(0, -.2, 0) });
  const hand: Piece[] = [
    { geo: ellipsoid(.036, .052, .027, 8, 6), color: c.skin, top: .08, matrix: place(0, -.262, .004) },
    { geo: ellipsoid(.014, .03, .014, 5, 4), color: c.skin, matrix: place(side * -.03, -.245, .022, 0.35, 0, side * .32) },
  ];
  return { upper, fore, hand };
}

/** 腿：髋 → 大腿 → 膝 → 小腿 → 鞋。大腿/小腿同样是带圆头的旋转体。 */
export function buildLeg(outfit: FigureOutfit, c: Colors, side: 1 | -1) {
  const bare = outfit === 'skirt';
  const leg = bare ? c.skin : c.trouser;
  const thigh: Piece[] = [
    { geo: lathe([[0, .095], [.045, .088], [.08, .062], [.092, .02], [.09, -.05], [.082, -.15], [.071, -.24], [.066, -.285], [0, -.285]], 10), color: leg, top: .1 },
  ];
  const shin: Piece[] = [
    { geo: lathe([[0, .066], [.035, .058], [.058, .03], [.064, 0], [.062, -.05], [.056, -.15], [.05, -.22], [.047, -.26], [0, -.26]], 10), color: leg },
  ];
  if (bare) shin.push({ geo: taper(.05, .052, .05, 10), color: 0xf3efe6, matrix: place(0, -.215, 0) });
  else shin.push({ geo: taper(.051, .056, .035, 10), color: shade(c.trouser, .82), matrix: place(0, -.255, 0) });
  const shoe: Piece[] = [
    { geo: ellipsoid(.07, .05, .128, 10, 7), color: c.shoe, top: .3, matrix: place(0, -.236, .056, -.04, side * .03, 0) },
    { geo: ellipsoid(.073, .016, .135, 10, 4), color: c.sole, matrix: place(0, -.268, .058) },
  ];
  return { thigh, shin, shoe };
}

export function buildBackpack(accent = 0xc47a3a): Piece[] {
  const strap = shade(accent, .7);
  const out: Piece[] = [
    { geo: ellipsoid(.16, .2, .09, 10, 7), color: accent, top: .3, matrix: place(0, Y(.98), -.205) },
    { geo: ellipsoid(.1, .07, .05, 7, 5), color: shade(accent, .86), matrix: place(0, Y(.86), -.27) },
  ];
  for (const s of [-1, 1]) out.push({ geo: ellipsoid(.026, .17, .016, 6, 6), color: strap, matrix: place(s * .105, Y(1.08), .135, .12, 0, s * .06) });
  return out;
}
