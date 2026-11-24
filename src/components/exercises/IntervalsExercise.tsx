import { useEffect, useRef, useState } from 'react';
import MelodyPlot from './MelodyPlot';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  Instructions,
  LegendItem,
  LightCard,
  MicProblem,
  NotePicker,
  PlotCard,
  ResultActions,
  ResultHeader,
  ResultTiles,
  Segmented,
  SetupCard,
  StatusRow,
  readMpfrRange
} from './exerciseUi';
import { useMicPitch, type PitchFrame } from '../../hooks/useMicPitch';
import { centsBetween, formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { pianoSampler } from '../../utils/pianoSampler';
import { alignRep, foldToRep, isSingTime, nearestNoteCents, repAt, type MelodyFrame, type NoteStatus, type Timeline } from '../../utils/lipTrillExercise';
import {
  INTERVALS,
  INTERVAL_ROUNDS,
  buildIntervalTimeline,
  intervalFeedback,
  intervalPlayback,
  intervalRounds,
  intervalDirections,
  type Feedback,
  type IntervalRound
} from '../../utils/popExercises';

type Phase = 'setup' | 'loading' | 'running' | 'result';
const LEAD_IN_SEC = 0.4;

export default function IntervalsExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [semis, setSemis] = useState(6);
  const [dir, setDir] = useState<'up' | 'down' | 'both'>('up');
  const [phase, setPhase] = useState<Phase>('setup');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [status, setStatus] = useState<{ label: string; round: number }>({ label: '', round: -1 });
  const [live, setLive] = useState<{ f0: number; cents: number } | null>(null);
  const [result, setResult] = useState<{ fb: Feedback; rounds: IntervalRound[] } | null>(null);
  const [viewRep, setViewRep] = useState<number | null>(null);
  const [noteStatuses, setNoteStatuses] = useState<{ status: NoteStatus; t0: number; t1: number }[][]>([]);
  const a4Ref = useRef(getCalibratedMidiFreq(69));
  const [loadError, setLoadError] = useState(false);

  const mic = useMicPitch();
  const framesRef = useRef<MelodyFrame[]>([]);
  const tlRef = useRef<Timeline | null>(null);
  const zeroRef = useRef(0);
  const clockRef = useRef<() => number>(() => -Infinity);
  const runRef = useRef(0);
  const finishedRef = useRef(true);
  const lastUiRef = useRef(0);
  const startsRef = useRef<number[]>([]);
  const upsRef = useRef<boolean[]>([]);
  const [rounds, setRounds] = useState(INTERVAL_ROUNDS);
  const [range, setRange] = useState<[number, number]>(() => (mpfr ? [Math.round(mpfr.lowMidi), Math.round(mpfr.highMidi)] : [48, 69]));
  const [lowMidi, highMidi] = range;
  const roundsRef = useRef(INTERVAL_ROUNDS);
  const interval = INTERVALS.find((i) => i.semis === semis) ?? INTERVALS[5];

  useEffect(() => () => { runRef.current++; pianoSampler.stopAll(); }, []);

  const startRange = (up: boolean): [number, number] => {
    const lo = up ? lowMidi : lowMidi + semis;
    const hi = up ? highMidi - semis : highMidi;
    return hi >= lo ? [lo, hi] : [Math.round((lo + hi) / 2), Math.round((lo + hi) / 2)];
  };
  const rangeTooSmall = highMidi - lowMidi < semis;

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    mic.close();
    pianoSampler.stopAll();
    const tl = tlRef.current;
    if (!tl) return;
    const now = clockRef.current();
    const done = tl.reps.filter((r) => r.singT1 <= now + 0.01);
    const aligned = done.map((r) => alignRep(framesRef.current, r));
    const pairs = aligned.map((a) => a.notes.map((n) => n.medianCents) as [number, number]);
    // wykres wyników: wysokość po wyrównaniu i kolory nut z oceny
    framesRef.current = aligned.flatMap((a) => a.frames).sort((x, y) => x.t - y.t);
    setNoteStatuses(aligned.map((a) => a.notes.map((n) => ({ status: n.status, t0: n.t0, t1: n.t1 }))));
    const rounds = intervalRounds(pairs, startsRef.current, upsRef.current);
    setResult({ fb: intervalFeedback(rounds, interval.name), rounds });
    setViewRep(rounds.length ? 0 : null);
    setLive(null);
    setPhase('result');
  };

  const onFrame = (f: PitchFrame) => {
    const tl = tlRef.current;
    if (finishedRef.current || !tl) return;
    const t = f.time - zeroRef.current;
    if (t > tl.end) { finish(); return; }
    const rep = isSingTime(tl, t);
    let cents = NaN;
    if (rep) {
      // surowa wysokość
      const raw = f.f0 !== null ? 69 + centsBetween(f.f0, a4Ref.current) / 100 : NaN;
      const midi = Number.isFinite(raw) ? foldToRep(rep, raw) : NaN;
      cents = Number.isFinite(midi) ? nearestNoteCents(rep, midi) : NaN;
      framesRef.current.push({ t, midi, cents, raw });
    }
    if (f.time - lastUiRef.current > 0.08) {
      lastUiRef.current = f.time;
      const r = repAt(tl, t);
      const label = !r ? 'Przygotuj się'
        : t < (r.cueNotes?.[r.cueNotes.length - 1]?.t1 ?? r.cue.t1) ? ((r.cueNotes?.length ?? 1) > 1 ? 'Posłuchaj interwału' : 'Pierwszy dźwięk')
        : t < r.singT0 ? 'Weź oddech'
        : t <= r.singT1 ? 'Śpiewaj oba dźwięki' : 'Przygotuj się';
      setStatus({ label, round: r?.index ?? -1 });
      setLive(rep && f.f0 !== null ? { f0: f.f0, cents } : null);
    }
  };

  const begin = async () => {
    const run = ++runRef.current;
    pianoSampler.stopAll();
    mic.stopLoop();
    setLoadError(false);
    if (!(await mic.open()) || run !== runRef.current) return;
    const ups = intervalDirections(dir, rounds);
    upsRef.current = ups;
    roundsRef.current = rounds;
    const starts: number[] = [];
    for (const up of ups) {
      const [lo, hi] = startRange(up);
      const all = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
      const unused = all.filter((m) => !starts.includes(m));
      const pool = unused.length ? unused : all.filter((m) => m !== starts[starts.length - 1]);
      const choice = pool.length ? pool : all;
      starts.push(choice[Math.floor(Math.random() * choice.length)] ?? lo);
    }
    startsRef.current = starts;
    const tl = buildIntervalTimeline(starts, semis, ups);
    const events = intervalPlayback(tl);
    setPhase('loading');
    const ok = await pianoSampler.load(events.map((e) => e.midi));
    if (run !== runRef.current) return;
    if (!ok) { mic.close(); setLoadError(true); setPhase('setup'); return; }
    framesRef.current = [];
    tlRef.current = tl;
    setTimeline(tl);
    setResult(null);
    setViewRep(null);
    finishedRef.current = false;
    lastUiRef.current = 0;
    const startCtx = pianoSampler.now() + LEAD_IN_SEC;
    for (const e of events) void pianoSampler.play(e.midi, startCtx + e.t0, e.dur);
    zeroRef.current = performance.now() / 1000 + LEAD_IN_SEC + pianoSampler.outputLatency();
    clockRef.current = () => performance.now() / 1000 - zeroRef.current;
    setPhase('running');
    mic.startLoop(onFrame);
  };

  const cancel = () => { runRef.current++; finishedRef.current = true; pianoSampler.stopAll(); mic.close(); setPhase('setup'); };
  const liveOk = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= 50;
  const progress = timeline ? Math.max(0, Math.min(1, clockRef.current() / timeline.end)) : 0;

  return (
    <ExercisePage kicker="Ćwiczenie dla śpiewaków rozrywkowych" title="Trudne interwały" subtitle={`${interval.name} ${dir === 'up' ? 'w górę' : dir === 'down' ? 'w dół' : 'w obu kierunkach'}`} onBack={() => { cancel(); onBack(); }}>
      {(phase === 'running' || phase === 'result') && (
        <PlotCard
          plot={<MelodyPlot timeline={timeline} framesRef={framesRef} clockRef={clockRef} viewRep={phase === 'result' ? viewRep : null} statuses={noteStatuses} noteName={midiToNoteName} />}
          legend={
            <>
              <LegendItem swatch="w-5 h-3 rounded border border-dashed border-white/60">dźwięki z pianina</LegendItem>
              <LegendItem swatch="w-5 h-3 rounded bg-white/25 border border-white/60">do zaśpiewania</LegendItem>
              <LegendItem swatch="w-5 h-3 rounded bg-emerald-400/40 border border-emerald-400">trafiony</LegendItem>
              <LegendItem swatch="w-5 h-3 rounded bg-rose-500/30 border border-rose-500">nietrafiony</LegendItem>
            </>
          }
        >
          {phase === 'running' && (
            <StatusRow
              left={{ label: 'Próba', value: status.round >= 0 ? `${status.round + 1} / ${roundsRef.current}` : '—' }}
              center={status.label}
              centerClass={status.label.startsWith('Śpiewaj') ? 'text-emerald-300' : 'text-white/80'}
              centerSub={live && Number.isFinite(live.cents) ? <span className={liveOk ? 'text-emerald-400' : 'text-amber-300'}>{`${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów`}</span> : '—'}
              right={{ label: 'Twój głos', value: live ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
              progress={progress}
              button={{ label: status.round >= 0 ? 'Zakończ' : 'Anuluj', onClick: status.round >= 0 ? finish : cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={mic.micState} />
      {phase === 'loading' && <p className="font-cardo text-white/80">Wczytywanie dźwięków pianina…</p>}

      {phase === 'setup' && (
        <SetupCard>
          <Instructions
            steps={[
              'W pierwszej próbie usłyszysz pełny interwał. Weź oddech i zaśpiewaj te dźwięki (na <i>a</i> albo <i>la</i>).',
              'W kolejnych próbach usłyszysz tylko pierwszy dźwięk. Zaśpiewaj pełny interwał od tego dźwięku. Każda próba zaczyna się od losowego dźwięku z wybranego zakresu.',
              'Docelowa wysokość dźwięków jest zaznaczona na wykresie. Aplikacja od razu pokaże, czy udało Ci się zaśpiewać interwał poprawnie.',
              'Poniżej możesz wybrać interwał do ćwiczeń, kierunek śpiewu, zakres dźwięków i liczbę prób. Domyślnie zakres dźwięków to Twoja skala z analizy głosu.'
            ]}
            note="Każdy interwał jest łatwiej zapamiętać, jeśli skojarzysz go z melodią, która się od niego zaczyna."
            numbered={false}
          />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {INTERVALS.map((i) => (
              <button key={i.semis} type="button" onClick={() => setSemis(i.semis)}
                className={`rounded-xl px-2 py-1.5 border text-[13px] font-cardo cursor-pointer transition-all ${i.semis === semis ? 'bg-white/85 border-white shadow-md text-[#18388f]' : 'bg-white/30 border-white/40 hover:bg-white/50 text-[#2c49a8]'}`}>
                {i.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Kierunek</span>
              <Segmented value={dir} onChange={setDir} options={[{ id: 'up', label: 'w górę' }, { id: 'down', label: 'w dół' }, { id: 'both', label: 'oba' }]} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            <NotePicker midi={lowMidi} onChange={(m) => setRange([m, Math.max(highMidi, m + semis)])} min={36} max={84 - semis} label="Najniższy dźwięk" noteName={midiToNoteName} />
            <NotePicker midi={highMidi} onChange={(m) => setRange([Math.min(lowMidi, m - semis), m])} min={36 + semis} max={84} label="Najwyższy dźwięk" noteName={midiToNoteName} />
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Liczba prób</span>
              <button type="button" aria-label="Mniej prób" onClick={() => setRounds((n) => Math.max(3, n - 1))} disabled={rounds <= 3} className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/80 text-[#466cd2] cursor-pointer disabled:opacity-40">−</button>
              <span className="font-seasons text-xl tabular-nums w-6 text-center">{rounds}</span>
              <button type="button" aria-label="Więcej prób" onClick={() => setRounds((n) => Math.min(15, n + 1))} disabled={rounds >= 15} className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/80 text-[#466cd2] cursor-pointer disabled:opacity-40">+</button>
            </div>
            <button type="button" onClick={() => void begin()} disabled={rangeTooSmall} className={BTN_PRIMARY}>Rozpocznij</button>
          </div>
          {loadError && <p className="text-[13px] text-rose-700 text-center">Nie udało się wczytać nagrań pianina. Sprawdź, czy pliki są w folderze /grand-piano.</p>}
        </SetupCard>
      )}

      {phase === 'result' && result && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={result.fb.tone} headline={result.fb.headline} detail={result.fb.detail} />
          <ResultTiles rows={result.fb.rows} colors={{ clean: '#2f8f5b', error: '#256899', first: '#8234c7', second: '#c0396b' }} />
          {result.rounds.length > 0 && (
            <LightCard>
              <p className="font-cardo text-[13px] text-[#466cd2] mb-2 text-center">Kliknij próbę, aby zobaczyć ją na wykresie</p>
              <div className="flex flex-col gap-1">
                {result.rounds.map((r, i) => (
                  <button key={i} type="button" onClick={() => setViewRep(i)}
                    className={`flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 cursor-pointer ${viewRep === i ? 'bg-white/80 shadow-sm' : 'hover:bg-white/40'}`}>
                    <span className="font-seasons text-[13px]">{i + 1}. {midiToNoteName(r.startMidi)} → {midiToNoteName(r.startMidi + (r.up ? semis : -semis))}</span>
                    <span className={`font-cardo text-[13px] ${r.clean ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {!r.sung ? 'nie zaśpiewano' : `${r.intervalError > 0 ? 'za szeroko' : r.intervalError < 0 ? 'za wąsko' : 'idealnie'} ${Math.abs(Math.round(r.intervalError))} ct ${r.clean ? '✓' : '✗'}`}
                    </span>
                  </button>
                ))}
              </div>
            </LightCard>
          )}
          <ResultActions>
            <button type="button" onClick={() => void begin()} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={() => setPhase('setup')} className={BTN}>Zmień ustawienia</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
