import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';

/** ボリュームレイマーチングの雲海。ドラッグで太陽を動かし時刻が変わる */

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAspect;
uniform float uTime;
uniform float uFocal;
uniform vec3 uSunDir;
uniform float uCoverage;
uniform float uSteps;
uniform float uOffset;

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
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float r = 0.0;
  for (int i = 0; i < 4; i++) {
    r += vnoise(p) * a;
    p = p * 2.13 + vec3(11.3);
    a *= 0.5;
  }
  return r;
}

const float CLOUD_LO = 0.0;
const float CLOUD_HI = 1.7;

float density(vec3 p) {
  float prof = smoothstep(CLOUD_LO, CLOUD_LO + 0.5, p.y) * smoothstep(CLOUD_HI, CLOUD_HI - 0.8, p.y);
  float n = fbm(p * vec3(0.32, 0.5, 0.32) + vec3(uOffset, 0.0, uOffset * 0.6));
  n += fbm(p * vec3(1.3, 1.8, 1.3) + vec3(uOffset * 1.8, 0.0, 0.0)) * 0.25;
  float d = smoothstep(uCoverage, uCoverage + 0.32, n);
  return d * prof * 0.85;
}

vec3 skyColor(vec3 d, float elev) {
  vec3 dayZen = vec3(0.16, 0.4, 0.75);
  vec3 dayHor = vec3(0.72, 0.85, 0.95);
  vec3 setZen = vec3(0.12, 0.14, 0.32);
  vec3 setHor = vec3(0.98, 0.52, 0.28);
  float k = smoothstep(0.05, 0.5, elev);
  vec3 zen = mix(setZen, dayZen, k);
  vec3 hor = mix(setHor, dayHor, k);
  vec3 sky = mix(hor, zen, pow(clamp(d.y, 0.0, 1.0), 0.6));
  float sunAmt = max(dot(d, uSunDir), 0.0);
  vec3 sunCol = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.95, 0.85), k);
  sky += sunCol * pow(sunAmt, 14.0) * 0.5;
  sky += sunCol * smoothstep(0.9993, 0.9998, sunAmt) * 18.0;
  return sky;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 ro = vec3(0.0, 2.75, 0.0);
  vec3 fw = normalize(vec3(0.0, -0.18, -1.0));
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * uFocal + rt * ndc.x * uAspect + up * ndc.y);

  float elev = uSunDir.y;
  vec3 sky = skyColor(rd, elev);
  vec3 sunCol = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.97, 0.9), smoothstep(0.05, 0.5, elev));

  // 雲スラブとの交差区間
  float t0 = (CLOUD_HI - ro.y) / rd.y;
  float t1 = (CLOUD_LO - ro.y) / rd.y;
  float tEnter = min(t0, t1);
  float tExit = max(t0, t1);
  tEnter = max(tEnter, 0.0);

  vec3 col = sky;
  if (tExit > 0.0 && rd.y < 0.35) {
    tExit = min(tExit, 34.0);
    float len = tExit - tEnter;
    if (len > 0.0) {
      float stepLen = len / uSteps;
      float jitter = hash13(vec3(gl_FragCoord.xy, fract(uTime) * 17.0));
      vec3 p = ro + rd * (tEnter + stepLen * jitter);
      float tr = 1.0;
      vec3 acc = vec3(0.0);
      float g = 0.4;
      float cosT = dot(rd, uSunDir);
      float ph = (1.0 - g * g) / max(pow(1.0 + g * g - 2.0 * g * cosT, 1.5), 1e-3) * 0.0796 + 0.18;
      for (int i = 0; i < 96; i++) {
        if (float(i) >= uSteps || tr < 0.02) break;
        float d = density(p);
        if (d > 0.005) {
          // ライトマーチ（4歩）
          float lt = 0.0;
          vec3 lp = p;
          for (int j = 0; j < 4; j++) {
            lp += uSunDir * 0.42;
            lt += density(lp) * 0.42;
          }
          float light = exp(-lt * 2.6);
          float powder = 1.0 - exp(-d * 5.0);
          vec3 ambient = mix(vec3(0.25, 0.3, 0.42), vec3(0.5, 0.58, 0.72), smoothstep(0.05, 0.5, elev));
          vec3 s = sunCol * light * ph * 2.4 + ambient * 0.35;
          float a = d * stepLen * 1.6;
          acc += tr * s * a * powder * 2.0;
          tr *= exp(-d * stepLen * 2.2);
        }
        p += rd * stepLen;
      }
      col = sky * tr + acc;
    }
  }

  col = aces(col * 1.15);
  col = pow(col, vec3(1.0 / 2.2));
  col *= 1.0 - dot(ndc * 0.5, ndc * 0.5) * 0.3;
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createClouds(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  const uniforms = {
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uFocal: { value: 1.4 },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.18, -0.9).normalize() },
    uCoverage: { value: 0.44 },
    uSteps: { value: 44 },
    uOffset: { value: 0 },
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

  const sunTarget = uniforms.uSunDir.value.clone();
  const coverages = [0.52, 0.44, 0.3];
  let covIndex = 1;

  return {
    exposure: 1.0,
    update(dt, t) {
      uniforms.uTime.value = t;
      uniforms.uOffset.value += dt * 0.12; // 雲がゆっくり流れる
      uniforms.uSunDir.value.lerp(sunTarget, Math.min(1, dt * 3)).normalize();
      uniforms.uCoverage.value += (coverages[covIndex] - uniforms.uCoverage.value) * Math.min(1, dt * 1.5);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      uniforms.uAspect.value = s.aspect;
    },
    setQuality(q) {
      uniforms.uSteps.value = q === 'full' ? 84 : 44;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        uniforms.uFocal.value = THREE.MathUtils.clamp(uniforms.uFocal.value * Math.exp(-(p.dz ?? 0)), 1.0, 2.6);
        return;
      }
      if (p.type === 'move' || p.type === 'down') {
        const yaw = -p.x * 1.1;
        const elev = THREE.MathUtils.clamp(0.04 + p.v * 0.75, 0.03, 0.85);
        sunTarget.set(Math.sin(yaw) * 0.9, elev, -Math.cos(yaw)).normalize();
      }
      if (p.type === 'tap') {
        covIndex = (covIndex + 1) % coverages.length;
      }
    },
  };
}
