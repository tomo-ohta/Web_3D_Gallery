// DragonAttenuation.glb からドラゴンのメッシュだけを取り出し、
// 位置を int16、法線を int8 に量子化した独自フォーマットで書き出す。
// （背景の布メッシュと UV は Web Tech Demo では使わないので捨てる）
//
// フォーマット: magic "LDRG" | u32 vertCount | u32 idxCount | f32 bounds[6]
//              | i16 positions[vc*3] | i8 normals[vc*3] | u32 indices[ic]
import fs from 'node:fs';

const buf = fs.readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

const view = (accIdx) => {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const off = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const stride = bv.byteStride ?? compSize * nComp;
  const out = acc.componentType === 5126 ? new Float32Array(acc.count * nComp) : new Uint32Array(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nComp; c++) {
      const p = off + i * stride + c * compSize;
      out[i * nComp + c] =
        acc.componentType === 5126 ? buf.readFloatLE(p)
        : acc.componentType === 5125 ? buf.readUInt32LE(p)
        : acc.componentType === 5123 ? buf.readUInt16LE(p)
        : buf.readUInt8(p);
    }
  }
  return out;
};

const mesh = gltf.meshes.find((m) => /dragon/i.test(m.name));
if (!mesh) throw new Error('dragon mesh not found');
const prim = mesh.primitives[0];
const pos = view(prim.attributes.POSITION);
const nrm = view(prim.attributes.NORMAL);
const idx = view(prim.indices);
const vc = pos.length / 3;
const ic = idx.length;

// バウンディングボックス（int16 復元用）
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vc; i++) {
  for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c], pos[i * 3 + c]);
    hi[c] = Math.max(hi[c], pos[i * 3 + c]);
  }
}

const qPos = new Int16Array(vc * 3);
for (let i = 0; i < vc; i++) {
  for (let c = 0; c < 3; c++) {
    const t = (pos[i * 3 + c] - lo[c]) / Math.max(hi[c] - lo[c], 1e-9); // 0..1
    qPos[i * 3 + c] = Math.round(t * 65534) - 32767;
  }
}
const qNrm = new Int8Array(vc * 3);
for (let i = 0; i < vc; i++) {
  for (let c = 0; c < 3; c++) qNrm[i * 3 + c] = Math.max(-127, Math.min(127, Math.round(nrm[i * 3 + c] * 127)));
}
const qIdx = new Uint32Array(idx);

const head = Buffer.alloc(4 + 4 + 4 + 24);
head.write('LDRG', 0, 'ascii');
head.writeUInt32LE(vc, 4);
head.writeUInt32LE(ic, 8);
for (let c = 0; c < 3; c++) {
  head.writeFloatLE(lo[c], 12 + c * 4);
  head.writeFloatLE(hi[c], 24 + c * 4);
}
// インデックス（u32）を 4 バイト境界に揃える
const beforeIdx = head.length + qPos.byteLength + qNrm.byteLength;
const pad = Buffer.alloc((4 - (beforeIdx % 4)) % 4);
const out = Buffer.concat([head, Buffer.from(qPos.buffer), Buffer.from(qNrm.buffer), pad, Buffer.from(qIdx.buffer)]);
fs.writeFileSync(process.argv[3], out);
console.log(
  `dragon: verts=${vc} tris=${ic / 3}  ${(buf.length / 1048576).toFixed(2)}MB -> ${(out.length / 1048576).toFixed(2)}MB`,
);
