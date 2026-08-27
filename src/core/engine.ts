import * as THREE from 'three';
import { AssetCache } from './assets';
import type { Demo, DemoDef, PointerInfo, ViewSize } from './types';

export interface Slot {
  def: DemoDef;
  view: HTMLElement;
  demo: Demo | null;
  visible: boolean;
  initState: 'idle' | 'loading' | 'ready' | 'error';
  lastW: number;
  lastH: number;
}

/**
 * 単一の WebGL コンテキストを全カードで共有するレンダリングエンジン。
 * 固定配置のフルスクリーン canvas に対し、各カードの位置へ scissor/viewport を
 * 合わせて描画する（three.js "multiple elements" 方式）。画面外カードは自動停止。
 */
export class Engine {
  renderer: THREE.WebGLRenderer;
  assets: AssetCache;
  slots: Slot[] = [];
  fsSlot: Slot | null = null;

  private clock = { last: 0, t: 0 };
  private io: IntersectionObserver;
  private initQueue: Slot[] = [];
  private initRunning = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private ioSeen = false;
  private ioTrusted = true;
  onFps: ((fps: number) => void) | null = null;
  /** 一覧のカードがタップされたとき（全画面表示を開く用） */
  onCardTap: ((slot: Slot) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.assets = new AssetCache(this.renderer);

    if (import.meta.env.DEV) this.installDebugHooks();
    this.io = new IntersectionObserver(
      (entries) => {
        this.ioSeen = true;
        for (const e of entries) {
          const slot = this.slots.find((s) => s.view === e.target);
          if (!slot) continue;
          slot.visible = e.isIntersecting;
          if (e.isIntersecting) this.requestInit(slot);
        }
      },
      { rootMargin: '400px 0px 400px 0px' },
    );
  }

  private get dpr(): number {
    const max = this.fsSlot ? 2 : 1.5;
    return Math.min(window.devicePixelRatio || 1, max);
  }

  /** 開発時のみ: 非表示タブでも検証できる手動レンダリングフック */
  private installDebugHooks() {
    const dbg = window as unknown as {
      __luminaSlots: Slot[];
      __luminaEngine: Engine;
      __luminaStep: (n?: number) => void;
      __luminaRender: (id: string, w?: number, h?: number, frames?: number) => string;
    };
    dbg.__luminaSlots = this.slots;
    dbg.__luminaEngine = this;
    dbg.__luminaStep = (n = 1) => {
      for (let i = 0; i < n; i++) {
        this.clock.last += 16.7;
        this.frame(this.clock.last + 16.7);
      }
    };
    dbg.__luminaRender = (id, w = 640, h = 400, frames = 1) => {
      const slot = this.slots.find((s) => s.def.id === id);
      if (!slot?.demo) return 'not ready';
      const demo = slot.demo;
      const size = { w: Math.round(w * this.dpr), h: Math.round(h * this.dpr), aspect: w / h };
      demo.setSize(size);
      for (let i = 0; i < frames; i++) {
        this.clock.t += 1 / 60;
        demo.update(1 / 60, this.clock.t);
        this.renderer.setRenderTarget(null);
        this.renderer.toneMappingExposure = demo.exposure ?? 1.0;
        this.renderer.setViewport(0, 0, w, h);
        this.renderer.setScissor(0, 0, w, h);
        this.renderer.setScissorTest(true);
        demo.render(size);
      }
      this.renderer.setScissorTest(false);
      return 'ok';
    };
  }

  register(def: DemoDef, view: HTMLElement): Slot {
    const slot: Slot = { def, view, demo: null, visible: false, initState: 'idle', lastW: 0, lastH: 0 };
    this.slots.push(slot);
    this.io.observe(view);
    this.attachPointer(view, slot, { tapOpensFullscreen: true });
    return slot;
  }

  requestInit(slot: Slot) {
    if (slot.initState !== 'idle') return;
    slot.initState = 'loading';
    this.initQueue.push(slot);
    void this.pumpInit();
  }

