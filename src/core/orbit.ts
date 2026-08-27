import * as THREE from 'three';
import type { PointerInfo } from './types';

/**
 * ドラッグ回転専用のミニオービット。慣性とオートローテーション付き。
 * カードプレビューでも全画面でも同じ操作感になるよう uv 移動量ベースで回す。
 */
export class OrbitDrag {
  theta: number;
  phi: number;
  radius: number;
  target = new THREE.Vector3();
  autoRotate: number;
  minPhi = 0.12;
  maxPhi = Math.PI - 0.35;
  minRadius: number;
  maxRadius: number;
  /** 水平回転の可動域（省略時は無制限） */
  minTheta = -Infinity;
  maxTheta = Infinity;

  private vTheta = 0;
  private vPhi = 0;
  private dragging = false;
  private idleTime = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    opts: {
      theta?: number;
      phi?: number;
      radius?: number;
      autoRotate?: number;
      targetY?: number;
      minRadius?: number;
      maxRadius?: number;
    } = {},
  ) {
    this.theta = opts.theta ?? 0.5;
    this.phi = opts.phi ?? 1.25;
    this.radius = opts.radius ?? 4;
    this.autoRotate = opts.autoRotate ?? 0.07;
    this.target.y = opts.targetY ?? 0;
    this.minRadius = opts.minRadius ?? this.radius * 0.5;
    this.maxRadius = opts.maxRadius ?? this.radius * 2.1;
    this.apply();
  }

  /** ホイール / ピンチによるズーム。dz 正で引き、負で寄り */
  zoom(dz: number) {
    this.radius = THREE.MathUtils.clamp(this.radius * Math.exp(dz), this.minRadius, this.maxRadius);
    this.idleTime = 0;
    this.apply();
  }

  pointer(p: PointerInfo) {
    if (p.type === 'zoom') {
      this.zoom(p.dz ?? 0);
      return;
    }
    if (p.type === 'down') this.dragging = true;
    if (p.type === 'up' || p.type === 'leave') this.dragging = false;
    if (p.type === 'move' && p.down && this.dragging) {
      this.vTheta = -p.dx * 5.2;
      this.vPhi = p.dy * 3.6;
      this.theta += this.vTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi, this.minPhi, this.maxPhi);
      this.idleTime = 0;
    }
  }

  update(dt: number) {
    if (!this.dragging) {
      this.theta += this.vTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi, this.minPhi, this.maxPhi);
      this.vTheta *= Math.pow(0.02, dt * 2.2);
      this.vPhi *= Math.pow(0.02, dt * 2.2);
      this.idleTime += dt;
      if (this.idleTime > 2.5) this.theta += this.autoRotate * dt;
    }
    this.apply();
  }

  private apply() {
    this.theta = THREE.MathUtils.clamp(this.theta, this.minTheta, this.maxTheta);
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }
}
