import { useState } from 'react';
import LipTrillMelody from './LipTrillMelody';
import { ExercisePage, readMpfrRange } from './exerciseUi';

/** Rozśpiewka */
export default function WarmupExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  return (
    <ExercisePage kicker="Ćwiczenie ogólne" title="Rozśpiewka" subtitle="melodie na sylabach w kolejnych tonacjach" onBack={onBack}>
      <LipTrillMelody mpfr={mpfr} onBack={onBack} variant="vocal" />
    </ExercisePage>
  );
}
