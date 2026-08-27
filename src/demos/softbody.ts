import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';

/**
 * シェイプマッチング法（Müller）によるソフトボディ（ゼリー）。
 * 5^3 の格子質点を積分し、最適回転 R を反復抽出して元形状へ引き戻す。
 * 描画メッシュは格子のトライリニア補間で変形する。
 */

const N = 5;
const SIZE = 1.5;

export async function createSoftbody(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1116);
  scene.fog = new THREE.Fog(0x0f1116, 9, 18);
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 40);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight(0xfff0dd, 1.6);
  key.position.set(2.5, 4, 2);
  scene.add(key);

  // --- 格子 ---
  const count = N * N * N;
  const spacing = SIZE / (N - 1);
  const rest: THREE.Vector3[] = [];
  const pts: THREE.Vector3[] = [];
  const vel: THREE.Vector3[] = [];
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const q = new THREE.Vector3(
          (x / (N - 1) - 0.5) * SIZE,
          (y / (N - 1) - 0.5) * SIZE,
          (z / (N - 1) - 0.5) * SIZE,
        );
        rest.push(q.clone());
        pts.push(q.clone().add(new THREE.Vector3(0, 1.4, 0)));
        vel.push(new THREE.Vector3());
      }
  const lidx = (x: number, y: number, z: number) => z * N * N + y * N + x;

  // --- 描画メッシュ（トライリニア補間の重みを事前計算） ---
  const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, 0.3);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const vCount = posAttr.count;
  const cells = new Int32Array(vCount * 3);
  const fracs = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const cx = THREE.MathUtils.clamp((posAttr.getX(i) / SIZE + 0.5) * (N - 1), 0, N - 1 - 1e-4);
    const cy = THREE.MathUtils.clamp((posAttr.getY(i) / SIZE + 0.5) * (N - 1), 0, N - 1 - 1e-4);
    const cz = THREE.MathUtils.clamp((posAttr.getZ(i) / SIZE + 0.5) * (N - 1), 0, N - 1 - 1e-4);
    cells[i * 3] = Math.floor(cx);
    cells[i * 3 + 1] = Math.floor(cy);
    cells[i * 3 + 2] = Math.floor(cz);
    fracs[i * 3] = cx - cells[i * 3];
    fracs[i * 3 + 1] = cy - cells[i * 3 + 1];
    fracs[i * 3 + 2] = cz - cells[i * 3 + 2];
  }

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xff4f7e,
    roughness: 0.12,
    transmission: 0.82,
    thickness: 1.0,
    attenuationColor: new THREE.Color(0xff88aa),
    attenuationDistance: 1.15,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    ior: 1.35,
  });
  const jelly = new THREE.Mesh(geo, mat);
  scene.add(jelly);

  // 床
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48),
    new THREE.MeshStandardMaterial({ color: 0x181b22, roughness: 0.85, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // 疑似シャドウ
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  const sctx = sc.getContext('2d')!;
  const sg = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  sg.addColorStop(0, 'rgba(0,0,0,0.5)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.012;
  scene.add(blob);

  const orbit = new OrbitDrag(camera, { theta: 0.5, phi: 1.22, radius: 5.0, autoRotate: 0.08, targetY: 0.75 });

  // --- シェイプマッチング ---
  const q = new THREE.Quaternion();
  const A = new THREE.Matrix3();
  const Rm = new THREE.Matrix3();
  const cm = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const rcol: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const acol: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const omega = new THREE.Vector3();
  const dq = new THREE.Quaternion();

  const extractRotation = (iters: number) => {
    const ae = A.elements;
    for (let k = 0; k < iters; k++) {
      Rm.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      const re = Rm.elements;
      for (let c = 0; c < 3; c++) {
        rcol[c].set(re[c * 3], re[c * 3 + 1], re[c * 3 + 2]);
        acol[c].set(ae[c * 3], ae[c * 3 + 1], ae[c * 3 + 2]);
      }
      omega.set(0, 0, 0);
      let denom = 0;
      for (let c = 0; c < 3; c++) {
        omega.add(tmp.copy(rcol[c]).cross(acol[c]));
        denom += rcol[c].dot(acol[c]);
      }
      omega.divideScalar(Math.abs(denom) + 1e-9);
      const w = omega.length();
      if (w < 1e-7) break;
      dq.setFromAxisAngle(tmp.copy(omega).divideScalar(w), w);
      q.premultiply(dq).normalize();
    }
  };

  let grabbing = false;
  let grabDepth = 0;
  const grabWeights = new Float32Array(count);
  const grabTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let idleTimer = 0;
  let acc = 0;

  const step = () => {
    const dt = 1 / 60;
    // 画面外へ流れないよう中央へ緩やかに戻す（掴み中は無効）
    const drift = Math.hypot(cm.x, cm.z);
    const recenter = grabbing ? 0 : drift > 1.8 ? 2.4 : 0.55;
    // 積分
    for (let i = 0; i < count; i++) {
      vel[i].x -= cm.x * recenter * dt;
      vel[i].z -= cm.z * recenter * dt;
      vel[i].y -= 9.2 * dt;
      vel[i].multiplyScalar(Math.max(0, 1 - 0.55 * dt));
      if (grabbing) {
        // 速度ばね + 位置ベースの引き寄せで「びよーん」と伸びるように
        tmp.copy(grabTarget).sub(pts[i]);
        vel[i].addScaledVector(tmp, grabWeights[i] * 70 * dt);
        pts[i].addScaledVector(tmp, Math.min(1, grabWeights[i]) * 0.38);
      }
      pts[i].addScaledVector(vel[i], dt);
      if (pts[i].y < 0.02) {
        pts[i].y = 0.02;
        if (vel[i].y < 0) vel[i].y *= -0.32;
        vel[i].x *= 0.86;
        vel[i].z *= 0.86;
      }
    }
    // 重心と Apq
    cm.set(0, 0, 0);
    for (const p of pts) cm.add(p);
    cm.divideScalar(count);
    const ae = A.elements;
    ae.fill(0);
    for (let i = 0; i < count; i++) {
      tmp.copy(pts[i]).sub(cm);
      const qx = rest[i].x, qy = rest[i].y, qz = rest[i].z;
      ae[0] += tmp.x * qx; ae[1] += tmp.y * qx; ae[2] += tmp.z * qx;
      ae[3] += tmp.x * qy; ae[4] += tmp.y * qy; ae[5] += tmp.z * qy;
      ae[6] += tmp.x * qz; ae[7] += tmp.y * qz; ae[8] += tmp.z * qz;
    }
    extractRotation(9);
    Rm.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    // ゴール位置へ引き戻す（つかんでいる間は柔らかくして大きく伸びるように）
    const alpha = grabbing ? 0.17 : 0.3;
    for (let i = 0; i < count; i++) {
      tmp.copy(rest[i]).applyMatrix3(Rm).add(cm);
      tmp2.copy(tmp).sub(pts[i]);
      pts[i].addScaledVector(tmp2, alpha);
      vel[i].addScaledVector(tmp2, alpha / dt * 0.42);
    }
  };

  const updateMesh = () => {
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < vCount; i++) {
      const cx = cells[i * 3], cy = cells[i * 3 + 1], cz = cells[i * 3 + 2];
      const fx = fracs[i * 3], fy = fracs[i * 3 + 1], fz = fracs[i * 3 + 2];
      let px = 0, py = 0, pz = 0;
      for (let dz = 0; dz <= 1; dz++)
        for (let dy = 0; dy <= 1; dy++)
          for (let dx = 0; dx <= 1; dx++) {
            const w =
              (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
            const p = pts[lidx(cx + dx, cy + dy, cz + dz)];
            px += p.x * w;
            py += p.y * w;
            pz += p.z * w;
          }
      arr[i * 3] = px;
      arr[i * 3 + 1] = py;
      arr[i * 3 + 2] = pz;
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };

  const poke = (dir: THREE.Vector3, at: THREE.Vector3, strength: number) => {
    for (let i = 0; i < count; i++) {
      const d = pts[i].distanceTo(at);
      const w = Math.exp(-d * d * 1.1);
      vel[i].addScaledVector(dir, strength * w);
    }
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      idleTimer += dt;
      if (idleTimer > 5.5) {
        idleTimer = 0;
        const a = Math.random() * Math.PI * 2;
        poke(new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize(), cm.clone().setY(0.1), 3.2);
      }
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 3) {
        step();
        acc -= 1 / 60;
        steps++;
      }
      updateMesh();
      blob.position.x = cm.x;
      blob.position.z = cm.z;
      const spread = THREE.MathUtils.clamp(1.3 - (cm.y - 0.75) * 0.4, 0.6, 1.6);
      blob.scale.setScalar(spread);
      (blob.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(1.2 - cm.y * 0.35, 0.2, 0.85);
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
      raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
      const sphere = new THREE.Sphere(cm.clone(), 1.25);
      const hit = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());

      if (p.type === 'down') {
        idleTimer = 0;
        if (hit) {
          grabbing = true;
          grabDepth = hit.distanceTo(raycaster.ray.origin);
          grabTarget.copy(hit);
          for (let i = 0; i < count; i++) {
            const d = pts[i].distanceTo(hit);
            grabWeights[i] = Math.exp(-d * d * 0.9);
          }
        } else {
          orbit.pointer(p);
        }
      } else if (p.type === 'move') {
        if (grabbing && p.down) {
          raycaster.ray.at(grabDepth, grabTarget);
          grabTarget.y = Math.max(grabTarget.y, 0.15);
          idleTimer = 0;
        } else {
          orbit.pointer(p);
        }
      } else if (p.type === 'up' || p.type === 'leave') {
        grabbing = false;
        orbit.pointer(p);
      }
      if (p.type === 'tap' && hit) {
        idleTimer = 0;
        poke(raycaster.ray.direction, hit, 10.5);
      }
    },
  };
}
