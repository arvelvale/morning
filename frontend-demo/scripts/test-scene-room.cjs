// 单房间骨架 + 校验回传环。Run with: node scripts/test-scene-room.cjs（不需要渲染器，也不调用模型）
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, f);
const G = '../src/theater/generated/';
const { solveLayout } = require(G + 'layout/solve.ts');
const { SEMANTIC_FIXTURES } = require(G + 'layout/fixtures.ts');
const { normalizeRoom, roomInterior, openingRect } = require(G + 'layout/room.ts');
const { worldBounds } = require(G + 'layout/bounds.ts');
const review = require(G + 'layout/review.ts');
const { assembleAnySpec } = require(G + 'auto.ts');
const THREE = require('three');

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const unresolved = (report) => (report.issues ?? []).filter(i => i.status !== 'repaired');
const codes = (report) => (report.issues ?? []).map(i => i.code);
const room0 = { width: 5, depth: 4, height: 2.8, openings: [{ kind: 'door', wall: 'left', offset: -0.6, width: 0.95 }, { kind: 'window', wall: 'back', offset: 0.2, width: 1.2 }] };
const base = (props, characters = [], room = room0) => ({ kind: 'semantic', env: { mode: 'indoor', time: 'day' }, room, props, characters });
// 把解算结果当成节点，量真实世界包围盒（只对非房间零件）
function boundsOf(spec, id) {
  const solved = solveLayout(spec).spec;
  const p = solved.props.find(q => q.id === id);
  const node = { kind: 'prop', id, sem: p, x: p.pos[0], y: p.pos[1], z: p.pos[2], rotY: p.rotY, scale: p.scale ?? 1 };
  const { measureProp } = require(G + 'layout/propMeta.ts');
  node.box = measureProp(p.type, p.params, node.scale, new Map());
  return worldBounds(node);
}

test('normalizeRoom clamps sizes, remaps hidden walls, and reports dropped openings', () => {
  const { room, notes } = normalizeRoom({ width: 99, depth: 1, height: 9, wallColor: 'red', openings: [
    { kind: 'door', wall: 'right', offset: 0 },                  // 右墙不画 → 改到后墙，记 repaired
    { kind: 'window', wall: 'back', offset: 0.1, width: 1.2 },    // 与门重叠 → 丢弃
    { kind: 'window', wall: 'left', width: 9 },                   // 太宽 → 钳到 2.4m 仍放得下
    { kind: 'sofa' },                                             // 不是洞口 → 丢弃
  ] });
  assert.equal(room.width, 9); assert.equal(room.depth, 3); assert.equal(room.height, 3.4);
  assert.equal(room.wallColor, '#e2d4bc', '非 #RRGGBB 颜色回落默认');
  assert.deepEqual(room.openings.map(o => [o.kind, o.wall, o.width]), [['door', 'back', 1], ['window', 'left', 2.4]]);
  assert.deepEqual(notes.map(n => [n.code, n.status]), [['ROOM_OPENING_REMAPPED', 'repaired'], ['ROOM_OPENING_DROPPED', 'degraded'], ['ROOM_OPENING_DROPPED', 'degraded']]);
});

test('study-night fixture solves clean: every free prop inside the walls, desk flush to the back wall', () => {
  const sem = SEMANTIC_FIXTURES.studyNight;
  const { spec, report } = solveLayout(sem);
  assert.deepEqual(unresolved(report).map(i => i.code), [], '夹具本身不应留下未解决问题');
  const { room } = normalizeRoom(sem.room), inside = roomInterior(room);
  for (const p of sem.props) {
    if (p.on || p.type === 'rug') continue;
    const b = boundsOf(sem, p.id);
    assert.ok(b.minX >= inside.minX - 1e-3 && b.maxX <= inside.maxX + 1e-3 && b.minZ >= inside.minZ - 1e-3 && b.maxZ <= inside.maxZ + 1e-3, p.id + ' 超出墙');
  }
  assert.ok(Math.abs(boundsOf(sem, 'desk1').minZ - inside.minZ) < 0.02, '书桌背面贴后墙');
  assert.ok(Math.abs(boundsOf(sem, 'bed1').minX - inside.minX) < 0.02, '床靠左墙');
  assert.ok(spec.props.some(p => p.type === 'room'), '房间作为零件进入拼装');
});

