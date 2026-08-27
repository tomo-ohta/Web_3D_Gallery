import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';

/** Mandelbulb（3Dフラクタル）のスフィアトレーシング。タップで次数が変形する */

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAspect;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamRt;
uniform vec3 uCamUp;
uniform vec3 uCamFw;
uniform float uPower;
uniform float uSteps;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// distance estimator
float DE(vec3 pos, out float trap) {
  vec3 z = pos;
  float dr = 1.0;
  float r = 0.0;
  trap = 1e5;
  for (int i = 0; i < 9; i++) {
    r = length(z);
    trap = min(trap, r);
    if (r > 2.0) break;
    float theta = acos(clamp(z.z / r, -1.0, 1.0)) * uPower;
    float phi = atan(z.y, z.x) * uPower;
    float zr = pow(r, uPower);
    dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
    z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + pos;
  }
  return 0.5 * log(r) * r / dr;
}

vec3 palette(float t) {
  return 0.52 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.62) + t * 0.9 + 0.45));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFw * 1.7 + uCamRt * ndc.x * uAspect + uCamUp * ndc.y);
  vec3 ro = uCamPos;

  float t = 0.0;
  float trap = 1e5;
  float d = 1e5;
  int steps = 0;
  bool hit = false;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    steps = i;
    float tr;
    d = DE(ro + rd * t, tr);
    trap = min(trap, tr);
    if (d < 0.0008 * (0.4 + t)) { hit = true; break; }
    t += d * 0.9;
    if (t > 8.0) break;
  }

  // 背景: 深宇宙
  float star = pow(hash12(floor(ndc * vec2(uAspect, 1.0) * 240.0)), 300.0) * 2.0;
  vec3 col = mix(vec3(0.012, 0.01, 0.03), vec3(0.05, 0.03, 0.09), vUv.y) + vec3(star);

  if (hit) {
    vec3 p = ro + rd * t;
    // 法線（DE勾配）
    float tr0;
    vec2 e = vec2(0.0012, 0.0);
    vec3 n = normalize(vec3(
      DE(p + e.xyy, tr0) - DE(p - e.xyy, tr0),
      DE(p + e.yxy, tr0) - DE(p - e.yxy, tr0),
      DE(p + e.yyx, tr0) - DE(p - e.yyx, tr0)
    ));
    float ao = 1.0 - float(steps) / uSteps;
    ao = ao * ao;
    vec3 base = palette(trap);
    vec3 L1 = normalize(vec3(0.7, 0.6, 0.4));
    vec3 L2 = normalize(vec3(-0.6, -0.2, -0.5));
    float diff = max(dot(n, L1), 0.0);
    float diff2 = max(dot(n, L2), 0.0) * 0.35;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = base * (diff * 1.2 + diff2 + 0.12) * ao;
    col += vec3(0.9, 0.7, 1.0) * rim * 0.4 * ao;
    col += vec3(1.0) * pow(max(dot(reflect(rd, n), L1), 0.0), 24.0) * 0.5 * ao;
    // 距離フォグ
    col = mix(col, vec3(0.02, 0.015, 0.045), smoothstep(2.5, 7.0, t));
  }

  col = aces(col * 1.3);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createMandelbulb(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  const rig = new THREE.PerspectiveCamera(40, 1.6, 0.1, 50);
  scene.add(rig);

  const uniforms = {
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamRt: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uCamFw: { value: new THREE.Vector3() },
    uPower: { value: 8 },
    uSteps: { value: 72 },
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

  const orbit = new OrbitDrag(rig, { theta: 0.6, phi: 1.35, radius: 2.6, autoRotate: 0.07, minRadius: 1.35, maxRadius: 4.5 });
  const powers = [8, 5, 3.2, 12];
  let powerIndex = 0;
  let powerTarget = 8;

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      uniforms.uTime.value = t;
      uniforms.uPower.value += (powerTarget - uniforms.uPower.value) * Math.min(1, dt * 1.1);
      rig.updateMatrixWorld();
      uniforms.uCamPos.value.copy(rig.position);
      rig.matrixWorld.extractBasis(uniforms.uCamRt.value, uniforms.uCamUp.value, uniforms.uCamFw.value);
      uniforms.uCamFw.value.multiplyScalar(-1);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      uniforms.uAspect.value = s.aspect;
      rig.aspect = s.aspect;
    },
    setQuality(q) {
      uniforms.uSteps.value = q === 'full' ? 110 : 72;
    },
    pointer(p: PointerInfo) {
      orbit.pointer(p);
      if (p.type === 'tap') {
        powerIndex = (powerIndex + 1) % powers.length;
        powerTarget = powers[powerIndex];
      }
    },
  };
}
