import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import MelodyPlot from './MelodyPlot';
import { BTN, BTN_PRIMARY, BTN_SMALL, MicProblem, NotePicker, ResultHeader, ResultTiles, Segmented, withItalics } from './exerciseUi';
import { useMicPitch, type PitchFrame } from '../../hooks/useMicPitch';
import { centsBetween, formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { audioDebug, pianoSampler } from '../../utils/pianoSampler';
import {
  TEMPOS,
  TRILL_PATTERNS,
  VOCAL_PATTERNS,
  lyricsText,
  buildTimeline,
  foldToRep,
  isSingTime,
  melodyFeedback,
  nearestNoteCents,
  sungRange,
  thirdAbove,
  playbackEvents,
  repAt,
  summarize,
  type Articulation,
  type MelodyKind,
  type MelodyFrame,
  type MelodySummary,
  type AlignedNote,
  type TempoId,
  type Timeline,
  type TrillFeedback,
  type TrillPattern
} from '../../utils/lipTrillExercise';

type Phase = 'setup' | 'loading' | 'running' | 'result';
type Stage = 'demo' | 'ready' | 'cue' | 'breath' | 'sing' | 'between';

const MIN_MIDI = 36; // C2
/** Najwyższy dźwięk ćwiczenia: C6 */
const MAX_MIDI = 84;
const LEAD_IN_SEC = 0.4;
const MOVING_SEMITONES = 0.5;

const HARMONY_INTRO = [
  'Usłyszysz melodię pianina (pryma na jednym dźwięku).',
  'Po każdym powtórzeniu usłyszysz Twój pierwszy dźwięk. Weź oddech i śpiewaj ten dźwięk na sylabach <i>ma-me-mi-mo-mu</i>. W tym samym czasie dźwięki pianina będą tercję niżej od Twojego głosu. Stwórz z nimi harmonię.',
  'Każde powtórzenie rozpoczyna się o {krok} wyżej, aż do najwyższego dźwięku, a następnie schodzi z każdym powtórzeniem coraz niżej.',
  'Możesz dopasować zakres dźwięków poniżej.'
];

const STAGE_LABEL: Record<Stage, string> = {
  demo: 'Posłuchaj melodii',
  ready: 'Przygotuj się',
  cue: 'Dźwięk początkowy',
  breath: 'Weź oddech',
  sing: 'Śpiewaj trylem',
  between: 'Przygotuj się'
};

const TILE_COLOR: Record<string, string> = {
  hits: '#2f8f5b',
  offset: '#256899',
  hardest: '#c0396b',
  flow: '#8234c7'
};

const CELL_CLASS = { hit: 'bg-emerald-500/80', off: 'bg-rose-500/75', silent: 'bg-white/30 border border-dashed border-[#466cd2]/40' } as const;

/** Domyślna liczba powtórzeń (krok półtonowy): środek skali, kilka dźwięków w górę i w dół */
const DEFAULT_REPS = 15;

/** Domyślny zakres: wokół środka skali z analizy głosu, tak by wyszło DEFAULT_REPS powtórzeń */
function defaultRange(mpfr: { lowMidi: number; highMidi: number } | null, sungSpan: number): [number, number] {
  const center = mpfr ? (mpfr.lowMidi + mpfr.highMidi) / 2 : 58;
  const width = sungSpan + (DEFAULT_REPS - 1) / 2;
  const lo = Math.max(MIN_MIDI, Math.min(MAX_MIDI - width, Math.round(center - width / 2)));
  return [lo, lo + width];
}

function stageAt(tl: Timeline, t: number): { stage: Stage; repIndex: number } {
  if (t < tl.demoT1) return { stage: 'demo', repIndex: -1 };
  const rep = repAt(tl, t);
  if (!rep) return { stage: 'ready', repIndex: -1 };
  if (t < rep.cue.t1) return { stage: 'cue', repIndex: rep.index };
  if (t < rep.singT0) return { stage: 'breath', repIndex: rep.index };
  if (t <= rep.singT1) return { stage: 'sing', repIndex: rep.index };
  return { stage: 'between', repIndex: rep.index };
}

interface Props {
  mpfr: { lowMidi: number; highMidi: number } | null;
  stageSwitcher?: ReactNode;
  onBack: () => void;
  /** Tryl albo rozśpiewka */
  variant?: MelodyKind;
  /** Rozśpiewka z harmonią */
  harmony?: boolean;
}

export default function LipTrillMelody({ mpfr, stageSwitcher, onBack, variant = 'trill', harmony = false }: Props) {
  const [headphones, setHeadphones] = useState<'yes' | 'no'>('yes');
  const vocal = variant === 'vocal';
  // harmonia
  const patterns = harmony ? VOCAL_PATTERNS.filter((p) => p.id === 'prima') : vocal ? VOCAL_PATTERNS : TRILL_PATTERNS;
  const [phase, setPhase] = useState<Phase>('setup');
  const [patternId, setPatternId] = useState<string>(patterns[0]?.id ?? 'third');
  const [articulation, setArticulation] = useState<Articulation>(vocal ? 'legato' : 'separate');
  const [tempo, setTempo] = useState<TempoId>('medium');
  const pattern = patterns.find((p) => p.id === patternId) ?? (patterns[0] as TrillPattern);
  // rozśpiewka
  const [syllableId, setSyllableId] = useState('mi-ja');
  const syllableOpt = pattern.syllableOptions?.find((o) => o.id === syllableId) ?? pattern.syllableOptions?.[0];
  const singText = syllableOpt ? `<i>${syllableOpt.label}</i>` : lyricsText(pattern) ?? '';
  // „na sylabach „mi-ja”” / „na sylabie „no””
  const syllablesPhrase = syllableOpt ? `${syllableOpt.id === 'mi-ja' ? 'sylabach' : 'sylabie'} ${singText}` : '';
  const vocalHint = syllableOpt?.hint ?? pattern.hint;
  const spanOf = (p: TrillPattern) => { const r = sungRange(p, harmony); return r.high - r.low; };
  const [range, setRange] = useState<[number, number]>(() => defaultRange(mpfr, spanOf(pattern)));
  // dopóki zakres nie był zmieniany ręcznie, zmiana wzoru ustawia domyślny zakres dla nowego wzoru
  const [rangeTouched, setRangeTouched] = useState(false);
  const [step, setStep] = useState<'1' | '2'>('1');
  const stepWord = step === '1' ? 'półton' : 'cały ton';
  const [lowMidi, highMidi] = range;
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [stage, setStage] = useState<{ stage: Stage; repIndex: number }>({ stage: 'demo', repIndex: -1 });
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<{ f0: number; cents: number } | null>(null);
  const [result, setResult] = useState<{ summary: MelodySummary; feedback: TrillFeedback } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const mic = useMicPitch({ holdPitch: vocal });
  const framesRef = useRef<MelodyFrame[]>([]);
  const timelineRef = useRef<Timeline | null>(null);
  const zeroRef = useRef(0);
  const clockRef = useRef<() => number>(() => -Infinity);
  const runIdRef = useRef(0);
  const finishedRef = useRef(true);
  const lastUiRef = useRef(0);
  const a4Ref = useRef(getCalibratedMidiFreq(69));
  const recentRawRef = useRef<number[]>([]);
  const debugFramesRef = useRef<[number, number | null, number][]>([]);

  const effectiveArticulation: Articulation = pattern.allowSeparate ? articulation : 'legato';
  // tryl oddzielnymi dźwiękami: krótkie dźwięki z drganiem warg
  const noPitch = !vocal && effectiveArticulation === 'separate';
  const tempoFactor = TEMPOS.find((t) => t.id === tempo)?.factor ?? 1;
  // pierwsza tonacja
  const sung = sungRange(pattern, harmony);
  const sungSpan = sung.high - sung.low;
  const startMidi = lowMidi - sung.low;
  const topStartMidi = Math.max(startMidi, highMidi - sung.high);
  const firstStep = pattern.notes[0]?.step ?? 0;
  const firstSungMidi = startMidi + firstStep + (harmony ? thirdAbove(firstStep) : 0);
  const timelineOpts = { pattern, startMidi, topStartMidi, step: Number(step), tempoFactor, articulation: effectiveArticulation, harmony };
  const plan = useMemo(() => buildTimeline(timelineOpts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pattern, startMidi, topStartMidi, step, tempoFactor, effectiveArticulation, harmony]);
  const reps = plan.reps.length;
  const approxSec = Math.round(plan.end);
  const relToMpfr = (m: number, edge: 'low' | 'high') => {
    if (!mpfr) return '';
    const d = edge === 'low' ? Math.round(mpfr.lowMidi) - m : m - Math.round(mpfr.highMidi);
    if (d <= 0) return 'w Twoim zakresie';
    return d === 1 ? 'półton poza Twoim zakresem' : d === 2 ? 'cały ton poza Twoim zakresem' : `${d} półtony poza zakresem`;
  };

  useEffect(() => () => {
    runIdRef.current++;
    pianoSampler.stopAll();
  }, []);

  // zmiana wzoru
  const choosePattern = (id: string) => {
    const p = patterns.find((x) => x.id === id);
    if (!p) return;
    stopListening();
    setPatternId(id);
    if (!rangeTouched) { setRange(defaultRange(mpfr, spanOf(p))); return; }
    setRange(([lo, hi]) => {
      const r = sungRange(p, harmony);
      const span = r.high - r.low;
      const top = Math.max(hi, lo + span);
      return top <= MAX_MIDI ? [lo, top] : [MAX_MIDI - span, MAX_MIDI];
    });
  };

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();
    pianoSampler.stopAll();
    const tl = timelineRef.current;
    if (!tl) return;
    const now = clockRef.current();
    const summary = summarize(framesRef.current, tl, now + 0.01);
    const feedback = melodyFeedback(summary, effectiveArticulation, midiToNoteName, variant);
    audioDebug('melody run', {
      variant, pattern: pattern.id, tempoFactor, articulation: effectiveArticulation, startMidi, topStartMidi, step,
      reps: summary.reps.map((r) => ({
        start: r.rep.startMidi, singT0: Math.round(r.rep.singT0 * 1000) / 1000,
        notes: r.notes.map((n) => [n.status, Math.round(n.medianCents), Math.round((n as AlignedNote).t0 * 1000) / 1000, Math.round((n as AlignedNote).t1 * 1000) / 1000])
      })),
      frames: debugFramesRef.current
    });
    // wyniki są podsumowane słownie i w tabeli powtórzeń
    setResult({ summary, feedback });
    setLive(null);
    setPhase('result');
  };

  const onFrame = (f: PitchFrame) => {
    if (finishedRef.current) return;
    const tl = timelineRef.current;
    if (!tl) return;
    const t = f.time - zeroRef.current;
    if (t > tl.end) { finish(); return; }

    // zapisujemy tylko czas śpiewania
    const rep = isSingTime(tl, t);
    let cents = NaN;
    if (rep) {
      // zapisujemy surową wysokość
      const raw = f.f0 !== null ? 69 + centsBetween(f.f0, a4Ref.current) / 100 : NaN;
      // na wykresie mediana z 3 ostatnich ramek
      const hist = recentRawRef.current;
      hist.push(raw);
      if (hist.length > 3) hist.shift();
      const fin = hist.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
      const shown = Number.isFinite(raw) ? (fin.length === 2 ? ((fin[0] as number) + (fin[1] as number)) / 2 : (fin[fin.length >> 1] as number)) : NaN;
      const midi = Number.isFinite(shown) ? foldToRep(rep, shown) : NaN;
      const moving = fin.length >= 2 && (fin[fin.length - 1] as number) - (fin[0] as number) > MOVING_SEMITONES;
      cents = Number.isFinite(midi) && !moving ? nearestNoteCents(rep, midi) : NaN;
      framesRef.current.push({ t, midi, cents, raw });
      debugFramesRef.current.push([Math.round(t * 1000) / 1000, Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null, Math.round(f.rms * 10000) / 10000]);
    } else recentRawRef.current = [];

    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      setStage(stageAt(tl, t));
      setProgress(Math.min(1, Math.max(0, t / tl.end)));
      setLive(rep && f.f0 !== null ? { f0: f.f0, cents } : null);
    }
  };

  const begin = async () => {
    stopListening();
    const runId = ++runIdRef.current;
    const stale = () => runId !== runIdRef.current;
    pianoSampler.stopAll();
    mic.stopLoop();
    setLoadError(false);
    const ok = await mic.open();
    if (!ok || stale()) return;

    const tl = buildTimeline(timelineOpts);
    const events = playbackEvents(tl);
    setPhase('loading');
    const loaded = await pianoSampler.load(events.map((e) => e.midi));
    if (stale()) return;
    if (!loaded) {
      mic.close();
      setLoadError(true);
      setPhase('setup');
      return;
    }

    framesRef.current = [];
    recentRawRef.current = [];
    debugFramesRef.current = [];
    timelineRef.current = tl;
    finishedRef.current = false;
    lastUiRef.current = 0;
    a4Ref.current = getCalibratedMidiFreq(69);
    setTimeline(tl);
    setResult(null);
    setLive(null);
    setProgress(0);
    setStage({ stage: 'demo', repIndex: -1 });

    const startCtx = pianoSampler.now() + LEAD_IN_SEC;
    // harmonia bez słuchawek
    const quiet = harmony && headphones === 'no';
    for (const e of events) void pianoSampler.play(e.midi, startCtx + e.t0, e.dur, quiet && e.t0 >= tl.demoT1 ? 0.36 : 0.85);
    zeroRef.current = performance.now() / 1000 + LEAD_IN_SEC + pianoSampler.outputLatency();
    clockRef.current = () => performance.now() / 1000 - zeroRef.current;

    setPhase('running');
    mic.startLoop(onFrame);
  };

  const cancelRun = () => {
    runIdRef.current++;
    finishedRef.current = true;
    pianoSampler.stopAll();
    mic.close();
    setPhase('setup');
    setLive(null);
  };

  const preview = async () => {
    setPreviewing(true);
    const ok = await pianoSampler.load([firstSungMidi]);
    if (ok) await pianoSampler.play(firstSungMidi, pianoSampler.now() + 0.05, 1.2);
    else setLoadError(true);
    window.setTimeout(() => setPreviewing(false), 1300);
  };

  const [listening, setListening] = useState(false);
  const listenTimerRef = useRef<number | null>(null);
  const stopListening = () => {
    if (listenTimerRef.current !== null) window.clearTimeout(listenTimerRef.current);
    listenTimerRef.current = null;
    pianoSampler.stopAll();
    setListening(false);
  };
  const listen = async (factor = tempoFactor) => {
    stopListening();
    const tl = buildTimeline({ ...timelineOpts, tempoFactor: factor });
    // odsłuch przed ćwiczeniem
    const notes = [...tl.demo, ...(tl.demoAccomp ?? [])].filter((n) => n.midiFrom === n.midiTo);
    setListening(true);
    const ok = await pianoSampler.load(notes.map((n) => n.midiFrom));
    if (!ok) { setLoadError(true); setListening(false); return; }
    const t0 = pianoSampler.now() + 0.1;
    for (const n of notes) void pianoSampler.play(n.midiFrom, t0 + n.t0, n.t1 - n.t0);
    listenTimerRef.current = window.setTimeout(() => { listenTimerRef.current = null; setListening(false); }, (tl.demoT1 + 0.6) * 1000);
  };
  const chooseTempo = (id: TempoId) => {
    setTempo(id);
    if (listening) void listen(TEMPOS.find((t) => t.id === id)?.factor ?? 1);
  };
  useEffect(() => () => { if (listenTimerRef.current !== null) window.clearTimeout(listenTimerRef.current); }, []);

  const sungAnything = stage.repIndex >= 0;
  const currentRep = timeline && stage.repIndex >= 0 ? timeline.reps[stage.repIndex] : null;
  const liveHit = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= 50;

  return (
    <>
      {phase === 'running' && (
        <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
          <div className="relative w-full h-[280px] sm:h-[340px]">
            <MelodyPlot timeline={timeline} framesRef={framesRef} clockRef={clockRef} viewRep={null} noteName={midiToNoteName} hidePitch={noPitch} />
          </div>

          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-[11px] text-white/60">
            <span className="flex items-center gap-2"><span className="inline-block w-5 h-3 rounded border border-dashed border-white/60" />{harmony ? 'melodia z pianina' : 'dźwięk początkowy'}</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 h-3 rounded bg-white/25 border border-white/60" />{harmony ? 'Twoja harmonia' : 'dźwięki melodii'}</span>
            {!noPitch && <span className="flex items-center gap-2"><span className="inline-block w-5 h-3 rounded bg-emerald-400/40 border border-emerald-400" />trafiony</span>}
            {!noPitch && <span className="flex items-center gap-2"><span className="inline-block w-5 h-3 rounded bg-rose-500/30 border border-rose-500" />nietrafiony</span>}
          </div>

          {phase === 'running' && (
            <div className="w-full flex flex-col gap-2">
              <div className="w-full flex items-center justify-between text-xs sm:text-sm">
                <div className="flex flex-col items-start">
                  <span className="text-white/50 text-[10px] uppercase tracking-wider">Powtórzenie</span>
                  <span className="font-seasons text-base">
                    {currentRep ? `${currentRep.index + 1} / ${reps}` : 'pokaz'}
                    {currentRep && <span className="text-xs text-white/70 font-cardo"> (od {midiToNoteName(currentRep.startMidi)})</span>}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className={`text-[11px] font-semibold tracking-wider uppercase ${stage.stage === 'sing' ? 'text-emerald-300' : 'text-white/80'}`}>
                    {stage.stage === 'sing' && harmony ? 'Śpiewaj tercję wyżej' : stage.stage === 'sing' && vocal ? withItalics(`Śpiewaj ${singText}`) : stage.stage === 'demo' && harmony ? 'Posłuchaj swojej melodii' : STAGE_LABEL[stage.stage]}
                  </span>
                  {!noPitch && (
                    <span className={`text-xs font-bold font-mono ${!live || !Number.isFinite(live.cents) ? 'text-white/40' : liveHit ? 'text-emerald-400' : 'text-amber-300'}`}>
                      {live && Number.isFinite(live.cents) ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
                    </span>
                  )}
                </div>
                <div className={`flex flex-col items-end ${noPitch ? 'invisible' : ''}`}>
                  <span className="text-white/50 text-[10px] uppercase tracking-wider">Twój głos</span>
                  <span className={`font-seasons text-base ${live ? 'text-emerald-400' : 'text-white/40'}`}>
                    {live ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz'}
                  </span>
                </div>
              </div>
              <div className="w-full flex items-center gap-3">
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <button type="button" onClick={sungAnything ? finish : cancelRun} className={BTN_SMALL}>
                  {sungAnything ? 'Zakończ' : 'Anuluj'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <MicProblem state={mic.micState} />

      {phase === 'loading' && (
        <div className="w-full max-w-md bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md px-6 py-5 text-center text-[#2c49a8] font-cardo">
          Wczytywanie dźwięków pianina…
        </div>
      )}

      {phase === 'setup' && (
        <div className="w-full flex-1 flex items-center justify-center">
          <div className="w-full max-w-3xl sm:pointer-events-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-4">
            {stageSwitcher}
            <ol className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5 list-none">
              {harmony ? (
                HARMONY_INTRO.map((line) => <li key={line}>{withItalics(line.split('{krok}').join(stepWord).split('{sylaby}').join(syllablesPhrase || `sylabach ${singText}`))}</li>)
              ) : vocal && pattern.intro ? (
                pattern.intro.map((line) => <li key={line}>{withItalics(line.split('{krok}').join(stepWord).split('{sylaby}').join(syllablesPhrase))}</li>)
              ) : (
                <>
                  <li>Usłyszysz melodię pianina. Posłuchaj jej i zobacz, jak układają się dźwięki.</li>
                  <li>Następnie usłyszysz pierwszy dźwięk melodii. Weź oddech i powtórz zapamiętaną melodię trylem.</li>
                  <li>Każde kolejne powtórzenie rozpoczyna się o {stepWord} wyżej, aż melodia dojdzie do najwyższego dźwięku. Potem początkowe dźwięki będą rozpoczynać się o {stepWord} niżej w każdym powtórzeniu.</li>
                  <li>Możesz śpiewać tryl legato lub z przerwami między kolejnymi dźwiękami. Najlepiej wykonać ćwiczenie na oba sposoby.</li>
                </>
              )}
              <li className="text-[13px] text-[#466cd2] opacity-90">
                {vocal
                  ? withItalics(vocalHint ?? '')
                  : effectiveArticulation === 'separate'
                  ? 'Oddzielne dźwięki: rób przerwy między kolejnymi dźwiękami. Każdy z nich śpiewaj trylem. Ze względu na krótkie brzmienie dźwięków aplikacja nie będzie mierzyć Twojej intonacji.'
                  : 'Legato: prowadź tryl płynnie przez całą melodię, bez przerw. Możesz obserwować na bieżąco swoją intonację.'}
              </li>
            </ol>

            {harmony && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-70">Słuchawki</span>
                  <Segmented value={headphones} onChange={setHeadphones} options={[{ id: 'yes', label: 'tak' }, { id: 'no', label: 'nie' }]} />
                </div>
                <p className="font-cardo text-[13px] text-[#466cd2] leading-snug">To ćwiczenie najlepiej wykonywać w słuchawkach – wtedy mikrofon rejestruje tylko Twój głos. Bez słuchawek melodia gra ciszej.</p>
              </div>
            )}

            {patterns.length > 1 && (
            <div className={`grid gap-2 ${patterns.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {patterns.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePattern(p.id)}
                  className={`text-left rounded-xl px-3 py-2 border transition-all cursor-pointer ${
                    p.id === patternId ? 'bg-white/85 border-white shadow-md' : 'bg-white/30 border-white/40 hover:bg-white/50'
                  }`}
                >
                  <span className="block font-seasons text-[14px] leading-tight">{p.name}</span>
                  <span className="block font-cardo text-[11.5px] text-[#466cd2] leading-snug mt-0.5">{withItalics(p.description)}</span>
                </button>
              ))}
            </div>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {vocal && pattern.syllableOptions && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-70">Sylaby</span>
                  <Segmented value={syllableOpt?.id ?? 'mi-ja'} onChange={setSyllableId} options={pattern.syllableOptions.map((o) => ({ id: o.id, label: `<i>${o.label}</i>` }))} />
                </div>
              )}
              {!vocal && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-70">Sposób</span>
                  <Segmented
                    value={effectiveArticulation}
                    onChange={setArticulation}
                    options={[
                      { id: 'separate', label: 'oddzielne dźwięki', disabled: !pattern.allowSeparate },
                      { id: 'legato', label: 'legato' }
                    ]}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider opacity-70">Tempo</span>
                <Segmented value={tempo} onChange={chooseTempo} options={TEMPOS.map((t) => ({ id: t.id, label: t.label }))} />
                <button
                  type="button"
                  onClick={() => (listening ? stopListening() : void listen())}
                  className={BTN_SMALL}
                  title="Melodia w wybranym tempie, od najniższego dźwięku"
                >
                  {listening ? '■ Zatrzymaj' : '♪ Posłuchaj'}
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
              <NotePicker
                midi={lowMidi}
                onChange={(m) => { setRangeTouched(true); setRange([m, Math.max(highMidi, m + sungSpan)]); }}
                min={MIN_MIDI}
                max={MAX_MIDI - sungSpan}
                label="Najniższy dźwięk"
                sub={relToMpfr(lowMidi, 'low')}
                noteName={midiToNoteName}
              />
              <NotePicker
                midi={highMidi}
                onChange={(m) => { setRangeTouched(true); setRange([Math.min(lowMidi, m - sungSpan), m]); }}
                min={MIN_MIDI + sungSpan}
                max={MAX_MIDI}
                label="Najwyższy dźwięk"
                sub={relToMpfr(highMidi, 'high')}
                noteName={midiToNoteName}
              />
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider opacity-70">Krok</span>
                <Segmented value={step} onChange={setStep} options={[{ id: '1', label: 'półton' }, { id: '2', label: 'cały ton' }]} />
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={() => void preview()} disabled={previewing} className={BTN}>♪ Dźwięk startowy</button>
                <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Rozpocznij</button>
              </div>
            </div>
            <p className="text-[12px] text-[#466cd2] text-center -mt-1">
              {mpfr
                ? `Zakres z Twojej analizy głosu: ${midiToNoteName(Math.round(mpfr.lowMidi))} – ${midiToNoteName(Math.round(mpfr.highMidi))}. Domyślnie ćwiczenie obejmuje środek tej skali. `
                : 'Wykonaj analizę głosu, by dopasować zakres ćwiczenia do swojej skali. '}
              {reps} powtórzeń, ok. {approxSec < 90 ? `${approxSec} s` : `${Math.round(approxSec / 60)} min`}.
            </p>
            {loadError && (
              <p className="text-[13px] text-rose-700 text-center">
                Nie udało się wczytać nagrań pianina. Sprawdź, czy pliki są w folderze /grand-piano.
              </p>
            )}
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={result.feedback.tone} headline={result.feedback.headline} detail={result.feedback.detail} />
          <ResultTiles rows={result.feedback.rows} colors={TILE_COLOR} />

          {result.summary.reps.length > 0 && !noPitch && (
            <div className="w-full bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-4 text-[#18388f]">
              <p className="font-cardo text-[13px] text-[#466cd2] mb-2 text-center">Trafione dźwięki w kolejnych powtórzeniach</p>
              <div className="flex flex-col gap-1">
                {result.summary.reps.map((r) => (
                  <div key={r.rep.index} className="flex items-center gap-3 rounded-lg px-3 py-1.5">
                    <span className="font-seasons text-[13px] w-16 text-left">od {midiToNoteName(r.rep.startMidi)}</span>
                    <span className="flex gap-1 flex-1">
                      {r.notes.map((n, k) => (
                        <span key={k} className={`h-3.5 flex-1 max-w-[28px] rounded-sm ${CELL_CLASS[n.status]}`} />
                      ))}
                    </span>
                    <span className="font-cardo text-[12px] text-[#466cd2] w-12 text-right">{r.hits}/{r.notes.length}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4 mt-1 pb-6">
            <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={() => setPhase('setup')} className={BTN}>Zmień ustawienia</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </div>
        </div>
      )}
    </>
  );
}
