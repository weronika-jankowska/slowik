import { useState } from 'react';
import YawnSighExercise from './YawnSighExercise';
import { NewNoteStage, SirenStage } from './RangeStages';
import { ExercisePage, Segmented, readMpfrRange } from './exerciseUi';

// Poszerzanie skali w trzech etapach

type Stage = 'yawn' | 'siren' | 'new';

const SUBTITLE: Record<Stage, string> = {
  yawn: 'etap 1: ziewnięcie z westchnieniem',
  siren: 'etap 2: syrena',
  new: 'etap 3: nowy dźwięk'
};

export default function RangeExercise({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<Stage>('yawn');
  const [mpfr] = useState(readMpfrRange);
  const [sessionPeak, setSessionPeak] = useState(-Infinity);
  const notePeak = (m: number) => setSessionPeak((p) => Math.max(p, m));
  // przejście z wyników do innego etapu
  const goTo = (s: Stage) => { setStage(s); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const switcher = (
    <Segmented
      value={stage}
      onChange={setStage}
      options={[
        { id: 'yawn', label: '1. Ziewnięcie' },
        { id: 'siren', label: '2. Syrena' },
        { id: 'new', label: '3. Nowy dźwięk' }
      ]}
    />
  );

  return (
    <ExercisePage kicker="Ćwiczenie ogólne" title="Poszerzanie skali" subtitle={SUBTITLE[stage]} onBack={onBack}>
      {/* przełącznik etapów zawsze widoczny */}
      <div className="relative z-10">{switcher}</div>
      {stage === 'yawn' && <YawnSighExercise key="yawn" onBack={onBack} onPeak={notePeak} next={{ label: 'Dalej: syrena →', go: () => goTo('siren') }} />}
      {stage === 'siren' && <SirenStage key="siren" mpfr={mpfr} stageSwitcher={null} onPeak={notePeak} onBack={onBack} next={{ label: 'Dalej: nowy dźwięk →', go: () => goTo('new') }} />}
      {stage === 'new' && <NewNoteStage key="new" mpfr={mpfr} sessionPeak={sessionPeak} stageSwitcher={null} onBack={onBack} next={{ label: '← Wróć do ziewnięcia', go: () => goTo('yawn') }} />}
    </ExercisePage>
  );
}
