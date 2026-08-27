import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/** 雨のネオン街。平面リフレクションを水たまりマスクで濡れた路面に合成する */

const STREET_SHADER = {
  name: 'WetStreetReflector',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uTime: { value: 0 },
    uRain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vUvProj = textureMatrix * w;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uRain;
    varying vec4 vUvProj;
    varying vec3 vWorld;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
        mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x),
        f.y);
    }
    float fbm2(vec2 p) {
      return vnoise2(p) * 0.6 + vnoise2(p * 2.3 + 7.7) * 0.28 + vnoise2(p * 5.1 + 31.0) * 0.12;
    }
    // 雨粒の波紋（セルごとにリングが広がる）
    vec2 ripple(vec2 p) {
      vec2 total = vec2(0.0);
      for (int k = 0; k < 2; k++) {
        vec2 sp = p * (1.4 + float(k) * 0.9) + float(k) * 17.0;
        vec2 id = floor(sp);
        vec2 f = fract(sp) - 0.5;
        float rnd = hash12(id);
        float ph = fract(uTime * (0.5 + rnd * 0.4) + rnd * 7.0);
        float d = length(f - (vec2(hash12(id + 3.1), hash12(id + 5.7)) - 0.5) * 0.5);
        float ring = sin((d - ph * 0.55) * 42.0) * exp(-d * 5.0) * exp(-ph * 3.4) * step(0.03, ph);
        total += normalize(f + 1e-4) * ring;
      }
      return total;
    }

    void main() {
      // 水たまりマスク
      float pud = smoothstep(0.46, 0.62, fbm2(vWorld.xz * 0.42 + 3.7));
      // アスファルト
      float asp = fbm2(vWorld.xz * 4.0);
      vec3 asphalt = vec3(0.045, 0.048, 0.058) * (0.7 + asp * 0.6);
      // センターライン
      float lane = step(abs(vWorld.x), 0.09) * step(fract(vWorld.z * 0.24), 0.55);
      asphalt += vec3(0.35, 0.28, 0.08) * lane * (0.3 + asp * 0.3);

      // 波紋 + 表面の揺らぎで反射をひずませる
      vec2 distort = ripple(vWorld.xz) * 0.05 * uRain;
      distort += (vec2(fbm2(vWorld.xz * 2.0 + uTime * 0.12), fbm2(vWorld.zx * 2.0 - uTime * 0.1)) - 0.5) * 0.02;
      vec4 proj = vUvProj;
      proj.xy += distort * proj.w;
      vec3 refl = texture2DProj(tDiffuse, proj).rgb;

      // 濡れたアスファルトはうっすら、 水たまりはくっきり映す
      vec3 wet = asphalt * 0.55 + refl * 0.18;
      vec3 puddle = refl * 0.92 + vec3(0.01, 0.012, 0.02);
      vec3 col = mix(wet, puddle, pud);

      col = pow(col, vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

interface NeonPalette {
  label: string;
  colors: number[];
}
const PALETTES: NeonPalette[] = [
  { label: 'シアン & マゼンタ', colors: [0x22e6ff, 0xff3fa4, 0x8f6bff, 0x2bff9e] },
  { label: '琥珀 & 紅', colors: [0xffb52e, 0xff4747, 0xffe28a, 0xff7a2e] },
  { label: '翡翠 & 青', colors: [0x2bffb0, 0x2ba9ff, 0xa4ff5f, 0x6bd0ff] },
];

export async function createWetStreet(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.Fog(0x05060c, 10, 30);
  const camera = new THREE.PerspectiveCamera(44, 16 / 10, 0.1, 60);
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0x1a2033, 1.2));

  // 路面（Reflector 拡張）
  const street = new Reflector(new THREE.PlaneGeometry(26, 34), {
    textureWidth: 768,
    textureHeight: 768,
    clipBias: 0.003,
    shader: STREET_SHADER,
  });
  street.rotation.x = -Math.PI / 2;
  scene.add(street);
  const streetUniforms = (street.material as THREE.ShaderMaterial).uniforms;

  // ビル群（窓明かり付き）
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 64;
  winCanvas.height = 128;
  const wctx = winCanvas.getContext('2d')!;
  wctx.fillStyle = '#0a0c14';
  wctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) {
    for (let x = 4; x < 60; x += 10) {
      if (Math.random() < 0.42) {
        wctx.fillStyle = Math.random() < 0.7 ? 'rgba(255,214,140,0.9)' : 'rgba(150,200,255,0.8)';
        wctx.fillRect(x, y, 6, 6);
      }
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.colorSpace = THREE.SRGBColorSpace;
  const buildingMat = new THREE.MeshBasicMaterial({ map: winTex });
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 7; i++) {
      const h = 4 + Math.random() * 6;
      const w = 2.2 + Math.random() * 1.4;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.4), buildingMat);
      b.position.set(side * (3.6 + Math.random() * 1.2), h / 2, 10 - i * 4.4);
      scene.add(b);
    }
  }

  // ネオンサイン
  const neonTexts = ['ラーメン', 'BAR', '雨', 'ホテル', 'カラオケ', '24H'];
  const neonMeshes: { mesh: THREE.Mesh; sprite: THREE.Sprite; light: THREE.PointLight | null; idx: number }[] = [];
  const makeNeonTexture = (text: string, colorCss: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const cc = c.getContext('2d')!;
    cc.clearRect(0, 0, 256, 96);
    cc.font = 'bold 52px "Hiragino Kaku Gothic ProN", sans-serif';
    cc.textAlign = 'center';
    cc.textBaseline = 'middle';
    cc.shadowColor = colorCss;
    cc.shadowBlur = 18;
    cc.strokeStyle = colorCss;
    cc.lineWidth = 3;
    cc.strokeText(text, 128, 48);
    cc.fillStyle = '#ffffff';
    cc.fillText(text, 128, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const glc = glowCanvas.getContext('2d')!;
  const gg = glc.createRadialGradient(64, 64, 4, 64, 64, 64);
  gg.addColorStop(0, 'rgba(255,255,255,0.55)');
  gg.addColorStop(1, 'rgba(255,255,255,0)');
  glc.fillStyle = gg;
  glc.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(glowCanvas);

  for (let i = 0; i < neonTexts.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = 7 - i * 3.4;
    const y = 1.6 + (i % 3) * 1.5;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.9),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    );
    mesh.position.set(side * 2.6, y, z);
    mesh.rotation.y = (-side * Math.PI) / 2 + side * 0.62;
    scene.add(mesh);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }),
    );
    sprite.scale.setScalar(2.6);
    sprite.position.copy(mesh.position);
    scene.add(sprite);
    let light: THREE.PointLight | null = null;
    if (i < 3) {
      light = new THREE.PointLight(0xffffff, 5, 9, 1.6);
      light.position.copy(mesh.position).add(new THREE.Vector3(-side * 0.5, 0, 0));
      scene.add(light);
    }
    neonMeshes.push({ mesh, sprite, light, idx: i });
  }

  const applyPalette = (pi: number) => {
    const pal = PALETTES[pi];
    for (const n of neonMeshes) {
      const col = new THREE.Color(pal.colors[n.idx % pal.colors.length]);
      const css = `#${col.getHexString()}`;
      const mat = n.mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = makeNeonTexture(neonTexts[n.idx], css);
      mat.needsUpdate = true;
      (n.sprite.material as THREE.SpriteMaterial).color.set(col);
      if (n.light) n.light.color.set(col);
    }
  };
  applyPalette(0);

  // 雨（線分）
  const RAIN = 420;
  const rainArr = new Float32Array(RAIN * 6);
  const rainSpeed = new Float32Array(RAIN);
  const resetDrop = (i: number) => {
    const x = (Math.random() - 0.5) * 16;
    const y = 4 + Math.random() * 6;
    const z = 10 - Math.random() * 24;
    rainArr[i * 6] = x;
    rainArr[i * 6 + 1] = y;
    rainArr[i * 6 + 2] = z;
    rainArr[i * 6 + 3] = x + 0.04;
    rainArr[i * 6 + 4] = y - 0.5;
    rainArr[i * 6 + 5] = z;
    rainSpeed[i] = 9 + Math.random() * 5;
  };
  for (let i = 0; i < RAIN; i++) resetDrop(i);
  const rainGeo = new THREE.BufferGeometry();
  const rainAttr = new THREE.BufferAttribute(rainArr, 3);
  rainAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute('position', rainAttr);
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.35 }),
  );
  scene.add(rain);

  const orbit = new OrbitDrag(camera, { theta: Math.PI, phi: 1.35, radius: 8.5, autoRotate: 0.03, targetY: 1.4, minRadius: 4.5, maxRadius: 13 });
  orbit.minPhi = 1.1;
  orbit.maxPhi = 1.52;
  // 通りの奥を見る範囲に制限（ビルの中へ入らないように）
  orbit.minTheta = Math.PI - 0.42;
  orbit.maxTheta = Math.PI + 0.42;
  orbit.autoRotate = 0; // 可動域が狭いので自動回転は無し
  const label = new LabelSprite(camera);
  let paletteIndex = 0;

  return {
    exposure: 1.0,
    update(dt, t) {
      orbit.update(dt);
      label.update(dt);
      streetUniforms.uTime.value = t;

      const sdt = Math.min(dt, 1 / 30);
      for (let i = 0; i < RAIN; i++) {
        const dy = rainSpeed[i] * sdt;
        rainArr[i * 6 + 1] -= dy;
        rainArr[i * 6 + 4] -= dy;
        if (rainArr[i * 6 + 1] < 0) resetDrop(i);
      }
      rainAttr.needsUpdate = true;

      // ネオンのちらつき
      for (const n of neonMeshes) {
        const flick = Math.random() < 0.02 ? 0.4 : 1.0;
        (n.mesh.material as THREE.MeshBasicMaterial).opacity = 0.92 * flick;
        (n.sprite.material as THREE.SpriteMaterial).opacity = 0.5 * flick;
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
        paletteIndex = (paletteIndex + 1) % PALETTES.length;
        applyPalette(paletteIndex);
        label.set(`ネオン: ${PALETTES[paletteIndex].label}`);
      }
    },
    dispose() {
      purgeScene(scene);
      street.dispose();
      rainGeo.dispose();
    },
  };
}
