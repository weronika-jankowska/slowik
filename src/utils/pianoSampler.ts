
import { makeSustained, type SustainedSample } from './sustain';
import { makeImpulseResponse } from './reverb';

/** Diagnostyka dźwięku (tylko w trybie deweloperskim) */
export function audioDebug(msg: string, data: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), msg, ua: navigator.userAgent.slice(0, 120), ...data });
    void fetch('/__log', { method: 'POST', body: line, keepalive: true }).catch(() => undefined);
  } catch { /* diagnostyka nie może psuć aplikacji */ }
}

/** Plik próbki pianina (grand-piano: p21 = A0 … p108 = C8, wyrównana głośność) */
export function sampleFilename(midi: number): string {
  return `p${Math.max(21, Math.min(108, Math.round(midi)))}_v79.mp3`;
}

/** Nazwa pliku jak w VoiceAnalysis */
export function sampleUrl(midi: number): string {
  return `/grand-piano/${sampleFilename(midi)}`;
}

// WYŁĄCZONE
const USE_STREAM_SINK = false;

/** Folder z próbkami do zwykłego odtwarzacza <audio> */
export function referenceSampleFolder(micOpen: boolean): string {
  return micOpen ? '/grand-piano-loud' : '/grand-piano';
}

/** Głośność pogłosu względem dźwięku bezpośredniego. */
const REVERB_WET = 0.5;

/** Czas wygaszania końca nuty [s]. */
const RELEASE_SEC = 0.12;

/** Wzmocnienie całego pianina */
const MASTER_GAIN = 2; // +6 dB
const MASTER_GAIN_MIC = 5; // +14 dB

class PianoSampler {
  private ctx: AudioContext | null = null;
  private buffers = new Map<number, Promise<AudioBuffer | null>>();
  private sustained = new Map<number, { ctx: AudioContext; s: SustainedSample | null }>();
  private active = new Set<AudioBufferSourceNode>();
  private master: GainNode | null = null;
  private masterCtx: AudioContext | null = null;
  private micOpen = false;
  /** Safari */
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private streamCtx: AudioContext | null = null;
  private sink: HTMLAudioElement | null = null;

  /** Wejście pogłosu (konwolucja) */
  private reverbIn: GainNode | null = null;
  private reverbCtx: AudioContext | null = null;

  private reverb(): GainNode {
    const ctx = this.context();
    if (!this.reverbIn || this.reverbCtx !== ctx) {
      const input = ctx.createGain();
      input.gain.value = REVERB_WET;
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = makeImpulseResponse(ctx);
      input.connect(conv).connect(this.output());
      this.reverbIn = input;
      this.reverbCtx = ctx;
    }
    return this.reverbIn;
  }

  /** Węzeł, do którego trafia całe odtwarzanie */
  private sinkNode(ctx: AudioContext): AudioNode {
    if (!USE_STREAM_SINK) return ctx.destination;
    if (!this.streamDest || this.streamCtx !== ctx) {
      this.streamDest = ctx.createMediaStreamDestination();
      this.streamCtx = ctx;
      if (!this.sink) {
        this.sink = new Audio();
        this.sink.setAttribute('playsinline', '');
        this.sink.autoplay = true;
      }
      this.sink.srcObject = this.streamDest.stream;
      audioDebug('stream sink connected', { state: ctx.state });
    }
    return this.streamDest;
  }

  private startSink(): void {
    if (!USE_STREAM_SINK) return;
    this.sinkNode(this.context());
    const el = this.sink;
    if (el && el.paused) {
      void el.play().then(() => audioDebug('stream sink playing')).catch((e) => audioDebug('stream sink play failed', { err: String(e) }));
    }
  }

  /** Wspólne wyjście pianina */
  private output(): GainNode {
    const ctx = this.context();
    if (!this.master || this.masterCtx !== ctx) {
      const g = ctx.createGain();
      g.gain.value = this.micOpen ? MASTER_GAIN_MIC : MASTER_GAIN;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      g.connect(lim).connect(this.sinkNode(ctx));
      this.master = g;
      this.masterCtx = ctx;
    }
    return this.master;
  }

  private setMasterGain(): void {
    if (!this.master || !this.masterCtx) return;
    this.master.gain.setTargetAtTime(this.micOpen ? MASTER_GAIN_MIC : MASTER_GAIN, this.masterCtx.currentTime, 0.05);
  }

  isMicOpen(): boolean {
    return this.micOpen;
  }

  /** Mikrofon włączony: tylko głośniejsze pianino */
  markMicOpen(): void {
    this.micOpen = true;
    this.setMasterGain();
  }

  /** Mikrofon zamknięty: wraca zwykła głośność pianina. */
  afterMicClosed(): void {
    this.micOpen = false;
    this.setMasterGain();
  }

