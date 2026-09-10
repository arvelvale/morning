// S2 acceptance: real geometry/raycast and animated world transforms; no GPU required.
require('./test-scene-layout.cjs');
const assert = require('node:assert/strict');
const THREE = require('three');
const { solveLayout } = require('../src/theater/generated/layout/solve.ts');
const { assembleAnySpec } = require('../src/theater/generated/auto.ts');
const { assembleScene } = require('../src/theater/generated/assemble.ts');
const { runChecks } = require('../src/theater/generated/layout/validator.ts');
const { PROP_GRIPS } = require('../src/theater/generated/grips.ts');
const at = (x, z) => ({ zone: 'midground', side: 'center', bias: [x, z] });
const semantic = (props, characters = []) => ({ kind: 'semantic', env: { mode: 'indoor', time: 'day' }, props, characters });
const lookup = (scene, id) => { let found; scene.group.traverse(o => { if (o.userData.sceneObjectId === id) found = o; }); assert.ok(found, id); return found; };
const codes = r => (r.issues || []).map(i => i.code);
function ownBounds(root) {
  const box = new THREE.Box3();
  function visit(o) {
    if (o !== root && o.userData.sceneObjectId) return; // do not count supported children as host geometry
    if (o.geometry) {
      const p = o.geometry.getAttribute('position'), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
    }
    o.children.forEach(visit);
  }
  visit(root); return box;
}
function dispose(scene) {
  const geometries = new Set();
  // Prop materials may be cached/shared: do not dispose them while other fixtures are alive.
  scene.group.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
  geometries.forEach(g => g.dispose()); scene.group.clear();
}
let passed = 0;
const metrics = { seatCases: 0, seatFrames: 0, maxSeatGap: 0, gripCases: 0, gripFrames: 0, maxGripError: 0, maxGripScaleError: 0 };
function test(name, fn) { fn(); passed++; console.log('PASS S2 ' + name); }

test('seated mesh vertices actually touch raycast seat surfaces across body/outfit/age/seat variants', () => {
  for (const furniture of ['chair', 'emptyChair', 'bench', 'sofa', 'busStop'])
    for (const type of ['child', 'student', 'adult', 'elderly'])
      for (const outfit of ['casual', 'uniform', 'coat', 'skirt']) {
        const build = ['slim', 'average', 'stout'][metrics.seatCases % 3];
        const scene = assembleAnySpec(semantic([{ id: 'seat', type: furniture, rotY: .7, scale: 1.2, params: { width: 2.4 }, at: at(3, 2) }],
          [{ id: 'person', type, build, outfit, sitOn: 'seat' }]));
        const person = lookup(scene, 'person'), seat = lookup(scene, 'seat');
        const surfaces = []; seat.traverse(o => { if (o.userData.supportSurface) surfaces.push(o); });
        assert.ok(surfaces.length);
        for (const t of [0, .25, .75, 1.5, 3]) {
          scene.update(t); scene.group.updateMatrixWorld(true);
          let minGap = Infinity, hits = 0;
          const ray = new THREE.Raycaster(), vertex = new THREE.Vector3();
          for (const mesh of person.userData.contactMeshes) {
            const p = mesh.geometry.getAttribute('position');
            for (let i = 0; i < p.count; i++) {
              vertex.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
              ray.set(new THREE.Vector3(vertex.x, 10, vertex.z), new THREE.Vector3(0, -1, 0));
              const hit = ray.intersectObjects(surfaces, false)[0];
              if (hit) { hits++; minGap = Math.min(minGap, vertex.y - hit.point.y); }
            }
          }
          assert.ok(hits > 0, 'no body geometry above actual seat: ' + furniture + '/' + type + '/' + outfit);
          assert.ok(Math.abs(minGap) <= .05 * person.scale.x, 'seat contact ' + furniture + '/' + type + '/' + outfit + ': ' + minGap);
          metrics.maxSeatGap = Math.max(metrics.maxSeatGap, Math.abs(minGap)); metrics.seatFrames++;
        }
        assert.ok(!codes(scene.layoutReport).includes('SUPPORT_CONTACT_ERROR'));
        metrics.seatCases++; dispose(scene);
      }
});

