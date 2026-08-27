import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** L-system による樹木の成長アニメーション。タップで別の樹を生やす */

interface Branch {
  start: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  radius: number;
  birth: number; // 0..1 成長順
}
interface Leaf {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  birth: number;
}

interface TreePreset {
  label: string;
  angle: number;
  decay: number;
  iterations: number;
  branches: number; // 分岐数
  leafColor: number;
  leafColor2: number;
  droop: number;
}

const PRESETS: TreePreset[] = [
  { label: '桜', angle: 32, decay: 0.74, iterations: 5, branches: 3, leafColor: 0xffb7cf, leafColor2: 0xff8fb3, droop: 0.06, },
  { label: '楓（紅葉）', angle: 26, decay: 0.78, iterations: 5, branches: 3, leafColor: 0xe86a2a, leafColor2: 0xd94f1e, droop: 0.0 },
  { label: '若木', angle: 22, decay: 0.8, iterations: 5, branches: 2, leafColor: 0x6fbf4a, leafColor2: 0x4a9e35, droop: -0.04 },
];

const MAX_BRANCH = 3200;
const MAX_LEAF = 2600;

export async function createLSystem(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);
  scene.fog = new THREE.Fog(0x101216, 9, 18);
  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 40);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.4;
  const key = new THREE.DirectionalLight(0xffe5c8, 1.9);
  key.position.set(3, 5, 2);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x3c4252, 1.0));

  // 地面
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48),
    new THREE.MeshStandardMaterial({ color: 0x18151a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 枝: 単位シリンダーのインスタンス
  const branchGeo = new THREE.CylinderGeometry(0.75, 1, 1, 5);
  branchGeo.translate(0, 0.5, 0); // 根元原点
  const branchMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.92 });
  const branches = new THREE.InstancedMesh(branchGeo, branchMat, MAX_BRANCH);
  branches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  branches.frustumCulled = false;
  scene.add(branches);

  // 葉: 小さな板ポリ
  const leafCanvas = document.createElement('canvas');
  leafCanvas.width = leafCanvas.height = 64;
  const lctx = leafCanvas.getContext('2d')!;
  lctx.fillStyle = '#fff';
  lctx.beginPath();
  lctx.ellipse(32, 32, 15, 26, 0, 0, Math.PI * 2);
  lctx.fill();
  const leafTex = new THREE.CanvasTexture(leafCanvas);
  const leafGeo = new THREE.PlaneGeometry(0.16, 0.16);
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, MAX_LEAF);
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  leaves.frustumCulled = false;
  scene.add(leaves);

  // 落下する花びら / 葉
  const PETALS = 130;
  const petalArr = new Float32Array(PETALS * 3);
  const petalSeed = new Float32Array(PETALS);
  for (let i = 0; i < PETALS; i++) {
    petalArr[i * 3] = (Math.random() - 0.5) * 5;
    petalArr[i * 3 + 1] = Math.random() * 4;
    petalArr[i * 3 + 2] = (Math.random() - 0.5) * 5;
    petalSeed[i] = Math.random();
  }
  const petalGeo = new THREE.BufferGeometry();
  const petalAttr = new THREE.BufferAttribute(petalArr, 3);
  petalAttr.setUsage(THREE.DynamicDrawUsage);
  petalGeo.setAttribute('position', petalAttr);
  const petalMat = new THREE.PointsMaterial({ size: 0.026, transparent: true, opacity: 0.8, depthWrite: false });
  const petals = new THREE.Points(petalGeo, petalMat);
  scene.add(petals);

  // --- L-system 生成 ---
  let branchList: Branch[] = [];
  let leafList: Leaf[] = [];

  const generate = (preset: TreePreset) => {
    branchList = [];
    leafList = [];
    const deg = Math.PI / 180;
    interface Turtle { pos: THREE.Vector3; quat: THREE.Quaternion; len: number; radius: number; depth: number; }
    const grow = (t: Turtle) => {
      if (t.depth > preset.iterations || branchList.length >= MAX_BRANCH - 4) {
        return;
      }
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(t.quat);
      dir.y -= preset.droop * t.depth;
      dir.normalize();
      const birth = t.depth / (preset.iterations + 1);
      branchList.push({ start: t.pos.clone(), dir, len: t.len, radius: t.radius, birth: birth + Math.random() * 0.05 });
      const tip = t.pos.clone().addScaledVector(dir, t.len);

      if (t.depth >= preset.iterations - 1) {
        // 葉を付ける
        const nLeaf = 3 + ((Math.random() * 3) | 0);
        for (let k = 0; k < nLeaf && leafList.length < MAX_LEAF; k++) {
          const lp = t.pos.clone().addScaledVector(dir, t.len * (0.4 + Math.random() * 0.6));
          lp.x += (Math.random() - 0.5) * 0.14;
          lp.y += (Math.random() - 0.5) * 0.14;
          lp.z += (Math.random() - 0.5) * 0.14;
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
          );
          leafList.push({ pos: lp, quat: q, scale: 0.8 + Math.random() * 0.9, birth: birth + 0.1 + Math.random() * 0.08 });
        }
      }
      if (t.depth === preset.iterations) return;

      const n = t.depth === 0 ? 1 : preset.branches + (Math.random() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const yaw = (k / n) * Math.PI * 2 + Math.random() * 1.2;
        const pitch = (preset.angle + (Math.random() - 0.5) * 14) * deg * (t.depth === 0 ? 0.4 : 1);
        const q = t.quat
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
        grow({
          pos: tip.clone(),
          quat: q,
          len: t.len * (preset.decay + Math.random() * 0.08),
          radius: t.radius * 0.62,
          depth: t.depth + 1,
        });
      }
      // 幹の続き
      if (t.depth < 2 && Math.random() < 0.9) {
        const q = t.quat
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 0.3));
        grow({ pos: tip.clone(), quat: q, len: t.len * 0.82, radius: t.radius * 0.7, depth: t.depth + 1 });
      }
    };
    grow({
      pos: new THREE.Vector3(0, 0, 0),
      quat: new THREE.Quaternion(),
      len: 1.05,
      radius: 0.09,
      depth: 0,
    });
  };

  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const s3 = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  let progress = 0;
  let presetIndex = 0;
  const leafColor = new THREE.Color();

  const applyLeafColors = (preset: TreePreset) => {
    for (let i = 0; i < leafList.length; i++) {
      leafColor.set(Math.random() < 0.5 ? preset.leafColor : preset.leafColor2);
      leaves.setColorAt(i, leafColor);
    }
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    petalMat.color.set(preset.leafColor);
  };

  const rebuild = () => {
    const preset = PRESETS[presetIndex];
    generate(preset);
    applyLeafColors(preset);
    progress = 0;
  };
  rebuild();

  const updateInstances = () => {
    for (let i = 0; i < MAX_BRANCH; i++) {
      if (i < branchList.length) {
        const b = branchList[i];
        const g = THREE.MathUtils.clamp((progress - b.birth) * 5.5, 0, 1);
        const e = 1 - Math.pow(1 - g, 2);
        if (e <= 0.001) {
          branches.setMatrixAt(i, zero);
          continue;
        }
        q4.setFromUnitVectors(UP, b.dir);
        s3.set(b.radius * (0.5 + e * 0.5), b.len * e, b.radius * (0.5 + e * 0.5));
        m4.compose(b.start, q4, s3);
        branches.setMatrixAt(i, m4);
      } else {
        branches.setMatrixAt(i, zero);
      }
    }
    branches.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_LEAF; i++) {
      if (i < leafList.length) {
        const l = leafList[i];
        const g = THREE.MathUtils.clamp((progress - l.birth) * 6, 0, 1);
        const e = g < 0.6 ? (g / 0.6) * 1.18 : 1.18 - ((g - 0.6) / 0.4) * 0.18; // ぽんっと膨らむ
        if (g <= 0.001) {
          leaves.setMatrixAt(i, zero);
          continue;
        }
        s3.setScalar(l.scale * e);
        m4.compose(l.pos, l.quat, s3);
        leaves.setMatrixAt(i, m4);
      } else {
        leaves.setMatrixAt(i, zero);
      }
    }
    leaves.instanceMatrix.needsUpdate = true;
  };

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.3, radius: 5.6, autoRotate: 0.08, targetY: 1.4, minRadius: 2.8, maxRadius: 10 });
  const label = new LabelSprite(camera);
  label.set(PRESETS[0].label);
  let growing = true;

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      if (progress < 1.35) {
        progress += dt / 3.6;
        growing = true;
      } else {
        growing = false;
      }
      if (growing || progress < 1.45) updateInstances();

      // 花びら / 落ち葉
      if (progress > 0.8) {
        const sdt = Math.min(dt, 1 / 30);
        for (let i = 0; i < PETALS; i++) {
          const i3 = i * 3;
          petalArr[i3] += (Math.sin(t * 1.2 + petalSeed[i] * 40) * 0.3 + 0.22) * sdt;
          petalArr[i3 + 1] -= (0.25 + petalSeed[i] * 0.3) * sdt;
          petalArr[i3 + 2] += Math.cos(t * 0.9 + petalSeed[i] * 60) * 0.25 * sdt;
          if (petalArr[i3 + 1] < 0.02) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.4 + Math.random() * 1.6;
            petalArr[i3] = Math.cos(a) * r;
            petalArr[i3 + 1] = 1.6 + Math.random() * 1.8;
            petalArr[i3 + 2] = Math.sin(a) * r;
          }
        }
        petalAttr.needsUpdate = true;
        petals.visible = true;
      } else {
        petals.visible = false;
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
        presetIndex = (presetIndex + 1) % PRESETS.length;
        rebuild();
        label.set(PRESETS[presetIndex].label);
      }
    },
    dispose() {
      branchGeo.dispose();
      leafGeo.dispose();
    },
  };
}
