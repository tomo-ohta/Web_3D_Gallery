import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { PingPong, pass, type FSQuad } from '../core/gpgpu';

const SIZE = 384; // 384^2 = 147,456 パーティクル

const NOISE = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
// ポテンシャル場の有限差分によるカールノイズ
vec3 curlNoise(vec3 p) {
  const float e = 0.22;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 p1 = vec3(vnoise(p + dx), vnoise(p + dx + 31.4), vnoise(p + dx + 77.7));
  vec3 p2 = vec3(vnoise(p - dx), vnoise(p - dx + 31.4), vnoise(p - dx + 77.7));
  vec3 q1 = vec3(vnoise(p + dy), vnoise(p + dy + 31.4), vnoise(p + dy + 77.7));
  vec3 q2 = vec3(vnoise(p - dy), vnoise(p - dy + 31.4), vnoise(p - dy + 77.7));
  vec3 r1 = vec3(vnoise(p + dz), vnoise(p + dz + 31.4), vnoise(p + dz + 77.7));
  vec3 r2 = vec3(vnoise(p - dz), vnoise(p - dz + 31.4), vnoise(p - dz + 77.7));
  float x = (q1.z - q2.z) - (r1.y - r2.y);
  float y = (r1.x - r2.x) - (p1.z - p2.z);
  float z = (p1.y - p2.y) - (q1.x - q2.x);
  return vec3(x, y, z) / (2.0 * e);
}
`;

const SPAWN = /* glsl */ `
// 銀河ディスク状のスポーン位置と接線速度
vec3 spawnPos(vec2 seed, float time) {
  float h1 = hash13(vec3(seed * 417.3, 1.7));
  float h2 = hash13(vec3(seed * 269.1, 9.2));
  float h3 = hash13(vec3(seed * 613.7, 4.4));
  float r = 0.45 + 2.9 * h1 * h1;
  float th = h2 * 6.28318 + time * 0.05;
  float y = (h3 - 0.5) * 0.5 * (1.0 - r * 0.22);
  return vec3(cos(th) * r, y, sin(th) * r);
}
vec3 spawnVel(vec3 pos) {
  float r = max(length(pos.xz), 0.15);
  vec2 tang = vec2(-pos.z, pos.x) / r;
  float sp = 0.62 * sqrt(1.9 / r);
  return vec3(tang.x * sp, 0.0, tang.y * sp);
}
`;

const VEL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uDt;
uniform float uTime;
uniform vec3 uPointer;
uniform float uAttract;
uniform vec4 uBurst; // xyz: 位置, w: 強さ
${NOISE}
${SPAWN}
void main() {
  vec4 p = texture2D(tPos, vUv);
  vec3 v = texture2D(tVel, vUv).xyz;
  float rate = 0.06 + hash13(vec3(vUv * 913.7, 3.3)) * 0.09;
  float nextLife = p.w - uDt * rate;

  if (nextLife <= 0.0) {
    vec3 sp = spawnPos(vUv, uTime);
    v = spawnVel(sp);
  } else {
    // 銀河の重力っぽい向心力 + カール乱流
    float r = max(length(p.xyz), 0.2);
    v += -p.xyz / r * (0.5 / (r * 0.8 + 0.4)) * uDt;
    v += curlNoise(p.xyz * 0.85 + vec3(0.0, uTime * 0.05, 0.0)) * uDt * 1.35;
    // 銀河回転を維持する接線力
    vec3 sv = spawnVel(p.xyz);
    v += (sv - v * vec3(1.0, 0.0, 1.0)) * uDt * 0.32;

    // ポインタ引力
    if (uAttract > 0.001) {
      vec3 d = uPointer - p.xyz;
      float dist = length(d) + 0.08;
      v += normalize(d) * uAttract * uDt * 7.5 / (dist * dist * 0.6 + 0.7);
    }
    // バースト
    if (uBurst.w > 0.001) {
      vec3 d = p.xyz - uBurst.xyz;
      float dist = length(d) + 0.05;
      v += (d / dist) * uBurst.w * uDt * 42.0 * exp(-dist * dist * 0.55);
    }
    v *= exp(-uDt * 0.55);
    float sp2 = length(v);
    if (sp2 > 5.0) v *= 5.0 / sp2;
  }
  gl_FragColor = vec4(v, 1.0);
}
`;

