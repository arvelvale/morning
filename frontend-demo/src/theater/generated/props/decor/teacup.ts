/** 茶杯：陶瓷杯体 + 杯柄 + 杯碟 + 内胆茶汤（两只对摆即对话意象）。 */
import * as THREE from "three";
import { mat, flatMat, hexNum, markShadows, type PropBuilder } from "../shared";

export const buildTeacup: PropBuilder = (p) => {
  const g = new THREE.Group();
  const ceramic = mat("ceramic", hexNum(p.color, 0xeae0d2));
  const body = new THREE.Mesh(new THREE.LatheGeometry([
    [.038, .01], [.045, .016], [.06, .085], [.06, .09], [.053, .09], [.05, .03], [.038, .025],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 12), ceramic);
  // 茶汤：深琥珀内胆，杯口微微可见
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 12), flatMat(0x7a4a20, 0.4));
  tea.position.y = 0.073;
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.012, 16), ceramic);
  saucer.position.y = 0.006;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), ceramic);
  handle.position.set(0.07, 0.05, 0); handle.rotation.y = Math.PI / 2;
  g.add(saucer, body, tea, handle);
  return markShadows(g);
};
