import * as THREE from 'three';
import type { FigurePose } from './presets';

/** Five small silhouettes; expression follows the authored action, never inferred emotion. */
export function createFace(pose: FigurePose, headScale: number) {
  const face = new THREE.Group();
  face.name = 'face';
  face.scale.setScalar(headScale);
  const sad = pose === 'crying' || pose === 'headDown';
  const speaking = pose === 'arguing';
  const smile = ['waving', 'comforting', 'hugging', 'handingItem'].includes(pose);
  face.userData.expression = sad ? 'downcast' : speaking ? 'speaking' : smile ? 'gentle' : 'attentive';
  const ink = new THREE.MeshStandardMaterial({ color: 0x342c29, roughness: .9 });
  const eyes: THREE.Mesh[] = [];
  const eyeGeo = sad
    ? new THREE.TorusGeometry(.024, .005, 4, 8, Math.PI)
    : new THREE.SphereGeometry(1, 8, 6);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, ink);
    eye.name = side < 0 ? 'eye-left' : 'eye-right';
    // Outside the head surface (r=.19); the old eyes partly disappeared inside it.
    eye.position.set(side * .065, .015, .181);
    eye.rotation.y = side * .34;
    if (sad) eye.rotation.z = Math.PI;
    else eye.scale.set(.015, .022, .007);
    face.add(eye);
    eyes.push(eye);
  }
  const mouth = new THREE.Mesh(
    smile || sad ? new THREE.TorusGeometry(.018, .004, 4, 8, Math.PI) : new THREE.SphereGeometry(1, 8, 6), ink,
  );
  mouth.name = 'mouth';
  mouth.position.set(0, -.057, .184);
  if (smile) mouth.rotation.z = Math.PI;
  if (!smile && !sad) mouth.scale.set(speaking ? .015 : .012, speaking ? .019 : .004, .004);
  face.add(mouth);
  const cheeks = new THREE.MeshStandardMaterial({ color: 0xd99d8b, roughness: 1 });
  const cheekGeo = new THREE.SphereGeometry(1, 8, 4);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, cheeks);
    cheek.position.set(side * .105, -.029, .16);
    cheek.rotation.y = side * .58;
    cheek.scale.set(.024, .012, .004);
    face.add(cheek);
  }
  // Geometry is allocated once. A brief blink changes only scale, not face topology.
  const phase = Math.random() * 4;
  return { group: face, update(t: number) {
    if (sad) return;
    const cycle = ((t + phase) % 4.6 + 4.6) % 4.6;
    const blink = cycle < .16 ? 1 - Math.sin(cycle / .16 * Math.PI) * .9 : 1;
    for (const eye of eyes) eye.scale.y = .022 * blink;
  } };
}
