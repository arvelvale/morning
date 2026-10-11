/** 岩石：细分过的二十面体 + 径向抖动 + 压扁，受光面带一点苔绿；旁边一两颗小石子。 */
import * as THREE from "three";
import { hexNum, numOf, type PropBuilder } from "../shared";
import { jitterRadial, paintByNormal, vertexColorMaterial } from "./shape";

export const buildRock: PropBuilder = (p) => {
  const g = new THREE.Group();
  const s = numOf(p.size, 0.5);
  const base = hexNum(p.color, 0x6b6660);
  const material = vertexColorMaterial();
  const moss = new THREE.Color(base).lerp(new THREE.Color(0x6f8a52), 0.45).getHex();
  const mk = (r: number, sx: number, sy: number, sz: number, seed: number, x: number, y: number, z: number, ry: number) => {
    const geo = jitterRadial(new THREE.IcosahedronGeometry(r, 1), 0.16, seed);
    geo.scale(sx, sy, sz);
    const m = new THREE.Mesh(paintByNormal(geo, base, moss, 0.55), material);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  };
  mk(s, 1.18, 0.72, 0.92, 3, 0, s * 0.42, 0, 0.3);
  mk(s * 0.42, 1, 0.75, 0.9, 9, s * 0.95, s * 0.16, s * 0.35, 1.1);
  mk(s * 0.25, 1, 0.7, 1, 14, -s * 0.8, s * 0.1, s * 0.6, 2.2);
  return g;
};
