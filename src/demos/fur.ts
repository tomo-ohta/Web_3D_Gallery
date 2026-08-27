import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';

const VERT = /* glsl */ `
uniform float uShells;
uniform float uFurLen;
uniform float uTime;
uniform vec3 uComb;
uniform vec3 uCombPos; // 撫でている位置（オブジェクト空間）
uniform float uSquash;

out vec3 vNormalW;
out vec3 vObjDir;
out float vShell;
out vec3 vViewDirW;

void main() {
  float shell = float(gl_InstanceID) / max(uShells - 1.0, 1.0);
  vShell = shell;
  vec3 n = normalize(normal);
  vec3 pos = position;
  // squash & stretch（タップ時のぷるぷる）
  float sq = uSquash;
  pos *= vec3(1.0 + sq * 0.55, 1.0 - sq, 1.0 + sq * 0.55);
  pos += n * shell * uFurLen;
  float k = pow(shell, 1.6);
  vec3 sway = vec3(
    sin(uTime * 1.7 + position.y * 2.4),
    0.0,
    cos(uTime * 1.4 + position.x * 2.2)
  ) * 0.028;
  vec3 grav = vec3(0.0, -0.07, 0.0);
  // 撫では触れている場所の周辺だけに効かせる
  vec3 dc = position - uCombPos;
  float combW = exp(-dot(dc, dc) * 4.8);
  pos += (uComb * combW + grav + sway) * k;

  vObjDir = normalize(position);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * n);
  vViewDirW = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorRoot;
uniform vec3 uColorTip;
uniform float uDensity;

in vec3 vNormalW;
in vec3 vObjDir;
in float vShell;
in vec3 vViewDirW;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // キューブ投影 UV（極の歪みを避ける）
  vec3 a = abs(vObjDir);
  vec2 uvf;
  if (a.x >= a.y && a.x >= a.z)      uvf = vObjDir.zy / a.x;
  else if (a.y >= a.z)               uvf = vObjDir.xz / a.y;
  else                               uvf = vObjDir.xy / a.z;

  vec2 cell = uvf * uDensity;
  vec2 id = floor(cell);
  vec2 f = fract(cell) - 0.5;

  if (vShell > 0.0001) {
    float lenRnd = mix(0.5, 1.0, hash21(id + 17.0));
    float h = vShell / lenRnd;
    if (h >= 1.0) discard;
    vec2 jitter = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.4;
    float d = length(f - jitter);
    float taper = 0.52 * (1.0 - h * h * 0.8);
    if (d > taper) discard;
  }

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewDirW);
  vec3 L = normalize(vec3(0.55, 0.75, 0.42));
  float diff = dot(N, L) * 0.5 + 0.5;
  diff = diff * diff;
  float ao = mix(0.16, 1.0, vShell);
  float strandRnd = mix(0.82, 1.1, hash21(id + 29.0));
  vec3 col = mix(uColorRoot, uColorTip, pow(vShell, 1.3)) * diff * ao * strandRnd;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  col += rim * vec3(1.0, 0.72, 0.45) * 0.7 * (0.25 + vShell);
  // 弱い床照り返し
  col += max(-N.y, 0.0) * vec3(0.10, 0.06, 0.05) * ao;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** シェルテクスチャリングによるリアルタイムファー。撫でると毛並みが流れる */
export async function createFur(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100f14);
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 40);
  scene.add(camera);

  const SHELLS_PREVIEW = 36;
  const SHELLS_FULL = 64;
  let shells = SHELLS_PREVIEW;

  const uniforms = {
    uShells: { value: shells },
    uFurLen: { value: 0.26 },
    uTime: { value: 0 },
    uComb: { value: new THREE.Vector3() },
    uCombPos: { value: new THREE.Vector3(0, 99, 0) },
    uSquash: { value: 0 },
    uColorRoot: { value: new THREE.Color(0x59290f) },
    uColorTip: { value: new THREE.Color(0xffc180) },
    uDensity: { value: 56 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
  });

  const geo = new THREE.SphereGeometry(1.06, 128, 96);
  const fur = new THREE.InstancedMesh(geo, mat, SHELLS_FULL);
  fur.count = shells;
  fur.frustumCulled = false;
  scene.add(fur);

  // 接地感を出す疑似シャドウ
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d')!;
  const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = -1.62;
  scene.add(blob);

  const orbit = new OrbitDrag(camera, { theta: 0.3, phi: 1.35, radius: 4.5, autoRotate: 0.09, minRadius: 2.2, maxRadius: 9 });

  const combPos = new THREE.Vector3();
  const combVel = new THREE.Vector3();
  const combTarget = new THREE.Vector3(0, 99, 0);
  let squash = 0;
  let squashVel = 0;
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const furSphere = new THREE.Sphere(new THREE.Vector3(), 1.32);
  const hitPoint = new THREE.Vector3();
  let dragMode: 'none' | 'comb' | 'orbit' = 'none';

  const pickFur = (x: number, y: number): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    furSphere.center.copy(fur.position);
    return raycaster.ray.intersectSphere(furSphere, hitPoint);
  };

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      uniforms.uTime.value = t;

      // 毛並みスプリング
      combVel.addScaledVector(combPos, -14 * dt);
      combVel.multiplyScalar(Math.max(0, 1 - 4.2 * dt));
      combPos.addScaledVector(combVel, dt);
      if (combPos.length() > 0.65) combPos.setLength(0.65);
      uniforms.uComb.value.copy(combPos);
      uniforms.uCombPos.value.lerp(combTarget, Math.min(1, dt * 14));

      // ぷるぷるスプリング
      squashVel += -squash * 60 * dt;
      squashVel *= Math.max(0, 1 - 5.5 * dt);
      squash += squashVel * dt;
      uniforms.uSquash.value = squash * 0.16;

      fur.position.y = Math.sin(t * 1.1) * 0.03;
      blob.scale.setScalar(1 + Math.sin(t * 1.1) * 0.02);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(s: ViewSize) {
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
    },
    setQuality(q) {
      shells = q === 'full' ? SHELLS_FULL : SHELLS_PREVIEW;
      uniforms.uShells.value = shells;
      fur.count = shells;
    },
    pointer(p: PointerInfo) {
      if (p.type === 'zoom') {
        orbit.zoom(p.dz ?? 0);
        return;
      }
      if (p.type === 'down') {
        const hit = pickFur(p.x, p.y);
        dragMode = hit ? 'comb' : 'orbit';
        if (hit) combTarget.copy(hit).sub(fur.position);
        else orbit.pointer(p);
      } else if (p.type === 'move') {
        if (p.down && dragMode === 'comb') {
          const hit = pickFur(p.x, p.y);
          if (hit) combTarget.copy(hit).sub(fur.position);
          camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());
          combVel.addScaledVector(camRight, p.dx * 40);
          combVel.addScaledVector(camUp, p.dy * 40);
        } else {
          orbit.pointer(p);
        }
      } else if (p.type === 'up' || p.type === 'leave') {
        dragMode = 'none';
        orbit.pointer(p);
      }
      if (p.type === 'tap') {
        squashVel += 7;
        const hit = pickFur(p.x, p.y);
        if (hit) combTarget.copy(hit).sub(fur.position);
        combVel.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
      }
    },
  };
}
