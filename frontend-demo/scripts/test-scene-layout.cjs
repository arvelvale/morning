// Run with node scripts/test-scene-layout.cjs; no renderer or model service required.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, f);
const { solveLayout } = require('../src/theater/generated/layout/solve.ts');
const at = (x, z) => ({ zone: 'midground', side: 'center', bias: [x, z] });
const solve = (props, characters = []) => solveLayout({ kind: 'semantic', env: { mode: 'outdoor' }, props, characters });
const close = (a, b) => assert.ok(Math.abs(a - b) < .003, `${a} != ${b}`);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
test('sitOn uses chair seat, not ground or backrest', () => {
  const { spec } = solve([{ id: 'chair', type: 'chair', at: at(3, 2) }], [{ id: 'person', sitOn: 'chair', type: 'adult' }]);
  close(spec.characters[0].pos[0], spec.props[0].pos[0]);
  close(spec.characters[0].pos[2], spec.props[0].pos[2]);
  assert.equal(spec.characters[0].pose, 'sitting');
  const { measureFigureAnchors } = require('../src/theater/figure/anchors.ts');
  close(spec.characters[0].pos[1] + measureFigureAnchors({ type: 'adult', pose: 'sitting' }).contactY, .445);
});
test('cup/table permutation preserves position and support', () => {
  const props = [{ id: 'cup', type: 'teacup', on: 'table' }, { id: 'table', type: 'table', at: at(3, 2) }];
  const a = solve(props).spec.props.find(p => p.type === 'teacup');
  const b = solve([...props].reverse()).spec.props.find(p => p.type === 'teacup');
  assert.deepEqual(a, b); close(a.pos[0], 3); close(a.pos[2], 2); assert.ok(a.pos[1] > .6);
});
test('chain supports resolve recursively regardless of declaration order', () => {
  const props = [{ id: 'cup', type: 'teacup', on: 'box' }, { id: 'box', type: 'crate', on: 'table' }, { id: 'table', type: 'table', at: at(3, 2) }];
  const a = solve(props).spec.props, b = solve([...props].reverse()).spec.props;
  for (const p of a) assert.deepEqual(p, b.find(q => q.type === p.type));
  assert.ok(a[0].pos[1] > a[1].pos[1]);
});
test('two bench seats are unique and third occupant is reported', () => {
  const chars = ['c', 'b', 'a'].map(id => ({ id, sitOn: 'bench' }));
  const { spec, report } = solve([{ id: 'bench', type: 'bench', rotY: Math.PI / 2, at: at(3, 2) }], chars);
  assert.equal(spec.characters[0].pose, 'standing');
  assert.equal(spec.characters[1].pose, 'sitting');
  assert.equal(spec.characters[2].pose, 'sitting');
  assert.ok(Math.abs(spec.characters[1].pos[2] - spec.characters[2].pos[2]) > .7);
  assert.ok(report.warnings.some(s => s.includes('无可用座位')));
});
test('heldBy follows final character position and orientation', () => {
  const { spec } = solve([{ id: 'phone', type: 'phone', heldBy: 'person' }], [{ id: 'person', at: at(4, 4), facing: 'away' }]);
  assert.ok(Math.hypot(spec.props[0].pos[0] - 4, spec.props[0].pos[2] - 4) < .5);
  close(spec.props[0].rotY, spec.characters[0].rotY);
});
test('cycles and missing references degrade visibly and terminate', () => {
  const { spec, report } = solve([{ id: 'a', type: 'teacup', on: 'b' }, { id: 'b', type: 'crate', on: 'a' }, { id: 'c', type: 'phone', heldBy: 'missing' }]);
  assert.ok(report.warnings.some(s => s.includes('成环')));
  assert.ok(report.warnings.some(s => s.includes('missing')));
  for (const p of spec.props) assert.ok(p.pos.every(Number.isFinite));
});
test('collision movement keeps seated person attached to its chair', () => {
  const { spec } = solve([{ id: 'chair', type: 'chair', at: at(3, 2) }, { id: 'table', type: 'table', at: at(3, 2) }], [{ id: 'person', sitOn: 'chair' }]);
  close(spec.characters[0].pos[0], spec.props[0].pos[0]); close(spec.characters[0].pos[2], spec.props[0].pos[2]);
});
test('geometry overlap respects vertical separation, narrow axes and rotation', () => {
  const { worldBounds, boundsOverlap } = require('../src/theater/generated/layout/bounds.ts');
  const n = { kind: 'prop', id: 'a', sem: { type: 'table' }, x: 0, y: 0, z: 0, rotY: 0, scale: 1, box: { hw: 2, hd: .1, h: .5, top: .5, cx: 1 }, supportY: 0, onSupport: false };
  assert.equal(boundsOverlap(n, { ...n, y: .5 }), null);
  assert.equal(boundsOverlap(n, { ...n, z: .4 }), null);
  assert.ok(boundsOverlap(n, { ...n, x: .2 }));
  const rotated = worldBounds({ ...n, rotY: Math.PI / 2 });
  close(rotated.maxX - rotated.minX, .2);
  close(rotated.maxZ - rotated.minZ, 4);
  close((rotated.maxZ + rotated.minZ) / 2, -1);
});
test('residual overlap is unresolved, never reported as repaired', () => {
  const { runChecks } = require('../src/theater/generated/layout/validator.ts');
  const a = { kind: 'prop', id: 'a', sem: { type: 'crate' }, x: 0, y: 0, z: 0, rotY: 0, scale: 1, box: { hw: .5, hd: .5, h: .5, top: .5 }, supportY: 0, onSupport: false };
  const report = { warnings: [], fixes: [] };
  runChecks([a, { ...a, id: 'b' }], {}, report);
  assert.ok(report.issues.some(i => i.code === 'RESIDUAL_OVERLAP' && i.status === 'unresolved'));
  assert.ok(!report.fixes.some(s => s.includes('残余穿模')));
});
test('unsupported sitOn reports degradation instead of silently sitting on a roof', () => {
  const { spec, report } = solve([{ id: 'table', type: 'table' }], [{ id: 'person', sitOn: 'table' }]);
  assert.equal(spec.characters[0].pose, 'standing');
  assert.ok(report.issues.some(i => i.code === 'RELATION_DEGRADED'));
});
test('rendered hand prop follows animated skeleton at different character scales', () => {
  const THREE = require('three');
  const { assembleScene } = require('../src/theater/generated/assemble.ts');
  for (const type of ['child', 'adult']) {
    const scene = assembleScene({ env: { mode: 'indoor', time: 'day' },
      props: [{ id: 'phone', type: 'phone', heldBy: 'person' }],
      characters: [{ id: 'person', type, pose: 'handingItem', pos: [4, 0, 4], rotY: 1.2 }],
    });
    let fig, prop;
    scene.group.traverse(o => {
      if (o.userData.sceneObjectId === 'person') fig = o;
      if (o.userData.sceneObjectId === 'phone') prop = o;
    });
    assert.ok(fig && prop);
    const centerLocal = prop.position.clone().multiplyScalar(-1).divide(prop.scale);
    let previous;
    let moved = false;
    for (const t of [0, .25, .75, 1.5]) {
      scene.update(t); scene.group.updateMatrixWorld(true);
      const hand = fig.userData.handAnchor.getWorldPosition(new THREE.Vector3());
      const grip = prop.localToWorld(centerLocal.clone());
      assert.ok(hand.distanceTo(grip) < .00001, 'grip must track actual hand, not a fixed world offset');
      if (previous && hand.distanceTo(previous) > .001) moved = true;
      previous = hand;
    }
    assert.ok(moved, 'fixture must exercise real animation');
    const geometries = new Set(), materials = new Set();
    scene.group.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of [].concat(o.material || [])) materials.add(m); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
});
console.log(`${passed} layout regressions passed`);
