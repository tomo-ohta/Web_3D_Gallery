// ギャラリー全体を 1 枚の自己完結 HTML にまとめる。
// アーティファクト公開は外部ホストへの通信が遮断されるため、
// スクリプト・スタイル・モデル・HDRI をすべて埋め込む（フォントのみ Google Fonts を許可）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist-single');
const artifactDir = path.join(root, 'artifact');

console.log('› preparing lightweight assets…');
execFileSync('node', [path.join(root, 'tools', 'prepare-artifact-assets.mjs')], { cwd: root, stdio: 'inherit' });

console.log('› building single-chunk bundle…');
execFileSync('npx', ['vite', 'build'], {
  cwd: root,
  env: { ...process.env, LUMINA_SINGLE: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

// --- ビルド成果物を読む ---
const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const assetsDir = path.join(outDir, 'assets');
const files = fs.readdirSync(assetsDir);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
const js = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
const css = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');

// --- 埋め込みアセット（AssetCache のキーに対応させる） ---
const ASSETS = {
  studio: 'artifact-assets/studio.hdr',
  venice: 'artifact-assets/venice.hdr',
  night: 'artifact-assets/night.hdr',
  helmet: 'artifact-assets/helmet.glb',
  fox: 'artifact-assets/fox.glb',
  // ドラゴンは配信版がすでに量子化済みなのでそのまま使う
  dragon: 'public/assets/models/dragon.bin',
};
const inline = {};
let assetBytes = 0;
for (const [key, rel] of Object.entries(ASSETS)) {
  const buf = fs.readFileSync(path.join(root, rel));
  assetBytes += buf.length;
  inline[key] = buf.toString('base64');
  console.log(`  · ${key.padEnd(7)} ${(buf.length / 1024).toFixed(0).padStart(5)}KB`);
}

// --- body 内のマークアップだけを取り出す ---
const bodyInner = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const markup = bodyInner
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .trim();

// インライン化するテキストの中に終了タグが現れても壊れないようにする
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const page = `<title>LUMINA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&family=Syne:wght@800&family=Zen+Kaku+Gothic+New:wght@400;700&display=swap">
<style>
${css}
</style>

${markup}

<script>window.__LUMINA_ASSETS=${safe(JSON.stringify(inline))};</script>
<script type="module">
${safe(js)}
</script>
`;

fs.mkdirSync(artifactDir, { recursive: true });
const outPath = path.join(artifactDir, 'lumina.html');
fs.writeFileSync(outPath, page);

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
console.log(
  `\n› ${path.relative(root, outPath)}\n` +
    `  markup+css ${mb(markup.length + css.length)} · script ${mb(js.length)} · assets ${mb(assetBytes)} (base64 ${mb(
      assetBytes * 1.34,
    )})\n` +
    `  total ${mb(fs.statSync(outPath).size)}  / 16.00MB limit`,
);