const POS_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uDt;
uniform float uTime;
${NOISE}
${SPAWN}
void main() {
  vec4 p = texture2D(tPos, vUv);
  vec3 v = texture2D(tVel, vUv).xyz;
  float rate = 0.06 + hash13(vec3(vUv * 913.7, 3.3)) * 0.09;
  float life = p.w - uDt * rate;
  vec3 pos;
  if (life <= 0.0) {
    pos = spawnPos(vUv, uTime);
    life = 1.0;
  } else {
    pos = p.xyz + v * uDt;
  }
  gl_FragColor = vec4(pos, life);
}
`;

const RENDER_VERT = /* glsl */ `
attribute vec2 aRef;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPointScale;
varying float vSpeed;
varying float vLife;
void main() {
  vec4 p = texture2D(tPos, aRef);
  vSpeed = length(texture2D(tVel, aRef).xyz);
  vLife = p.w;
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  float fade = smoothstep(0.0, 0.08, p.w) * smoothstep(1.0, 0.92, p.w);
  float h = fract(dot(aRef, vec2(213.7, 771.3)));
  gl_PointSize = uPointScale * (0.011 + h * 0.012) * fade / max(-mv.z, 0.3);
  gl_Position = projectionMatrix * mv;
}
`;

const RENDER_FRAG = /* glsl */ `
varying float vSpeed;
varying float vLife;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float m = exp(-r2 * 11.0);
  float s = clamp(vSpeed * 0.6, 0.0, 1.0);
  vec3 cold = vec3(0.12, 0.30, 0.95);
  vec3 mid  = vec3(0.25, 0.85, 1.00);
  vec3 hot  = vec3(1.00, 0.92, 0.75);
  vec3 col = mix(cold, mid, smoothstep(0.05, 0.45, s));
  col = mix(col, hot, smoothstep(0.45, 0.95, s));
  gl_FragColor = vec4(col, 1.0) * (m * 0.55 * smoothstep(0.0, 0.06, vLife));
}
`;

/** GPGPU による約15万パーティクルの銀河。カール乱流 + ポインタ引力 */
export async function createParticles(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050b);
  const camera = new THREE.PerspectiveCamera(45, 16 / 10, 0.1, 60);
  scene.add(camera);

  const pos = new PingPong(SIZE, SIZE, { filter: THREE.NearestFilter });
  const vel = new PingPong(SIZE, SIZE, { filter: THREE.NearestFilter });

  // 初期化パス（life を負にして即リスポーンさせる）
  const initQuad = pass(
    /* glsl */ `
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, -fract(dot(vUv, vec2(12.9898, 78.233)) * 43758.5453)); }
    `,
    {},
  );
  initQuad.render(ctx.renderer, pos.read);
  initQuad.render(ctx.renderer, pos.write);
  const zeroQuad = pass(`void main(){ gl_FragColor = vec4(0.0); }`, {});
  zeroQuad.render(ctx.renderer, vel.read);
  zeroQuad.render(ctx.renderer, vel.write);
  ctx.renderer.setRenderTarget(null);

  const velUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
    uDt: { value: 0.016 },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3() },
    uAttract: { value: 0 },
    uBurst: { value: new THREE.Vector4() },
  };
  const velPass = pass(VEL_FRAG, velUniforms);

  const posUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
    uDt: { value: 0.016 },
    uTime: { value: 0 },
  };
  const posPass = pass(POS_FRAG, posUniforms);

  // 描画ジオメトリ
  const count = SIZE * SIZE;
  const refs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    refs[i * 2] = ((i % SIZE) + 0.5) / SIZE;
    refs[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
  const renderUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
    uPointScale: { value: 500 },
  };
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      uniforms: renderUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  scene.add(points);

  // 銀河コアの淡い光
  const coreCanvas = document.createElement('canvas');
  coreCanvas.width = coreCanvas.height = 128;
  const cctx = coreCanvas.getContext('2d')!;
  const cg = cctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  cg.addColorStop(0, 'rgba(255,235,200,0.85)');
  cg.addColorStop(0.25, 'rgba(140,170,255,0.28)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.fillStyle = cg;
  cctx.fillRect(0, 0, 128, 128);
  const coreTex = new THREE.CanvasTexture(coreCanvas);
  coreTex.colorSpace = THREE.SRGBColorSpace;
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: coreTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  core.scale.setScalar(2.4);
  scene.add(core);

  let theta = 0.4;
  let camR = 5.6;
  const camTarget = new THREE.Vector3();
  const pointerWorld = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  let attract = 0;
  let attractTarget = 0;
  let burst = 0;

  return {
    exposure: 1.0,
    update(dt, t) {
      theta += dt * 0.06;
      const phi = 1.12 + Math.sin(t * 0.1) * 0.1;
      const R = camR;
      camera.position.set(
        R * Math.sin(phi) * Math.sin(theta),
        R * Math.cos(phi),
        R * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(camTarget);

      attract += (attractTarget - attract) * Math.min(1, dt * 8);
      burst = Math.max(0, burst - dt * 5);

      const simDt = Math.min(dt, 1 / 30);
      velUniforms.uDt.value = simDt;
      velUniforms.uTime.value = t;
      velUniforms.uPointer.value.copy(pointerWorld);
      velUniforms.uAttract.value = attract;
      velUniforms.uBurst.value.w = burst;
      posUniforms.uDt.value = simDt;
      posUniforms.uTime.value = t;

      // 速度更新
      velUniforms.tPos.value = pos.read.texture;
      velUniforms.tVel.value = vel.read.texture;
      velPass.render(ctx.renderer, vel.write);
      vel.swap();
      // 位置更新
      posUniforms.tPos.value = pos.read.texture;
      posUniforms.tVel.value = vel.read.texture;
      posPass.render(ctx.renderer, pos.write);
      pos.swap();

      renderUniforms.tPos.value = pos.read.texture;
      renderUniforms.tVel.value = vel.read.texture;
      ctx.renderer.setRenderTarget(null);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
      renderUniforms.uPointScale.value = s.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        camR = THREE.MathUtils.clamp(camR * Math.exp(p.dz ?? 0), 3.0, 11);
        return;
      }
      if (p.type === 'down' || (p.type === 'move' && p.down)) {
        // カメラ正面・原点を通る平面との交点
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        plane.setFromNormalAndCoplanarPoint(dir, camTarget);
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (hit) pointerWorld.copy(hit);
        attractTarget = 1;
      }
      if (p.type === 'up' || p.type === 'leave') attractTarget = 0;
      if (p.type === 'tap') {
        velUniforms.uBurst.value.set(pointerWorld.x, pointerWorld.y, pointerWorld.z, 0);
        burst = 1;
      }
    },
    dispose() {
      purgeScene(scene);
      pos.dispose();
      vel.dispose();
      geo.dispose();
    },
  };
}
