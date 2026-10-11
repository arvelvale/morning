/** Open A-frame tent: ridge along X, entrance +X, interior floor remains y=0.
 *  帐篷：两面屋顶明暗交替 + 深色内衬与地布 + 门框缝线 + 四根拉绳与地钉 + 门前小垫。 */
import * as THREE from 'three';
import { mat, hexNum, markShadows, type PropBuilder } from '../shared';

export const buildTent: PropBuilder = (p) => {
  const g = new THREE.Group();
  const base = new THREE.Color(hexNum(p.color, 0xc46a3a));
  const vertices = [
    -1.3,0,-1.15, 1.3,0,-1.15, 1.3,1.6,0, -1.3,0,-1.15, 1.3,1.6,0, -1.3,1.6,0,
    -1.3,1.6,0, 1.3,1.6,0, 1.3,0,1.15, -1.3,1.6,0, 1.3,0,1.15, -1.3,0,1.15,
    -1.3,0,-1.15, -1.3,1.6,0, -1.3,0,1.15,
    1.3,0,-1.15, 1.3,0,-.76, 1.3,1.6,0,
    1.3,0,.76, 1.3,0,1.15, 1.3,1.6,0,
  ];
  // 每个三角形一个明暗系数：左屋顶 1.0，右屋顶 0.86，后墙 0.78，前脸两侧 0.94
  const tone = [1.0, 1.0, 0.86, 0.86, 0.78, 0.94, 0.94];
  const colors: number[] = [];
  tone.forEach((k, tri) => { const c = base.clone().multiplyScalar(k); for (let v = 0; v < 3; v++) colors.push(c.r, c.g, c.b); void tri; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  g.add(new THREE.Mesh(geo, cloth));

  // 内衬 + 地布：从门口看进去是深色的，不再透出外面的地
  const inner = new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 1, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.58, 2.28), inner);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.012; floor.receiveShadow = true;
  g.add(floor);

  const trim = mat('fabric', 0xe4c09b);
  const rope = mat('fabric', 0xd9c7a0);
  const stakeMat = mat('wood', 0x7a5a3a);
  const seam = (a: number[], b: number[], r = 0.015, m: THREE.Material = trim) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, delta.length(), 5), m);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    g.add(mesh);
  };
  for (const x of [-1.3, 1.3]) for (const z of [-1.15, 1.15]) seam([x, .015, z], [x, 1.6, 0]);
  seam([-1.3, 1.6, 0], [1.3, 1.6, 0], 0.022);
  // 门框缝线
  seam([1.305, .015, -.76], [1.305, 1.6, 0], 0.012); seam([1.305, .015, .76], [1.305, 1.6, 0], 0.012);
  // 四根拉绳 + 地钉：前后脊端各一根、两侧屋顶中段各一根
  const stake = (x: number, z: number, rz: number) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), stakeMat);
    s.position.set(x, 0.07, z); s.rotation.z = rz; g.add(s);
  };
  seam([1.3, 1.6, 0], [2.35, 0.06, 0], 0.007, rope); stake(2.35, 0, 0.5);
  seam([-1.3, 1.6, 0], [-2.35, 0.06, 0], 0.007, rope); stake(-2.35, 0, -0.5);
  seam([0, 0.82, -0.58], [0, 0.06, -1.85], 0.007, rope); stake(0, -1.85, 0);
  seam([0, 0.82, 0.58], [0, 0.06, 1.85], 0.007, rope); stake(0, 1.85, 0);
  // 门前小垫
  const mathe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.025, 0.95), mat('fabric', 0x5a4636));
  mathe.position.set(1.75, 0.013, 0); mathe.receiveShadow = true; g.add(mathe);
  return markShadows(g);
};
