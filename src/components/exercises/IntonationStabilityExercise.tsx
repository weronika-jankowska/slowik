import { useEffect, useMemo, useRef, useState } from 'react';
import PitchPlot from './PitchPlot';
import { useMicPitch, type PitchFrame } from '../../hooks/useMicPitch';
import {
  centsBetween,
  foldCentsToOctave,
  formatDecimalPl,
  getCalibratedMidiFreq,
  midiToNoteName,
  playReferenceNote,
  type ReferencePlayback
} from '../../utils/noteUtils';
import type { AttemptData } from '../../utils/vibratoExercise';
import { BTN_PRIMARY } from './exerciseUi';
import {
  analyzeIntonationStability,
  stabilityFeedback,
  type StabilityFeedback
} from '../../utils/intonationStability.ts';
import AppFooter from '../AppFooter';

type Phase = 'setup' | 'countdown' | 'sing' | 'result';

/** Długość śpiewania liczona od pierwszego wykrytego dźwięku. */
const SING_SECONDS = 10;
/** Tolerancja wysokości środkowej: ±20 centów. */
const TOLERANCE_CENTS = 20;
/** Zakres osi wykresu */
const PLOT_RANGE_CENTS = 100;
const CENTER_HALF_WIN = 0.2;
const MIN_MIDI = 40; // E2
const MAX_MIDI = 79; // G5
const STORAGE_KEY = 'vocal_analysis_history';

const BTN =
  'bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-5 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

const TONE_COLOR: Record<StabilityFeedback['tone'], string> = {
  good: '#2f8f5b',
  ok: '#b9770e',
  work: '#c0396b',
  insufficient: '#466cd2'
};

const TILE_COLOR: Record<string, string> = {
  inband: '#2f8f5b',
  offset: '#256899',
  spread: '#8234c7',
  longest: '#cc8822'
};

/** Domyślny dźwięk */
function defaultTargetMidi(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const records = JSON.parse(saved) as { mpfr?: { f0MinMidi?: number; f0MaxMidi?: number } | null }[];
      for (let i = records.length - 1; i >= 0; i--) {
        const m = records[i]?.mpfr;
        if (m && Number.isFinite(m.f0MinMidi) && Number.isFinite(m.f0MaxMidi)) {
          const mid = Math.round(((m.f0MinMidi as number) + (m.f0MaxMidi as number)) / 2);
          return Math.max(MIN_MIDI, Math.min(MAX_MIDI, mid));
        }
      }
    }
  } catch {
    /* brak historii – używamy wartości domyślnej */
  }
  return 57;
}

