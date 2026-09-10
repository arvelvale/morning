/**
 * assembleScene —— 把 SceneSpec 程序化拼装成 theater 的 `{ group, update, camera }`。
 *
 * 环境（天空/地面/星月山/灯光）按 env.time 给默认基调、被 env 内字段覆盖；
 * 零件走 props.buildProp（未知 type 跳过并告警）；人物走 figure.createFigure。
 * 逐帧动画（星空、篝火等）统一收集各对象的 userData.update，由返回的 update(t) 驱动。
 * 任一步骤失败都不影响整体（尽量渲染出能看的场景），契合「离线可跑、稳定兜底」。
 */
import * as THREE from "three";
import { createGround, createMoon, createMountains, createSkyDome, createStars, createSun } from "../utils";
import { createFigure } from "../figure";
import type { TheaterScene } from "../types";
import { buildProp } from "./props";
import type { SceneSpec, TimeOfDay, Vec3 } from "./spec";
import { buildMoodRig, resolveMood } from "./vision/mood";
import { PROP_GRIPS } from './grips';
import type { LayoutReport } from './layout/types';
import { addIssue } from './layout/report';

type UpdateFn = (t: number) => void;

function hexNum(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v.replace("#", ""), 16);
  return Number.isNaN(n) ? fallback : n;
}

