import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

interface Shape {
  label: string;
  geo: THREE.BufferGeometry;
  ior: number;
  dispersion: number;
  thickness: number;
  rotSpeed: number;
}

/** 屈折・分散（色収差）付きの物理ガラス。Transmission + KHR dispersion 相当 */
export async function createGlass(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 16 / 10, 0.1, 60);
  scene.add(camera);

  const [envData, dragonGeo] = await Promise.all([ctx.assets.env('studio'), ctx.assets.dragon()]);
  scene.environment = envData.env;
  scene.background = new THREE.Color(0x0a0d13);

  const prepGeo = (g: THREE.BufferGeometry, size: number) => {
    const geo = g.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const s = size / bb.getSize(new THREE.Vector3()).length();
    geo.translate(-c.x, -c.y, -c.z);
    geo.scale(s, s, s);
    return geo;
  };

  const gem = new THREE.IcosahedronGeometry(1.05, 1);
  gem.computeVertexNormals(); // 非インデックス形状なのでフラットな面法線になる


  const shapes: Shape[] = [
    { label: 'ダイヤモンド（分散 強）', geo: gem, ior: 2.1, dispersion: 0.62, thickness: 1.4, rotSpeed: 0.3 },
    ...(dragonGeo
      ? [{ label: 'ガラスドラゴン', geo: prepGeo(dragonGeo, 3.4), ior: 1.46, dispersion: 0.22, thickness: 1.1, rotSpeed: 0.18 }]
      : []),
    {
      label: 'クリスタルノット',
      geo: new THREE.TorusKnotGeometry(0.78, 0.3, 260, 40),
      ior: 1.52,
      dispersion: 0.35,
      thickness: 1.5,
      rotSpeed: 0.26,
    },
  ];

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.02,
    transmission: 1.0,
    thickness: shapes[0].thickness,
    ior: shapes[0].ior,
    dispersion: shapes[0].dispersion,
    attenuationColor: new THREE.Color(0xeaf5ff),
    attenuationDistance: 4.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    specularIntensity: 1.4,
    envMapIntensity: 1.3,
    side: THREE.FrontSide,
  });

  let shapeIndex = 0;
  const mesh = new THREE.Mesh(shapes[0].geo, mat);
  scene.add(mesh);

  // ガラス越しに屈折して見える色付き光点
  const orbs: THREE.Mesh[] = [];
  const orbColors = [0xff5f8a, 0x66ccff, 0xffd166, 0x9f7bff, 0x5cf2c8];
  for (let i = 0; i < 5; i++) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(orbColors[i]).multiplyScalar(2.2) }),
    );
    scene.add(orb);
    orbs.push(orb);
  }

  // 屈折の面白さを増す発光リング
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.05, 12, 160),
    new THREE.MeshBasicMaterial({ color: 0xe8b45a }),
  );
  ring.rotation.x = Math.PI / 2 - 0.35;
  scene.add(ring);

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.3, radius: 5.4, autoRotate: 0.1, minRadius: 2.4, maxRadius: 10 });
  const label = new LabelSprite(camera);

  return {
    dispose() {
      purgeScene(scene);
    },
    exposure: 1.15,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      mesh.rotation.y = t * shapes[shapeIndex].rotSpeed;
      ring.rotation.z = t * 0.1;
      for (let i = 0; i < orbs.length; i++) {
        const a = t * 0.5 + (i * Math.PI * 2) / orbs.length;
        orbs[i].position.set(Math.cos(a) * 1.45, Math.sin(t * 0.8 + i * 2.1) * 0.9, Math.sin(a) * 1.45);
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
        shapeIndex = (shapeIndex + 1) % shapes.length;
        const sh = shapes[shapeIndex];
        mesh.geometry = sh.geo;
        mat.ior = sh.ior;
        mat.dispersion = sh.dispersion;
        mat.thickness = sh.thickness;
        label.set(sh.label);
      }
    },
  };
}
