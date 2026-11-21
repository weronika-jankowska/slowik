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
  SetupCard,
  StatusRow,
  fmt1,
  readBest,
  readMpfrRange,
  saveBest
} from './exerciseUi';
import { useTake, type TakeFrame } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import {
  MIN_PHRASE_SEC,
  PHRASE_TEXTS,
  TEXT_PITCH_SMOOTH_SEC,
  analyzePhrase,
  itemsReached,
  phraseFeedback,
  scoreLabel,
  timeItems,
  type PhraseFeedback,
  type PhraseTextId
} from '../../utils/longPhrase';

const TOLERANCE = 50;
/**
 * Przerwa na oddech w śpiewanym tekście [s]. Dłuższa niż w liczeniu wron: zbitki spółgłosek (zwłaszcza
 * bezdźwięcznych, np. „przestrzeń”) i zwarcia przed p/t/k bywają ciche na tyle, że krótszy próg kończył nagranie
 * w środku frazy.
 */
const PHRASE_BREATH_GAP_SEC = 0.6;
const MAX_SEC = 120;
const MIN_MIDI = 40;
const MAX_MIDI = 79;
const bestKey = (id: PhraseTextId) => `phrase_${id}`;

const TILE_COLOR: Record<string, string> = { duration: '#2f8f5b', best: '#cc8822', stability: '#256899', end: '#c0396b' };

/**
 * Długa fraza: dowolny tekst (np. słowa frazy z utworu) śpiewany na jednym dźwięku i jednym oddechu.
 * Nagranie kończy się samo przy pierwszej przerwie na oddech (cisza ≥ PHRASE_BREATH_GAP_SEC).
 */
