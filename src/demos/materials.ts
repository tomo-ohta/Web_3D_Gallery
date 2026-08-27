import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

interface Preset {
  label: string;
  make(): THREE.MeshPhysicalMaterial;
}

const PRESETS: Preset[] = [
  {
    label: 'カーペイント（クリアコート）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x7a0c1e,
        metalness: 0.72,
        roughness: 0.32,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
      }),
  },
  {
    label: 'ヘアライン金属（異方性反射）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xc8ccd4,
        metalness: 1.0,
        roughness: 0.42,
        anisotropy: 1.0,
        anisotropyRotation: Math.PI / 2,
      }),
  },
  {
    label: '虹彩薄膜（イリデッセンス）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x101014,
        metalness: 1.0,
        roughness: 0.14,
        iridescence: 1.0,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [120, 480],
      }),
  },
  {
    label: 'ベルベット（シーン光沢）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x3d0a28,
        metalness: 0,
        roughness: 1.0,
        sheen: 1.0,
        sheenColor: new THREE.Color(0xff5f8a),
        sheenRoughness: 0.42,
      }),
  },
  {
    label: '磨き金（ゴールド）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffc766,
        metalness: 1.0,
        roughness: 0.2,
      }),
  },
  {
    label: '白磁（ポーセリン）',
    make: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xf4f1ea,
        metalness: 0,
        roughness: 0.16,
        clearcoat: 0.55,
        clearcoatRoughness: 0.12,
        specularIntensity: 1.0,
      }),
  },
];

/** MeshPhysicalMaterial の拡張マテリアル群を 1 つのヒーローオブジェクトで巡回展示 */
export async function createMaterials(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 60);
  scene.add(camera);

  const envMap = (await ctx.assets.env('studio')).env;
  scene.environment = envMap;
  scene.environmentIntensity = 1.15;

  const geo = new THREE.TorusKnotGeometry(1.0, 0.38, 400, 56);
  let index = 0;
  const mesh = new THREE.Mesh(geo, PRESETS[0].make());
  scene.add(mesh);

  // 背景に淡いリング（反射に写り込む要素にもなる）
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.1, 0.02, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0x2a3240 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.7;
  scene.add(ring);

  const orbit = new OrbitDrag(camera, { theta: 0.6, phi: 1.2, radius: 5.8, autoRotate: 0.12, minRadius: 2.6, maxRadius: 11 });
  const label = new LabelSprite(camera);
  label.set(PRESETS[0].label);

  let pop = 0;

  return {
    dispose() {
      purgeScene(scene);
    },
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      mesh.rotation.y = t * 0.24;
      mesh.rotation.x = Math.sin(t * 0.17) * 0.25;
      pop = Math.max(0, pop - dt * 4);
      const s = 1 + Math.sin(Math.min(1, 1 - pop) * Math.PI) * 0.05;
      mesh.scale.setScalar(s);
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
        index = (index + 1) % PRESETS.length;
        mesh.material.dispose();
        mesh.material = PRESETS[index].make();
        label.set(PRESETS[index].label);
        pop = 1;
      }
    },
  };
}
