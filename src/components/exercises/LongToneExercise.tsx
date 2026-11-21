import { useMemo, useRef, useState } from 'react';
import PitchPlot from './PitchPlot';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  Instructions,
  MicProblem,
  NotePicker,
  PlotCard,
  ResultActions,
  ResultHeader,
  ResultTiles,
  Segmented,
  SetupCard,
  StatusRow,
  fmt1,
  readBest,
  readMpfrRange,
  saveBest,
  setBest
} from './exerciseUi';
import { useTake, type TakeFrame } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { analyzeLongTone, mptFeedback, type LongToneFeedback } from '../../utils/longTone';
import {
  BREATH_GAP_SEC,
  MIN_PHRASE_SEC,
  TEXT_PITCH_SMOOTH_SEC,
  analyzePhrase,
  freePhraseFeedback,
  phraseFeedback,
  type PhraseFeedback
} from '../../utils/longPhrase';
import { MAX_CROWS, analyzeSpokenCrows, crowsLabel, spokenCrowsFeedback, type SpokenCrowsResult } from '../../utils/crowCount';

// „Długi oddech” – warianty ćwiczenia

type Mode = 'tone' | 'speak' | 'sing' | 'phrase';
const MODES: { id: Mode; label: string; subtitle: string }[] = [
  { id: 'tone', label: 'Dźwięk <i>a</i>', subtitle: 'jak najdłużej na jednym oddechu' },
  { id: 'speak', label: 'Wrony mówione', subtitle: 'jak najwięcej wron na jednym oddechu' },
  { id: 'sing', label: 'Wrony śpiewane', subtitle: 'wrony na jednym dźwięku i jednym oddechu' },
  { id: 'phrase', label: 'Własny tekst', subtitle: 'własny tekst na jednym dźwięku i jednym oddechu' }
];

const TONE_TOLERANCE = 50;
const SING_TOLERANCE = 50;
/** Przerwa na oddech w wariancie „Własny tekst” [s] */
const PHRASE_BREATH_GAP_SEC = 0.6;
const TONE_MAX_SEC = 60;
const CROWS_MAX_SEC = 120;
const BEST_KEY: Record<Mode, string> = { tone: 'mpt_sec', speak: 'crows_spoken', sing: 'phrase_crows', phrase: 'phrase_free' };
const MIN_MIDI = 40;
const MAX_MIDI = 79;
const CROWS_HINT = 'pierwsza wrona bez ogona, druga wrona bez ogona, trzecia wrona bez ogona…';

const TILE_COLOR: Record<string, string> = {
  duration: '#2f8f5b', best: '#cc8822', stability: '#256899', drift: '#8234c7', end: '#c0396b', crows: '#c0396b', tempo: '#256899'
};

const clampMidi = (m: number) => Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(m)));

