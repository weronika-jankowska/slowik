import { useState, useEffect, useRef } from 'react';
import { 
  calculateRMS, 
  pitchYIN, 
  calculateSpectralNoise,
  calculateSingerFormantAndSPR,
  extractGlottalCycles,
  calculateJitterShimmerCycleToCycle,
  calculateHNR,
  analyzeVibratoFull,
  //evaluateAdvancementScore,
  //classifySingingStyleDecision,
  calculateMPFRMetrics,
  type AcousticMetricsState,
  type MPFRResult,
  type AdvancementLevel,
  type SingingStyle
} from '../utils/audioMetrics';

interface VoiceAnalysisProps {
  onBack: () => void;
}

type Stage = 
  | 'SCALE_UP_TEST' 
  | 'SCALE_UP_REVIEW' 
  | 'SCALE_DOWN_TEST' 
  | 'SCALE_DOWN_REVIEW' 
  | 'MULTIDISCIPLINARY_A' 
  | 'METRICS_REVIEW'
  | 'SUMMARY';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_C4 = 60;

const midiToNoteName = (midi: number): string => {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[noteIndex] ?? "C";
  return `${name}${octave}`;
};

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export default function VoiceAnalysis({ onBack }: VoiceAnalysisProps) {
  const [stage, setStage] = useState<Stage>('SCALE_UP_TEST');

  // Skala i MPFR
  const [currentMidi, setCurrentMidi] = useState<number>(MIDI_C4);
  const [highestMidi, setHighestMidi] = useState<number | null>(null);
  const [lowestMidi, setLowestMidi] = useState<number | null>(null);
  const [upGreenNotes, setUpGreenNotes] = useState<Set<string>>(new Set());
  const [downGreenNotes, setDownGreenNotes] = useState<Set<string>>(new Set());
  const [redNote, setRedNote] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [currentF0, setCurrentF0] = useState<number>(0);
  const [f0History, setF0History] = useState<number[]>([]);

  // Wyniki końcowe
  const [mpfrResult, setMpfrResult] = useState<MPFRResult | null>(null);
  const [advancementResult, setAdvancementResult] = useState<AdvancementLevel>('Średniozaawansowany');
  const [styleResult, setStyleResult] = useState<SingingStyle>('Chóralny');

  const [scaleMaeCents, setScaleMaeCents] = useState<number>(0);

  // Metryki akustyczne
  const [liveMetrics, setLiveMetrics] = useState<AcousticMetricsState>({
    f0: 0,
    rms: 0,
    rmsDbfs: -100,
    maeCents: 0,
    jitterPercent: 0,
    shimmerDb: 0,
    hnrDb: 0,
    spectralNoiseDb: 0,
    spectralCentroidHz: 0,
    singerFormantEnergyDb: 0,
    spr: 0,
    sppFreqHz: 0,
    vibrato: { 
      rateHz: 0, 
      extentCents: 0, 
      extentSemitones: 0, 
      onsetDelaySec: 0, 
      sinusoidality: 0, 
      periodicity: 0, 
      harmonicity: 0, 
      hasVibrato: false 
    }
  });

  const [finalMetrics, setFinalMetrics] = useState<AcousticMetricsState | null>(null);
  const [aProgress, setAProgress] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const stableHoldRef = useRef<number>(0);
  const pitchBufferRef = useRef<number[]>([]);
  const targetNoteFreqRef = useRef<number>(midiToFreq(MIDI_C4));

  const scalePitchErrorsRef = useRef<number[]>([]);

  useEffect(() => {
    void initAudio();
    return () => cleanupAudio();
  }, []);

  const initAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      micStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      startScaleUpFlow();
    } catch (err) {
      alert("Wymagany dostęp do mikrofonu.");
      console.error(err);
    }
  };

  const cleanupAudio = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) void audioCtxRef.current.close();
  };

  const playTone = (freq: number) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.0);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.0);
  };

  const handleKeyClick = (midi: number) => {
    playTone(midiToFreq(midi));
    if (stage === 'SCALE_UP_TEST' || stage === 'SCALE_DOWN_TEST') {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      setIsListening(false);
      stableHoldRef.current = 0;

      playTimerRef.current = window.setTimeout(() => {
        setIsListening(true);
        runScalePitchTracking(currentMidi, stage === 'SCALE_UP_TEST' ? 'UP' : 'DOWN');
      }, 900);
    }
  };

  // --- SEKWENCJE SKALI (GÓRA / DÓŁ) ---

  const startScaleUpFlow = () => {
    setStage('SCALE_UP_TEST');
    setHighestMidi(null);
    setUpGreenNotes(new Set());
    scalePitchErrorsRef.current = [];
    startScaleStep(MIDI_C4, 'UP');
  };

  const startScaleDownFlow = () => {
    setStage('SCALE_DOWN_TEST');
    setLowestMidi(null);
    setDownGreenNotes(new Set());
    startScaleStep(MIDI_C4 - 1, 'DOWN');
  };

  const startScaleStep = (midi: number, mode: 'UP' | 'DOWN') => {
    setCurrentMidi(midi);
    targetNoteFreqRef.current = midiToFreq(midi);
    setRedNote(null);
    setIsListening(false);
    stableHoldRef.current = 0;

    playTone(midiToFreq(midi));

    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = window.setTimeout(() => {
      setIsListening(true);
      runScalePitchTracking(midi, mode);
    }, 900);
  };

  const runScalePitchTracking = (midiVal: number, mode: 'UP' | 'DOWN') => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const analyser = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!analyser || !ctx) return;

    const buffer = new Float32Array(analyser.fftSize);
    const targetF = midiToFreq(midiVal);
    let attempts = 0;
    const stepErrors: number[] = [];

    const loop = () => {
      analyser.getFloatTimeDomainData(buffer);
      const rms = calculateRMS(buffer);

      if (rms > 0.018) {
        let f0 = pitchYIN(buffer, ctx.sampleRate, 0.15);
        if (f0 > 50 && f0 < 1500) {
          if (Math.abs(f0 * 2 - targetF) < targetF * 0.08) f0 = f0 * 2;
          else if (Math.abs(f0 / 2 - targetF) < targetF * 0.08) f0 = f0 / 2;

          setCurrentF0(f0);
          setF0History(prev => [...prev.slice(-40), f0]);

          const cents = 1200 * (Math.log(f0 / targetF) / Math.log(2));
          stepErrors.push(Math.abs(cents));

          if (Math.abs(cents) <= 45) {
            stableHoldRef.current += 1;
            if (stableHoldRef.current >= 26) {
              const avgStepErr = stepErrors.slice(-26).reduce((a, b) => a + b, 0) / 26;
              scalePitchErrorsRef.current.push(avgStepErr);
              handleScaleSuccess(midiVal, mode);
              return;
            }
          } else {
            stableHoldRef.current = Math.max(0, stableHoldRef.current - 1);
          }
        }
      } else {
        stableHoldRef.current = Math.max(0, stableHoldRef.current - 1);
      }

      attempts++;
      if (attempts > 300) {
        handleScaleFailure(midiVal, mode);
        return;
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const handleScaleSuccess = (passedMidi: number, mode: 'UP' | 'DOWN') => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsListening(false);

    const note = midiToNoteName(passedMidi);

    if (mode === 'UP') {
      setUpGreenNotes(prev => new Set(prev).add(note));
      setHighestMidi(passedMidi);
      setTimeout(() => startScaleStep(passedMidi + 1, 'UP'), 400);
    } else {
      setDownGreenNotes(prev => new Set(prev).add(note));
      setLowestMidi(passedMidi);
      setTimeout(() => startScaleStep(passedMidi - 1, 'DOWN'), 400);
    }
  };

  const handleScaleFailure = (failedMidi: number, mode: 'UP' | 'DOWN') => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsListening(false);
    setRedNote(midiToNoteName(failedMidi));

    setTimeout(() => {
      if (mode === 'UP') {
        setStage('SCALE_UP_REVIEW');
      } else {
        setStage('SCALE_DOWN_REVIEW');
      }
    }, 1000);
  };

  // --- FAZA 2: MULTIDYSCYPLINARNA ANALIZA SAMOGŁOSKI "A" ---

  const initMultidisciplinaryTest = () => {
    const finalLow = lowestMidi ?? (MIDI_C4 - 1);
    const finalHigh = highestMidi ?? MIDI_C4;
    const mpfr = calculateMPFRMetrics(finalLow, finalHigh);
    setMpfrResult(mpfr);
    setStage('MULTIDISCIPLINARY_A');

    const midMidi = Math.round((finalLow + finalHigh) / 2);
    targetNoteFreqRef.current = midiToFreq(midMidi);
    playTone(targetNoteFreqRef.current);

    pitchBufferRef.current = [];
    setAProgress(0);

    const analyser = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!analyser || !ctx) return;

    const buffer = new Float32Array(analyser.fftSize);
    let framesCollected = 0;
    const TOTAL_FRAMES = 160;

    const loop = () => {
      analyser.getFloatTimeDomainData(buffer);
      const rms = calculateRMS(buffer);

      if (rms > 0.015) {
        const f0 = pitchYIN(buffer, ctx.sampleRate, 0.15);
        if (f0 > 60 && f0 < 1300) {
          pitchBufferRef.current.push(f0);
          framesCollected++;

          setAProgress(Math.min(100, Math.round((framesCollected / TOTAL_FRAMES) * 100)));

          const targetF = targetNoteFreqRef.current;
          const centsError = Math.abs(1200 * (Math.log(f0 / targetF) / Math.log(2)));
          const noiseDb = calculateSpectralNoise(analyser, f0);
          const sfAndSpr = calculateSingerFormantAndSPR(analyser);

          const cycles = extractGlottalCycles(buffer, ctx.sampleRate, f0);
          const pert = calculateJitterShimmerCycleToCycle(cycles.periods, cycles.peakAmplitudes);
          const hnr = calculateHNR(buffer, ctx.sampleRate, f0);
          const vib = analyzeVibratoFull(pitchBufferRef.current);

          const curState: AcousticMetricsState = {
            f0: Math.round(f0 * 10) / 10,
            rms: Math.round(rms * 1000) / 1000,
            rmsDbfs: Math.round(20 * Math.log10(rms + 1e-6)),
            maeCents: Math.round(centsError * 10) / 10,
            jitterPercent: pert.jitterPercent,
            shimmerDb: pert.shimmerDb,
            hnrDb: hnr,
            spectralNoiseDb: Math.round(noiseDb * 10) / 10,
            spectralCentroidHz: sfAndSpr.spectralCentroidHz,
            singerFormantEnergyDb: sfAndSpr.sfEnergyDb,
            spr: sfAndSpr.spr,
            sppFreqHz: sfAndSpr.sppFreqHz,
            vibrato: vib
          };

          setLiveMetrics(curState);

          if (framesCollected >= TOTAL_FRAMES) {
            const scaleErrors = scalePitchErrorsRef.current;
            const avgScale = scaleErrors.length > 0 ? scaleErrors.reduce((a, b) => a + b, 0) / scaleErrors.length : curState.maeCents;
            const overallAverageMae = Math.round(((avgScale + curState.maeCents) / 2) * 10) / 10;
            setScaleMaeCents(overallAverageMae);

            const evaluationMetrics: AcousticMetricsState = {
              ...curState,
              maeCents: overallAverageMae
            };

            setFinalMetrics(evaluationMetrics);
            //const adv = evaluateAdvancementScore(evaluationMetrics);
            //const stl = classifySingingStyleDecision(evaluationMetrics);

            //setAdvancementResult(adv.level);
            //setStyleResult(stl);
            setStage('METRICS_REVIEW');
            return;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const keyboardKeys = Array.from({ length: 49 }, (_, i) => {
    const midi = 36 + i;
    const note = midiToNoteName(midi);
    const isBlack = note.includes('#');
    return { midi, note, isBlack };
  });

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-between py-6 px-4 relative z-10 font-cardo text-white">
      <button 
        onClick={onBack}
        className="absolute top-6 left-6 text-white/80 hover:text-white text-xs uppercase tracking-wider bg-white/10 hover:bg-white/20 py-2 px-4 rounded-lg backdrop-blur-xs transition-all border-none cursor-pointer"
      >
        ← Powrót do menu
      </button>

      {/* 1A. ETAP: BADANIE SKALI W GÓRĘ / W DÓŁ */}
      {(stage === 'SCALE_UP_TEST' || stage === 'SCALE_DOWN_TEST') && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center gap-4">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">
              Etap 1: Badanie Skali ({stage === 'SCALE_UP_TEST' ? 'W Górę' : 'W Dół'})
            </span>
            <h2 className="font-seasons text-2xl md:text-4xl tracking-wider">
              ŚPIEWAJ KOLEJNE DŹWIĘKI [A]
            </h2>
            <p className="text-xs opacity-70 mt-1">
              Kliknij na klawisz, aby odsłuchać dźwięk ponownie
            </p>
          </div>

          <div className="w-full max-w-4xl relative flex justify-center py-2 select-none">
            <div className="flex relative w-full bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/20 shadow-2xl h-40 sm:h-48">
              {keyboardKeys
                .filter(k => !k.isBlack)
                .map(whiteKey => {
                  const targetName = midiToNoteName(currentMidi);
                  const isTarget = targetName === whiteKey.note;
                  const isGreen = upGreenNotes.has(whiteKey.note) || downGreenNotes.has(whiteKey.note);
                  const isRed = redNote === whiteKey.note;

                  const nextMidi = whiteKey.midi + 1;
                  const blackKey = keyboardKeys.find(k => k.midi === nextMidi && k.isBlack);
                  const isBlackTarget = blackKey && targetName === blackKey.note;
                  const isBlackGreen = blackKey && (upGreenNotes.has(blackKey.note) || downGreenNotes.has(blackKey.note));
                  const isBlackRed = blackKey && redNote === blackKey.note;

                  let whiteBg = 'bg-white/95 text-zinc-800 hover:bg-white cursor-pointer';
                  if (isGreen) whiteBg = '!bg-emerald-500 !text-white';
                  if (isRed) whiteBg = '!bg-rose-600 !text-white animate-pulse';
                  if (isTarget && !isRed) whiteBg = '!bg-[#7d94de] !text-white scale-[1.02] ring-2 ring-white';

                  return (
                    <div key={whiteKey.midi} className="relative flex-1 h-full">
                      <button
                        type="button"
                        onClick={() => handleKeyClick(whiteKey.midi)}
                        className={`w-full h-full rounded-b-lg border-r border-zinc-300 flex flex-col justify-end pb-2 items-center transition-all focus:outline-none ${whiteBg}`}
                      >
                        <span className="text-[9px] font-bold opacity-75 pointer-events-none">{whiteKey.note}</span>
                      </button>

                      {blackKey && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleKeyClick(blackKey.midi);
                          }}
                          className={`absolute top-0 right-[-32%] w-[64%] h-[60%] z-20 rounded-b-md border border-zinc-700 flex flex-col justify-end pb-1 items-center transition-all focus:outline-none cursor-pointer ${
                            isBlackGreen ? '!bg-emerald-500 !text-white' : isBlackRed ? '!bg-rose-600 !text-white animate-pulse' : isBlackTarget ? '!bg-[#7d94de] !text-white ring-2 ring-white' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          <span className="text-[7px] font-bold opacity-80 pointer-events-none">{blackKey.note.replace('#', '♯')}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="w-full max-w-xl bg-black/40 backdrop-blur-md p-4 rounded-xl border border-white/20 flex flex-col items-center">
            <div className="w-full flex justify-between text-xs opacity-70 mb-1">
              <span>Aktualne F0: <strong>{currentF0 > 0 ? `${currentF0.toFixed(1)} Hz` : '---'}</strong></span>
              <span>Docelowe F0: <strong>{midiToFreq(currentMidi).toFixed(1)} Hz</strong></span>
            </div>
            <div className="w-full h-16 bg-black/60 rounded-lg flex items-end gap-1 px-2 py-1 overflow-hidden">
              {f0History.map((val, idx) => {
                const target = midiToFreq(currentMidi);
                const heightPct = Math.min(100, Math.max(10, ((val - target * 0.7) / (target * 0.6)) * 100));
                return (
                  <div 
                    key={idx} 
                    className="flex-1 bg-[#7d94de] rounded-t-sm"
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}
            </div>
            <span className="text-white/80 text-xs tracking-wider uppercase font-semibold mt-2">
              {isListening ? 'Śpiewaj zadany ton...' : 'Słuchaj dźwięku...'}
            </span>
          </div>
        </div>
      )}

      {/* 1B. PODSUMOWANIE GÓRY */}
      {stage === 'SCALE_UP_REVIEW' && (
        <div className="w-full max-w-md my-auto flex flex-col items-center gap-6 text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block">Krok 1: Skala w górę</span>
          <h2 className="font-seasons text-3xl md:text-4xl tracking-wider">SKALA W GÓRĘ</h2>
          
          <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl py-6 px-10 w-full shadow-md text-[#18388f]">
            <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Osiągnięty najwyższy dźwięk:</span>
            <span className="font-seasons text-4xl font-bold block my-2">
              {highestMidi ? midiToNoteName(highestMidi) : 'Brak zaliczenia'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <button
              onClick={startScaleUpFlow}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-white/90 bg-white/10 hover:bg-white/20 transition-all border border-white/20 cursor-pointer"
            >
              ⟲ Powtórz górę
            </button>
            <button
              onClick={startScaleDownFlow}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all border-none cursor-pointer shadow-md font-bold"
            >
              Badaj dół →
            </button>
          </div>
        </div>
      )}

      {/* 1C. PODSUMOWANIE DOŁU */}
      {stage === 'SCALE_DOWN_REVIEW' && (
        <div className="w-full max-w-md my-auto flex flex-col items-center gap-6 text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block">Krok 2: Skala w dół</span>
          <h2 className="font-seasons text-3xl md:text-4xl tracking-wider">SKALA W DÓŁ</h2>
          
          <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl py-6 px-10 w-full shadow-md text-[#18388f]">
            <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Osiągnięty najniższy dźwięk:</span>
            <span className="font-seasons text-4xl font-bold block my-2">
              {lowestMidi ? midiToNoteName(lowestMidi) : 'Brak zaliczenia'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <button
              onClick={startScaleDownFlow}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-white/90 bg-white/10 hover:bg-white/20 transition-all border border-white/20 cursor-pointer"
            >
              ⟲ Powtórz dół
            </button>
            <button
              onClick={initMultidisciplinaryTest}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all border-none cursor-pointer shadow-md font-bold"
            >
              Analiza [A] →
            </button>
          </div>
        </div>
      )}

      {/* ETAP 2: MULTIDYSCYPLINARNA ANALIZA DŹWIĘKU "A" W CZASIE RZECZYWISTYM */}
      {stage === 'MULTIDISCIPLINARY_A' && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center gap-4">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">Etap 2: Multidyscyplinarna Analiza Głosu</span>
            <h2 className="font-seasons text-2xl md:text-4xl tracking-wider">TRZYMAJ CIĄGŁE [A]</h2>
            <p className="text-sm opacity-80">Wyliczanie parametrów w czasie rzeczywistym</p>
          </div>

          <div className="w-full max-w-md bg-white/10 h-3 rounded-full overflow-hidden border border-white/20">
            <div className="h-full bg-emerald-400 transition-all duration-150" style={{ width: `${aProgress}%` }} />
          </div>

          <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">F0 & MAE [A]</span>
              <strong className="text-sm text-emerald-400">{liveMetrics.f0} Hz</strong>
              <div className="opacity-80">Błąd: {liveMetrics.maeCents} centów</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Jitter & Shimmer</span>
              <strong className="text-sm text-cyan-400">Jitter: {liveMetrics.jitterPercent}%</strong>
              <div className="opacity-80">Shimmer: {liveMetrics.shimmerDb} dB</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">HNR & Szum Spektralny</span>
              <strong className="text-sm text-blue-400">HNR: {liveMetrics.hnrDb} dB</strong>
              <div className="opacity-80">Szum: {liveMetrics.spectralNoiseDb} dB</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Formant Śpiewaka & SPR</span>
              <strong className="text-sm text-purple-400">SFL: {liveMetrics.singerFormantEnergyDb} dB</strong>
              <div className="opacity-80">SPR: {liveMetrics.spr} dB</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Wibrato Rate & Extent</span>
              <strong className="text-sm text-yellow-400">{liveMetrics.vibrato.rateHz} Hz</strong>
              <div className="opacity-80">Głębokość: ±{liveMetrics.vibrato.extentCents} c</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Wibrato Delay & VIBS</span>
              <strong className="text-sm text-yellow-400">Delay: {liveMetrics.vibrato.onsetDelaySec}s</strong>
              <div className="opacity-80">VIBS: {liveMetrics.vibrato.sinusoidality}</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Centroid Widmowy</span>
              <strong className="text-sm text-white">{liveMetrics.spectralCentroidHz} Hz</strong>
              <div className="opacity-80">RMS: {liveMetrics.rmsDbfs} dBFS</div>
            </div>

            <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <span className="text-white/60 block">Skala MPFR</span>
              <strong className="text-sm text-emerald-300">{mpfrResult?.mpfrSemitones ?? 0} ST</strong>
              <div className="opacity-80">Oktawy: {mpfrResult?.mpfrOctaves ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      {/* ETAP 2B: STATYSTYKI MIERZONYCH PARAMETRÓW */}
      {stage === 'METRICS_REVIEW' && (
        <div className="w-full max-w-5xl my-auto flex flex-col items-center gap-6 text-center">
          <div>
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">
              Raport Diagnostyczny
            </span>
            <h2 className="font-seasons text-3xl md:text-4xl tracking-wider">
              ZMIERZONE PARAMETRY AKUSTYCZNE
            </h2>
          </div>

          <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Średni Błąd Intonacji</span>
              <div className="text-2xl font-bold font-seasons text-emerald-300">{scaleMaeCents} centów</div>
              <span className="text-[11px] opacity-75 mt-1 block">
                {scaleMaeCents <= 15 ? 'Klasa chóralna (10–15 c)' : scaleMaeCents <= 25 ? 'Dobra kontrola (15–25 c)' : 'Poziom amatorski (>25 c)'}
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Wibrato Rate / Extent</span>
              <div className="text-2xl font-bold font-seasons text-yellow-300">
                {finalMetrics?.vibrato.rateHz} Hz / ±{finalMetrics?.vibrato.extentSemitones} ST
              </div>
              <span className="text-[11px] opacity-75 mt-1 block">
                VIBS: {finalMetrics?.vibrato.sinusoidality} | Status: {finalMetrics?.vibrato.hasVibrato ? 'Obecne' : 'Prosty ton (Straight)'}
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Jitter / Shimmer</span>
              <div className="text-2xl font-bold font-seasons text-cyan-300">
                {finalMetrics?.jitterPercent}% / {finalMetrics?.shimmerDb} dB
              </div>
              <span className="text-[11px] opacity-75 mt-1 block">
                Jitter (norma 0.31%), Shimmer (styl: 0.13 vs 0.36 dB)
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">HNR / Szum Tła</span>
              <div className="text-2xl font-bold font-seasons text-blue-300">
                {finalMetrics?.hnrDb} dB / {finalMetrics?.spectralNoiseDb} dB
              </div>
              <span className="text-[11px] opacity-75 mt-1 block">
                Stosunek harmonicznych do szumu (Praat AC)
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Formant Śpiewaka</span>
              <div className="text-2xl font-bold font-seasons text-purple-300">{finalMetrics?.singerFormantEnergyDb} dB</div>
              <span className="text-[11px] opacity-75 mt-1 block">
                Energia pasma 2,5–3,5 kHz
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Singing Power Ratio</span>
              <div className="text-2xl font-bold font-seasons text-purple-300">{finalMetrics?.spr} dB</div>
              <span className="text-[11px] opacity-75 mt-1 block">
                Omori et al.: SPP ({finalMetrics?.sppFreqHz} Hz) vs bas
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Skala Głosu (MPFR)</span>
              <div className="text-2xl font-bold font-seasons text-emerald-300">{mpfrResult?.mpfrSemitones} ST</div>
              <span className="text-[11px] opacity-75 mt-1 block">
                {mpfrResult?.f0MinNoteName} – {mpfrResult?.f0MaxNoteName} ({mpfrResult?.mpfrOctaves} okt.)
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.15)] backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-md">
              <span className="text-xs uppercase font-bold tracking-wider block opacity-70 mb-1">Spectral Centroid</span>
              <div className="text-2xl font-bold font-seasons text-pink-300">{finalMetrics?.spectralCentroidHz} Hz</div>
              <span className="text-[11px] opacity-75 mt-1 block">
                Środek ciężkości pasma widmowego
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md mt-2">
            <button
              onClick={initMultidisciplinaryTest}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-white/90 bg-white/10 hover:bg-white/20 transition-all border border-white/20 cursor-pointer"
            >
              ⟲ Powtórz analizę [A]
            </button>
            <button
              onClick={() => setStage('SUMMARY')}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all border-none cursor-pointer shadow-md font-bold"
            >
              Zobacz Podsumowanie →
            </button>
          </div>
        </div>
      )}

      {/* ETAP 3: PODSUMOWANIE */}
      {stage === 'SUMMARY' && (
        <div className="w-full max-w-4xl my-auto flex flex-col items-center gap-8 text-center">
          <h2 className="font-seasons text-3xl md:text-5xl tracking-wider">WYNIKI ANALIZY GŁOSU</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-6 shadow-xl text-[#18388f] flex flex-col justify-center items-center h-48 border border-white/30">
              <span className="text-xs uppercase tracking-wider block font-bold mb-2 opacity-70">
                Skala głosu (MPFR)
              </span>
              <span className="font-seasons text-3xl md:text-4xl font-bold block my-1">
                {lowestMidi ? midiToNoteName(lowestMidi) : '---'} – {highestMidi ? midiToNoteName(highestMidi) : '---'}
              </span>
              <span className="text-xs font-semibold opacity-80">
                {mpfrResult?.mpfrSemitones} półtonów ({mpfrResult?.mpfrOctaves} okt.)
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-6 shadow-xl text-[#18388f] flex flex-col justify-center items-center h-48 border border-white/30">
              <span className="text-xs uppercase tracking-wider block font-bold mb-2 opacity-70">
                Poziom zaawansowania
              </span>
              <span className="font-seasons text-2xl md:text-3xl font-bold block my-1">
                {advancementResult}
              </span>
              <span className="text-xs font-semibold opacity-80">
                Średni błąd: {scaleMaeCents} centów
              </span>
            </div>

            <div className="bg-[rgba(255,255,255,0.35)] backdrop-blur-md rounded-2xl p-6 shadow-xl text-[#18388f] flex flex-col justify-center items-center h-48 border border-white/30">
              <span className="text-xs uppercase tracking-wider block font-bold mb-2 opacity-70">
                Styl śpiewu
              </span>
              <span className="font-seasons text-2xl md:text-3xl font-bold block my-1">
                {styleResult}
              </span>
              <span className="text-xs font-semibold opacity-80">
                {styleResult === 'Chóralny' ? 'Emisja prosta / blend' : styleResult === 'Rozrywkowy' ? 'Emisja nośna / twang' : 'Wymaga ćwiczeń emisyjnych'}
              </span>
            </div>
          </div>

          <button
            onClick={onBack}
            className="font-cardo text-sm md:text-base py-3 px-8 rounded-xl tracking-wider uppercase text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all cursor-pointer border-none shadow-lg font-bold"
          >
            Zakończ analizę
          </button>
        </div>
      )}
    </div>
  );
}