// Procedural model acceptance: node scripts/test-figure-model.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, f);
const THREE = require('three');
const { createFigure } = require('../src/theater/figure/index.ts');
const { TYPE_PRESETS } = require('../src/theater/figure/presets.ts');
let cases = 0, maxTriangles = 0, maxMeshes = 0;
for (const type of Object.keys(TYPE_PRESETS)) for (const hairstyle of ['short','long','ponytail','bun']) {
  for (const outfit of ['casual','uniform','coat','skirt']) for (const pose of ['standing','walking','crying','arguing','waving']) {
    const fig = createFigure({ type, hairstyle, outfit, pose });
    let meshes = 0, triangles = 0;
    const shoes = [];
    fig.traverse(o => {
      if (!o.isMesh) return;
      meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      if (o.name.startsWith('shoe-')) shoes.push(o);
    });
    assert.equal(shoes.length, 2);
    const face = fig.getObjectByName('face');
    assert.equal(face.userData.expression, pose === 'crying' ? 'downcast' : pose === 'arguing' ? 'speaking' : pose === 'waving' ? 'gentle' : 'attentive');
    assert.equal(face.scale.x, TYPE_PRESETS[type].headScale);
    fig.updateMatrixWorld(true);
    const before = shoes[0].getWorldPosition(new THREE.Vector3());
    for (const t of [0,.25,.5,1,4.6]) {
      fig.userData.update(t); fig.updateMatrixWorld(true);
      fig.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
      const box = new THREE.Box3().setFromObject(fig);
      assert.ok(box.max.y - box.min.y < 2.5, 'unexpected model dimensions');
    }
    if (pose === 'walking') assert.ok(before.distanceTo(shoes[0].getWorldPosition(new THREE.Vector3())) > .01);
    // Upper limits are geometry budgets, not a claim of measured GPU frame rate.
    // 2026-10：三角形预算 3400 → 5600。人物重做后脸（眼睛高光/眉/腮红）、手（拇指）、鞋（鞋底）、
    // 圆润的头和四肢都有了真实造型；同一部件合并成顶点色 mesh，mesh 数反而从 ≤36 降到 ≤28。
    // 一个场景最多 3 个人物，合计仍远低于移动端的几何预算。
    assert.ok(meshes <= 28 && triangles <= 5600, `${meshes} meshes / ${triangles} triangles`);
    maxMeshes = Math.max(maxMeshes, meshes); maxTriangles = Math.max(maxTriangles, triangles);
    const geos = new Set(), mats = new Set();
    fig.traverse(o => { if (o.isMesh) { geos.add(o.geometry); mats.add(o.material); } });
    geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose());
    cases++;
  }
}
console.log('FIGURE_ACCEPTANCE', JSON.stringify({ cases, maxMeshes, maxTriangles }));
const turning = createFigure({ pose: 'lookingBack' });
const head = turning.getObjectByName('face').parent;
for (const t of [0, 1, 5]) {
  turning.userData.update(t);
  assert.ok(Math.abs(head.rotation.y - 2.4) <= .055001, 'idle erased lookingBack pose');
}
console.log('PASS idle preserves authored lookingBack orientation');