/** Wysokość środkowa w chwili tc */
function centerAt(d: AttemptData, tc: number): number {
  let sum = 0, wSum = 0, total = 0, voiced = 0;
  for (let i = d.t.length - 1; i >= 0; i--) {
    const dt = (d.t[i] ?? 0) - tc;
    if (dt < -CENTER_HALF_WIN) break;
    if (dt > CENTER_HALF_WIN) continue;
    total++;
    const c = d.cents[i] ?? NaN;
    if (!Number.isFinite(c)) continue;
    voiced++;
    const w = 1 - Math.abs(dt) / CENTER_HALF_WIN;
    sum += w * c;
    wSum += w;
  }
  return total > 0 && voiced >= 0.6 * total && wSum > 0 ? sum / wSum : NaN;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const emptyData = (): AttemptData => ({ t: [], cents: [], hz: [] });

export default function IntonationStabilityExercise({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [targetMidi, setTargetMidi] = useState<number>(defaultTargetMidi);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ f0: number; cents: number } | null>(null);
  const [feedback, setFeedback] = useState<StabilityFeedback | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const mic = useMicPitch();
  /** Surowy przebieg (z wibratem) – cienka linia w tle wykresu. */
  const rawRef = useRef<AttemptData>(emptyData());
  /** Wysokość środkowa – główna, kolorowana linia wykresu. */
  const centerRef = useRef<AttemptData>(emptyData());
  const runIdRef = useRef(0);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const streakRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastUiRef = useRef(0);
  const playbackRef = useRef<ReferencePlayback | null>(null);
  const targetFreqRef = useRef(getCalibratedMidiFreq(targetMidi));

  const targetFreq = useMemo(() => getCalibratedMidiFreq(targetMidi), [targetMidi]);
  const targetName = midiToNoteName(targetMidi);
  targetFreqRef.current = targetFreq;

  useEffect(() => () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();

    const raw = rawRef.current;
    const analysis = analyzeIntonationStability(
      raw.t.map((t, i) => ({ t, f0: (raw.hz[i] ?? 0) > 0 ? (raw.hz[i] as number) : null })),
      { targetHz: targetFreqRef.current, toleranceCents: TOLERANCE_CENTS }
    );
    centerRef.current = {
      t: analysis.frames.map((f) => f.t),
      cents: analysis.frames.map((f) => f.cents ?? NaN),
      hz: raw.hz.slice()
    };
    setFeedback(stabilityFeedback(analysis));
    setLive(null);
    setPhase('result');
  };

  const onFrame = (f: PitchFrame) => {
    if (finishedRef.current) return;
    if (!startedRef.current) {
      streakRef.current = f.f0 !== null ? streakRef.current + 1 : 0;
      if (streakRef.current < 3) return; // czekamy na pewny początek dźwięku
      startedRef.current = true;
      startTimeRef.current = f.time;
      setStarted(true);
    }
    const t = f.time - startTimeRef.current;
    const raw = rawRef.current;
    let cents = NaN;
    if (f.f0 !== null) cents = foldCentsToOctave(centsBetween(f.f0, targetFreqRef.current));
    raw.t.push(t);
    raw.cents.push(cents);
    raw.hz.push(f.f0 ?? 0);

    const tc = t - CENTER_HALF_WIN;
    let center = NaN;
    if (tc >= 0) {
      center = centerAt(raw, tc);
      const c = centerRef.current;
      c.t.push(tc);
      c.cents.push(center);
      c.hz.push(0);
    }

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(SING_SECONDS, t));
      setLive(f.f0 !== null && Number.isFinite(center) ? { f0: f.f0, cents: center } : null);
    }
    if (t >= SING_SECONDS) finish();
  };

  const begin = async () => {
    const runId = ++runIdRef.current;
    const stale = () => runId !== runIdRef.current;
    playbackRef.current?.cancel();
    mic.stopLoop();
    setPreviewPlaying(false);
    const ok = await mic.open();
    if (!ok || stale()) return;

    rawRef.current = emptyData();
    centerRef.current = emptyData();
    startedRef.current = false;
    finishedRef.current = false;
    streakRef.current = 0;
    lastUiRef.current = 0;
    setStarted(false);
    setElapsed(0);
    setLive(null);
    setFeedback(null);

    const playback = playReferenceNote(targetMidi);
    playbackRef.current = playback;
    for (let n = 3; n >= 1; n--) {
      setCountdown(n);
      setPhase('countdown');
      await sleep(1000);
      if (stale()) return;
    }
    await playback.done;
    if (stale()) return;

    setPhase('sing');
    mic.startLoop(onFrame);
  };

  const cancelRun = () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
    mic.close();
    finishedRef.current = true;
    setPhase('setup');
    setStarted(false);
    setLive(null);
  };

  const preview = async () => {
    playbackRef.current?.cancel();
    const pb = playReferenceNote(targetMidi);
    playbackRef.current = pb;
    setPreviewPlaying(true);
    await pb.done;
    setPreviewPlaying(false);
  };

  const changeNote = (delta: number) => {
    playbackRef.current?.cancel();
    setPreviewPlaying(false);
    setTargetMidi((m) => Math.max(MIN_MIDI, Math.min(MAX_MIDI, m + delta)));
  };

  const inBandNow = live !== null && Math.abs(live.cents) <= TOLERANCE_CENTS;
  const progress = Math.round((elapsed / SING_SECONDS) * 100);
  const micProblem = mic.micState === 'denied' || mic.micState === 'error';

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white select-none flex flex-col">
      <div className="max-w-5xl w-full mx-auto flex-[1_0_auto] px-4 sm:px-8 pt-24 sm:pt-8 pb-8 flex flex-col items-center gap-5 relative">
        <div className="w-full flex justify-end">
          <button
            type="button"
            onClick={() => { cancelRun(); onBack(); }}
            className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm"
          >
            ← Wróć do ćwiczeń
          </button>
        </div>

        <div className="text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">Ćwiczenie ogólne</span>
          <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] uppercase drop-shadow-sm leading-tight">
            Stabilność tonu
          </h1>
          <span className="text-sm text-white/70 block mt-1">stabilność na pojedynczym dźwięku</span>
        </div>

        {/* Wykres */}
        {phase !== 'setup' && (
          <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
            <div className="relative w-full h-[280px] sm:h-[340px]">
              <PitchPlot
                dataRef={centerRef}
                backgroundRef={rawRef}
                durationSec={SING_SECONDS}
                bandCents={TOLERANCE_CENTS}
                rangeCents={PLOT_RANGE_CENTS}
                targetLabel={targetName}
                running={phase === 'sing'}
              />
              {phase === 'countdown' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span key={countdown} className="ex-countdown font-cardo text-white/90 text-[56px] sm:text-[72px] leading-none drop-shadow-md">
                    {countdown}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-[11px] text-white/60">
              <span className="flex items-center gap-2"><span className="inline-block w-6 h-[2px] rounded bg-white/40" />dokładny przebieg wysokości</span>
              <span className="flex items-center gap-2"><span className="inline-block w-6 h-[3px] rounded bg-emerald-400" />wysokość środkowa (oceniana)</span>
            </div>

            {phase !== 'result' && (
              <div className="w-full flex flex-col gap-2">
                <div className="w-full flex items-center justify-between text-xs sm:text-sm">
                  <div className="flex flex-col items-start">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Cel</span>
                    <span className="font-seasons text-base">
                      {targetName} <span className="text-xs text-white/70 font-cardo">({formatDecimalPl(targetFreq, 1)} Hz)</span>
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-white/80">
                      {!live ? (started ? 'Brak dźwięku…' : 'Zaśpiewaj dźwięk') : inBandNow ? 'W zielonym paśmie' : live.cents > 0 ? 'Za wysoko' : 'Za nisko'}
                    </span>
                    <span className={`text-xs font-bold font-mono ${!live ? 'text-white/40' : inBandNow ? 'text-emerald-400' : 'text-amber-300'}`}>
                      {live ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Twój głos</span>
                    <span className={`font-seasons text-base ${live ? 'text-emerald-400' : 'text-white/40'}`}>
                      {live ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz'}
                    </span>
                  </div>
                </div>

                <div className="w-full flex items-center gap-3">
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-[11px] opacity-75 w-20 text-right">
                    {formatDecimalPl(elapsed, 1)} / {SING_SECONDS} s
                  </span>
                  <button type="button" onClick={phase === 'sing' && started ? finish : cancelRun} className="text-[11px] uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1 rounded-full cursor-pointer">
                    {phase === 'sing' && started ? 'Zakończ' : 'Anuluj'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {micProblem && (
          <div className="w-full max-w-2xl bg-rose-500/25 border border-rose-200/40 rounded-xl px-4 py-3 text-sm text-center">
            {mic.micState === 'denied'
              ? 'Brak dostępu do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki i spróbuj ponownie.'
              : 'Nie udało się uruchomić mikrofonu. Sprawdź, czy jest podłączony i nieużywany przez inną aplikację.'}
          </div>
        )}

        {/* Instrukcja i wybór dźwięku przed startem */}
        {phase === 'setup' && (
          <div className="w-full flex-1 flex items-center justify-center">
            <div className="w-full max-w-3xl sm:pointer-events-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-5">
              <div className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5">
                <p>Usłyszysz dźwięk wzorcowy. Posłuchaj go uważnie.</p>
                <p>Po odliczaniu zaśpiewaj ten dźwięk na samogłosce <i>a</i> i trzymaj go równo przez {SING_SECONDS} sekund. Możesz śpiewać z wibrato lub bez.</p>
                <p>Staraj się, by gruba linia na wykresie mieściła się w zielonym polu (±{TOLERANCE_CENTS} centów od dźwięku wzorcowego). Cienka linia pokazuje dokładny przebieg wysokości, razem z wibrato.</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="Dźwięk niżej" onClick={() => changeNote(-1)} disabled={targetMidi <= MIN_MIDI} className="w-9 h-9 rounded-full bg-white/60 hover:bg-white/80 text-[#466cd2] text-lg leading-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                  <div className="flex flex-col items-center min-w-[110px]">
                    <span className="text-[10px] uppercase tracking-wider opacity-70">Dźwięk wzorcowy</span>
                    <span className="font-seasons text-2xl">{targetName}</span>
                    <span className="text-xs opacity-70">{formatDecimalPl(targetFreq, 1)} Hz</span>
                  </div>
                  <button type="button" aria-label="Dźwięk wyżej" onClick={() => changeNote(1)} disabled={targetMidi >= MAX_MIDI} className="w-9 h-9 rounded-full bg-white/60 hover:bg-white/80 text-[#466cd2] text-lg leading-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button type="button" onClick={() => void preview()} disabled={previewPlaying} className={BTN}>♪ Posłuchaj dźwięku</button>
                  <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Rozpocznij</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Wyniki */}
        {phase === 'result' && feedback && (
          <div className="w-full flex flex-col items-center gap-4">
            <div className="w-full max-w-3xl bg-white/45 backdrop-blur-md rounded-2xl border border-white/35 shadow-md px-6 py-5 text-center">
              <h2 className="font-seasons text-2xl tracking-wide" style={{ color: TONE_COLOR[feedback.tone] }}>
                {feedback.headline}
              </h2>
              <p className="font-cardo text-[15px] text-[#2c49a8] mt-1 leading-snug">{feedback.detail}</p>
            </div>

            {feedback.rows.length > 0 && (
              <div className="w-full result-tiles">
                {feedback.rows.map((item) => (
                  <div key={item.id} className="bg-white/40 backdrop-blur-md rounded-xl py-3 px-3 flex flex-col items-center justify-between text-center shadow-md border border-white/35 min-h-[114px] sm:min-h-[120px]">
                    <h3 className="font-seasons font-normal text-[14px] sm:text-[15px] text-[#18388f] leading-tight">{item.label}</h3>
                    <span className="font-seasons font-normal text-[17px] sm:text-[19px] tracking-wide my-0.5 leading-none" style={{ color: TILE_COLOR[item.id] ?? '#18388f' }}>{item.value}</span>
                    <p className="font-cardo font-normal text-[11px] sm:text-[11.5px] text-[#466cd2] leading-[1.25] px-1">{item.comment}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4 mt-1 pb-6">
              <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Powtórz ćwiczenie</button>
              <button type="button" onClick={() => setPhase('setup')} className={BTN}>Zmień dźwięk</button>
              <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
            </div>
          </div>
        )}
      </div>
      <AppFooter />
    </div>
  );
}