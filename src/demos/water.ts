import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, Quality, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { PingPong, pass } from '../core/gpgpu';

/** 高さ場の波動方程式 + 屈折・コースティクス・空反射のプール表現 */

const SIM_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
void main() {
  vec2 hv = texture2D(uPrev, vUv).xy;
  float L = texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).x;
  float lap = (L + R + B + T) - 4.0 * hv.x;
  float vel = hv.y + lap * 0.30;
  vel *= 0.9965;
  float h = hv.x + vel;
  h *= 0.9992;
  // 端で減衰させて反射を弱める
  float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x)
             * smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
  h *= mix(0.96, 1.0, edge);
  gl_FragColor = vec4(h, vel, 0.0, 1.0);
}
`;

const DROP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uPoint;
uniform float uStrength;
uniform float uRadius;
void main() {
  vec4 c = texture2D(uTex, vUv);
  vec2 d = vUv - uPoint;
  c.y += uStrength * exp(-dot(d, d) / uRadius);
  gl_FragColor = c;
}
`;

const TILE_GLSL = /* glsl */ `
vec3 tileColor(vec2 xz) {
  vec2 g = xz / 0.62;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float check = mod(id.x + id.y, 2.0);
  vec3 a = vec3(0.045, 0.22, 0.27);
  vec3 b = vec3(0.03, 0.16, 0.21);
  vec3 col = mix(a, b, check);
  float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
  col *= 0.88 + h * 0.24;
  float grout = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x)
              * smoothstep(0.0, 0.05, f.y) * smoothstep(1.0, 0.95, f.y);
  col *= mix(0.45, 1.0, grout);
  return col;
}
`;

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform sampler2D uHeight;
uniform float uAmp;
void main() {
  vUv = uv;
  vec3 p = position;
  float h = texture2D(uHeight, uv).x;
  p.z += h * uAmp; // 平面ローカル z = ワールド y（回転前）
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const WATER_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uAmp;
uniform float uSize;
${TILE_GLSL}

vec3 skyColor(vec3 d) {
  float t = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(vec3(0.55, 0.75, 0.9), vec3(0.12, 0.38, 0.72), pow(t, 0.65));
  vec3 sun = normalize(vec3(-0.45, 0.52, -0.55));
  sky += vec3(1.0, 0.85, 0.6) * pow(max(dot(d, sun), 0.0), 24.0) * 0.55;
  return sky;
}

void main() {
  float L = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture2D(uHeight, vUv).x;

  float texelWorld = uSize * uTexel.x;
  float dhdx = (R - L) * uAmp / (2.0 * texelWorld);
  float dhdv = (T - B) * uAmp / (2.0 * texelWorld);
  vec3 N = normalize(vec3(-dhdx, 1.0, dhdv));

  vec3 V = normalize(cameraPosition - vWorld);

  // --- 屈折（プール床） ---
  float depth = 1.05;
  vec2 refrOffset = -N.xz * depth * 1.15;
  vec2 floorPos = vWorld.xz + refrOffset;
  vec3 fcol = tileColor(floorPos);
  // コースティクス（ラプラシアンによる集光近似）
  float lap = (L + R + B + T) - 4.0 * C;
  float caus = clamp(1.0 - lap * 260.0, 0.0, 2.6);
  fcol *= 0.55 + 0.65 * pow(caus, 1.6);
  // 深さによる吸収
  fcol = mix(fcol, vec3(0.012, 0.1, 0.14), 0.52);

  // --- 反射（空） ---
  vec3 Rv = reflect(-V, N);
  Rv.y = abs(Rv.y);
  vec3 rcol = skyColor(Rv);

  float F = 0.025 + 0.975 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(fcol, rcol, F);

  // 太陽スペキュラ
  vec3 sun = normalize(vec3(-0.45, 0.52, -0.55));
  col += vec3(1.0, 0.9, 0.7) * pow(max(dot(Rv, sun), 0.0), 320.0) * 2.6;

  // 波頭の煌めき
  col += vec3(0.4, 0.7, 0.8) * clamp(C * 6.0, 0.0, 1.0) * 0.12;

  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

const DECK_GLSL = /* glsl */ `
varying vec3 vWorld;
void main() {
  float s = fract(sin(dot(floor(vWorld.xz * 3.0), vec2(12.98, 78.23))) * 43758.5)
          * 0.08;
  vec3 col = vec3(0.62, 0.58, 0.52) + s;
  float lines = smoothstep(0.0, 0.04, abs(fract(vWorld.x * 1.2) - 0.5) - 0.44);
  col *= mix(0.75, 1.0, lines);
  col = pow(col * 0.9, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createWater(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();

  // 空グラデーション背景
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 2;
  bgCanvas.height = 256;
  const bctx = bgCanvas.getContext('2d')!;
  const bg = bctx.createLinearGradient(0, 0, 0, 256);
  bg.addColorStop(0, '#3f7ec2');
  bg.addColorStop(0.6, '#8fc3e8');
  bg.addColorStop(1, '#cfe9f5');
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, 2, 256);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;

  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 100);
  scene.add(camera);

  const POOL = 5.4;
  let simRes = 224;
  let sim = new PingPong(simRes, simRes);
  const texel = new THREE.Vector2(1 / simRes, 1 / simRes);

  const zero = pass(`void main(){ gl_FragColor = vec4(0.0); }`, {});
  zero.render(ctx.renderer, sim.read);
  zero.render(ctx.renderer, sim.write);
  ctx.renderer.setRenderTarget(null);

  const simPass = pass(SIM_FRAG, { uPrev: { value: null }, uTexel: { value: texel } });
  const dropPass = pass(DROP_FRAG, {
    uTex: { value: null },
    uPoint: { value: new THREE.Vector2() },
    uStrength: { value: 0 },
    uRadius: { value: 0.00012 },
  });

  const waterUniforms = {
    uHeight: { value: sim.read.texture },
    uTexel: { value: texel },
    uAmp: { value: 0.16 },
    uSize: { value: POOL },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(POOL, POOL, 180, 180),
    new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: waterUniforms }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // プールの縁（デッキ）
  const deckMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vWorld; void main(){ vWorld = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: DECK_GLSL,
  });
  const deckOuter = 9.0;
  // 中央にプールの穴を開けたデッキ形状
  const deckShape = new THREE.Shape();
  deckShape.moveTo(-deckOuter, -deckOuter);
  deckShape.lineTo(deckOuter, -deckOuter);
  deckShape.lineTo(deckOuter, deckOuter);
  deckShape.lineTo(-deckOuter, deckOuter);
  deckShape.closePath();
  const hole = new THREE.Path();
  const hp = POOL / 2 + 0.02;
  hole.moveTo(-hp, -hp);
  hole.lineTo(hp, -hp);
  hole.lineTo(hp, hp);
  hole.lineTo(-hp, hp);
  hole.closePath();
  deckShape.holes.push(hole);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(deckShape, 4), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.09;
  scene.add(deck);

  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const drops: { u: number; v: number; s: number; r: number }[] = [];
  let idleTimer = 10;
  let rainTimer = 0;
  let camAngle = 0;
  let zoomK = 1;

  const pointerToUv = (x: number, y: number): { u: number; v: number } | null => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3());
    if (!hit) return null;
    const u = hit.x / POOL + 0.5;
    const v = 1 - (hit.z / POOL + 0.5);
    if (u < 0.02 || u > 0.98 || v < 0.02 || v > 0.98) return null;
    return { u, v };
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      idleTimer += dt;
      camAngle += dt * 0.05;
      const r = 6.4 * zoomK;
      camera.position.set(
        Math.sin(camAngle) * r * 0.35,
        (4.4 + Math.sin(t * 0.23) * 0.15) * zoomK,
        Math.cos(camAngle * 0.7) * 0.8 + r * 0.72,
      );
      camera.lookAt(0, -0.4, 0);

      // 待機時の雨
      if (idleTimer > 3.0) {
        rainTimer -= dt;
        if (rainTimer <= 0) {
          rainTimer = 0.55;
          drops.push({ u: 0.1 + Math.random() * 0.8, v: 0.1 + Math.random() * 0.8, s: 0.5 + Math.random() * 0.5, r: 0.00008 });
        }
      }

      // ドロップ適用
      for (let i = 0; i < Math.min(drops.length, 6); i++) {
        const d = drops.shift()!;
        dropPass.material.uniforms.uTex.value = sim.read.texture;
        dropPass.material.uniforms.uPoint.value.set(d.u, d.v);
        dropPass.material.uniforms.uStrength.value = -d.s * 0.9;
        dropPass.material.uniforms.uRadius.value = d.r;
        dropPass.render(ctx.renderer, sim.write);
        sim.swap();
      }

      // 波動シミュレーション（フレームレート非依存になるよう 2 回）
      for (let i = 0; i < 2; i++) {
        simPass.material.uniforms.uPrev.value = sim.read.texture;
        simPass.render(ctx.renderer, sim.write);
        sim.swap();
      }

      waterUniforms.uHeight.value = sim.read.texture;
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
        zoomK = THREE.MathUtils.clamp(zoomK * Math.exp(p.dz ?? 0), 0.55, 1.8);
        return;
      }
      const speed = Math.abs(p.dx) + Math.abs(p.dy);
      if (p.type === 'move') {
        const uv = pointerToUv(p.x, p.y);
        if (uv && (p.down || speed > 0.002)) {
          idleTimer = 0;
          drops.push({ u: uv.u, v: uv.v, s: p.down ? 0.9 : 0.35, r: p.down ? 0.00012 : 0.00006 });
        }
      }
      if (p.type === 'tap') {
        const uv = pointerToUv(p.x, p.y);
        if (uv) {
          idleTimer = 0;
          drops.push({ u: uv.u, v: uv.v, s: 3.2, r: 0.0004 });
        }
      }
    },
    dispose() {
      purgeScene(scene);
      sim.dispose();
    },
  };
}
