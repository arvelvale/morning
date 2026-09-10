/** Final validation is read-only: never move hosts after hard-constraint replay. */
import type { LayoutNode, LayoutReport, SemanticCharacterInstance, SemanticPropInstance } from './types';
import { PROP_META, propMeta, metaKind } from './propMeta';
import { boundsOverlap, worldBounds } from './bounds';
import { addIssue } from './report';
import { footprintInHost, relationRadius, supportAncestor } from './relations';
import * as THREE from 'three';

export interface CheckOutput { camera?: { pos: [number, number, number]; look: [number, number, number] } }
const CONTACT_TOLERANCE = .05;
const FACE_TOLERANCE = Math.PI / 12; // 15 degrees
const SOFT_TOLERANCE = .6; // metres

export function runChecks(nodes: LayoutNode[], _sem: { env?: { mode?: string } }, report: LayoutReport): CheckOutput {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const warn = (code: string, ids: string[], expected: string, actual: string) => addIssue(report,
    { code, objectIds: ids, severity: 'warning', status: 'unresolved', expected, actual }, code + '：' + ids.join(' ↔ ') + '；' + actual);
  const solids = nodes.filter(n => n.kind === 'char' || metaKind(PROP_META[(n.sem as SemanticPropInstance).type]) === 'solid');
  for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
    const a = solids[i], b = solids[j];
    if (supportAncestor(a, b, byId) || supportAncestor(b, a, byId)) continue;
    if (a.dirRef?.rel === 'heldBy' || b.dirRef?.rel === 'heldBy') continue; // actual skeleton validates grip at assembly time
    const overlap = boundsOverlap(a, b);
    if (overlap) warn('RESIDUAL_OVERLAP', [a.id, b.id], '非承载件不重叠（AABB 保守复核）', '残余穿模 ' + overlap.axis + '=' + overlap.depth.toFixed(3) + 'm');
    const ha = worldBounds(a).maxY - worldBounds(a).minY, hb = worldBounds(b).maxY - worldBounds(b).minY;
    if (Math.hypot(a.x - b.x, a.z - b.z) <= 3 && Math.min(ha, hb) > .05 && Math.max(ha, hb) / Math.min(ha, hb) > 12) {
      warn('PROPORTION_REVIEW', [a.id, b.id], '邻近物件高度比 ≤12，仅提示', (Math.max(ha, hb) / Math.min(ha, hb)).toFixed(1) + '×');
    }
  }

  for (const n of nodes) {
    if (![n.x, n.y, n.z, n.rotY, n.scale].every(Number.isFinite)) warn('NON_FINITE_LAYOUT', [n.id], '有限坐标/缩放', '检测到非有限数');
    if (n.kind === 'prop' && !n.box) warn('PROP_MEASUREMENT_FAILED', [n.id], '可测量零件', (n.sem as SemanticPropInstance).type);
    if (!n.backdrop) {
      const b = worldBounds(n);
      if (Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ)) > 11.05) warn('OUT_OF_BOUNDS', [n.id], '几何范围在 ±11m 内', '未钳回，避免拆散承载关系');
      if (!n.carrier && n.dirRef?.rel !== 'heldBy' && Math.abs(b.minY) > .15) warn('GROUND_CONTACT_ERROR', [n.id], '自由件贴地，误差 ≤0.15m', '底面 y=' + b.minY.toFixed(3));
    }
    // Inspect EVERY requested relationship, even discarded conflicts/cycles.
    for (const rel of ['on', 'inside', 'in', 'sitOn', 'heldBy', 'nextTo', 'near', 'inFrontOf', 'behind'] as const) {
      const requested = (n.sem as unknown as Record<string, unknown>)[rel];
      if (requested === undefined) continue;
      const normalized = rel === 'inside' ? 'in' : rel;
      const active = ['on', 'in', 'sitOn'].includes(normalized) ? n.carrier : n.dirRef;
      if (typeof requested !== 'string' || !active || active.rel !== normalized || active.hostId !== requested) {
        addIssue(report, { code: 'RELATION_NOT_APPLIED_' + rel, objectIds: [n.id, String(requested)], severity: 'warning', status: 'degraded', expected: rel + ' → ' + String(requested), actual: '引用无效、冲突、成环或锚点不可用' }, '未应用 ' + rel + '：' + n.id + ' → ' + String(requested));
      }
    }

    if (n.carrier) {
      const host = byId.get(n.carrier.hostId);
      if (!host?.box) { warn('HOST_GEOMETRY_MISSING', [n.id, n.carrier.hostId], '存在宿主几何', '无法验收'); continue; }
      const hp = host.sem as SemanticPropInstance;
      const meta = propMeta(hp.type, hp.params);
      let contact = n.y + (n.box?.minY ?? 0), target = host.y + host.box.top;
      if (n.carrier.rel === 'sitOn') {
        contact = n.y + (n.figureAnchors?.contactY ?? 0);
        const seat = meta?.seats?.[n.seatIndex ?? -1];
        if (!seat || !n.figureAnchors) warn('SEAT_ANCHOR_MISSING', [n.id, host.id], '实际坐姿接触点与独占座位', '缺失锚点');
        else {
          const dx = (seat.dx ?? 0) * host.scale, dz = (seat.dz ?? 0) * host.scale;
          const x = host.x + dx * Math.cos(host.rotY) + dz * Math.sin(host.rotY);
          const z = host.z - dx * Math.sin(host.rotY) + dz * Math.cos(host.rotY);
          const error = Math.hypot(n.x - x, n.z - z);
          if (error > CONTACT_TOLERANCE * n.scale) warn('SEAT_POSITION_ERROR', [n.id, host.id], '就坐槽位误差 ≤0.05m×人物比例', error.toFixed(3) + 'm');
        }
      } else {
        if (n.carrier.rel === 'in') target = host.y + (meta?.innerDy ?? 0) * host.scale;
        const area = n.carrier.rel === 'on' ? host.box.surface : undefined;
        const cx = area?.cx ?? host.box.cx ?? 0, cz = area?.cz ?? host.box.cz ?? 0;
        const hw = area?.hw ?? host.box.hw, hd = area?.hd ?? host.box.hd;
        if (footprintInHost(n, host).some(([x, z]) => area?.ellipse
          ? ((x - cx) / (hw + .02)) ** 2 + ((z - cz) / (hd + .02)) ** 2 > 1
          : Math.abs(x - cx) > hw + .02 || Math.abs(z - cz) > hd + .02)) {
          warn('SUPPORT_FOOTPRINT_OVERFLOW', [n.id, host.id], '旋转底面完整落在宿主承载范围，容差 0.02m', '物件超出承载面；未缩小用户物件');
        }
        if (n.carrier.rel === 'in' && worldBounds(n).maxY > worldBounds(host).maxY + .02) warn('CONTAINER_HEIGHT_OVERFLOW', [n.id, host.id], '物件高度不超出容器', '物件超出容器顶部');
      }
      if (Math.abs(contact - target) > CONTACT_TOLERANCE * (n.kind === 'char' ? n.scale : 1)) warn('SUPPORT_CONTACT_ERROR', [n.id, host.id], '接触误差 ≤0.05m（人物按比例）', Math.abs(contact - target).toFixed(3) + 'm');
    }

    if (n.dirRef && n.dirRef.rel !== 'heldBy') {
      const host = byId.get(n.dirRef.hostId);
      if (host) {
        const distance = relationRadius(n) + relationRadius(host) + (n.dirRef.rel === 'near' ? 1.1 : .4);
        const front = n.dirRef.rel === 'inFrontOf', back = n.dirRef.rel === 'behind';
        const x = host.x + (front || back ? Math.sin(host.rotY) * (back ? -1 : 1) : Math.cos(host.rotY)) * distance;
        const z = host.z + (front || back ? Math.cos(host.rotY) * (back ? -1 : 1) : -Math.sin(host.rotY)) * distance;
        const residual = Math.hypot(n.x - x, n.z - z);
        if (residual > SOFT_TOLERANCE) warn('SOFT_RELATION_RESIDUAL', [n.id, host.id], n.dirRef.rel + ' 理想点偏差 ≤0.6m', residual.toFixed(3) + 'm');
      }
    }
    const facing = n.kind === 'char' ? (n.sem as SemanticCharacterInstance).facing : undefined;
    if (facing) {
      const target = byId.get(facing.replace(/^toward:/, ''));
      const want = facing === 'camera' ? Math.atan2(4.5, 5) : facing === 'away' ? Math.atan2(4.5, 5) + Math.PI : target && target !== n ? Math.atan2(target.x - n.x, target.z - n.z) : undefined;
      if (want === undefined) warn('FACING_TARGET_INVALID', [n.id, facing], '有效朝向目标', '目标不存在或指向自身');
      else {
        const error = Math.abs(Math.atan2(Math.sin(n.rotY - want), Math.cos(n.rotY - want)));
        if (error > FACE_TOLERANCE) warn('FACING_RESIDUAL', [n.id, facing], '朝向误差 ≤15°', (error * 180 / Math.PI).toFixed(1) + '°');
      }
    }
  }
  return {};
}

/** Conservative preview only; S4 supplies actual viewport/FOV and composition. No camera mutation. */
export function checkCameraVisibility(nodes: LayoutNode[], camera: NonNullable<CheckOutput['camera']>, report: LayoutReport, aspect = .5, fov = 50) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, .01, 1000);
  cam.position.set(...camera.pos); cam.lookAt(new THREE.Vector3(...camera.look)); cam.updateMatrixWorld(true);
  for (const n of nodes.filter(n => n.kind === 'char')) {
    const b = worldBounds(n);
    let outside = false;
    for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
      const p = new THREE.Vector3(x, y, z).project(cam);
      if (Math.abs(p.x) > .8 || Math.abs(p.y) > .8 || p.z < -1 || p.z > 1) outside = true;
    }
    if (outside) addIssue(report, { code: 'CAMERA_FRAMING_REVIEW', objectIds: [n.id], severity: 'warning', status: 'unresolved', expected: '人物包围盒投影在 NDC ±0.8 内', actual: '保守预检 aspect=' + aspect + ', fov=' + fov + '；真实视口留待 S4' }, '镜头预检需复核：' + n.id);
  }
}
