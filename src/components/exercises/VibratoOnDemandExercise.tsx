import { useMemo, useState } from 'react';
import PitchPlot from './PitchPlot';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  Instructions,
  LightCard,
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
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName, playReferenceNote } from '../../utils/noteUtils';
import { readMpfrRange } from './exerciseUi';
import { VIB_PLAN, VIB_SEGMENT_SEC, analyzeVibratoSegments, vibratoOnDemandFeedback, type Feedback, type VibSegment } from '../../utils/popExercises';

const TOTAL_SEC = VIB_PLAN.length * VIB_SEGMENT_SEC;
const ZONES = VIB_PLAN.map((v, i) => ({ t0: i * VIB_SEGMENT_SEC, t1: (i + 1) * VIB_SEGMENT_SEC, label: v ? 'z wibrato' : 'bez wibrato', accent: v }));
const MIN_MIDI = 40;
const MAX_MIDI = 79;

export default function VibratoOnDemandExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [midi, setMidi] = useState(() => (mpfr ? Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round((mpfr.lowMidi + mpfr.highMidi) / 2))) : 57));
  const [result, setResult] = useState<{ fb: Feedback; segs: VibSegment[] } | null>(null);
  const take = useTake();
  const targetHz = useMemo(() => getCalibratedMidiFreq(midi), [midi]);

  const start = () => {
    setResult(null);
    void take.run({
      maxSec: TOTAL_SEC,
      referenceMidi: midi,
      targetHz,
      onDone: (frames) => {
        const segs = analyzeVibratoSegments(frames);
        setResult({ fb: vibratoOnDemandFeedback(segs), segs });
      }
    });
  };

  const seg = Math.min(VIB_PLAN.length - 1, Math.floor(take.elapsed / VIB_SEGMENT_SEC));
  const want = VIB_PLAN[seg] ?? false;
  const toSwitch = VIB_SEGMENT_SEC - (take.elapsed % VIB_SEGMENT_SEC);

  return (
    <ExercisePage kicker="Ćwiczenie dla śpiewaków rozrywkowych" title="Wibrato na żądanie" subtitle="na zmianę: prosto i z wibrato" onBack={() => { take.cancel(); onBack(); }}>
      {take.phase !== 'idle' && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<PitchPlot dataRef={take.plotRef} durationSec={TOTAL_SEC} bandCents={50} rangeCents={150} targetLabel={midiToNoteName(midi)} running={take.phase === 'recording'} zones={ZONES} />}
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Odcinek', value: `${seg + 1} / ${VIB_PLAN.length}` }}
              center={<span className={`text-base font-normal ${want ? 'text-pink-200' : 'text-white'}`}>{!take.started ? 'Zacznij prostym dźwiękiem' : want ? 'Teraz: z wibrato' : 'Teraz: bez wibrato'}</span>}
              centerSubClass={`text-xs font-bold font-mono ${want ? 'text-pink-200' : 'text-white'}`}
              centerSub={take.started && seg < VIB_PLAN.length - 1 ? `zmiana za ${Math.ceil(toSwitch)} s` : ' '}
              right={{ label: 'Twój głos', value: take.live?.f0 ? `${formatDecimalPl(take.live.f0, 1)} Hz` : '--- Hz' }}
              progress={take.elapsed / TOTAL_SEC}
              progressText={`${formatDecimalPl(take.elapsed, 1)} / ${TOTAL_SEC} s`}
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
              'Usłyszysz dźwięk wzorcowy. Po odliczaniu zaśpiewaj go na <i>a</i> i trzymaj przez całe nagranie.',
              `Co ${VIB_SEGMENT_SEC} sekundy zmieniaj sposób śpiewania: zacznij prostym dźwiękiem, potem włącz wibrato, potem znów prosto i znów z wibrato.`,
              'Odcinki są zaznaczone na wykresie, a pod nim widać, co śpiewać teraz i ile zostało do zmiany.'
            ]}
            numbered={false}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Dźwięk wzorcowy" sub={`${formatDecimalPl(targetHz, 1)} Hz`} noteName={midiToNoteName} />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => playReferenceNote(midi)} className={BTN}>♪ Posłuchaj dźwięku</button>
              <button type="button" onClick={start} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
        </SetupCard>
      )}

      {take.phase === 'done' && result && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={result.fb.tone} headline={result.fb.headline} detail={result.fb.detail} />
          <ResultTiles rows={result.fb.rows} colors={{ ok: '#2f8f5b', rate: '#cc8822', extent: '#8234c7', straight: '#256899' }} />
          {result.fb.rows.length > 0 && (
            <LightCard>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {result.segs.map((s) => (
                  <div key={s.index} className={`rounded-lg px-3 py-2 text-center ${s.ok ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                    <div className="font-seasons text-[13px]">{s.index + 1}. {s.want ? 'z wibrato' : 'bez wibrato'}</div>
                    <div className="font-cardo text-[12px] text-[#466cd2]">
                      {s.voiced < 40 ? 'za mało dźwięku' : s.result.hasVibrato ? `wibrato ${formatDecimalPl(s.result.rateHz, 1)} Hz` : 'prosty dźwięk'} {s.ok ? '✓' : '✗'}
                    </div>
                  </div>
                ))}
              </div>
            </LightCard>
          )}
          <ResultActions>
            <button type="button" onClick={start} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={take.reset} className={BTN}>Zmień dźwięk</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
