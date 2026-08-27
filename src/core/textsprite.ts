import * as THREE from 'three';

/** カメラに追従する小さなラベルスプライト（プリセット名表示用） */
export class LabelSprite {
  sprite: THREE.Sprite;
  private texture: THREE.CanvasTexture | null = null;
  private fade = 0;

  constructor(camera: THREE.Camera, offset = new THREE.Vector3(0, -0.62, -2.2)) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.sprite.position.copy(offset);
    this.sprite.renderOrder = 999;
    camera.add(this.sprite);
  }

  set(text: string) {
    const c = document.createElement('canvas');
    const scale = 2;
    const ctx = c.getContext('2d')!;
    ctx.font = `600 ${26 * scale}px "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 56 * scale;
    const h = 52 * scale;
    c.width = w;
    c.height = h;
    ctx.font = `600 ${26 * scale}px "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, r);
    ctx.fillStyle = 'rgba(8, 11, 17, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 192, 122, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f2ead6';
    ctx.fillText(text, w / 2, h / 2 + 2);

    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = this.sprite.material;
    mat.map = this.texture;
    mat.needsUpdate = true;
    const aspect = w / h;
    const height = 0.13;
    this.sprite.scale.set(height * aspect, height, 1);
    this.fade = 3.2; // 表示時間
  }

  update(dt: number) {
    this.fade -= dt;
    const target = this.fade > 0 ? 0.96 : 0;
    const mat = this.sprite.material;
    mat.opacity += (target - mat.opacity) * Math.min(1, dt * 10);
  }
}
