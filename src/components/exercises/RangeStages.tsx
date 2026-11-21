import { useMemo, useRef, useState, type ReactNode } from 'react';
import GlidePlot from './GlidePlot';
import PitchPlot from './PitchPlot';
import {
  BTN,
  BTN_PRIMARY,
  Instructions,
  LegendItem,
  MicProblem,
  NotePicker,
  PlotCard,
  ResultActions,
  ResultHeader,
  ResultTiles,
  SetupCard,
  StatusRow
} from './exerciseUi';
import { useTake } from '../../hooks/useTake';
import type { AttemptData } from '../../utils/vibratoExercise';
import { centsBetween, formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { analyzeGlide, filterOctaveErrors, type GlideData, type MpfrRange } from '../../utils/yawnSighExercise';

const noteName = (m: number) => midiToNoteName(m);
const semis = (n: number) => (n === 1 ? 'półton' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'półtony' : 'półtonów');


/** Nagranie syreny kończy cisza (endOnSilenceSec) */
const SIREN_MAX_SEC = 90;
/** Najkrótsza oś czasu wykresu syreny [s] */
const SIREN_PLOT_SEC = 12;

const WAVE_MIN_SEMIS = 4;

export function countWaves(midi: number[]): number {
  const v = midi.filter(Number.isFinite);
  let turns = 0, dir = 0, ext = v[0] ?? 0;
  for (const m of v) {
    if (dir === 0) {
      // kierunek ustalamy dopiero po wyraźnym ruchu od punktu startu
      if (m - ext >= WAVE_MIN_SEMIS) { dir = 1; ext = m; } else if (ext - m >= WAVE_MIN_SEMIS) { dir = -1; ext = m; }
    } else if (dir === 1) {
      if (m > ext) ext = m; else if (ext - m >= WAVE_MIN_SEMIS) { turns++; dir = -1; ext = m; }
    } else {
      if (m < ext) ext = m; else if (m - ext >= WAVE_MIN_SEMIS) { turns++; dir = 1; ext = m; }
    }
  }
  return dir === 0 ? 0 : Math.round((turns + 1) / 2);
}

export function SirenStage({ mpfr, stageSwitcher, onPeak, onBack, next }: {
  mpfr: MpfrRange | null;
  stageSwitcher: ReactNode;
  onPeak: (midi: number) => void;
  onBack: () => void;
  next?: { label: string; go: () => void };
}) {
  const take = useTake();
  const dataRef = useRef<GlideData>({ t: [], midi: [] });
  const validRef = useRef<number[]>([]);
  const [previous, setPrevious] = useState<GlideData[]>([]);
  const [result, setResult] = useState<{ tone: 'good' | 'ok' | 'insufficient'; headline: string; detail: string; rows: { id: string; label: string; value: string; comment: string }[] } | null>(null);
  const a4 = getCalibratedMidiFreq(69);

  const start = () => {
    if (dataRef.current.t.length && result && result.tone !== 'insufficient') setPrevious((p) => [...p, dataRef.current].slice(-3));
    dataRef.current = { t: [], midi: [] };
    validRef.current = [];
    setResult(null);
    void take.run({
      maxSec: SIREN_MAX_SEC,
      endOnSilenceSec: 1,
      minSoundSec: 2,
      onFrame: (f) => {
        let m = f.f0 !== null ? 69 + centsBetween(f.f0, a4) / 100 : NaN;
        m = filterOctaveErrors(validRef.current, m);
        if (Number.isFinite(m)) validRef.current.push(m);
        dataRef.current.t.push(f.t);
        dataRef.current.midi.push(m);
      },
      onDone: () => {
        const g = analyzeGlide(dataRef.current, 30);
        if (!g.sufficient) {
          setResult({ tone: 'insufficient', headline: 'Za mało nagranego dźwięku', detail: 'Śpiewaj płynnie samogłoskę <i>u</i> w górę i w dół przez kilka sekund.', rows: [] });
          return;
        }
        onPeak(g.peakMidi);
        const waves = countWaves(dataRef.current.midi);
        const peak = Math.round(g.peakMidi), low = Math.round(g.lowMidi), span = peak - low;
        let detail: string;
        let tone: 'good' | 'ok' = 'ok';
        if (mpfr) {
          const up = peak - Math.round(mpfr.highMidi), down = Math.round(mpfr.lowMidi) - low;
          const parts: string[] = [];
          if (up > 0) parts.push(`w górę o ${up} ${semis(up)}`);
          if (down > 0) parts.push(`w dół o ${down} ${semis(down)}`);
          tone = parts.length ? 'good' : 'ok';
          detail = parts.length
            ? `Syrena wyszła poza zakres z Twojej analizy głosu: ${parts.join(' i ')}. Spróbuj zaśpiewać nowy dźwięk w etapie 3.`
            : 'Syrena zmieściła się w zakresie z analizy głosu. Przy kolejnych próbach postaraj się sięgnąć głosem wyżej (lub niżej, jeśli taki jest Twój cel).';
        } else {
          tone = span >= 18 ? 'good' : 'ok';
          detail = 'Wykonaj analizę głosu, by porównać syrenę ze swoim zakresem.';
        }
        if (g.jumps > 0) detail += ' Przy zmianie rejestru często pojawia się skok wysokości. Postaraj się, żeby ich nie było.';
        setResult({
          tone,
          headline: `Syrena: od ${noteName(low)} do ${noteName(peak)}`,
          detail,
          rows: [
            { id: 'peak', label: 'najwyższy dźwięk', value: noteName(peak), comment: mpfr ? `Z analizy głosu: ${noteName(Math.round(mpfr.highMidi))}` : 'W tej próbie' },
            { id: 'low', label: 'najniższy dźwięk', value: noteName(low), comment: mpfr ? `Z analizy głosu: ${noteName(Math.round(mpfr.lowMidi))}` : 'W tej próbie' },
            { id: 'span', label: 'rozpiętość', value: `${span} ${semis(span)}`, comment: `Liczba fal: ${waves}` },
            { id: 'smooth', label: 'płynność', value: g.jumps === 0 ? 'bez skoków' : `${g.jumps} ${g.jumps === 1 ? 'skok' : g.jumps < 5 ? 'skoki' : 'skoków'}`, comment: g.jumps === 0 ? 'Głos płynął bez przeskoków' : 'Najczęściej przy zmianie rejestru' }
          ]
        });
      }
    });
  };

  const live = take.live;
  const liveMidi = live?.f0 ? 69 + centsBetween(live.f0, a4) / 100 : NaN;

  return (
    <>
      {take.phase !== 'idle' && (
        <PlotCard
          height="h-[300px] sm:h-[380px]"
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<GlidePlot dataRef={dataRef} previous={previous} mpfr={mpfr} durationSec={Math.max(SIREN_PLOT_SEC, Math.ceil((take.elapsed + 2) / 5) * 5)} noteName={noteName} running={take.phase === 'recording'} />}
          legend={
            <>
              <LegendItem swatch="w-6 h-[3px] rounded bg-emerald-400">Twoja syrena</LegendItem>
              {mpfr && <LegendItem swatch="w-6 h-[3px] rounded bg-[#ff7ac6]">poza zakresem z analizy głosu</LegendItem>}
              {previous.length > 0 && <LegendItem swatch="w-6 h-[2px] rounded bg-white/30">wcześniejsze próby</LegendItem>}
            </>
          }
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Dźwięk', value: Number.isFinite(liveMidi) ? noteName(Math.round(liveMidi)) : '—' }}
              center={!take.started ? <>Zaśpiewaj <i>u</i></> : 'Płynnie w górę i w dół'}
              centerClass="text-emerald-300"
              right={{ label: 'Twój głos', value: live?.f0 ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
              progressText={`${formatDecimalPl(take.elapsed, 1)} s`}
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && (
        <SetupCard>
          {stageSwitcher}
          <Instructions
            steps={[
              'Zaokrąglij usta i zacznij śpiewać samogłoskę <i>u</i>.',
              'Prowadź głos płynnie z dołu w górę i z powrotem, wydając dźwięk jak syrena alarmowa. Staraj się, żeby zakres dźwięków był jak największy.',
              'Wykres pokaże na bieżąco wysokość Twojego głosu. Nagrywanie zakończy się, gdy ucichniesz.',
              'To ćwiczenie pomaga swobodnie poszerzać skalę. Staraj się sięgnąć do granic swojej skali lub je przekroczyć – są zaznaczone na wykresie.'
            ]}
            note="Śpiewaj swobodnie, bez ściskania gardła. Zakres głosu poszerza się stopniowo, nie na siłę."
            numbered={false}
          />
          <div className="flex justify-center sm:justify-end">
            <button type="button" onClick={start} className={BTN_PRIMARY}>Rozpocznij</button>
          </div>
        </SetupCard>
      )}

      {take.phase === 'done' && result && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={result.tone} headline={result.headline} detail={result.detail} />
          <ResultTiles rows={result.rows} colors={{ peak: '#c0396b', low: '#256899', span: '#2f8f5b', smooth: '#8234c7' }} />
          <ResultActions>
            <button type="button" onClick={start} className={next ? BTN : BTN_PRIMARY}>Jeszcze jedna syrena</button>
            {next && <button type="button" onClick={next.go} className={BTN_PRIMARY}>{next.label}</button>}
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </>
  );
}


const HOLD_SEC = 4;
const SUCCESS_HOLD_SEC = 1;
const SUCCESS_CENTS = 50;
const MAX_ABOVE = 3;
const BEST_KEY = 'range_new_top_midi';

function longestHold(data: AttemptData): number {
  let best = 0, start = NaN, last = NaN;
  for (let i = 0; i < data.t.length; i++) {
    const c = data.cents[i] ?? NaN, t = data.t[i] ?? 0;
    if (Number.isFinite(c) && Math.abs(c) <= SUCCESS_CENTS) {
      if (!Number.isFinite(last) || t - last > 0.15) start = t;
      last = t;
      best = Math.max(best, last - start);
    }
  }
  return best;
}

export function NewNoteStage({ mpfr, sessionPeak, stageSwitcher, onBack, next }: {
  mpfr: MpfrRange | null;
  /** Najwyższy dźwięk z ziewnięć i syren w tej sesji. */
  sessionPeak: number;
  stageSwitcher: ReactNode;
  onBack: () => void;
  next?: { label: string; go: () => void };
}) {
  // dotychczasowa granica
  const baseline = mpfr ? Math.round(mpfr.highMidi) : Number.isFinite(sessionPeak) ? Math.floor(sessionPeak) : NaN;
  const [target, setTarget] = useState(() => (Number.isFinite(baseline) ? baseline + 1 : 64));
  const [result, setResult] = useState<{ ok: boolean; hold: number; median: number } | null>(null);
  const take = useTake();
  const plotRef = useRef<AttemptData>({ t: [], cents: [], hz: [] });
  const targetHz = useMemo(() => getCalibratedMidiFreq(target), [target]);
  // odsłuch dźwięku przed próbą
  const [previewing, setPreviewing] = useState(false);
  const preview = async () => {
    setPreviewing(true);
    await take.preview(target);
    setPreviewing(false);
  };
  const maxTarget = Number.isFinite(baseline) ? baseline + MAX_ABOVE : 84;

  const start = (midi = target) => {
    setTarget(midi);
    setResult(null);
    plotRef.current = { t: [], cents: [], hz: [] };
    const hz = getCalibratedMidiFreq(midi);
    void take.run({
      maxSec: HOLD_SEC,
      referenceMidi: midi,
      // bez zawijania oktaw: dźwięk oktawę niżej nie poszerza skali
      onFrame: (f) => {
        plotRef.current.t.push(f.t);
        plotRef.current.cents.push(f.f0 !== null ? centsBetween(f.f0, hz) : NaN);
        plotRef.current.hz.push(f.f0 ?? 0);
      },
      onDone: () => {
        const hold = longestHold(plotRef.current);
        const valid = plotRef.current.cents.filter(Number.isFinite).sort((a, b) => a - b);
        const median = valid.length ? (valid[valid.length >> 1] as number) : NaN;
        const ok = hold >= SUCCESS_HOLD_SEC;
        if (ok) {
          try {
            const prev = Number(localStorage.getItem(BEST_KEY));
            if (!(midi <= prev)) localStorage.setItem(BEST_KEY, String(midi));
          } catch { /* brak localStorage */ }
        }
        setResult({ ok, hold, median });
      }
    });
  };

  const live = take.live;
  const liveCents = live?.f0 ? centsBetween(live.f0, targetHz) : NaN;
  const inBand = Number.isFinite(liveCents) && Math.abs(liveCents) <= SUCCESS_CENTS;
  const above = Number.isFinite(baseline) ? target - baseline : NaN;

  return (
    <>
      {take.phase !== 'idle' && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<PitchPlot dataRef={plotRef} durationSec={HOLD_SEC} bandCents={SUCCESS_CENTS} rangeCents={150} targetLabel={noteName(target)} running={take.phase === 'recording'} />}
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Cel', value: `${noteName(target)} (${formatDecimalPl(targetHz, 1)} Hz)` }}
              center={!take.started ? 'Zaśpiewaj dźwięk' : !live?.f0 ? 'Brak dźwięku…' : inBand ? 'Trzymaj!' : liveCents > 0 ? 'Za wysoko' : 'Za nisko'}
              centerSub={Number.isFinite(liveCents) ? `${liveCents > 0 ? '+' : ''}${Math.round(liveCents)} centów` : '—'}
              centerClass={inBand ? 'text-emerald-300' : 'text-white/80'}
              right={{ label: 'Twój głos', value: live?.f0 ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
              progress={take.elapsed / HOLD_SEC}
              progressText={`${formatDecimalPl(take.elapsed, 1)} / ${HOLD_SEC} s`}
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && (
        <SetupCard>
          {stageSwitcher}
          <Instructions
            steps={[
              Number.isFinite(baseline)
                ? `Najwyższy dźwięk w Twojej skali ${mpfr ? 'z analizy głosu' : 'z dzisiejszych prób'} to ${noteName(baseline)}. Spróbuj zaśpiewać dźwięk o półton wyżej.`
                : 'Nie ma jeszcze wyniku analizy głosu ani prób z tej sesji – wybierz dźwięk nieco powyżej tego, co śpiewasz wygodnie.',
              `Usłyszysz dźwięk wzorcowy. Po odliczaniu zaśpiewaj go na samogłosce <i>a</i> lub <i>u</i> i utrzymaj przez co najmniej ${SUCCESS_HOLD_SEC} s w zielonym polu.`,
              'Zrób wcześniej kilka ziewnięć lub syren – rozgrzany, rozluźniony głos sięga wyżej.'
            ]}
            note={`Śpiewaj lekko, a nie głośno. Staraj się nie ściskać gardła. W jednej sesji aplikacja pozwala próbować najwyżej ${MAX_ABOVE} półtony ponad dotychczasowy zakres.`}
            numbered={false}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={target} onChange={setTarget} min={40} max={maxTarget} label="Nowy dźwięk" sub={Number.isFinite(above) && above > 0 ? `+${above} ${semis(above)} ponad zakres` : `${formatDecimalPl(targetHz, 1)} Hz`} noteName={noteName} />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => void preview()} disabled={previewing} className={BTN}>♪ Posłuchaj dźwięku</button>
              <button type="button" onClick={() => start()} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
        </SetupCard>
      )}

      {take.phase === 'done' && result && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader
            tone={result.ok ? 'good' : 'ok'}
            headline={result.ok ? `Udało się! ${noteName(target)} to nowy dźwięk w Twojej skali` : `Jeszcze nie tym razem – ${noteName(target)}`}
            detail={
              result.ok
                ? `Dźwięk utrzymany przez ${formatDecimalPl(result.hold, 1)} s. ${target < maxTarget ? 'Możesz spróbować zaśpiewać jeszcze wyżej albo zakończyć na dziś.' : 'To chwilowy limit – wróć do kolejnych prób w następnej sesji.'}`
                : Number.isFinite(result.median) && result.median < -SUCCESS_CENTS
                ? 'Głos nie doszedł do tej wysokości. Wróć do poprzednich etapów ćwiczenia i spróbuj ponownie.'
                : Number.isFinite(result.median) && result.median > SUCCESS_CENTS
                ? 'Dźwięk był wyższy niż cel. To znaczy, że w tym rejestrze masz problemy z poprawną intonacją. Posłuchaj jeszcze raz dźwięku wzorcowego i spróbuj ponownie. Powtórz poprzednie etapy ćwiczenia, żeby lepiej się przygotować.'
                : 'Dźwięk pojawił się, ale nie utrzymał się w zielonym polu. Spróbuj jeszcze raz i postaraj się utrzymać stabilny dźwięk.'
            }
          />
          <ResultActions>
            {result.ok && target < maxTarget && (
              <button type="button" onClick={() => start(target + 1)} className={BTN_PRIMARY}>Spróbuj {noteName(target + 1)}</button>
            )}
            <button type="button" onClick={() => start()} className={result.ok ? BTN : BTN_PRIMARY}>Powtórz {noteName(target)}</button>
            <button type="button" onClick={take.reset} className={BTN}>Wybierz inny dźwięk</button>
            {next && <button type="button" onClick={next.go} className={BTN}>{next.label}</button>}
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </>
  );
}
