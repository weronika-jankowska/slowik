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
import {
  VIBRATO_BAND_CENTS,
  VIBRATO_BAND_SEMITONES,
  buildFeedback,
  computeAttemptStats,
  type AttemptData,
  type AttemptFeedback,
  type AttemptStats
} from '../../utils/vibratoExercise';

type Phase = 'setup' | 'listen' | 'sing' | 'result';

/** Długość śpiewania liczona od pierwszego wykrytego dźwięku. */
const SING_SECONDS = 10;
const MIN_MIDI = 40; // E2
const MAX_MIDI = 79; // G5
const STORAGE_KEY = 'vocal_analysis_history';

const BTN =
  'bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-5 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_PRIMARY =
  'bg-white/75 hover:bg-white/90 text-[#18388f] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-6 sm:px-8 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/50 cursor-pointer';

/** Domyślny dźwięk: środek zakresu z ostatniej analizy głosu (MPFR), a bez niej A3. */
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

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const TONE_COLOR: Record<AttemptFeedback['tone'], string> = {
  good: '#2f8f5b',
  ok: '#b9770e',
  work: '#c0396b',
  insufficient: '#466cd2'
};

export default function VibratoControlExercise({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [targetMidi, setTargetMidi] = useState<number>(defaultTargetMidi);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ f0: number; cents: number } | null>(null);
  const [result, setResult] = useState<{ stats: AttemptStats; feedback: AttemptFeedback } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const mic = useMicPitch();
  const dataRef = useRef<AttemptData>({ t: [], cents: [], hz: [] });
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
    mic.stopLoop();
    const stats = computeAttemptStats(dataRef.current, VIBRATO_BAND_CENTS);
    setResult({ stats, feedback: buildFeedback(stats, VIBRATO_BAND_CENTS) });
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
    const d = dataRef.current;
    let cents = NaN;
    if (f.f0 !== null) cents = foldCentsToOctave(centsBetween(f.f0, targetFreqRef.current));
    d.t.push(t);
    d.cents.push(cents);
    d.hz.push(f.f0 ?? 0);

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setElapsed(Math.min(SING_SECONDS, t));
      setLive(f.f0 !== null ? { f0: f.f0, cents } : null);
    }
    if (t >= SING_SECONDS) finish();
  };

  const begin = async () => {
    const runId = ++runIdRef.current;
    playbackRef.current?.cancel();
    setPreviewPlaying(false);
    const ok = await mic.open();
    if (!ok || runId !== runIdRef.current) return;

    dataRef.current = { t: [], cents: [], hz: [] };
    startedRef.current = false;
    finishedRef.current = false;
    streakRef.current = 0;
    setStarted(false);
    setElapsed(0);
    setLive(null);
    setResult(null);
    setPhase('listen');

    const playback = playReferenceNote(targetMidi);
    playbackRef.current = playback;
    await playback.done;
    if (runId !== runIdRef.current) return;
    await sleep(350); // wybrzmienie dźwięku, żeby nie trafił do mikrofonu
    if (runId !== runIdRef.current) return;

    setPhase('sing');
    mic.startLoop(onFrame);
  };

  const cancelRun = () => {
    runIdRef.current++;
    playbackRef.current?.cancel();
    mic.stopLoop();
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

  const bandSemisLabel = formatDecimalPl(VIBRATO_BAND_SEMITONES, 1);
  const bandLabel = `±${bandSemisLabel} półtonu`;
  const inBandNow = live !== null && Math.abs(live.cents) <= VIBRATO_BAND_CENTS;
  const progress = Math.round((elapsed / SING_SECONDS) * 100);
  const micProblem = mic.micState === 'denied' || mic.micState === 'error';

  let overlayTitle = '';
  let overlaySub = '';
  if (phase === 'setup') {
    overlayTitle = 'Cel: zielone pasmo';
    overlaySub = 'Zaśpiewaj długi, równy dźwięk tak, by wykres mieścił się w zielonym pasku';
  } else if (phase === 'listen') {
    overlayTitle = 'Słuchaj dźwięku wzorcowego…';
    overlaySub = targetName;
  } else if (phase === 'sing' && !started) {
    overlayTitle = 'Śpiewaj ten dźwięk na samogłosce [A]';
    overlaySub = 'Wykres ruszy, gdy usłyszę Twój głos';
  }

  const stats = result?.stats;
  const metricTiles = stats
    ? [
        {
          id: 'wobble',
          label: 'wahania wysokości',
          value: Number.isFinite(stats.wobbleAmplitudeCents) ? `±${formatDecimalPl(stats.wobbleAmplitudeCents / 100, 2)} półtonu` : '—',
          comment: `Cel: nie więcej niż ±${bandSemisLabel} półtonu`,
          color: '#8234c7'
        },
        {
          id: 'inband',
          label: 'czas w zielonym paśmie',
          value: `${Math.round(stats.inBandFraction * 100)}%`,
          comment: 'Tyle czasu Twój dźwięk mieścił się w zaznaczonym pasku',
          color: '#2f8f5b'
        },
        {
          id: 'offset',
          label: 'odchylenie od dźwięku',
          value: Number.isFinite(stats.medianOffsetCents)
            ? `${stats.medianOffsetCents > 0 ? '+' : ''}${Math.round(stats.medianOffsetCents)} ct`
            : '—',
          comment: !Number.isFinite(stats.medianOffsetCents)
            ? 'Brak odczytu'
            : Math.abs(stats.medianOffsetCents) <= 15
            ? 'Trafiasz w dźwięk wzorcowy'
            : stats.medianOffsetCents > 0
            ? 'Śpiewasz nieco za wysoko'
            : 'Śpiewasz nieco za nisko',
          color: '#256899'
        },
        {
          id: 'vibrato',
          label: 'regularne falowanie',
          value: stats.vibrato.hasVibrato ? `${formatDecimalPl(stats.vibrato.rateHz, 1)} Hz` : 'brak',
          comment: stats.vibrato.hasVibrato
            ? 'Wykryto regularne wibrato, w tym ćwiczeniu staramy się go uniknąć'
            : 'Nie wykryto regularnego wibrato',
          color: '#cc8822'
        }
      ]
    : [];

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white select-none">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-24 sm:pt-8 pb-8 flex flex-col items-center gap-5">
        <div className="w-full flex justify-start">
          <button
            type="button"
            onClick={() => { cancelRun(); onBack(); }}
            className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm"
          >
            ← Wróć do ćwiczeń
          </button>
        </div>

        <div className="text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">Ćwiczenie dla chórzystów</span>
          <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] uppercase drop-shadow-sm leading-tight">
            Minimalizacja wibrato
          </h1>
          <p className="text-sm sm:text-[15px] text-white/90 mt-1 tracking-wide">
            Utrzymaj dźwięk prosto, bez falowania. Wykres pokazuje Twój głos na żywo.
          </p>
        </div>

        {/* Wykres f0 */}
        <div className="w-full bg-black/35 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
          <div className="relative w-full h-[280px] sm:h-[340px]">
            <PitchPlot
              dataRef={dataRef}
              durationSec={SING_SECONDS}
              bandCents={VIBRATO_BAND_CENTS}
              bandLabel={`zielone pasmo: ${bandLabel}`}
              targetLabel={targetName}
              running={phase === 'sing'}
            />
            {overlayTitle && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                <span className={`font-seasons uppercase tracking-wider text-lg sm:text-2xl text-white/90 drop-shadow ${phase !== 'setup' ? 'animate-pulse' : ''}`}>
                  {overlayTitle}
                </span>
                <span className="text-sm text-white/70 mt-1 max-w-md">{overlaySub}</span>
              </div>
            )}
          </div>

          {(phase === 'sing' || phase === 'listen') && (
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
                    {!live ? (started ? 'Brak dźwięku…' : 'Czekam na głos…') : inBandNow ? 'W zielonym paśmie' : live.cents > 0 ? 'Odrobinę za wysoko' : 'Odrobinę za nisko'}
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

        {micProblem && (
          <div className="w-full max-w-2xl bg-rose-500/25 border border-rose-200/40 rounded-xl px-4 py-3 text-sm text-center">
            {mic.micState === 'denied'
              ? 'Brak dostępu do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki i spróbuj ponownie.'
              : 'Nie udało się uruchomić mikrofonu. Sprawdź, czy jest podłączony i nieużywany przez inną aplikację.'}
          </div>
        )}

        {/* Ustawienia przed startem */}
        {phase === 'setup' && (
          <div className="w-full max-w-3xl bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-5">
            <ol className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug list-decimal pl-5 flex flex-col gap-1.5">
              <li>Zagram dźwięk wzorcowy. Posłuchaj go uważnie.</li>
              <li>Zaśpiewaj ten dźwięk na samogłosce [A] i trzymaj go przez {SING_SECONDS} sekund, bez wibrato.</li>
              <li>Staraj się, by linia na wykresie mieściła się w zielonym pasku (±{bandSemisLabel} półtonu od dźwięku wzorcowego).</li>
              <li className="list-none -ml-5 pl-5 text-[13px] text-[#466cd2] opacity-90">
                Jeśli dźwięk jest dla Ciebie za wysoki lub za niski, śpiewaj oktawę niżej lub wyżej, aplikacja to uwzględni.
              </li>
            </ol>

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
                <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Rozpocznij ćwiczenie</button>
              </div>
            </div>
          </div>
        )}

        {/* Wyniki */}
        {phase === 'result' && result && stats && (
          <div className="w-full flex flex-col items-center gap-4">
            <div className="w-full max-w-3xl bg-white/45 backdrop-blur-md rounded-2xl border border-white/35 shadow-md px-6 py-5 text-center">
              <h2 className="font-seasons text-2xl tracking-wide" style={{ color: TONE_COLOR[result.feedback.tone] }}>
                {result.feedback.headline}
              </h2>
              <p className="font-cardo text-[15px] text-[#2c49a8] mt-1 leading-snug">{result.feedback.detail}</p>
            </div>

            {result.feedback.tone !== 'insufficient' && (
              <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-3.5">
                {metricTiles.map((item) => (
                  <div key={item.id} className="bg-white/40 backdrop-blur-md rounded-xl py-3 px-3 flex flex-col items-center justify-between text-center shadow-md border border-white/35 min-h-[114px] sm:min-h-[120px]">
                    <h3 className="font-seasons font-normal text-[14px] sm:text-[15px] text-[#18388f] leading-tight">{item.label}</h3>
                    <span className="font-seasons font-normal text-[17px] sm:text-[19px] tracking-wide my-0.5 leading-none" style={{ color: item.color }}>{item.value}</span>
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
