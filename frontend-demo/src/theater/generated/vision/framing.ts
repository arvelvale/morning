import * as THREE from 'three';
import type { TheaterCamera } from '../../types';

export interface SceneFraming {
  subjects: THREE.Object3D[];
  actors: THREE.Object3D[];
  obstacles: THREE.Object3D[];
}

/** Fit real subject bounds, not the sky/ground, at the renderer's actual aspect/FOV.
 * Only runs at scene/viewport changes. Never fights a user's orbit during playback.
 */
export function frameSubjects(input: TheaterCamera, framing: SceneFraming, aspect: number, fov = 50): TheaterCamera {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return input;
  const boxes = framing.subjects.map(o => new THREE.Box3().setFromObject(o)).filter(b => !b.isEmpty());
  if (!boxes.length) return input;
  const bounds = boxes.reduce((b, next) => b.union(next), new THREE.Box3());
  const center = bounds.getCenter(new THREE.Vector3());
  const corners: THREE.Vector3[] = [];
  for (const b of boxes) for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    corners.push(new THREE.Vector3(x, y, z));
  }
  const offset = new THREE.Vector3(...input.pos).sub(new THREE.Vector3(...input.look));
  const spherical = new THREE.Spherical().setFromVector3(offset.lengthSq() ? offset : new THREE.Vector3(4, 2, 5));
  spherical.phi = THREE.MathUtils.clamp(spherical.phi, .35, 1.4);
  const camera = new THREE.PerspectiveCamera(fov, aspect, .1, 400);
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // NDC ±.76 leaves 12% on each edge, including breathing/arm motion allowance.
  const limit = .76;
  const rays = new THREE.Raycaster();
  const targets = framing.actors.flatMap(o => {
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    return [.55, .85].map(k => new THREE.Vector3(c.x, b.min.y + (b.max.y - b.min.y) * k, c.z));
  });
  let best: TheaterCamera = input, bestScore = Infinity;
  for (const angle of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const direction = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, spherical.phi, spherical.theta + angle));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    let distance = 2;
    for (const point of corners) {
      const v = point.clone().sub(center), depth = v.dot(direction);
      distance = Math.max(distance, depth + Math.abs(v.dot(right)) / (tanY * aspect * limit), depth + Math.abs(v.dot(up)) / (tanY * limit));
    }
    distance += .2;
    const pos = center.clone().addScaledVector(direction, distance);
    camera.position.copy(pos); camera.lookAt(center); camera.updateMatrixWorld(true);
    let blocked = 0;
    for (const target of targets) {
      const ray = target.clone().sub(pos);
      rays.set(pos, ray.clone().normalize()); rays.far = Math.max(0, ray.length() - .12);
      if (rays.intersectObjects(framing.obstacles, true).some(hit => {
        const material = (hit.object as THREE.Mesh).material;
        return material && ([] as THREE.Material[]).concat(material).some(m => m.visible && (!m.transparent || m.opacity > .5));
      })) blocked++;
    }
    const score = blocked * 100 + Math.abs(angle) + distance * .001;
    if (score < bestScore) { bestScore = score; best = { pos: pos.toArray() as [number, number, number], look: center.toArray() as [number, number, number] }; }
    if (blocked === 0 && angle === 0) break;
  }
  return best;
}
