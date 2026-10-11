/**
 * theater 共享工具件（TS 类型版）：
 * 星空/月亮/远山/树木/地面/木椅等低多边形通用组件，全部程序化建模。
 */
import * as THREE from "three";

/**
 * 可平铺的分形噪声纹理（256²，单通道放在 RGBA 里）。云在着色器里只采样它，
 * 不再在片元里用 sin 哈希现算噪声——手机 GPU 的低精度会把噪声算成一格一格的色块。
 */
let _cloudTex: THREE.DataTexture | null = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number, o: number) => {
    let h = (x * 374761393 + y * 668265263 + o * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  const octaves = [[4, 0.5], [8, 0.25], [16, 0.125], [32, 0.0625]] as const;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, tot = 0;
    octaves.forEach(([L, amp], o) => {
      const px = (x / N) * L, py = (y / N) * L, ix = Math.floor(px), iy = Math.floor(py);
      let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = ix % L, x1 = (ix + 1) % L, y0 = iy % L, y1 = (iy + 1) % L;     // 取模 → 无缝平铺
      const a = hash(x0, y0, o), b = hash(x1, y0, o), c = hash(x0, y1, o), d = hash(x1, y1, o);
      v += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy); tot += amp;
    });
    const k = Math.round(255 * Math.min(1, Math.max(0, v / tot)));
    const i = (y * N + x) * 4; data[i] = data[i + 1] = data[i + 2] = k; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  _cloudTex = tex; return tex;
}

/** 云层参数：color 受光面、shade 背光面、amount 0~1 覆盖量（0 无云）。 */
export interface SkyClouds { color: number; shade: number; amount: number }

