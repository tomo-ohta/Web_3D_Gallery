import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { LabelSprite } from '../core/textsprite';

interface SSSPreset {
  label: string;
  color: number;
  attenuationColor: number;
  attenuationDistance: number;
  roughness: number;
  transmission: number;
  lightColor: number;
  thickness: number;
  ior: number;
  /** 高透明素材ほど周囲の映り込みを強くして質感を出す */
  envIntensity: number;
}

const PRESETS: SSSPreset[] = [
  {
    label: '翡翠（ジェイド）',
    color: 0x2e8b57,
    attenuationColor: 0x1fae62,
    attenuationDistance: 0.55,
    roughness: 0.28,
    transmission: 0.92,
    lightColor: 0xfff2d8,
    thickness: 1.35,
    ior: 1.5,
    envIntensity: 0.6,
  },
  {
    label: '蜜蝋（ワックス）',
    color: 0xe8c39e,
    attenuationColor: 0xff9a3c,
    attenuationDistance: 0.42,
    roughness: 0.5,
    transmission: 0.88,
    lightColor: 0xffe6b8,
    thickness: 1.35,
    ior: 1.45,
    envIntensity: 0.6,
  },
  {
    label: '乳白ガラス（オパール）',
    color: 0xdfe8f5,
    attenuationColor: 0x9ec3ff,
    attenuationDistance: 0.8,
    roughness: 0.18,
    transmission: 0.96,
    lightColor: 0xeaf2ff,
    thickness: 1.35,
    ior: 1.5,
    envIntensity: 0.7,
  },
  {
    label: '琥珀（アンバー・高透明）',
    color: 0xd99441,
    attenuationColor: 0xe87d10,
    attenuationDistance: 1.5,
    roughness: 0.05,
    transmission: 1.0,
    lightColor: 0xffd9a0,
    thickness: 1.0,
    ior: 1.55,
    envIntensity: 1.1,
  },
  {
    label: 'クリアガラス（無色透明）',
    color: 0xffffff,
    attenuationColor: 0xeef8ff,
    attenuationDistance: 5.0,
    roughness: 0.02,
    transmission: 1.0,
    lightColor: 0xffffff,
    thickness: 0.9,
    ior: 1.5,
    envIntensity: 1.4,
  },
];

/**
 * 半透明素材の透過表現（サブサーフェス風）。
 * 背後の光球を Transmission が屈折・減衰させ、翡翠彫刻の「透け」を再現する。
 * ポインタで背後の光源を動かせる。
 */
export async function createSSS(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08090d);
  const camera = new THREE.PerspectiveCamera(36, 16 / 10, 0.1, 60);
  camera.position.set(0, 0.4, 5.2);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  const [envData, dragonGeo] = await Promise.all([ctx.assets.env('studio'), ctx.assets.dragon()]);
  scene.environment = envData.env;
  scene.environmentIntensity = 0.6;

  // ドラゴンが読めない環境ではノットで代替する
  const geo = dragonGeo ? dragonGeo.clone() : new THREE.TorusKnotGeometry(0.8, 0.32, 220, 36);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  const s = 3.6 / bb.getSize(new THREE.Vector3()).length();
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(s, s, s);

  const mat = new THREE.MeshPhysicalMaterial({
    color: PRESETS[0].color,
    metalness: 0,
    roughness: PRESETS[0].roughness,
    transmission: PRESETS[0].transmission,
    thickness: 1.35,
    attenuationColor: new THREE.Color(PRESETS[0].attenuationColor),
    attenuationDistance: PRESETS[0].attenuationDistance,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });
  const statue = new THREE.Mesh(geo, mat);
  scene.add(statue);

  // 背後の光球（可視の光源として透けて見える）
  const bulbMat = new THREE.MeshBasicMaterial({ color: PRESETS[0].lightColor });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 20), bulbMat);
  bulb.position.set(0.4, 0.3, -1.6);
  scene.add(bulb);
  const glow = new THREE.PointLight(PRESETS[0].lightColor, 26, 14, 1.5);
  bulb.add(glow);

  // 高透明素材の屈折に映える小さな色付き光球
  const orbs: THREE.Mesh[] = [];
  for (const col of [0x7fb4ff, 0xffb36b]) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5) }),
    );
    scene.add(orb);
    orbs.push(orb);
  }

  // 前面の弱いキーライトとリム
  const key = new THREE.DirectionalLight(0xbfd4ff, 1.1);
  key.position.set(-2, 2.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe2b8, 0.9);
  rim.position.set(2.5, 1.5, -2.5);
  scene.add(rim);

  const label = new LabelSprite(camera);
  const bulbTarget = new THREE.Vector3(0.4, 0.3, -1.6);
  let index = 0;
  let bulbActive = 0;
  let camZ = 5.2;

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.45,
    update(dt, t) {
      label.update(dt);
      statue.rotation.y = Math.sin(t * 0.22) * 0.55 + Math.PI * 0.04;
      // 光球はゆっくり追従 + 待機時は8の字を描く
      const idle = new THREE.Vector3(Math.sin(t * 0.5) * 1.1, Math.sin(t * 0.9) * 0.5 + 0.25, -1.6);
      const goal = bulbActive > 0 ? bulbTarget : idle;
      bulbActive = Math.max(0, bulbActive - dt);
      bulb.position.lerp(goal, Math.min(1, dt * 5));
      for (let i = 0; i < orbs.length; i++) {
        const a = t * 0.45 + i * Math.PI;
        orbs[i].position.set(Math.cos(a) * 1.6, Math.sin(t * 0.7 + i * 2) * 0.7 + 0.2, Math.sin(a) * 1.0 - 0.8);
      }
      camera.position.z += (camZ - camera.position.z) * Math.min(1, dt * 8);
      camera.lookAt(0, 0, 0);
    },
    render() {
      ctx.renderer.render(scene, camera);
    },
    setSize(sz: ViewSize) {
      camera.aspect = sz.aspect;
      camera.updateProjectionMatrix();
    },
    pointer(p: PointerInfo) {
      if (p.type === 'move' || p.type === 'down') {
        bulbTarget.set(p.x * 2.2, p.y * 1.2 + 0.3, -1.6);
        bulbActive = 2.0;
      }
      if (p.type === 'tap') {
        index = (index + 1) % PRESETS.length;
        const pr = PRESETS[index];
        mat.color.set(pr.color);
        mat.roughness = pr.roughness;
        mat.transmission = pr.transmission;
        mat.attenuationColor.set(pr.attenuationColor);
        mat.attenuationDistance = pr.attenuationDistance;
        mat.thickness = pr.thickness;
        mat.ior = pr.ior;
        scene.environmentIntensity = pr.envIntensity;
        bulbMat.color.set(pr.lightColor);
        glow.color.set(pr.lightColor);
        label.set(pr.label);
      }
      if (p.type === 'zoom') {
        camZ = THREE.MathUtils.clamp(camZ * Math.exp(p.dz ?? 0), 3.0, 8.5);
      }
    },
  };
}
