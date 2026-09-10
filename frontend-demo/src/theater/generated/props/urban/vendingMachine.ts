/**
 * 自动贩卖机（第二批规范重构）：0.9×0.7×1.8 倒角柜体 + 凹陷发光展示窗
 * （3 排彩色饮料瓶阵列）+ 取物口 + 投币口发光贴片 + 向前冷白环境光。
 */
import * as THREE from "three";
import { mat, flatMat, hexNum, type PropBuilder } from "../shared";

export const buildVendingMachine: PropBuilder = (p) => {
  const g = new THREE.Group();
  const bodyMat = flatMat(hexNum(p.body, 0x2c3a44), 0.55);
  const W = 0.9, H = 1.8, D = 0.7;

  // 柜体 + 竖向棱线条（倒角观感）
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bodyMat);
  body.position.y = H / 2;
  body.castShadow = true;
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, H, 0.03), flatMat(0x1f2a33, 0.55));
    edge.position.set(sx * (W / 2 - 0.015), H / 2, D / 2 - 0.015);
    g.add(edge);
  }
  g.add(body);

  // 凹陷展示窗：深色内框 + 强自发光背板 + 3 排饮料瓶
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.86, 0.04), flatMat(0x1a222a, 0.5));
  winFrame.position.set(-0.02, 1.22, D / 2 - 0.01);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.74),
    mat("emissive", 0xe0f7fa, { emissive: 0xe0f7fa, emissiveIntensity: 0.95 })
  );
  glow.position.set(-0.02, 1.22, D / 2 + 0.012);
  g.add(winFrame, glow);
  const bottleTones = [0xd85a4a, 0x4a8ad8, 0xe0a83a, 0x5aba8a, 0xc86ac8, 0xe0e0d0];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const tone = bottleTones[(row * 4 + col) % bottleTones.length];
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.11, 8),
        new THREE.MeshStandardMaterial({ color: tone, roughness: 0.35, flatShading: true })
      );
      bottle.position.set(-0.24 + col * 0.145, 1.02 + (2 - row) * 0.21, D / 2 + 0.028);
      g.add(bottle);
    }
  }

  // 取物口（深色凹槽）+ 投币/刷卡发光小贴片
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.03), flatMat(0x14181c, 0.8));
  slot.position.set(-0.05, 0.42, D / 2 + 0.005);
  const coin = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.12),
    mat("emissive", 0xfff3e0, { emissive: 0xfff3e0, emissiveIntensity: 0.7 })
  );
  coin.position.set(0.3, 1.28, D / 2 + 0.012);
  g.add(slot, coin);

  // 向前冷白环境光（打亮面前角色）
  const light = new THREE.PointLight(0xd8ecff, 0.9, 2.6, 1.4);
  light.position.set(0, 1.15, D / 2 + 0.35);
  light.castShadow = false;
  g.add(light);
  return g;
};
