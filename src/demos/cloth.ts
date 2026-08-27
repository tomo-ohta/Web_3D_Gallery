import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';

/** Verlet 積分 + 距離コンストレイントによる布（旗）シミュレーション */

const W = 42; // 横の質点数
const H = 27;
const SPACING = 0.085;

interface Constraint {
  a: number;
  b: number;
  rest: number;
}

export async function createCloth(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11141a);
  scene.fog = new THREE.Fog(0x11141a, 8, 16);
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 40);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.position.set(3.2, 4.5, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.002;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x33404f, 0.7));

  // --- 旗のテクスチャ ---
  const fc = document.createElement('canvas');
  fc.width = 512;
  fc.height = 328;
  const fctx = fc.getContext('2d')!;
  const fgrad = fctx.createLinearGradient(0, 0, 512, 328);
  fgrad.addColorStop(0, '#1d2f5e');
  fgrad.addColorStop(1, '#101b3a');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 512, 328);
  fctx.strokeStyle = '#d9b36a';
  fctx.lineWidth = 10;
  fctx.strokeRect(14, 14, 484, 300);
  fctx.beginPath();
  fctx.arc(256, 164, 74, 0, Math.PI * 2);
  fctx.strokeStyle = '#e6c07a';
  fctx.lineWidth = 7;
  fctx.stroke();
  fctx.beginPath();
  fctx.moveTo(256, 96);
  fctx.lineTo(322, 164);
  fctx.lineTo(256, 232);
  fctx.lineTo(190, 164);
  fctx.closePath();
  fctx.fillStyle = '#e6c07a';
  fctx.fill();
  const flagTex = new THREE.CanvasTexture(fc);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  flagTex.anisotropy = 4;

  // --- 質点と拘束 ---
  const count = W * H;
  const pos = new Float32Array(count * 3);
  const prev = new Float32Array(count * 3);
  const pinned = new Uint8Array(count);
  const idx = (x: number, y: number) => y * W + x;

  const poleX = -((W - 1) * SPACING) / 2;
  const topY = 1.35;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      pos[i * 3] = poleX + x * SPACING;
      pos[i * 3 + 1] = topY - y * SPACING;
      pos[i * 3 + 2] = Math.sin(x * 0.3) * 0.01;
      prev[i * 3] = pos[i * 3];
      prev[i * 3 + 1] = pos[i * 3 + 1];
      prev[i * 3 + 2] = pos[i * 3 + 2];
      if (x === 0) pinned[i] = 1;
    }
  }

  const constraints: Constraint[] = [];
  const addC = (a: number, b: number, mul = 1) =>
    constraints.push({ a, b, rest: SPACING * mul });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < W - 1) addC(idx(x, y), idx(x + 1, y));
      if (y < H - 1) addC(idx(x, y), idx(x, y + 1));
      if (x < W - 1 && y < H - 1) {
        addC(idx(x, y), idx(x + 1, y + 1), Math.SQRT2);
        addC(idx(x + 1, y), idx(x, y + 1), Math.SQRT2);
      }
      if (x < W - 2) addC(idx(x, y), idx(x + 2, y), 2);
      if (y < H - 2) addC(idx(x, y), idx(x, y + 2), 2);
    }
  }

  // --- メッシュ ---
  const geo = new THREE.PlaneGeometry((W - 1) * SPACING, (H - 1) * SPACING, W - 1, H - 1);
  const mat = new THREE.MeshStandardMaterial({
    map: flagTex,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
  });
  const flag = new THREE.Mesh(geo, mat);
  flag.castShadow = true;
  flag.receiveShadow = true;
  scene.add(flag);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;

  // ポール
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 3.6, 20),
    new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.9, roughness: 0.3 }),
  );
  pole.position.set(poleX - 0.02, topY - 1.2, 0);
  pole.castShadow = true;
  scene.add(pole);
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xe6c07a, metalness: 1, roughness: 0.25 }),
  );
  finial.position.set(poleX - 0.02, topY + 0.62, 0);
  scene.add(finial);

  // 地面（影受け）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = topY - 3.0;
  ground.receiveShadow = true;
  scene.add(ground);

  const orbit = new OrbitDrag(camera, { theta: 0.65, phi: 1.35, radius: 4.6, autoRotate: 0.05, targetY: 0.25 });

  const windUser = new THREE.Vector3();
  let gust = 0;
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  const tmpN = new THREE.Vector3();
  const wind = new THREE.Vector3();
  let acc = 0;

  // つかみ操作
  const raycaster = new THREE.Raycaster();
  const projV = new THREE.Vector3();
  const grabTarget = new THREE.Vector3();
  let grabIdx = -1;
  let grabDist = 0;

  const pickParticle = (x: number, y: number): number => {
    let best = -1;
    let bestD = 0.16; // NDC 距離のしきい値
    for (let i = 0; i < count; i++) {
      projV.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera);
      if (projV.z > 1) continue;
      const d = Math.hypot(projV.x - x, projV.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const step = (t: number) => {
    const dt = 1 / 60;
    const damp = 0.985;
    // 風：基本流 + ゆらぎ + ユーザー風 + 突風
    const gustWave = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.1 + 1.7) * 0.3;
    wind.set(
      2.4 + gustWave * 1.4 + gust * 5.5,
      0.35 + Math.sin(t * 1.3) * 0.25,
      Math.sin(t * 0.6) * 1.4 + gust * 2.0,
    ).add(windUser);

    for (let i = 0; i < count; i++) {
      if (pinned[i]) continue;
      const ix = i * 3;
      // 法線方向の風の受け（旗らしいはためき）
      tmpN.set(normals.getX(i), normals.getY(i), normals.getZ(i));
      const facing = tmpN.dot(wind);
      const fx = wind.x * 0.35 + tmpN.x * facing * 0.75 + Math.sin(t * 3.1 + i * 0.13) * 0.12;
      const fy = -3.6 + wind.y * 0.3 + tmpN.y * facing * 0.75;
      const fz = wind.z * 0.35 + tmpN.z * facing * 0.75 + Math.cos(t * 2.7 + i * 0.19) * 0.12;

      const px = pos[ix], py = pos[ix + 1], pz = pos[ix + 2];
      pos[ix] = px + (px - prev[ix]) * damp + fx * dt * dt;
      pos[ix + 1] = py + (py - prev[ix + 1]) * damp + fy * dt * dt;
      pos[ix + 2] = pz + (pz - prev[ix + 2]) * damp + fz * dt * dt;
      prev[ix] = px;
      prev[ix + 1] = py;
      prev[ix + 2] = pz;
    }

    // つかんでいる質点はポインタ位置に固定
    if (grabIdx >= 0) {
      const gi = grabIdx * 3;
      pos[gi] = grabTarget.x;
      pos[gi + 1] = grabTarget.y;
      pos[gi + 2] = grabTarget.z;
      prev[gi] = grabTarget.x;
      prev[gi + 1] = grabTarget.y;
      prev[gi + 2] = grabTarget.z;
    }

    // 拘束解決
    for (let iter = 0; iter < 3; iter++) {
      for (const c of constraints) {
        const ia = c.a * 3;
        const ib = c.b * 3;
        let dx = pos[ib] - pos[ia];
        let dy = pos[ib + 1] - pos[ia + 1];
        let dz = pos[ib + 2] - pos[ia + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (dist - c.rest) / dist;
        const pa = pinned[c.a];
        const pb = pinned[c.b];
        if (pa && pb) continue;
        const wa = pa ? 0 : pb ? 1 : 0.5;
        const wb = pb ? 0 : pa ? 1 : 0.5;
        dx *= diff;
        dy *= diff;
        dz *= diff;
        pos[ia] += dx * wa;
        pos[ia + 1] += dy * wa;
        pos[ia + 2] += dz * wa;
        pos[ib] -= dx * wb;
        pos[ib + 1] -= dy * wb;
        pos[ib + 2] -= dz * wb;
      }
      if (grabIdx >= 0) {
        const gi = grabIdx * 3;
        pos[gi] = grabTarget.x;
        pos[gi + 1] = grabTarget.y;
        pos[gi + 2] = grabTarget.z;
      }
    }
  };

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      gust = Math.max(0, gust - dt * 1.6);
      windUser.multiplyScalar(Math.max(0, 1 - dt * 1.5));

      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 3) {
        step(t);
        acc -= 1 / 60;
        steps++;
      }

      (posAttr.array as Float32Array).set(pos);
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
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
      if (p.type === 'down') {
        grabIdx = pickParticle(p.x, p.y);
        if (grabIdx >= 0 && !pinned[grabIdx]) {
          const gi = grabIdx * 3;
          grabTarget.set(pos[gi], pos[gi + 1], pos[gi + 2]);
          grabDist = grabTarget.distanceTo(camera.position);
        } else {
          grabIdx = -1;
        }
      }
      if (p.type === 'move' && p.down) {
        if (grabIdx >= 0) {
          raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
          raycaster.ray.at(grabDist, grabTarget);
        } else {
          windUser.x += p.dx * 55;
          windUser.y += p.dy * 28;
          windUser.z += p.dx * 14;
          windUser.clampLength(0, 18);
        }
      }
      if (p.type === 'up' || p.type === 'leave') grabIdx = -1;
      if (p.type === 'tap') gust = 2.2;
    },
  };
}
