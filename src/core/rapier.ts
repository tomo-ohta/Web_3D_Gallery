import type RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let loader: Promise<Rapier> | null = null;

/** Rapier（WASM 約2MB）を必要になったデモだけが遅延ロードして共有する */
export function loadRapier(): Promise<Rapier> {
  if (!loader) {
    loader = import('@dimforge/rapier3d-compat').then(async (m) => {
      await m.default.init();
      return m.default;
    });
  }
  return loader;
}
