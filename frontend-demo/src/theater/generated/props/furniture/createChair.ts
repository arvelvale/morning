/** 木椅几何本体：从 utils.ts 迁入（座面 y0.42±，靠背 -z，就坐面朝 +z）。 */
import * as THREE from "three";

/** 木椅（餐桌/通用）。原点贴地。 */
export function createChair({ color = 0x6b4a30 }: { color?: number } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.44), mat);
  seat.position.y = 0.42;
  seat.userData.supportSurface = true;
  g.add(seat);
  // Open spindle back keeps the seated silhouette readable.
  for (const x of [-.19, 0, .19]) {
    const spindle = new THREE.Mesh(new THREE.BoxGeometry(.035, .46, .035), mat);
    spindle.position.set(x, .7, -.2);
    g.add(spindle);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(.44, .075, .055), mat);
  rail.position.set(0, .9325, -.2);
  g.add(rail);
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
  ([[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const).forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(x, 0.21, z);
    g.add(leg);
  });
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}
