import * as THREE from 'three';

/**
 * シーン内の GPU リソース（ジオメトリ・マテリアル・スケルトン）をまとめて解放する。
 * テクスチャは AssetCache と共有されている可能性があるため触らない。
 * three.js は解放済みリソースが再利用されると自動で再アップロードするので、
 * 共有ジオメトリ／マテリアルを解放しても壊れない。
 */
export function purgeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const any = o as THREE.Mesh & {
      isInstancedMesh?: boolean;
      skeleton?: { dispose?: () => void };
      dispose?: () => void;
    };
    const drawable =
      (o as THREE.Mesh).isMesh ||
      (o as unknown as THREE.Points).isPoints ||
      (o as unknown as THREE.Line).isLine ||
      (o as unknown as THREE.Sprite).isSprite;
    if (drawable) {
      (any.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
      const mat = any.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
    if (any.isInstancedMesh) any.dispose?.();
    any.skeleton?.dispose?.();
  });
}
