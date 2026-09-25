// 把角色运行时 src/pets/rig/pet-rig.js 同步到各处：
//   - src/pets/rig/petRigSource.generated.ts（原生端 WebView 内嵌用的字符串）
//   - ../landing/public/pet-rig.js（官网首屏短片）
//   - ../design-demos/pet-motion/pet-rig.js（设计演示页）
// 改运行时只改源文件，然后运行 `npm run rig:build`。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const src = readFileSync(resolve(app, 'src/pets/rig/pet-rig.js'), 'utf8');

writeFileSync(
  resolve(app, 'src/pets/rig/petRigSource.generated.ts'),
  '// 自动生成，勿手改：源文件是 ./pet-rig.js，运行 `npm run rig:build` 重新生成。\n'
    + `export const PET_RIG_SOURCE: string = ${JSON.stringify(src)};\n`,
);
for (const rel of ['../landing/public/pet-rig.js', '../design-demos/pet-motion/pet-rig.js']) {
  const out = resolve(app, rel);
  if (existsSync(dirname(out))) writeFileSync(out, src);
}
console.log(`pet-rig synced (${(src.length / 1024).toFixed(1)} KB)`);
