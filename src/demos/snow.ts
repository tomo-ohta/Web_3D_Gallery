import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';

/** 降雪と積雪。CPU 高さ場に雪が積もり、なぞると跡がつく */

const GRID = 192;
const AREA = 7.0; // ワールドの一辺
const MAX_H = 0.5;

const SNOW_VERT = /* glsl */ `
uniform sampler2D uHeight;
uniform float uMaxH;
varying vec3 vWorld;
varying float vH;
varying vec2 vUv;
void main() {
  vUv = uv;
  float h = texture2D(uHeight, uv).r * uMaxH;
  vec3 p = position;
  p.z += h;
  vH = h;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SNOW_FRAG = /* glsl */ `
uniform sampler2D uHeight;
uniform float uMaxH;
uniform vec2 uTexel;
uniform float uArea;
uniform float uTime;
varying vec3 vWorld;
varying float vH;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float L = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r * uMaxH;
  float R = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r * uMaxH;
  float B = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r * uMaxH;
  float T = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r * uMaxH;
  float texelWorld = uArea * uTexel.x;
  vec3 N = normalize(vec3(-(R - L) / (2.0 * texelWorld), 1.0, (T - B) / (2.0 * texelWorld)));

  vec3 moon = normalize(vec3(-0.4, 0.75, 0.35));
  float diff = max(dot(N, moon), 0.0);

  // 雪の色: 影は青く、light は暖かい街灯 + 月
  vec3 shadowCol = vec3(0.28, 0.36, 0.55);
  vec3 litCol = vec3(0.92, 0.95, 1.0);
  vec3 col = mix(shadowCol, litCol, diff * 0.85 + 0.1);

  // 街灯の暖色（位置固定のポイントライト風）
  vec3 lampPos = vec3(1.6, 1.9, -0.8);
  vec3 toLamp = lampPos - vWorld;
  float lampD = length(toLamp);
  float lampI = 4.2 / (lampD * lampD + 1.0);
  col += vec3(1.0, 0.72, 0.4) * lampI * max(dot(N, normalize(toLamp)), 0.0) * 0.5;

  // 地面が薄い所は土が透ける
  float cover = smoothstep(0.008, 0.06, vH);
  col = mix(vec3(0.10, 0.09, 0.10), col, cover);

  // キラキラ（視線が動くと瞬く風）
  float sparkle = pow(hash12(floor(vWorld.xz * 42.0)), 60.0) * diff * 3.0;
  col += vec3(sparkle);

  // 距離フォグ
  float dist = length(vWorld.xz);
  col = mix(col, vec3(0.05, 0.07, 0.12), smoothstep(3.2, 5.4, dist));

  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createSnow(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 7, 14);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 40);
  scene.add(camera);

  // --- 高さ場 ---
  const heights = new Float32Array(GRID * GRID);
  const bytes = new Uint8Array(GRID * GRID);
  const heightTex = new THREE.DataTexture(bytes, GRID, GRID, THREE.RedFormat, THREE.UnsignedByteType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;
  let texDirty = true;

  const splat = (u: number, v: number, radius: number, amount: number) => {
    const cx = u * GRID;
    const cy = v * GRID;
    const r = radius * GRID;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(GRID - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(GRID - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const w = Math.exp((-(dx * dx + dy * dy)) / (r * r * 0.45));
        const i = y * GRID + x;
        let h = heights[i];
        if (amount > 0) h += amount * w * (1 - h); // 上限で飽和
        else h = Math.max(0, h + amount * w);
        heights[i] = h;
      }
    }
    texDirty = true;
  };

  const uploadHeights = () => {
    for (let i = 0; i < heights.length; i++) bytes[i] = Math.min(255, heights[i] * 255) | 0;
    heightTex.needsUpdate = true;
  };

  // 初期の積雪
  for (let i = 0; i < heights.length; i++) heights[i] = 0.16 + Math.random() * 0.015;
  for (let k = 0; k < 24; k++) splat(Math.random(), Math.random(), 0.06 + Math.random() * 0.1, 0.15);
  uploadHeights();

  const groundUniforms = {
    uHeight: { value: heightTex },
    uMaxH: { value: MAX_H },
    uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
    uArea: { value: AREA },
    uTime: { value: 0 },
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(AREA, AREA, 150, 150),
    new THREE.ShaderMaterial({ vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, uniforms: groundUniforms }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // --- 木と街灯 ---
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x1d3a2c, roughness: 0.9 });
  const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xe8eefc, roughness: 0.8, emissive: 0x25304a, emissiveIntensity: 0.55 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2b1e, roughness: 0.95 });
  const makeTree = (x: number, z: number, s: number) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.4 * s, 8), trunkMat);
    trunk.position.y = 0.2 * s;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const r = (0.5 - i * 0.12) * s;
      const h = 0.55 * s;
      const y = (0.45 + i * 0.34) * s;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), treeMat);
      cone.position.y = y;
      g.add(cone);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, h * 0.4, 10), snowCapMat);
      cap.position.y = y + h * 0.28;
      g.add(cap);
    }
    g.position.set(x, 0.1, z);
    scene.add(g);
  };
  makeTree(-1.9, -1.4, 1.5);
  makeTree(-2.6, 0.6, 1.0);
  makeTree(2.3, 1.6, 1.2);

  // 街灯
  const lamp = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 1.9, 10),
    new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.5, metalness: 0.7 }),
  );
  pole.position.y = 0.95;
  lamp.add(pole);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffc880 }),
  );
  bulb.position.y = 1.92;
  lamp.add(bulb);
  const lampLight = new THREE.PointLight(0xffb765, 7, 8, 1.8);
  lampLight.position.y = 1.9;
  lamp.add(lampLight);
  // グロー
  const glowC = document.createElement('canvas');
  glowC.width = glowC.height = 64;
  const gctx = glowC.getContext('2d')!;
  const gg = gctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gg.addColorStop(0, 'rgba(255,205,140,0.8)');
  gg.addColorStop(1, 'rgba(255,205,140,0)');
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowC);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  glow.scale.setScalar(1.1);
  glow.position.y = 1.92;
  lamp.add(glow);
  lamp.position.set(1.6, 0, -0.8);
  scene.add(lamp);
  scene.add(new THREE.AmbientLight(0x4a5c8a, 0.85));
  const moon = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  moon.position.set(-3, 6, 3);
  scene.add(moon);

  // --- 降雪フレーク ---
  const FLAKES = 2400;
  const fPos = new Float32Array(FLAKES * 3);
  const fSeed = new Float32Array(FLAKES);
  for (let i = 0; i < FLAKES; i++) {
    fPos[i * 3] = (Math.random() - 0.5) * AREA;
    fPos[i * 3 + 1] = Math.random() * 4.5;
    fPos[i * 3 + 2] = (Math.random() - 0.5) * AREA;
    fSeed[i] = Math.random();
  }
  const flakeGeo = new THREE.BufferGeometry();
  const fAttr = new THREE.BufferAttribute(fPos, 3);
  fAttr.setUsage(THREE.DynamicDrawUsage);
  flakeGeo.setAttribute('position', fAttr);
  const flakeCanvas = document.createElement('canvas');
  flakeCanvas.width = flakeCanvas.height = 32;
  const fctx = flakeCanvas.getContext('2d')!;
  const fg = fctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  fg.addColorStop(0, 'rgba(255,255,255,1)');
  fg.addColorStop(0.5, 'rgba(240,246,255,0.55)');
  fg.addColorStop(1, 'rgba(240,246,255,0)');
  fctx.fillStyle = fg;
  fctx.fillRect(0, 0, 32, 32);
  const flakeTex = new THREE.CanvasTexture(flakeCanvas);
  const flakes = new THREE.Points(
    flakeGeo,
    new THREE.PointsMaterial({
      map: flakeTex,
      color: 0xe8f0ff,
      size: 0.03,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  scene.add(flakes);

  const orbit = new OrbitDrag(camera, { theta: 0.35, phi: 1.18, radius: 6.0, autoRotate: 0.05, targetY: 0.5, minRadius: 3, maxRadius: 11 });
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const wind = new THREE.Vector2(0.25, 0.1);
  let acc = 0;

  const worldToUv = (x: number, z: number) => ({ u: x / AREA + 0.5, v: 0.5 - z / AREA });

  const heightAt = (x: number, z: number) => {
    const { u, v } = worldToUv(x, z);
    const gx = Math.min(GRID - 1, Math.max(0, Math.round(u * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.round(v * GRID)));
    return heights[gy * GRID + gx] * MAX_H;
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      groundUniforms.uTime.value = t;
      wind.x = Math.sin(t * 0.13) * 0.4;
      wind.y = Math.cos(t * 0.09) * 0.3;

      const sdt = Math.min(dt, 1 / 30);
      for (let i = 0; i < FLAKES; i++) {
        const i3 = i * 3;
        fPos[i3] += (wind.x + Math.sin(t * 1.4 + fSeed[i] * 50) * 0.22) * sdt;
        fPos[i3 + 2] += (wind.y + Math.cos(t * 1.1 + fSeed[i] * 70) * 0.22) * sdt;
        fPos[i3 + 1] -= (0.5 + fSeed[i] * 0.5) * sdt;
        // 着雪
        if (fPos[i3 + 1] < heightAt(fPos[i3], fPos[i3 + 2]) + 0.02) {
          if (Math.abs(fPos[i3]) < AREA / 2 && Math.abs(fPos[i3 + 2]) < AREA / 2) {
            const { u, v } = worldToUv(fPos[i3], fPos[i3 + 2]);
            splat(u, v, 0.012, 0.05);
          }
          fPos[i3] = (Math.random() - 0.5) * AREA;
          fPos[i3 + 1] = 4.0 + Math.random() * 1.0;
          fPos[i3 + 2] = (Math.random() - 0.5) * AREA;
        }
        // 範囲ラップ
        if (fPos[i3] > AREA / 2) fPos[i3] -= AREA;
        if (fPos[i3] < -AREA / 2) fPos[i3] += AREA;
        if (fPos[i3 + 2] > AREA / 2) fPos[i3 + 2] -= AREA;
        if (fPos[i3 + 2] < -AREA / 2) fPos[i3 + 2] += AREA;
      }
      fAttr.needsUpdate = true;

      acc += dt;
      if (texDirty && acc > 1 / 30) {
        uploadHeights();
        texDirty = false;
        acc = 0;
      }
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
        orbit.zoom(p.dz ?? 0);
        return;
      }
      if (p.type === 'move' && p.down) {
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
        if (hit && Math.abs(hit.x) < AREA / 2 && Math.abs(hit.z) < AREA / 2) {
          const { u, v } = worldToUv(hit.x, hit.z);
          splat(u, v, 0.028, -0.16); // なぞった跡（除雪）
        } else {
          orbit.pointer(p);
        }
      } else if (p.type !== 'move') {
        orbit.pointer(p);
      }
      if (p.type === 'tap') {
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
        if (hit) {
          const { u, v } = worldToUv(hit.x, hit.z);
          splat(u, v, 0.06, 0.55); // どか雪
        }
      }
    },
    dispose() {
      heightTex.dispose();
      flakeGeo.dispose();
    },
  };
}
