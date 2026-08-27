// GLB のテクスチャを縮小して再エンコードし、画像を data: URI として埋め込み直す。
//
// 画像を bufferView に残すと GLTFLoader が blob: URL を作って読み込むため、
// アーティファクトの CSP で遮断される恐れがある。data: URI なら埋め込み資産として扱われる。
//
//   node tools/shrink-glb.mjs <in.glb> <out.glb> [--keep-size]
import fs from 'node:fs';
import jpeg from 'jpeg-js';

const [, , inPath, outPath, ...flags] = process.argv;
const keepSize = flags.includes('--keep-size');

// 用途ごとの解像度: baseColor と normal は残し、補助マップは大きく落とす
const SIZES = { baseColor: 1024, normal: 1024, other: 512 };
const QUALITY = { baseColor: 80, normal: 82, other: 74 };

const buf = fs.readFileSync(inPath);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8;
const bin = buf.slice(binOff, binOff + buf.readUInt32LE(20 + jsonLen));

// どの画像がどの役割かを material から判定
const roleOf = new Map();
for (const mat of gltf.materials ?? []) {
  const pbr = mat.pbrMetallicRoughness ?? {};
  const mark = (texInfo, role) => {
    if (!texInfo) return;
    const img = gltf.textures[texInfo.index].source;
    if (!roleOf.has(img)) roleOf.set(img, role);
  };
  mark(pbr.baseColorTexture, 'baseColor');
  mark(mat.normalTexture, 'normal');
  mark(pbr.metallicRoughnessTexture, 'other');
  mark(mat.occlusionTexture, 'other');
  mark(mat.emissiveTexture, 'other');
}

function boxResize(data, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.min(sh, Math.ceil((y + 1) * fy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.min(sw, Math.ceil((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

// --- 画像を data: URI へ移し、その bufferView は捨てる ---
const droppedViews = new Set();
gltf.images.forEach((im, i) => {
  if (im.bufferView === undefined) return;
  const bv = gltf.bufferViews[im.bufferView];
  let data = bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  let mime = im.mimeType;
  if (!keepSize && mime === 'image/jpeg') {
    const role = roleOf.get(i) ?? 'other';
    const raw = jpeg.decode(data, { useTArray: true });
    const target = Math.min(SIZES[role], raw.width);
    const enc = jpeg.encode({ data: boxResize(raw.data, raw.width, raw.height, target, target), width: target, height: target }, QUALITY[role]);
    console.log(`  · img${i} [${role}] ${raw.width}px ${(data.length / 1024).toFixed(0)}KB -> ${target}px ${(enc.data.length / 1024).toFixed(0)}KB`);
    data = Buffer.from(enc.data);
  } else {
    console.log(`  · img${i} [as-is] ${(data.length / 1024).toFixed(0)}KB`);
  }
  droppedViews.add(im.bufferView);
  delete im.bufferView;
  delete im.mimeType;
  im.uri = `data:${mime};base64,${data.toString('base64')}`;
});

// --- 残った bufferView を詰め直し、参照を張り替える ---
const remap = new Map();
const chunks = [];
let offset = 0;
const pad4 = (n) => (n + 3) & ~3;
gltf.bufferViews.forEach((bv, i) => {
  if (droppedViews.has(i)) return;
  const data = bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  remap.set(i, chunks.length / 2);
  chunks.push(data, Buffer.alloc(pad4(data.length) - data.length));
  bv.byteOffset = offset;
  offset += pad4(data.length);
});
gltf.bufferViews = gltf.bufferViews.filter((_, i) => !droppedViews.has(i));
for (const acc of gltf.accessors ?? []) {
  if (acc.bufferView !== undefined) acc.bufferView = remap.get(acc.bufferView);
  if (acc.sparse) throw new Error('sparse accessor は未対応');
}
gltf.buffers = offset > 0 ? [{ byteLength: offset }] : [];

const newBin = Buffer.concat(chunks);
let jsonStr = JSON.stringify(gltf);
while (jsonStr.length % 4 !== 0) jsonStr += ' ';
const jsonBuf = Buffer.from(jsonStr, 'utf8');
const binPadded = Buffer.concat([newBin, Buffer.alloc(pad4(newBin.length) - newBin.length)]);

const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);
const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(jsonBuf.length, 0);
jsonHead.write('JSON', 4, 'ascii');
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(binPadded.length, 0);
binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"

fs.writeFileSync(outPath, Buffer.concat([header, jsonHead, jsonBuf, binHead, binPadded]));
console.log(`${inPath}: ${(buf.length / 1048576).toFixed(2)}MB -> ${(fs.statSync(outPath).size / 1048576).toFixed(2)}MB (images as data: URI)`);
