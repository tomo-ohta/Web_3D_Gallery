import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';

/** Verlet ストランドによる真珠のカーテン。指でかき分けられる */

const STRANDS = 36;
const NODES = 22;
const SPACING = 0.075;

export async function createRope(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14121a);
  scene.fog = new THREE.Fog(0x14121a, 6, 13);
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 30);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffe9d0, 1.4);
  key.position.set(2, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8ab4ff, 0.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // 吊り棒
  const barWidth = (STRANDS - 1) * 0.085;
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, barWidth + 0.5, 16),
    new THREE.MeshStandardMaterial({ color: 0xd8b56a, metalness: 1, roughness: 0.3 }),
  );
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 1.55;
  scene.add(bar);

  // --- 質点 ---
  const count = STRANDS * NODES;
  const pos = new Float32Array(count * 3);
  const prev = new Float32Array(count * 3);
  const idx = (s: number, n: number) => s * NODES + n;
  for (let s = 0; s < STRANDS; s++) {
    const x = -barWidth / 2 + s * 0.085;
    for (let n = 0; n < NODES; n++) {
      const i = idx(s, n);
      pos[i * 3] = x;
      pos[i * 3 + 1] = 1.55 - n * SPACING;
      pos[i * 3 + 2] = Math.sin(s * 1.7) * 0.01;
      prev[i * 3] = pos[i * 3];
      prev[i * 3 + 1] = pos[i * 3 + 1];
      prev[i * 3 + 2] = pos[i * 3 + 2];
    }
  }

  // --- ビーズ描画 ---
  const beadGeo = new THREE.SphereGeometry(0.035, 16, 12);
  const beadMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    iridescence: 0.55,
    iridescenceIOR: 1.35,
  });
  const beads = new THREE.InstancedMesh(beadGeo, beadMat, count);
  beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.Color();
  for (let s = 0; s < STRANDS; s++) {
    for (let n = 0; n < NODES; n++) {
      color.setHSL(0.55 + Math.sin(s * 0.5) * 0.12, 0.25, 0.78 - n * 0.008);
      beads.setColorAt(idx(s, n), color);
    }
  }
  scene.add(beads);

  const orbit = new OrbitDrag(camera, { theta: 0.15, phi: 1.42, radius: 3.6, autoRotate: 0.05, targetY: 0.75, minRadius: 1.8, maxRadius: 7 });

  const raycaster = new THREE.Raycaster();
  const curtainPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const fingerPos = new THREE.Vector3(0, -99, 0);
  let fingerActive = 0;
  let acc = 0;

  const mat4 = new THREE.Matrix4();
  const FINGER_R = 0.3;

  const step = (t: number) => {
    const dt = 1 / 60;
    const damp = 0.992;
    for (let i = 0; i < count; i++) {
      const n = i % NODES;
      if (n === 0) continue;
      const i3 = i * 3;
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      // ゆるい空気の揺らぎ
      const sway = Math.sin(t * 0.9 + px * 2.1 + n * 0.3) * 0.05;
      pos[i3] = px + (px - prev[i3]) * damp + sway * dt * dt * 30;
      pos[i3 + 1] = py + (py - prev[i3 + 1]) * damp - 5.2 * dt * dt;
      pos[i3 + 2] = pz + (pz - prev[i3 + 2]) * damp;
      prev[i3] = px;
      prev[i3 + 1] = py;
      prev[i3 + 2] = pz;

      // 指の球で押しのける
      if (fingerActive > 0) {
        const dx = pos[i3] - fingerPos.x;
        const dy = pos[i3 + 1] - fingerPos.y;
        const dz = pos[i3 + 2] - fingerPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < FINGER_R * FINGER_R && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (FINGER_R - d) / d;
          pos[i3] += dx * push;
          pos[i3 + 1] += dy * push * 0.4;
          pos[i3 + 2] += dz * push;
        }
      }
    }
    // 距離拘束
    for (let iter = 0; iter < 2; iter++) {
      for (let s = 0; s < STRANDS; s++) {
        for (let n = 0; n < NODES - 1; n++) {
          const a = idx(s, n) * 3;
          const b = idx(s, n + 1) * 3;
          let dx = pos[b] - pos[a];
          let dy = pos[b + 1] - pos[a + 1];
          let dz = pos[b + 2] - pos[a + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (dist - SPACING) / dist;
          const wa = n === 0 ? 0 : 0.5;
          const wb = n === 0 ? 1 : 0.5;
          dx *= diff; dy *= diff; dz *= diff;
          pos[a] += dx * wa;
          pos[a + 1] += dy * wa;
          pos[a + 2] += dz * wa;
          pos[b] -= dx * wb;
          pos[b + 1] -= dy * wb;
          pos[b + 2] -= dz * wb;
        }
      }
    }
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      fingerActive = Math.max(0, fingerActive - dt);
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 3) {
        step(t);
        acc -= 1 / 60;
        steps++;
      }
      for (let i = 0; i < count; i++) {
        mat4.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        beads.setMatrixAt(i, mat4);
      }
      beads.instanceMatrix.needsUpdate = true;
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
      if (p.type === 'move' || p.type === 'down') {
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectPlane(curtainPlane, new THREE.Vector3());
        if (hit && Math.abs(hit.x) < barWidth / 2 + 0.5 && hit.y < 1.6 && hit.y > -0.6) {
          fingerPos.copy(hit);
          fingerActive = 0.25;
        } else if (p.down) {
          orbit.pointer(p);
        }
      } else {
        orbit.pointer(p);
      }
      if (p.type === 'tap') {
        // 波のパルス
        for (let s = 0; s < STRANDS; s++) {
          for (let n = 1; n < NODES; n++) {
            const i3 = idx(s, n) * 3;
            prev[i3 + 2] -= Math.sin((s / STRANDS) * Math.PI * 2 + n * 0.2) * 0.06 * (n / NODES);
          }
        }
      }
    },
    dispose() {
      beadGeo.dispose();
    },
  };
}
