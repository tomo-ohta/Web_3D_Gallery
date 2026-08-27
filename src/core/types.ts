import type * as THREE from 'three';
import type { AssetCache } from './assets';

export type Quality = 'preview' | 'full';

export interface PointerInfo {
  /** イベント種別。tap はドラッグを伴わない短い down→up。zoom はホイール / ピンチ */
  type: 'down' | 'move' | 'up' | 'tap' | 'leave' | 'zoom';
  /** zoom のみ: 正で引き（ズームアウト）、負で寄り（ズームイン） */
  dz?: number;
  /** ビュー内正規化座標 0..1（y は上方向が 1） */
  u: number;
  v: number;
  /** NDC -1..1 */
  x: number;
  y: number;
  /** 前回イベントからの移動量（uv 単位） */
  dx: number;
  dy: number;
  /** ボタン/指が押されているか */
  down: boolean;
}

export interface ViewSize {
  w: number;
  h: number;
  aspect: number;
}

export interface Demo {
  /** シミュレーション更新。レンダーターゲットを使ってよい */
  update(dt: number, t: number): void;
  /** 現在設定済みの viewport/scissor に描画する（renderTarget は null 前提） */
  render(size: ViewSize): void;
  /** アスペクト変更通知（render 前に呼ばれる） */
  setSize(size: ViewSize): void;
  setQuality?(q: Quality): void;
  pointer?(p: PointerInfo): void;
  dispose?(): void;
  /** このデモ描画時の toneMappingExposure（省略時 1.0） */
  exposure?: number;
}

export interface DemoContext {
  renderer: THREE.WebGLRenderer;
  assets: AssetCache;
}

export type DemoCategory =
  | 'マテリアル'
  | 'ライティング'
  | 'シミュレーション'
  | 'プロシージャル'
  | 'アニメーション'
  | 'スタイライズ';

export interface DemoDef {
  id: string;
  title: string;
  subtitle: string;
  category: DemoCategory;
  tech: string[];
  description: string;
  techDetail: string[];
  controls: string[];
  /** 全画面時に表示する操作ヒント */
  hint: string;
  /** 一覧カードに表示する、ドラッグ操作のヒント（タップは拡大に割り当て済み） */
  gridHint: string;
  create(ctx: DemoContext): Promise<Demo>;
}
