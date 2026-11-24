import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import LipTrillMelody from './LipTrillMelody';
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
  readMpfrRange,
  sleep
} from './exerciseUi';
import { useTake } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { audioDebug, pianoSampler } from '../../utils/pianoSampler';
import { analyzeIntonationStability, stabilityFeedback, type StabilityFeedback } from '../../utils/intonationStability';

// Harmonia

type Quality = 'major' | 'minor';
type Role = 'root' | 'third' | 'fifth';

/** Czas śpiewania [s] */
const SING_SEC = 3.5;
/** Każda nuta akordu gra pełną próbkę (bez przycinania) */
const NOTE_SEC = 2.4;
const TOLERANCE = 50;
const MIN_MIDI = 40;
const MAX_MIDI = 79;
const NAMES = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'];

const ROLE_LABEL: Record<Role, string> = { root: 'pryma', third: 'tercja', fifth: 'kwinta' };

function chordOthers(quality: Quality, role: Role): number[] {
  const third = quality === 'major' ? 4 : 3;
  const rootOffset = role === 'root' ? 0 : role === 'third' ? -third : -7;
  const tones = [rootOffset, rootOffset + third, rootOffset + 7];
  const userIdx = role === 'root' ? 0 : role === 'third' ? 1 : 2;
  const others = tones.filter((_, i) => i !== userIdx);
  return [...others, rootOffset - 12];
}

function chordName(userMidi: number, quality: Quality, role: Role): string {
  const third = quality === 'major' ? 4 : 3;
  const root = userMidi + (role === 'root' ? 0 : role === 'third' ? -third : -7);
  const n = NAMES[((root % 12) + 12) % 12] ?? 'C';
  return quality === 'major' ? `${n}-dur` : `${n.toLowerCase()}-moll`;
}

const TILE_COLOR: Record<string, string> = { inband: '#2f8f5b', offset: '#256899', spread: '#8234c7', longest: '#cc8822' };

