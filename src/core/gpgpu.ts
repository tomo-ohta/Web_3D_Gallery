import * as THREE from 'three';

/** フルスクリーン三角形での 1 パス描画ヘルパー */
export class FSQuad {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;

  constructor(public material: THREE.ShaderMaterial) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export interface SimTargetOpts {
  filter?: THREE.MagnificationTextureFilter;
  wrap?: THREE.Wrapping;
  type?: THREE.TextureDataType;
}

export function makeTarget(w: number, h: number, opts: SimTargetOpts = {}): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: opts.type ?? THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: opts.filter ?? THREE.LinearFilter,
    magFilter: opts.filter ?? THREE.LinearFilter,
    wrapS: opts.wrap ?? THREE.ClampToEdgeWrapping,
    wrapT: opts.wrap ?? THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  return t;
}

/** ピンポンバッファ */
export class PingPong {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;

  constructor(public w: number, public h: number, opts: SimTargetOpts = {}) {
    this.a = makeTarget(w, h, opts);
    this.b = makeTarget(w, h, opts);
  }

  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }

  dispose() { this.a.dispose(); this.b.dispose(); }
}

export const PASS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): FSQuad {
  return new FSQuad(
    new THREE.ShaderMaterial({
      vertexShader: PASS_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );
}