  /** 全画面表示などで即座に必要になった場合、初期化を待てる Promise を返す */
  async ensureInit(slot: Slot): Promise<void> {
    this.requestInit(slot);
    while (slot.initState === 'loading') {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  private async pumpInit() {
    if (this.initRunning) return;
    this.initRunning = true;
    while (this.initQueue.length > 0) {
      const slot = this.initQueue.shift()!;
      try {
        const demo = await slot.def.create({ renderer: this.renderer, assets: this.assets });
        slot.demo = demo;
        slot.initState = 'ready';
        slot.view.querySelector('.loading')?.remove();
      } catch (err) {
        console.error(`[LUMINA] demo "${slot.def.id}" の初期化に失敗:`, err);
        slot.initState = 'error';
        const loading = slot.view.querySelector('.loading');
        if (loading) {
          loading.classList.add('failed');
          loading.textContent = 'このデモはこの環境では実行できませんでした';
        }
      }
      // 1 件ごとに少し譲ってカクつきを抑える。
      // 非表示タブでは setTimeout が分単位に絞られるため、
      // throttle されない MessageChannel で即座に次へ進める。
      await new Promise<void>((r) => {
        if (document.hidden) {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => r();
          ch.port2.postMessage(0);
        } else {
          setTimeout(r, 32);
        }
      });
    }
    this.initRunning = false;
  }

  /**
   * すべてのデモを破棄して作り直す（全画面表示から戻ったときの初期化用）。
   * アセットはキャッシュ済みなので再生成は軽い。作成中のものはそのまま待つ。
   */
  resetAllDemos() {
    for (const slot of this.slots) {
      if (slot.initState !== 'ready') continue;
      try {
        slot.demo?.dispose?.();
      } catch (err) {
        console.warn(`[LUMINA] demo "${slot.def.id}" の破棄でエラー:`, err);
      }
      slot.demo = null;
      slot.initState = 'idle';
      slot.lastW = 0;
      slot.lastH = 0;
      if (!slot.view.querySelector('.loading')) {
        const l = document.createElement('div');
        l.className = 'loading';
        l.textContent = 'LOADING';
        slot.view.appendChild(l);
      }
      if (slot.visible || !this.ioTrusted) this.requestInit(slot);
    }
  }

  setFullscreen(slot: Slot | null) {
    const prev = this.fsSlot;
    this.fsSlot = slot;
    if (prev && prev !== slot) prev.demo?.setQuality?.('preview');
    if (slot) slot.demo?.setQuality?.('full');
    this.resize(true);
  }

  start() {
    this.resize(true);
    window.addEventListener('resize', () => this.resize(true));
    this.renderer.setAnimationLoop((now) => this.frame(now));

    // 埋め込み iframe など IntersectionObserver が当てにならない環境向けの保険。
    // 一定時間たっても一度も通知が来なければ、矩形判定だけで可視性を決める。
    setTimeout(() => {
      if (this.ioSeen) return;
      this.ioTrusted = false;
      for (const slot of this.slots) this.requestInit(slot);
    }, 2500);
  }

  private resize(force = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return; // 非表示状態などレイアウト前は保留
    const c = this.renderer.domElement;
    const dpr = this.dpr;
    if (force || c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
  }

  private frame(now: number) {
    this.resize();
    // absolute 配置の canvas をビューポートへ追従させる（スクロール泳ぎ対策）
    this.renderer.domElement.style.transform = `translate(${window.scrollX}px, ${window.scrollY}px)`;
    const dt = Math.min(Math.max((now - this.clock.last) / 1000, 0), 1 / 20);
    this.clock.last = now;
    this.clock.t += dt;
    const t = this.clock.t;

    // FPS 計測
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.onFps?.(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    this.renderer.setRenderTarget(null);
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, false);

    const active: { slot: Slot; rect: DOMRect }[] = [];
    if (this.fsSlot) {
      if (this.fsSlot.demo) {
        active.push({ slot: this.fsSlot, rect: new DOMRect(0, 0, vw, vh) });
      }
    } else {
      for (const slot of this.slots) {
        if (!slot.demo) continue;
        if (this.ioTrusted && !slot.visible) continue;
        const rect = slot.view.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
        if (rect.width < 4 || rect.height < 4) continue;
        active.push({ slot, rect });
      }
    }

    const dpr = this.dpr;
    for (const { slot, rect } of active) {
      const demo = slot.demo!;
      const size: ViewSize = {
        w: Math.round(rect.width * dpr),
        h: Math.round(rect.height * dpr),
        aspect: rect.width / rect.height,
      };
      if (size.w !== slot.lastW || size.h !== slot.lastH) {
        slot.lastW = size.w;
        slot.lastH = size.h;
        demo.setSize(size);
      }

      demo.update(dt, t);

      this.renderer.setRenderTarget(null);
      this.renderer.toneMappingExposure = demo.exposure ?? 1.0;
      const x = rect.left;
      const y = vh - rect.bottom;
      this.renderer.setViewport(x, y, rect.width, rect.height);
      this.renderer.setScissor(x, y, rect.width, rect.height);
      this.renderer.setScissorTest(true);
      demo.render(size);
    }
    this.renderer.setScissorTest(false);
  }

  /** カード / 全画面ビューへのポインタルーティング */
  attachPointer(
    el: HTMLElement,
    slot: Slot | (() => Slot | null),
    opts: { tapOpensFullscreen?: boolean } = {},
  ) {
    const getSlot = typeof slot === 'function' ? slot : () => slot;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    let isDown = false;
    let moved = 0;

    const send = (type: PointerInfo['type'], e: PointerEvent) => {
      const s = getSlot();
      if (!s?.demo?.pointer) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const u = (e.clientX - rect.left) / rect.width;
      const v = 1 - (e.clientY - rect.top) / rect.height;
      const dx = (e.clientX - lastX) / rect.width;
      const dy = -(e.clientY - lastY) / rect.height;
      s.demo.pointer({
        type,
        u, v,
        x: u * 2 - 1,
        y: v * 2 - 1,
        dx: type === 'move' ? dx : 0,
        dy: type === 'move' ? dy : 0,
        down: isDown,
      });
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isDown = true;
      moved = 0;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      downTime = performance.now();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // 一部の環境では捕捉できないことがあるが、操作自体は続行できる
      }
      send('down', e);
    });
    el.addEventListener('pointermove', (e) => {
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      send('move', e);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const up = (e: PointerEvent) => {
      if (!isDown) return;
      isDown = false;
      send('up', e);
      const dist = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
      if (dist >= 8 || moved >= 24 || performance.now() - downTime >= 400) return;
      // 一覧のカードはタップで全画面表示を開く（ドラッグはデモ側の操作のまま）。
      // 全画面ではタップをデモへ渡す。
      if (opts.tapOpensFullscreen && !this.fsSlot) {
        const s = getSlot();
        if (s) this.onCardTap?.(s);
      } else {
        send('tap', e);
      }
    };
    el.addEventListener('pointerup', up);
    // ズーム: ピンチ（ctrlKey 付き wheel）は常に、通常ホイールは全画面時のみ
    // （一覧ではページスクロールと競合するため）
    el.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        const s = getSlot();
        if (!s?.demo?.pointer) return;
        const isPinch = e.ctrlKey;
        if (!isPinch && !this.fsSlot) return;
        e.preventDefault();
        const dz = THREE.MathUtils.clamp(e.deltaY * (isPinch ? 0.012 : 0.002), -0.5, 0.5);
        const rect = el.getBoundingClientRect();
        const u = (e.clientX - rect.left) / Math.max(rect.width, 1);
        const v = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1);
        s.demo.pointer({ type: 'zoom', dz, u, v, x: u * 2 - 1, y: v * 2 - 1, dx: 0, dy: 0, down: isDown });
      },
      { passive: false },
    );
    el.addEventListener('pointercancel', (e) => {
      isDown = false;
      send('leave', e);
    });
    el.addEventListener('pointerleave', (e) => {
      if (!isDown) send('leave', e);
    });
  }
}