export default function LongPhraseExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [midi, setMidi] = useState(() =>
    mpfr ? Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(mpfr.lowMidi + (mpfr.highMidi - mpfr.lowMidi) * 0.35))) : 55
  );
  // tekst jest zawsze własny (np. fraza z utworu); liczenie wron jest w ćwiczeniu „Długi oddech”
  const textId: PhraseTextId = 'free';
  const [feedback, setFeedback] = useState<PhraseFeedback | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const take = useTake();
  const targetHz = useMemo(() => getCalibratedMidiFreq(midi), [midi]);
  const name = midiToNoteName(midi);
  const text = PHRASE_TEXTS.find((x) => x.id === textId) ?? PHRASE_TEXTS[0]!;
  const timed = useMemo(() => timeItems(text.items), [text]);
  const best = readBest(bestKey(textId));

  // wykrywanie przerwy na oddech na żywo
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
      f.t - lastSoundRef.current >= PHRASE_BREATH_GAP_SEC &&
      !breathRef.current
    ) {
      breathRef.current = true;
      take.stop();
    }
  };

  const start = () => {
    setFeedback(null);
    voicedRmsRef.current = [];
    thrRef.current = 0.006;
    lastSoundRef.current = 0;
    firstSoundRef.current = null;
    breathRef.current = false;
    const id = textId, items = timed;
    void take.run({
      maxSec: MAX_SEC,
      referenceMidi: midi,
      targetHz,
      plotSmoothSec: TEXT_PITCH_SMOOTH_SEC,
      onFrame,
      onDone: (frames) => {
        const r = analyzePhrase(frames, targetHz, TOLERANCE, breathRef.current, { first: firstSoundRef.current, last: lastSoundRef.current });
        const lastT = frames[frames.length - 1]?.t ?? 0;
        const score = id === 'free' ? Math.round(r.durationSec * 10) / 10 : itemsReached(items, r.durationSec);
        const prev = readBest(bestKey(id));
        if (r.sufficient && score > 0) saveBest(bestKey(id), score);
        setFeedback(phraseFeedback(r, id, score, prev, TOLERANCE, lastT >= MAX_SEC - 0.1));
      }
    });
  };

  const preview = async () => {
    setPreviewing(true);
    await take.preview(midi);
    setPreviewing(false);
  };

  const live = take.live;
  const inBand = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= TOLERANCE;
  const active = take.phase === 'countdown' || take.phase === 'recording' || take.phase === 'done';
  const plotDuration = Math.max(20, Math.ceil((take.elapsed + 3) / 10) * 10);

  // bieżący fragment tekstu (przed pierwszym dźwiękiem – pierwszy fragment)
  const t = take.started ? take.elapsed : 0;
  let cur = timed.findIndex((it) => t < it.t1);
  if (cur < 0) cur = timed.length - 1;
  const showText = take.phase !== 'done' && timed.length > 0;

  return (
    <ExercisePage kicker="Ćwiczenie dla chórzystów" title="Długa fraza" subtitle="własny tekst na jednym dźwięku i jednym oddechu" onBack={() => { take.cancel(); onBack(); }}>
      {active && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<PitchPlot dataRef={take.plotRef} durationSec={plotDuration} bandCents={TOLERANCE} rangeCents={150} targetLabel={name} running={take.phase === 'recording'} />}
        >
          {showText && (
            <div className="w-full flex items-baseline justify-center gap-3 sm:gap-5 min-h-[44px] px-2 overflow-hidden whitespace-nowrap">
              <span className="font-cardo text-sm sm:text-base text-white/35 truncate text-right flex-1">{timed[cur - 1]?.text ?? ''}</span>
              <span className={`font-seasons text-xl sm:text-2xl tracking-wide ${take.started ? 'text-white' : 'text-white/70'}`}>{timed[cur]?.text}</span>
              <span className="font-cardo text-sm sm:text-base text-white/35 truncate text-left flex-1">{timed[cur + 1]?.text ?? ''}</span>
            </div>
          )}
          {!showText && take.phase === 'recording' && (
            <p className="text-center font-cardo text-white/70 text-sm">Śpiewaj swój tekst na jednym dźwięku, bez przerw między słowami.</p>
          )}
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Czas frazy', value: <span className="text-2xl tabular-nums">{fmt1(take.started ? take.elapsed : 0)} s</span> }}
              center={!take.started ? 'Zacznij śpiewać' : !live?.f0 ? 'Bez wysokości' : inBand ? 'Równo' : live.cents > 0 ? 'Za wysoko' : 'Za nisko'}
              centerSub={live && Number.isFinite(live.cents) ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
              centerClass={inBand ? 'text-emerald-300' : 'text-white/80'}
              right={{ label: 'Rekord', value: scoreLabel(textId, best) }}
              rightClass="text-white"
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && (
        <SetupCard>
          <Instructions
            steps={[
              'Wybierz tekst, który chcesz ćwiczyć – np. słowa długiej frazy z utworu.',
              'Usłyszysz dźwięk wzorcowy. Po odliczaniu weź wdech i zaśpiewaj swój tekst na tym jednym dźwięku.',
              'Śpiewaj na jednym oddechu i stałej wysokości – linia na wykresie powinna utrzymać się w zielonym polu. Pierwsza przerwa na oddech kończy nagranie.'
            ]}
            note="Nie zatrzymuj się między słowami. Krótkie spółgłoski, także bezdźwięczne, nie przerywają frazy."
            numbered={false}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Dźwięk wzorcowy" sub={`${formatDecimalPl(targetHz, 1)} Hz`} noteName={midiToNoteName} />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => void preview()} disabled={previewing} className={BTN}>♪ Posłuchaj dźwięku</button>
              <button type="button" onClick={start} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
          {Number.isFinite(best) && <p className="text-[12px] text-[#466cd2] text-center sm:text-right -mt-1">Twój rekord: {scoreLabel(textId, best)}</p>}
        </SetupCard>
      )}

      {take.phase === 'done' && feedback && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={feedback.tone} headline={feedback.headline} detail={feedback.detail} />
          <ResultTiles rows={feedback.rows} colors={TILE_COLOR} />
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
