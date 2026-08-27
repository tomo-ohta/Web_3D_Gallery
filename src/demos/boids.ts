import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { PingPong, pass } from '../core/gpgpu';

/** GPGPU ボイド（群体シミュレーション）。4,096 匹の魚群 */

const TEX = 64; // 64^2 = 4096 匹

const VEL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uDt;
uniform float uTime;
uniform vec4 uPredator; // xyz: 位置, w: 強さ
uniform int uTexN; // 動的ループ境界（ドライバの完全アンロール回避）

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 pos = texture2D(tPos, vUv).xyz;
  vec3 vel = texture2D(tVel, vUv).xyz;
  float seed = hash12(vUv * 719.3);

  vec3 sep = vec3(0.0);
  vec3 ali = vec3(0.0);
  vec3 coh = vec3(0.0);
  float nSep = 0.0;
  float nAli = 0.0;
  float nCoh = 0.0;

  for (int y = 0; y < uTexN; y++) {
    for (int x = 0; x < uTexN; x++) {
      vec3 p2 = texelFetch(tPos, ivec2(x, y), 0).xyz;
      vec3 d = p2 - pos;
      float dist = length(d);
      if (dist < 0.0001 || dist > 1.25) continue;
      if (dist < 0.42) {
        sep -= d / (dist * dist + 0.02);
        nSep += 1.0;
      }
      if (dist < 0.7) {
        ali += texelFetch(tVel, ivec2(x, y), 0).xyz;
        nAli += 1.0;
      }
      coh += p2;
      nCoh += 1.0;
    }
  }

  if (nSep > 0.0) vel += sep / nSep * uDt * 4.2;
  if (nAli > 0.0) vel += (ali / nAli - vel) * uDt * 2.4;
  if (nCoh > 0.0) vel += (coh / nCoh - pos) * uDt * 1.0;

  // 捕食者（ポインタ）から逃げる
  if (uPredator.w > 0.001) {
    vec3 d = pos - uPredator.xyz;
    float dist = length(d) + 0.05;
    vel += (d / dist) * uPredator.w * 9.0 * uDt / (dist * dist * 0.6 + 0.35);
  }

  // 楕円の水槽に収める
  vec3 q = pos / vec3(2.6, 1.5, 2.6);
  float r = length(q);
  if (r > 0.7) vel -= normalize(pos / vec3(1.0, 3.0, 1.0)) * (r - 0.7) * uDt * 14.0;

  // ゆらぎ
  vel.x += sin(uTime * 0.7 + pos.z * 1.3 + seed * 6.28) * uDt * 0.25;
  vel.y += cos(uTime * 0.9 + pos.x * 1.1) * uDt * 0.12;
  vel.y *= 1.0 - uDt * 0.6; // 水平を好む

  float sp = length(vel);
  float minSp = 0.55 + seed * 0.25;
  float maxSp = 1.9 + seed * 0.5;
  if (sp < minSp) vel *= minSp / max(sp, 0.001);
  if (sp > maxSp) vel *= maxSp / sp;

  gl_FragColor = vec4(vel, 1.0);
}
`;

const POS_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uDt;
void main() {
  vec4 p = texture2D(tPos, vUv);
  vec3 v = texture2D(tVel, vUv).xyz;
  p.xyz += v * uDt;
  p.w += length(v) * uDt * 9.0; // 尾びれの位相
  gl_FragColor = p;
}
`;

const FISH_VERT = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
varying float vLight;
varying float vDepth;
varying float vBelly;

const int TEXN = ${TEX};

