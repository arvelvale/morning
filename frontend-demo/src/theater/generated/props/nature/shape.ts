/** 自然物件的小工具：按顶点位置抖动（相同位置的重复顶点抖得一样，不会裂缝）+ 顶点色。 */
import * as THREE from "three";

const hash3 = (x: number, y: number, z: number, seed: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1414) * 43758.5453;
  return v - Math.floor(v);
};

/** 沿径向把每个顶点推出/拉进 ±amp（相对半径），让正多面体变成「手捏」的团块。 */
export function jitterRadial(geo: THREE.BufferGeometry, amp: number, seed: number) {
  const p = geo.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (hash3(Math.round(v.x * 1000), Math.round(v.y * 1000), Math.round(v.z * 1000), seed) - 0.5) * 2 * amp;
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 顶点色：朝上的面混入 top 色（苔藓 / 受光），朝下偏深。base 为底色。 */
export function paintByNormal(geo: THREE.BufferGeometry, base: number, top: number, topAmount = 0.5) {
  const n = geo.index ? geo.toNonIndexed() : geo.clone(); n.computeVertexNormals();
  const nor = n.getAttribute("normal"), col: number[] = [];
  const b = new THREE.Color(base), t = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i < nor.count; i++) {
    const up = THREE.MathUtils.clamp(nor.getY(i), -1, 1);
    c.copy(b).lerp(t, Math.max(0, up) * topAmount).multiplyScalar(0.82 + 0.18 * (up * 0.5 + 0.5));
    col.push(c.r, c.g, c.b);
  }
  n.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return n;
}

/** 顶点色材质（每个物件私有，随资产一起释放）。 */
export function vertexColorMaterial(roughness = 0.95) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness, flatShading: true });
}
