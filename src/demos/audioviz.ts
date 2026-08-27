import * as THREE from 'three';
import type { Demo, DemoContext, PointerInfo, ViewSize } from '../core/types';
import { purgeScene } from '../core/purge';
import { OrbitDrag } from '../core/orbit';
import { LabelSprite } from '../core/textsprite';

/**
 * 音楽リアクティブ。WebAudio でローファイなループを生成し、
 * FFT スペクトラムでリングとオーブが脈動する。音はタップで開始。
 */

const SCALE = [0, 3, 5, 7, 10]; // マイナーペンタトニック

class MiniSynth {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  master: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  playing = false;
  private noiseBuf: AudioBuffer | null = null;

  private ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    // ノイズバッファ
    const len = this.ctx.sampleRate * 0.1;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    this.ensureCtx();
    if (!this.ctx) return;
    void this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  pause() {
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) void this.ctx.suspend();
  }

  /** 画面外に出たら止め、戻ったら再開するための suspend */
  setSuspended(s: boolean) {
    if (!this.ctx || !this.playing) return;
    if (s && this.ctx.state === 'running') void this.ctx.suspend();
    if (!s && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private schedule() {
    if (!this.ctx || !this.playing) return;
    const SPB = 60 / 88 / 2; // BPM88 の 8 分音符
    while (this.nextTime < this.ctx.currentTime + 0.18) {
      this.playStep(this.step % 16, this.nextTime);
      this.nextTime += SPB;
      this.step++;
    }
  }

  private note(semitone: number, octave: number): number {
    return 110 * Math.pow(2, octave + semitone / 12); // A2 基準
  }

  private playStep(s: number, t: number) {
    const ctx = this.ctx!;
    // キック
    if (s % 4 === 0 || (s === 14 && Math.random() < 0.4)) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      g.gain.setValueAtTime(0.85, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.25);
    }
    // ハット
    if (s % 2 === 1 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 + Math.random() * 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      src.connect(hp).connect(g).connect(this.master!);
      src.start(t);
    }
    // ベース
    if (s % 8 === 0) {
      const seq = [0, 0, 3, 2];
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = this.note(SCALE[seq[(this.step / 8) % 4 | 0] % SCALE.length], -1);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(150, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(f).connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.6);
    }
    // プラック（メロディ）
    if (Math.random() < 0.62 && s % 2 === 0) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const deg = SCALE[(Math.random() * SCALE.length) | 0];
      const oct = Math.random() < 0.3 ? 2 : 1;
      o.frequency.value = this.note(deg, oct);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      const dly = ctx.createDelay(0.6);
      dly.delayTime.value = 0.341;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      o.connect(g);
      g.connect(this.master!);
      g.connect(dly);
      dly.connect(fb);
      fb.connect(dly);
      dly.connect(this.master!);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  dispose() {
    this.pause();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

const BARS = 96;

export async function createAudioViz(ctx: DemoContext): Promise<Demo> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);
  scene.fog = new THREE.Fog(0x0a0a12, 9, 18);
  const camera = new THREE.PerspectiveCamera(44, 16 / 10, 0.1, 40);
  scene.add(camera);

  scene.environment = ctx.assets.roomEnv();
  scene.environmentIntensity = 0.35;

  // 床
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 56),
    new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.3, metalness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  // スペクトラムリング
  const barGeo = new THREE.BoxGeometry(0.09, 1, 0.05);
  barGeo.translate(0, 0.5, 0);
  const barMat = new THREE.MeshBasicMaterial();
  const bars = new THREE.InstancedMesh(barGeo, barMat, BARS);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bars);
  const barColor = new THREE.Color();
  for (let i = 0; i < BARS; i++) {
    barColor.setHSL(0.62 - (i / BARS) * 0.5, 0.85, 0.55);
    bars.setColorAt(i, barColor);
  }

  // 中央オーブ
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 3),
    new THREE.MeshPhysicalMaterial({
      color: 0x8899ff,
      roughness: 0.15,
      metalness: 0.8,
      emissive: 0x2233aa,
      emissiveIntensity: 0.6,
    }),
  );
  orb.position.y = 1.0;
  scene.add(orb);
  const orbLight = new THREE.PointLight(0x7788ff, 6, 10, 1.8);
  orbLight.position.copy(orb.position);
  scene.add(orbLight);

  const synth = new MiniSynth();
  const fft = new Uint8Array(256);
  const barVals = new Float32Array(BARS);
  let lastUpdate = performance.now();
  let bass = 0;
  let bassPrev = 0;
  let kick = 0;

  // 非表示時にオーディオを止める番犬
  const watchdog = window.setInterval(() => {
    synth.setSuspended(performance.now() - lastUpdate > 700);
  }, 400);

  const orbit = new OrbitDrag(camera, { theta: 0.4, phi: 1.15, radius: 6.4, autoRotate: 0.14, targetY: 0.9, minRadius: 3.2, maxRadius: 11 });
  const label = new LabelSprite(camera);
  let hintTimer = 0;

  const m4 = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();

  return {
    exposure: 1.0,
    update(dt, t) {
      lastUpdate = performance.now();
      orbit.update(dt);
      label.update(dt);

      if (synth.playing && synth.analyser) {
        synth.analyser.getByteFrequencyData(fft);
        // 低域エネルギーでキック検出
        let b = 0;
        for (let i = 1; i < 8; i++) b += fft[i];
        b /= 8 * 255;
        kick = Math.max(kick * Math.max(0, 1 - dt * 5), Math.max(0, b - bassPrev) * 6);
        bassPrev = b;
        bass += (b - bass) * Math.min(1, dt * 12);
        for (let i = 0; i < BARS; i++) {
          const bin = 2 + Math.pow(i / BARS, 1.6) * 150;
          const v = fft[bin | 0] / 255;
          barVals[i] += (v - barVals[i]) * Math.min(1, dt * 14);
        }
      } else {
        // 未再生時は静かに波打つプレースホルダー
        for (let i = 0; i < BARS; i++) {
          barVals[i] = 0.12 + Math.sin(t * 1.4 + i * 0.35) * 0.06 + Math.sin(t * 0.7 + i * 0.13) * 0.04;
        }
        bass = 0.1 + Math.sin(t * 1.1) * 0.04;
        kick *= Math.max(0, 1 - dt * 5);
        hintTimer -= dt;
        if (hintTimer <= 0) {
          hintTimer = 3.0;
          label.set('♪ タップで演奏スタート');
        }
      }

      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2;
        const r = 2.3;
        p3.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        q0.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
        const h = 0.08 + barVals[i] * 2.6;
        s3.set(1, h, 1);
        m4.compose(p3, q0, s3);
        bars.setMatrixAt(i, m4);
      }
      bars.instanceMatrix.needsUpdate = true;

      const orbScale = 1 + bass * 0.75 + kick * 0.35;
      orb.scale.setScalar(orbScale);
      orb.rotation.y = t * 0.4;
      orb.rotation.z = Math.sin(t * 0.3) * 0.3;
      (orb.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.4 + bass * 3.2 + kick;
      orbLight.intensity = 3 + bass * 22 + kick * 8;
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
      orbit.pointer(p);
      if (p.type === 'down') {
        // ユーザー操作を契機に AudioContext を起こす
        if (!synth.playing) return;
        synth.setSuspended(false);
      }
      if (p.type === 'tap') {
        if (synth.playing) {
          synth.pause();
          label.set('停止（タップで再開）');
        } else {
          synth.start();
          label.set('▶ 生成ループ再生中');
        }
      }
    },
    dispose() {
      purgeScene(scene);
      clearInterval(watchdog);
      synth.dispose();
      barGeo.dispose();
    },
  };
}
