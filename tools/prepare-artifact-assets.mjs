// 単一ファイル版（アーティファクト）用に、配信アセットを縮小した一式を作る。
// 配信版はフル品質のまま。ここで作った軽量版は build-artifact.mjs だけが使う。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifact-assets');
const run = (script, ...args) =>
  execFileSync('node', [path.join(root, 'tools', script), ...args], { cwd: root, stdio: 'inherit' });

const TARGETS = [
  ['studio.hdr', () => run('shrink-hdri.mjs', 'public/assets/hdri/studio.hdr', 'artifact-assets/studio.hdr', '512')],
  ['venice.hdr', () => run('shrink-hdri.mjs', 'public/assets/hdri/venice.hdr', 'artifact-assets/venice.hdr', '512')],
  ['night.hdr', () => run('shrink-hdri.mjs', 'public/assets/hdri/night.hdr', 'artifact-assets/night.hdr', '512')],
  ['helmet.glb', () => run('shrink-glb.mjs', 'public/assets/models/helmet.glb', 'artifact-assets/helmet.glb')],
  ['fox.glb', () => run('shrink-glb.mjs', 'public/assets/models/fox.glb', 'artifact-assets/fox.glb', '--keep-size')],
];

const force = process.argv.includes('--force');
fs.mkdirSync(out, { recursive: true });
for (const [name, build] of TARGETS) {
  const dst = path.join(out, name);
  if (!force && fs.existsSync(dst)) {
    console.log(`  · ${name} は生成済み（--force で作り直す）`);
    continue;
  }
  build();
}
console.log('artifact-assets/ を用意しました');
