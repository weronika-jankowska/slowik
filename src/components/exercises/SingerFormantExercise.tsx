import { useEffect, useMemo, useRef, useState } from 'react';
import SpectrumPlot, { type SpectrumData } from './SpectrumPlot';
import ParameterInfo from '../ParameterInfo';
import { useMicPitch, type PitchFrame } from '../../hooks/useMicPitch';
import { calculateSingerFormantAndSPRFromDb, medianOfValid } from '../../utils/audioMetrics';
import {
  formatDecimalPl,
  getCalibratedMidiFreq,
  midiToNoteName,
  playReferenceNote,
  type ReferencePlayback
} from '../../utils/noteUtils';
import { BTN_PRIMARY } from './exerciseUi';
import {
  SPR_BAND_HZ,
  SPR_REF,
  formantFeedback,
  sprLevel,
  type FormantFeedback
} from '../../utils/singerFormantExercise';

type Phase = 'setup' | 'countdown' | 'sing' | 'result';

/** Długość śpiewania liczona od pierwszego wykrytego dźwięku. */
const SING_SECONDS = 10;
/** Stała czasowa uśredniania widma na żywo [s]. */
const LIVE_TAU_SEC = 0.5;
const SKIP_ONSET_SEC = 0.3;
/** Minimalny czas dźwięczny, by wynik miał sens [s]. */
const MIN_VOICED_SEC = 2;
const MIN_MIDI = 40; // E2
const MAX_MIDI = 79; // G5
const STORAGE_KEY = 'vocal_analysis_history';

const BTN =
  'bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-5 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

const TONE_COLOR: Record<FormantFeedback['tone'], string> = {
  good: '#2f8f5b',
  ok: '#b9770e',
  work: '#c0396b',
  insufficient: '#466cd2'
};

