import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type EnvName = 'studio' | 'venice' | 'night';
export type ModelName = 'helmet' | 'fox';
type AssetKey = EnvName | ModelName | 'dragon';

/** 配信時のパス。単一ファイル版ではここではなく埋め込みデータが使われる */
const PATHS: Record<AssetKey, string> = {
  studio: 'assets/hdri/studio.hdr',
  venice: 'assets/hdri/venice.hdr',
  night: 'assets/hdri/night.hdr',
  helmet: 'assets/models/helmet.glb',
  fox: 'assets/models/fox.glb',
  dragon: 'assets/models/dragon.bin',
};

export interface EnvMap {
  /** PMREM 済み。scene.environment 用 */
  env: THREE.Texture;
  /** 元の equirect テクスチャ。scene.background 用 */
  bg: THREE.Texture;
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

/**
 * pack-dragon.mjs が書き出した量子化メッシュを復元する。
 * 位置は int16、法線は int8 に丸めてあるので実寸へ戻す。
 */
function decodeDragon(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'LDRG') throw new Error('unexpected dragon payload');
  const vc = dv.getUint32(4, true);
  const ic = dv.getUint32(8, true);
  const lo = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)];
  const hi = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];

  let off = 36;
  const qPos = new Int16Array(buf, off, vc * 3);
  off += vc * 6;
  const qNrm = new Int8Array(buf, off, vc * 3);
  off += vc * 3;
  off = (off + 3) & ~3; // u32 の境界合わせ
  const idx = new Uint32Array(buf, off, ic);

  const pos = new Float32Array(vc * 3);
  for (let i = 0; i < vc; i++) {
    for (let c = 0; c < 3; c++) {
      const t = (qPos[i * 3 + c] + 32767) / 65534;
      pos[i * 3 + c] = lo[c] + t * (hi[c] - lo[c]);
    }
  }
  const nrm = new Float32Array(vc * 3);
  for (let i = 0; i < vc * 3; i++) nrm[i] = qNrm[i] / 127;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
  return geo;
}

/** HDRI / glTF を共有キャッシュする。PMREM は単一 renderer から生成 */
export class AssetCache {
  private pmrem: THREE.PMREMGenerator;
  private rgbe = new RGBELoader();
  private gltfLoader = new GLTFLoader();
  private bytesCache = new Map<AssetKey, Promise<ArrayBuffer>>();
  private envCache = new Map<EnvName, Promise<EnvMap>>();
  private gltfCache = new Map<ModelName, Promise<GLTF>>();
  private dragonCache: Promise<THREE.BufferGeometry> | null = null;
  private room: THREE.Texture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** プロシージャルな室内スタジオ環境（アセット不要・即時） */
  roomEnv(): THREE.Texture {
    if (!this.room) {
      const scene = new RoomEnvironment();
      this.room = this.pmrem.fromScene(scene, 0.04).texture;
    }
    return this.room;
  }

  /**
   * 生バイト列を取得する。単一ファイル版では埋め込み済みの base64 を使い、
   * 通常配信ではファイルを取りに行く。どちらの経路でも以降の処理は同じ。
   */
  private bytes(key: AssetKey): Promise<ArrayBuffer> {
    let p = this.bytesCache.get(key);
    if (!p) {
      const inline = (window as { __WTD_ASSETS?: Record<string, string> }).__WTD_ASSETS?.[key];
      p = inline
        ? Promise.resolve(base64ToBuffer(inline))
        : fetch(`${import.meta.env.BASE_URL}${PATHS[key]}`).then((r) => {
            if (!r.ok) throw new Error(`${PATHS[key]}: ${r.status}`);
            return r.arrayBuffer();
          });
      this.bytesCache.set(key, p);
    }
    return p;
  }

  env(name: EnvName): Promise<EnvMap> {
    let p = this.envCache.get(name);
    if (!p) {
      p = this.bytes(name).then((buf) => {
        // RGBELoader は既定で HalfFloat を返す。DataTextureLoader と同じ手順でテクスチャ化する
        const data = this.rgbe.parse(buf) as unknown as {
          width: number;
          height: number;
          data: Uint16Array<ArrayBuffer>;
        };
        const bg = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, THREE.HalfFloatType);
        bg.mapping = THREE.EquirectangularReflectionMapping;
        bg.magFilter = THREE.LinearFilter;
        bg.minFilter = THREE.LinearFilter;
        bg.generateMipmaps = false;
        bg.flipY = true;
        bg.needsUpdate = true;
        const env = this.pmrem.fromEquirectangular(bg).texture;
        return { env, bg };
      });
      this.envCache.set(name, p);
    }
    return p;
  }

  gltf(name: ModelName): Promise<GLTF> {
    let p = this.gltfCache.get(name);
    if (!p) {
      p = this.bytes(name).then(
        (buf) => new Promise<GLTF>((resolve, reject) => this.gltfLoader.parse(buf, '', resolve, reject)),
      );
      this.gltfCache.set(name, p);
    }
    return p;
  }

  /** スタンフォード・ドラゴンの量子化メッシュ。失敗しても null を返して呼び出し側で代替する */
  dragon(): Promise<THREE.BufferGeometry | null> {
    if (!this.dragonCache) {
      this.dragonCache = this.bytes('dragon').then(decodeDragon);
    }
    return this.dragonCache.catch((err) => {
      console.warn('[Web Tech Demo] dragon mesh unavailable:', err);
      return null;
    });
  }
}
