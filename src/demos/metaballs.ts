import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** SDF スフィアトレーシングによる液体金属メタボール。1個はポインタで引き回せる */

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAspect;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamRt;
uniform vec3 uCamUp;
uniform vec3 uCamFw;
uniform vec4 uBalls[7];
uniform sampler2D uEnv;
uniform int uMode;

const float PI = 3.14159265;

vec2 equirectUv(vec3 d) {
  float u = atan(d.z, d.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < 7; i++) {
    float di = length(p - uBalls[i].xyz) - uBalls[i].w;
    d = smin(d, di, 0.42);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 envSample(vec3 d) {
  return texture2D(uEnv, equirectUv(d)).rgb;
}

vec3 hueShift(vec3 c, float s) {
  return mix(c, c.gbr, s);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFw * 1.6 + uCamRt * ndc.x * uAspect + uCamUp * ndc.y);
  vec3 ro = uCamPos;

  float t = 0.0;
  float hit = -1.0;
  int steps = 0;
  for (int i = 0; i < 90; i++) {
    steps = i;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012) { hit = t; break; }
    t += d;
    if (t > 20.0) break;
  }

  vec3 col;
  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    vec3 n = calcNormal(p);
    vec3 refl = reflect(rd, n);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    float ao = 1.0 - float(steps) / 90.0 * 0.6;

    vec3 env = envSample(refl);
    if (uMode == 0) {
      // クローム
      col = env * (0.75 + fres * 0.5) * ao;
    } else if (uMode == 1) {
      // ゴールド
      col = env * vec3(1.0, 0.72, 0.35) * (0.7 + fres * 0.6) * ao;
      col += vec3(0.12, 0.06, 0.01);
    } else {
      // シャボン（薄膜風の虹）
      float film = fres * 3.0 + dot(n, vec3(0.0, 1.0, 0.0)) + uTime * 0.15;
      vec3 rainbow = 0.5 + 0.5 * cos(6.283 * (vec3(0.0, 0.33, 0.67) + film));
      col = env * 0.35 + rainbow * fres * 1.1 + envSample(refract(rd, n, 0.98)) * 0.45;
    }
    // 弱いスペキュラ光
    vec3 L = normalize(vec3(0.6, 0.8, 0.3));
    col += vec3(1.0) * pow(max(dot(refl, L), 0.0), 60.0) * 0.8;
  } else {
    col = envSample(rd) * 0.9;
  }

  col = aces(col * 1.2);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createMetaballs(ctx: DemoContext): Promise<Demo> {
  const envData = await ctx.assets.env('venice');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  // 実際のレイはこのダミーカメラの位置と姿勢から作る
  const rig = new THREE.PerspectiveCamera(40, 1.6, 0.1, 50);

  const balls: THREE.Vector4[] = [];
  for (let i = 0; i < 7; i++) balls.push(new THREE.Vector4(0, 0, 0, i === 0 ? 0.52 : 0.3 + Math.random() * 0.18));

  const uniforms = {
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamRt: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uCamFw: { value: new THREE.Vector3() },
    uBalls: { value: balls },
    uEnv: { value: envData.bg },
    uMode: { value: 0 },
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
  scene.add(rig);
  scene.add(camera); // ラベルスプライトをオルソカメラに追従させるため

  const orbit = new OrbitDrag(rig, { theta: 0.3, phi: 1.35, radius: 4.6, autoRotate: 0.1, minRadius: 2.6, maxRadius: 8 });
  const label = new LabelSprite(camera, new THREE.Vector3(0, -0.68, -2.2));
  const raycaster = new THREE.Raycaster();
  const dragPlane = new THREE.Plane();
  const dragTarget = new THREE.Vector3(0, 0, 0);
  let dragging = false;
  let mode = 0;
  const MODES = ['液体金属（クローム）', '溶けた金', 'シャボン'];

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      uniforms.uTime.value = t;

      // ボール 1〜6 はリサージュ軌道
      for (let i = 1; i < 7; i++) {
        const s = i * 1.31;
        balls[i].x = Math.sin(t * (0.31 + i * 0.043) + s) * 1.15;
        balls[i].y = Math.sin(t * (0.43 + i * 0.037) + s * 2.1) * 0.85;
        balls[i].z = Math.cos(t * (0.37 + i * 0.041) + s * 1.3) * 1.15;
      }
      // ボール 0 はポインタ追従（または中央でうねる）
      const goal = dragging
        ? dragTarget
        : new THREE.Vector3(Math.sin(t * 0.5) * 0.4, Math.cos(t * 0.7) * 0.3, Math.sin(t * 0.6) * 0.4);
      balls[0].x += (goal.x - balls[0].x) * Math.min(1, dt * 7);
      balls[0].y += (goal.y - balls[0].y) * Math.min(1, dt * 7);
      balls[0].z += (goal.z - balls[0].z) * Math.min(1, dt * 7);

      rig.updateMatrixWorld();
      uniforms.uCamPos.value.copy(rig.position);
      rig.matrixWorld.extractBasis(uniforms.uCamRt.value, uniforms.uCamUp.value, uniforms.uCamFw.value);
      uniforms.uCamFw.value.multiplyScalar(-1); // カメラは -Z を向く
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      uniforms.uAspect.value = s.aspect;
      rig.aspect = s.aspect;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        orbit.zoom(p.dz ?? 0);
        return;
      }
      if (p.type === 'down' || (p.type === 'move' && p.down)) {
        const dir = new THREE.Vector3();
        rig.getWorldDirection(dir);
        dragPlane.setFromNormalAndCoplanarPoint(dir, new THREE.Vector3());
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), rig);
        const hit = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
        if (hit) {
          hit.clampLength(0, 1.7);
          dragTarget.copy(hit);
          dragging = true;
        }
      }
      if (p.type === 'up' || p.type === 'leave') dragging = false;
      if (p.type === 'tap') {
        mode = (mode + 1) % MODES.length;
        uniforms.uMode.value = mode;
        label.set(MODES[mode]);
      }
    },
  };
}