test('at.edge faces into the room on every wall; same spec solves identically twice', () => {
  const mk = (edge) => base([{ id: 'c', type: 'cabinet', at: { zone: 'midground', side: 'center', edge } }]);
  const rot = (edge) => solveLayout(mk(edge)).spec.props.find(p => p.id === 'c').rotY;
  assert.equal(rot('back'), 0);
  assert.ok(Math.abs(rot('left') - Math.PI / 2) < 1e-3);
  assert.ok(Math.abs(rot('right') + Math.PI / 2) < 1e-3);
  const { room } = normalizeRoom(room0);
  assert.ok(Math.abs(boundsOf(mk('right'), 'c').maxX - room.width / 2) < 0.02);
  assert.deepEqual(solveLayout(mk('left')).spec, solveLayout(mk('left')).spec);
});

test('a curtain with no at.edge snaps onto the window wall, aligned with the window', () => {
  const sem = base([{ id: 'cu', type: 'curtain' }]);
  const { room } = normalizeRoom(room0), win = room.openings.find(o => o.kind === 'window');
  const c = solveLayout(sem).spec.props.find(p => p.id === 'cu');
  assert.ok(Math.abs(c.pos[0] - win.u) < 0.05, `窗帘 x=${c.pos[0]} 应对齐窗 u=${win.u}`);
  assert.ok(Math.abs(boundsOf(sem, 'cu').minZ + room.depth / 2) < 0.02, '窗帘背面贴后墙');
});

test('at.edge without a room is reported, not silently ignored', () => {
  const { report } = solveLayout({ kind: 'semantic', env: { mode: 'indoor', time: 'day' }, props: [{ id: 'c', type: 'cabinet', at: { zone: 'midground', side: 'center', edge: 'back' } }] });
  assert.ok(report.issues.some(i => i.code === 'EDGE_WITHOUT_ROOM' && i.status === 'degraded'));
});

test('furniture in front of a door is DOOR_BLOCKED, but a person standing in the doorway is not', () => {
  const { room } = normalizeRoom(room0), door = room.openings.find(o => o.kind === 'door'), r = openingRect(room, door);
  const cx = r.maxX + 0.45, cz = (r.minZ + r.maxZ) / 2;
  const blocked = solveLayout(base([{ id: 'bed', type: 'bed', at: { zone: 'midground', side: 'center', bias: [cx + 0.5, cz] } }]));
  assert.ok(codes(blocked.report).includes('DOOR_BLOCKED'), codes(blocked.report).join());
  const person = solveLayout(base([], [{ id: 'p', pose: 'standing', at: { zone: 'midground', side: 'center', bias: [cx, cz] } }]));
  assert.ok(!codes(person.report).includes('DOOR_BLOCKED'));
});

test('a tall bookshelf pushed against the window wall is WINDOW_BLOCKED; a low cabinet is not', () => {
  const win = base([{ id: 's', type: 'bookshelf', at: { zone: 'background', side: 'center', edge: 'back', bias: [0.8, 0] } }]);
  assert.ok(codes(solveLayout(win).report).includes('WINDOW_BLOCKED'));
  const low = base([{ id: 's', type: 'cabinet', at: { zone: 'background', side: 'center', edge: 'back', bias: [0.8, 0] } }]);
  assert.ok(!codes(solveLayout(low).report).includes('WINDOW_BLOCKED'));
});

test('an object larger than the room is reported as ROOM_OBJECT_TOO_BIG', () => {
  const { report } = solveLayout(base([{ id: 't', type: 'table', params: { width: 8, depth: 1 }, at: { zone: 'midground', side: 'center' } }]));
  assert.ok(codes(report).includes('ROOM_OBJECT_TOO_BIG'));
});

