import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** ゲルストナー波によるプロシージャル海洋。凪 / うねり / 時化 を切替 */

const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;

vec3 skyColor(vec3 d) {
  float t = pow(clamp(d.y, 0.0, 1.0), 0.58);
  vec3 sky = mix(uHorizon, uZenith, t);
  float sunAmt = max(dot(d, uSunDir), 0.0);
  sky += uSunColor * pow(sunAmt, 18.0) * 0.5;
  sky += uSunColor * smoothstep(0.9994, 0.9999, sunAmt) * 22.0;
  return sky;
}
vec3 acesTone(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

const OCEAN_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform vec4 uWaves[6]; // dir.x, dir.z, steepness, wavelength
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;

vec3 gerstner(vec2 xz, vec4 w, float amp, inout vec3 tangent, inout vec3 binormal) {
  float steep = w.z * amp;
  float k = 6.28318530 / w.w;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(w.xy);
  float f = k * (dot(d, xz) - c * uTime);
  float a = steep / k;
  float sf = sin(f);
  float cf = cos(f);
  tangent += vec3(-d.x * d.x * steep * sf, d.x * steep * cf, -d.x * d.y * steep * sf);
  binormal += vec3(-d.x * d.y * steep * sf, d.y * steep * cf, -d.y * d.y * steep * sf);
  return vec3(d.x * a * cf, a * sf, d.y * a * cf);
}

void main() {
  vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 xz = base.xz;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 p = base;
  float crest = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 off = gerstner(xz, uWaves[i], uAmp, tangent, binormal);
    p += off;
    crest += off.y;
  }
  vNormal = normalize(cross(binormal, tangent));
  vWorld = p;
  vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const OCEAN_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform float uFoam;
uniform float uFogDist;
uniform float uTime;
uniform float uAmp;
${SKY_GLSL}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
    mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x),
    f.y);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;

  // 細かい法線の揺らぎ
  float n1 = vnoise2(vWorld.xz * 1.4 + uTime * 0.35);
  float n2 = vnoise2(vWorld.xz * 3.1 - uTime * 0.22);
  N = normalize(N + vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.22);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 skyRefl = skyColor(R);

  // 水中の散乱（波頭が光を透かす）
  float crest01 = clamp(vCrest / max(uAmp * 1.6, 0.05) * 0.5 + 0.5, 0.0, 1.0);
  float sunBack = pow(max(dot(V, uSunDir), 0.0), 3.0);
  vec3 body = uDeep + uScatter * (crest01 * crest01 * (0.5 + sunBack * 0.9));

  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(body, skyRefl, F);

  // スペキュラ
  float spec = pow(max(dot(R, uSunDir), 0.0), 540.0);
  col += uSunColor * spec * 2.4;

  // 泡（波頭 + ノイズ）
  float foamNoise = vnoise2(vWorld.xz * 1.15 + uTime * 0.32) * 0.65
                  + vnoise2(vWorld.xz * 4.2 - uTime * 0.5) * 0.35;
  float foamMask = smoothstep(0.92, 1.2, crest01 + foamNoise * 0.55 - 0.28 + uFoam * 0.32) * uFoam;
  vec3 foamCol = vec3(0.92, 0.96, 0.98) * (0.55 + 0.45 * max(dot(N, uSunDir), 0.0));
  col = mix(col, foamCol, clamp(foamMask, 0.0, 0.85));

  // 距離フォグ（水平線へ溶ける）
  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-dist / uFogDist);
  col = mix(col, skyColor(normalize(vec3(V.x, 0.02, V.z) * -1.0)), fog);

  col = acesTone(col * 1.25);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKYDOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // 常に最遠
}
`;

const SKYDOME_FRAG = /* glsl */ `
varying vec3 vDir;
${SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(vec3(d.x, max(d.y, 0.0), d.z));
  col = acesTone(col);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

interface OceanPreset {
  label: string;
  amp: number;
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  zenith: THREE.Color;
  horizon: THREE.Color;
  deep: THREE.Color;
  scatter: THREE.Color;
  foam: number;
  fog: number;
}

const PRESETS: OceanPreset[] = [
  {
    label: '凪 — 夕暮れ',
    amp: 0.34,
    sun: new THREE.Vector3(-0.7, 0.16, -0.7).normalize(),
    sunColor: new THREE.Color(1.0, 0.55, 0.28),
    zenith: new THREE.Color(0.13, 0.2, 0.42),
    horizon: new THREE.Color(0.95, 0.55, 0.32),
    deep: new THREE.Color(0.015, 0.05, 0.09),
    scatter: new THREE.Color(0.16, 0.24, 0.28),
    foam: 0.12,
    fog: 420,
  },
  {
    label: 'うねり — 快晴',
    amp: 1.0,
    sun: new THREE.Vector3(-0.5, 0.52, -0.68).normalize(),
    sunColor: new THREE.Color(1.0, 0.95, 0.82),
    zenith: new THREE.Color(0.1, 0.34, 0.68),
    horizon: new THREE.Color(0.62, 0.8, 0.92),
    deep: new THREE.Color(0.012, 0.09, 0.14),
    scatter: new THREE.Color(0.05, 0.38, 0.36),
    foam: 0.5,
    fog: 380,
  },
  {
    label: '時化 — 荒天',
    amp: 1.8,
    sun: new THREE.Vector3(-0.6, 0.24, -0.75).normalize(),
    sunColor: new THREE.Color(0.55, 0.58, 0.62),
    zenith: new THREE.Color(0.2, 0.24, 0.3),
    horizon: new THREE.Color(0.42, 0.47, 0.53),
    deep: new THREE.Color(0.015, 0.04, 0.055),
    scatter: new THREE.Color(0.08, 0.16, 0.16),
    foam: 1.0,
    fog: 150,
  },
];

export async function createOcean(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.5, 900);
  scene.add(camera);

  const shared = {
    uSunDir: { value: PRESETS[1].sun.clone() },
    uSunColor: { value: PRESETS[1].sunColor.clone() },
    uZenith: { value: PRESETS[1].zenith.clone() },
    uHorizon: { value: PRESETS[1].horizon.clone() },
  };

  const waves = [
    new THREE.Vector4(1.0, 0.3, 0.16, 26.0),
    new THREE.Vector4(0.7, -0.6, 0.14, 14.0),
    new THREE.Vector4(-0.3, 0.8, 0.12, 9.0),
    new THREE.Vector4(0.9, 0.8, 0.1, 5.2),
    new THREE.Vector4(-0.8, -0.4, 0.08, 3.0),
    new THREE.Vector4(0.2, -1.0, 0.06, 1.7),
  ];

  const oceanUniforms = {
    ...shared,
    uTime: { value: 0 },
    uAmp: { value: PRESETS[1].amp },
    uWaves: { value: waves },
    uDeep: { value: PRESETS[1].deep.clone() },
    uScatter: { value: PRESETS[1].scatter.clone() },
    uFoam: { value: PRESETS[1].foam },
    uFogDist: { value: PRESETS[1].fog },
  };

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 760, 300, 300),
    new THREE.ShaderMaterial({ vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG, uniforms: oceanUniforms }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.frustumCulled = false;
  scene.add(ocean);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKYDOME_VERT,
      fragmentShader: SKYDOME_FRAG,
      uniforms: shared,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  scene.add(sky);

  const orbit = new OrbitDrag(camera, { theta: 2.6, phi: 1.32, radius: 17, autoRotate: 0.02, targetY: 2.2 });
  orbit.minPhi = 1.05;
  orbit.maxPhi = 1.49;
  const label = new LabelSprite(camera);

  let presetIndex = 1;

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      oceanUniforms.uTime.value = t;

      const p = PRESETS[presetIndex];
      const k = Math.min(1, dt * 1.4);
      oceanUniforms.uAmp.value += (p.amp - oceanUniforms.uAmp.value) * k;
      oceanUniforms.uFoam.value += (p.foam - oceanUniforms.uFoam.value) * k;
      oceanUniforms.uFogDist.value += (p.fog - oceanUniforms.uFogDist.value) * k;
      shared.uSunDir.value.lerp(p.sun, k).normalize();
      shared.uSunColor.value.lerp(p.sunColor, k);
      shared.uZenith.value.lerp(p.zenith, k);
      shared.uHorizon.value.lerp(p.horizon, k);
      oceanUniforms.uDeep.value.lerp(p.deep, k);
      oceanUniforms.uScatter.value.lerp(p.scatter, k);
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
        presetIndex = (presetIndex + 1) % PRESETS.length;
        label.set(PRESETS[presetIndex].label);
      }
    },
  };
}
