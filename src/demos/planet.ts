import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** プロシージャル惑星。地形・海・雲・大気をシェーダーで生成し、タップでシード再生成 */

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
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float r = 0.0;
  for (int i = 0; i < 5; i++) {
    r += vnoise(p) * a;
    p = p * 2.07 + vec3(17.3);
    a *= 0.5;
  }
  return r;
}
float terrainH(vec3 dir, vec3 seed) {
  float n = fbm(dir * 2.1 + seed);
  float ridge = 1.0 - abs(fbm(dir * 3.4 + seed * 1.7) * 2.0 - 1.0);
  float h = (n - 0.52) * 1.6 + ridge * ridge * 0.35 * smoothstep(0.45, 0.75, n);
  return h * 0.16;
}
`;

const TERRAIN_VERT = /* glsl */ `
uniform vec3 uSeed;
varying vec3 vDir;
varying vec3 vWorld;
varying float vH;
${NOISE}
void main() {
  vec3 dir = normalize(position);
  vDir = dir;
  float h = terrainH(dir, uSeed);
  vH = h;
  vec3 p = dir * (1.0 + max(h, 0.0));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TERRAIN_FRAG = /* glsl */ `
uniform vec3 uSeed;
uniform vec3 uSunDir;
varying vec3 vDir;
varying vec3 vWorld;
varying float vH;
${NOISE}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  // ローポリ調のフラット法線
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lat = abs(vDir.y);
  float h = vH;

  vec3 sand = vec3(0.78, 0.68, 0.45);
  vec3 grass = vec3(0.22, 0.46, 0.22);
  vec3 forest = vec3(0.11, 0.3, 0.15);
  vec3 rock = vec3(0.42, 0.38, 0.34);
  vec3 snow = vec3(0.92, 0.94, 0.97);

  vec3 col = sand;
  col = mix(col, grass, smoothstep(0.004, 0.02, h));
  col = mix(col, forest, smoothstep(0.02, 0.055, h) * (0.4 + 0.6 * vnoise(vDir * 14.0 + uSeed)));
  float slope = 1.0 - clamp(dot(N, normalize(vWorld)), 0.0, 1.0);
  col = mix(col, rock, smoothstep(0.25, 0.55, slope));
  col = mix(col, snow, smoothstep(0.075, 0.1, h + lat * 0.055));
  col = mix(col, snow, smoothstep(0.86, 0.94, lat));

  float diff = max(dot(N, uSunDir), 0.0);
  float night = smoothstep(0.05, -0.12, dot(normalize(vWorld), uSunDir));
  vec3 lit = col * (diff * 1.15 + 0.05) + col * vec3(0.1, 0.12, 0.2) * 0.3;
  lit = mix(lit, col * vec3(0.02, 0.03, 0.06), night);

  lit = aces(lit * 1.25);
  lit = pow(lit, vec3(1.0 / 2.2));
  gl_FragColor = vec4(lit, 1.0);
}
`;

const OCEAN_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float w = vnoise(vWorld * 26.0 + uTime * 0.25) * 0.5 + vnoise(vWorld * 55.0 - uTime * 0.2) * 0.25;
  N = normalize(N + vec3(w - 0.35) * 0.06);
  float diff = max(dot(N, uSunDir), 0.0);
  float night = smoothstep(0.05, -0.12, dot(N, uSunDir));
  vec3 deep = vec3(0.03, 0.13, 0.3);
  vec3 shallow = vec3(0.05, 0.3, 0.45);
  vec3 col = mix(deep, shallow, diff * 0.6);
  vec3 R = reflect(-V, N);
  col += vec3(1.0, 0.95, 0.8) * pow(max(dot(R, uSunDir), 0.0), 90.0) * 1.6;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.3, 0.45, 0.6) * fres * diff * 0.5;
  col = mix(col, vec3(0.01, 0.02, 0.05), night);
  col = aces(col * 1.25);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSeed;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;
varying vec3 vNormalW;
${NOISE}
void main() {
  vec3 p = vDir;
  float sw = uTime * 0.008;
  float n = fbm(p * 3.1 + uSeed * 2.0 + vec3(sw, 0.0, sw * 0.7));
  float a = smoothstep(0.52, 0.72, n);
  float diff = max(dot(normalize(vNormalW), uSunDir), 0.0);
  float night = smoothstep(0.06, -0.1, dot(normalize(vNormalW), uSunDir));
  vec3 col = vec3(1.0) * (diff * 0.9 + 0.12);
  col = mix(col, vec3(0.05), night);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, a * 0.85);
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float rim = pow(1.0 - abs(dot(V, N)), 2.6);
  float sun = max(dot(N, uSunDir), 0.0) * 0.85 + 0.15;
  vec3 col = vec3(0.3, 0.55, 1.0) * rim * sun * 1.4;
  gl_FragColor = vec4(col, rim);
}
`;

const BASIC_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export async function createPlanet(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030308);
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 100);
  scene.add(camera);

  // 星空
  const starArr = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40);
    starArr.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab4d0, size: 0.07 })));

  const sunDir = new THREE.Vector3(1, 0.35, 0.5).normalize();
  const shared = {
    uSeed: { value: new THREE.Vector3(3.7, 1.2, 8.4) },
    uSunDir: { value: sunDir },
    uTime: { value: 0 },
  };

  const terrain = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 64),
    new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: shared }),
  );
  scene.add(terrain);

  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1.001, 96, 64),
    new THREE.ShaderMaterial({ vertexShader: BASIC_VERT, fragmentShader: OCEAN_FRAG, uniforms: shared }),
  );
  scene.add(ocean);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: shared,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(clouds);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: shared,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  scene.add(atmo);

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.35, radius: 2.9, autoRotate: 0.06, minRadius: 1.6, maxRadius: 6 });
  const label = new LabelSprite(camera);
  let seedCount = 1;

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      shared.uTime.value = t;
      terrain.rotation.y = t * 0.02;
      ocean.rotation.y = t * 0.02;
      clouds.rotation.y = t * 0.028;
      sunDir.set(Math.cos(t * 0.05), 0.3, Math.sin(t * 0.05)).normalize();
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
        seedCount++;
        shared.uSeed.value.set(Math.random() * 40, Math.random() * 40, Math.random() * 40);
        label.set(`惑星 No.${seedCount}`);
      }
    },
  };
}