test('all registered grips follow actual animated hand while preserving prop scale and upright intent', () => {
  for (const propType of Object.keys(PROP_GRIPS)) for (const type of ['child', 'adult', 'elderly'])
    for (const pose of ['standing', 'phone', 'walking', 'waving', 'handingItem', 'sitting', 'lookingBack', 'headDown', 'handsFolded', 'arguing', 'comforting', 'hugging', 'crying', 'sittingGround']) {
      for (const closed of propType === 'umbrella' ? [false, true] : [false]) {
        const props = [{ id: 'item', type: propType, heldBy: 'person', scale: .8, params: { closed } }];
        if (pose === 'sitting') props.push({ id: 'seat', type: 'chair', at: at(2, 2) });
        const scene = assembleAnySpec(semantic(props, [{ id: 'person', type, pose, ...(pose === 'sitting' ? { sitOn: 'seat' } : { at: at(2, 2) }), facing: 'away' }]));
        const person = lookup(scene, 'person'), item = lookup(scene, 'item');
        // No renderer-forced matrix refresh here: initial assembly must already be correct.
        const initialHand = person.userData.handAnchor.getWorldPosition(new THREE.Vector3());
        const initialGrip = item.localToWorld(new THREE.Vector3(...PROP_GRIPS[propType].point));
        assert.ok(initialHand.distanceTo(initialGrip) < 1e-6, propType + ' initial matrix stale');
        const resolved = solveLayout(semantic(props, [{ id: 'person', type, pose, ...(pose === 'sitting' ? { sitOn: 'seat' } : { at: at(2, 2) }), facing: 'away' }]));
        const initialRoot = item.getWorldPosition(new THREE.Vector3());
        assert.ok(initialRoot.distanceTo(new THREE.Vector3(...resolved.spec.props.find(p => p.id === 'item').pos)) < .003, propType + ' layout vs assembly position drift');
        for (const t of [0, .17, .5, 1, 1.8, 3]) {
          person.position.x += .03; person.rotation.y += .13;
          scene.group.position.set(1, .4, -.2); scene.group.scale.setScalar(1.3); scene.group.rotation.y = .31;
          scene.update(t); scene.group.updateMatrixWorld(true);
          const hand = person.userData.handAnchor.getWorldPosition(new THREE.Vector3());
          const point = item.localToWorld(new THREE.Vector3(...PROP_GRIPS[propType].point));
          const error = point.distanceTo(hand);
          assert.ok(error < 1e-6, propType + ' grip error ' + error);
          const scale = item.getWorldScale(new THREE.Vector3());
          const scaleError = Math.max(...scale.toArray().map(v => Math.abs(v - 1.04)));
          assert.ok(scaleError < 1e-6, propType + ' double-scaled by figure: ' + scale.toArray());
          if (PROP_GRIPS[propType].upright) {
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(item.getWorldQuaternion(new THREE.Quaternion()));
            assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, propType + ' tipped over');
          }
          metrics.maxGripError = Math.max(metrics.maxGripError, error); metrics.maxGripScaleError = Math.max(metrics.maxGripScaleError, scaleError); metrics.gripFrames++;
        }
        assert.ok(!codes(scene.layoutReport).includes('HAND_CONTACT_ERROR'), propType + '/' + type + '/' + pose + ': ' + JSON.stringify(scene.layoutReport.issues));
        metrics.gripCases++; dispose(scene);
      }
    }
});

test('rotated eccentric carrier chain has real surface contact and remains stable under permutation', () => {
  const props = [{ id: 'table', type: 'table', params: { width: 2, depth: 1.4 }, rotY: 1.1, at: at(2, 2) },
    { id: 'crate', type: 'crate', params: { size: .4 }, on: 'table', rotY: .35 }, { id: 'book', type: 'book', on: 'crate', rotY: 1.8 }];
  const a = solveLayout(semantic(props)), b = solveLayout(semantic([...props].reverse()));
  for (const p of a.spec.props) assert.deepEqual(p, b.spec.props.find(q => q.id === p.id));
  assert.ok(!codes(a.report).includes('SUPPORT_FOOTPRINT_OVERFLOW'));
  const scene = assembleAnySpec(semantic(props)); scene.group.updateMatrixWorld(true);
  const book = new THREE.Box3().setFromObject(lookup(scene, 'book'));
  const crate = ownBounds(lookup(scene, 'crate'));
  assert.ok(Math.abs(book.min.y - crate.max.y) < .003);
  dispose(scene);
});

test('oversized, circular-corner and unsupported container relations report failure', () => {
  const r = solveLayout(semantic([{ id: 'table', type: 'table', params: { width: .4, depth: .4 } },
    { id: 'box', type: 'crate', params: { size: 1 }, on: 'table' }, { id: 'phone', type: 'phone', inside: 'table' }]));
  assert.ok(codes(r.report).includes('SUPPORT_FOOTPRINT_OVERFLOW'));
  assert.ok(codes(r.report).includes('RELATION_NOT_APPLIED_inside'));
  const b = { kind: 'prop', id: 'table', sem: { type: 'table' }, x: 0, y: 0, z: 0, rotY: 0, scale: 1, box: { hw: 1, hd: 1, h: 1, top: 1, surface: { cx: 0, cz: 0, hw: 1, hd: 1, ellipse: true } }, supportY: 0, onSupport: false };
  const report = { fixes: [], warnings: [] };
  runChecks([b, { ...b, id: 'box', sem: { type: 'crate', on: 'table' }, carrier: { rel: 'on', hostId: 'table' }, x: .85, z: .85, y: 1, box: { hw: .08, hd: .08, h: .1, top: .1 }, onSupport: true }], {}, report);
  assert.ok(codes(report).includes('SUPPORT_FOOTPRINT_OVERFLOW'), 'rectangular envelope must not hide circular edge overflow');
});

