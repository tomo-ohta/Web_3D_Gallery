import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';

/** 仮想カメラ・窓スリット・可視判定を頂点/フラグメント両方で共有する GLSL */
const COMMON = /* glsl */ `
uniform vec3 uLightDir;   // 光の進行方向（窓 z=-4 から部屋の中へ、z 成分は正）
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
uniform float uAspect;
uniform float uTime;
uniform float uFocal;

void camBasis(out vec3 fw, out vec3 rt, out vec3 up) {
  fw = normalize(uCamTarget - uCamPos);
  rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  up = cross(rt, fw);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 窓の開口マスク（q は z=-4 壁面上の xy）
float windowMask(vec2 q) {
  float inWin = step(abs(q.x), 1.7) * step(0.55, q.y) * step(q.y, 2.85);
  // 横スラット（ブラインド）
  float slat = smoothstep(0.36, 0.45, fract(q.y * 1.55 + 0.25));
  // 縦の桟
  float mull = step(0.055, abs(abs(q.x) - 0.86)) * step(0.05, abs(q.x) * 0.0 + abs(abs(q.x) - 0.0) ) ;
  mull = step(0.06, abs(q.x)) * step(0.055, abs(abs(q.x) - 0.88));
  return inWin * slat * mull;
}

// p から光線を逆に辿って窓のどこを通ったか
float lightVis(vec3 p) {
  if (uLightDir.z <= 0.02) return 0.0;
  float tq = (p.z + 4.0) / uLightDir.z;
  vec2 q = p.xy - uLightDir.xy * tq;
  return windowMask(q);
}
`;

