import { useState } from 'react';
import LipTrillEngine from './LipTrillEngine';
import LipTrillMelody from './LipTrillMelody';
import { Segmented, readMpfrRange } from './exerciseUi';

type Stage = 'engine' | 'melody';

export default function LipTrillExercise({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<Stage>('engine');
  const [mpfr] = useState(readMpfrRange);
  // dźwięk dla etapu 1
  const engineMidi = mpfr ? Math.max(40, Math.min(79, Math.round(mpfr.lowMidi + (mpfr.highMidi - mpfr.lowMidi) * 0.3))) : 53;

  const switcher = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <Segmented
        value={stage}
        onChange={setStage}
        options={[
          { id: 'engine', label: '1. Jeden dźwięk' },
          { id: 'melody', label: '2. Rozśpiewka' }
        ]}
      />
      <span className="font-cardo text-[13px] text-[#466cd2]">
        {stage === 'engine' ? 'Równy tryl przez 10 sekund' : 'Melodie śpiewane trylem w kolejnych tonacjach'}
      </span>
    </div>
  );

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white select-none">
      <div className="max-w-5xl mx-auto min-h-full px-4 sm:px-8 pt-24 sm:pt-8 pb-8 flex flex-col items-center gap-5 relative">
        <div className="w-full flex justify-end">
          <button
            type="button"
            onClick={onBack}
            className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm"
          >
            ← Wróć do ćwiczeń
          </button>
        </div>

        <div className="text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">Ćwiczenie ogólne</span>
          <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] uppercase drop-shadow-sm leading-tight">
            Tryl wargowy
          </h1>
          <span className="text-sm text-white/70 block mt-1">{stage === 'engine' ? 'etap 1: tryl na jednym dźwięku' : 'etap 2: melodia z trylem'}</span>
        </div>

        {stage === 'engine' ? (
          <LipTrillEngine key="engine" defaultMidi={engineMidi} stageSwitcher={switcher} onNextStage={() => setStage('melody')} onBack={onBack} />
        ) : (
          <LipTrillMelody key="melody" mpfr={mpfr} stageSwitcher={switcher} onBack={onBack} />
        )}
      </div>
    </div>
  );
}
