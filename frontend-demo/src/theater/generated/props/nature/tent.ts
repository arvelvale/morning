/** Open A-frame tent: ridge along X, entrance +X, interior floor remains y=0. */
import * as THREE from 'three';
import { mat, hexNum, markShadows, type PropBuilder } from '../shared';

export const buildTent: PropBuilder = (p) => {
  const g = new THREE.Group();
  const cloth = mat('fabric', hexNum(p.color, 0xc46a3a)).clone();
  cloth.userData = {}; // private material is disposed with the asset
  cloth.side = THREE.DoubleSide;
  const vertices = [
    -1.3,0,-1.15, 1.3,0,-1.15, 1.3,1.6,0, -1.3,0,-1.15, 1.3,1.6,0, -1.3,1.6,0,
    -1.3,1.6,0, 1.3,1.6,0, 1.3,0,1.15, -1.3,1.6,0, 1.3,0,1.15, -1.3,0,1.15,
    -1.3,0,-1.15, -1.3,1.6,0, -1.3,0,1.15,
    1.3,0,-1.15, 1.3,0,-.76, 1.3,1.6,0,
    1.3,0,.76, 1.3,0,1.15, 1.3,1.6,0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, cloth));
  const trim = mat('fabric', 0xe4c09b);
  const seam = (a: number[], b: number[]) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, delta.length(), 5), trim);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
    g.add(mesh);
  };
  for (const x of [-1.3, 1.3]) for (const z of [-1.15, 1.15]) seam([x,.015,z], [x,1.6,0]);
  seam([-1.3,1.6,0], [1.3,1.6,0]);
  return markShadows(g);
};