const VOLUME_FRAG = /* glsl */ `
${'' /* COMMON が先頭に連結される */}
uniform vec3 uLightColor;
uniform vec3 uFogTint;
uniform vec3 uAmbient;
uniform float uDensity;
uniform float uSteps;

in vec2 vUv;

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash12(i.xy + i.z * 57.0);
  float n100 = hash12(i.xy + vec2(1.0, 0.0) + i.z * 57.0);
  float n010 = hash12(i.xy + vec2(0.0, 1.0) + i.z * 57.0);
  float n110 = hash12(i.xy + vec2(1.0, 1.0) + i.z * 57.0);
  float n001 = hash12(i.xy + (i.z + 1.0) * 57.0);
  float n101 = hash12(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * 57.0);
  float n011 = hash12(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * 57.0);
  float n111 = hash12(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * 57.0);
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fogDensity(vec3 p) {
  float wisp = vnoise(p * 0.55 + vec3(uTime * 0.06, uTime * 0.02, uTime * 0.05));
  wisp = wisp * 0.75 + 0.45;
  float heightFade = exp(-max(p.y - 0.2, 0.0) * 0.16);
  return uDensity * wisp * heightFade;
}

// 部屋の内側からのレイと箱の交差（出口）
float exitBox(vec3 ro, vec3 rd, out vec3 n) {
  vec3 lo = vec3(-3.2, 0.0, -4.0);
  vec3 hi = vec3(3.2, 3.4, 4.6);
  vec3 inv = 1.0 / rd;
  vec3 t1 = (lo - ro) * inv;
  vec3 t2 = (hi - ro) * inv;
  vec3 tmax3 = max(t1, t2);
  float t = min(min(tmax3.x, tmax3.y), tmax3.z);
  vec3 hp = ro + rd * t;
  n = vec3(0.0);
  if (tmax3.x <= tmax3.y && tmax3.x <= tmax3.z) n = vec3(-sign(rd.x), 0.0, 0.0);
  else if (tmax3.y <= tmax3.z) n = vec3(0.0, -sign(rd.y), 0.0);
  else n = vec3(0.0, 0.0, -sign(rd.z));
  return t;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 fw, rt, up;
  camBasis(fw, rt, up);
  vec3 rd = normalize(fw * uFocal + rt * ndc.x * uAspect + up * ndc.y);
  vec3 ro = uCamPos;

  // --- 部屋のサーフェス ---
  vec3 n;
  float tHit = exitBox(ro, rd, n);
  vec3 hp = ro + rd * tHit;
  vec3 surf;
  if (n.y > 0.5) {
    // 床: 板張り風
    float plank = hash12(vec2(floor(hp.x * 1.35), 0.0));
    float gap = smoothstep(0.94, 0.985, fract(hp.x * 1.35));
    surf = mix(vec3(0.052, 0.04, 0.032), vec3(0.075, 0.058, 0.045), plank) * (1.0 - gap * 0.6);
    surf *= 0.8 + 0.2 * vnoise(vec3(hp.xz * 3.0, 1.0));
  } else if (n.z > 0.5) {
    // 奥の壁（窓側）
    float win = windowMask(hp.xy);
    surf = vec3(0.028, 0.028, 0.035);
    surf = mix(surf, uLightColor * 5.0, win);
  } else {
    surf = vec3(0.03, 0.03, 0.038) * (0.85 + 0.15 * vnoise(vec3(hp.xy * 2.0, hp.z)));
  }
  // 直接光（スラット模様が床や壁に落ちる）
  float dvis = lightVis(hp + n * 0.01);
  surf += dvis * max(dot(n, -uLightDir), 0.0) * uLightColor * 0.55;
  surf += uAmbient;

  // --- ボリューメトリック散乱 ---
  float g = 0.58;
  float cosT = -dot(uLightDir, rd);
  float ph = (1.0 - g * g) / max(pow(1.0 + g * g - 2.0 * g * cosT, 1.5), 1e-3) * 0.0796;

  float dl = min(tHit, 13.0) / uSteps;
  float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 61.7);
  vec3 pos = ro + rd * dl * jitter;
  float tr = 1.0;
  vec3 inscatter = vec3(0.0);
  for (int i = 0; i < 96; i++) {
    if (float(i) >= uSteps) break;
    float dens = fogDensity(pos);
    float vis = lightVis(pos);
    inscatter += tr * vis * dens * ph * uLightColor * dl * 2.4;
    inscatter += tr * dens * uFogTint * dl * 0.05;
    tr *= exp(-dens * dl * 0.55);
    pos += rd * dl;
  }

  vec3 col = surf * tr + inscatter;
  col = aces(col * 1.35);
  col = pow(col, vec3(1.0 / 2.2));
  // ビネット
  col *= 1.0 - dot(ndc * 0.55, ndc * 0.55) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

const DUST_VERT = /* glsl */ `
${''}
attribute vec3 aSeed;
uniform float uSizeScale;
varying float vAlpha;

