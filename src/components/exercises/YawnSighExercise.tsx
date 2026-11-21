import { Cite } from '../ParameterInfo';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import GlidePlot from './GlidePlot';
import { useMicPitch, type PitchFrame } from '../../hooks/useMicPitch';
import { centsBetween, formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { BTN_PRIMARY } from './exerciseUi';
import {
  analyzeGlide,
  filterOctaveErrors,
  glideFeedback,
  type GlideData,
  type GlideFeedback,
  type MpfrRange
} from '../../utils/yawnSighExercise';

type Phase = 'setup' | 'countdown' | 'sing' | 'result';

/** Maksymalna długość jednego westchnienia [s]. */
const MAX_SECONDS = 7;
/** Cisza, po której westchnienie uznaje się za zakończone [s]. */
const END_SILENCE_SEC = 0.6;
const MIN_SOUND_SEC = 0.5;
/** Ile wcześniejszych prób z sesji pokazywać w tle. */
const KEEP_PREVIOUS = 3;
const STORAGE_KEY = 'vocal_analysis_history';

const BTN =
  'bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-5 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

const TONE_COLOR: Record<GlideFeedback['tone'], string> = {
  good: '#2f8f5b',
  ok: '#b9770e',
  insufficient: '#466cd2'
};

const TILE_COLOR: Record<string, string> = {
  peak: '#c0396b',
  low: '#256899',
  span: '#2f8f5b',
  smooth: '#8234c7'
};

/** Zakres głosu z ostatniej analizy (MPFR), jeśli była wykonana */
function readMpfrRange(): MpfrRange | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const records = JSON.parse(saved) as { mpfr?: { f0MinMidi?: number; f0MaxMidi?: number } | null }[];
    for (let i = records.length - 1; i >= 0; i--) {
      const m = records[i]?.mpfr;
      if (m && Number.isFinite(m.f0MinMidi) && Number.isFinite(m.f0MaxMidi)) {
        return { lowMidi: m.f0MinMidi as number, highMidi: m.f0MaxMidi as number };
      }
    }
  } catch {
    /* brak historii */
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const emptyGlide = (): GlideData => ({ t: [], midi: [] });
const noteName = (m: number) => midiToNoteName(m);

export default function YawnSighExercise({ onBack, stageSwitcher, onPeak, next }: {
  onBack: () => void;
  next?: { label: string; go: () => void };
  /** Przełącznik etapów ćwiczenia „Poszerzanie skali” */
  stageSwitcher?: ReactNode;
  /** Najwyższy dźwięk udanej próby (do etapu „Nowy dźwięk”). */
  onPeak?: (midi: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ f0: number; midi: number } | null>(null);
  const [feedback, setFeedback] = useState<GlideFeedback | null>(null);
  const [previous, setPrevious] = useState<GlideData[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [mpfr] = useState<MpfrRange | null>(readMpfrRange);

  const mic = useMicPitch();
  const dataRef = useRef<GlideData>(emptyGlide());
  const validRef = useRef<number[]>([]);
  const sessionBestRef = useRef(-Infinity);
  const runIdRef = useRef(0);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const streakRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastVoicedRef = useRef(0);
  const firstVoicedRef = useRef<number | null>(null);
  const lastUiRef = useRef(0);
  const a4Ref = useRef(getCalibratedMidiFreq(69));

  const midiToHz = (m: number) => a4Ref.current * Math.pow(2, (m - 69) / 12);

  useEffect(() => () => { runIdRef.current++; }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();
    const result = analyzeGlide(dataRef.current);
    const bestBefore = sessionBestRef.current;
    if (result.sufficient) {
      sessionBestRef.current = Math.max(sessionBestRef.current, result.peakMidi);
      onPeak?.(result.peakMidi);
    }
    setFeedback(glideFeedback(result, noteName, midiToHz, mpfr, Math.max(bestBefore, result.peakMidi)));
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
    let midi = NaN;
    if (f.f0 !== null) {
      midi = 69 + centsBetween(f.f0, a4Ref.current) / 100;
      midi = filterOctaveErrors(validRef.current, midi);
    }
    if (Number.isFinite(midi)) {
      validRef.current.push(midi);
      lastVoicedRef.current = t;
      if (firstVoicedRef.current === null) firstVoicedRef.current = t;
    }
    dataRef.current.t.push(t);
    dataRef.current.midi.push(midi);

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(MAX_SECONDS, t));
      setLive(f.f0 !== null && Number.isFinite(midi) ? { f0: f.f0, midi } : null);
    }

    const soundSec = lastVoicedRef.current - (firstVoicedRef.current ?? lastVoicedRef.current);
    if ((soundSec >= MIN_SOUND_SEC && t - lastVoicedRef.current >= END_SILENCE_SEC) || t >= MAX_SECONDS) finish();
  };

  const begin = async () => {
    const runId = ++runIdRef.current;
    const stale = () => runId !== runIdRef.current;
    mic.stopLoop();
    const ok = await mic.open();
    if (!ok || stale()) return;

    // poprzednia udana próba trafia do tła wykresu
    const last = dataRef.current;
    if (last.t.length > 0 && feedback && feedback.tone !== 'insufficient') {
      setPrevious((p) => [...p, last].slice(-KEEP_PREVIOUS));
    }
    dataRef.current = emptyGlide();
    validRef.current = [];
    startedRef.current = false;
    finishedRef.current = false;
    streakRef.current = 0;
    lastVoicedRef.current = 0;
    firstVoicedRef.current = null;
    lastUiRef.current = 0;
    a4Ref.current = getCalibratedMidiFreq(69);
    setStarted(false);
    setElapsed(0);
    setLive(null);
    setFeedback(null);

    // bez dźwięku wzorcowego
    for (let n = 3; n >= 1; n--) {
      setCountdown(n);
      setPhase('countdown');
      await sleep(1000);
      if (stale()) return;
    }

    setPhase('sing');
    mic.startLoop(onFrame);
  };

  const cancelRun = () => {
    runIdRef.current++;
    mic.close();
    finishedRef.current = true;
    setPhase('setup');
    setStarted(false);
    setLive(null);
  };

  const progress = Math.round((elapsed / MAX_SECONDS) * 100);
  const micProblem = mic.micState === 'denied' || mic.micState === 'error';
  const aboveRange = live !== null && mpfr !== null && live.midi > mpfr.highMidi + 0.5;

  return (
    <>
        {phase !== 'setup' && (
          <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
            <div className="relative w-full h-[300px] sm:h-[380px]">
              <GlidePlot
                dataRef={dataRef}
                previous={previous}
                mpfr={mpfr}
                durationSec={MAX_SECONDS}
                noteName={noteName}
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
              <span className="flex items-center gap-2"><span className="inline-block w-6 h-[3px] rounded bg-emerald-400" />Twoje westchnienie</span>
              {mpfr && <span className="flex items-center gap-2"><span className="inline-block w-6 h-[3px] rounded bg-[#ff7ac6]" />ponad zakresem z analizy głosu</span>}
              {mpfr && <span className="flex items-center gap-2"><span className="inline-block w-4 h-3 bg-white/15" />zakres z analizy głosu</span>}
              {previous.length > 0 && <span className="flex items-center gap-2"><span className="inline-block w-6 h-[2px] rounded bg-white/30" />wcześniejsze próby</span>}
            </div>

            {phase !== 'result' && (
              <div className="w-full flex flex-col gap-2">
                <div className="w-full flex items-center justify-between text-xs sm:text-sm">
                  <div className="flex flex-col items-start">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Dźwięk</span>
                    <span className={`font-seasons text-base ${live ? (aboveRange ? 'text-[#ff9fd6]' : 'text-emerald-400') : 'text-white/40'}`}>
                      {live ? noteName(Math.round(live.midi)) : '—'}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-white/80">
                      {!started ? 'Ziewnij i zaśpiewaj [A]' : live ? (aboveRange ? 'Ponad Twoim zakresem' : 'Zjedź płynnie w dół') : 'Brak dźwięku…'}
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
                    {formatDecimalPl(elapsed, 1)} / {MAX_SECONDS} s
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

        {phase === 'setup' && (
          <div className="w-full flex-1 flex items-center justify-center">
            <div className="w-full max-w-3xl sm:pointer-events-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-5">
              {stageSwitcher}
              <div className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5">
                <p>W śpiewie ważna jest odpowiednia praca nad torem głosowym, co pozwala uniknąć przeciążenia głosu. Dobrym ćwiczeniem, które w tym pomaga, jest ziewanie z westchnieniem. Ważne, żeby wykonywać je jak najbardziej naturalnie.</p>
                <p>Otwórz szeroko usta i weź głęboki wdech jak przy ziewaniu.</p>
                <p>Wykonaj westchnienie, zjeżdżając płynnie dźwiękami z góry na dół. Aplikacja wskaże, jak wysoko sięgnął Twój głos.</p>
                <p>Nie próbuj na siłę osiągnąć wysokich nut, w tym ćwiczeniu ważne jest swobodne wydobywanie dźwięku.</p>
                <p>
                  Technika ziewania i westchnienia (ang. <i>yawn-sigh</i>) poprawia świadomość podniebienia miękkiego i języka, otwiera
                  i rozluźnia gardło, sprzyja lepszemu ustawieniu podniebienia miękkiego i jest bardzo przydatna w pracy nad rezonansem głosu
                  <Cite n={1} source="sahinOrhon" />.
                </p>
                <p className="text-[13px] text-[#466cd2] opacity-90">
                  {mpfr
                    ? `Wykres pokaże, jak wysoko sięgnął Twój głos w porównaniu z najwyższym dźwiękiem z analizy głosu (${noteName(Math.round(mpfr.highMidi))}). `
                    : 'Wykres pokaże, jak wysoko sięgnął Twój głos i jak płynnie zjechał w dół. '}
                  Jeśli poczujesz napięcie lub drapanie w gardle, przerwij i spróbuj ciszej.
                </p>
              </div>

              <div className="flex justify-center sm:justify-end">
                <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Rozpocznij</button>
              </div>
            </div>
          </div>
        )}

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
              <button type="button" onClick={() => void begin()} className={next ? BTN : BTN_PRIMARY}>Ziewnij jeszcze raz</button>
              {next && <button type="button" onClick={next.go} className={BTN_PRIMARY}>{next.label}</button>}
              <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
            </div>
          </div>
        )}
    </>
  );
}