  context(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      audioDebug('playback ctx created', { state: ctx.state, sampleRate: ctx.sampleRate });
      ctx.onstatechange = () => audioDebug('playback ctx state', { state: ctx.state, sampleRate: ctx.sampleRate });
    }
    return this.ctx;
  }

  /** Po włączeniu mikrofonu */
  afterMicOpened(micCtx: AudioContext): void {
    const ctx = this.ctx;
    audioDebug('mic opened', { micState: micCtx.state, micRate: micCtx.sampleRate, playState: ctx?.state ?? 'none', playRate: ctx?.sampleRate ?? 0 });
    this.micOpen = true;
    this.setMasterGain();
    if (ctx && (ctx.state !== 'running' || ctx.sampleRate !== micCtx.sampleRate)) {
      this.stopAll();
      void ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.wake();
  }

  unlock(): void {
    const ctx = this.context();
    this.startSink();
    if (ctx.state === 'running') return;
    audioDebug('unlock', { state: ctx.state });
    void ctx.resume().then(() => audioDebug('unlock resumed', { state: ctx.state })).catch((e) => audioDebug('unlock resume failed', { err: String(e) }));
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(this.sinkNode(ctx));
      src.start(0);
    } catch { /* nic – kolejna próba przy następnym kliknięciu */ }
  }

  unlockIfCreated(): void {
    if (this.ctx && this.ctx.state !== 'closed') this.unlock();
  }

  private wake(): void {
    const ctx = this.context();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    this.startSink();
  }

  private loadOne(midi: number): Promise<AudioBuffer | null> {
    let p = this.buffers.get(midi);
    if (!p) {
      p = fetch(sampleUrl(midi))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => this.context().decodeAudioData(data))
        .catch((e) => {
          console.warn(`Nie można wczytać próbki ${sampleUrl(midi)}:`, e);
          audioDebug('sample load failed', { url: sampleUrl(midi), err: String(e) });
          this.buffers.delete(midi); // pozwól spróbować ponownie przy następnym starcie
          return null;
        });
      this.buffers.set(midi, p);
    }
    return p;
  }

  /** Wczytuje wszystkie potrzebne próbki */
  async load(midis: number[]): Promise<boolean> {
    this.wake();
    const results = await Promise.all([...new Set(midis)].map((m) => this.loadOne(m)));
    const ok = results.every((b) => b !== null);
    audioDebug('load', { n: results.length, ok, state: this.context().state });
    return ok;
  }

  /** Bieżący czas zegara audio [s]. */
  now(): number {
    return this.context().currentTime;
  }

  /** Opóźnienie wyjścia audio [s] */
  outputLatency(): number {
    const ctx = this.context() as AudioContext & { outputLatency?: number };
    const l = ctx.outputLatency ?? ctx.baseLatency ?? 0;
    return Number.isFinite(l) ? l : 0;
  }

  /** Planuje nutę */
  async play(midi: number, when: number, duration: number, gain = 0.85, opts: { sustain?: boolean; reverb?: boolean } = {}): Promise<(() => void) | null> {
    const buffer = await this.loadOne(midi);
    if (!buffer) return null;
    this.wake();
    const ctx = this.context();
    // przedłużenie
    let sustained: SustainedSample | null = null;
    if (opts.sustain && duration > buffer.duration - 0.5) {
      try {
        let entry = this.sustained.get(midi);
        if (!entry || entry.ctx !== ctx) {
          entry = { ctx, s: makeSustained(ctx, buffer, 440 * 2 ** ((midi - 69) / 12)) };
          this.sustained.set(midi, entry);
        }
        sustained = entry.s;
      } catch (e) {
        // przedłużenie się nie udało
        audioDebug('sustain failed', { midi, err: String(e) });
      }
    }
    const src = ctx.createBufferSource();
    if (sustained) {
      src.buffer = sustained.buffer;
      src.loop = true;
      src.loopStart = sustained.loopStart;
      src.loopEnd = sustained.loopEnd;
    } else src.buffer = buffer;
    const g = ctx.createGain();
    const start = Math.max(when, ctx.currentTime);
    const end = start + Math.max(0.05, duration);
    g.gain.setValueAtTime(gain, start);
    g.gain.setValueAtTime(gain, end);
    g.gain.linearRampToValueAtTime(0, end + RELEASE_SEC);
    src.connect(g).connect(this.output());
    if (opts.reverb) g.connect(this.reverb());
    src.start(start);
    audioDebug('play', { midi, state: ctx.state, now: Number(ctx.currentTime.toFixed(3)), start: Number(start.toFixed(3)), rate: ctx.sampleRate, bufRate: buffer.sampleRate });
    src.stop(end + RELEASE_SEC + 0.02);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
    // zatrzymanie tej jednej nuty (krótkie wygaszenie)
    return () => {
      const t = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.02);
        src.stop(t + 0.1);
      } catch { /* już zatrzymana */ }
    };
  }

  /** Zatrzymuje wszystkie zaplanowane i grające nuty. */
  stopAll(): void {
    for (const src of this.active) {
      try { src.stop(); } catch { /* już zatrzymana */ }
    }
    this.active.clear();
  }
}

export const pianoSampler = new PianoSampler();

export function installAudioUnlock(): void {
  // tylko wznawia już istniejący kontekst
  const unlock = () => pianoSampler.unlockIfCreated();
  for (const type of ['pointerdown', 'touchend', 'keydown', 'click'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}
