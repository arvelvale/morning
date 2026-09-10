const fs = require('node:fs'), assert = require('node:assert/strict'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, f);
const THREE = require('three');
const { assembleAnySpec } = require('../src/theater/generated/auto.ts');
const { SCENE_SAMPLES } = require('../src/theater/generated/samples.ts');
const { SEMANTIC_FIXTURES } = require('../src/theater/generated/layout/fixtures.ts');
const { frameSubjects } = require('../src/theater/generated/vision/framing.ts');
const { buildProp, PROP_TYPES } = require('../src/theater/generated/props/index.ts');
const { MOOD_PRESETS, buildMoodRig } = require('../src/theater/generated/vision/mood.ts');
function dispose(root) {
  const geo = new Set(), mat = new Set();
  root.traverse(o => { if (o.geometry) geo.add(o.geometry); for (const m of [].concat(o.material ?? [])) if (!m.userData.__shared) mat.add(m); });
  geo.forEach(g => g.dispose()); mat.forEach(m => m.dispose());
}
let projections = 0, worstNdc = 0;
for (const [name, spec] of Object.entries({...SCENE_SAMPLES, ...Object.fromEntries(Object.entries(SEMANTIC_FIXTURES).map(([k,v])=>['sem_'+k,v]))})) {
  const scene = assembleAnySpec(spec), original = JSON.stringify(spec);
  for (const aspect of [390/844, 1440/900, 844/390]) {
    const framing = frameSubjects(scene.camera, scene.framing, aspect);
    const cam = new THREE.PerspectiveCamera(50, aspect, .1, 400);
    cam.position.set(...framing.pos); cam.lookAt(...framing.look); cam.updateMatrixWorld(true);
    for (const t of [0,.25,1,2]) {
      scene.update(t); scene.group.updateMatrixWorld(true);
      for (const subject of scene.framing.subjects) {
        const b = new THREE.Box3().setFromObject(subject);
        for (const x of [b.min.x,b.max.x]) for (const y of [b.min.y,b.max.y]) for (const z of [b.min.z,b.max.z]) {
          const p = new THREE.Vector3(x,y,z).project(cam);
          worstNdc = Math.max(worstNdc, Math.abs(p.x), Math.abs(p.y));
          assert.ok(Math.abs(p.x) <= .9 && Math.abs(p.y) <= .9 && p.z > -1 && p.z < 1, `${name}: subject clipped ${p.toArray()}`);
        }
      }
      projections++;
    }
  }
  assert.equal(JSON.stringify(spec), original, 'framing mutated persisted scene');
  dispose(scene.group);
}
// Cone tips/side caps must not collapse into a disk, and equal params retain equal geometry.
for (const height of [1.5,3.5,5]) {
  const a = buildProp('pineTree',{height}), b = buildProp('pineTree',{height});
  const cones = a.children.filter(o => o.geometry?.type === 'ConeGeometry');
  for (const c of cones) {
    c.geometry.computeBoundingBox();
    const h = c.geometry.boundingBox.max.y - c.geometry.boundingBox.min.y;
    assert.ok(h >= c.geometry.parameters.height * .98, 'collapsed tree crown');
  }
  a.children.forEach((o,i)=> { if(o.geometry) assert.deepEqual(o.geometry.attributes.position.array,b.children[i].geometry.attributes.position.array); });
  dispose(a); dispose(b);
}
// Visible surface ray tests distinguish real cavities from hidden decorative meshes.
const cup = buildProp('teacup'); cup.updateMatrixWorld(true);
const ray = new THREE.Raycaster(new THREE.Vector3(0,.3,0), new THREE.Vector3(0,-1,0));
assert.ok(Math.abs(ray.intersectObject(cup,true)[0].point.y - .079) < .0001, 'tea hidden by ceramic cap');
dispose(cup);
const book = buildProp('book'); book.updateMatrixWorld(true);
ray.set(new THREE.Vector3(.3,.017,0),new THREE.Vector3(-1,0,0));
assert.ok(Math.abs(ray.intersectObject(book,true)[0].point.x - .072) < .0001, 'pages hidden inside solid cover');
dispose(book);
const tent = buildProp('tent'); tent.updateMatrixWorld(true);
ray.set(new THREE.Vector3(2,.4,0),new THREE.Vector3(-1,0,0));
assert.ok(ray.intersectObject(tent,true)[0].point.x < 0, 'tent entrance is sealed');
dispose(tent);
const fire = buildProp('campfire'); fire.userData.update(1);
const before = fire.children.filter(o=>o.isMesh).map(o=>o.rotation.y);
fire.userData.update(5); fire.userData.update(1);
assert.deepEqual(fire.children.filter(o=>o.isMesh).map(o=>o.rotation.y),before,'frame-rate-dependent fire rotation');
dispose(fire);
for (const mood of ['night_calm','rainy_night','campfire_night','cozy_indoor_night']) {
  const rig = buildMoodRig(MOOD_PRESETS[mood]);
  assert.ok(rig.hemi.color.r + rig.hemi.color.g + rig.hemi.color.b > 1, 'night fill uses near-black light color');
  assert.ok(rig.key.castShadow && !rig.fill.castShadow, 'additional shadow cost');
}
const inventory = {};
for (const type of PROP_TYPES) {
  const obj = buildProp(type); let meshes=0,triangles=0;
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite),type);
    if(o.isMesh) {meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}
  });
  inventory[type]={meshes,triangles}; dispose(obj);
}
console.log('VISUAL_ACCEPTANCE', JSON.stringify({projections,worstNdc,propTypes:PROP_TYPES.length,refined:Object.fromEntries(['pineTree','tent','campfire','chair','table','bench','book','teacup'].map(k=>[k,inventory[k]]))}));
