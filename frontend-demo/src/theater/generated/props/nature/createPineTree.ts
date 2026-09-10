/** 松树几何本体：多层锥冠 + 顶点扰动/锯齿下垂底缘 + 随机旋转 + 上浅下深色阶。 */
import * as THREE from "three";

/**
 * 对锥体底圈顶点做径向扰动 + 交替下垂（锯齿伞状缘），打破"规则漏斗"。
 * 按位置识别底圈；Three 的圆锥包含重复锥尖、侧面接缝和端盖，不能假设索引布局。
 */
function roughenCone(geo: THREE.ConeGeometry, rand: () => number) {
  const pos = geo.attributes.position;
  const bottomY = -geo.parameters.height / 2;
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(pos.getY(i) - bottomY) > .00001 || Math.hypot(x, z) < .00001) continue;
    const a = Math.atan2(z, x);
    const jitter = 1 + Math.sin(a * 3 + phase) * .12; // 重复顶点同角同变换，避免开缝
    pos.setX(i, x * jitter);
    pos.setZ(i, z * jitter);
    // 锯齿下垂：按角度奇偶交替把底缘拉低，形成伞状锯齿
    const droop = (.035 + .025 * Math.cos(a * 4 + phase)) * geo.parameters.height;
    pos.setY(i, bottomY - droop);
  }
  geo.computeVertexNormals();
}

/** 低多边形松树。原点贴地。 */
export function createPineTree({ height = 3.5, color = 0x14301e }: { height?: number; color?: number } = {}) {
  const g = new THREE.Group();
  const rand = (() => {
    // 以树高为种子的确定性随机：同参数的树形态一致，不同树姿态各异
    let s = Math.floor(height * 977) % 233280;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  })();
  const c = new THREE.Color(color);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, height * 0.32, 7), trunkMat);
  trunk.position.y = height * 0.16;
  g.add(trunk);

  // 三~四层锥冠：逐层缩小、向上提亮、随机 Y 旋转、底缘锯齿下垂
  const layers = 3 + (rand() > 0.55 ? 1 : 0);
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1);
    const r = height * 0.31 * (1 - t * 0.62);
    const layerC = c.clone()
      .lerp(new THREE.Color(0x6a8a52), .12 + t * .25)   // 上层更亮更暖
      .offsetHSL(0, 0, (rand() - 0.5) * 0.03);
    const geo = new THREE.ConeGeometry(r, height * 0.46, 7);
    roughenCone(geo, rand);
    const cone = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: layerC.getHex(), roughness: 0.95, flatShading: true,
    }));
    cone.rotation.y = rand() * Math.PI;                // 每层随机朝向，打破轴对称
    cone.position.y = height * (0.24 + i * (0.66 / layers)) + height * 0.02;
    cone.castShadow = true;
    g.add(cone);
  }
  // 底部灌木裙
  const skirt = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.16, height * 0.12, 8),
    new THREE.MeshStandardMaterial({ color: c.clone().offsetHSL(0, -0.05, 0.04).getHex(), roughness: 1, flatShading: true })
  );
  skirt.position.y = height * 0.06;
  g.add(skirt);
  return g;
}
