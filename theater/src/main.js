import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import * as campsite from './scenes/campsite.js';
import * as bedroomWindow from './scenes/bedroomWindow.js';
import * as seaside from './scenes/seaside.js';
import * as diningRoom from './scenes/diningRoom.js';
import * as airport from './scenes/airport.js';
import * as trainStation from './scenes/trainStation.js';

const SCENES = [
  { id: 'campsite', name: '露营地', sub: '深夜通话 · 篝火旁', create: campsite.create },
  { id: 'bedroom', name: '卧室窗前', sub: '深夜通话 · 窗前', create: bedroomWindow.create },
  { id: 'seaside', name: '海边', sub: '深夜通话 · 月下海岸', create: seaside.create },
  { id: 'dining', name: '家中餐桌', sub: '那晚 · 相对而坐', create: diningRoom.create },
  { id: 'airport', name: '机场', sub: '离开的路上 · 候机厅', create: airport.create },
  { id: 'station', name: '高铁站', sub: '离开的路上 · 站台', create: trainStation.create },
];

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 30;
controls.minDistance = 1.5;
controls.maxPolarAngle = 1.45; // 约83°：保证视线在地平线以上，与 RN 端 Scene3D 钳制口径一致（原 0.52π 会越过水平线露出地底）

// ---------- 场景切换 ----------
let current = null; // { group, update }
const fader = document.getElementById('fader');
const subEl = document.getElementById('scene-sub');

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        for (const key in m) if (m[key]?.isTexture) m[key].dispose();
        m.dispose();
      });
    }
  });
}

function switchScene(def, instant = false) {
  fader.style.opacity = 1;
  const apply = () => {
    if (current) {
      scene.remove(current.group);
      disposeGroup(current.group);
    }
    current = def.create();
    scene.add(current.group);
    const { pos, look } = current.camera;
    camera.position.set(...pos);
    controls.target.set(...look);
    controls.update();
    subEl.textContent = def.sub;
    document.querySelectorAll('#ui button').forEach((b) =>
      b.classList.toggle('active', b.dataset.id === def.id));
    fader.style.opacity = 0;
  };
  if (instant) apply();
  else setTimeout(apply, 450);
}

// ---------- UI ----------
const ui = document.getElementById('ui');
SCENES.forEach((def) => {
  const btn = document.createElement('button');
  btn.textContent = def.name;
  btn.dataset.id = def.id;
  btn.addEventListener('click', () => switchScene(def));
  ui.appendChild(btn);
});

// 支持 URL hash 直达（剧场引擎按模板命中跳转用）
const fromHash = SCENES.find((s) => `#${s.id}` === window.location.hash);
switchScene(fromHash || SCENES[0], true);

// ---------- 主循环 ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (current?.update) current.update(t);
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