/** 天空穹顶：三段渐变（天顶→中天→地平线）+ 太阳方位晚霞加成 + 软边云层（慢慢飘）。 */
export function createSkyDome({
  top = 0x0a1024, bottom = 0x1a2340, mid, horizon, sunDir, sunGlowStrength = 0, sunTint = 0xffa050, clouds,
}: {
  top?: number; bottom?: number;
  /** 中天/地平线色（缺省由 bottom 派生，兼容旧双色调用）。 */
  mid?: number; horizon?: number;
  /** 太阳方向（世界系归一前即可），用于地平线一侧的晚霞加成。 */
  sunDir?: [number, number, number];
  sunGlowStrength?: number; sunTint?: number;
  clouds?: SkyClouds;
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
      cloudColor: { value: new THREE.Color(clouds?.color ?? 0xffffff) },
      cloudShade: { value: new THREE.Color(clouds?.shade ?? 0xc8d4e4) },
      cloudAmount: { value: clouds?.amount ?? 0 },
      cloudTex: { value: clouds && clouds.amount > 0 ? cloudTexture() : null },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor, midColor, horizonColor, sunTint, cloudColor, cloudShade;
      uniform vec3 sunDir;
      uniform float glowStrength, cloudAmount, time;
      uniform sampler2D cloudTex;
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
        // 云：把方向投影到一张平面上做分形噪声，阈值切出软边的云团；错位采样一次得到受光/背光两档
        if (cloudAmount > 0.001 && h > 0.0) {
          vec2 uv = dir.xz / (h + 0.3) * 0.34 + vec2(time * 0.0035, time * 0.001);
          float n = texture2D(cloudTex, uv).r * 0.8 + texture2D(cloudTex, uv * 2.7 + 0.37).r * 0.2;
          float thr = 0.60 - cloudAmount * 0.17;
          float cov = smoothstep(thr, thr + 0.12, n);
          // 云越厚越亮、边缘偏背光色；再用云层本身的高度（越靠近天顶越暗）做明暗，避免对噪声求导带来的格子感
          float body = smoothstep(thr, thr + 0.34, n);
          vec3 cc = mix(cloudShade, cloudColor, clamp(0.25 + 0.75 * body - 0.35 * h, 0.0, 1.0));
          cc += sunTint * toward * glowStrength * 0.35;           // 晚霞时云边被染暖
          float fade = smoothstep(0.015, 0.16, h) * (1.0 - 0.6 * smoothstep(0.6, 0.95, h));
          col = mix(col, cc, cov * fade);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.userData.update = (t: number) => { mat.uniforms.time.value = t; };
  return dome;
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

/** 月亮：软边圆盘 + 淡淡的月海斑块 + 径向衰减的光晕（一张面片、加法混合，不再有一圈硬边灰盘）。 */
export function createMoon({ size = 4, color = 0xf5eeda, distance = 90, height = 45, angle = 0 }: {
  size?: number; color?: number; distance?: number; height?: number; angle?: number;
} = {}) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { moonColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 moonColor; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p) * 3.2;                           // 1.0 = 月亮边缘（面片是月亮的 3.2 倍宽）
        float disc = smoothstep(1.0, 0.94, d);
        // 月海：几块略暗的斑
        float maria = smoothstep(0.34, 0.0, length(p * 3.2 - vec2(-0.28, 0.2))) * 0.12
                    + smoothstep(0.26, 0.0, length(p * 3.2 - vec2(0.3, -0.12))) * 0.1
                    + smoothstep(0.2, 0.0, length(p * 3.2 - vec2(-0.05, -0.4))) * 0.08;
        vec3 col = moonColor * disc * (1.0 - maria);
        float glow = exp(-max(d - 0.9, 0.0) * 2.2) * 0.22 + exp(-d * 0.9) * 0.1;   // 贴月强晕 + 大范围泛光
        col += moonColor * glow * (1.0 - disc);
        float a = clamp(disc + glow, 0.0, 1.0) * smoothstep(3.2, 2.0, d);
        gl_FragColor = vec4(col, a);
      }`,
  });
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(size * 3.2 * 2, size * 3.2 * 2), mat));
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
export function createMountains({ color = 0x101a2e, count = 7, radius = 72, haze }: {
  color?: number; count?: number; radius?: number;
  /** 山脚融入的雾色（缺省用统一的远景灰紫）：山顶本色、山脚淡入雾里，不再是一块硬边色带。 */
  haze?: number;
} = {}) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const skyTint = new THREE.Color(0x8a7490);          // 空气透视的统一远景灰紫
  const hazeC = new THREE.Color(haze ?? 0x8a7490);
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
        0.5 + 0.5 * Math.sin(a * 3 + seed) * 0.55 +
        0.5 * Math.sin(a * 8 + seed * 2.3) * 0.3 +
        0.5 * Math.sin(a * 13 + seed * 4.1) * 0.15;      // 频率取整数：绕一整圈首尾能严丝合缝
      pos.setY(i, h / 2 * (0.18 + 0.82 * THREE.MathUtils.clamp(ridge, 0, 1)));
    }
    geo.computeVertexNormals();
    // 顶缘用本色，越往山脚越融进雾色
    const colors = new Float32Array(pos.count * 3), foot = col.clone().lerp(hazeC, 0.55);
    for (let i = 0; i < pos.count; i++) {
      const k = THREE.MathUtils.clamp((pos.getY(i) + h / 2) / h, 0, 1);
      const cc = foot.clone().lerp(col, Math.pow(k, 0.7));
      colors[i * 3] = cc.r; colors[i * 3 + 1] = cc.g; colors[i * 3 + 2] = cc.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: true })
    );
    m.position.y = 0;
    return m;
  };
  // 扇段覆盖相机常驻的 +z 半圆略多，避免侧转露馅
  const thetaStart = 0, thetaLen = Math.PI * 2;
  // 远层：更淡（混天空色）、更高远
  g.add(mkRidge(radius * 1.35, 9.5, c.clone().lerp(haze !== undefined ? hazeC : skyTint, haze !== undefined ? 0.42 : 0.62), 1.7, thetaStart, thetaLen));
  // 近层：本色略沉
  g.add(mkRidge(radius * 1.08, 6.5, c.clone().lerp(haze !== undefined ? hazeC : skyTint, haze !== undefined ? 0.16 : 0.3), 4.2, thetaStart, thetaLen));
  // 保留 count 参数语义：不再使用（山脊连续无峰数概念），仅为兼容签名
  void count;
  return g;
}

/** 低频噪声（确定性），给地面做大块的深浅色斑。 */
function patchNoise(x: number, z: number) {
  const h = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const n = (px: number, pz: number) => {
    const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    return (h(ix, iz) * (1 - ux) + h(ix + 1, iz) * ux) * (1 - uz) + (h(ix, iz + 1) * (1 - ux) + h(ix + 1, iz + 1) * ux) * uz;
  };
  return 0.55 * n(x * 0.11, z * 0.11) + 0.3 * n(x * 0.27 + 5, z * 0.27 - 3) + 0.15 * n(x * 0.7 - 9, z * 0.7 + 4);
}

/**
 * 地面：极坐标圆盘（近密远疏），顶点色做大块深浅色斑 + 近处略亮、远处略沉，不再是一张死平的纯色。
 * 活动区（半径 ~9m）保持完全水平，保证人物/家具的接地计算不受影响。
 */
export function createGround({ color = 0x1c2733, size = 200 }: { color?: number; size?: number } = {}) {
  const RINGS = 22, SEG = 56;
  // 深浅用乘法（±10%）而不是加减亮度：夜里的深色地面加减 5% 亮度就等于差了一倍
  const base = new THREE.Color(color), warm = base.clone().multiplyScalar(1.1), cool = base.clone().multiplyScalar(0.92);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const radius = size * Math.pow(r / RINGS, 2.2);
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2, x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, 0, z);
      const k = patchNoise(x, z);
      const c = cool.clone().lerp(warm, THREE.MathUtils.smoothstep(k, 0.3, 0.7));
      c.multiplyScalar(1 - 0.1 * THREE.MathUtils.smoothstep(radius, 14, 90));         // 远处略沉，雾再接手
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < RINGS; r++) for (let j = 0; j < SEG; j++) {
    const a = r * (SEG + 1) + j, b = a + SEG + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 顶点法线朝下时翻过来（索引顺序决定朝向）：保证受光面朝上
  if (geo.getAttribute("normal").getY(0) < 0) { geo.setIndex(idx.map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]])); geo.computeVertexNormals(); }
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  return ground;
}

/**
 * 地面草丛：一整块 InstancedMesh（几百簇小草，一次绘制）。
 * 只撒在活动区以外（rMin 起），颜色取地面色的亮/暗变体，偶尔一朵浅色小花。
 */
export function createTufts({ color = 0x6d7f55, count = 420, rMin = 3.4, rMax = 40, seed = 7 }: {
  color?: number; count?: number; rMin?: number; rMax?: number; seed?: number;
} = {}) {
  let s = seed * 9301 + 49297;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  // 一丛 = 三片向外微倾的窄叶（合成一个几何），整块 InstancedMesh 一次绘制
  const blade = (ang: number, lean: number, h: number) => {
    const g = new THREE.ConeGeometry(0.028, h, 3); g.translate(0, h / 2, 0);
    g.rotateZ(lean); g.rotateY(ang); return g;
  };
  const parts = [blade(0, 0.32, 0.17), blade(2.1, 0.26, 0.21), blade(4.2, 0.36, 0.15)];
  const geo = new THREE.BufferGeometry();
  const posArr: number[] = [];
  parts.forEach((g) => { const ng = g.toNonIndexed(); const pa = ng.getAttribute("position"); for (let i = 0; i < pa.count; i++) posArr.push(pa.getX(i), pa.getY(i), pa.getZ(i)); });
  geo.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3)); geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const base = new THREE.Color(color).offsetHSL(0, 0.02, 0.06), flowers = [0xf1e4cf, 0xf0b8b8, 0xf3dc92];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, r = rMin + (rMax - rMin) * Math.pow(rand(), 0.7);
    const k = 0.8 + rand() * 0.9;
    p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    e.set((rand() - 0.5) * 0.35, rand() * Math.PI, (rand() - 0.5) * 0.35);
    q.setFromEuler(e);
    sc.set(k, k * (0.8 + rand() * 0.7), k);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
    const c = rand() < 0.07 ? new THREE.Color(flowers[i % 3]) : base.clone().offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.1);
    mesh.setColorAt(i, c);
  }
  mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}

/**
 * 注：具体的正式组件（木椅 createChair、松树 createPineTree）已迁入
 * generated/props/furniture/createChair.ts 与 generated/props/nature/createPineTree.ts，
 * 本文件只保留天空/地面/星月山太阳等纯环境底层件。
 */