test('hung props keep their builder height (window used to be placed at y=-1.13, under the floor)', () => {
  const sc = assembleAnySpec({ kind: 'semantic', env: { mode: 'outdoor', time: 'day' }, props: [{ id: 'w', type: 'window', at: { zone: 'midground', side: 'center', bias: [0, 0] } }] });
  let win; sc.group.traverse(o => { if (o.userData.sceneObjectId === 'w') win = o; });
  const box = new THREE.Box3().setFromObject(win);
  assert.ok(box.min.y > 1.0 && box.max.y < 2.8, `窗应该在 1m 以上，实际 ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
});

test('assembled room has real wall openings and a handful of meshes', () => {
  const sc = assembleAnySpec(SEMANTIC_FIXTURES.studyNight);
  let roomObj; sc.group.traverse(o => { if (o.userData.sceneObjectId === '__room') roomObj = o; });
  assert.ok(roomObj, '房间对象在场景里');
  let meshes = 0, tris = 0;
  roomObj.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  assert.ok(meshes <= 30 && tris <= 2500, `房间应该很轻：${meshes} mesh / ${tris} 三角形`);
  assert.deepEqual(roomObj.children.filter(c => c.name === 'room-door' || c.name === 'room-window').map(c => c.name).sort(), ['room-door', 'room-window']);
});

// ── 回传环 ──
const bedInDoor = () => {
  const { room } = normalizeRoom(room0), door = room.openings.find(o => o.kind === 'door'), r = openingRect(room, door);
  return base([{ id: 'bed', type: 'bed', at: { zone: 'midground', side: 'center', bias: [r.maxX + 1, (r.minZ + r.maxZ) / 2] } }], [{ id: 'me', pose: 'standing' }]);
};

test('review score counts only open, fixable issues', () => {
  const issues = [
    { code: 'DOOR_BLOCKED', objectIds: ['a'], status: 'unresolved' },
    { code: 'RESIDUAL_OVERLAP', objectIds: ['a', 'b'], status: 'repaired' },          // 已修好 → 不算
    { code: 'CAMERA_FRAMING_REVIEW', objectIds: ['a'], status: 'unresolved' },        // 引擎自己的事 → 不算
    { code: 'RELATION_NOT_APPLIED_sitOn', objectIds: ['a', 'b'], status: 'degraded' },
  ];
  assert.equal(review.reviewScore({ issues }), 3 + 2);
  assert.deepEqual(review.reviewItems({ issues }).map(i => i.code), ['DOOR_BLOCKED', 'RELATION_NOT_APPLIED_sitOn']);
});

test('review loop accepts a fix that lowers the score and records the rounds', async () => {
  const start = bedInDoor();
  assert.ok(review.reviewScore(solveLayout(start).report) > 0);
  let asked;
  const out = await review.reviewSpec(start, { revise: async (spec, items, round) => {
    asked = { ids: items.flatMap(i => i.ids), round };
    return { ...spec, props: spec.props.map(p => p.id === 'bed' ? { ...p, at: { zone: 'midground', side: 'center', edge: 'right' } } : p) };
  } });
  assert.deepEqual(asked.ids.slice(0, 1), ['bed']); assert.equal(asked.round, 1);
  assert.equal(out.after, 0); assert.ok(out.before > 0);
  assert.deepEqual(out.spec.review, { rounds: 1, before: out.before, after: 0 });
  assert.equal(out.spec.props[0].at.edge, 'right');
});

test('review loop rejects candidates that are worse, equal, or delete a person; never exceeds 2 rounds', async () => {
  const start = bedInDoor();
  const mk = (f) => async (spec) => f(spec);
  const worse = await review.reviewSpec(start, { revise: mk(s => ({ ...s, props: [...s.props, { id: 'b2', type: 'bed', at: s.props[0].at }] })) });
  assert.deepEqual(worse.spec.props, start.props); assert.equal(worse.rounds, 2);
  const same = await review.reviewSpec(start, { revise: mk(s => ({ ...s })) });
  assert.equal(same.after, same.before);
  const killer = await review.reviewSpec(start, { revise: mk(s => ({ ...s, characters: [], props: [] })) });
  assert.equal(killer.spec.characters.length, 1, '人物不能被改没');
  assert.ok(killer.log.some(l => l.includes('删掉了人物')));
  const flip = await review.reviewSpec(start, { revise: mk(s => ({ ...s, env: { ...s.env, time: 'night' }, props: [] })) });
  assert.equal(flip.spec.env.time, 'day');
  let calls = 0;
  const third = await review.reviewSpec({ ...start, review: { rounds: 2 } }, { revise: async () => { calls++; return null; } });
  assert.equal(calls, 0, '已经改满两轮，不再请求模型'); assert.equal(third.rounds, 0);
});

test('review loop survives a failing or empty model response', async () => {
  const start = bedInDoor();
  const boom = await review.reviewSpec(start, { revise: async () => { throw new Error('网络断了'); } });
  assert.deepEqual(boom.spec.props, start.props); assert.ok(boom.log[0].includes('失败'));
  const none = await review.reviewSpec(start, { revise: async () => null });
  assert.equal(none.rounds, 2);
  assert.equal(review.needsReview(none.spec, 5), false, '已记录改满，下次打开不再重复烧模型');
});

(async () => {
  for (const [name, fn] of queue) { await fn(); passed++; console.log('PASS ' + name); }
  console.log(passed + ' room/review tests passed');
})().catch(e => { console.error(e); process.exit(1); });
