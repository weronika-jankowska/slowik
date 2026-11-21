// Wspólny przebieg nagrania w ćwiczeniach

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicPitch, type PitchFrame } from './useMicPitch';
import { centsBetween, foldCentsToOctave, playReferenceNote, type ReferencePlayback } from '../utils/noteUtils';
import type { AttemptData } from '../utils/vibratoExercise';

export type TakePhase = 'idle' | 'countdown' | 'recording' | 'done';

export interface TakeFrame {
  /** Czas od początku nagrania (pierwszego dźwięku) [s]. */
  t: number;
  f0: number | null;
  rms: number;
}

export interface TakeRunOptions {
  /** Maksymalna długość nagrania [s]. */
  maxSec: number;
  /** Dźwięk wzorcowy grany przed odliczaniem (null – bez dźwięku) */
  referenceMidi?: number | null;
  /** Odliczanie 3-2-1 (domyślnie tak). */
  countdown?: boolean;
  /** Częstotliwość docelowa */
  targetHz?: number;
  /** Od czego liczyć początek: 'voice' */
  startOn?: 'voice' | 'sound';
  endOnSilenceSec?: number;
  minSoundSec?: number;
  onFrame?: (f: TakeFrame, analyser: AnalyserNode | null) => void;
  plotSmoothSec?: number;
  quietNearTarget?: boolean;
  onDone: (frames: TakeFrame[], plot: AttemptData) => void;
}

/** Czas na pomiar tła przed sykiem [s] (tryb 'sound'). */
const NOISE_CALIBRATION_SEC = 0.8;

