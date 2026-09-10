/**
 * 模块化直跑楼梯：5 级（每级高 0.15 / 深 0.3，宽 1.0，总高 0.75）。
 * 每级为全高 Box → 侧视封闭阶梯轮廓、底面平；两端可堆叠拼接。
 * 台阶面混凝土明暗分块交替。
 */
import * as THREE from "three";
import { flatMat, numOf, markShadows, type PropBuilder } from "../shared";

export const buildStairs: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = numOf(p.width, 1.0);
  const stepH = 0.15, stepD = 0.3, steps = numOf(p.steps, 5);

  for (let i = 0; i < steps; i++) {
    const h = stepH * (i + 1);
    // 全高箱体（阶梯轮廓封闭）+ 踏步面板微出檐
    const block = new THREE.Mesh(new THREE.BoxGeometry(W, h, stepD), flatMat(i % 2 === 0 ? 0x9a968c : 0x918d84, 0.9));
    block.position.set(0, h / 2, -(i + 0.5) * stepD);
    block.receiveShadow = true;
    const tread = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.025, stepD + 0.02), flatMat(0xa8a49a, 0.85));
    tread.position.set(0, h - 0.012, -(i + 0.5) * stepD);
    tread.receiveShadow = true;
    g.add(block, tread);
  }
  return markShadows(g);
};