test('soft/facing residuals and all discarded conflicting references have structured issues', () => {
  const r = solveLayout(semantic([{ id: 'a', type: 'phone', on: 'missingA', inside: 'missingB', heldBy: 'missingC' }], [{ id: 'p', facing: 'missingD' }]));
  for (const code of ['RELATION_NOT_APPLIED_on', 'RELATION_NOT_APPLIED_inside', 'RELATION_NOT_APPLIED_heldBy', 'FACING_TARGET_INVALID']) assert.ok(codes(r.report).includes(code), code);
  const a = { id: 'a', kind: 'char', sem: {}, scale: 1, x: 0, y: 0, z: 0, rotY: 0, supportY: 0, onSupport: false };
  const b = { ...a, id: 'b', x: 8, z: 8, sem: { facing: 'toward:a', near: 'a' }, dirRef: { rel: 'near', hostId: 'a' } };
  const report = { fixes: [], warnings: [] }, snapshot = JSON.stringify([a, b]);
  runChecks([a, b], {}, report);
  assert.ok(codes(report).includes('SOFT_RELATION_RESIDUAL')); assert.ok(codes(report).includes('FACING_RESIDUAL'));
  assert.equal(JSON.stringify([a, b]), snapshot, 'final validator must be read-only');
});

test('one hand cannot silently accept two props or furniture', () => {
  const r = solveLayout(semantic([{ id: 'a', type: 'phone', heldBy: 'p' }, { id: 'b', type: 'umbrella', heldBy: 'p' }, { id: 'c', type: 'table', heldBy: 'p' }], [{ id: 'p' }]));
  assert.equal(r.spec.props.filter(p => p.heldBy).length, 1);
  assert.equal(r.report.issues.filter(i => i.code === 'RELATION_NOT_APPLIED_heldBy').length, 2);
});

test('valid containers preserve ground contact; tall contents report height overflow', () => {
  const r = solveLayout(semantic([{ id: 'booth', type: 'phoneBooth', rotY: .8, at: at(2, 2) }, { id: 'book', type: 'book', inside: 'booth' },
    { id: 'big', type: 'crate', params: { size: 5 }, inside: 'booth' }]));
  assert.ok(!r.report.issues.some(i => i.code === 'SUPPORT_CONTACT_ERROR' && i.objectIds[0] === 'book'));
  assert.ok(codes(r.report).includes('CONTAINER_HEIGHT_OVERFLOW'));
});

test('camera precheck uses final camera but never claims a look-only shift repaired framing', () => {
  const { checkCameraVisibility } = require('../src/theater/generated/layout/validator.ts');
  const report = { fixes: [], warnings: [] };
  const camera = { pos: [0, 1, 5], look: [0, 1, 0] }, snapshot = JSON.stringify(camera);
  checkCameraVisibility([{ id: 'person', kind: 'char', sem: {}, x: 10, y: 0, z: 0, rotY: 0, scale: 1, supportY: 0, onSupport: false }], camera, report);
  assert.ok(codes(report).includes('CAMERA_FRAMING_REVIEW'));
  assert.equal(report.fixes.length, 0); assert.equal(JSON.stringify(camera), snapshot);
});

test('prop children follow a held carrier through animation', () => {
  const scene = assembleAnySpec(semantic([{ id: 'book', type: 'book', heldBy: 'p' }, { id: 'phone', type: 'phone', on: 'book' }], [{ id: 'p', pose: 'handingItem' }]));
  const parent = lookup(scene, 'book'), child = lookup(scene, 'phone');
  assert.equal(child.parent, parent);
  const relative = child.matrix.clone();
  for (const t of [0, .5, 1.5, 3]) { scene.update(t); scene.group.updateMatrixWorld(true); assert.deepEqual(child.matrix.elements, relative.elements); }
  dispose(scene);
});

test('assembly failure and missing legacy hand host are visible; old absolute scenes still render', () => {
  const scene = assembleScene({ env: { mode: 'indoor', time: 'day' }, props: [{ type: 'unknown', id: 'bad' }, { type: 'phone', id: 'item', heldBy: 'missing' }], characters: [{ pose: 'sitting', pos: [1, 0, 2] }] });
  assert.ok(codes(scene.group.userData.layoutReport).includes('PROP_BUILD_FAILED'));
  assert.ok(codes(scene.group.userData.layoutReport).includes('HAND_BIND_FAILED'));
  scene.update(.5); dispose(scene);
});
console.log('S2_ACCEPTANCE ' + JSON.stringify({ passed, ...metrics }));
