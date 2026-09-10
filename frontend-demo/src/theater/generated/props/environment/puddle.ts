/** 地面水洼：不规则扁多边形（厚 0.004，微浮于地面防 z-fighting），冷调低粗糙映天光。 */
import * as THREE from "three";
import { mat, numOf, type PropBuilder } from "../shared";

export const buildPuddle: PropBuilder = (p) => {
  const g = new THREE.Group();
  const r = numOf(p.size, 0.5);
  const geo = new THREE.CircleGeometry(r, 10);
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const jitter = 0.78 + Math.abs(Math.sin(a * 2.7) * 0.3) + Math.abs(Math.sin(a * 5.3 + 1.2)) * 0.14;
    pos.setX(i, pos.getX(i) * jitter);
    pos.setY(i, pos.getY(i) * jitter);
  }
  geo.computeVertexNormals();
  // 低粗糙 + 轻：映出天空的冷调（无 envmap，以颜色和高光近似反射感）
  const water = new THREE.MeshStandardMaterial({
    color: 0x7f97ad, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.85,
  });
  const surface = new THREE.Mesh(geo, water);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.004;
  g.add(surface);
  return g;
};
