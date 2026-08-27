import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** モーフターゲット（ブレンドシェイプ）。3つの形状をポインタ位置でブレンド */

export async function createMorph(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 40);
  scene.add(camera);

  const envData = await ctx.assets.env('studio');
  scene.environment = envData.env;
  scene.environmentIntensity = 1.0;

  // ベース球と 3 つのモーフターゲット（同一頂点数）
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const base = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = base.count;

  const spike = new Float32Array(count * 3);
  const cube = new Float32Array(count * 3);
  const twist = new Float32Array(count * 3);

  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(base, i);
    const n = v.clone().normalize();

    // 1) スパイク: 経緯度のパルスで棘を生やす
    const theta = Math.atan2(n.z, n.x);
    const phi = Math.acos(THREE.MathUtils.clamp(n.y, -1, 1));
    const s =
      Math.pow(Math.max(0, Math.sin(theta * 6) * Math.sin(phi * 5)), 3) * 0.55 +
      Math.pow(Math.max(0, Math.cos(theta * 4 + 1.3) * Math.sin(phi * 7)), 4) * 0.3;
    const sv = n.clone().multiplyScalar(1 + s);
    spike.set([sv.x, sv.y, sv.z], i * 3);

    // 2) キューブ: 立方体へ射影
    const m = Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
    const cv = n.clone().divideScalar(m).multiplyScalar(0.78);
    cube.set([cv.x, cv.y, cv.z], i * 3);

    // 3) ツイスト洋梨: y でねじり + すぼめる
    const tw = v.y * 2.4;
    const cos = Math.cos(tw);
    const sin = Math.sin(tw);
    const pear = 1 - v.y * 0.28;
    const tv = new THREE.Vector3(
      (v.x * cos - v.z * sin) * pear,
      v.y * 1.15,
      (v.x * sin + v.z * cos) * pear,
    );
    twist.set([tv.x, tv.y, tv.z], i * 3);
  }

  const mkNormals = (positions: Float32Array): Float32Array => {
    const g = geo.clone();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const out = new Float32Array((g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array);
    g.dispose();
    return out;
  };

  geo.morphAttributes.position = [
    new THREE.BufferAttribute(spike, 3),
    new THREE.BufferAttribute(cube, 3),
    new THREE.BufferAttribute(twist, 3),
  ];
  geo.morphAttributes.normal = [
    new THREE.BufferAttribute(mkNormals(spike), 3),
    new THREE.BufferAttribute(mkNormals(cube), 3),
    new THREE.BufferAttribute(mkNormals(twist), 3),
  ];
  geo.morphTargetsRelative = false;

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xe8e2d8,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xffd9b8),
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // ブレンド空間の3隅を示すゴースト（小さなアイコン球）
  const cornerMat = new THREE.MeshBasicMaterial({ color: 0x3a4254 });
  const cornerAngles = [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3];

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.3, radius: 4.6, autoRotate: 0.12, minRadius: 2.4, maxRadius: 8 });
  const label = new LabelSprite(camera);
  label.set('動かして形をブレンド');

  let auto = true;
  const pointerDisc = new THREE.Vector2();

  const NAMES = ['スパイク', 'キューブ', 'ツイスト'];

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      mesh.rotation.y = t * 0.2;

      const inf = mesh.morphTargetInfluences!;
      if (auto) {
        // 自動でブレンド空間を巡回
        const a = t * 0.45;
        pointerDisc.set(Math.cos(a) * 0.85, Math.sin(a * 0.77) * 0.85);
      }
      let wsum = 0;
      const ws = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const cx = Math.cos(cornerAngles[i]);
        const cy = Math.sin(cornerAngles[i]);
        const d = Math.hypot(pointerDisc.x - cx, pointerDisc.y - cy);
        ws[i] = Math.max(0, 1 - d / 1.35);
        wsum += ws[i];
      }
      for (let i = 0; i < 3; i++) {
        const goal = wsum > 1 ? ws[i] / wsum : ws[i];
        inf[i] += (goal - inf[i]) * Math.min(1, dt * 8);
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
        auto = false;
        pointerDisc.set(p.x, p.y);
      }
      if (p.type === 'leave') auto = true;
      if (p.type === 'tap') {
        auto = !auto;
        label.set(auto ? '自動ブレンド' : '手動ブレンド（動かして操作）');
      }
    },
    dispose() {
      geo.dispose();
    },
  };
}
