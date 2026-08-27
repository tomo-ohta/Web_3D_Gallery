import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { loadRapier } from '../core/rapier';

/**
 * 破壊と再生。球殻を破片に分割した陶器の壺を Rapier で崩壊させ、
 * キネマティック補間で元の形へ再集合させる。
 */

interface Shard {
  mesh: THREE.Mesh;
  rb: RAPIER_NS.RigidBody;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
}

export async function createFracture(ctx: DemoContext): Promise<Demo> {
  const RAPIER = await loadRapier();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121014);
  scene.fog = new THREE.Fog(0x121014, 10, 22);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 50);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffe8d5, 2.0);
  key.position.set(3.5, 6, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -1;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.002;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x3a3542, 0.9));

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0).setFriction(0.85));

  // 床
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b171e, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 台座
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.0, 0.5, 40),
    new THREE.MeshStandardMaterial({ color: 0x4a4550, roughness: 0.6, metalness: 0.1 }),
  );
  pedestal.position.y = 0.25;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  scene.add(pedestal);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.25, 0.92).setTranslation(0, 0.25, 0).setFriction(0.8));

  // --- 壺の破片を生成 ---
  const POT_R = 1.0;
  const POT_CENTER = new THREE.Vector3(0, 1.6, 0);
  const THICK = 0.085;
  const ROWS = 8;
  const phiStart = 0.42;
  const phiEnd = Math.PI - 0.55;

  const shards: Shard[] = [];

  const matBody = new THREE.MeshStandardMaterial({ color: 0xb06040, roughness: 0.78, metalness: 0.02 });
  const matGlaze = new THREE.MeshStandardMaterial({ color: 0x2e6f75, roughness: 0.35, metalness: 0.05 });

  const sph = (phi: number, theta: number, r: number) =>
    new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * r,
      Math.cos(phi) * r,
      Math.sin(phi) * Math.sin(theta) * r,
    );

  for (let i = 0; i < ROWS; i++) {
    const phiA = phiStart + ((phiEnd - phiStart) * i) / ROWS;
    const phiB = phiStart + ((phiEnd - phiStart) * (i + 1)) / ROWS;
    const midPhi = (phiA + phiB) / 2;
    const cols = Math.max(6, Math.round(13 * Math.sin(midPhi)));
    for (let j = 0; j < cols; j++) {
      const thA = (j / cols) * Math.PI * 2;
      const thB = ((j + 1) / cols) * Math.PI * 2;
      // 8頂点シェル
      const corners = [
        sph(phiA, thA, POT_R), sph(phiA, thB, POT_R), sph(phiB, thB, POT_R), sph(phiB, thA, POT_R),
        sph(phiA, thA, POT_R - THICK), sph(phiA, thB, POT_R - THICK), sph(phiB, thB, POT_R - THICK), sph(phiB, thA, POT_R - THICK),
      ];
      const centroid = corners.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(8);
      const local = corners.map((v) => v.clone().sub(centroid));

      const positions: number[] = [];
      const quad = (a: number, b: number, c: number, d: number) => {
        positions.push(
          ...local[a].toArray(), ...local[b].toArray(), ...local[c].toArray(),
          ...local[a].toArray(), ...local[c].toArray(), ...local[d].toArray(),
        );
      };
      quad(0, 1, 2, 3); // 外面
      quad(7, 6, 5, 4); // 内面
      quad(4, 5, 1, 0); // 上
      quad(3, 2, 6, 7); // 下
      quad(0, 3, 7, 4); // 側面
      quad(2, 1, 5, 6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.computeVertexNormals();

      const glazed = i === 2 || i === 3;
      const mesh = new THREE.Mesh(geo, glazed ? matGlaze : matBody);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const homePos = centroid.clone().add(POT_CENTER);
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(homePos.x, homePos.y, homePos.z),
      );
      const verts = new Float32Array(local.flatMap((v) => [v.x, v.y, v.z]));
      const col = RAPIER.ColliderDesc.convexHull(verts);
      if (col) world.createCollider(col.setFriction(0.7).setRestitution(0.15).setDensity(1.4), rb);

      mesh.position.copy(homePos);
      shards.push({
        mesh,
        rb,
        homePos,
        homeQuat: new THREE.Quaternion(),
        fromPos: new THREE.Vector3(),
        fromQuat: new THREE.Quaternion(),
      });
    }
  }

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.25, radius: 5.6, autoRotate: 0.07, targetY: 1.3, minRadius: 3, maxRadius: 10 });

  type Phase = 'intact' | 'broken' | 'reassembling';
  let phase: Phase = 'intact';
  let phaseT = 0;
  let calm = 0;
  let brokenTime = 0;
  const raycaster = new THREE.Raycaster();
  const potSphere = new THREE.Sphere(POT_CENTER, POT_R + 0.15);
  let acc = 0;

  const shatter = (at: THREE.Vector3, strength: number) => {
    for (const s of shards) {
      if (s.rb.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
        s.rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      }
      const p = s.rb.translation();
      const d = new THREE.Vector3(p.x - at.x, p.y - at.y, p.z - at.z);
      const dist = d.length() + 0.15;
      d.normalize();
      const imp = (strength / (dist * dist * 0.8 + 0.4)) * 0.09;
      s.rb.applyImpulse({ x: d.x * imp, y: (d.y + 0.45) * imp, z: d.z * imp }, true);
      s.rb.applyTorqueImpulse(
        { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 },
        true,
      );
    }
    phase = 'broken';
    calm = 0;
    brokenTime = 0;
  };

  const beginReassemble = () => {
    phase = 'reassembling';
    phaseT = 0;
    for (const s of shards) {
      const p = s.rb.translation();
      const q = s.rb.rotation();
      s.fromPos.set(p.x, p.y, p.z);
      s.fromQuat.set(q.x, q.y, q.z, q.w);
      s.rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  };

  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  let idleTimer = 0;

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      acc += dt;
      idleTimer += dt;

      if (phase === 'intact' && idleTimer > 8) {
        idleTimer = 0;
        shatter(POT_CENTER.clone().add(new THREE.Vector3(0.6, 0.2, 0.3)), 5.5);
      }

      if (phase === 'reassembling') {
        phaseT += dt / 1.4;
        const e = phaseT < 1 ? 1 - Math.pow(1 - phaseT, 3) : 1;
        for (const s of shards) {
          tmpP.lerpVectors(s.fromPos, s.homePos, e);
          tmpQ.slerpQuaternions(s.fromQuat, s.homeQuat, e);
          s.rb.setNextKinematicTranslation({ x: tmpP.x, y: tmpP.y, z: tmpP.z });
          s.rb.setNextKinematicRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
        }
        if (phaseT >= 1) {
          for (const s of shards) {
            s.rb.setBodyType(RAPIER.RigidBodyType.Fixed, true);
            s.rb.setTranslation({ x: s.homePos.x, y: s.homePos.y, z: s.homePos.z }, true);
            s.rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          }
          phase = 'intact';
          idleTimer = 0;
        }
      }

      let steps = 0;
      while (acc >= 1 / 60 && steps < 3) {
        world.step();
        acc -= 1 / 60;
        steps++;
      }

      for (const s of shards) {
        const p = s.rb.translation();
        const q = s.rb.rotation();
        s.mesh.position.set(p.x, p.y, p.z);
        s.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }

      if (phase === 'broken') {
        brokenTime += dt;
        let maxV = 0;
        for (const s of shards) {
          const v = s.rb.linvel();
          maxV = Math.max(maxV, Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z));
        }
        if (maxV < 0.25) calm += dt;
        else calm = 0;
        // 静まったら再生。万一収まらなくても 10 秒で強制的に再生
        if (calm > 1.6 || brokenTime > 10) beginReassemble();
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
      orbit.pointer(p);
      if (p.type === 'tap') {
        idleTimer = 0;
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        const hit = raycaster.ray.intersectSphere(potSphere, new THREE.Vector3());
        if (phase === 'intact') {
          shatter(hit ?? POT_CENTER, hit ? 9 : 6);
        } else if (phase === 'broken') {
          // 破片をさらに蹴散らす
          const at = hit ?? raycaster.ray.at(6, new THREE.Vector3());
          for (const s of shards) {
            const sp = s.rb.translation();
            const d = new THREE.Vector3(sp.x - at.x, sp.y - at.y, sp.z - at.z);
            const dist = d.length() + 0.2;
            if (dist < 2.5) {
              d.normalize();
              s.rb.applyImpulse({ x: d.x * 0.05, y: 0.06, z: d.z * 0.05 }, true);
            }
          }
        }
      }
    },
    dispose() {
      purgeScene(scene);
      world.free();
    },
  };
}
