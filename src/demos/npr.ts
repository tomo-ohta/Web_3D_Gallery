import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** 同一モデルの画風切替（フォトリアル / トゥーン / スケッチ / ホログラム） */

const TOON_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TOON_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
  vec3 albedo = texture2D(uMap, vUv).rgb;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewW);
  vec3 L = normalize(vec3(0.6, 0.8, 0.5));
  float d = dot(N, L) * 0.5 + 0.5;
  // 3段階に量子化
  float band = d > 0.62 ? 1.05 : d > 0.34 ? 0.7 : 0.42;
  vec3 shadowTint = vec3(0.65, 0.6, 0.95);
  vec3 col = albedo * band;
  col = mix(col * shadowTint, col, step(0.6, band));
  // スペキュラの点
  vec3 H = normalize(L + V);
  col += vec3(0.9) * step(0.985, max(dot(N, H), 0.0)) * 0.7;
  // リム
  col += vec3(0.45, 0.55, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.55;
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKETCH_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
  vec3 albedo = texture2D(uMap, vUv).rgb;
  float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(vec3(0.6, 0.8, 0.5));
  float d = (dot(N, L) * 0.5 + 0.5) * (0.45 + lum * 0.8);

  // スクリーン空間のクロスハッチング
  vec2 sc = gl_FragCoord.xy;
  float h1 = abs(fract((sc.x + sc.y) / 9.0) - 0.5) * 2.0;
  float h2 = abs(fract((sc.x - sc.y) / 9.0) - 0.5) * 2.0;
  float h3 = abs(fract(sc.x / 7.0) - 0.5) * 2.0;
  float ink = 0.0;
  if (d < 0.7) ink = max(ink, step(d * 1.35, h1) * 0.7);
  if (d < 0.45) ink = max(ink, step(d * 1.8, h2) * 0.85);
  if (d < 0.22) ink = max(ink, step(d * 3.0, h3));

  vec3 paper = vec3(0.94, 0.9, 0.8);
  vec3 col = mix(paper * (0.75 + d * 0.3), vec3(0.16, 0.13, 0.12), ink);
  gl_FragColor = vec4(col, 1.0);
}
`;

const HOLO_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewW);
  float fres = pow(1.0 - abs(dot(N, V)), 1.6);
  float scan = 0.55 + 0.45 * sin(gl_FragCoord.y * 1.7 - uTime * 22.0);
  float flick = 0.9 + 0.1 * sin(uTime * 47.0) * sin(uTime * 13.7);
  vec3 col = vec3(0.25, 0.85, 1.0) * (fres * 1.6 + 0.12) * scan * flick;
  gl_FragColor = vec4(col, clamp(fres * 1.2 + 0.16, 0.0, 1.0) * 0.9);
}
`;

const OUTLINE_VERT = /* glsl */ `
uniform float uWidth;
void main() {
  vec3 p = position + normal * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }
`;

interface StyleDef {
  label: string;
  bg: number;
  outline: boolean;
  outlineColor: number;
  env: boolean;
}

const STYLES: StyleDef[] = [
  { label: 'フォトリアル（PBR）', bg: 0x101216, outline: false, outlineColor: 0, env: true },
  { label: 'トゥーン（セル調）', bg: 0x2a3040, outline: true, outlineColor: 0x10131f, env: false },
  { label: 'スケッチ（ハッチング）', bg: 0xf0e9d8, outline: true, outlineColor: 0x2a2422, env: false },
  { label: 'ホログラム', bg: 0x050a12, outline: false, outlineColor: 0, env: false },
];

export async function createNPR(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 60);
  scene.add(camera);

  const [gltf, envData] = await Promise.all([ctx.assets.gltf('helmet'), ctx.assets.env('studio')]);

  const helmet = gltf.scene.clone(true);
  helmet.position.set(0, 0.05, 0);
  scene.add(helmet);

  // 各メッシュの素材セットを準備
  interface MeshStyles {
    mesh: THREE.Mesh;
    original: THREE.Material;
    toon: THREE.ShaderMaterial;
    sketch: THREE.ShaderMaterial;
    holo: THREE.ShaderMaterial;
  }
  const meshes: MeshStyles[] = [];
  const holoUniforms = { uTime: { value: 0 } };
  helmet.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const orig = m.material as THREE.MeshStandardMaterial;
    const map = orig.map;
    meshes.push({
      mesh: m,
      original: orig,
      toon: new THREE.ShaderMaterial({
        vertexShader: TOON_VERT,
        fragmentShader: TOON_FRAG,
        uniforms: { uMap: { value: map } },
      }),
      sketch: new THREE.ShaderMaterial({
        vertexShader: TOON_VERT,
        fragmentShader: SKETCH_FRAG,
        uniforms: { uMap: { value: map } },
      }),
      holo: new THREE.ShaderMaterial({
        vertexShader: TOON_VERT,
        fragmentShader: HOLO_FRAG,
        uniforms: holoUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    });
  });

  // 輪郭線（反転ハル）。glTF 内部ノードの回転を取りこぼさないよう、
  // 元メッシュのワールド行列を毎フレームそのままコピーして描く
  const outlineUniforms = { uWidth: { value: 0.012 }, uColor: { value: new THREE.Color(0x10131f) } };
  const outlineMat = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: outlineUniforms,
    side: THREE.BackSide,
  });
  const outlines: { src: THREE.Mesh; out: THREE.Mesh }[] = [];
  for (const ms of meshes) {
    const out = new THREE.Mesh(ms.mesh.geometry, outlineMat);
    out.matrixAutoUpdate = false;
    out.frustumCulled = false;
    scene.add(out);
    outlines.push({ src: ms.mesh, out });
  }

  const orbit = new OrbitDrag(camera, { theta: 0.35, phi: 1.35, radius: 3.6, autoRotate: 0.1, minRadius: 1.8, maxRadius: 7 });
  const label = new LabelSprite(camera);

  let style = 1; // 初期表示はトゥーン（違いが一目で分かる）
  const applyStyle = (s: number) => {
    const def = STYLES[s];
    scene.background = new THREE.Color(def.bg);
    scene.environment = def.env ? envData.env : null;
    for (const o of outlines) o.out.visible = def.outline;
    outlineUniforms.uColor.value.set(def.outlineColor);
    for (const ms of meshes) {
      ms.mesh.material = s === 0 ? ms.original : s === 1 ? ms.toon : s === 2 ? ms.sketch : ms.holo;
    }
    label.set(def.label);
  };
  applyStyle(style);

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.05,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      holoUniforms.uTime.value = t;
      helmet.rotation.y = Math.sin(t * 0.15) * 0.25;
      helmet.updateMatrixWorld(true);
      for (const o of outlines) o.out.matrix.copy(o.src.matrixWorld);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
    },
    pointer(p: PointerInfo) {
      orbit.pointer(p);
      if (p.type === 'tap') {
        style = (style + 1) % STYLES.length;
        applyStyle(style);
      }
    },
  };
}
