// Radiance .hdr を読み込み、線形空間でボックス縮小して RGBE で書き出す。
// アーティファクト同梱用にサイズを落とすためのビルド専用ツール（依存なし）。
import fs from 'node:fs';
import path from 'node:path';

function parseHDR(buf) {
  // --- ヘッダ ---
  let pos = 0;
  const readLine = () => {
    let s = '';
    while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]);
    pos++;
    return s;
  };
  if (!readLine().startsWith('#?')) throw new Error('not a radiance file');
  let line;
  while ((line = readLine()) !== '') {
    /* FORMAT / EXPOSURE などは読み飛ばす */
  }
  const res = readLine().match(/-Y (\d+) \+X (\d+)/);
  if (!res) throw new Error('unsupported resolution line');
  const height = parseInt(res[1], 10);
  const width = parseInt(res[2], 10);

  // --- スキャンライン（フラット / アダプティブRLE 両対応） ---
  const rgbe = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    if (width < 8 || width > 0x7fff || buf[pos] !== 2 || buf[pos + 1] !== 2 || (buf[pos + 2] & 0x80) !== 0) {
      // フラット
      for (let x = 0; x < width; x++) {
        rgbe[rowOff + x * 4] = buf[pos++];
        rgbe[rowOff + x * 4 + 1] = buf[pos++];
        rgbe[rowOff + x * 4 + 2] = buf[pos++];
        rgbe[rowOff + x * 4 + 3] = buf[pos++];
      }
      continue;
    }
    pos += 4;
    // 4 チャンネルを別々に RLE 展開
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        const count = buf[pos++];
        if (count > 128) {
          const val = buf[pos++];
          for (let k = 0; k < count - 128; k++) rgbe[rowOff + (x++) * 4 + c] = val;
        } else {
          for (let k = 0; k < count; k++) rgbe[rowOff + (x++) * 4 + c] = buf[pos++];
        }
      }
    }
  }
  return { width, height, rgbe };
}

function rgbeToFloat(rgbe, n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const e = rgbe[i * 4 + 3];
    const f = e === 0 ? 0 : Math.pow(2, e - 136); // 2^(e-128) / 256
    out[i * 3] = rgbe[i * 4] * f;
    out[i * 3 + 1] = rgbe[i * 4 + 1] * f;
    out[i * 3 + 2] = rgbe[i * 4 + 2] * f;
  }
  return out;
}

function boxDownsample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh * 3);
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
          const i = (sy * sw + sx) * 3;
          r += src[i]; g += src[i + 1]; b += src[i + 2];
          n++;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function floatToRGBE(f, n) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = f[i * 3], g = f[i * 3 + 1], b = f[i * 3 + 2];
    const m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    let e = Math.ceil(Math.log2(m));
    e = Math.max(-128, Math.min(127, e));
    const scale = Math.pow(2, -e) * 256;
    out[i * 4] = Math.min(255, Math.max(0, Math.round(r * scale)));
    out[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(g * scale)));
    out[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(b * scale)));
    out[i * 4 + 3] = e + 128;
  }
  return out;
}

const [, , inPath, outPath, wArg] = process.argv;
const targetW = parseInt(wArg ?? '512', 10);
const src = parseHDR(fs.readFileSync(inPath));
const lin = rgbeToFloat(src.rgbe, src.width * src.height);
const targetH = Math.max(1, Math.round((targetW * src.height) / src.width));
const small = boxDownsample(lin, src.width, src.height, targetW, targetH);
const outRGBE = floatToRGBE(small, targetW * targetH);

const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${targetH} +X ${targetW}\n`, 'ascii');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, Buffer.from(outRGBE)]));
console.log(
  `${path.basename(inPath)}: ${src.width}x${src.height} -> ${targetW}x${targetH}  ` +
    `${(fs.statSync(inPath).size / 1048576).toFixed(2)}MB -> ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB`,
);
