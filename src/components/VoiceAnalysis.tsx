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
  calculateMPFRMetrics,
  medianOfValid,
  type AcousticMetricsState,
  type MPFRResult,
} from '../utils/audioMetrics';

interface VoiceAnalysisProps {
  onBack: () => void;
  onGoToExercises?: () => void;
}

type Stage =
  | 'SCALE_UP_TEST'
  | 'SCALE_UP_REVIEW'
  | 'SCALE_DOWN_TEST'
  | 'SCALE_DOWN_REVIEW'
  | 'MULTIDISCIPLINARY_A'
  | 'METRICS_REVIEW';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_C4 = 60;

const midiToNoteName = (midi: number): string => {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[noteIndex] ?? "C";
  return `${name}${octave}`;
};

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

function formatCentsPolish(cents: number): string {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (abs === 1) return `${rounded} cent`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${rounded} centy`;
  }
  return `${rounded} centów`;
}

function formatSemitonesPolish(semitones: number, digits = 0): string {
  if (!Number.isFinite(semitones)) return '—';
  
  if (semitones % 1 !== 0) {
    return `${semitones.toFixed(digits > 0 ? digits : 1)} półtonu`;
  }

  const rounded = Math.round(semitones);
  const abs = Math.abs(rounded);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (abs === 1) return `${rounded} półton`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${rounded} półtony`;
  }
  return `${rounded} półtonów`;
}

interface MetricFeedbackItem {
  id: string;
  label: string;
  displayValue: string;
  comment: string;
  valueColor: string;
}