void main() {
  int id = gl_InstanceID;
  ivec2 tc = ivec2(id % TEXN, id / TEXN);
  vec4 P = texelFetch(tPos, tc, 0);
  vec3 V = texelFetch(tVel, tc, 0).xyz;

  vec3 fw = normalize(V + vec3(0.0001));
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);

  vec3 lp = position;
  // 尾びれのくねり（後方ほど大きく）
  float wag = sin(P.w + lp.z * 6.0) * 0.09 * clamp(-lp.z * 4.0, 0.0, 1.0);
  lp.x += wag;
  vec3 world = P.xyz + rt * lp.x + up * lp.y + fw * lp.z;

  vBelly = lp.y;
  vLight = dot(normalize(rt * lp.x + up * lp.y + fw * 0.0 + vec3(0.0, 0.001, 0.0)), vec3(0.3, 0.9, 0.2)) * 0.5 + 0.5;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FISH_FRAG = /* glsl */ `
varying float vLight;
varying float vDepth;
varying float vBelly;
void main() {
  vec3 back = vec3(0.16, 0.30, 0.38);
  vec3 belly = vec3(0.75, 0.85, 0.9);
  vec3 col = mix(back, belly, clamp(0.42 - vBelly * 16.0, 0.0, 1.0));
  col *= 0.55 + 0.6 * vLight;
  // 水の色に沈む距離フォグ
  vec3 water = vec3(0.015, 0.10, 0.16);
  float fog = 1.0 - exp(-vDepth * 0.11);
  col = mix(col, water, fog);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createBoids(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04121c);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 60);
  scene.add(camera);

  const pos = new PingPong(TEX, TEX, { filter: THREE.NearestFilter });
  const vel = new PingPong(TEX, TEX, { filter: THREE.NearestFilter });

  // 初期化: 球状に配置、緩い回遊速度
  const initPos = pass(
    /* glsl */ `
    varying vec2 vUv;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      float a = h(vUv) * 6.283;
      float b = h(vUv + 3.1) * 2.0 - 1.0;
      float r = 0.4 + h(vUv + 7.7) * 1.6;
      float c = sqrt(1.0 - b * b);
      gl_FragColor = vec4(cos(a) * c * r * 1.6, b * r * 0.7, sin(a) * c * r * 1.6, h(vUv + 11.0) * 6.28);
    }
    `,
    {},
  );
  initPos.render(ctx.renderer, pos.read);
  initPos.render(ctx.renderer, pos.write);
  const initVel = pass(
    /* glsl */ `
    varying vec2 vUv;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() { float a = h(vUv * 5.1) * 6.283; gl_FragColor = vec4(cos(a), 0.0, sin(a), 1.0); }
    `,
    {},
  );
  initVel.render(ctx.renderer, vel.read);
  initVel.render(ctx.renderer, vel.write);
  ctx.renderer.setRenderTarget(null);

  const velUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
    uDt: { value: 0.016 },
    uTime: { value: 0 },
    uPredator: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTexN: { value: TEX },
  };
  const velPass = pass(VEL_FRAG, velUniforms);
  const posUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
    uDt: { value: 0.016 },
  };
  const posPass = pass(POS_FRAG, posUniforms);

  // 魚ジオメトリ（先端が +Z を向く細長いひし形）
  const fishGeo = new THREE.ConeGeometry(0.045, 0.24, 5);
  fishGeo.rotateX(Math.PI / 2);
  const fishUniforms = {
    tPos: { value: pos.read.texture },
    tVel: { value: vel.read.texture },
  };
  const fish = new THREE.InstancedMesh(
    fishGeo,
    new THREE.ShaderMaterial({ vertexShader: FISH_VERT, fragmentShader: FISH_FRAG, uniforms: fishUniforms }),
    TEX * TEX,
  );
  fish.frustumCulled = false;
  scene.add(fish);

  // 浮遊する微粒子（奥行き感）
  const moteCount = 90;
  const moteArr = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    moteArr[i * 3] = (Math.random() - 0.5) * 7;
    moteArr[i * 3 + 1] = (Math.random() - 0.5) * 3.4;
    moteArr[i * 3 + 2] = (Math.random() - 0.5) * 7;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(moteArr, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ color: 0x2e5568, size: 0.025, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  scene.add(motes);

  let theta = 0.2;
  let camR = 7.6;
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const predatorPos = new THREE.Vector3();
  let predator = 0;
  let predatorTarget = 0;
  let scare = 0;

  return {
    exposure: 1.0,
    update(dt, t) {
      theta += dt * 0.045;
      const phi = 1.44 + Math.sin(t * 0.09) * 0.07;
      camera.position.set(
        camR * Math.sin(phi) * Math.sin(theta),
        camR * Math.cos(phi),
        camR * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(0, 0, 0);
      motes.rotation.y = t * 0.01;

      predator += (predatorTarget - predator) * Math.min(1, dt * 8);
      scare = Math.max(0, scare - dt * 3);

      const simDt = Math.min(dt, 1 / 30);
      velUniforms.uDt.value = simDt;
      velUniforms.uTime.value = t;
      velUniforms.uPredator.value.set(predatorPos.x, predatorPos.y, predatorPos.z, predator + scare * 3);

      velUniforms.tPos.value = pos.read.texture;
      velUniforms.tVel.value = vel.read.texture;
      velPass.render(ctx.renderer, vel.write);
      vel.swap();
      posUniforms.tPos.value = pos.read.texture;
      posUniforms.tVel.value = vel.read.texture;
      posUniforms.uDt.value = simDt;
      posPass.render(ctx.renderer, pos.write);
      pos.swap();

      fishUniforms.tPos.value = pos.read.texture;
      fishUniforms.tVel.value = vel.read.texture;
      ctx.renderer.setRenderTarget(null);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        camR = THREE.MathUtils.clamp(camR * Math.exp(p.dz ?? 0), 3.2, 11);
        return;
      }
      if (p.type === 'down' || (p.type === 'move' && p.down)) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        plane.setFromNormalAndCoplanarPoint(dir, new THREE.Vector3());
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (hit) predatorPos.copy(hit);
        predatorTarget = 1;
      }
      if (p.type === 'up' || p.type === 'leave') predatorTarget = 0;
      if (p.type === 'tap') scare = 1;
    },
    dispose() {
      pos.dispose();
      vel.dispose();
      fishGeo.dispose();
    },
  };
}