export default function ChordExercise({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<'chord' | 'harmony'>('chord');
  const [mpfr] = useState(readMpfrRange);
  const switcher = (
    <div className="relative z-10 flex flex-wrap items-center justify-center gap-2">
      <span className="text-[10px] uppercase tracking-wider opacity-70">Wariant</span>
      <Segmented value={stage} onChange={setStage} options={[{ id: 'chord', label: 'Dźwięk na tle akordu' }, { id: 'harmony', label: 'Rozśpiewka z harmonią' }]} />
    </div>
  );
  if (stage === 'harmony') {
    return (
      <ExercisePage kicker="Ćwiczenie dla chórzystów" title="Harmonia" subtitle="rozśpiewka z harmonią – tercja nad melodią" onBack={onBack}>
        <LipTrillMelody key="harmony" mpfr={mpfr} onBack={onBack} variant="vocal" harmony stageSwitcher={switcher} />
      </ExercisePage>
    );
  }
  return <ChordStage onBack={onBack} switcher={switcher} />;
}

function ChordStage({ onBack, switcher }: { onBack: () => void; switcher: ReactNode }) {
  const [mpfr] = useState(readMpfrRange);
  const [midi, setMidi] = useState(() =>
    mpfr ? Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round((mpfr.lowMidi + mpfr.highMidi) / 2))) : 57
  );
  const [quality, setQuality] = useState<Quality>('major');
  const [role, setRole] = useState<Role>('third');
  const [headphones, setHeadphones] = useState<'yes' | 'no'>('yes');
  const [intro, setIntro] = useState<null | 'chord' | 'note' | 'loading' | 'waiting'>(null);
  const [feedback, setFeedback] = useState<StabilityFeedback | null>(null);
  const [loadError, setLoadError] = useState(false);
  const take = useTake();
  const runRef = useRef(0);

  const targetHz = useMemo(() => getCalibratedMidiFreq(midi), [midi]);
  const others = useMemo(() => chordOthers(quality, role).map((o) => midi + o).filter((m) => m >= 36 && m <= 84), [midi, quality, role]);
  const name = chordName(midi, quality, role);
  const gain = headphones === 'yes' ? 0.7 : 0.3;

  // akord bez Twojego dźwięku
  useEffect(() => {
    if (take.phase !== 'recording') return;
    audioDebug('chord background', { others, gain });
    const t0 = pianoSampler.now() + 0.05;
    for (const m of others) {
      pianoSampler.play(m, t0, NOTE_SEC, gain, { reverb: true }).catch((e) => audioDebug('chord background failed', { midi: m, err: String(e) }));
    }
    return () => pianoSampler.stopAll();
  }, [take.phase, others, gain]);

  useEffect(() => () => { runRef.current++; pianoSampler.stopAll(); }, []);
  useEffect(() => {
    if (intro !== 'waiting') return;
    // odliczanie ruszyło albo mikrofon się nie uruchomił
    if (take.phase !== 'idle' || take.micState === 'denied' || take.micState === 'error') setIntro(null);
  }, [take.phase, take.micState, intro]);

  const start = async () => {
    const run = ++runRef.current;
    setFeedback(null);
    setLoadError(false);
    setIntro('loading');
    const ok = await pianoSampler.load([...others, midi]);
    if (run !== runRef.current) return;
    if (!ok) { setLoadError(true); setIntro(null); return; }
    setIntro('chord');
    const t = pianoSampler.now() + 0.05;
    for (const m of [...others, midi]) void pianoSampler.play(m, t, NOTE_SEC, gain, { reverb: true });
    await sleep(2300);
    if (run !== runRef.current) return;
    setIntro('note');
    void pianoSampler.play(midi, pianoSampler.now() + 0.05, 1.3, 0.85);
    await sleep(1500);
    if (run !== runRef.current) return;
    setIntro('waiting');
    void take.run({
      maxSec: SING_SEC,
      countdown: true,
      targetHz,
      onDone: (frames) => {
        pianoSampler.stopAll();
        const r = analyzeIntonationStability(frames.map((f) => ({ t: f.t, f0: f.f0 })), { targetHz, toleranceCents: TOLERANCE, minVoicedSec: 0.8 });
        setFeedback(stabilityFeedback(r));
      }
    });
  };

  const cancel = () => { runRef.current++; pianoSampler.stopAll(); take.cancel(); setIntro(null); };
  const live = take.live;
  const inBand = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= TOLERANCE;
  const showPlot = intro === 'chord' || intro === 'note' || intro === 'waiting' || take.phase !== 'idle';

  return (
    <ExercisePage kicker="Ćwiczenie dla chórzystów" title="Harmonia" subtitle={`dźwięk na tle akordu ${name} · Twój dźwięk: ${ROLE_LABEL[role]}`} onBack={() => { cancel(); onBack(); }}>
      {showPlot && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={
            <>
              <PitchPlot dataRef={take.plotRef} durationSec={SING_SEC} bandCents={TOLERANCE} rangeCents={150} targetLabel={midiToNoteName(midi)} running={take.phase === 'recording'} />
              {(intro === 'chord' || intro === 'note') && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="font-seasons text-2xl text-white/90 drop-shadow-md">{intro === 'chord' ? `Pełny akord ${name}` : `Twój dźwięk: ${midiToNoteName(midi)}`}</span>
                </div>
              )}
            </>
          }
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Twój dźwięk', value: `${midiToNoteName(midi)} (${ROLE_LABEL[role]})` }}
              center={!take.started ? 'Uzupełnij akord' : !live?.f0 ? 'Brak dźwięku…' : inBand ? 'Czysto' : live.cents > 0 ? 'Za wysoko' : 'Za nisko'}
              centerSub={live && Number.isFinite(live.cents) ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
              centerClass={inBand ? 'text-emerald-300' : 'text-white/80'}
              right={{ label: 'Twój głos', value: live?.f0 ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
              progress={take.elapsed / SING_SEC}
              progressText={`${formatDecimalPl(take.elapsed, 1)} / ${formatDecimalPl(SING_SEC, 1)} s`}
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && !intro && (
        <SetupCard>
          {switcher}
          <Instructions
            steps={[
              'Najpierw usłyszysz pełny akord, a potem jedynie Twój dźwięk.',
              'Po odliczaniu usłyszysz akord, w którym brakuje Twojego dźwięku. Uzupełnij go, śpiewając <i>a</i> na swojej wysokości.',
              'Pamiętaj, że Twój głos musi dopasować się do pozostałych dźwięków. Postaraj się śpiewać na stabilnej wysokości, czysto intonując i stwórz harmoniczne brzmienie z dźwiękami pianina.'
            ]}
            numbered={false}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Słuchawki</span>
              <Segmented value={headphones} onChange={setHeadphones} options={[{ id: 'yes', label: 'tak' }, { id: 'no', label: 'nie' }]} />
            </div>
            <p className="font-cardo text-[13px] text-[#466cd2] leading-snug">To ćwiczenie najlepiej wykonywać w słuchawkach – wtedy mikrofon rejestruje tylko Twój głos. Bez słuchawek akord gra ciszej.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Akord</span>
              <Segmented value={quality} onChange={setQuality} options={[{ id: 'major', label: 'durowy' }, { id: 'minor', label: 'molowy' }]} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Twój dźwięk to</span>
              <Segmented value={role} onChange={setRole} options={[{ id: 'root', label: 'pryma' }, { id: 'third', label: 'tercja' }, { id: 'fifth', label: 'kwinta' }]} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Twój dźwięk" sub={`akord ${name}`} noteName={midiToNoteName} />
            <button type="button" onClick={() => void start()} className={BTN_PRIMARY}>Rozpocznij</button>
          </div>
          {loadError && <p className="text-[13px] text-rose-700 text-center">Nie udało się wczytać nagrań pianina. Sprawdź, czy pliki są w folderze /grand-piano.</p>}
        </SetupCard>
      )}

      {intro === 'loading' && <p className="font-cardo text-white/80">Wczytywanie dźwięków pianina…</p>}

      {take.phase === 'done' && feedback && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={feedback.tone} headline={feedback.headline} detail={feedback.detail} />
          <ResultTiles rows={feedback.rows} colors={TILE_COLOR} />
          <ResultActions>
            <button type="button" onClick={() => void start()} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={take.reset} className={BTN}>Zmień ustawienia</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
