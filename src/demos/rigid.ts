import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';
import { loadRapier } from '../core/rapier';

interface Body {
  rb: RAPIER_NS.RigidBody;
  mesh: THREE.Mesh;
}

/** Rapier 物理エンジンによる剛体シミュレーション（タップで鉄球発射） */
export async function createRigid(ctx: DemoContext): Promise<Demo> {
  const RAPIER = await loadRapier();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);
  scene.fog = new THREE.Fog(0x101216, 12, 26);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 50);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.5;

  const key = new THREE.DirectionalLight(0xffeedd, 2.2);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.002;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x404a5a, 0.8));

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  // 地面
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(9, 0.5, 9).setTranslation(0, -0.5, 0).setFriction(0.9),
  );
  const gc = document.createElement('canvas');
  gc.width = gc.height = 256;
  const gctx = gc.getContext('2d')!;
  gctx.fillStyle = '#181b21';
  gctx.fillRect(0, 0, 256, 256);
  gctx.strokeStyle = '#22262e';
  gctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    gctx.beginPath();
    gctx.moveTo((i * 256) / 8, 0);
    gctx.lineTo((i * 256) / 8, 256);
    gctx.stroke();
    gctx.beginPath();
    gctx.moveTo(0, (i * 256) / 8);
    gctx.lineTo(256, (i * 256) / 8);
    gctx.stroke();
  }
  const gTex = new THREE.CanvasTexture(gc);
  gTex.colorSpace = THREE.SRGBColorSpace;
  gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping;
  gTex.repeat.set(4, 4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- ジェンガタワー ---
  const BLOCK = { x: 0.96, y: 0.3, z: 0.3 };
  const LEVELS = 9;
  const blockGeo = new THREE.BoxGeometry(BLOCK.x, BLOCK.y, BLOCK.z);
  const woodColors = [0xc99862, 0xb98450, 0xd9aa74, 0xaa7648];
  const blockMats = woodColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0.04 }),
  );
  const blocks: Body[] = [];
  const balls: Body[] = [];

  const makeBlock = (x: number, y: number, z: number, rotY: number, mi: number) => {
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY) as unknown as RAPIER_NS.Rotation,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(BLOCK.x / 2, BLOCK.y / 2, BLOCK.z / 2)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setDensity(0.8),
      rb,
    );
    const mesh = new THREE.Mesh(blockGeo, blockMats[mi % blockMats.length]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    blocks.push({ rb, mesh });
  };

  const buildTower = () => {
    let mi = 0;
    for (let lvl = 0; lvl < LEVELS; lvl++) {
      const y = BLOCK.y / 2 + lvl * (BLOCK.y + 0.003);
      const rot = lvl % 2 === 0;
      for (let i = -1; i <= 1; i++) {
        const off = i * (BLOCK.z + 0.006);
        if (rot) makeBlock(off, y, 0, Math.PI / 2, mi++);
        else makeBlock(0, y, off, 0, mi++);
      }
    }
  };

  const clearBodies = (list: Body[]) => {
    for (const b of list) {
      world.removeRigidBody(b.rb);
      scene.remove(b.mesh);
    }
    list.length = 0;
  };

  buildTower();

  const ballGeo = new THREE.SphereGeometry(0.26, 32, 24);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 1.0, roughness: 0.18 });

  const orbit = new OrbitDrag(camera, { theta: 0.5, phi: 1.2, radius: 8.2, autoRotate: 0.06, targetY: 1.3 });
  orbit.minPhi = 0.5;
  orbit.maxPhi = 1.48;

  const raycaster = new THREE.Raycaster();
  let acc = 0;
  let calmTime = 0;
  let disturbed = false;

  const shoot = (ndcX: number, ndcY: number) => {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const dir = raycaster.ray.direction.clone().normalize();
    const origin = camera.position.clone().addScaledVector(dir, 0.8);
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(dir.x * 17, dir.y * 17, dir.z * 17),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(0.26).setDensity(5).setRestitution(0.35).setFriction(0.6), rb);
    const mesh = new THREE.Mesh(ballGeo, ballMat);
    mesh.castShadow = true;
    scene.add(mesh);
    balls.push({ rb, mesh });
    if (balls.length > 6) {
      const old = balls.shift()!;
      world.removeRigidBody(old.rb);
      scene.remove(old.mesh);
    }
    disturbed = true;
    calmTime = 0;
  };

  const sync = (list: Body[]) => {
    for (const b of list) {
      const tr = b.rb.translation();
      const rot = b.rb.rotation();
      b.mesh.position.set(tr.x, tr.y, tr.z);
      b.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  };

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 3) {
        world.step();
        acc -= 1 / 60;
        steps++;
      }
      sync(blocks);
      sync(balls);

      // 落下したボールの掃除
      for (let i = balls.length - 1; i >= 0; i--) {
        if (balls[i].rb.translation().y < -8) {
          world.removeRigidBody(balls[i].rb);
          scene.remove(balls[i].mesh);
          balls.splice(i, 1);
        }
      }

      // 静まったら自動再建
      if (disturbed) {
        let maxV = 0;
        for (const b of blocks) {
          const v = b.rb.linvel();
          maxV = Math.max(maxV, Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z));
        }
        if (maxV < 0.12) calmTime += dt;
        else calmTime = 0;
        if (calmTime > 3.5) {
          disturbed = false;
          calmTime = 0;
          clearBodies(blocks);
          clearBodies(balls);
          buildTower();
        }
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
      if (p.type === 'tap') shoot(p.x, p.y);
    },
    dispose() {
      world.free();
    },
  };
}