/** 依据 SceneSpec 组装一个可挂载到 Scene3D 的场景。 */
export function assembleScene(spec: SceneSpec, report?: LayoutReport): TheaterScene {
  const group = new THREE.Group();
  const updates: UpdateFn[] = [];
  const attachments: (() => void)[] = [];
  const assemblyReport = report ?? { fixes: [], warnings: [], issues: [] };
  group.userData.layoutReport = assemblyReport;
  // P3：mood 系统统一决定天空/地面/灯光/雾/曝光基线（显式 env 覆盖仍生效）
  const preset = resolveMood(spec);
  const outdoor = spec.env.mode === "outdoor";

  // ── 天空 + 地面 ──（mood 提供 mid/horizon/sunGlow 时走三段暮色 shader）
  group.add(createSkyDome({
    top: hexNum(spec.env.sky?.top, preset.sky.top),
    bottom: hexNum(spec.env.sky?.bottom, preset.sky.bottom),
    mid: preset.sky.mid,
    horizon: preset.sky.horizon,
    sunDir: [preset.key.pos[0], preset.key.pos[1], preset.key.pos[2]],
    sunGlowStrength: preset.sky.sunGlowStrength ?? 0,
    sunTint: preset.sky.sunTint ?? 0xffa050,
  }));
  group.add(createGround({ color: hexNum(spec.env.ground?.color, preset.ground) }));

  // ── 星空（户外夜晚默认开）──
  const wantStars = spec.env.stars ?? (outdoor && spec.env.time === "night");
  if (wantStars) {
    const stars = createStars({ count: 1000 });
    group.add(stars);
    updates.push((t) => stars.userData.update(t));
  }

  // ── 月亮 ──
  if (spec.env.moon) {
    const mo = typeof spec.env.moon === "object" ? spec.env.moon : {};
    group.add(createMoon({ size: mo.size ?? 3.5, height: mo.height ?? 42, angle: mo.angle ?? 0.4 }));
  }

  // ── 太阳（户外白天/黄昏默认开；env.sun=false 可关）──
  const SUN_BY_TIME: Partial<Record<TimeOfDay, {
    size: number; color: number; height: number; angle: number; haloOpacity: number;
  }>> = {
    day: { size: 4.5, color: 0xfff2c8, height: 40, angle: -0.6, haloOpacity: 0.14 },
    dusk: { size: 6, color: 0xffb050, height: 12, angle: -0.8, haloOpacity: 0.3 },
  };
  const sunDef = SUN_BY_TIME[spec.env.time];
  const wantSun = spec.env.sun ?? (outdoor && !!sunDef);
  if (wantSun && sunDef) {
    const su = typeof spec.env.sun === "object" ? spec.env.sun : {};
    group.add(createSun({
      size: su.size ?? sunDef.size,
      height: su.height ?? sunDef.height,
      angle: su.angle ?? sunDef.angle,
      color: hexNum(su.color, sunDef.color),
      haloOpacity: sunDef.haloOpacity,
    }));
  }

  // ── 远山（户外可选）──
  if (spec.env.mountains) {
    const mt = typeof spec.env.mountains === "object" ? spec.env.mountains : {};
    group.add(createMountains({ color: hexNum(mt.color, preset.sky.top), count: mt.count ?? 7, radius: 72 }));
  }

  // ── 灯光：mood rig（Hemisphere + Key 投影光 + 反向 Fill）──
  // spec.lighting 显式覆盖仍最高优先（行为兼容旧数据）。
  const rig = buildMoodRig(preset);
  if (spec.lighting?.ambient) {
    rig.hemi.intensity = spec.lighting.ambient.intensity ?? rig.hemi.intensity;
    if (spec.lighting.ambient.color) rig.hemi.color.set(hexNum(spec.lighting.ambient.color, 0xffffff));
  }
  const dl = spec.lighting?.dir;
  if (dl) {
    rig.key.intensity = dl.intensity ?? rig.key.intensity;
    if (dl.color) rig.key.color.set(hexNum(dl.color, rig.key.color.getHex()));
    if (dl.pos) rig.key.position.set(...dl.pos);
  }
  group.add(rig.hemi, rig.key, rig.fill);

  // ── 零件 ──
  const heldProps: { obj: THREE.Object3D; hostId: string; type: string; bound?: boolean }[] = [];
  const propObjects = new Map<string, THREE.Object3D>();
  const renderedProps: { type: string; obj: THREE.Object3D }[] = [];
  const actors: THREE.Object3D[] = [];
  for (const inst of spec.props ?? []) {
    let obj: THREE.Object3D | null = null;
    try { obj = buildProp(inst.type, inst.params ?? {}); } catch { /* report below and preserve the rest of the scene */ }
    if (!obj) {
      addIssue(assemblyReport, { code: 'PROP_BUILD_FAILED', objectIds: [inst.id ?? inst.type], severity: 'error', status: 'degraded', actual: inst.type }, `零件无法构造：${inst.id ?? inst.type}`);
      continue;
    }
    if (inst.pos) obj.position.set(...inst.pos);
    if (typeof inst.rotY === "number") obj.rotation.y = inst.rotY;
    if (typeof inst.scale === "number") obj.scale.setScalar(inst.scale);
    if (typeof obj.userData.update === "function") updates.push(obj.userData.update as UpdateFn);
    group.add(obj);
    renderedProps.push({ type: inst.type, obj });
    obj.userData.sceneObjectId = inst.id;
    if (inst.id) propObjects.set(inst.id, obj);
    if (inst.heldBy) heldProps.push({ obj, hostId: inst.heldBy, type: inst.type });
  }

  // Attach support subtrees before a carrier is moved to a hand. Guard legacy malformed cycles.
  for (const inst of spec.props ?? []) {
    if (!inst.supportId || !inst.id) continue;
    const obj = propObjects.get(inst.id), host = propObjects.get(inst.supportId);
    let cycle = obj === host;
    for (let ancestor: THREE.Object3D | null | undefined = host; ancestor; ancestor = ancestor.parent) if (ancestor === obj) cycle = true;
    if (obj && host && !cycle) { group.updateMatrixWorld(true); host.attach(obj); }
    else addIssue(assemblyReport, { code: 'SUPPORT_BIND_FAILED', objectIds: [inst.id, inst.supportId], severity: 'warning', status: 'degraded' }, `承载挂接失败：${inst.id}`);
  }

  // ── 人物 ──
  for (const c of spec.characters ?? []) {
    const fig = createFigure({
      pose: c.pose ?? "standing",
      externalHandProp: !!c.id && heldProps.some(p => p.hostId === c.id),
      seatContactEnabled: c.seatContactEnabled,
      scale: c.scale ?? 1,
      type: c.type ?? "adult",
      build: c.build ?? "average",
      outfit: c.outfit ?? "casual",
      hairstyle: c.hairstyle ?? "short",
      backpack: c.backpack ?? false,
      bodyColor: c.bodyColor ? hexNum(c.bodyColor, 0x8a97ad) : undefined,
      skinColor: hexNum(c.skinColor, 0xe8c8a8),
      hairColor: c.hairColor ? hexNum(c.hairColor, 0x3a3230) : undefined,
    });
    if (c.pos) fig.position.set(...c.pos);
    if (typeof c.rotY === "number") fig.rotation.y = c.rotY;
    // 情感动作（walking/waving 等）靠 userData.update 逐帧驱动
    if (typeof fig.userData.update === "function") updates.push(fig.userData.update as UpdateFn);
    group.add(fig);
    actors.push(fig);
    fig.userData.sceneObjectId = c.id;
    const anchor = fig.userData.handAnchor as THREE.Group;
    for (const entry of heldProps.filter(p => p.hostId === c.id)) {
      const { obj, type } = entry;
      const grip = PROP_GRIPS[type];
      if (!grip || heldProps.some(p => p.hostId === c.id && p.bound)) continue;
      entry.bound = true;
      const mount = new THREE.Group();
      mount.matrixAutoUpdate = false;
      anchor.add(mount);
      obj.rotation.set(0, 0, 0);
      mount.add(obj);
      obj.position.set(...grip.point).multiply(obj.scale).multiplyScalar(-1);
      const handPos = new THREE.Vector3(), orientation = new THREE.Quaternion(), sceneScale = new THREE.Vector3();
      const world = new THREE.Matrix4(), actual = new THREE.Vector3();
      const bind = () => {
        anchor.updateWorldMatrix(true, false);
        anchor.getWorldPosition(handPos);
        (grip.upright ? fig : anchor).getWorldQuaternion(orientation);
        // Breathing adds non-uniform scale; decomposing its rotated matrix may yield a non-unit quaternion.
        orientation.normalize();
        group.getWorldScale(sceneScale);
        world.compose(handPos, orientation, sceneScale);
        mount.matrix.copy(anchor.matrixWorld).invert().multiply(world);
        mount.matrixWorldNeedsUpdate = true;
        mount.updateWorldMatrix(false, true);
        actual.set(...grip.point); obj.localToWorld(actual);
        if (actual.distanceTo(handPos) > .05 * Math.max(...sceneScale.toArray())) {
          addIssue(assemblyReport, { code: 'HAND_CONTACT_ERROR', objectIds: [obj.userData.sceneObjectId ?? type, c.id ?? 'character'], severity: 'error', status: 'unresolved', expected: '握点误差 ≤0.05m（场景缩放后）', actual: `${actual.distanceTo(handPos)}m` }, `手持挂点失配：${obj.userData.sceneObjectId ?? type}`);
        }
      };
      bind();
      attachments.push(bind);
    }
  }
  for (const entry of heldProps.filter(p => !p.bound)) {
    addIssue(assemblyReport, { code: 'HAND_BIND_FAILED', objectIds: [entry.obj.userData.sceneObjectId ?? entry.type, entry.hostId], severity: 'warning', status: 'degraded' }, `持物未挂接：${entry.type} → ${entry.hostId}（宿主/握点缺失或手已占用）`);
  }

  const camera = spec.camera ?? {
    pos: outdoor ? [4.5, 2.4, 5] : [3.2, 2, 4],
    look: [0, 0.9, 0],
  };

  group.updateMatrixWorld(true);
  const background = new Set(['rain', 'fireflies', 'stringLights', 'water', 'cityscape', 'road', 'crosswalk', 'pavement', 'puddle', 'fallenLeaves', 'sidewalk', 'platform', 'wall', 'window']);
  const interactive = new Set(['campfire', 'chair', 'emptyChair', 'bench', 'table', 'sofa', 'teacup', 'book', 'phone', 'umbrella', 'photoFrame', 'luggage']);
  const actorPositions = actors.map(o => o.getWorldPosition(new THREE.Vector3()));
  const focusProps = renderedProps.filter(({ type, obj }) => !background.has(type) && (
    !actors.length || interactive.has(type) && actorPositions.some(p => p.distanceTo(obj.getWorldPosition(new THREE.Vector3())) < 3)
  )).map(p => p.obj);

  return {
    group,
    update: (t: number) => { for (const u of updates) u(t); for (const bind of attachments) bind(); },
    camera,
    framing: { subjects: [...actors, ...focusProps], actors, obstacles: renderedProps.filter(p => !background.has(p.type) && !interactive.has(p.type)).map(p => p.obj) },
    sceneSetup: {
      fog: rig.fog,
      exposureBias: rig.exposureBias,
    },
  };
}
