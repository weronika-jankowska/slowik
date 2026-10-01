import { useState, useRef, useEffect } from 'react';
import type { UserVoiceProfile } from '../types';

interface ManualProfileSurveyProps {
  onBack: () => void;
  onComplete: (profile: UserVoiceProfile) => void;
}

type Step = 'SCALE_UP' | 'SCALE_DOWN' | 'LEVEL' | 'STYLE' | 'SUMMARY';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_C4 = 60; // C4

const midiToNoteName = (midi: number): string => {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[noteIndex] ?? "C";
  return `${name}${octave}`;
};

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export default function ManualProfileSurvey({ onBack, onComplete }: ManualProfileSurveyProps) {
  const [step, setStep] = useState<Step>('SCALE_UP');

  // Brak domyślnie zaznaczonych wartości
  const [highestMidi, setHighestMidi] = useState<number | null>(null);
  const [lowestMidi, setLowestMidi] = useState<number | null>(null);
  const [level, setLevel] = useState<'Początkujący' | 'Średniozaawansowany' | 'Zaawansowany' | null>(null);
  const [primaryStyle, setPrimaryStyle] = useState<'Amatorski' | 'Chóralny' | 'Rozrywkowy' | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
      }
    };
  }, []);

  const playTone = (freq: number) => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 1.2);
  };

  const handleKeyClick = (midi: number) => {
    playTone(midiToFreq(midi));

    if (step === 'SCALE_UP') {
      const selected = Math.max(MIDI_C4, midi);
      setHighestMidi(selected);
    } else if (step === 'SCALE_DOWN') {
      const selected = Math.min(MIDI_C4 - 1, midi);
      setLowestMidi(selected);
    }
  };

  const handleFinish = () => {
    if (!lowestMidi || !highestMidi || !level || !primaryStyle) return;

    const lowNoteName = midiToNoteName(lowestMidi);
    const highNoteName = midiToNoteName(highestMidi);

    const profile: UserVoiceProfile = {
      level: level as unknown as 'Początkujący' | 'Średniozaawansowany' | 'Profesjonalny',
      primaryStyle: primaryStyle as unknown as 'Klasyczny' | 'Rozrywkowy' | 'Amatorski',
      metrics: {
        pitchMinHz: Math.round(midiToFreq(lowestMidi) * 10) / 10,
        pitchMaxHz: Math.round(midiToFreq(highestMidi) * 10) / 10,
        vocalRangeNotes: { low: lowNoteName, high: highNoteName },
        intonationErrorCents: level === 'Zaawansowany' ? 12 : level === 'Średniozaawansowany' ? 24 : 38,
        shimmerDb: level === 'Zaawansowany' ? 0.2 : 0.45,
        vibrato: {
          present: level !== 'Początkujący',
          rateHz: level !== 'Początkujący' ? 5.8 : 0,
          extentCents: level !== 'Początkujący' ? 50 : 0,
          onsetDelaySec: level === 'Zaawansowany' ? 0.2 : 0.5
        },
        singerFormantEnergyDb: primaryStyle === 'Chóralny' ? -14 : primaryStyle === 'Rozrywkowy' ? -22 : -32
      }
    };

    onComplete(profile);
  };

  const keyboardKeys = Array.from({ length: 49 }, (_, i) => {
    const midi = 36 + i;
    const note = midiToNoteName(midi);
    const isBlack = note.includes('#');
    return { midi, note, isBlack };
  });

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-between py-8 px-4 relative z-10 font-cardo text-white">
      <button 
        onClick={onBack}
        className="absolute top-6 left-6 text-white/80 hover:text-white text-xs md:text-sm uppercase tracking-wider bg-white/10 hover:bg-white/20 py-2 px-4 rounded-lg backdrop-blur-xs transition-all cursor-pointer border-none"
      >
        ← Powrót
      </button>

      {/* KROK 1: SKALA W GÓRĘ */}
      {step === 'SCALE_UP' && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center justify-between gap-6">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 mb-1 block">Krok 1 z 4: Skala w górę</span>
            <h2 className="font-seasons text-3xl md:text-5xl tracking-wider mb-2">WYBIERZ NAJWYŻSZY DŹWIĘK</h2>
            <p className="font-seasons text-lg md:text-2xl text-white/90 font-light">
              Kliknij na klawiaturze najwyższy czysty dźwięk, jaki potrafisz zaśpiewać
            </p>
          </div>

          <div className="w-full max-w-5xl relative flex justify-center py-2 px-2 select-none">
            <div className="flex relative w-full bg-black/60 backdrop-blur-md p-3 md:p-5 rounded-3xl border border-white/20 shadow-2xl h-44 sm:h-52 md:h-60">
              {keyboardKeys
                .filter((k) => !k.isBlack)
                .map((whiteKey) => {
                  const isGreen = highestMidi !== null && whiteKey.midi >= MIDI_C4 && whiteKey.midi <= highestMidi;
                  const isTarget = whiteKey.midi === highestMidi;

                  const nextMidi = whiteKey.midi + 1;
                  const blackKey = keyboardKeys.find((k) => k.midi === nextMidi && k.isBlack);
                  const isBlackGreen = highestMidi !== null && blackKey && blackKey.midi >= MIDI_C4 && blackKey.midi <= highestMidi;
                  const isBlackTarget = blackKey && blackKey.midi === highestMidi;

                  let whiteBg = 'bg-white/95 text-zinc-800 hover:bg-white';
                  if (isTarget) whiteBg = '!bg-emerald-500 !text-white shadow-[0_0_20px_rgba(16,185,129,0.9)] scale-[1.02] z-10 ring-2 ring-white';
                  else if (isGreen) whiteBg = '!bg-emerald-500/80 !text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]';

                  return (
                    <div key={whiteKey.midi} className="relative flex-1 h-full">
                      <button
                        type="button"
                        onClick={() => handleKeyClick(whiteKey.midi)}
                        className={`w-full h-full rounded-b-xl border-r border-zinc-300 flex flex-col justify-end pb-2 items-center transition-all duration-150 active:scale-98 cursor-pointer focus:outline-none ${whiteBg}`}
                      >
                        <span className="font-body text-[8px] sm:text-[10px] md:text-xs font-bold opacity-75 pointer-events-none">
                          {whiteKey.note}
                        </span>
                      </button>

                      {blackKey && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleKeyClick(blackKey.midi);
                          }}
                          className={`absolute top-0 right-[-32%] w-[64%] h-[60%] z-20 rounded-b-md border border-zinc-700 flex flex-col justify-end pb-1 items-center transition-all duration-150 active:scale-95 cursor-pointer focus:outline-none ${
                            isBlackTarget
                              ? '!bg-emerald-500 !text-white shadow-[0_0_15px_rgba(16,185,129,0.9)] scale-105 ring-2 ring-white'
                              : isBlackGreen
                              ? '!bg-emerald-500/80 !text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                              : 'bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          <span className="font-body text-[7px] sm:text-[8px] md:text-[9px] font-bold opacity-80 pointer-events-none">
                            {blackKey.note.replace('#', '♯')}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <div className="bg-[rgba(255,255,255,0.45)] backdrop-blur-md rounded-2xl py-3 px-8 w-full text-center shadow-md border border-white/20">
              <span className="font-seasons text-lg md:text-xl text-[#18388f] font-bold">
                Wybrany najwyższy: {highestMidi ? midiToNoteName(highestMidi) : '---'}
              </span>
            </div>

            <button
              type="button"
              disabled={highestMidi === null}
              onClick={() => setStep('SCALE_DOWN')}
              className={`font-cardo text-sm md:text-base py-3 px-8 rounded-xl uppercase tracking-wider transition-all border-none shadow-md font-bold ${
                highestMidi !== null
                  ? 'text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white cursor-pointer'
                  : 'text-white/40 bg-white/10 cursor-not-allowed'
              }`}
            >
              Dalej: Wybierz dół →
            </button>
          </div>
        </div>
      )}

      {/* KROK 2: SKALA W DÓŁ */}
      {step === 'SCALE_DOWN' && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center justify-between gap-6">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 mb-1 block">Krok 2 z 4: Skala w dół</span>
            <h2 className="font-seasons text-3xl md:text-5xl tracking-wider mb-2">WYBIERZ NAJNIŻSZY DŹWIĘK</h2>
            <p className="font-seasons text-lg md:text-2xl text-white/90 font-light">
              Kliknij na klawiaturze najniższy dźwięk, do którego swobodnie schodzisz głosem
            </p>
          </div>

          <div className="w-full max-w-5xl relative flex justify-center py-2 px-2 select-none">
            <div className="flex relative w-full bg-black/60 backdrop-blur-md p-3 md:p-5 rounded-3xl border border-white/20 shadow-2xl h-44 sm:h-52 md:h-60">
              {keyboardKeys
                .filter((k) => !k.isBlack)
                .map((whiteKey) => {
                  const isUpGreen = highestMidi !== null && whiteKey.midi >= MIDI_C4 && whiteKey.midi <= highestMidi;
                  const isDownGreen = lowestMidi !== null && whiteKey.midi >= lowestMidi && whiteKey.midi < MIDI_C4;
                  const isTarget = whiteKey.midi === lowestMidi;

                  const nextMidi = whiteKey.midi + 1;
                  const blackKey = keyboardKeys.find((k) => k.midi === nextMidi && k.isBlack);
                  const isBlackUpGreen = highestMidi !== null && blackKey && blackKey.midi >= MIDI_C4 && blackKey.midi <= highestMidi;
                  const isBlackDownGreen = lowestMidi !== null && blackKey && blackKey.midi >= lowestMidi && blackKey.midi < MIDI_C4;
                  const isBlackTarget = blackKey && blackKey.midi === lowestMidi;

                  let whiteBg = 'bg-white/95 text-zinc-800 hover:bg-white';
                  if (isTarget) whiteBg = '!bg-emerald-500 !text-white shadow-[0_0_20px_rgba(16,185,129,0.9)] scale-[1.02] z-10 ring-2 ring-white';
                  else if (isUpGreen || isDownGreen) whiteBg = '!bg-emerald-500/80 !text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]';

                  return (
                    <div key={whiteKey.midi} className="relative flex-1 h-full">
                      <button
                        type="button"
                        onClick={() => handleKeyClick(whiteKey.midi)}
                        className={`w-full h-full rounded-b-xl border-r border-zinc-300 flex flex-col justify-end pb-2 items-center transition-all duration-150 active:scale-98 cursor-pointer focus:outline-none ${whiteBg}`}
                      >
                        <span className="font-body text-[8px] sm:text-[10px] md:text-xs font-bold opacity-75 pointer-events-none">
                          {whiteKey.note}
                        </span>
                      </button>

                      {blackKey && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleKeyClick(blackKey.midi);
                          }}
                          className={`absolute top-0 right-[-32%] w-[64%] h-[60%] z-20 rounded-b-md border border-zinc-700 flex flex-col justify-end pb-1 items-center transition-all duration-150 active:scale-95 cursor-pointer focus:outline-none ${
                            isBlackTarget
                              ? '!bg-emerald-500 !text-white shadow-[0_0_15px_rgba(16,185,129,0.9)] scale-105 ring-2 ring-white'
                              : isBlackUpGreen || isBlackDownGreen
                              ? '!bg-emerald-500/80 !text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                              : 'bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          <span className="font-body text-[7px] sm:text-[8px] md:text-[9px] font-bold opacity-80 pointer-events-none">
                            {blackKey.note.replace('#', '♯')}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <div className="bg-[rgba(255,255,255,0.45)] backdrop-blur-md rounded-2xl py-3 px-8 w-full text-center shadow-md border border-white/20">
              <span className="font-seasons text-lg md:text-xl text-[#18388f] font-bold">
                Wybrana skala: {lowestMidi ? midiToNoteName(lowestMidi) : '---'} – {highestMidi ? midiToNoteName(highestMidi) : '---'}
              </span>
            </div>

            <button
              type="button"
              disabled={lowestMidi === null}
              onClick={() => setStep('LEVEL')}
              className={`font-cardo text-sm md:text-base py-3 px-8 rounded-xl uppercase tracking-wider transition-all border-none shadow-md font-bold ${
                lowestMidi !== null
                  ? 'text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white cursor-pointer'
                  : 'text-white/40 bg-white/10 cursor-not-allowed'
              }`}
            >
              Dalej: Poziom zaawansowania →
            </button>
          </div>
        </div>
      )}

      {/* KROK 3: POZIOM ZAAWANSOWANIA */}
      {step === 'LEVEL' && (
        <div className="w-full max-w-md my-auto flex flex-col items-center text-center gap-6">
          <div>
            <span className="text-xs uppercase tracking-widest text-white/60 mb-1 block">Krok 3 z 4: Doświadczenie</span>
            <h2 className="font-seasons text-3xl md:text-5xl tracking-wider uppercase mb-2">
              TWÓJ POZIOM ZAAWANSOWANIA
            </h2>
            <p className="font-seasons text-base md:text-xl text-white/90 font-light">
              Wybierz opcję najlepiej opisującą Twoją kontrolę głosu
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full">
            {(['Początkujący', 'Średniozaawansowany', 'Zaawansowany'] as const).map((lvl) => (
              <button
                type="button"
                key={lvl}
                onClick={() => {
                  setLevel(lvl);
                  setStep('STYLE');
                }}
                className={`w-full font-cardo text-base md:text-xl py-4 px-6 rounded-xl uppercase tracking-wider transition-all duration-200 cursor-pointer border border-white/20 shadow-md ${
                  level === lvl
                    ? 'bg-white text-[#18388f] font-bold shadow-lg scale-[1.02]'
                    : 'bg-white/20 hover:bg-white/30 text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KROK 4: STYL ŚPIEWU */}
      {step === 'STYLE' && (
        <div className="w-full max-w-md my-auto flex flex-col items-center text-center gap-6">
          <div>
            <span className="text-xs uppercase tracking-widest text-white/60 mb-1 block">Krok 4 z 4: Styl</span>
            <h2 className="font-seasons text-3xl md:text-5xl tracking-wider uppercase mb-2">
              TWÓJ STYL ŚPIEWU
            </h2>
            <p className="font-seasons text-base md:text-xl text-white/90 font-light">
              Wybierz preferowany rodzaj emisji głosu
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full">
            {(['Amatorski', 'Chóralny', 'Rozrywkowy'] as const).map((stl) => (
              <button
                type="button"
                key={stl}
                onClick={() => {
                  setPrimaryStyle(stl);
                  setStep('SUMMARY');
                }}
                className={`w-full font-cardo text-base md:text-xl py-4 px-6 rounded-xl uppercase tracking-wider transition-all duration-200 cursor-pointer border border-white/20 shadow-md ${
                  primaryStyle === stl
                    ? 'bg-white text-[#18388f] font-bold shadow-lg scale-[1.02]'
                    : 'bg-white/20 hover:bg-white/30 text-white'
                }`}
              >
                {stl}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KROK 5: KARTA PODSUMOWANIA */}
      {step === 'SUMMARY' && (
        <div className="w-full max-w-3xl my-auto flex flex-col items-center gap-6 text-center">
          <h2 className="font-seasons text-3xl md:text-5xl tracking-wider">TWÓJ PROFIL WOKALNY</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mt-4">
            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-5 shadow-md text-[#18388f] flex flex-col justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider block font-bold mb-1 opacity-70">Skala głosu</span>
                <span className="font-seasons text-2xl block my-1">
                  {lowestMidi ? midiToNoteName(lowestMidi) : '---'} – {highestMidi ? midiToNoteName(highestMidi) : '---'}
                </span>
              </div>
            </div>

            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-5 shadow-md text-[#18388f] flex flex-col justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider block font-bold mb-1 opacity-70">Poziom zaawansowania</span>
                <span className="font-seasons text-xl block my-1 font-bold">
                  {level}
                </span>
              </div>
            </div>

            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-5 shadow-md text-[#18388f] flex flex-col justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider block font-bold mb-1 opacity-70">Styl śpiewu</span>
                <span className="font-seasons text-xl block my-1 font-bold">
                  {primaryStyle}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleFinish}
            className="font-cardo text-sm md:text-lg py-4 px-8 rounded-xl tracking-wider uppercase text-[#18388f] bg-[rgba(255,255,255,0.45)] hover:bg-[rgba(125,148,222,0.75)] transition-all cursor-pointer border-none mt-6 shadow-md font-bold"
          >
            Przejdź do doboru ćwiczeń
          </button>
        </div>
      )}
    </div>
  );
}