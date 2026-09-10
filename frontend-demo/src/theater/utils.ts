/**
 * theater 共享工具件（TS 类型版）：
 * 星空/月亮/远山/树木/地面/木椅等低多边形通用组件，全部程序化建模。
 */
import * as THREE from "three";

/** 夜空背景穹顶：三段渐变（天顶→中天→地平线）+ 可选太阳方位暖光加成。 */
export function createSkyDome({
  top = 0x0a1024, bottom = 0x1a2340, mid, horizon, sunDir, sunGlowStrength = 0, sunTint = 0xffa050,
}: {
  top?: number; bottom?: number;
  /** 中天/地平线色（缺省由 bottom 派生，兼容旧双色调用）。 */
  mid?: number; horizon?: number;
  /** 太阳方向（世界系归一前即可），用于地平线一侧的晚霞加成。 */
  sunDir?: [number, number, number];
  sunGlowStrength?: number; sunTint?: number;
} = {}) {
  const cBottom = new THREE.Color(bottom);
  const cMid = mid !== undefined ? new THREE.Color(mid) : cBottom.clone().lerp(new THREE.Color(top), 0.45);
  const cHorizon = horizon !== undefined ? new THREE.Color(horizon) : cBottom.clone().offsetHSL(0, 0.02, 0.1);
  const geo = new THREE.SphereGeometry(120, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      midColor: { value: cMid },
      horizonColor: { value: cHorizon },
      sunDir: { value: new THREE.Vector3(...(sunDir ?? [0.4, 0.15, 0.9])).normalize() },
      glowStrength: { value: sunGlowStrength },
      sunTint: { value: new THREE.Color(sunTint) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor, midColor, horizonColor, sunTint;
      uniform vec3 sunDir;
      uniform float glowStrength;
      varying vec3 vPos;
      void main() {
        vec3 dir = normalize(vPos);
        float h = dir.y;
        // 三段暮色：地平线暖金 → 中天霞色 → 天顶暮紫
        vec3 col = mix(horizonColor, midColor, smoothstep(-0.02, 0.22, h));
        col = mix(col, topColor, smoothstep(0.2, 0.72, h));
        // 太阳方位的晚霞加成：越靠近太阳方向、越贴地平线越暖
        float toward = pow(max(dot(dir, normalize(sunDir)), 0.0), 3.0);
        col += sunTint * toward * glowStrength * (1.0 - clamp(abs(h) * 1.4, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** 星空（Points，带轻微闪烁） */
export function createStars({ count = 900, radius = 110 }: { count?: number; radius?: number } = {}) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // 只分布在上半球
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85 + 0.12);
    const r = radius * (0.9 + Math.random() * 0.1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float phase;
      uniform float time;
      varying float vAlpha;
      void main() {
        vAlpha = 0.55 + 0.45 * sin(time * 0.8 + phase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.6 + 1.2 * sin(time * 0.5 + phase * 2.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(0.9, 0.93, 1.0, vAlpha * (1.0 - d * 1.6));
      }`,
  });
  const stars = new THREE.Points(geo, mat);
  stars.userData.update = (t: number) => { mat.uniforms.time.value = t; };
  return stars;
}

/** 月亮（发光盘 + 光晕） */
export function createMoon({ size = 4, color = 0xf5eeda, distance = 90, height = 45, angle = 0 }: {
  size?: number; color?: number; distance?: number; height?: number; angle?: number;
} = {}) {
  const g = new THREE.Group();
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(size, 32),
    new THREE.MeshBasicMaterial({ color, fog: false })
  );
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(size * 2.2, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, fog: false })
  );
  halo.position.z = -0.5;
  g.add(moon, halo);
  g.position.set(Math.sin(angle) * distance, height, -Math.cos(angle) * distance);
  g.lookAt(0, height * 0.3, 0);
  return g;
}

/** 太阳：径向衰减 shader（核心暖白 → 边缘橙晕 → 大范围柔光），彻底告别硬边同心圆。 */
export function createSun({ size = 5, color = 0xfff2c8, distance = 95, height = 40, angle = 0, haloOpacity = 0.16 }: {
  size?: number; color?: number; distance?: number; height?: number; angle?: number; haloOpacity?: number;
} = {}) {
  const g = new THREE.Group();
  const glow = new THREE.Color(color).offsetHSL(0.02, 0.15, -0.08);   // 晕色比核心更橙
  // 单张大尺寸面片内画「核心 + 内晕 + 大气泛光」三段径向衰减，加法混合融进天空
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      coreColor: { value: new THREE.Color(0xfff6dc) },
      glowColor: { value: new THREE.Color(glow) },
      intensity: { value: 0.55 + haloOpacity * 2.4 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 coreColor, glowColor;
      uniform float intensity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;                 // 0 中心 → 1 边缘
        float core = smoothstep(0.30, 0.24, d);            // 太阳本体（软边）
        float innerGlow = exp(-d * 3.2) * 0.75;            // 贴日强晕
        float skyGlow = exp(-d * 1.05) * 0.22;             // 大范围大气泛光
        vec3 col = coreColor * core + glowColor * (innerGlow + skyGlow);
        float a = clamp(core + (innerGlow + skyGlow) * 0.85, 0.0, 1.0) * intensity;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(size * 7, size * 7), mat);
  g.add(disc);
  g.position.set(Math.sin(angle) * distance, height, -Math.cos(angle) * distance);
  g.lookAt(0, height * 0.3, 0);
  return g;
}

/**
 * 连绵远山：两层宽扁山脊带（Cylinder 开口扇段 + 顶缘起伏置换），替代陡峭锥体。
 * 远层色向天空底色偏移（空气透视），配合 mood 雾形成"越远越淡"。
 * 接口兼容旧调用（color/count/radius）。
 */
export function createMountains({ color = 0x101a2e, count = 7, radius = 72 }: {
  color?: number; count?: number; radius?: number;
} = {}) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const skyTint = new THREE.Color(0x8a7490);          // 空气透视的统一远景灰紫
  const mkRidge = (
    r: number, h: number, col: THREE.Color, seed: number, thetaStart: number, thetaLen: number,
  ) => {
    const geo = new THREE.CylinderGeometry(r, r, h, 64, 1, true, thetaStart, thetaLen);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < h / 2 - 0.01) continue;                  // 只置换顶缘
      const a = Math.atan2(pos.getX(i), pos.getZ(i));
      const ridge =
        0.5 + 0.5 * Math.sin(a * 3.1 + seed) * 0.55 +
        0.5 * Math.sin(a * 7.7 + seed * 2.3) * 0.3 +
        0.5 * Math.sin(a * 13.7 + seed * 4.1) * 0.15;
      pos.setY(i, h / 2 * (0.18 + 0.82 * THREE.MathUtils.clamp(ridge, 0, 1)));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: col.getHex(), side: THREE.BackSide, fog: true })
    );
    m.position.y = 0;
    return m;
  };
  // 扇段覆盖相机常驻的 +z 半圆略多，避免侧转露馅
  const thetaStart = -Math.PI * 0.15, thetaLen = Math.PI * 1.3;
  // 远层：更淡（混天空色）、更高远
  g.add(mkRidge(radius * 1.35, 9.5, c.clone().lerp(skyTint, 0.62), 1.7, thetaStart, thetaLen));
  // 近层：本色略沉
  g.add(mkRidge(radius * 1.08, 6.5, c.clone().lerp(skyTint, 0.3), 4.2, thetaStart + 0.25, thetaLen));
  // 保留 count 参数语义：不再使用（山脊连续无峰数概念），仅为兼容签名
  void count;
  return g;
}

/** 地面 */
export function createGround({ color = 0x1c2733, size = 200 }: { color?: number; size?: number } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(size, 48), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/**
 * 注：具体的正式组件（木椅 createChair、松树 createPineTree）已迁入
 * generated/props/furniture/createChair.ts 与 generated/props/nature/createPineTree.ts，
 * 本文件只保留天空/地面/星月山太阳等纯环境底层件。
 */