const TILE_COLOR: Record<string, string> = {
  spr: '#2f8f5b',
  best: '#cc8822',
  peak: '#256899',
  energy: '#8234c7'
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

interface PowerAccumulator { pow: Float64Array; frames: number }

const newAcc = (n: number): PowerAccumulator => ({ pow: new Float64Array(n), frames: 0 });

function addDb(acc: PowerAccumulator, db: Float32Array): void {
  for (let i = 0; i < db.length; i++) acc.pow[i] = (acc.pow[i] ?? 0) + Math.pow(10, Math.max(-120, db[i] ?? -120) / 10);
  acc.frames++;
}

function accToDb(acc: PowerAccumulator): Float32Array {
  const out = new Float32Array(acc.pow.length);
  for (let i = 0; i < out.length; i++) out[i] = 10 * Math.log10(Math.max(1e-12, (acc.pow[i] ?? 0) / Math.max(1, acc.frames)));
  return out;
}

const makeDbBuffer = (n: number) => new Float32Array(n);
type DbBuffer = ReturnType<typeof makeDbBuffer>;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const emptySpectrum = (): SpectrumData => ({ main: null, instant: null, binHz: 0 });

export default function SingerFormantExercise({ onBack }: { onBack: () => void }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [targetMidi, setTargetMidi] = useState<number>(defaultTargetMidi);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ f0: number; spr: number } | null>(null);
  const [feedback, setFeedback] = useState<FormantFeedback | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const mic = useMicPitch();
  const specRef = useRef<SpectrumData>(emptySpectrum());
  const sampleRateRef = useRef(48000);
  const dbBufRef = useRef<DbBuffer | null>(null);
  /** Widmo na żywo: wykładniczo uśredniona moc. */
  const emaRef = useRef<Float64Array | null>(null);
  /** Widmo długoterminowe (LTAS) całego nagrania, bez ataku. */
  const ltasRef = useRef<PowerAccumulator | null>(null);
  const secondsRef = useRef<Map<number, PowerAccumulator>>(new Map());
  const f0sRef = useRef<number[]>([]);
  const voicedSecRef = useRef(0);
  const lastVoicedTimeRef = useRef<number | null>(null);

  const runIdRef = useRef(0);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const streakRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastUiRef = useRef(0);
  const playbackRef = useRef<ReferencePlayback | null>(null);

  const targetFreq = useMemo(() => getCalibratedMidiFreq(targetMidi), [targetMidi]);
  const targetName = midiToNoteName(targetMidi);

  useEffect(() => () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();

    const sr = sampleRateRef.current;
    const f0 = medianOfValid(f0sRef.current);
    const ltas = ltasRef.current;
    const ltasDb = ltas && ltas.frames > 0 ? accToDb(ltas) : null;
    const whole = ltasDb ? calculateSingerFormantAndSPRFromDb(ltasDb, sr, f0) : null;

    let best = -Infinity;
    for (const acc of secondsRef.current.values()) {
      if (acc.frames < 20) continue; // niepełna sekunda (np. przerwa w dźwięku)
      const s = calculateSingerFormantAndSPRFromDb(accToDb(acc), sr, f0).spr;
      if (Number.isFinite(s) && s > best) best = s;
    }

    setFeedback(
      formantFeedback({
        sufficient: voicedSecRef.current >= MIN_VOICED_SEC && !!whole,
        sprDb: whole?.spr ?? NaN,
        bestSprDb: Number.isFinite(best) ? best : whole?.spr ?? NaN,
        peakHz: whole?.sppFreqHz ?? NaN,
        sfEnergyDb: whole?.sfEnergyDb ?? NaN
      })
    );
    specRef.current = { main: ltasDb, instant: null, binHz: specRef.current.binHz };
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
    const analyser = mic.getAnalyser();

    if (f.f0 !== null && analyser) {
      const n = analyser.frequencyBinCount;
      sampleRateRef.current = analyser.context.sampleRate;
      if (!dbBufRef.current || dbBufRef.current.length !== n) dbBufRef.current = makeDbBuffer(n);
      const db = dbBufRef.current;
      analyser.getFloatFrequencyData(db);

      const prev = lastVoicedTimeRef.current;
      const dt = prev === null ? 0 : Math.min(0.1, f.time - prev);
      lastVoicedTimeRef.current = f.time;
      voicedSecRef.current += dt;

      // widmo na żywo: wykładnicze uśrednianie mocy
      if (!emaRef.current || emaRef.current.length !== n) {
        emaRef.current = new Float64Array(n);
        for (let i = 0; i < n; i++) emaRef.current[i] = Math.pow(10, Math.max(-120, db[i] ?? -120) / 10);
      } else {
        const a = Math.exp(-dt / LIVE_TAU_SEC);
        const ema = emaRef.current;
        for (let i = 0; i < n; i++) ema[i] = a * (ema[i] ?? 0) + (1 - a) * Math.pow(10, Math.max(-120, db[i] ?? -120) / 10);
      }
      const mainDb = new Float32Array(n);
      for (let i = 0; i < n; i++) mainDb[i] = 10 * Math.log10(Math.max(1e-12, emaRef.current[i] ?? 0));
      specRef.current = { main: mainDb, instant: db, binHz: sampleRateRef.current / 2 / n };

      if (t >= SKIP_ONSET_SEC) {
        if (!ltasRef.current || ltasRef.current.pow.length !== n) ltasRef.current = newAcc(n);
        addDb(ltasRef.current, db);
        const sec = Math.floor(t);
        let acc = secondsRef.current.get(sec);
        if (!acc) { acc = newAcc(n); secondsRef.current.set(sec, acc); }
        addDb(acc, db);
        f0sRef.current.push(f.f0);
      }
    } else {
      specRef.current = { ...specRef.current, instant: null };
    }

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(SING_SECONDS, t));
      const main = specRef.current.main;
      if (f.f0 !== null && main) {
        const spr = calculateSingerFormantAndSPRFromDb(main, sampleRateRef.current, f.f0).spr;
        setLive(Number.isFinite(spr) ? { f0: f.f0, spr } : null);
      } else setLive(null);
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

    specRef.current = emptySpectrum();
    emaRef.current = null;
    ltasRef.current = null;
    secondsRef.current = new Map();
    f0sRef.current = [];
    voicedSecRef.current = 0;
    lastVoicedTimeRef.current = null;
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

  const liveLevel = live ? sprLevel(live.spr) : null;
  const progress = Math.round((elapsed / SING_SECONDS) * 100);
  const micProblem = mic.micState === 'denied' || mic.micState === 'error';
  const bandLabel = `${SPR_BAND_HZ.lo / 1000}–${SPR_BAND_HZ.hi / 1000} kHz`;

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white select-none">
      {/* opis formantu śpiewaczego (jak w analizie głosu) */}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex flex-col px-4 overflow-y-auto" style={{ background: 'rgba(24, 56, 143, 0.35)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={(e) => { if (e.target === e.currentTarget) setInfoOpen(false); }}>
          <ParameterInfo id="singerFormant" onClose={() => setInfoOpen(false)} />
        </div>
      )}
      <div className="max-w-5xl mx-auto min-h-full px-4 sm:px-8 pt-24 sm:pt-8 pb-8 flex flex-col items-center gap-5 relative">
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
            Formant śpiewaczy
          </h1>
          <span className="text-sm text-white/70 block mt-1">dźwięczna barwa z widmem na żywo</span>
        </div>

        {phase !== 'setup' && (
          <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
            <div className="relative w-full h-[280px] sm:h-[340px]">
              <SpectrumPlot
                dataRef={specRef}
                bandLoHz={SPR_BAND_HZ.lo}
                bandHiHz={SPR_BAND_HZ.hi}
                goodDb={SPR_REF.amateurs}
                minDb={SPR_REF.nonsingers}
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
              {phase !== 'result' && (
                <span className="flex items-center gap-2"><span className="inline-block w-6 h-px bg-white/40" />widmo chwilowe</span>
              )}
              <span className="flex items-center gap-2">
                <span className="inline-block w-6 h-[3px] rounded bg-white/90" />
                {phase === 'result' ? 'widmo uśrednione z całego nagrania' : 'widmo uśrednione'}
              </span>
              <span className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />najwyższy szczyt w paśmie {bandLabel}</span>
            </div>

            {phase !== 'result' && (
              <div className="w-full flex flex-col gap-2">
                <div className="w-full flex items-center justify-between text-xs sm:text-sm">
                  <div className="flex flex-col items-start">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Pasmo</span>
                    <span className="font-seasons text-base">{bandLabel}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-white/80">
                      {!live
                        ? started ? 'Brak dźwięku…' : 'Zaśpiewaj dźwięk'
                        : liveLevel === 'good' ? 'Wyraźne wzmocnienie'
                        : liveLevel === 'ok' ? 'Słabe wzmocnienie'
                        : 'Brak wzmocnienia'}
                    </span>
                    <span className={`text-xs font-bold font-mono ${!live ? 'text-white/40' : liveLevel === 'good' ? 'text-emerald-400' : liveLevel === 'ok' ? 'text-amber-300' : 'text-rose-400'}`}>
                      {live ? `SPR ${formatDecimalPl(live.spr, 1)} dB` : '—'}
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
                <p>Usłyszysz dźwięk wzorcowy. Domyślnie jest to dźwięk ze środka Twojej skali, ale możesz zmienić go poniżej.</p>
                <p>Po odliczaniu zaśpiewaj ten dźwięk na samogłosce <i>a</i> i trzymaj go przez {SING_SECONDS} sekund ze stałą, wygodną głośnością.</p>
                <p>
                  Obserwuj widmo swojego głosu. Staraj się, by w zielonym polu ({bandLabel}) pojawił się jak najwyższy szczyt.
                  To wzmocnienie, nazywane formantem śpiewaczym
                  <button
                    type="button"
                    onClick={() => setInfoOpen(true)}
                    aria-label="Czym jest formant śpiewaczy"
                    title="Czym jest formant śpiewaczy"
                    className="inline align-super text-[12px] font-bold text-[#18388f] hover:text-[#466cd2] cursor-pointer px-0.5"
                  >
                    *
                  </button>
                  , pomaga głosowi przebić się przez akompaniament.
                </p>
                <p className="text-[13px] text-[#466cd2] opacity-90">
                  Wyobraź sobie, że jesteś w dużym pomieszczeniu i chcesz, żeby Twój głos był słyszany na jego drugim końcu. Uważaj, żeby nie krzyczeć, tylko śpiewać. Otwórz szeroko usta i postaraj się, żeby głos był jak najbardziej dźwięczny – głośność nie jest tu kluczowa, istotna jest barwa dźwięku.
                </p>
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
    </div>
  );
}