const MIN_SMOOTH_FRAMES = 3;
const SMOOTH_HOLD_SEC = 0.45;
/** Stała czasowa dociągania linii do mediany [s]. */
const SMOOTH_TAU_SEC = 0.08;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function useTake() {
  const mic = useMicPitch({ quietTarget: () => (optsRef.current?.quietNearTarget && optsRef.current.targetHz) || null });
  const [phase, setPhase] = useState<TakePhase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [live, setLive] = useState<{ f0: number | null; cents: number; rms: number; sounding: boolean } | null>(null);

  const framesRef = useRef<TakeFrame[]>([]);
  const plotRef = useRef<AttemptData>({ t: [], cents: [], hz: [] });
  const optsRef = useRef<TakeRunOptions | null>(null);
  const runIdRef = useRef(0);
  const finishedRef = useRef(true);
  const startedRef = useRef(false);
  const streakRef = useRef(0);
  const startTimeRef = useRef(0);
  const firstSoundRef = useRef<number | null>(null);
  const lastSoundRef = useRef(0);
  const lastUiRef = useRef(0);
  const loopStartRef = useRef(0);
  const noiseRef = useRef<number[]>([]);
  const soundThresholdRef = useRef(0.01);
  const playbackRef = useRef<ReferencePlayback | null>(null);
  const smoothRef = useRef<{ t: number; c: number }[]>([]);
  const smoothOutRef = useRef<{ t: number; c: number }>({ t: -1, c: NaN });

  useEffect(() => () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();
    setLive(null);
    setPhase('done');
    optsRef.current?.onDone(framesRef.current, plotRef.current);
  }, [mic]);

  const isSound = (f: PitchFrame, mode: 'voice' | 'sound') => (mode === 'voice' ? f.f0 !== null : f.rms >= soundThresholdRef.current);

  const onFrame = (f: PitchFrame) => {
    const o = optsRef.current;
    if (finishedRef.current || !o) return;
    const mode = o.startOn ?? 'voice';

    if (!startedRef.current) {
      if (mode === 'sound') {
        if (f.time - loopStartRef.current < NOISE_CALIBRATION_SEC) { noiseRef.current.push(f.rms); return; }
        if (noiseRef.current.length) {
          const sorted = noiseRef.current.slice().sort((a, b) => a - b);
          const floor = sorted[Math.floor(sorted.length * 0.8)] ?? 0.002;
          soundThresholdRef.current = Math.max(0.006, floor * 4);
          noiseRef.current = [];
        }
      }
      streakRef.current = isSound(f, mode) ? streakRef.current + 1 : 0;
      if (streakRef.current < 3) {
        if (f.time - lastUiRef.current > 0.1) { lastUiRef.current = f.time; setLive({ f0: null, cents: NaN, rms: f.rms, sounding: false }); }
        return;
      }
      startedRef.current = true;
      startTimeRef.current = f.time;
      firstSoundRef.current = 0;
      setStarted(true);
    }

    const t = f.time - startTimeRef.current;
    const frame: TakeFrame = { t, f0: f.f0, rms: f.rms };
    framesRef.current.push(frame);
    let cents = f.f0 !== null && o.targetHz ? foldCentsToOctave(centsBetween(f.f0, o.targetHz)) : NaN;
    if (o.plotSmoothSec) {
      const buf = smoothRef.current;
      if (Number.isFinite(cents)) buf.push({ t, c: cents });
      while (buf.length && t - (buf[0] as { t: number }).t > o.plotSmoothSec) buf.shift();
      const prev = smoothOutRef.current;
      if (Number.isFinite(cents) && buf.length >= MIN_SMOOTH_FRAMES) {
        const sorted = buf.map((x) => x.c).sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1] as number;
        const k = prev.t >= 0 && t - prev.t < SMOOTH_HOLD_SEC ? 1 - Math.exp(-(t - prev.t) / SMOOTH_TAU_SEC) : 1;
        cents = Number.isFinite(prev.c) && k < 1 ? prev.c + (med - prev.c) * k : med;
        smoothOutRef.current = { t, c: cents };
      } else if (Number.isFinite(prev.c) && t - prev.t <= SMOOTH_HOLD_SEC) {
        // spółgłoska albo początek głoski
        cents = prev.c;
      } else cents = NaN;
    }
    plotRef.current.t.push(t);
    plotRef.current.cents.push(cents);
    plotRef.current.hz.push(f.f0 ?? 0);
    o.onFrame?.(frame, mic.getAnalyser());

    const sounding = isSound(f, mode);
    if (sounding) lastSoundRef.current = t;

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(o.maxSec, t));
      setLive({ f0: f.f0, cents, rms: f.rms, sounding });
    }

    const soundSec = lastSoundRef.current - (firstSoundRef.current ?? 0);
    const silentFor = t - lastSoundRef.current;
    if (t >= o.maxSec) finish();
    else if (o.endOnSilenceSec !== undefined && soundSec >= (o.minSoundSec ?? 0.5) && silentFor >= o.endOnSilenceSec) finish();
  };

  const run = useCallback(async (o: TakeRunOptions) => {
    const runId = ++runIdRef.current;
    const stale = () => runId !== runIdRef.current;
    playbackRef.current?.cancel();
    mic.stopLoop();
    const ok = await mic.open();
    if (!ok || stale()) return;

    optsRef.current = o;
    framesRef.current = [];
    plotRef.current = { t: [], cents: [], hz: [] };
    smoothRef.current = [];
    smoothOutRef.current = { t: -1, c: NaN };
    startedRef.current = false;
    finishedRef.current = false;
    streakRef.current = 0;
    firstSoundRef.current = null;
    lastSoundRef.current = 0;
    lastUiRef.current = 0;
    noiseRef.current = [];
    setStarted(false);
    setElapsed(0);
    setLive(null);

    let playback: ReferencePlayback | null = null;
    if (o.referenceMidi !== undefined && o.referenceMidi !== null) {
      playback = playReferenceNote(o.referenceMidi);
      playbackRef.current = playback;
    }
    if (o.countdown !== false) {
      for (let n = 3; n >= 1; n--) {
        setCountdown(n);
        setPhase('countdown');
        await sleep(1000);
        if (stale()) return;
      }
    }
    if (playback) await playback.done;
    if (stale()) return;

    setPhase('recording');
    loopStartRef.current = performance.now() / 1000;
    mic.startLoop(onFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic]);

  const cancel = useCallback(() => {
    runIdRef.current++;
    playbackRef.current?.cancel();
    finishedRef.current = true;
    mic.close();
    setLive(null);
    setPhase('idle');
  }, [mic]);

  /** Odsłuch dźwięku wzorcowego (np. w oknie ustawień) */
  const preview = useCallback((midi: number) => {
    playbackRef.current?.cancel();
    const pb = playReferenceNote(midi);
    playbackRef.current = pb;
    return pb.done;
  }, []);

  return {
    phase,
    countdown,
    elapsed,
    started,
    live,
    framesRef,
    plotRef,
    micState: mic.micState,
    run,
    stop: finish,
    cancel,
    preview,
    reset: () => setPhase('idle')
  };
}
