import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** スケルタルアニメーション（Fox）+ 頭部ボーンのプロシージャル注視制御 */

export async function createSkeletal(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131017);
  scene.fog = new THREE.Fog(0x131017, 10, 20);
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 40);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffe8cc, 2.2);
  key.position.set(3, 5, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -1;
  key.shadow.bias = -0.002;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x4a4258, 0.9));

  const gltf = await ctx.assets.gltf('fox');
  // キャッシュされた原本を汚さないよう複製する（再生成時にスケールが二重に掛かるのを防ぐ）
  const fox = SkeletonUtils.clone(gltf.scene);
  // 正規化（Fox は約 100 単位）
  const bb = new THREE.Box3().setFromObject(fox);
  const size = bb.getSize(new THREE.Vector3());
  const scale = 2.3 / Math.max(size.x, size.y, size.z);
  fox.scale.setScalar(scale);
  fox.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });

  // 円周を歩くためのグループ
  const walker = new THREE.Group();
  const WALK_R = 1.9;
  fox.position.set(WALK_R, 0, 0);
  fox.rotation.y = Math.PI; // 円の接線方向（反時計回り）
  walker.add(fox);
  walker.rotation.y = 2.4;
  scene.add(walker);

  // 頭部ボーン
  let headBone: THREE.Bone | null = null;
  fox.traverse((o) => {
    if ((o as THREE.Bone).isBone && /head/i.test(o.name) && !headBone) headBone = o as THREE.Bone;
  });
  const headRest = headBone ? (headBone as THREE.Bone).quaternion.clone() : null;

  // 地面
  const gc = document.createElement('canvas');
  gc.width = gc.height = 256;
  const gctx = gc.getContext('2d')!;
  gctx.fillStyle = '#191521';
  gctx.fillRect(0, 0, 256, 256);
  gctx.strokeStyle = '#241f30';
  gctx.lineWidth = 2;
  for (let r = 30; r < 130; r += 32) {
    gctx.beginPath();
    gctx.arc(128, 128, r, 0, Math.PI * 2);
    gctx.stroke();
  }
  const gTex = new THREE.CanvasTexture(gc);
  gTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48),
    new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // アニメーション
  const mixer = new THREE.AnimationMixer(fox);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  const ANIM_ORDER = ['Survey', 'Walk', 'Run'];
  const ANIM_LABEL: Record<string, string> = { Survey: '見回す（アイドル）', Walk: '歩く', Run: '走る' };
  let animIndex = 0;
  let current: THREE.AnimationAction | null = null;
  const playAnim = (name: string) => {
    const next = actions.get(name);
    if (!next) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.35).play();
    if (current) current.fadeOut(0.35);
    current = next;
  };
  playAnim('Survey');

  const orbit = new OrbitDrag(camera, { theta: 0.5, phi: 1.25, radius: 5.4, autoRotate: 0.06, targetY: 0.8, minRadius: 2.6, maxRadius: 10 });
  const label = new LabelSprite(camera);
  label.set(ANIM_LABEL['Survey']);

  const raycaster = new THREE.Raycaster();
  const lookTarget = new THREE.Vector3();
  let lookActive = 0;
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const headPos = new THREE.Vector3();
  const parentQ = new THREE.Quaternion();

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      mixer.update(dt);

      // 歩行 / 走行時は円周を移動
      const speed = animIndex === 1 ? 0.5 : animIndex === 2 ? 1.55 : 0;
      walker.rotation.y += speed * dt;

      // 注視制御（ミキサー更新後にボーンへ上書き）
      lookActive = Math.max(0, lookActive - dt);
      if (headBone && headRest) {
        const bone = headBone as THREE.Bone;
        if (lookActive > 0 && animIndex !== 2) {
          bone.updateWorldMatrix(true, false);
          headPos.setFromMatrixPosition(bone.matrixWorld);
          // ボーンのワールド回転から親の回転を取り出し、ローカル目標回転を作る
          bone.parent!.matrixWorld.decompose(new THREE.Vector3(), parentQ, new THREE.Vector3());
          tmpM.lookAt(lookTarget, headPos, new THREE.Vector3(0, 1, 0));
          tmpQ.setFromRotationMatrix(tmpM);
          // glTF ボーンは +Y が前方向のことが多いので補正
          tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
          const localGoal = parentQ.clone().invert().multiply(tmpQ);
          // 可動域を制限しつつ追従
          if (localGoal.angleTo(headRest) < 1.15) {
            bone.quaternion.slerp(localGoal, Math.min(1, dt * 7));
          }
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
      if (p.type === 'zoom') {
        orbit.zoom(p.dz ?? 0);
        return;
      }
      if (p.type === 'move' || p.type === 'down') {
        raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        raycaster.ray.at(4.2, lookTarget);
        lookTarget.y = Math.max(lookTarget.y, 0.25);
        lookActive = 1.6;
      }
      if (p.down || p.type === 'up' || p.type === 'leave') orbit.pointer(p);
      if (p.type === 'down') orbit.pointer(p);
      if (p.type === 'tap') {
        animIndex = (animIndex + 1) % ANIM_ORDER.length;
        playAnim(ANIM_ORDER[animIndex]);
        label.set(ANIM_LABEL[ANIM_ORDER[animIndex]]);
      }
    },
  };
}
