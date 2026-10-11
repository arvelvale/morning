/** 深夜通话 · 海边：月下海面、沙滩、坐在岸边的人（已丰富：潮线湿沙、漂流木、贝壳、渔火、薄云、手机微光） */
import * as THREE from "three";
import { createSkyDome, createStars, createMoon } from "../utils";
import { createFigure } from "../figure";
import type { TheaterScene } from "../types";

export function create(): TheaterScene {
  const group = new THREE.Group();

  const sky = createSkyDome({ top: 0x060b1c, bottom: 0x142238, clouds: { color: 0x3a4a70, shade: 0x1a2540, amount: 0.35 } });
  group.add(sky);
  const stars = createStars({ count: 1200 });
  group.add(stars);
  group.add(createMoon({ size: 5, height: 32, angle: 0 }));

  // 海面（顶点波动 + 月光反射带）
  const seaGeo = new THREE.PlaneGeometry(200, 120, 90, 50);
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 0.25 + time * 0.9) * 0.22
                + sin(p.y * 0.4 + time * 0.6) * 0.15
                + sin((p.x + p.y) * 0.15 + time * 1.3) * 0.1;
        p.z += w;
        vWave = w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.02, 0.06, 0.12);
        vec3 shallow = vec3(0.05, 0.12, 0.2);
        vec3 col = mix(deep, shallow, vUv.y + vWave * 0.5);
        // 月光反射带（沿中心、随波闪烁）
        float band = exp(-pow((vUv.x - 0.5) * 6.0, 2.0));
        float shimmer = 0.5 + 0.5 * sin(vUv.y * 120.0 + time * 2.0 + vWave * 8.0);
        col += vec3(0.85, 0.82, 0.65) * band * shimmer * (0.12 + vUv.y * 0.3);
        // 远处海平线微光
        col += vec3(0.3, 0.35, 0.5) * smoothstep(0.85, 1.0, vUv.y) * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.15, -50);
  group.add(sea);

  // 沙滩
  const sandMat = new THREE.MeshStandardMaterial({ color: 0x4a4136, roughness: 1 });
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(200, 40, 1, 1), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0, 16);
  sand.receiveShadow = true;
  group.add(sand);

  // 潮线湿沙带（近水的深色沙滩，增加岸边层次）
  const wetSand = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d352c, roughness: 0.9 })
  );
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.set(0, 0.004, 6);
  wetSand.receiveShadow = true;
  group.add(wetSand);

  // 海浪沫线（贴岸边的亮线，缓慢推移）
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xc8d8e8, transparent: true, opacity: 0.25 });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(160, 0.8), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.02, 8.5);
  group.add(foam);

  // 几块礁石
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 1, flatShading: true });
  ([[-14, 4, 2.5], [18, 1, 3.5], [8, -2, 1.6]] as const).forEach(([x, z, s]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    rock.position.set(x, s * 0.3, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    group.add(rock);
  });

  // 漂流木（躺倒的枯木 + 断枝）
  const driftMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, flatShading: true });
  const drift = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.7, 7), driftMat);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = 0.11;
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.6, 6), driftMat);
  branch.position.set(0.4, 0.28, 0);
  branch.rotation.z = -0.7;
  drift.add(trunk, branch);
  drift.position.set(3.2, 0, 9.5);
  drift.rotation.y = 0.4;
  drift.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  group.add(drift);

  // 散落的贝壳（小半球，浅色）
  const shellColors = [0xb8a894, 0xc8b8a8, 0xa89888, 0xc0a898];
  ([[-3.5, 10.2], [1.8, 11.6], [5.2, 8.8], [-0.6, 12.6]] as const).forEach(([x, z], i) => {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: shellColors[i % shellColors.length], roughness: 0.8 })
    );
    shell.position.set(x, 0.015, z);
    shell.rotation.y = Math.random() * Math.PI;
    group.add(shell);
  });

  // 远处渔火（海平线上的暖光点，缓慢闪烁）
  const boatLightMat = new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.8 });
  const boatLights: THREE.Mesh[] = [];
  ([[-25, -55], [12, -70], [32, -48]] as const).forEach(([x, z]) => {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), boatLightMat.clone());
    light.position.set(x, 0.4, z);
    boatLights.push(light);
    group.add(light);
  });

  // 人物：站在沙滩上打电话，面向海
  const me = createFigure({ bodyColor: 0x8a7a9a, pose: "phone" });
  me.position.set(-1.2, 0, 6);
  me.rotation.y = Math.PI; // 背对镜头朝海
  group.add(me);

  // 手机屏幕微光（照亮人物握机的手与肩头）
  const phoneGlow = new THREE.PointLight(0x88aaff, 1.1, 2.6, 2);
  phoneGlow.position.set(-1.38, 1.3, 5.75);
  group.add(phoneGlow);

  // 远处椰子树剪影（一丛）
  const palmMat = new THREE.MeshStandardMaterial({ color: 0x0e1a16, roughness: 1, flatShading: true });
  const mkPalm = (x: number, z: number, s: number, lean: number) => {
    const p = new THREE.Group();
    const palmTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 4.5 * s, 6), palmMat);
    palmTrunk.position.y = 2.25 * s;
    palmTrunk.rotation.z = lean;
    p.add(palmTrunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.25 * s, 2.4 * s, 4), palmMat);
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.sin(lean) * -2.2 * s + Math.cos(a) * 0.8 * s, 4.5 * s, Math.sin(a) * 0.8 * s);
      leaf.rotation.z = (Math.PI / 2.3) * Math.cos(a);
      leaf.rotation.x = (Math.PI / 2.3) * Math.sin(a);
      p.add(leaf);
    }
    p.position.set(x, 0, z);
    return p;
  };
  group.add(mkPalm(-16, 10, 1.2, 0.15), mkPalm(-18.5, 12, 0.9, -0.1));

  // 光：月光为主 + 半球补光（沙滩与人物有层次）
  group.add(new THREE.AmbientLight(0x2c3a55, 2.0));
  group.add(new THREE.HemisphereLight(0x35486a, 0x2a2620, 1.2));
  const moonLight = new THREE.DirectionalLight(0xa8bce0, 1.15);
  moonLight.position.set(0, 30, -60);
  moonLight.castShadow = true;
  group.add(moonLight);
  // 岸侧弱补光：让背对镜头的人物与沙滩细节有轮廓
  const shoreFill = new THREE.DirectionalLight(0x4a5a78, 1.2);
  shoreFill.position.set(0, 8, 30);
  group.add(shoreFill);

  function update(t: number) {
    sky.userData.update(t);
    stars.userData.update(t);
    seaMat.uniforms.time.value = t;
    // 浪沫缓慢推向岸边
    const push = Math.sin(t * 0.35) * 0.5 + 0.5;
    foam.position.z = 8.5 + push * 1.2;
    foamMat.opacity = 0.1 + push * 0.22;
    foam.scale.x = 1 + push * 0.05;
    // 渔火明灭
    boatLights.forEach((light, i) => {
      (light.material as THREE.MeshBasicMaterial).opacity =
        0.45 + 0.35 * Math.sin(t * 0.8 + i * 2.1);
    });
  }

  return {
    group,
    update,
    camera: { pos: [-0.8, 1.7, 10.8], look: [0, 2.3, -18] },
  };
}
