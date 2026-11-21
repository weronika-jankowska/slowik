import { useState } from 'react';
import BreathTake from './BreathTake';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  LightCard,
  NotePicker,
  ResultActions,
  ResultHeader,
  ResultTiles,
  SetupCard,
  readMpfrRange
} from './exerciseUi';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName, playReferenceNote } from '../../utils/noteUtils';
import { BREATH_LEVEL_TEXT, breathScore, compareBreath, type BreathSummary } from '../../utils/breathiness';

// Powietrze w głosie

type Stage = 'setup' | 'before' | 'video' | 'after' | 'result';

const VIDEO_ID = 'GlcsXeHYu9c';
const TAKE_SEC = 5;
const MIN_MIDI = 40;
const MAX_MIDI = 79;

const TILE_COLOR: Record<string, string> = { before: '#256899', after: '#2f8f5b', diff: '#8234c7' };

const levelText = (s: BreathSummary) => (s.level ? BREATH_LEVEL_TEXT[s.level] : '—');
const scoreText = (s: BreathSummary) => (s.level ? `Wskaźnik powietrza: ${breathScore(s.index)} / 100` : 'Brak odczytu');

export default function BreathinessExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [midi, setMidi] = useState(() =>
    mpfr ? Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(mpfr.lowMidi + (mpfr.highMidi - mpfr.lowMidi) * 0.35))) : 55
  );
  const [stage, setStage] = useState<Stage>('setup');
  const [takeKey, setTakeKey] = useState(0);
  const [before, setBefore] = useState<BreathSummary | null>(null);
  const [after, setAfter] = useState<BreathSummary | null>(null);

  const go = (s: Stage) => { setTakeKey((k) => k + 1); setStage(s); };
  const cmp = before && after ? compareBreath(before, after) : null;
  const beforeFailed = before !== null && !before.level;

  return (
    <ExercisePage kicker="Ćwiczenie ogólne" title="Powietrze w głosie" subtitle="pomiar – ćwiczenia – pomiar" onBack={onBack}>
      {stage === 'before' && (
        <BreathTake key={`b${takeKey}`} durationSec={TAKE_SEC} referenceMidi={midi}
          onDone={(r) => { setBefore(r); setStage('video'); }} onCancel={() => setStage('setup')} />
      )}
      {stage === 'after' && (
        <BreathTake key={`a${takeKey}`} durationSec={TAKE_SEC} referenceMidi={midi}
          onDone={(r) => { setAfter(r); setStage('result'); }} onCancel={() => setStage('video')} />
      )}

      {stage === 'setup' && (
        <SetupCard>
          <div className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5">
            <p>Jeśli Twoim problemem jest zapowietrzony głos, wykonaj tę serię ćwiczeń.</p>
            <p>Na początku aplikacja zmierzy powietrze w Twoim głosie. Zaśpiewaj dźwięk wzorcowy swobodnie.</p>
            <p>Następnie wykonaj ćwiczenia zgodnie z instrukcjami z filmu. W trakcie trwania ćwiczeń mikrofon nic nie nagrywa – po prostu śpiewaj i ćwicz.</p>
            <p>Po wykonaniu serii ćwiczeń ponownie zmierz swój głos na tym samym dźwięku. Postaraj się śpiewać tak samo głośno, jak przedtem.</p>
            <p>Na koniec zobaczysz porównanie obu pomiarów, dzięki czemu sprawdzisz, czy Twój głos się poprawił.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Dźwięk wzorcowy" sub={`${formatDecimalPl(getCalibratedMidiFreq(midi), 1)} Hz`} noteName={midiToNoteName} />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => playReferenceNote(midi)} className={BTN}>♪ Posłuchaj dźwięku</button>
              <button type="button" onClick={() => go('before')} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
        </SetupCard>
      )}

      {stage === 'video' && (
        <>
          {beforeFailed ? (
            <LightCard className="max-w-3xl text-center">
              <h2 className="font-seasons text-xl tracking-wide">Nie udało się zmierzyć głosu</h2>
              <p className="font-cardo text-[14px] text-[#2c49a8] mt-1">Zaśpiewaj równe [A] przez cały czas nagrania, na dźwięku wzorcowym i nie za cicho, a potem powtórz pierwszy pomiar.</p>
            </LightCard>
          ) : (
            <p className="w-full max-w-3xl font-cardo text-[15px] sm:text-[16px] text-[#18388f] leading-snug text-center">
              Pierwszy pomiar został zapisany. Teraz wykonaj ćwiczenia z filmu. Gdy skończysz, zmierz głos ponownie. Na zakończenie zobaczysz porównanie obu pomiarów.
            </p>
          )}
          <div className="w-full max-w-3xl aspect-video rounded-2xl overflow-hidden border border-white/30 shadow-2xl bg-black/40">
            <iframe
              className="w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`}
              title="Rozśpiewka na zapowietrzony głos – Dźwiękodzieło"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="font-cardo text-[12px] text-white/60 -mt-2">Film: kanał Dźwiękodzieło (YouTube)</p>
          <ResultActions>
            <button type="button" onClick={() => go('before')} className={beforeFailed ? BTN_PRIMARY : BTN}>Powtórz pierwszy pomiar</button>
            {!beforeFailed && (
              <button type="button" onClick={() => go('after')} className={BTN_PRIMARY}>Ćwiczenia zrobione – zmierz ponownie</button>
            )}
          </ResultActions>
        </>
      )}

      {stage === 'result' && before && after && cmp && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={cmp.tone} headline={cmp.headline} detail={cmp.detail} />
          <ResultTiles
            colors={TILE_COLOR}
            rows={[
              { id: 'before', label: 'przed ćwiczeniami', value: levelText(before), comment: scoreText(before) },
              { id: 'after', label: 'po ćwiczeniach', value: levelText(after), comment: scoreText(after) },
              { id: 'diff', label: 'zmiana', value: cmp.change, comment: '0 – głos dźwięczny, 100 – wyraźnie słyszalne powietrze' }
            ]}
          />
          <ResultActions>
            <button type="button" onClick={() => go('video')} className={BTN_PRIMARY}>Wróć do filmu</button>
            <button type="button" onClick={() => go('after')} className={BTN}>Zmierz jeszcze raz</button>
            <button type="button" onClick={() => { setBefore(null); setAfter(null); setStage('setup'); }} className={BTN}>Od początku</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
