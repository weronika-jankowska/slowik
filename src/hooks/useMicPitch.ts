import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateRMS, pitchYIN } from '../utils/audioMetrics';

export interface PitchFrame {
  /** Czas ramki [s], performance.now()/1000. */
  time: number;
  /** F0 w Hz albo null, gdy nie wykryto dźwięku o określonej wysokości. */
  f0: number | null;
  rms: number;
}

export type MicState = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

/** Okno analizy f0: 2048 próbek ≈ 43–46 ms. Krótsze niż 4096, więc wierniej oddaje wibrato (5–7 Hz). */
const ANALYSIS_WINDOW = 2048;
const MIN_FRAME_INTERVAL_SEC = 0.012;

export function useMicPitch() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [micState, setMicState] = useState<MicState>('idle');

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const close = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close();
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
    const buf = new Float32Array(analyser.fftSize);
    let lastCtxTime = -1;

    const tick = () => {
      if (!analyserRef.current || !ctxRef.current) return;
      if (ctx.currentTime - lastCtxTime >= MIN_FRAME_INTERVAL_SEC) {
        lastCtxTime = ctx.currentTime;
        analyser.getFloatTimeDomainData(buf);
        const win = buf.subarray(buf.length - ANALYSIS_WINDOW);
        const rms = calculateRMS(win);
        let f0: number | null = null;
        if (rms >= 0.012) {
          const est = pitchYIN(win, ctx.sampleRate, 0.15);
          if (est >= 50 && est <= 1100) f0 = est;
        }
        onFrame({ time: performance.now() / 1000, f0, rms });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  return { micState, open, startLoop, stopLoop, close };
}
