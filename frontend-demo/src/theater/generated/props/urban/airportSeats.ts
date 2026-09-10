/** 候机排椅（n 联）：金属座面 + 扶手分隔 + 共享横梁腿。 */
import * as THREE from "three";
import { mat, hexNum, numOf, markShadows, type PropBuilder } from "../shared";

export const buildAirportSeats: PropBuilder = (p) => {
  const row = new THREE.Group();
  const frame = mat("metal", hexNum(p.color, 0x5a6a7a));
  const n = Math.max(1, Math.round(numOf(p.seats, 4)));
  const beam = new THREE.Mesh(new THREE.BoxGeometry((n - 1) * 0.65 + 0.6, 0.08, 0.3), frame);
  beam.position.set(0, 0.12, 0);
  row.add(beam);
  for (let i = 0; i < n; i++) {
    const x = i * 0.65;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.5), frame);
    seat.position.set(x, 0.45, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.06), frame);
    back.position.set(x, 0.72, -0.24); back.rotation.x = -0.15;
    // 扶手：每座之间立柱 + 横臂
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), frame);
    armPost.position.set(x + 0.325, 0.56, 0);
    const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.42), frame);
    armBar.position.set(x + 0.325, 0.64, 0);
    row.add(seat, back, armPost, armBar);
  }
  row.position.x = -((n - 1) * 0.65) / 2;
  return markShadows(row);
};
