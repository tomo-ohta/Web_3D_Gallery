import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';
import { FSQuad } from '../core/gpgpu';

/** ポストプロセス実験室。同一シーンに6種のエフェクトを掛け替える */

const POST_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform int uMode;
uniform float uParam; // ポインタ縦位置 0..1
uniform float uTime;
uniform float uNear;
uniform float uFar;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 uv = vUv;
  vec3 col;

  if (uMode == 0) {
    col = texture2D(tColor, uv).rgb;
  } else if (uMode == 1) {
    // ブルーム（ミップ合成）
    col = texture2D(tColor, uv).rgb;
    vec3 glow = vec3(0.0);
    glow += max(textureLod(tColor, uv, 2.0).rgb - 0.45, 0.0);
    glow += max(textureLod(tColor, uv, 3.5).rgb - 0.4, 0.0) * 1.2;
    glow += max(textureLod(tColor, uv, 5.0).rgb - 0.35, 0.0) * 1.5;
    col += glow * (0.4 + uParam * 1.6);
  } else if (uMode == 2) {
    // 被写界深度（黄金角スパイラルの収集ぼかし）
    // ミップぼかしだと錯乱円が大きい所でブロック状に潰れるため、
    // 錯乱円半径ぶんの円盤を実サンプリングして滑らかなボケを作る
    float focus = mix(2.5, 11.0, uParam);
    float centerDepth = linearDepth(uv);
    float coc = clamp(abs(centerDepth - focus) / (focus * 0.55), 0.0, 1.0);
    float radius = coc * 0.028;
    float rot = hash12(uv * 913.7) * 6.2831;
    vec3 acc = texture2D(tColor, uv).rgb;
    float wsum = 1.0;
    for (int i = 1; i <= 28; i++) {
      float fi = float(i);
      float ang = fi * 2.39996 + rot;
      float rr = sqrt(fi / 28.0) * radius;
      vec2 off = vec2(cos(ang) * 0.625, sin(ang)) * rr; // RT は 1024x640 なので x を補正して円形に
      vec2 suv = clamp(uv + off, vec2(0.002), vec2(0.998));
      float dS = linearDepth(suv);
      float cocS = clamp(abs(dS - focus) / (focus * 0.55), 0.0, 1.0);
      // 手前のシャープな物体が背景のボケへ滲まないよう、タップ自身の錯乱円で重み付け
      float w = mix(0.06, 1.0, clamp(cocS * 1.4, 0.0, 1.0));
      acc += textureLod(tColor, suv, 1.0 + coc * 1.5).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  } else if (uMode == 3) {
    // 色収差 + ビネット + 粒子
    vec2 d = (uv - 0.5) * (0.006 + uParam * 0.03);
    col.r = texture2D(tColor, uv + d).r;
    col.g = texture2D(tColor, uv).g;
    col.b = texture2D(tColor, uv - d).b;
    col *= 1.0 - dot(uv - 0.5, uv - 0.5) * 1.4;
    col += (hash12(uv * 913.7 + fract(uTime) * 43.0) - 0.5) * 0.06;
  } else if (uMode == 4) {
    // ハーフトーン
    float scale = mix(180.0, 70.0, uParam);
    float ang = 0.4;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 g = rot * uv * scale;
    vec2 cell = fract(g) - 0.5;
    vec2 cellId = floor(g);
    vec2 cuv = (transpose(rot) * ((cellId + 0.5) / scale));
    float lum = dot(texture2D(tColor, clamp(cuv, 0.0, 1.0)).rgb, vec3(0.3, 0.59, 0.11));
    float r = sqrt(clamp(lum, 0.0, 1.0)) * 0.62;
    float m = smoothstep(r, r - 0.12, length(cell));
    vec3 ink = vec3(0.12, 0.1, 0.2);
    vec3 paper = vec3(0.96, 0.93, 0.86);
    col = mix(paper, ink, m);
  } else {
    // ピクセル + ポスタライズ
    float px = mix(200.0, 64.0, uParam);
    vec2 p = floor(uv * vec2(px * 1.6, px)) / vec2(px * 1.6, px);
    col = texture2D(tColor, p).rgb;
    col = floor(col * 5.0 + 0.5) / 5.0;
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const MODES = [
  '原画（エフェクトなし）',
  'ブルーム',
  '被写界深度（上下で焦点）',
  '色収差 + フィルム',
  'ハーフトーン',
  'ピクセルアート',
];

export async function createPostfx(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f16);
  scene.fog = new THREE.Fog(0x0d0f16, 6, 20);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.6, 30);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
  key.position.set(3, 5, 2);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x3a4054, 0.8));

  // 奥行きのある列柱シーン
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x191d28, roughness: 0.4, metalness: 0.5 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  scene.add(floor);

  const objMats = [
    new THREE.MeshPhysicalMaterial({ color: 0xc8ccd8, metalness: 0.9, roughness: 0.2 }),
    new THREE.MeshPhysicalMaterial({ color: 0x8a2032, roughness: 0.3, clearcoat: 1 }),
    new THREE.MeshPhysicalMaterial({ color: 0xd8a84a, metalness: 1, roughness: 0.28 }),
  ];
  const emissiveMat = new THREE.MeshBasicMaterial({ color: 0xffc37a });
  const geos = [
    new THREE.TorusKnotGeometry(0.32, 0.12, 140, 24),
    new THREE.SphereGeometry(0.4, 48, 32),
    new THREE.IcosahedronGeometry(0.42, 1),
  ];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = 1.5 - i * 1.6;
    const obj = new THREE.Mesh(geos[i % geos.length], objMats[i % objMats.length]);
    obj.position.set(side * (0.9 + (i % 3) * 0.2), 0, z);
    scene.add(obj);
    // 台座と光る輪
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.34, 0.55, 20),
      new THREE.MeshStandardMaterial({ color: 0x262b38, roughness: 0.6 }),
    );
    ped.position.set(obj.position.x, -0.55, z);
    scene.add(ped);
    const ringLight = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 8, 40), emissiveMat);
    ringLight.rotation.x = Math.PI / 2;
    ringLight.position.set(obj.position.x, -0.26, z);
    scene.add(ringLight);
  }

  // RT（ミップ + 深度付き）
  const RT_W = 1024;
  const RT_H = 640;
  const depthTex = new THREE.DepthTexture(RT_W, RT_H);
  const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthTexture: depthTex,
    depthBuffer: true,
  });

  const postUniforms = {
    tColor: { value: rt.texture },
    tDepth: { value: depthTex },
    uMode: { value: 1 },
    uParam: { value: 0.5 },
    uTime: { value: 0 },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
  };
  const post = new FSQuad(
    new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: POST_FRAG,
      uniforms: postUniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );

  // ラベルはポスト後に重ねる
  const overlayScene = new THREE.Scene();
  overlayScene.add(camera);
  const orbit = new OrbitDrag(camera, { theta: 0.22, phi: 1.44, radius: 5.2, autoRotate: 0.05, targetY: -0.15, minRadius: 2.6, maxRadius: 10 });
  const label = new LabelSprite(camera);
  label.set(MODES[1]);

  let mode = 1;
  const rotators: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.geometry as THREE.BufferGeometry).type === 'TorusKnotGeometry') rotators.push(m);
  });

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      postUniforms.uTime.value = t;
      for (const r of rotators) r.rotation.y = t * 0.5;
    },
    render() {
      const renderer = ctx.renderer;
      // 1) シーンを RT に描く
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      // 2) ポストエフェクトを掛けて表示
      post.material.uniforms.uNear.value = camera.near;
      post.material.uniforms.uFar.value = camera.far;
      post.render(renderer, null);
      // 3) ラベルを上に重ねる
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlayScene, camera);
      renderer.autoClear = prevAutoClear;
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        orbit.zoom(p.dz ?? 0);
        return;
      }
      if (p.type === 'move') {
        postUniforms.uParam.value = THREE.MathUtils.clamp(p.v, 0, 1);
        if (p.down) orbit.pointer(p);
      } else {
        orbit.pointer(p);
      }
      if (p.type === 'tap') {
        mode = (mode + 1) % MODES.length;
        postUniforms.uMode.value = mode;
        label.set(MODES[mode]);
      }
    },
    dispose() {
      purgeScene(scene);
      rt.dispose();
    },
  };
}
