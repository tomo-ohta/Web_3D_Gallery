import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import type { EnvName } from '../core/assets';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

interface EnvDef {
  name: EnvName;
  label: string;
  exposure: number;
  bgIntensity: number;
}

const ENVS: EnvDef[] = [
  { name: 'venice', label: 'ヴェネツィアの夕暮れ', exposure: 1.12, bgIntensity: 1.0 },
  { name: 'studio', label: '撮影スタジオ', exposure: 1.0, bgIntensity: 0.9 },
  { name: 'night', label: '星空の夜', exposure: 1.7, bgIntensity: 1.25 },
];

/**
 * 実写系 PBR モデル + IBL のショーケース。
 * DamagedHelmet を HDRI 環境光のみでライティングする。
 */
export async function createStudio(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 60);
  scene.add(camera);

  const [gltf, env0] = await Promise.all([ctx.assets.gltf('helmet'), ctx.assets.env(ENVS[0].name)]);

  const helmet = gltf.scene;
  helmet.position.set(0, 0.06, 0);
  scene.add(helmet);

  scene.environment = env0.env;
  scene.background = env0.bg;
  scene.backgroundIntensity = ENVS[0].bgIntensity;

  const orbit = new OrbitDrag(camera, {
    theta: 0.35,
    phi: 1.35,
    radius: 3.5,
    autoRotate: 0.1,
    targetY: 0.05,
    minRadius: 1.6,
    maxRadius: 7,
  });
  const label = new LabelSprite(camera);

  let envIndex = 0;
  let switching = false;
  let exposureCur = ENVS[0].exposure;
  let exposureTarget = exposureCur;

  const demo: Demo & { exposure: number } = {
    exposure: exposureCur,

    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      helmet.position.y = 0.06 + Math.sin(t * 0.6) * 0.02;
      helmet.rotation.y = Math.sin(t * 0.13) * 0.08;
      exposureCur += (exposureTarget - exposureCur) * Math.min(1, dt * 4.5);
      demo.exposure = exposureCur;
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
      if (p.type === 'tap' && !switching) {
        switching = true;
        const next = (envIndex + 1) % ENVS.length;
        exposureTarget = 0.12; // 一旦暗転
        void ctx.assets.env(ENVS[next].name).then((e) => {
          const apply = () => {
            scene.environment = e.env;
            scene.background = e.bg;
            scene.backgroundIntensity = ENVS[next].bgIntensity;
            envIndex = next;
            exposureTarget = ENVS[next].exposure;
            label.set(ENVS[next].label);
            switching = false;
          };
          // 暗転しきる頃に切替
          setTimeout(apply, 260);
        });
      }
    },
  };

  return demo;
}
