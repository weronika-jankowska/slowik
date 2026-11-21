import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import PitchPlot from './PitchPlot';
import { BTN, BTN_PRIMARY, BTN_SMALL, MicProblem, ResultHeader, ResultTiles, sleep } from './exerciseUi';
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
import { analyzeIntonationStability } from '../../utils/intonationStability';
import { engineContinuity, engineFeedback, soundingFrames, type TrillFeedback } from '../../utils/lipTrillExercise';

type Phase = 'setup' | 'countdown' | 'sing' | 'result';

/** Czas trzymania trylu [s]. */
const SING_SECONDS = 10;
/** Zielone pole: ±50 ct */
const BAND_CENTS = 50;
const MIN_MIDI = 40; // E2
const MAX_MIDI = 79; // G5

const TILE_COLOR: Record<string, string> = {
  longest: '#2f8f5b',
  breaks: '#c0396b',
  inband: '#256899',
  offset: '#8234c7'
};

interface Props {
  defaultMidi: number;
  /** Przełącznik etapów – wyświetlany w oknie startowym. */
  stageSwitcher: ReactNode;
  onNextStage: () => void;
  onBack: () => void;
}

export default function LipTrillEngine({ defaultMidi, stageSwitcher, onNextStage, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [targetMidi, setTargetMidi] = useState(defaultMidi);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ f0: number; cents: number } | null>(null);
  const [feedback, setFeedback] = useState<TrillFeedback | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const mic = useMicPitch();
  const dataRef = useRef<AttemptData>({ t: [], cents: [], hz: [] });
  /** Głośność ramek */
  const rmsRef = useRef<number[]>([]);
  const lastSoundRef = useRef(0);
  const runIdRef = useRef(0);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const streakRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastUiRef = useRef(0);
  const playbackRef = useRef<ReferencePlayback | null>(null);

  const targetFreq = useMemo(() => getCalibratedMidiFreq(targetMidi), [targetMidi]);
  const targetFreqRef = useRef(targetFreq);
  targetFreqRef.current = targetFreq;
  const targetName = midiToNoteName(targetMidi);

  useEffect(() => () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();
    const d = dataRef.current;
    const cont = engineContinuity(d.t, soundingFrames(d.hz, rmsRef.current));
    const pitch = analyzeIntonationStability(
      d.t.map((t, i) => ({ t, f0: (d.hz[i] ?? 0) > 0 ? (d.hz[i] as number) : null })),
      { targetHz: targetFreqRef.current, toleranceCents: BAND_CENTS }
    );
    const duration = Math.min(SING_SECONDS, d.t[d.t.length - 1] ?? 0);
    setFeedback(engineFeedback(cont, Math.max(1, Math.round(duration)), pitch.inTolerancePercent, BAND_CENTS));
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
    const cents = f.f0 !== null ? foldCentsToOctave(centsBetween(f.f0, targetFreqRef.current)) : NaN;
    const d = dataRef.current;
    d.t.push(t);
    d.cents.push(cents);
    d.hz.push(f.f0 ?? 0);
    rmsRef.current.push(f.rms);
    if (f.f0 !== null) lastSoundRef.current = t;

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(SING_SECONDS, t));
      // pojedyncze zgubione ramki nie gaszą stanu
      if (f.f0 !== null) setLive({ f0: f.f0, cents });
      else if (t - lastSoundRef.current > 0.3) setLive(null);
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

    dataRef.current = { t: [], cents: [], hz: [] };
    rmsRef.current = [];
    lastSoundRef.current = 0;
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

  const inBandNow = live !== null && Math.abs(live.cents) <= BAND_CENTS;
  const progress = Math.round((elapsed / SING_SECONDS) * 100);

  return (
    <>
      {phase !== 'setup' && (
        <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
          <div className="relative w-full h-[280px] sm:h-[340px]">
            <PitchPlot
              dataRef={dataRef}
              durationSec={SING_SECONDS}
              bandCents={BAND_CENTS}
              rangeCents={100}
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
                    {!live ? (started ? 'Tryl się urwał…' : <>Zamrucz trylem <i>brrr</i></>) : inBandNow ? 'Równy tryl' : live.cents > 0 ? 'Za wysoko' : 'Za nisko'}
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
                <span className="text-[11px] opacity-75 w-20 text-right">{formatDecimalPl(elapsed, 1)} / {SING_SECONDS} s</span>
                <button type="button" onClick={phase === 'sing' && started ? finish : cancelRun} className={BTN_SMALL}>
                  {phase === 'sing' && started ? 'Zakończ' : 'Anuluj'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <MicProblem state={mic.micState} />

      {phase === 'setup' && (
        <div className="w-full flex-1 flex items-center justify-center">
          <div className="w-full max-w-3xl sm:pointer-events-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-5">
            {stageSwitcher}
            <div className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5">
              <p>Złącz luźno wargi i wydmuchuj powietrze tak, żeby zaczęły swobodnie drgać – jak przy naśladowaniu warkotu silnika: <i>brrr</i>.</p>
              <p>W ramach ćwiczenia musisz wykonać tryl na określonej wysokości. Usłyszysz dźwięk wzorcowy. Po odliczaniu zamrucz go trylem i utrzymaj na równej wysokości przez {SING_SECONDS} sekund.</p>
              <p>Staraj się, by tryl się nie urwał, a linia na wykresie utrzymała się w zielonym polu – jak silnik na równych obrotach.</p>
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

      {phase === 'result' && feedback && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={feedback.tone} headline={feedback.headline} detail={feedback.detail} />
          <ResultTiles rows={feedback.rows} colors={TILE_COLOR} />
          <div className="flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4 mt-1 pb-6">
            <button type="button" onClick={onNextStage} className={BTN_PRIMARY}>Przejdź do rozśpiewki</button>
            <button type="button" onClick={() => void begin()} className={BTN}>Powtórz</button>
            <button type="button" onClick={() => setPhase('setup')} className={BTN}>Zmień dźwięk</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </div>
        </div>
      )}
    </>
  );
}