function evaluateFeedbackMetrics(
  metrics: AcousticMetricsState | null,
  scaleMaeCents: number,
  mpfr: MPFRResult | null
): MetricFeedbackItem[] {
  const items: MetricFeedbackItem[] = [];

  const mpfrSemis = mpfr?.mpfrSemitones ?? 0;
  const mpfrComment = mpfr
    ? `Twój zakres dźwięków obejmuje od ${mpfr.f0MinNoteName} do ${mpfr.f0MaxNoteName} (${mpfr.mpfrOctaves} oktawy).`
    : 'Brak danych badania skali głosu';
  items.push({
    id: 'mpfr',
    label: 'skala głosu (MPFR)',
    displayValue: mpfr ? formatSemitonesPolish(mpfrSemis) : '—',
    comment: mpfrComment,
    valueColor: '#ff66c4'
  });

  const mae = Number.isFinite(scaleMaeCents) ? scaleMaeCents : (metrics?.maeCents ?? 0);
  let maeComment = '';
  if (mae < 10) {
    maeComment = 'Trafiasz w dźwięki z dużą precyzją, Twoja intonacja jest bardzo czysta';
  } else if (mae <= 20) {
    maeComment = 'Trafiasz w dźwięki precyzyjnie, odchylenia są bardzo niewielkie';
  } else {
    maeComment = 'Popracuj nad intonacją (czystością śpiewu): dźwięki często odbiegają od właściwej wysokości';
  }
  items.push({
    id: 'mae',
    label: 'błąd intonacji (MAE)',
    displayValue: formatCentsPolish(mae),
    comment: maeComment,
    valueColor: '#6ba961'
  });

  const hasVibrato = metrics?.vibrato.hasVibrato ?? false;
  items.push({
    id: 'hasVibrato',
    label: 'obecność wibrato',
    displayValue: hasVibrato ? 'tak' : 'nie',
    comment: hasVibrato
      ? 'W Twoim śpiewie słychać wibrato'
      : 'W Twoim śpiewie nie słychać wibrato, dźwięk jest „prosty”',
    valueColor: '#cc8822'
  });

  const rate = metrics?.vibrato.rateHz ?? 0;
  let rateComment = '';
  if (!hasVibrato) {
    rateComment = 'W Twoim śpiewie nie słychać wibrato, dźwięk jest „prosty”';
  } else if (rate >= 5 && rate <= 7) {
    rateComment = 'Poprawna szybkość wibrato: dźwięk faluje płynnie i naturalnie';
  } else if (rate < 5) {
    rateComment = 'Twoje wibrato jest zbyt wolne, dźwięk faluje zbyt powoli';
  } else {
    rateComment = 'Twoje wibrato jest zbyt szybkie, dźwięk drży zamiast płynnie falować. Spróbuj śpiewać swobodniej, bez napinania gardła';
  }
  items.push({
    id: 'vibratoRate',
    label: 'szybkość wibrato',
    displayValue: hasVibrato ? `${rate.toFixed(1)} Hz` : '—',
    comment: rateComment,
    valueColor: '#256899'
  });

  const extentSemis = metrics?.vibrato.extentSemitones ?? 0;
  let extentComment = '';
  if (!hasVibrato) {
    extentComment = 'W Twoim śpiewie nie słychać wibrato, dźwięk jest „prosty”';
  } else if (extentSemis < 0.1) {
    extentComment = 'Twoje wibrato jest minimalne - to zaleta w śpiewie chóralnym';
  } else if (extentSemis >= 0.15 && extentSemis < 0.5) {
    extentComment = 'Twoje wibrato jest bardzo delikatne, dźwięk faluje tylko nieznacznie';
  } else if (extentSemis >= 0.5 && extentSemis <= 1.0) {
    extentComment = 'Poprawna głębokość wibrato';
  } else {
    extentComment = 'Twoje wibrato jest zbyt głębokie, dźwięk „buja się” za mocno. Postaraj się mniej wibrować głosem';
  }
  items.push({
    id: 'vibratoExtent',
    label: 'głębokość wibrato',
    displayValue: hasVibrato ? formatSemitonesPolish(extentSemis, 1) : '—',
    comment: extentComment,
    valueColor: '#c1f4ff'
  });

  const delay = metrics?.vibrato.onsetDelaySec ?? 0;
  let delayComment = '';
  if (!hasVibrato) {
    delayComment = 'W Twoim śpiewie nie słychać wibrato, dźwięk jest „prosty”';
  } else if (delay < 0.5) {
    delayComment = 'Wibrato pojawia się od początku dźwięku, brzmi to płynnie i naturalnie';
  } else {
    delayComment = 'Śpiewasz z wibrato dopiero po chwili, początek dźwięku jest „prosty”. Postaraj się, żeby falowanie pojawiało się wcześniej';
  }
  items.push({
    id: 'vibratoOnset',
    label: 'początek wibrato',
    displayValue: hasVibrato ? `${delay.toFixed(2)} s` : '—',
    comment: delayComment,
    valueColor: '#f2ff61'
  });

  const vibs = metrics?.vibrato.sinusoidality ?? 0;
  let vibsComment = '';
  if (!hasVibrato) {
    vibsComment = 'W Twoim śpiewie nie słychać wibrato, dźwięk jest „prosty”';
  } else if (vibs < 0.93) {
    vibsComment = 'Twoje wibrato jest jeszcze mało regularne, falowanie bywa nierówne';
  } else if (vibs <= 0.95) {
    vibsComment = 'Twoje wibrato jest regularne i swobodne, zbliżone do śpiewu rozrywkowego';
  } else {
    vibsComment = 'Twoje wibrato jest bardzo regularne i równe, zbliżone do wibrato śpiewaków chóralnych';
  }
  items.push({
    id: 'sinusoidality',
    label: 'sinusoidalność wibrato',
    displayValue: hasVibrato ? vibs.toFixed(3) : '—',
    comment: vibsComment,
    valueColor: '#8234c7'
  });

  const jitter = metrics?.jitterPercent ?? NaN;
  let jitterComment = '';
  if (!Number.isFinite(jitter)) {
    jitterComment = 'Brak odczytu';
  } else if (jitter <= 0.31) {
    jitterComment = 'Twój głos jest bardzo stabilny';
  } else if (jitter <= 0.41) {
    jitterComment = 'Twój głos jest dość stabilny';
  } else {
    jitterComment = 'Twój głos jest niestabilny: drobne wahania wysokości są typowe dla osób niewyćwiczonych';
  }
  items.push({
    id: 'jitter',
    label: 'jitter',
    displayValue: Number.isFinite(jitter) ? `${jitter.toFixed(2)}%` : '—',
    comment: jitterComment,
    valueColor: '#c20077'
  });

  const shimmer = metrics?.shimmerDb ?? NaN;
  let shimmerComment = '';
  if (!Number.isFinite(shimmer)) {
    shimmerComment = 'Brak odczytu';
  } else if (shimmer < 0.20) {
    shimmerComment = 'Siła Twojego dźwięku jest bardzo równa, jak u śpiewaków chóralnych, gdzie liczy się jednolite brzmienie';
  } else if (shimmer <= 0.32) {
    shimmerComment = 'Siła dźwięku jest dość równa, na poziomie osób śpiewających amatorsko';
  } else {
    shimmerComment = 'Siła dźwięku lekko faluje. To typowe dla śpiewu rozrywkowego.';
  }
  items.push({
    id: 'shimmer',
    label: 'shimmer',
    displayValue: Number.isFinite(shimmer) ? `${shimmer.toFixed(2)} dB` : '—',
    comment: shimmerComment,
    valueColor: '#328a67'
  });

  const sfEnergy = metrics?.singerFormantEnergyDb ?? NaN;
  const hasSingerFormant = Number.isFinite(sfEnergy) && sfEnergy > -18;
  items.push({
    id: 'singerFormant',
    label: 'formant śpiewaczy',
    displayValue: hasSingerFormant ? 'występuje' : 'nie występuje',
    comment: hasSingerFormant
      ? 'W Twoim głosie słychać formant śpiewaczy'
      : 'Nie wykryto formantu śpiewaczego',
    valueColor: '#f8e8ff'
  });

  const spr = metrics?.spr ?? NaN;
  let sprComment = '';
  if (!Number.isFinite(spr)) {
    sprComment = 'Brak odczytu';
  } else if (spr >= -14) {
    sprComment = 'Twój głos ma dużo „blasku” i dobrze się niesie';
  } else if (spr >= -18.5) {
    sprComment = 'Twój głos jest dźwięczny, ale dominują w nim niższe tony';
  } else {
    sprComment = 'Twój głos jest raczej ciemny i łagodny, brakuje mu „blasku” w górnym zakresie częstotliwości';
  }
  items.push({
    id: 'spr',
    label: 'SPR',
    displayValue: Number.isFinite(spr) ? `${spr.toFixed(1)} dB` : '—',
    comment: sprComment,
    valueColor: '#6cb114'
  });

  const hnr = metrics?.hnrDb ?? NaN;
  let hnrComment = '';
  if (!Number.isFinite(hnr)) {
    hnrComment = 'Brak odczytu';
  } else if (hnr > 24) {
    hnrComment = 'Twój ton jest bardzo dźwięczny, w głosie nie słychać "powietrza"';
  } else if (hnr >= 20) {
    hnrComment = 'Twój głos jest odpowiednio dźwięczny';
  } else {
    hnrComment = 'W Twoim głosie słychać “powietrze”. Postaraj się domknąć struny głosowe.';
  }
  items.push({
    id: 'hnr',
    label: 'HNR',
    displayValue: Number.isFinite(hnr) ? `${hnr.toFixed(1)} dB` : '—',
    comment: hnrComment,
    valueColor: '#f2b040'
  });

  return items;
}

