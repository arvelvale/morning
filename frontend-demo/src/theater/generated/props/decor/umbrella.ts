/**
 * 雨伞（手持）：params.closed 切换收拢/撑开两态。
 * 原点 = J 型柄握持点（heldBy 吸附后伞自然在手上方展开）。
 */
import * as THREE from "three";
import { mat, flatMat, hexNum, type PropBuilder } from "../shared";

export const buildUmbrella: PropBuilder = (p) => {
  const g = new THREE.Group();
  const cloth = mat("fabric", hexNum(p.color, 0xc4653f));
  const dark = flatMat(hexNum(p.color, 0xa85536), 0.74);
  const wood = mat("wood", 0x6a4a30);
  const closed = p.closed === true;

  // 伞杆（自握点向上）；J 型钩在握点下方
  const shaftLen = closed ? 0.3 : 0.42;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, shaftLen, 6), wood);
  shaft.position.y = shaftLen / 2;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), wood);
  hook.rotation.z = Math.PI;                       // J 型：开口朝上的半钩，翻转成朝下
  hook.position.y = 0;
  hook.rotation.y = Math.PI / 2;
  g.add(shaft, hook);

  if (closed) {
    // 收拢：伞布束成细长锥（顶端粗、尖端细）+ 顶尖 + 束带
    const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.014, 0.78, 7), cloth);
    sheath.position.y = shaftLen + 0.34;
    sheath.castShadow = true;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 6), dark);
    tip.position.y = shaftLen + 0.77;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.01, 6, 10), dark);
    band.rotation.x = Math.PI / 2;
    band.position.y = shaftLen + 0.62;
    g.add(sheath, tip, band);
  } else {
    // 撑开：八角伞面（浅锥）+ 伞骨 + 顶尖
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.24, 8), cloth);
    canopy.position.y = shaftLen + 0.32;
    canopy.castShadow = true;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 6), dark);
    tip.position.y = shaftLen + 0.46;
    g.add(canopy, tip);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.56, 4), dark);
      rib.rotation.z = Math.PI / 2 - 0.36;
      rib.rotation.y = a;
      rib.position.set(Math.sin(a) * 0.26, shaftLen + 0.36, Math.cos(a) * 0.26);
      g.add(rib);
    }
  }
  return g;
};