export default function LongToneExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [mode, setMode] = useState<Mode>('tone');
  // długi dźwięk
  const [toneMidi, setToneMidi] = useState(() => (mpfr ? clampMidi((mpfr.lowMidi + mpfr.highMidi) / 2) : 57));
  // wrony śpiewane: dźwięk ze środka skali
  const [singMidi, setSingMidi] = useState(() => (mpfr ? clampMidi((mpfr.lowMidi + mpfr.highMidi) / 2) : 57));
  const midi = mode === 'sing' || mode === 'phrase' ? singMidi : toneMidi;
  const setMidi = mode === 'sing' || mode === 'phrase' ? setSingMidi : setToneMidi;
  const [feedback, setFeedback] = useState<LongToneFeedback | PhraseFeedback | null>(null);
  // wariant mówiony
  const [spoken, setSpoken] = useState<{ result: SpokenCrowsResult; crows: number; prevBest: number; hitLimit: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const take = useTake();
  const targetHz = useMemo(() => getCalibratedMidiFreq(midi), [midi]);
  const name = midiToNoteName(midi);
  // wrony śpiewane
  const [sung, setSung] = useState<{ crows: number; prevBest: number } | null>(null);
  const best = readBest(BEST_KEY[mode]);
  const modeInfo = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const tolerance = mode === 'sing' ? SING_TOLERANCE : TONE_TOLERANCE;

  // wykrywanie przerwy na oddech na żywo (warianty z wronami)
  const voicedRmsRef = useRef<number[]>([]);
  const thrRef = useRef(0.006);
  const lastSoundRef = useRef(0);
  const firstSoundRef = useRef<number | null>(null);
  const breathRef = useRef(false);

  const onFrame = (f: TakeFrame) => {
    if (f.f0 !== null) {
      const v = voicedRmsRef.current;
      v.push(f.rms);
      if (v.length % 15 === 0) {
        const sorted = v.slice(-600).sort((a, b) => a - b);
        thrRef.current = Math.max(0.006, 0.35 * (sorted[sorted.length >> 1] ?? 0));
      }
    }
    const sounding = f.f0 !== null || f.rms >= thrRef.current;
    if (sounding) {
      if (firstSoundRef.current === null) firstSoundRef.current = f.t;
      lastSoundRef.current = f.t;
    } else if (
      firstSoundRef.current !== null &&
      lastSoundRef.current - firstSoundRef.current >= MIN_PHRASE_SEC &&
      f.t - lastSoundRef.current >= (mode === 'phrase' ? PHRASE_BREATH_GAP_SEC : BREATH_GAP_SEC) &&
      !breathRef.current
    ) {
      breathRef.current = true;
      take.stop();
    }
  };

  const resetBreath = () => {
    voicedRmsRef.current = [];
    thrRef.current = 0.006;
    lastSoundRef.current = 0;
    firstSoundRef.current = null;
    breathRef.current = false;
  };

  const start = () => {
    setFeedback(null);
    setSpoken(null);
    setSung(null);
    resetBreath();
    if (mode === 'tone') {
      void take.run({
        maxSec: TONE_MAX_SEC,
        referenceMidi: midi,
        targetHz,
        endOnSilenceSec: 0.6,
        minSoundSec: 1,
        onDone: (frames) => {
          const r = analyzeLongTone(frames, targetHz, TONE_TOLERANCE);
          const prev = readBest(BEST_KEY.tone);
          if (r.sufficient) saveBest(BEST_KEY.tone, Math.round(r.durationSec * 10) / 10);
          setFeedback(mptFeedback(r, prev, TONE_TOLERANCE));
        }
      });
    } else if (mode === 'phrase') {
      void take.run({
        maxSec: CROWS_MAX_SEC,
        referenceMidi: midi,
        targetHz,
        plotSmoothSec: TEXT_PITCH_SMOOTH_SEC,
        onFrame,
        onDone: (frames) => {
          const r = analyzePhrase(frames, targetHz, SING_TOLERANCE, breathRef.current, { first: firstSoundRef.current, last: lastSoundRef.current });
          const lastT = frames[frames.length - 1]?.t ?? 0;
          const prev = readBest(BEST_KEY.phrase);
          if (r.sufficient) saveBest(BEST_KEY.phrase, Math.round(r.durationSec * 10) / 10);
          setFeedback(freePhraseFeedback(r, prev, SING_TOLERANCE, lastT >= CROWS_MAX_SEC - 0.1));
        }
      });
    } else if (mode === 'sing') {
      void take.run({
        maxSec: CROWS_MAX_SEC,
        referenceMidi: midi,
        targetHz,
        plotSmoothSec: TEXT_PITCH_SMOOTH_SEC,
        onFrame,
        onDone: (frames) => {
          const r = analyzePhrase(frames, targetHz, SING_TOLERANCE, breathRef.current);
          const lastT = frames[frames.length - 1]?.t ?? 0;
          // ocena wysokości i czasu
          setFeedback(phraseFeedback(r, 'free', Math.round(r.durationSec * 10) / 10, NaN, SING_TOLERANCE, lastT >= CROWS_MAX_SEC - 0.1, { crows: true }));
          if (r.sufficient) setSung({ crows: 0, prevBest: readBest(BEST_KEY.sing) });
        }
      });
    } else {
      void take.run({
        maxSec: CROWS_MAX_SEC,
        referenceMidi: null,
        onFrame,
        onDone: (frames) => {
          const r = analyzeSpokenCrows(frames, breathRef.current, { first: firstSoundRef.current, last: lastSoundRef.current });
          const lastT = frames[frames.length - 1]?.t ?? 0;
          setSpoken({ result: r, crows: 0, prevBest: readBest(BEST_KEY.speak), hitLimit: lastT >= CROWS_MAX_SEC - 0.1 });
        }
      });
    }
  };

  /** Liczba wron wpisana po nagraniu */
  const setCrows = (value: number) => {
    const crows = Math.max(0, Math.min(MAX_CROWS, Math.round(Number.isFinite(value) ? value : 0)));
    const store = (key: string, prevBest: number) => {
      const record = Math.max(crows, Number.isFinite(prevBest) ? prevBest : 0);
      if (record > 0) setBest(key, record);
    };
    if (mode === 'speak' && spoken) { store(BEST_KEY.speak, spoken.prevBest); setSpoken({ ...spoken, crows }); }
    if (mode === 'sing' && sung) { store(BEST_KEY.sing, sung.prevBest); setSung({ ...sung, crows }); }
  };

  const preview = async () => {
    setPreviewing(true);
    await take.preview(midi);
    setPreviewing(false);
  };

  const changeMode = (m: Mode) => {
    setMode(m);
    setFeedback(null);
    setSpoken(null);
    setSung(null);
  };

  const plotDuration = Math.max(20, Math.ceil((take.elapsed + 3) / 10) * 10);
  const live = take.live;
  const inBand = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= tolerance;
  const active = take.phase === 'countdown' || take.phase === 'recording' || take.phase === 'done';
  const elapsed = take.started ? take.elapsed : 0;
  const bestText = mode === 'tone' || mode === 'phrase' ? (Number.isFinite(best) ? `${fmt1(best)} s` : '—') : crowsLabel(best);

  const spokenFb = spoken ? spokenCrowsFeedback(spoken.result, spoken.crows, spoken.prevBest, spoken.hitLimit) : null;
  // wrony śpiewane
  const sungFb = mode === 'sing' && feedback && sung
    ? {
        ...feedback,
        headline: feedback.headline.replace('Fraza na jednym oddechu', 'Liczenie wron na jednym dźwięku'),
        rows: feedback.rows.map((row) => {
          if (row.id !== 'best') return row;
          const record = sung.crows > 0 && (!Number.isFinite(sung.prevBest) || sung.crows > sung.prevBest);
          const bestNow = Math.max(sung.crows, Number.isFinite(sung.prevBest) ? sung.prevBest : 0);
          return { ...row, label: 'rekord wron', value: bestNow > 0 ? crowsLabel(bestNow) : '—', comment: record ? 'Ustanowiony teraz' : sung.crows > 0 ? 'Najlepszy dotychczasowy wynik' : 'Wpisz liczbę wron pod wynikami' };
        })
      }
    : feedback;
  const shownFb = mode === 'speak' ? spokenFb : sungFb;
  const crowsEntry = mode === 'speak' ? (spoken?.result.sufficient ? spoken : null) : mode === 'sing' ? sung : null;

  return (
    <ExercisePage kicker="Ćwiczenie ogólne" title="Długi oddech" subtitle={modeInfo.subtitle} onBack={() => { take.cancel(); onBack(); }}>
      {active && mode !== 'speak' && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<PitchPlot dataRef={take.plotRef} durationSec={plotDuration} bandCents={tolerance} rangeCents={150} targetLabel={name} running={take.phase === 'recording'} />}
        >
          {mode === 'sing' && take.phase !== 'done' && (
            <p className="text-center font-cardo text-white/70 text-sm sm:text-base">{CROWS_HINT}</p>
          )}
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: mode === 'tone' ? 'Czas dźwięku' : 'Czas', value: <span className="text-2xl tabular-nums">{fmt1(elapsed)} s</span> }}
              center={!take.started ? (mode === 'tone' ? <>Zaśpiewaj <i className="normal-case">a</i></> : 'Zacznij śpiewać') : !live?.f0 ? (mode === 'tone' ? 'Brak dźwięku…' : 'Bez wysokości') : inBand ? 'Czysto' : live.cents > 0 ? 'Za wysoko' : 'Za nisko'}
              centerSub={live && Number.isFinite(live.cents) ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
              centerClass={inBand ? 'text-emerald-300' : 'text-white/80'}
              right={{ label: 'Rekord', value: bestText }}
              rightClass="text-white"
              progress={mode === 'tone' && Number.isFinite(best) ? take.elapsed / best : undefined}
              progressText={mode === 'tone' && Number.isFinite(best) ? 'do rekordu' : undefined}
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}

      {active && mode === 'speak' && take.phase !== 'done' && (
        <PlotCard
          height="h-[200px] sm:h-[230px]"
          plot={
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-4">
              {/* odliczanie w miejscu licznika czasu */}
              <div className="h-[60px] sm:h-[72px] flex items-center justify-center">
                {take.phase === 'countdown'
                  ? <span key={take.countdown} className="ex-countdown font-cardo text-white/90 text-[56px] sm:text-[72px] leading-none drop-shadow-md">{take.countdown}</span>
                  : <span className="font-seasons tabular-nums text-5xl sm:text-6xl text-white">{fmt1(elapsed)} s</span>}
              </div>
              <p className="font-cardo text-white/60 text-sm sm:text-base text-center">{CROWS_HINT}</p>
              <div className="w-full max-w-[420px] h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${Math.min(100, (live?.rms ?? 0) * 900)}%` }} />
              </div>
            </div>
          }
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Czas', value: <span className="text-2xl tabular-nums">{fmt1(elapsed)} s</span> }}
              center={!take.started ? 'Zacznij liczyć' : 'Licz jak najszybciej'}
              centerSub="pierwsza przerwa na oddech kończy nagranie"
              centerClass={take.started ? 'text-emerald-300' : 'text-white/80'}
              right={{ label: 'Rekord', value: bestText }}
              rightClass="text-white"
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && (
        <SetupCard>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-[10px] uppercase tracking-wider opacity-70">Wariant</span>
            <Segmented value={mode} onChange={changeMode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} />
          </div>

          {mode === 'tone' && (
            <Instructions
              steps={[
                'Usłyszysz dźwięk wzorcowy ze środka Twojej skali. Możesz go dowolnie zmienić poniżej.',
                'Po odliczaniu weź spokojny, pełny wdech i zaśpiewaj ten dźwięk na samogłosce <i>a</i> tak długo, jak dasz radę na jednym oddechu.',
                'Zakończ, zanim głos zacznie się męczyć – nie wyciskaj ostatnich resztek powietrza. Nagrywanie zatrzyma się samo, gdy dźwięk ucichnie.'
              ]}
              note="Oszczędny wydech pomaga bardziej niż głęboki wdech – zacznij spokojnie i nie wypuszczaj od razu dużo powietrza."
              numbered={false}
            />
          )}
          {mode === 'speak' && (
            <Instructions
              steps={[
                'To ćwiczenie dykcji i oddechu. Po odliczaniu weź wdech i licz wrony na głos: „pierwsza wrona bez ogona, druga wrona bez ogona, trzecia wrona bez ogona…”.',
                'Licz jak najszybciej, ale wyraźnie – tak, żeby każdą wronę dało się zrozumieć.',
                'Licz, aż zabraknie powietrza. Pierwsza przerwa na oddech kończy nagranie.'
              ]}
              note="Aplikacja mierzy czas do pierwszej przerwy na oddech. Zapamiętaj, na której wronie kończysz – po nagraniu wpiszesz ich liczbę."
              numbered={false}
            />
          )}
          {mode === 'phrase' && (
            <Instructions
              steps={[
                'Wybierz tekst, który chcesz ćwiczyć – np. słowa długiej frazy z utworu.',
                'Usłyszysz dźwięk wzorcowy ze środka Twojej skali. Możesz go dowolnie zmienić poniżej. Po odliczaniu weź wdech i zaśpiewaj swój tekst na tym jednym dźwięku.',
                'Śpiewaj na jednym oddechu i stałej wysokości – linia na wykresie powinna utrzymać się w zielonym polu. Pierwsza przerwa na oddech kończy nagranie.'
              ]}
              note="Nie zatrzymuj się między słowami. Krótkie spółgłoski, także bezdźwięczne, nie przerywają frazy."
              numbered={false}
            />
          )}
          {mode === 'sing' && (
            <Instructions
              steps={[
                'To ćwiczenie oddechu i równej wysokości. Usłyszysz dźwięk wzorcowy ze środka Twojej skali. Możesz go dowolnie zmienić poniżej. Po odliczaniu weź wdech i licz wrony, śpiewając je na tym jednym dźwięku.',
                'Śpiewaj w swoim tempie: „pierwsza wrona bez ogona, druga wrona bez ogona…”, bez przerw.',
                `Głoski się zmieniają, ale wysokość ma zostać ta sama: linia na wykresie powinna trzymać się zielonego pola (±${SING_TOLERANCE} centów).`,
                'Śpiewaj, aż zabraknie powietrza. Pierwsza przerwa na oddech kończy nagranie.'
              ]}
              note="Aplikacja mierzy czas do pierwszej przerwy na oddech. Zapamiętaj, na której wronie kończysz – po nagraniu wpiszesz ich liczbę."
              numbered={false}
            />
          )}

          <div className={`flex flex-col sm:flex-row items-center gap-4 ${mode === 'speak' ? 'sm:justify-end' : 'justify-between'}`}>
            {mode !== 'speak' && (
              <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Dźwięk wzorcowy" sub={`${formatDecimalPl(targetHz, 1)} Hz`} noteName={midiToNoteName} />
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              {mode !== 'speak' && <button type="button" onClick={() => void preview()} disabled={previewing} className={BTN}>♪ Posłuchaj dźwięku</button>}
              <button type="button" onClick={start} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
          {Number.isFinite(best) && <p className={`text-[12px] text-[#466cd2] text-center -mt-1 sm:text-right`}>Twój rekord: {bestText}</p>}
        </SetupCard>
      )}

      {take.phase === 'done' && shownFb && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={shownFb.tone} headline={shownFb.headline} detail={shownFb.detail} />
          <ResultTiles rows={shownFb.rows} colors={TILE_COLOR} />
          {crowsEntry && (
            <div className="flex flex-wrap items-center justify-center gap-3 font-cardo text-[#18388f]">
              <span className="text-[13px]">Ile wron udało się policzyć?</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Jedna wrona mniej" onClick={() => setCrows(crowsEntry.crows - 1)} disabled={crowsEntry.crows <= 0} className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/80 border border-white/60 cursor-pointer disabled:opacity-40">−</button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_CROWS}
                  aria-label="Liczba policzonych wron"
                  value={crowsEntry.crows > 0 ? crowsEntry.crows : ''}
                  placeholder="0"
                  onChange={(e) => setCrows(Number(e.target.value))}
                  className="w-16 h-9 rounded-lg bg-white/70 border border-white/60 text-center font-seasons text-xl tabular-nums text-[#18388f]"
                />
                <button type="button" aria-label="Jedna wrona więcej" onClick={() => setCrows(crowsEntry.crows + 1)} disabled={crowsEntry.crows >= MAX_CROWS} className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/80 border border-white/60 cursor-pointer disabled:opacity-40">+</button>
              </div>
            </div>
          )}
          <ResultActions>
            <button type="button" onClick={start} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={take.reset} className={BTN}>Zmień ustawienia</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
