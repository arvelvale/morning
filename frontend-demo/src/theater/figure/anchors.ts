import * as THREE from 'three';
import { createFigure, type CreateFigureOptions } from './index';

/** Same posed skeleton as the renderer. Cache only numbers, never live scene objects. */
export function measureFigureAnchors(options: CreateFigureOptions) {
  const fig = createFigure({ ...options, externalHandProp: true, seatContactEnabled: true });
  fig.updateMatrixWorld(true);
  const hand = fig.userData.handAnchor as THREE.Object3D;
  const bounds = new THREE.Box3().setFromObject(fig);
  const result = {
    box: { hw: (bounds.max.x - bounds.min.x) / 2, hd: (bounds.max.z - bounds.min.z) / 2,
      cx: (bounds.max.x + bounds.min.x) / 2, cz: (bounds.max.z + bounds.min.z) / 2,
      minY: bounds.min.y, h: bounds.max.y - bounds.min.y, top: bounds.max.y },
    contactY: (fig.userData.seatAnchor as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y,
    hand: hand.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
    handQuaternion: hand.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number],
  };
  // Figure owns these resources; unlike prop materials these are not globally shared.
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  fig.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const m of ([] as THREE.Material[]).concat(mesh.material ?? [])) materials.add(m);
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  return result;
}
