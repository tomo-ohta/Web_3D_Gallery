import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';

/** CPU パーティクルプールによる打ち上げ花火。水面反射つき */

const MAX = 9000;

type BurstType = 'peony' | 'ring' | 'willow' | 'palm';
const TYPES: BurstType[] = ['peony', 'ring', 'willow', 'palm'];

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
uniform float uScale;
uniform float uMirror;
varying vec3 vColor;
varying float vLife;
void main() {
  vColor = aColor;
  vLife = aLife;
  vec3 p = position;
  if (uMirror > 0.5) p.y = -p.y - 0.15;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uScale * aSize * clamp(aLife, 0.0, 1.0) / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vLife;
uniform float uAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float m = exp(-r2 * 10.0);
  float a = clamp(vLife, 0.0, 1.0);
  gl_FragColor = vec4(vColor, 1.0) * (m * a * uAlpha);
}
`;

export async function createFireworks(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();

  // 夜空グラデーション
  const bgc = document.createElement('canvas');
  bgc.width = 2;
  bgc.height = 256;
  const bctx = bgc.getContext('2d')!;
  const g = bctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b1026');
  g.addColorStop(0.62, '#101a35');
  g.addColorStop(0.75, '#1a1b30');
  g.addColorStop(1, '#05070d');
  bctx.fillStyle = g;
  bctx.fillRect(0, 0, 2, 256);
  const bgTex = new THREE.CanvasTexture(bgc);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;

  const camera = new THREE.PerspectiveCamera(46, 16 / 10, 0.1, 80);
  camera.position.set(0, 1.7, 9.5);
  camera.lookAt(0, 2.6, 0);
  scene.add(camera);

  // 星
  const starArr = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.random() * 1.1 + 0.12;
    const r = 34;
    starArr[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starArr[i * 3 + 1] = Math.sin(e) * r * 0.6 + 2;
    starArr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r - 10;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8fa3c8, size: 0.05, sizeAttenuation: true })));

  // 街のシルエット
  const cityMat = new THREE.MeshBasicMaterial({ color: 0x05070c });
  for (let i = 0; i < 26; i++) {
    const w = 0.5 + Math.random() * 1.1;
    const h = 0.25 + Math.random() * 1.0;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), cityMat);
    b.position.set(-9 + i * 0.72 + Math.random() * 0.3, h / 2 + 0.02, -7 - Math.random() * 2);
    scene.add(b);
  }

  // 水面（暗い反射平面はミラー描画で表現）
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshBasicMaterial({ color: 0x040810, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  scene.add(water);

  // --- パーティクルプール ---
  const posArr = new Float32Array(MAX * 3);
  const velArr = new Float32Array(MAX * 3);
  const colArr = new Float32Array(MAX * 3);
  const sizeArr = new Float32Array(MAX);
  const lifeArr = new Float32Array(MAX);
  const decayArr = new Float32Array(MAX);
  const dragArr = new Float32Array(MAX);
  const gravArr = new Float32Array(MAX);
  const kindArr = new Uint8Array(MAX); // 0=spark 1=rocket 2=trail
  const burstT = new Uint8Array(MAX);
  let alive = 0;

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  const colAttr = new THREE.BufferAttribute(colArr, 3);
  const sizeAttr = new THREE.BufferAttribute(sizeArr, 1);
  const lifeAttr = new THREE.BufferAttribute(lifeArr, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  lifeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aColor', colAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setAttribute('aLife', lifeAttr);

  const mkMat = (mirror: number, alpha: number) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uMirror: { value: mirror }, uAlpha: { value: alpha } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  const mainMat = mkMat(0, 0.9);
  const mirrorMat = mkMat(1, 0.22);
  const points = new THREE.Points(geo, mainMat);
  points.frustumCulled = false;
  scene.add(points);
  const mirror = new THREE.Points(geo, mirrorMat);
  mirror.frustumCulled = false;
  scene.add(mirror);

  const spawn = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, gcol: number, b: number,
    size: number, decay: number, drag: number, grav: number,
    kind: number, bt = 0,
  ) => {
    if (alive >= MAX) return;
    const i = alive++;
    posArr[i * 3] = x; posArr[i * 3 + 1] = y; posArr[i * 3 + 2] = z;
    velArr[i * 3] = vx; velArr[i * 3 + 1] = vy; velArr[i * 3 + 2] = vz;
    colArr[i * 3] = r; colArr[i * 3 + 1] = gcol; colArr[i * 3 + 2] = b;
    sizeArr[i] = size;
    lifeArr[i] = 1;
    decayArr[i] = decay;
    dragArr[i] = drag;
    gravArr[i] = grav;
    kindArr[i] = kind;
    burstT[i] = bt;
  };

  const kill = (i: number) => {
    alive--;
    if (i === alive) return;
    posArr.copyWithin(i * 3, alive * 3, alive * 3 + 3);
    velArr.copyWithin(i * 3, alive * 3, alive * 3 + 3);
    colArr.copyWithin(i * 3, alive * 3, alive * 3 + 3);
    sizeArr[i] = sizeArr[alive];
    lifeArr[i] = lifeArr[alive];
    decayArr[i] = decayArr[alive];
    dragArr[i] = dragArr[alive];
    gravArr[i] = gravArr[alive];
    kindArr[i] = kindArr[alive];
    burstT[i] = burstT[alive];
  };

  const hsv = (h: number, s: number, v: number): [number, number, number] => {
    const c = new THREE.Color().setHSL(((h % 1) + 1) % 1, s, v);
    return [c.r, c.g, c.b];
  };

  const explode = (x: number, y: number, z: number, type: BurstType) => {
    const hue = Math.random();
    if (type === 'peony') {
      const n = 320;
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const c = Math.sqrt(1 - u * u);
        const sp = 2.6 + Math.random() * 1.9;
        const [r, gg, b] = hsv(hue + (Math.random() - 0.5) * 0.06, 0.85, 0.62);
        spawn(x, y, z, Math.cos(a) * c * sp, u * sp, Math.sin(a) * c * sp, r * 2.4, gg * 2.4, b * 2.4, 11, 0.45 + Math.random() * 0.2, 1.6, 1.6, 0);
      }
    } else if (type === 'ring') {
      const n = 220;
      const tilt = Math.random() * Math.PI;
      const axis = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt) * 0.4, Math.cos(tilt)).normalize();
      const v1 = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
      const v2 = axis.clone().cross(v1).normalize();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const sp = 3.6 + Math.random() * 0.3;
        const d = v1.clone().multiplyScalar(Math.cos(a)).addScaledVector(v2, Math.sin(a));
        const [r, gg, b] = hsv(hue, 0.9, 0.6);
        spawn(x, y, z, d.x * sp, d.y * sp, d.z * sp, r * 2.6, gg * 2.6, b * 2.6, 10, 0.55, 1.7, 1.4, 0);
      }
    } else if (type === 'willow') {
      const n = 260;
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const c = Math.sqrt(1 - u * u);
        const sp = 1.7 + Math.random() * 1.1;
        spawn(x, y, z, Math.cos(a) * c * sp, u * sp * 0.8, Math.sin(a) * c * sp, 2.6, 1.9, 1.0, 8, 0.3 + Math.random() * 0.12, 0.55, 1.15, 3);
      }
    } else {
      // palm: 太い腕 + 各腕がきらめく
      const arms = 7;
      for (let k = 0; k < arms; k++) {
        const a = (k / arms) * Math.PI * 2 + Math.random() * 0.3;
        const el = 0.5 + Math.random() * 0.4;
        const sp = 3.4;
        const dx = Math.cos(a) * Math.cos(el) * sp;
        const dy = Math.sin(el) * sp;
        const dz = Math.sin(a) * Math.cos(el) * sp;
        const [r, gg, b] = hsv(hue, 0.75, 0.66);
        for (let m = 0; m < 26; m++) {
          const f = 0.75 + m * 0.014;
          spawn(x, y, z, dx * f + (Math.random() - 0.5) * 0.3, dy * f, dz * f + (Math.random() - 0.5) * 0.3, r * 2.6, gg * 2.6, b * 2.6, 10, 0.55, 1.3, 1.5, 0);
        }
      }
    }
    // 閃光
    spawn(x, y, z, 0, 0, 0, 6, 5.6, 4.6, 130, 3.4, 1, 0, 0);
  };

  const launch = (targetX: number, targetY: number) => {
    const x = targetX + (Math.random() - 0.5) * 0.4;
    const apex = THREE.MathUtils.clamp(targetY, 2.2, 6.4);
    const vy = Math.sqrt(2 * 3.6 * apex) * 1.06;
    spawn(x, 0, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 0.4, vy, 0, 3.2, 2.6, 1.8, 16, 0.001, 0.15, 3.6, 1, TYPES.indexOf(TYPES[(Math.random() * TYPES.length) | 0]));
  };

  let autoTimer = 0.15;
  let dragTimer = 0;
  const raycaster = new THREE.Raycaster();
  const skyPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let camZ = 9.5;

  const pointerToSky = (x: number, y: number) => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = raycaster.ray.intersectPlane(skyPlane, new THREE.Vector3());
    return hit;
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      camera.position.x = Math.sin(t * 0.07) * 0.6;
      camera.position.z += (camZ - camera.position.z) * Math.min(1, dt * 6);
      camera.lookAt(0, 2.6, 0);

      autoTimer -= dt;
      if (autoTimer <= 0) {
        autoTimer = 1.0 + Math.random() * 1.1;
        launch((Math.random() - 0.5) * 6, 2.6 + Math.random() * 3.4);
      }
      dragTimer = Math.max(0, dragTimer - dt);

      const sdt = Math.min(dt, 1 / 30);
      for (let i = alive - 1; i >= 0; i--) {
        const i3 = i * 3;
        velArr[i3 + 1] -= gravArr[i] * sdt;
        const drag = Math.max(0, 1 - dragArr[i] * sdt);
        velArr[i3] *= drag;
        velArr[i3 + 1] *= drag;
        velArr[i3 + 2] *= drag;
        posArr[i3] += velArr[i3] * sdt;
        posArr[i3 + 1] += velArr[i3 + 1] * sdt;
        posArr[i3 + 2] += velArr[i3 + 2] * sdt;

        if (kindArr[i] === 1) {
          // ロケット: 尾を引き、頂点で爆発
          if (Math.random() < 0.7) {
            spawn(posArr[i3], posArr[i3 + 1], posArr[i3 + 2], (Math.random() - 0.5) * 0.25, -0.4, (Math.random() - 0.5) * 0.25, 2.2, 1.6, 0.9, 5, 2.6, 2.0, 0.6, 2);
          }
          if (velArr[i3 + 1] < 0.4) {
            const type = TYPES[burstT[i] % TYPES.length];
            explode(posArr[i3], posArr[i3 + 1], posArr[i3 + 2], type);
            kill(i);
            continue;
          }
        } else if (kindArr[i] === 3 && Math.random() < 0.10) {
          // 柳: 金の尾
          spawn(posArr[i3], posArr[i3 + 1], posArr[i3 + 2], 0, -0.15, 0, 2.4, 1.7, 0.8, 4.5, 1.5, 1.2, 0.5, 2);
        }

        lifeArr[i] -= decayArr[i] * sdt;
        if (lifeArr[i] <= 0 || posArr[i3 + 1] < -0.1) kill(i);
      }

      geo.setDrawRange(0, alive);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      lifeAttr.needsUpdate = true;
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
      mainMat.uniforms.uScale.value = s.h * 0.017;
      mirrorMat.uniforms.uScale.value = s.h * 0.017;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        camZ = THREE.MathUtils.clamp(camZ * Math.exp(p.dz ?? 0), 5.5, 16);
        return;
      }
      if (p.type === 'tap') {
        const hit = pointerToSky(p.x, p.y);
        if (hit) launch(hit.x, hit.y);
      }
      if (p.type === 'move' && p.down && dragTimer <= 0) {
        dragTimer = 0.16;
        const hit = pointerToSky(p.x, p.y);
        if (hit) launch(hit.x, hit.y);
      }
    },
    dispose() {
      purgeScene(scene);
      geo.dispose();
    },
  };
}
