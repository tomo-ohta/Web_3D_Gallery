import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';

/** 層状レイマーチングによるオーロラ。ポインタでカーテンが揺れる */

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAspect;
uniform float uTime;
uniform float uFocal;
uniform float uYaw;
uniform float uSway;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uIntensity;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
    mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x),
    f.y);
}
float fbm2(vec2 p) {
  float a = 0.5;
  float r = 0.0;
  for (int i = 0; i < 4; i++) {
    r += vnoise2(p) * a;
    p = p * 2.1 + vec2(31.7);
    a *= 0.5;
  }
  return r;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 aurora(vec3 ro, vec3 rd) {
  vec3 acc = vec3(0.0);
  if (rd.y < 0.02) return acc;
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    float h = 2.2 + fi * 0.24; // カーテンの高度層
    float t = (h - ro.y) / rd.y;
    vec2 p = ro.xz + rd.xz * t;
    // カーテンの筋
    float curtain = fbm2(vec2(p.x * 0.28 + uTime * 0.05 + uSway * 0.8, p.y * 0.1));
    curtain = pow(smoothstep(0.35, 0.9, curtain), 2.2);
    float band = curtain * exp(-fi * 0.10) * exp(-max(t - 6.0, 0.0) * 0.03);
    vec3 col = mix(uColA, uColB, clamp(fi / 22.0 + fbm2(p * 0.1) * 0.3, 0.0, 1.0));
    acc += col * band * 0.16;
  }
  return acc * uIntensity;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  vec3 fw = normalize(vec3(sy, 0.46, -cy));
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * uFocal + rt * ndc.x * uAspect + up * ndc.y);
  vec3 ro = vec3(0.0, 0.6, 0.0);

  // 星空
  vec3 col = mix(vec3(0.004, 0.008, 0.02), vec3(0.012, 0.03, 0.07), clamp(rd.y * 1.6, 0.0, 1.0));
  vec2 sid = floor(rd.xy / max(abs(rd.z), 0.15) * 160.0 + uYaw * 100.0);
  float star = pow(hash12(sid), 400.0) * 2.2 * smoothstep(0.0, 0.2, rd.y);
  col += vec3(star) * (0.6 + 0.4 * sin(uTime * 2.0 + hash12(sid) * 40.0));

  // 山のシルエットと雪原
  float ridge = fbm2(vec2(atan(rd.x, -rd.z) * 2.2 + uYaw * 2.0, 0.0)) * 0.12 - 0.04;
  float horizon = smoothstep(ridge + 0.004, ridge - 0.004, rd.y);

  // オーロラ本体
  vec3 aur = aurora(ro, rd);
  col += aur;

  // 地面: 雪原がオーロラをうっすら反射
  if (rd.y < ridge) {
    vec3 ground = vec3(0.02, 0.03, 0.055);
    vec3 rrd = vec3(rd.x, abs(rd.y) * 0.6 + 0.1, rd.z);
    ground += aurora(ro, rrd) * 0.25;
    float snowGlow = smoothstep(0.0, -0.3, rd.y) * 0.02;
    ground += vec3(snowGlow);
    col = mix(col, ground, horizon);
  }

  col = aces(col * 1.3);
  col = pow(col, vec3(1.0 / 2.2));
  col *= 1.0 - dot(ndc * 0.45, ndc * 0.45) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  intensity: number;
}
const PALETTES: Palette[] = [
  { a: new THREE.Color(0.1, 0.9, 0.45), b: new THREE.Color(0.5, 0.2, 0.9), intensity: 1.0 },
  { a: new THREE.Color(0.85, 0.2, 0.5), b: new THREE.Color(0.25, 0.3, 1.0), intensity: 1.1 },
  { a: new THREE.Color(0.15, 0.75, 0.9), b: new THREE.Color(0.1, 0.9, 0.4), intensity: 0.95 },
];

export async function createAurora(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  const uniforms = {
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uFocal: { value: 1.25 },
    uYaw: { value: 0 },
    uSway: { value: 0 },
    uColA: { value: PALETTES[0].a.clone() },
    uColB: { value: PALETTES[0].b.clone() },
    uIntensity: { value: 1.0 },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: FRAG,
      uniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );
  quad.frustumCulled = false;
  scene.add(quad);

  let paletteIndex = 0;
  let yawTarget = 0;
  let swayTarget = 0;

  return {
    exposure: 1.0,
    update(dt, t) {
      uniforms.uTime.value = t;
      uniforms.uYaw.value += (yawTarget - uniforms.uYaw.value) * Math.min(1, dt * 2.5);
      uniforms.uSway.value += (swayTarget + Math.sin(t * 0.23) * 0.6 - uniforms.uSway.value) * Math.min(1, dt * 1.6);
      const p = PALETTES[paletteIndex];
      const k = Math.min(1, dt * 2.2);
      uniforms.uColA.value.lerp(p.a, k);
      uniforms.uColB.value.lerp(p.b, k);
      uniforms.uIntensity.value += (p.intensity - uniforms.uIntensity.value) * k;
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      uniforms.uAspect.value = s.aspect;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        uniforms.uFocal.value = THREE.MathUtils.clamp(uniforms.uFocal.value * Math.exp(-(p.dz ?? 0)), 0.9, 2.4);
        return;
      }
      if (p.type === 'move' || p.type === 'down') {
        yawTarget = p.x * 0.55;
        swayTarget = p.x * 2.2;
      }
      if (p.type === 'tap') {
        paletteIndex = (paletteIndex + 1) % PALETTES.length;
      }
    },
  };
}
