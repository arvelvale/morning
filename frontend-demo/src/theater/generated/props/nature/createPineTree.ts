/** 松树：粗树干 + 4~5 层逐层收窄的锥冠（底缘做成星形锯齿并微微下垂）+ 上浅下深的色阶。原点贴地。 */
import * as THREE from "three";
import { jitterRadial } from "./shape";

/** 底圈顶点：偶数角外扩、奇数角内收 + 下垂，做出一圈圈松针的层次。 */
function scallop(geo: THREE.ConeGeometry, sides: number, phase: number) {
  const pos = geo.attributes.position, bottomY = -geo.parameters.height / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(pos.getY(i) - bottomY) > 1e-5 || Math.hypot(x, z) < 1e-5) continue;
    const a = Math.atan2(z, x), k = Math.round((a - phase) / ((Math.PI * 2) / sides));
    const out = k % 2 === 0;
    pos.setX(i, x * (out ? 1.1 : 0.84)); pos.setZ(i, z * (out ? 1.1 : 0.84));
    pos.setY(i, bottomY - (out ? 0.06 : 0.0) * geo.parameters.height);
  }
  geo.computeVertexNormals();
}

export function createPineTree({ height = 3.5, color = 0x14301e }: { height?: number; color?: number } = {}) {
  const g = new THREE.Group();
  const rand = (() => {
    let s = Math.floor(height * 977) % 233280;       // 以树高为种子：同参数形态一致
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  })();
  const c = new THREE.Color(color);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.028, height * 0.045, height * 0.3, 7), trunkMat);
  trunk.position.y = height * 0.15;
  trunk.castShadow = true;
  g.add(trunk);

  const tiers = 4 + (rand() > 0.5 ? 1 : 0);
  const y0 = height * 0.16, span = height - y0, tierH = span * 0.42;
  const R = height * 0.3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = R * (1 - t * 0.7), h = tierH * (1 - t * 0.12);
    const bottom = y0 + (span - tierH) * t;
    const layerC = c.clone().lerp(new THREE.Color(0x6f9456), 0.08 + t * 0.3).offsetHSL((rand() - 0.5) * 0.01, 0, (rand() - 0.5) * 0.025);
    const geo = new THREE.ConeGeometry(r, h, 8);
    const phase = rand() * Math.PI;
    scallop(geo, 8, phase);
    jitterRadial(geo, 0.03, 40 + i);
    const cone = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: layerC.getHex(), roughness: 0.95, flatShading: true }));
    cone.position.y = bottom + h / 2;
    cone.rotation.y = phase;
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}
