import * as THREE from 'three';
import type { FigurePose } from './presets';
import { ellipsoid, mergePieces, mix, place, type Piece } from './geo';
import { faceSurfaceZ } from './head';

/**
 * 脸：大一点的黑亮眼睛 + 高光、眉毛、小嘴、腮红；表情只由「导演写好的动作」决定，不替人物猜情绪。
 * 五种表情：attentive（专注）/ gentle（温和）/ speaking（说话）/ downcast（低落，哭泣时带泪）。
 * 眨眼只改眼睛的 scale.y，不改拓扑。
 */
export function createFace(pose: FigurePose, headScale: number, opts: { skin?: number; glasses?: boolean } = {}) {
  const skin = opts.skin ?? 0xe8c8a8;
  const face = new THREE.Group();
  face.name = 'face';
  face.scale.setScalar(headScale);
  const crying = pose === 'crying';
  const sad = crying || pose === 'headDown';
  const speaking = pose === 'arguing';
  const smile = ['waving', 'comforting', 'hugging', 'handingItem'].includes(pose);
  face.userData.expression = sad ? 'downcast' : speaking ? 'speaking' : smile ? 'gentle' : 'attentive';

  const ink = new THREE.MeshStandardMaterial({ color: 0x2a2024, roughness: .3 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });

  // ── 眼睛（单独 mesh，眨眼用）──
  const eyes: THREE.Mesh[] = [];
  const EX = .077, EY = -.014;
  for (const side of [-1, 1]) {
    const ez = faceSurfaceZ(side * EX, EY);
    const eye = new THREE.Mesh(ellipsoid(1, 1, 1, 9, 7), ink);
    eye.name = side < 0 ? 'eye-left' : 'eye-right';
    eye.position.set(side * EX, EY, ez + .002);
    eye.rotation.y = side * Math.asin(THREE.MathUtils.clamp(EX / .23, 0, 1));
    const bigger = smile ? .9 : sad ? .92 : 1;
    eye.scale.set(.021 * bigger, .031 * bigger, .012);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(1, 5, 4), white);
    shine.position.set(.28, .36, .9); shine.scale.set(.3, .22, .3);
    eye.add(shine);
    face.add(eye); eyes.push(eye);
  }

  // ── 眉、嘴、腮红、泪（静态片，各合一个 mesh）──
  const pieces: Piece[] = [], cheeks: Piece[] = [], mouthP: Piece[] = [];
  const brow = 0x4a3a34;
  const tilt = sad ? -.38 : smile ? .12 : speaking ? .2 : .06;      // 内侧抬高（低落）/外侧上扬（温和）
  for (const side of [-1, 1]) {
    const bx = side * (EX + .004), by = EY + .066;
    pieces.push({ geo: ellipsoid(.034, .0075, .007, 6, 4), color: brow, matrix: place(bx, by + (sad ? .008 : 0), faceSurfaceZ(bx, by) + .004, 0, side * .3, side * -tilt) });
  }
  const blush = mix(skin, 0xf27d78, .55);
  for (const side of [-1, 1]) {
    const cx = side * .125, cy = -.06;
    cheeks.push({ geo: ellipsoid(.03, .017, .006, 6, 4), color: blush, matrix: place(cx, cy, faceSurfaceZ(cx, cy) + .001, 0, side * .62, side * .06) });
    if (crying) {
      const tx = side * .092, ty = -.075;
      cheeks.push({ geo: ellipsoid(.009, .026, .006, 5, 4), color: 0xa9d6ff, matrix: place(tx, ty, faceSurfaceZ(tx, ty) + .006, 0, side * .42, 0) });
    }
  }
  const MY = -.112, mz = faceSurfaceZ(0, MY) + .003;
  const lip = 0x8a4a4a;
  if (speaking) mouthP.push({ geo: ellipsoid(.019, .022, .008, 8, 6), color: 0x6e2a30, matrix: place(0, MY - .004, mz) });
  else if (smile) mouthP.push({ geo: new THREE.TorusGeometry(.03, .0052, 4, 10, Math.PI), color: lip, matrix: place(0, MY + .014, mz, 0, 0, Math.PI) });
  else if (sad) mouthP.push({ geo: new THREE.TorusGeometry(.02, .0048, 4, 8, Math.PI), color: lip, matrix: place(0, MY - .006, mz) });
  else mouthP.push({ geo: new THREE.TorusGeometry(.017, .0046, 4, 8, Math.PI), color: lip, matrix: place(0, MY + .008, mz, 0, 0, Math.PI) });
  face.add(new THREE.Mesh(mergePieces(pieces), vc));
  face.add(new THREE.Mesh(mergePieces(cheeks), vc));
  face.add(new THREE.Mesh(mergePieces(mouthP), vc));

  if (opts.glasses) {
    const gl: Piece[] = [];
    for (const side of [-1, 1]) {
      const gx = side * EX, gz = faceSurfaceZ(gx, EY) + .026;
      gl.push({ geo: new THREE.TorusGeometry(.056, .0048, 4, 14), color: 0x3a3030, matrix: place(gx, EY, gz) });
      gl.push({ geo: ellipsoid(.004, .004, .105, 4, 4), color: 0x3a3030, matrix: place(side * .19, EY + .005, gz - .1, 0, side * -.06, 0) });
    }
    gl.push({ geo: ellipsoid(.024, .0045, .0045, 6, 4), color: 0x3a3030, matrix: place(0, EY + .008, faceSurfaceZ(0, EY) + .028) });
    face.add(new THREE.Mesh(mergePieces(gl), vc));
  }

  // 眨眼：只改 scale.y；低落时眼睛半睁，不眨
  const phase = Math.random() * 4;
  const base = eyes.map((e) => e.scale.y);
  return { group: face, update(t: number) {
    if (sad) return;
    const cycle = ((t + phase) % 4.6 + 4.6) % 4.6;
    const blink = cycle < .16 ? 1 - Math.sin(cycle / .16 * Math.PI) * .9 : 1;
    eyes.forEach((eye, i) => { eye.scale.y = base[i] * blink; });
  } };
}