export default function VoiceAnalysis({ onBack, onGoToExercises }: VoiceAnalysisProps) {
  const [stage, setStage] = useState<Stage>('SCALE_UP_TEST');

  const [currentMidi, setCurrentMidi] = useState<number>(MIDI_C4);
  const [highestMidi, setHighestMidi] = useState<number | null>(null);
  const [lowestMidi, setLowestMidi] = useState<number | null>(null);
  const [upGreenNotes, setUpGreenNotes] = useState<Set<string>>(new Set());
  const [downGreenNotes, setDownGreenNotes] = useState<Set<string>>(new Set());
  const [redNote, setRedNote] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [currentF0, setCurrentF0] = useState<number>(0);

  const [mpfrResult, setMpfrResult] = useState<MPFRResult | null>(null);
  const [scaleMaeCents, setScaleMaeCents] = useState<number>(0);

  const [finalMetrics, setFinalMetrics] = useState<AcousticMetricsState | null>(null);
  const [aProgress, setAProgress] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const stableHoldRef = useRef<number>(0);
  const pitchBufferRef = useRef<number[]>([]);
  const pitchTimesRef = useRef<number[]>([]);
  const targetNoteFreqRef = useRef<number>(midiToFreq(MIDI_C4));

  const historyJitterRef = useRef<number[]>([]);
  const historyShimmerRef = useRef<number[]>([]);
  const historyHnrRef = useRef<number[]>([]);
  const historyNoiseRef = useRef<number[]>([]);
  const historySfEnergyRef = useRef<number[]>([]);
  const historySprRef = useRef<number[]>([]);
  const historySppFreqRef = useRef<number[]>([]);
  const historyCentroidRef = useRef<number[]>([]);
  const historyRolloffRef = useRef<number[]>([]);

  const scalePitchErrorsRef = useRef<number[]>([]);
  const sustainedAErrorsRef = useRef<number[]>([]);

  const REQUIRED_STABLE_FRAMES = 38;

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
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.3;
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

  const startScaleUpFlow = () => {
    setStage('SCALE_UP_TEST');
    setHighestMidi(null);
    setLowestMidi(null);
    setUpGreenNotes(new Set());
    setDownGreenNotes(new Set());
    setRedNote(null);
    scalePitchErrorsRef.current = [];
    startScaleStep(MIDI_C4, 'UP');
  };

  const startScaleDownFlow = () => {
    setStage('SCALE_DOWN_TEST');
    setLowestMidi(null);
    setDownGreenNotes(new Set());
    setRedNote(null);
    startScaleStep(MIDI_C4 - 1, 'DOWN');
  };

  const startScaleStep = (midi: number, mode: 'UP' | 'DOWN') => {
    setCurrentMidi(midi);
    targetNoteFreqRef.current = midiToFreq(midi);
    setRedNote(null);
    setIsListening(false);
    stableHoldRef.current = 0;
    setCurrentF0(0);

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

    if (ctx.state === 'suspended') void ctx.resume();

    const buffer = new Float32Array(analyser.fftSize);
    const targetF = midiToFreq(midiVal);
    let attempts = 0;
    const stepErrors: number[] = [];

    const loop = () => {
      if (!analyserRef.current || !audioCtxRef.current) return;

      analyser.getFloatTimeDomainData(buffer);
      const rms = calculateRMS(buffer);

      if (rms > 0.018) {
        let f0 = pitchYIN(buffer, ctx.sampleRate, 0.15);

        if (f0 >= 50 && f0 <= 1100) {
          if (Math.abs(f0 * 2 - targetF) < targetF * 0.08) f0 = f0 * 2;
          else if (Math.abs(f0 / 2 - targetF) < targetF * 0.08) f0 = f0 / 2;

          setCurrentF0(f0);

          const cents = 1200 * (Math.log(f0 / targetF) / Math.log(2));
          stepErrors.push(Math.abs(cents));

          if (Math.abs(cents) <= 45) {
            stableHoldRef.current += 1;
            if (stableHoldRef.current >= REQUIRED_STABLE_FRAMES) {
              const stableErrorsSlice = stepErrors.slice(-REQUIRED_STABLE_FRAMES);
              scalePitchErrorsRef.current.push(...stableErrorsSlice);
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
      if (attempts > 320) {
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
    pitchTimesRef.current = [];
    sustainedAErrorsRef.current = [];

    historyJitterRef.current = [];
    historyShimmerRef.current = [];
    historyHnrRef.current = [];
    historyNoiseRef.current = [];
    historySfEnergyRef.current = [];
    historySprRef.current = [];
    historySppFreqRef.current = [];
    historyCentroidRef.current = [];
    historyRolloffRef.current = [];

    setAProgress(0);

    const analyser = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!analyser || !ctx) return;

    if (ctx.state === 'suspended') void ctx.resume();

    const buffer = new Float32Array(analyser.fftSize);
    let framesCollected = 0;
    let frameCounter = 0;
    const TOTAL_FRAMES = 160;

    let cachedJitter = NaN;
    let cachedShimmer = NaN;
    let cachedHnr = NaN;
    let cachedNoise = NaN;
    let cachedSfAndSpr = { sfEnergyDb: NaN, spr: NaN, sppFreqHz: NaN, spectralCentroidHz: NaN, spectralRolloffHz: NaN };

    const loop = () => {
      if (!analyserRef.current || !audioCtxRef.current) return;

      analyser.getFloatTimeDomainData(buffer);
      const rms = calculateRMS(buffer);

      if (rms > 0.015) {
        const f0 = pitchYIN(buffer, ctx.sampleRate, 0.15);
        if (f0 >= 50 && f0 <= 1100) {
          pitchBufferRef.current.push(f0);
          pitchTimesRef.current.push(performance.now() / 1000);
          framesCollected++;
          frameCounter++;

          setCurrentF0(f0);
          setAProgress(Math.min(100, Math.round((framesCollected / TOTAL_FRAMES) * 100)));

          const targetF = targetNoteFreqRef.current;
          const centsError = Math.abs(1200 * (Math.log(f0 / targetF) / Math.log(2)));
          sustainedAErrorsRef.current.push(centsError);

          if (frameCounter % 4 === 0) {
            cachedNoise = calculateSpectralNoise(analyser, f0);
            cachedSfAndSpr = calculateSingerFormantAndSPR(analyser, f0);
            const cycles = extractGlottalCycles(buffer, ctx.sampleRate, f0);
            const pert = calculateJitterShimmerCycleToCycle(cycles.periods, cycles.peakAmplitudes);
            cachedJitter = pert.jitterPercent;
            cachedShimmer = pert.shimmerDb;
            cachedHnr = calculateHNR(buffer, ctx.sampleRate, f0);

            if (Number.isFinite(cachedJitter)) historyJitterRef.current.push(cachedJitter);
            if (Number.isFinite(cachedShimmer)) historyShimmerRef.current.push(cachedShimmer);
            if (Number.isFinite(cachedHnr)) historyHnrRef.current.push(cachedHnr);
            if (Number.isFinite(cachedNoise)) historyNoiseRef.current.push(cachedNoise);
            if (Number.isFinite(cachedSfAndSpr.sfEnergyDb)) historySfEnergyRef.current.push(cachedSfAndSpr.sfEnergyDb);
            if (Number.isFinite(cachedSfAndSpr.spr)) historySprRef.current.push(cachedSfAndSpr.spr);
            if (Number.isFinite(cachedSfAndSpr.sppFreqHz)) historySppFreqRef.current.push(cachedSfAndSpr.sppFreqHz);
            if (Number.isFinite(cachedSfAndSpr.spectralCentroidHz)) historyCentroidRef.current.push(cachedSfAndSpr.spectralCentroidHz);
            if (Number.isFinite(cachedSfAndSpr.spectralRolloffHz)) historyRolloffRef.current.push(cachedSfAndSpr.spectralRolloffHz);
          }

          if (framesCollected >= TOTAL_FRAMES) {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

            const allPitchErrors = [
              ...scalePitchErrorsRef.current,
              ...sustainedAErrorsRef.current
            ];
            const overallAverageMae = allPitchErrors.length > 0 
              ? Math.round((allPitchErrors.reduce((a, b) => a + b, 0) / allPitchErrors.length) * 10) / 10 
              : Math.round(centsError * 10) / 10;

            setScaleMaeCents(overallAverageMae);

            const finalVib = analyzeVibratoFull(pitchBufferRef.current, 0.016, pitchTimesRef.current);

            const evaluationMetrics: AcousticMetricsState = {
              f0: Math.round(f0 * 10) / 10,
              rms: Math.round(rms * 1000) / 1000,
              rmsDbfs: Math.round(20 * Math.log10(rms + 1e-6)),
              maeCents: overallAverageMae,
              jitterPercent: Math.round(medianOfValid(historyJitterRef.current) * 100) / 100,
              shimmerDb: Math.round(medianOfValid(historyShimmerRef.current) * 100) / 100,
              hnrDb: Math.round(medianOfValid(historyHnrRef.current) * 10) / 10,
              spectralNoiseDb: Math.round(medianOfValid(historyNoiseRef.current) * 10) / 10,
              spectralCentroidHz: Math.round(medianOfValid(historyCentroidRef.current)),
              spectralRolloffHz: Math.round(medianOfValid(historyRolloffRef.current)),
              singerFormantEnergyDb: Math.round(medianOfValid(historySfEnergyRef.current) * 10) / 10,
              spr: Math.round(medianOfValid(historySprRef.current) * 10) / 10,
              sppFreqHz: Math.round(medianOfValid(historySppFreqRef.current)),
              vibrato: finalVib
            };

            setFinalMetrics(evaluationMetrics);
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
    <div className={`w-full ${stage === 'METRICS_REVIEW' ? 'h-screen overflow-hidden' : 'min-h-screen py-6'} flex flex-col items-center justify-between px-4 relative z-10 font-cardo text-white`}>
      
      {(stage === 'SCALE_UP_TEST' || stage === 'SCALE_DOWN_TEST') && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center gap-4">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">
              Etap 1: Badanie Skali ({stage === 'SCALE_UP_TEST' ? 'W Górę' : 'W Dół'})
            </span>
            <h2 className="font-seasons text-2xl md:text-4xl tracking-wider">
              ŚPIEWAJ KOLEJNE DŹWIĘKI
            </h2>
            <p className="text-xs opacity-70 mt-1">
              Powtórz usłyszany dźwięk i utrzymaj go przez chwilę
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

          {(() => {
            const targetFreq = midiToFreq(currentMidi);
            const targetNote = midiToNoteName(currentMidi);
            const hasVoice = currentF0 > 0;
            
            const centsDiff = hasVoice 
              ? Math.max(-50, Math.min(50, 1200 * Math.log2(currentF0 / targetFreq)))
              : 0;
            
            const needlePositionPct = ((centsDiff + 50) / 100) * 100;
            
            const isInTune = hasVoice && Math.abs(centsDiff) <= 15;
            const isAcceptable = hasVoice && Math.abs(centsDiff) <= 45;

            const needleColor = !hasVoice
              ? 'bg-white/40'
              : isInTune
              ? 'bg-emerald-400'
              : isAcceptable
              ? 'bg-yellow-400'
              : 'bg-rose-500';

            return (
              <div className="w-full max-w-xl bg-black/60 backdrop-blur-md p-5 rounded-2xl border border-white/20 shadow-2xl flex flex-col items-center select-none">
                <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 text-xs sm:text-sm">
                  <div className="flex flex-col items-start">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Cel</span>
                    <span className="font-bold text-white text-base font-seasons">
                      {targetNote} <span className="text-xs font-normal text-white/70">({targetFreq.toFixed(1)} Hz)</span>
                    </span>
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-white/80">
                      {!hasVoice
                        ? 'Oczekiwanie na głos...'
                        : isInTune
                        ? 'Idealnie w tonie!'
                        : centsDiff < 0
                        ? 'Za nisko'
                        : 'Za wysoko'}
                    </span>
                    <span
                      className={`text-xs font-bold font-mono ${
                        !hasVoice ? 'text-white/40' : isInTune ? 'text-emerald-400' : isAcceptable ? 'text-yellow-400' : 'text-rose-400'
                      }`}
                    >
                      {hasVoice ? `${centsDiff > 0 ? '+' : ''}${Math.round(centsDiff)} centów` : '—'}
                    </span>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className="text-white/50 text-[10px] uppercase tracking-wider">Twój głos</span>
                    <span className={`font-bold text-base font-seasons ${hasVoice ? 'text-emerald-400' : 'text-white/40'}`}>
                      {hasVoice ? `${currentF0.toFixed(1)} Hz` : '--- Hz'}
                    </span>
                  </div>
                </div>

                <div className="w-full py-4 flex flex-col items-center">
                  <div className="relative w-full h-8 flex items-center justify-center">
                    <div className="absolute inset-x-0 h-1.5 bg-white/10 rounded-full" />

                    <div 
                      className="absolute h-1.5 bg-emerald-500/20 rounded-full" 
                      style={{ left: '5%', right: '5%' }} 
                    />

                    <div className="absolute inset-x-0 flex justify-between px-1 pointer-events-none">
                      <span className="w-0.5 h-3 bg-white/30" />
                      <span className="w-0.5 h-2 bg-white/20" />
                      <span className="w-0.5 h-3 bg-white/30" />
                      <span className="w-0.5 h-2 bg-white/20" />
                      <span className="w-1 h-5 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] z-10" />
                      <span className="w-0.5 h-2 bg-white/20" />
                      <span className="w-0.5 h-3 bg-white/30" />
                      <span className="w-0.5 h-2 bg-white/20" />
                      <span className="w-0.5 h-3 bg-white/30" />
                    </div>

                    {hasVoice && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-75 flex flex-col items-center z-20 pointer-events-none"
                        style={{ left: `${needlePositionPct}%` }}
                      >
                        <div className={`w-3.5 h-7 rounded-sm shadow-lg border border-white/60 ${needleColor}`} />
                      </div>
                    )}
                  </div>

                  <div className="w-full flex justify-between text-[10px] text-white/40 font-mono px-0.5 mt-1">
                    <span>-50 c</span>
                    <span>-25 c</span>
                    <span className="text-emerald-400 font-bold">CEL (0)</span>
                    <span>+25 c</span>
                    <span>+50 c</span>
                  </div>
                </div>

                <div className="w-full flex justify-between items-center pt-2 border-t border-white/10">
                  <span className="text-white/80 text-xs tracking-wider uppercase font-semibold">
                    {isListening ? 'Śpiewaj zadany ton...' : 'Słuchaj dźwięku...'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] opacity-75">
                      {Math.round((stableHoldRef.current / REQUIRED_STABLE_FRAMES) * 100)}%
                    </span>
                    <div className="w-16 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-75"
                        style={{ width: `${Math.round((stableHoldRef.current / REQUIRED_STABLE_FRAMES) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

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
              PRZEJDŹ DALEJ →
            </button>
          </div>
        </div>
      )}

      {stage === 'MULTIDISCIPLINARY_A' && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center gap-6">
          <div className="text-center">
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">
              Etap 2: Analiza Parametrów Głosu
            </span>
            <h2 className="font-seasons text-2xl md:text-4xl tracking-wider">
              POWTÓRZ DŹWIĘK
            </h2>
            <p className="text-sm opacity-80 mt-1">
              Zaśpiewaj dźwięk na samogłosce [A]
            </p>
          </div>

          <div className="w-full max-w-md bg-white/10 h-3 rounded-full overflow-hidden border border-white/20 shadow-inner">
            <div
              className="h-full bg-emerald-400 transition-all duration-150"
              style={{ width: `${aProgress}%` }}
            />
          </div>
        </div>
      )}

      {stage === 'METRICS_REVIEW' && (
        <div className="w-full h-full flex flex-col justify-center items-center px-4 sm:px-8 max-w-[1140px] mx-auto select-none overflow-hidden">
          
          <div className="text-center mb-3">
            <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] text-white uppercase drop-shadow-sm leading-tight">
              WYNIKI ANALIZY GŁOSU
            </h1>
            <p className="font-cardo font-normal text-sm sm:text-[15px] text-white/95 mt-1 tracking-wide">
              Kliknij w wybrany parametr, aby dowiedzieć się więcej
            </p>
          </div>

          <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-3.5 my-1">
            {evaluateFeedbackMetrics(finalMetrics, scaleMaeCents, mpfrResult).map((item) => (
              <div
                key={item.id}
                className="bg-white/40 hover:bg-white/50 backdrop-blur-md rounded-xl py-3 px-3 flex flex-col items-center justify-between text-center shadow-md border border-white/35 transition-all duration-200 cursor-pointer hover:scale-[1.01] min-h-[114px] sm:min-h-[120px]"
              >
                <h3 className="font-seasons font-normal text-[14px] sm:text-[15px] text-[#18388f] leading-tight">
                  {item.label}
                </h3>
                
                <span
                  className="font-seasons font-normal text-[17px] sm:text-[19px] tracking-wide my-0.5 leading-none"
                  style={{ color: item.valueColor }}
                >
                  {item.displayValue}
                </span>

                <p className="font-cardo font-normal text-[11px] sm:text-[11.5px] text-[#466cd2] leading-[1.25] px-1 line-clamp-3">
                  {item.comment}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-row justify-center items-center gap-5 mt-4">
            <button
              type="button"
              onClick={startScaleUpFlow}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-7 sm:px-9 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              POWTÓRZ ANALIZĘ
            </button>
            <button
              type="button"
              onClick={onGoToExercises ?? onBack}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-7 sm:px-9 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              PRZEJDŹ DO ĆWICZEŃ
            </button>
          </div>

        </div>
      )}
    </div>
  );
}