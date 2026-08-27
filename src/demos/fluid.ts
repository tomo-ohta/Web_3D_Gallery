import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, Quality, ViewSize } from '../core/types';
import { PingPong, makeTarget, pass, FSQuad } from '../core/gpgpu';

/**
 * 安定流体法（Jos Stam / GPU Gems 系）による 2D インク流体。
 * 移流 → 渦度強制 → 発散 → 圧力反復 → 勾配減算 の GPGPU パイプライン。
 */

const ADVECT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;
  vec4 result = texture2D(uSource, coord);
  float decay = 1.0 + uDissipation * uDt;
  gl_FragColor = result / decay;
}
`;

const SPLAT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

const CURL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

const VORTICITY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel += force * uDt;
  vel = clamp(vel, -1000.0, 1000.0);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

const DIVERGENCE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vUv.x - uTexel.x < 0.0) { L = -C.x; }
  if (vUv.x + uTexel.x > 1.0) { R = -C.x; }
  if (vUv.y - uTexel.y < 0.0) { B = -C.y; }
  if (vUv.y + uTexel.y > 1.0) { T = -C.y; }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const CLEAR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uValue;
void main() {
  gl_FragColor = uValue * texture2D(uTexture, vUv);
}
`;

const PRESSURE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_SUBTRACT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const DISPLAY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uDye;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(uDye, vUv).rgb;
  vec3 lc = texture2D(uDye, vUv - vec2(uTexel.x, 0.0)).rgb;
  vec3 rc = texture2D(uDye, vUv + vec2(uTexel.x, 0.0)).rgb;
  vec3 bc = texture2D(uDye, vUv - vec2(0.0, uTexel.y)).rgb;
  vec3 tc = texture2D(uDye, vUv + vec2(0.0, uTexel.y)).rgb;
  float dx = length(rc) - length(lc);
  float dy = length(tc) - length(bc);
  vec3 n = normalize(vec3(dx, dy, length(uTexel)));
  float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
  c *= diffuse;
  // 濃い部分に艶を足す
  c += pow(c, vec3(2.2)) * 0.25;
  float vig = 1.0 - dot(vUv - 0.5, vUv - 0.5) * 0.55;
  gl_FragColor = vec4(c * vig, 1.0);
}
`;

interface Res {
  sim: [number, number];
  dye: [number, number];
  iters: number;
}
const RES: Record<Quality, Res> = {
  preview: { sim: [256, 160], dye: [640, 400], iters: 22 },
  full: { sim: [384, 240], dye: [1152, 720], iters: 36 },
};

export async function createFluid(ctx: DemoContext): Promise<Demo> {
  let quality: Quality = 'preview';

  let velocity!: PingPong;
  let dye!: PingPong;
  let pressure!: PingPong;
  let divergence!: THREE.WebGLRenderTarget;
  let curl!: THREE.WebGLRenderTarget;
  let simTexel = new THREE.Vector2();
  let dyeTexel = new THREE.Vector2();

  const build = () => {
    const r = RES[quality];
    velocity?.dispose();
    dye?.dispose();
    pressure?.dispose();
    divergence?.dispose();
    curl?.dispose();
    velocity = new PingPong(r.sim[0], r.sim[1]);
    dye = new PingPong(r.dye[0], r.dye[1]);
    pressure = new PingPong(r.sim[0], r.sim[1], { filter: THREE.NearestFilter });
    divergence = makeTarget(r.sim[0], r.sim[1], { filter: THREE.NearestFilter });
    curl = makeTarget(r.sim[0], r.sim[1], { filter: THREE.NearestFilter });
    simTexel.set(1 / r.sim[0], 1 / r.sim[1]);
    dyeTexel.set(1 / r.dye[0], 1 / r.dye[1]);
  };
  build();

  const advectPass = pass(ADVECT, {
    uVelocity: { value: null },
    uSource: { value: null },
    uTexel: { value: simTexel },
    uDt: { value: 0.016 },
    uDissipation: { value: 0.2 },
  });
  const splatPass = pass(SPLAT, {
    uTarget: { value: null },
    uAspect: { value: 1.6 },
    uColor: { value: new THREE.Vector3() },
    uPoint: { value: new THREE.Vector2() },
    uRadius: { value: 0.0025 },
  });
  const curlPass = pass(CURL, { uVelocity: { value: null }, uTexel: { value: simTexel } });
  const vorticityPass = pass(VORTICITY, {
    uVelocity: { value: null },
    uCurl: { value: null },
    uTexel: { value: simTexel },
    uCurlStrength: { value: 26 },
    uDt: { value: 0.016 },
  });
  const divergencePass = pass(DIVERGENCE, { uVelocity: { value: null }, uTexel: { value: simTexel } });
  const clearPass = pass(CLEAR, { uTexture: { value: null }, uValue: { value: 0.8 } });
  const pressurePass = pass(PRESSURE, {
    uPressure: { value: null },
    uDivergence: { value: null },
    uTexel: { value: simTexel },
  });
  const gradientPass = pass(GRADIENT_SUBTRACT, {
    uPressure: { value: null },
    uVelocity: { value: null },
    uTexel: { value: simTexel },
  });
  const displayPass = pass(DISPLAY, { uDye: { value: null }, uTexel: { value: dyeTexel } });

  const renderer = ctx.renderer;
  let aspect = 1.6;
  let hue = Math.random();
  let idleTimer = 10;
  let autoTimer = 0.0;
  let lastPoint: { u: number; v: number } | null = null;

  const hsv2rgb = (h: number, s: number, v: number): THREE.Vector3 => {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const m = [
      [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
    ][i % 6];
    return new THREE.Vector3(m[0], m[1], m[2]);
  };

  const splat = (u: number, v: number, du: number, dv: number, color: THREE.Vector3, radius = 0.0022) => {
    // 速度スプラット
    splatPass.material.uniforms.uTarget.value = velocity.read.texture;
    splatPass.material.uniforms.uAspect.value = aspect;
    splatPass.material.uniforms.uPoint.value.set(u, v);
    splatPass.material.uniforms.uColor.value.set(du * 5800, dv * 5800, 0);
    splatPass.material.uniforms.uRadius.value = radius;
    splatPass.render(renderer, velocity.write);
    velocity.swap();
    // 染料スプラット
    splatPass.material.uniforms.uTarget.value = dye.read.texture;
    splatPass.material.uniforms.uColor.value.copy(color);
    splatPass.render(renderer, dye.write);
    dye.swap();
  };

  return {
    exposure: 1.0,

    update(dt, t) {
      const simDt = Math.min(dt, 1 / 40);
      idleTimer += dt;

      // 放置時の自動スプラット（2本のリサージュ軌道）
      if (idleTimer > 2.0) {
        autoTimer -= dt;
        if (autoTimer <= 0) {
          autoTimer = 0.045;
          const tt = t * 0.72;
          for (let k = 0; k < 2; k++) {
            const ph = k * Math.PI;
            const u = 0.5 + 0.35 * Math.sin(tt * 1.3 + ph) * Math.cos(tt * 0.4);
            const v = 0.5 + 0.32 * Math.sin(tt * 0.9 + 1.3 + ph);
            const du = Math.cos(tt * 1.3 + ph) * 0.03;
            const dv = Math.cos(tt * 0.9 + 1.3 + ph) * 0.024;
            hue = (t * 0.05 + k * 0.45) % 1;
            splat(u, v, du, dv, hsv2rgb(hue, 0.95, 0.85).multiplyScalar(0.5), 0.0024);
          }
        }
      }

      const r = RES[quality];

      // 移流（速度場）
      advectPass.material.uniforms.uTexel.value = simTexel;
      advectPass.material.uniforms.uDt.value = simDt;
      advectPass.material.uniforms.uVelocity.value = velocity.read.texture;
      advectPass.material.uniforms.uSource.value = velocity.read.texture;
      advectPass.material.uniforms.uDissipation.value = 0.12;
      advectPass.render(renderer, velocity.write);
      velocity.swap();

      // 移流（染料）
      advectPass.material.uniforms.uVelocity.value = velocity.read.texture;
      advectPass.material.uniforms.uSource.value = dye.read.texture;
      advectPass.material.uniforms.uDissipation.value = 0.32;
      advectPass.render(renderer, dye.write);
      dye.swap();

      // 渦度強制
      curlPass.material.uniforms.uVelocity.value = velocity.read.texture;
      curlPass.render(renderer, curl);
      vorticityPass.material.uniforms.uVelocity.value = velocity.read.texture;
      vorticityPass.material.uniforms.uCurl.value = curl.texture;
      vorticityPass.material.uniforms.uDt.value = simDt;
      vorticityPass.render(renderer, velocity.write);
      velocity.swap();

      // 圧力投影
      divergencePass.material.uniforms.uVelocity.value = velocity.read.texture;
      divergencePass.render(renderer, divergence);
      clearPass.material.uniforms.uTexture.value = pressure.read.texture;
      clearPass.render(renderer, pressure.write);
      pressure.swap();
      for (let i = 0; i < r.iters; i++) {
        pressurePass.material.uniforms.uPressure.value = pressure.read.texture;
        pressurePass.material.uniforms.uDivergence.value = divergence.texture;
        pressurePass.render(renderer, pressure.write);
        pressure.swap();
      }
      gradientPass.material.uniforms.uPressure.value = pressure.read.texture;
      gradientPass.material.uniforms.uVelocity.value = velocity.read.texture;
      gradientPass.render(renderer, velocity.write);
      velocity.swap();

      renderer.setRenderTarget(null);
    },

    render() {
      displayPass.material.uniforms.uDye.value = dye.read.texture;
      displayPass.material.uniforms.uTexel.value = dyeTexel;
      displayPass.render(renderer, null);
    },

    setSize(s: ViewSize) {
      aspect = s.aspect;
    },

    setQuality(q) {
      if (q === quality) return;
      quality = q;
      build();
    },

    pointer(p: PointerInfo) {
      if (p.type === 'down') {
        lastPoint = { u: p.u, v: p.v };
        idleTimer = 0;
      }
      if (p.type === 'move' && p.down && lastPoint) {
        idleTimer = 0;
        const du = p.u - lastPoint.u;
        const dv = p.v - lastPoint.v;
        lastPoint = { u: p.u, v: p.v };
        if (Math.abs(du) + Math.abs(dv) > 0.0001) {
          hue = (hue + Math.abs(du) * 0.6 + Math.abs(dv) * 0.6 + 0.002) % 1;
          splat(p.u, p.v, du, dv, hsv2rgb(hue, 0.95, 0.9).multiplyScalar(0.55));
        }
      }
      if (p.type === 'up' || p.type === 'leave') lastPoint = null;
      if (p.type === 'tap') {
        idleTimer = 0;
        const base = Math.random();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + Math.random();
          const du = Math.cos(a) * 0.028;
          const dv = Math.sin(a) * 0.028;
          splat(p.u, p.v, du, dv, hsv2rgb((base + i * 0.11) % 1, 0.95, 0.95).multiplyScalar(0.75), 0.0038);
        }
      }
    },

    dispose() {
      velocity.dispose();
      dye.dispose();
      pressure.dispose();
      divergence.dispose();
      curl.dispose();
    },
  };
}
