import { useCallback, useEffect, useRef, useState } from 'react';
import { audioDebug, pianoSampler } from '../utils/pianoSampler';
import { calculateRMS, pitchYIN, pitchYINConfidence } from '../utils/audioMetrics';
import { foldCentsToOctave } from '../utils/noteUtils';

export interface PitchFrame {
  /** Czas ramki [s], performance.now()/1000. */
  time: number;
  f0: number | null;
  rms: number;
}

export type MicState = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

/** Okno analizy f0: 2048 próbek ≈ 43–46 ms */
const ANALYSIS_WINDOW = 2048;
const MIN_FRAME_INTERVAL_SEC = 0.012;
const LOUD_RMS = 0.012;
const QUIET_RMS = 0.0015;
/** Podtrzymanie dźwięku */
const HOLD_SEC = 0.1;
const HOLD_CENTS = 80;
const HOLD_APERIODICITY = 0.35;
/** Cichy dźwięk (opcja quietTarget) */
const QUIET_TARGET_CENTS = 150;

/** @param holdPitch podtrzymanie wysokości */
export function useMicPitch({ holdPitch = false, quietTarget }: { holdPitch?: boolean; quietTarget?: () => number | null } = {}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Numer bieżącej pętli */
  const loopIdRef = useRef(0);
  const [micState, setMicState] = useState<MicState>('idle');

  const stopLoop = useCallback(() => {
    loopIdRef.current++;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const close = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close();
    if (ctxRef.current) pianoSampler.afterMicClosed();
    ctxRef.current = null;
    analyserRef.current = null;
    setMicState('idle');
  }, [stopLoop]);

  useEffect(() => close, [close]);

  const open = useCallback(async (): Promise<boolean> => {
    if (analyserRef.current && ctxRef.current) {
      if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
      return true;
    }
    setMicState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      ctx.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream;
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      if (ctx.state === 'suspended') await ctx.resume();
      pianoSampler.markMicOpen();
      setMicState('ready');
      return true;
    } catch (err) {
      console.error('Mikrofon niedostępny', err);
      setMicState(err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'error');
      return false;
    }
  }, []);

  const startLoop = useCallback((onFrame: (frame: PitchFrame) => void) => {
    const analyser = analyserRef.current;
    const ctx = ctxRef.current;
    if (!analyser || !ctx) return;
    stopLoop();
    const myLoop = loopIdRef.current;
    const buf = new Float32Array(analyser.fftSize);
    let lastCtxTime = -1;
    let lastF0 = 0;
    let lastF0Time = -Infinity;
    // diagnostyka (tylko tryb deweloperski)
    const diag = { t0: -1, c0: 0, lastLog: 0, f0s: [] as number[] };

    const tick = () => {
      if (myLoop !== loopIdRef.current || !analyserRef.current || !ctxRef.current) return;
      if (ctx.currentTime - lastCtxTime >= MIN_FRAME_INTERVAL_SEC) {
        lastCtxTime = ctx.currentTime;
        analyser.getFloatTimeDomainData(buf);
        const win = buf.subarray(buf.length - ANALYSIS_WINDOW);
        const rms = calculateRMS(win);
        let f0: number | null = null;
        const now = performance.now() / 1000;
        // Głośniejszy dźwięk
        if (!holdPitch) {
          const qt = quietTarget?.() ?? null;
          if (rms >= LOUD_RMS) {
            const est = pitchYIN(win, ctx.sampleRate, 0.15);
            if (est >= 50 && est <= 1100) f0 = est;
          } else if (qt && rms >= QUIET_RMS) {
            const est = pitchYINConfidence(win, ctx.sampleRate, 0.15);
            if (est.clear && est.f0 >= 50 && est.f0 <= 1100
              && Math.abs(foldCentsToOctave(1200 * Math.log2(est.f0 / qt))) <= QUIET_TARGET_CENTS) f0 = est.f0;
          }
        } else if (rms >= QUIET_RMS) {
          const est = pitchYINConfidence(win, ctx.sampleRate, 0.15);
          const inRange = est.f0 >= 50 && est.f0 <= 1100;
          // podtrzymanie
          const continues = inRange && lastF0 > 0 && now - lastF0Time <= HOLD_SEC
            && est.aperiodicity <= HOLD_APERIODICITY && Math.abs(1200 * Math.log2(est.f0 / lastF0)) <= HOLD_CENTS;
          if (inRange && (rms >= LOUD_RMS || est.clear || continues)) f0 = est.f0;
        }
        if (f0 !== null) { lastF0 = f0; lastF0Time = now; }
        if (diag.t0 < 0) { diag.t0 = now; diag.c0 = ctx.currentTime; diag.lastLog = now; }
        if (f0 !== null) diag.f0s.push(f0);
        if (now - diag.lastLog >= 1 && now - diag.t0 <= 12) {
          const sorted = diag.f0s.slice().sort((a, b) => a - b);
          audioDebug('mic clock', {
            sec: Math.round((now - diag.t0) * 10) / 10,
            clockRatio: Math.round(((ctx.currentTime - diag.c0) / (now - diag.t0)) * 10000) / 10000,
            rate: ctx.sampleRate,
            f0med: sorted.length ? Math.round((sorted[sorted.length >> 1] as number) * 10) / 10 : null
          });
          diag.lastLog = now;
          diag.f0s = [];
        }
        onFrame({ time: now, f0, rms });
        if (myLoop !== loopIdRef.current) return; // onFrame zatrzymał pętlę
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  const getAnalyser = useCallback((): AnalyserNode | null => analyserRef.current, []);

  return { micState, open, startLoop, stopLoop, close, getAnalyser };
}