void main() {
  // 窓からの光帯に沿って漂う塵
  vec3 p = aSeed;
  p.x = -1.7 + fract(aSeed.x + uTime * 0.011 * (0.5 + aSeed.z)) * 3.4;
  p.y = 0.3 + fract(aSeed.y + uTime * 0.008) * 2.6;
  p.z = -4.0 + fract(aSeed.z * 7.31 + uTime * 0.016) * 6.5;
  p.x += sin(uTime * 0.8 + aSeed.y * 40.0) * 0.08;
  p.y += sin(uTime * 0.6 + aSeed.x * 52.0) * 0.06;

  float vis = lightVis(p);
  vec3 fw, rt, up;
  camBasis(fw, rt, up);
  vec3 v = p - uCamPos;
  float pz = dot(v, fw);
  if (pz < 0.35) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
  float px = dot(v, rt);
  float py = dot(v, up);
  gl_Position = vec4(px * uFocal / (pz * uAspect), py * uFocal / pz, 0.0, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.x * 3.0) + aSeed.y * 90.0);
  vAlpha = vis * tw * smoothstep(9.0, 3.0, pz);
  gl_PointSize = uSizeScale * (2.6 + aSeed.x * 3.0) * (2.2 / pz);
}
`;

const DUST_FRAG = /* glsl */ `
varying float vAlpha;
uniform vec3 uLightColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float m = smoothstep(0.5, 0.1, length(d));
  gl_FragColor = vec4(uLightColor * 1.4, 1.0) * (m * vAlpha * 0.5);
}
`;

interface Mood {
  label: string;
  light: THREE.Color;
  fog: THREE.Color;
  ambient: THREE.Color;
  density: number;
}

const MOODS: Mood[] = [
  { label: '', light: new THREE.Color(1.0, 0.72, 0.42), fog: new THREE.Color(0.5, 0.4, 0.32), ambient: new THREE.Color(0.012, 0.012, 0.02), density: 0.4 },
  { label: '', light: new THREE.Color(0.55, 0.7, 1.0), fog: new THREE.Color(0.3, 0.4, 0.6), ambient: new THREE.Color(0.008, 0.01, 0.02), density: 0.34 },
  { label: '', light: new THREE.Color(0.55, 0.95, 0.6), fog: new THREE.Color(0.3, 0.5, 0.35), ambient: new THREE.Color(0.008, 0.014, 0.01), density: 0.46 },
];

/** レイマーチングによるボリューメトリックライト（光芒）と塵 */
export async function createGodrays(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  const shared = {
    uLightDir: { value: new THREE.Vector3(0.25, -0.5, 1).normalize() },
    uCamPos: { value: new THREE.Vector3(0, 1.5, 3.7) },
    uCamTarget: { value: new THREE.Vector3(0, 1.35, 0) },
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uFocal: { value: 1.55 },
    uLightColor: { value: MOODS[0].light.clone() },
  };

  const volUniforms = {
    ...shared,
    uFogTint: { value: MOODS[0].fog.clone() },
    uAmbient: { value: MOODS[0].ambient.clone() },
    uDensity: { value: MOODS[0].density },
    uSteps: { value: 40 },
  };

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: COMMON + VOLUME_FRAG,
      uniforms: volUniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );
  quad.frustumCulled = false;
  quad.renderOrder = 0;
  scene.add(quad);

  // 塵パーティクル
  const DUST = 240;
  const seeds = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST * 3; i++) seeds[i] = Math.random();
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const dustUniforms = { ...shared, uSizeScale: { value: 600 } };
  const dust = new THREE.Points(
    dustGeo,
    new THREE.ShaderMaterial({
      vertexShader: COMMON + DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: dustUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  scene.add(dust);

  const lightTarget = new THREE.Vector3(0.25, -0.5, 1).normalize();
  let mood = 0;
  let moodBlend = 1;

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      shared.uTime.value = t;
      shared.uLightDir.value.lerp(lightTarget, Math.min(1, dt * 3.5)).normalize();

      if (moodBlend < 1) {
        moodBlend = Math.min(1, moodBlend + dt * 1.8);
        const m = MOODS[mood];
        const k = Math.min(1, dt * 4);
        shared.uLightColor.value.lerp(m.light, k);
        volUniforms.uFogTint.value.lerp(m.fog, k);
        volUniforms.uAmbient.value.lerp(m.ambient, k);
        volUniforms.uDensity.value += (m.density - volUniforms.uDensity.value) * k;
      }
    },
    render(s: ViewSize) {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      shared.uAspect.value = s.aspect;
      dustUniforms.uSizeScale.value = s.h / 800;
    },
    setQuality(q) {
      volUniforms.uSteps.value = q === 'full' ? 76 : 40;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        // レイマーチカメラは焦点距離でズームする（大きいほど寄り）
        shared.uFocal.value = THREE.MathUtils.clamp(shared.uFocal.value * Math.exp(-(p.dz ?? 0)), 1.1, 2.9);
        return;
      }
      if (p.type === 'move' || p.type === 'down') {
        const yaw = -p.x * 0.5;
        const pitch = 0.28 + (1 - p.v) * 0.5;
        lightTarget
          .set(Math.sin(yaw), -Math.sin(pitch), Math.cos(pitch))
          .normalize();
        shared.uCamTarget.value.x = p.x * 0.3;
        shared.uCamTarget.value.y = 1.35 + p.y * 0.12;
      }
      if (p.type === 'tap') {
        mood = (mood + 1) % MOODS.length;
        moodBlend = 0;
      }
    },
  };
}
