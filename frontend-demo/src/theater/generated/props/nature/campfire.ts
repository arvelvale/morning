/**
 * 篝火：三层 stylized 火焰（橙→橙黄→亮黄白，加法混合）+ 余烬闪烁 + 火星粒子
 * + 围石圈 + 暖色实用光（近场聚焦）。逐帧动画挂 userData.update。
 */
import * as THREE from "three";
import { mat, hexNum, type PropBuilder } from "../shared";

export const buildCampfire: PropBuilder = (p) => {
  const g = new THREE.Group();

  // ── 围石圈：八颗压扁石头，篝火"落位"在地面 ──
  const stone = mat("stone", 0x6a645a);   // 略提亮基色，靠火光照出体积
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), stone);
    st.scale.set(1, 0.6, 0.85);
    st.position.set(Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62);
    st.rotation.y = a;
    st.castShadow = true;
    g.add(st);
  }

  // ── 木柴交叉搭 ──
  const logMat = new THREE.MeshStandardMaterial({ color: hexNum(p.logColor, 0x4a3220), roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 5) * Math.PI;
    log.position.y = 0.1;
    g.add(log);
  }

  // ── 余烬：木柴间几颗呼吸的暗红发光点 ──
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a22 });
  const embers: THREE.Mesh[] = [];
  ([[-0.16, 0.1], [0.12, -0.06], [0.02, 0.16], [-0.05, -0.14]] as const).forEach(([x, z]) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), emberMat);
    e.position.set(x, 0.12, z);
    embers.push(e);
    g.add(e);
  });

  // ── 三层火焰：外橙 / 中橙黄 / 内亮黄白，加法混合在夜色里自然发光 ──
  interface FlameLayer {
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    baseScale: THREE.Vector3; phase: number; sway: number;
  }
  const mkFlame = (
    radius: number, height: number, color: number, opacity: number,
    yOff: number, rot: number, phase: number, sway: number,
  ): FlameLayer => {
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.LatheGeometry([
      [0, -.5], [.7, -.4], [1, -.15], [.64, .08], [.3, .32], [0, .5],
    ].map(([r, y]) => new THREE.Vector2(r * radius, y * height)), 7), m);
    mesh.position.y = yOff;
    mesh.rotation.y = rot;
    g.add(mesh);
    return { mesh, mat: m, baseScale: mesh.scale.clone(), phase, sway };
  };
  const flames = [
    mkFlame(0.34, 0.95, 0xff6a1a, 0.72, 0.62, 0.0, 0.0, 0.055),    // 外层橙
    mkFlame(0.22, 0.72, 0xffaa33, 0.85, 0.55, 2.1, 1.7, 0.075),    // 中层橙黄
    mkFlame(0.12, 0.5, 0xffe9a8, 0.95, 0.5, 4.2, 3.1, 0.09),       // 内层亮黄白
  ];

  // ── 暖色实用光：近场聚焦（低高度 + 缓衰减），投石圈/木柴/近处人物 ──
  const fireLight = new THREE.PointLight(0xff8844, 2.6, 15, 1.15);
  // 性能预算：点光影=6面 cubemap 每帧，成本远超收益——投影交给 mood key light
  fireLight.castShadow = false;
  fireLight.position.y = 0.6;
  g.add(fireLight);
  // 火心微光：很小的第二光源补火焰内部的亮核（无阴影，成本可忽略）
  const coreLight = new THREE.PointLight(0xffc873, 0.9, 4.5, 1.4);
  coreLight.position.y = 0.45;
  g.add(coreLight);

  // ── 火星/余烬粒子：小而暖，加法混合，上升+水平收敛摆动+循环 ──
  const sparkCount = 20;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(sparkCount * 3);
  const seed = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) seed[i] = Math.random();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffcc66, size: 0.045, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  g.add(sparks);

  g.userData.update = (t: number) => {
    // 三层火焰：各自相位的脉动缩放 + 顶部摆动（外层摆幅小更稳，内层跳动大）
    for (const f of flames) {
      const s = Math.sin(t * 9 + f.phase) * 0.5 + Math.sin(t * 21 + f.phase * 2.3) * 0.3 + Math.sin(t * 4.7 + f.phase) * 0.2;
      f.mesh.scale.set(
        f.baseScale.x * (1 + s * 0.14 + f.sway * 0.3),
        f.baseScale.y * (1 + s * 0.24),
        f.baseScale.z * (1 + s * 0.14 + f.sway * 0.3),
      );
      f.mesh.position.x = Math.sin(t * 2.6 + f.phase) * f.sway;
      f.mesh.position.z = Math.cos(t * 2.1 + f.phase * 1.4) * f.sway * 0.7;
      f.mesh.rotation.y = f.phase + t * .24;            // same t, same pose regardless of frame rate
    }
    // 余烬呼吸
    embers.forEach((e, i) => {
      const k = 0.75 + 0.25 * Math.sin(t * 3.1 + i * 1.9);
      e.scale.setScalar(k);
    });
    // 光强随火焰脉动
    const flick = Math.sin(t * 9) * 0.5 + Math.sin(t * 21 + 1.3) * 0.3 + Math.sin(t * 5 + 0.6) * 0.2;
    fireLight.intensity = 2.6 + flick * 0.55;
    coreLight.intensity = 0.9 + flick * 0.2;
    // 火星：从火心升起，水平正弦摆动，越升越散，到顶循环
    const pos = sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < sparkCount; i++) {
      const life = (t * 0.32 + seed[i]) % 1;
      const spread = 0.1 + life * 0.45;
      pos[i * 3] = Math.sin(seed[i] * 40 + t * 1.4) * spread;
      pos[i * 3 + 1] = 0.35 + life * 1.9;
      pos[i * 3 + 2] = Math.cos(seed[i] * 31 + t * 1.1) * spread;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  };
  return g;
};
