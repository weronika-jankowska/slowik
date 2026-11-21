import { useState, useEffect, useRef } from 'react';
import ParameterInfo from './ParameterInfo';
import { audioDebug, referenceSampleFolder } from '../utils/pianoSampler';
import { foldCentsToOctave } from '../utils/noteUtils';
import { RAW_MIC_CONSTRAINTS, ensureRawMic } from '../utils/micSetup';
import { PIANO_FRAME_STYLE } from './pianoFrame';
import { navPush, navState, useNavListener } from '../utils/navHistory';
import { measureBreathFrame, summarizeBreath, BREATH_LEVEL_TEXT, BREATH_MODEL_VERSION, type BreathFrame } from '../utils/breathiness';
import {
  calculateRMS,
  pitchYIN,
  calculateSpectralNoise,
  calculateSingerFormantAndSPR,
  extractGlottalCycles,
  calculateJitterShimmerCycleToCycle,
  calculateHNR,
  calculateCPP,
  analyzeVibratoFull,
  calculateMPFRMetrics,
  medianOfValid,
  type AcousticMetricsState,
  type MPFRResult,
} from '../utils/audioMetrics';

// Import wygenerowanej mapy częstotliwości z próbek MP3
import pianoFrequenciesData from '../utils/pianoFrequencies.json';

const CALIBRATED_FREQUENCIES: Record<string, number> = pianoFrequenciesData as Record<string, number>;

interface VoiceAnalysisProps {
  onBack: () => void;
  onGoToExercises?: () => void;
  initialMode?: 'test' | 'history';
}

type Stage =
  | 'SCALE_UP_TEST'
  | 'SCALE_UP_REVIEW'
  | 'SCALE_DOWN_TEST'
  | 'SCALE_DOWN_REVIEW'
  | 'MULTIDISCIPLINARY_A'
  | 'METRICS_REVIEW'
  | 'HISTORY_REVIEW';

export interface SavedAnalysisRecord {
  id: string;
  timestamp: string;
  metrics: AcousticMetricsState;
  scaleMaeCents: number;
  mpfr: MPFRResult | null;
}

const STORAGE_KEY = 'vocal_analysis_history';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_C4 = 60;

/** Ramki z najwyższym/najniższym dźwiękiem. */
const RESULT_FRAME_STYLE = {
  // ten sam efekt co przycisk „Powtórz górę”
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 12
};
/** Granatowy napis nad nazwą dźwięku. */
const RESULT_LABEL_COLOR = '#18388f';

const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Białe klawisze (gama C-dur) od C2 (36) do C6 (84)
const C_MAJOR_SCALE_MIDIS: number[] = [
  36, 38, 40, 41, 43, 45, 47, // Oktawa 2 (C2 - B2)
  48, 50, 52, 53, 55, 57, 59, // Oktawa 3 (C3 - B3)
  60, 62, 64, 65, 67, 69, 71, // Oktawa 4 (C4 - B4)
  72, 74, 76, 77, 79, 81, 83, // Oktawa 5 (C5 - B5)
  84                          // C6
];

const dominantOctave = (octaves: number[]): number => {
  const count = new Map<number, number>();
  for (const o of octaves) count.set(o, (count.get(o) ?? 0) + 1);
  let best = 0, bestN = -1;
  for (const [o, n] of count) if (n > bestN) { best = o; bestN = n; }
  return best;
};

const getNextCMajorMidi = (currentMidi: number): number | null => {
  const next = C_MAJOR_SCALE_MIDIS.find((m) => m > currentMidi);
  return next !== undefined ? next : null;
};

const getPrevCMajorMidi = (currentMidi: number): number | null => {
  const prevList = C_MAJOR_SCALE_MIDIS.filter((m) => m < currentMidi);
  return prevList.length > 0 ? (prevList[prevList.length - 1] ?? null) : null;
};

const midiToNoteName = (midi: number): string => {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[noteIndex] ?? "C";
  return `${name}${octave}`;
};

const midiToSampleFilename = (midi: number): string => {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES_FLAT[noteIndex] ?? "C";
  return `${name}${octave}.mp3`;
};

const getCalibratedMidiFreq = (midi: number): number => {
  const calibrated = CALIBRATED_FREQUENCIES[midi.toString()];
  if (calibrated !== undefined && Number.isFinite(calibrated)) {
    return calibrated;
  }
  return 440 * Math.pow(2, (midi - 69) / 12);
};

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
    : 'Nie analizowano';
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
  } else if (mae <= 45) {
    maeComment = 'Twój śpiew nieco odbiega od właściwej wysokości. Postaraj się poprawić intonację';
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
  } else if (vibs < 0.5) {
    // progi tymczasowe
    vibsComment = 'Twoje wibrato jest jeszcze mało regularne, falowanie bywa nierówne';
  } else if (vibs < 0.8) {
    vibsComment = 'Twoje wibrato jest regularne i swobodne';
  } else {
    vibsComment = 'Twoje wibrato jest bardzo regularne i równe';
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

  // Powietrze w głosie
  const outdated = metrics !== null && metrics !== undefined && metrics.breathModel !== BREATH_MODEL_VERSION;
  const level = outdated ? null : metrics?.breathLevel;
  let breathComment = '';
  if (metrics && metrics.breathIndex === undefined) {
    breathComment = 'Ta analiza została zapisana przed wprowadzeniem oceny powietrza w głosie';
  } else if (outdated) {
    breathComment = 'Ta analiza została zapisana przed wprowadzeniem obecnej oceny powietrza w głosie';
  } else if (!level) {
    breathComment = 'Brak odczytu';
  } else if (level === 'none') {
    breathComment = 'Twój ton jest bardzo dźwięczny, w głosie nie słychać „powietrza”';
  } else if (level === 'moderate') {
    breathComment = 'Twój głos jest odpowiednio dźwięczny';
  } else {
    breathComment = 'W Twoim głosie słychać „powietrze”. Postaraj się domknąć struny głosowe.';
  }
  items.push({
    id: 'breath',
    label: 'powietrze w głosie',
    displayValue: level ? BREATH_LEVEL_TEXT[level] : '—',
    comment: breathComment,
    valueColor: '#f2b040'
  });

  return items;
}

const INTRO_HIDE_KEY = 'slowik_hide_analysis_intro';

export default function VoiceAnalysis({ onBack, onGoToExercises, initialMode = 'test' }: VoiceAnalysisProps) {
  const [stage, setStage] = useState<Stage>(initialMode === 'history' ? 'HISTORY_REVIEW' : 'SCALE_UP_TEST');

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
  const [currentAnalysisRecordId, setCurrentAnalysisRecordId] = useState<string>('');
  const [currentAnalysisTimestamp, setCurrentAnalysisTimestamp] = useState<string>('');
  const [aProgress, setAProgress] = useState<number>(0);

  // Archiwum badań
  const [historyRecords, setHistoryRecords] = useState<SavedAnalysisRecord[]>([]);
  const [openParam, setOpenParam] = useState<string | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // „wstecz” / „dalej” w przeglądarce
  useNavListener((st) => {
    setOpenParam(st.param ?? null);
    if (initialMode === 'test') {
      if (st.archive && stageRef.current === 'METRICS_REVIEW') setStage('HISTORY_REVIEW');
      if (!st.archive && stageRef.current === 'HISTORY_REVIEW') setStage('METRICS_REVIEW');
    }
  });
  const openParamInfo = (id: string) => {
    navPush({ param: id }, ['view', 'archive']);
    setOpenParam(id);
  };
  const closeParamInfo = () => {
    if (navState().param) window.history.back();
    else setOpenParam(null);
  };
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const currentAudioSampleRef = useRef<HTMLAudioElement | null>(null);

  const stableHoldRef = useRef<number>(0);
  const pitchBufferRef = useRef<number[]>([]);
  const pitchTimesRef = useRef<number[]>([]);
  const targetNoteFreqRef = useRef<number>(getCalibratedMidiFreq(MIDI_C4));

  const historyJitterRef = useRef<number[]>([]);
  const historyShimmerRef = useRef<number[]>([]);
  const historyHnrRef = useRef<number[]>([]);
  const historyCppRef = useRef<number[]>([]);
  const breathFramesRef = useRef<BreathFrame[]>([]);
  const historyNoiseRef = useRef<number[]>([]);
  const historySfEnergyRef = useRef<number[]>([]);
  const historySprRef = useRef<number[]>([]);
  const historySppFreqRef = useRef<number[]>([]);
  const historyCentroidRef = useRef<number[]>([]);
  const historyRolloffRef = useRef<number[]>([]);

  const scalePitchErrorsRef = useRef<number[]>([]);
  const sustainedAErrorsRef = useRef<number[]>([]);

  const REQUIRED_STABLE_FRAMES = 38;
  /** Próg głośności przy badaniu skali */
  const SCALE_MIN_RMS = 0.002;
  const SCALE_PASS_CENTS = 100;
  const scaleStartSungRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: SavedAnalysisRecord[] = JSON.parse(saved);
        setHistoryRecords(parsed);
        if (parsed.length > 0) {
          setCurrentHistoryIndex(parsed.length - 1);
        }
      }
    } catch (e) {
      console.error('Błąd odczytu historii', e);
    }
  }, []);

  // okno z instrukcją przed analizą (można wyłączyć „Nie pokazuj ponownie”)
  const [showIntro, setShowIntro] = useState(() => {
    if (initialMode !== 'test') return false;
    try { return localStorage.getItem(INTRO_HIDE_KEY) !== '1'; } catch { return true; }
  });
  const [hideIntro, setHideIntro] = useState(false);
  const closeIntro = () => {
    if (hideIntro) { try { localStorage.setItem(INTRO_HIDE_KEY, '1'); } catch { /* brak pamięci */ } }
    setShowIntro(false);
  };
  useEffect(() => {
    if (!showIntro) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeIntro(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (initialMode === 'test' && !showIntro) {
      void initAudio();
    }
  }, [initialMode, showIntro]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cleanupAudio(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const initAudio = async () => {
    try {
      if (audioCtxRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia(RAW_MIC_CONSTRAINTS);
      await ensureRawMic(stream);
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
    if (currentAudioSampleRef.current) {
      currentAudioSampleRef.current.pause();
      currentAudioSampleRef.current = null;
    }
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) void audioCtxRef.current.close();
    audioCtxRef.current = null;
  };

  // Odtwarzanie rzeczywistych próbek pianina z plików MP3
  const playPianoSample = (midi: number) => {
    try {
      if (currentAudioSampleRef.current) {
        currentAudioSampleRef.current.pause();
        currentAudioSampleRef.current.currentTime = 0;
      }
      const filename = midiToSampleFilename(midi);
      // przy włączonym mikrofonie Safari ścisza odtwarzanie
      const micOn = micStreamRef.current?.getAudioTracks().some(t => t.readyState === 'live') ?? false;
      const url = `${referenceSampleFolder(micOn)}/${filename}`;
      const audio = new Audio(url);
      audio.volume = 0.85;
      currentAudioSampleRef.current = audio;
      audio.play().catch(e => console.warn(`Nie można odtworzyć próbki ${url}:`, e));
    } catch (e) {
      console.error("Błąd podczas odtwarzania próbki pianina:", e);
    }
  };

  const handleKeyClick = (midi: number) => {
    playPianoSample(midi);
    if (stage === 'SCALE_UP_TEST' || stage === 'SCALE_DOWN_TEST') {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      setIsListening(false);
      stableHoldRef.current = 0;

      playTimerRef.current = window.setTimeout(() => {
        setIsListening(true);
        runScalePitchTracking(midi, stage === 'SCALE_UP_TEST' ? 'UP' : 'DOWN');
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
    scaleStartSungRef.current = null;
    beginScale(MIDI_C4, 'UP');
  };

  const startScaleDownFlow = () => {
    setStage('SCALE_DOWN_TEST');
    setLowestMidi(null);
    setDownGreenNotes(new Set());
    setRedNote(null);
    const prevMidi = getPrevCMajorMidi(scaleStartSungRef.current ?? MIDI_C4) ?? 59;
    beginScale(prevMidi, 'DOWN');
  };

  // Badanie skali na telefonie
  const isPhone = () => window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 600;
  const isPortrait = () => window.matchMedia('(orientation: portrait)').matches;
  const enteredFullscreenRef = useRef(false);
  const [rotateWait, setRotateWait] = useState<{ midi: number; mode: 'UP' | 'DOWN' } | null>(null);

  const tryLandscape = async () => {
    if (!isPhone()) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        enteredFullscreenRef.current = true;
      }
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await orientation.lock?.('landscape');
    } catch {/* przeglądarka nie pozwala (np. iPhone) */}
  };

  const releaseLandscape = () => {
    try { (window.screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.(); } catch { /* brak blokady */ }
    if (enteredFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    enteredFullscreenRef.current = false;
  };

  const beginScale = (midi: number, mode: 'UP' | 'DOWN') => {
    void tryLandscape().then(() => {
      if (isPhone() && isPortrait()) {
        setCurrentMidi(midi);
        setRotateWait({ midi, mode });
      } else startScaleStep(midi, mode);
    });
  };

  // obrócenie telefonu do poziomu uruchamia badanie
  useEffect(() => {
    if (!rotateWait) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => {
      if (!mq.matches) return;
      const w = rotateWait;
      setRotateWait(null);
      startScaleStep(w.midi, w.mode);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [rotateWait]); // eslint-disable-line react-hooks/exhaustive-deps

  // po zakończeniu badania skali – powrót do zwykłej orientacji
  useEffect(() => {
    if (stage !== 'SCALE_UP_TEST' && stage !== 'SCALE_DOWN_TEST') {
      setRotateWait(null);
      releaseLandscape();
    }
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseLandscape(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startScaleStep = (midi: number, mode: 'UP' | 'DOWN') => {
    setCurrentMidi(midi);
    targetNoteFreqRef.current = getCalibratedMidiFreq(midi);
    setRedNote(null);
    setIsListening(false);
    stableHoldRef.current = 0;
    setCurrentF0(0);

    playPianoSample(midi);

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
    const targetF = getCalibratedMidiFreq(midiVal);
    let attempts = 0;
    let quietFrames = 0;
    const stepErrors: number[] = [];
    const stepOctaves: number[] = [];

    const loop = () => {
      if (!analyserRef.current || !audioCtxRef.current) return;

      analyser.getFloatTimeDomainData(buffer);
      const rms = calculateRMS(buffer);

      // Niskie dźwięki bywają cichsze
      if (rms > SCALE_MIN_RMS) {
        quietFrames = 0;
        const f0 = pitchYIN(buffer, ctx.sampleRate, 0.15);

        if (f0 >= 50 && f0 <= 1100) {
          const rawCents = 1200 * Math.log2(f0 / targetF);
          const firstNote = mode === 'UP' && scaleStartSungRef.current === null;
          const octave = firstNote ? Math.round(rawCents / 1200) : 0;
          const cents = rawCents - 1200 * octave;

          setCurrentF0(f0);
          stepErrors.push(Math.abs(cents));

          if (Math.abs(cents) <= SCALE_PASS_CENTS) {
            stableHoldRef.current += 1;
            stepOctaves.push(octave);
            if (stableHoldRef.current >= REQUIRED_STABLE_FRAMES) {
              const stableErrorsSlice = stepErrors.slice(-REQUIRED_STABLE_FRAMES);
              scalePitchErrorsRef.current.push(...stableErrorsSlice);
              handleScaleSuccess(midiVal + 12 * dominantOctave(stepOctaves.slice(-REQUIRED_STABLE_FRAMES)), mode);
              return;
            }
          } else {
            stableHoldRef.current = Math.max(0, stableHoldRef.current - 1);
          }
        }
      } else {
        quietFrames++;
        // dłuższa cisza
        if (quietFrames === 12) setCurrentF0(0);
      }
      if (import.meta.env.DEV && attempts % 20 === 0) {
        audioDebug('scale', { midi: midiVal, mode, rms: Number(rms.toFixed(4)), rawF0: Number(pitchYIN(buffer, ctx.sampleRate, 0.15).toFixed(1)), target: Number(targetF.toFixed(1)), hold: stableHoldRef.current });
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

  /** Zaliczony dźwięk badania skali */
  const handleScaleSuccess = (passedMidi: number, mode: 'UP' | 'DOWN') => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsListening(false);
    if (mode === 'UP' && scaleStartSungRef.current === null) scaleStartSungRef.current = passedMidi;

    const note = midiToNoteName(passedMidi);

    if (mode === 'UP') {
      setUpGreenNotes(prev => new Set(prev).add(note));
      setHighestMidi(passedMidi);
      const nextStepMidi = getNextCMajorMidi(passedMidi);
      if (nextStepMidi !== null) {
        setTimeout(() => startScaleStep(nextStepMidi, 'UP'), 400);
      } else {
        setTimeout(() => setStage('SCALE_UP_REVIEW'), 400);
      }
    } else {
      setDownGreenNotes(prev => new Set(prev).add(note));
      setLowestMidi(passedMidi);
      const prevStepMidi = getPrevCMajorMidi(passedMidi);
      if (prevStepMidi !== null) {
        setTimeout(() => startScaleStep(prevStepMidi, 'DOWN'), 400);
      } else {
        setTimeout(() => setStage('SCALE_DOWN_REVIEW'), 400);
      }
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

  const handleSkipScale = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setIsListening(false);
    initMultidisciplinaryTest(true);
  };

  const initMultidisciplinaryTest = (skippedScale = false) => {
    let mpfr: MPFRResult | null = mpfrResult;
    if (skippedScale) {
      mpfr = null;
    } else if (mpfr === null && (highestMidi !== null || lowestMidi !== null)) {
      const finalLow = lowestMidi ?? (MIDI_C4 - 1);
      const finalHigh = highestMidi ?? MIDI_C4;
      mpfr = calculateMPFRMetrics(finalLow, finalHigh);
    }
    setMpfrResult(mpfr);
    setStage('MULTIDISCIPLINARY_A');

    const midMidi = mpfr ? Math.round((mpfr.f0MinMidi + mpfr.f0MaxMidi) / 2) : MIDI_C4;
    targetNoteFreqRef.current = getCalibratedMidiFreq(midMidi);
    playPianoSample(midMidi);

    pitchBufferRef.current = [];
    pitchTimesRef.current = [];
    sustainedAErrorsRef.current = [];

    historyJitterRef.current = [];
    historyShimmerRef.current = [];
    historyHnrRef.current = [];
    historyCppRef.current = [];
    breathFramesRef.current = [];
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
    let cachedCpp = NaN;
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
          const centsError = Math.abs(foldCentsToOctave(1200 * Math.log2(f0 / targetF)));
          sustainedAErrorsRef.current.push(centsError);

          if (frameCounter % 4 === 0) {
            cachedNoise = calculateSpectralNoise(analyser, f0);
            cachedSfAndSpr = calculateSingerFormantAndSPR(analyser, f0);
            const cycles = extractGlottalCycles(buffer, ctx.sampleRate, f0);
            const pert = calculateJitterShimmerCycleToCycle(cycles.periods, cycles.peakAmplitudes);
            cachedJitter = pert.jitterPercent;
            cachedShimmer = pert.shimmerDb;
            cachedHnr = calculateHNR(buffer, ctx.sampleRate, f0);
            cachedCpp = calculateCPP(buffer, ctx.sampleRate).cppDb;
            breathFramesRef.current.push(measureBreathFrame(buffer, ctx.sampleRate, f0, performance.now() / 1000));

            if (Number.isFinite(cachedJitter)) historyJitterRef.current.push(cachedJitter);
            if (Number.isFinite(cachedShimmer)) historyShimmerRef.current.push(cachedShimmer);
            if (Number.isFinite(cachedHnr)) historyHnrRef.current.push(cachedHnr);
            if (Number.isFinite(cachedCpp)) historyCppRef.current.push(cachedCpp);
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
            const breath = summarizeBreath(breathFramesRef.current);

            const evaluationMetrics: AcousticMetricsState = {
              f0: Math.round(f0 * 10) / 10,
              rms: Math.round(rms * 1000) / 1000,
              rmsDbfs: Math.round(20 * Math.log10(rms + 1e-6)),
              maeCents: overallAverageMae,
              jitterPercent: Math.round(medianOfValid(historyJitterRef.current) * 100) / 100,
              shimmerDb: Math.round(medianOfValid(historyShimmerRef.current) * 100) / 100,
              hnrDb: Math.round(medianOfValid(historyHnrRef.current) * 10) / 10,
              cppDb: Math.round(medianOfValid(historyCppRef.current) * 10) / 10,
              spectralNoiseDb: Math.round(medianOfValid(historyNoiseRef.current) * 10) / 10,
              spectralCentroidHz: Math.round(medianOfValid(historyCentroidRef.current)),
              spectralRolloffHz: Math.round(medianOfValid(historyRolloffRef.current)),
              singerFormantEnergyDb: Math.round(medianOfValid(historySfEnergyRef.current) * 10) / 10,
              spr: Math.round(medianOfValid(historySprRef.current) * 10) / 10,
              sppFreqHz: Math.round(medianOfValid(historySppFreqRef.current)),
              vibrato: finalVib,
              breathCppsDb: Math.round(breath.cppsDb * 10) / 10,
              breathHnrDb: Math.round(breath.hnrDb * 10) / 10,
              breathIndex: Math.round(breath.index * 100) / 100,
              breathLevel: breath.level,
              breathModel: BREATH_MODEL_VERSION
            };

            setFinalMetrics(evaluationMetrics);

            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const formattedTimestamp = `${day}/${month}/${year} ${hours}:${minutes}`;

            setCurrentAnalysisTimestamp(formattedTimestamp);

            const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            setCurrentAnalysisRecordId(recordId);

            const newRecord: SavedAnalysisRecord = {
              id: recordId,
              timestamp: formattedTimestamp,
              metrics: evaluationMetrics,
              scaleMaeCents: overallAverageMae,
              mpfr: mpfr
            };

            try {
              const currentSaved = localStorage.getItem(STORAGE_KEY);
              const history: SavedAnalysisRecord[] = currentSaved ? JSON.parse(currentSaved) : [];
              const updatedHistory = [...history, newRecord];
              localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
              setHistoryRecords(updatedHistory);
              setCurrentHistoryIndex(updatedHistory.length - 1);
            } catch (err) {
              console.error('Błąd zapisu do localStorage', err);
            }

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

  const handleDeleteRecord = (recordId: string, isCurrentReview = false) => {
    const confirmDelete = window.confirm("Czy na pewno chcesz usunąć tę analizę?");
    if (!confirmDelete) return;

    try {
      const updated = historyRecords.filter(r => r.id !== recordId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setHistoryRecords(updated);

      if (isCurrentReview) {
        if (updated.length > 0) {
          setCurrentHistoryIndex(updated.length - 1);
          setStage('HISTORY_REVIEW');
        } else {
          onBack();
        }
      } else {
        if (currentHistoryIndex >= updated.length) {
          setCurrentHistoryIndex(Math.max(0, updated.length - 1));
        }
      }
    } catch (err) {
      console.error('Błąd usuwania rekordu', err);
    }
  };

  const activeArchiveRecord: SavedAnalysisRecord | null =
    historyRecords.length > 0 ? (historyRecords[currentHistoryIndex] ?? null) : null;

  const canGoPrev = currentHistoryIndex > 0;
  const canGoNext = currentHistoryIndex < historyRecords.length - 1;

  const handlePrevHistory = () => {
    if (canGoPrev) setCurrentHistoryIndex(prev => prev - 1);
  };

  const handleNextHistory = () => {
    if (canGoNext) setCurrentHistoryIndex(prev => prev + 1);
  };

  if (showIntro) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center px-4 py-24 sm:py-10 relative z-10">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="analysis-intro-title"
          className="relative w-full max-w-[720px] backdrop-blur-md shadow-lg rounded-[10px] border border-white/45 bg-white/42 px-6 sm:px-[30px] pt-[22px] pb-[26px] text-[#2c49a8]"
        >
          <button
            type="button"
            onClick={closeIntro}
            aria-label="Zamknij instrukcję i rozpocznij analizę"
            title="Zamknij"
            className="absolute top-[18px] right-5 p-0.5 leading-none cursor-pointer hover:opacity-70 transition-opacity"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 2 L20 20 M20 2 L2 20" />
            </svg>
          </button>
          <h2 id="analysis-intro-title" className="font-seasons text-[28px] leading-tight text-center mx-9 uppercase">Analiza głosu</h2>
          <p className="font-cardo text-center text-[15px] opacity-80 mt-1 mb-4">instrukcja</p>
          <div className="font-cardo text-[15.5px] leading-[1.38] flex flex-col gap-2.5 text-[#3354b8]">
            <p>Za chwilę zobaczysz klawiaturę pianina. W pierwszym etapie analizy głosu Twoim zadaniem jest powtarzanie kolejnych dźwięków (np. na samogłosce <i>a</i>). Aplikacja zbada Twoją skalę głosu.</p>
            <p>W następnym etapie usłyszysz pojedynczy dźwięk ze środka Twojej skali. Powtórz go na samogłosce <i>a</i>. Aplikacja zbada parametry Twojego głosu.</p>
            <p>Po wykonaniu analizy zobaczysz swoje wyniki. Będą one zapisane w przeglądarce. Możesz do nich wracać i obserwować, jak Twój głos zmienia się na przestrzeni czasu.</p>
          </div>
          <label className="mt-5 flex items-center justify-center gap-2 font-cardo text-[14px] cursor-pointer select-none">
            <input type="checkbox" checked={hideIntro} onChange={(e) => setHideIntro(e.target.checked)} className="w-4 h-4 accent-[#18388f] cursor-pointer" />
            Nie pokazuj ponownie
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full ${stage === 'METRICS_REVIEW' || stage === 'HISTORY_REVIEW' ? 'h-screen overflow-y-auto overflow-x-hidden' : 'min-h-screen py-6 [@media(max-height:500px)]:py-2'} flex flex-col items-center justify-between px-4 relative z-10 font-cardo text-white`}>
      
      {(stage === 'SCALE_UP_TEST' || stage === 'SCALE_DOWN_TEST') && (
        <div className="w-full max-w-6xl my-auto flex flex-col items-center gap-4 [@media(max-height:500px)]:gap-2">
          {rotateWait && (
            <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 px-8 text-center bg-[#18388f]/90 backdrop-blur-md">
              <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="24" y="10" width="24" height="42" rx="4" opacity="0.5" />
                <rect x="15" y="34" width="42" height="24" rx="4" />
                <path d="M52 16c6 3 9 8 9 14" /><path d="M57 27l4 3 3-4" />
              </svg>
              <h2 className="font-seasons text-2xl tracking-wider">Obróć telefon poziomo</h2>
              <p className="font-cardo text-[15px] text-white/80 leading-snug max-w-xs">W poziomie klawiatura jest większa i łatwiej odczytać nazwy dźwięków. Badanie rozpocznie się po obróceniu ekranu.</p>
              <button
                type="button"
                onClick={() => { const w = rotateWait; setRotateWait(null); startScaleStep(w.midi, w.mode); }}
                className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full cursor-pointer"
              >
                Kontynuuj w pionie
              </button>
            </div>
          )}
          <div className="text-center relative w-full flex flex-col items-center">
            <span className="text-xs uppercase tracking-widest text-white/60 block mb-1 [@media(max-height:500px)]:hidden">
              Etap 1: Badanie Skali ({stage === 'SCALE_UP_TEST' ? 'W Górę' : 'W Dół'})
            </span>
            <h2 className="font-seasons text-2xl md:text-4xl tracking-wider [@media(max-height:500px)]:text-xl">
              ŚPIEWAJ KOLEJNE DŹWIĘKI
            </h2>
            <p className="text-xs opacity-70 mt-1 [@media(max-height:500px)]:hidden">
              Powtórz usłyszany dźwięk i utrzymaj go przez chwilę
            </p>

            <button
              type="button"
              onClick={handleSkipScale}
              className="mt-2 text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm"
            >
              Pomiń badanie skali →
            </button>
          </div>

          <div className="w-full max-w-4xl relative flex justify-center py-2 select-none">
            <div className="flex relative w-full h-40 sm:h-48 [@media(max-height:500px)]:h-28 overflow-hidden" style={PIANO_FRAME_STYLE}>
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
                  if (isTarget && !isRed) whiteBg = '!bg-[#7d94de] !text-white shadow-inner';

                  return (
                    <div key={whiteKey.midi} className="relative flex-1 h-full">
                      <button
                        type="button"
                        onClick={() => handleKeyClick(whiteKey.midi)}
                        className={`w-full h-full rounded-b-lg border-r border-zinc-300 flex flex-col justify-end pb-2 items-center transition-colors focus:outline-none ${whiteBg}`}
                      >
                        <span className={`text-[9px] font-bold opacity-75 pointer-events-none ${whiteKey.note.startsWith('C') || isTarget ? '' : 'hidden sm:inline'}`}>{whiteKey.note}</span>
                      </button>

                      {blackKey && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleKeyClick(blackKey.midi);
                          }}
                          className={`absolute top-0 right-[-32%] w-[64%] h-[60%] z-20 rounded-b-md border border-zinc-700 flex flex-col justify-end pb-1 items-center transition-colors focus:outline-none cursor-pointer ${
                            isBlackGreen
                              ? '!bg-emerald-500 !text-white'
                              : isBlackRed
                              ? '!bg-rose-600 !text-white animate-pulse'
                              : isBlackTarget
                              ? '!bg-[#7d94de] !text-white shadow-inner'
                              : 'bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          <span className={`text-[7px] font-bold opacity-80 pointer-events-none ${isBlackTarget ? '' : 'hidden sm:inline'}`}>
                            {blackKey.note.replace('#', '♯')}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          
          {(() => {
            const targetFreq = getCalibratedMidiFreq(currentMidi);
            const targetNote = midiToNoteName(currentMidi);
            const hasVoice = currentF0 > 0;
            
            const centsDiff = hasVoice 
              ? Math.max(-SCALE_PASS_CENTS, Math.min(SCALE_PASS_CENTS, scaleStartSungRef.current === null
                  ? foldCentsToOctave(1200 * Math.log2(currentF0 / targetFreq))
                  : 1200 * Math.log2(currentF0 / targetFreq)))
              : 0;
            
            // skala ±100 centów – tyle wynosi próg zaliczenia dźwięku
            const needlePositionPct = ((centsDiff + SCALE_PASS_CENTS) / (2 * SCALE_PASS_CENTS)) * 100;
            
            const isInTune = hasVoice && Math.abs(centsDiff) <= 15;
            const isAcceptable = hasVoice && Math.abs(centsDiff) < SCALE_PASS_CENTS;

            const needleColor = !hasVoice
              ? 'bg-white/40'
              : isInTune
              ? 'bg-emerald-400'
              : isAcceptable
              ? 'bg-yellow-400'
              : 'bg-rose-500';

            return (
              <div className="w-full max-w-xl bg-[#18388f]/65 backdrop-blur-md p-5 [@media(max-height:500px)]:py-2 rounded-2xl border border-white/20 shadow-2xl flex flex-col items-center select-none">
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

                <div className="w-full py-4 [@media(max-height:500px)]:py-1 flex flex-col items-center">
                  <div className="relative w-full h-8 flex items-center justify-center">
                    <div className="absolute inset-x-0 h-1.5 bg-white/10 rounded-full" />

                    <div 
                      className="absolute h-1.5 bg-emerald-500/20 rounded-full" 
                      style={{ left: '42.5%', right: '42.5%' }} 
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
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center z-20 pointer-events-none"
                        style={{ left: `${needlePositionPct}%` }}
                      >
                        <div className={`w-3.5 h-7 rounded-sm shadow-lg border border-white/60 ${needleColor}`} />
                      </div>
                    )}
                  </div>

                  <div className="w-full flex justify-between text-[10px] text-white/40 font-mono px-0.5 mt-1">
                    <span>-100 c</span>
                    <span>-50 c</span>
                    <span className="text-emerald-400 font-bold">CEL (0)</span>
                    <span>+50 c</span>
                    <span>+100 c</span>
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
          
          <div className="py-6 px-10 w-full" style={RESULT_FRAME_STYLE}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: RESULT_LABEL_COLOR }}>Najwyższy osiągnięty dźwięk:</span>
            <span className="font-seasons text-4xl block my-2" style={{ color: RESULT_LABEL_COLOR }}>
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
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all border-none cursor-pointer shadow-md"
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
          
          <div className="py-6 px-10 w-full" style={RESULT_FRAME_STYLE}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: RESULT_LABEL_COLOR }}>Najniższy osiągnięty dźwięk:</span>
            <span className="font-seasons text-4xl block my-2" style={{ color: RESULT_LABEL_COLOR }}>
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
              onClick={() => initMultidisciplinaryTest(false)}
              className="flex-1 font-cardo text-sm py-3 px-4 rounded-xl uppercase tracking-wider text-[#18388f] bg-[rgba(255,255,255,0.65)] hover:bg-[rgba(125,148,222,0.85)] hover:text-white transition-all border-none cursor-pointer shadow-md"
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
              Zaśpiewaj dźwięk na samogłosce <i>a</i>
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

      {/* Opis parametru: zastępuje widok wyników do czasu zamknięcia */}
      {openParam && (stage === 'METRICS_REVIEW' || stage === 'HISTORY_REVIEW') && (
        <ParameterInfo id={openParam} onClose={closeParamInfo} />
      )}

      {/* Widok 1: Podsumowanie bieżącej analizy */}
      {stage === 'METRICS_REVIEW' && !openParam && (
        <div className="w-full min-h-full shrink-0 flex flex-col justify-center items-center px-4 sm:px-8 pt-28 pb-8 md:py-8 max-w-[1140px] mx-auto select-none">
          
          <div className="w-full relative flex flex-col items-center mb-2">
            {currentAnalysisTimestamp && (
              <div className="w-full flex justify-end items-center mb-1 pr-1">
                <div className="flex items-center gap-2">
                  <span className="font-seasons font-light text-white/90 text-sm tracking-wide">
                    {currentAnalysisTimestamp}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteRecord(currentAnalysisRecordId, true)}
                    title="Usuń tę analizę"
                    className="p-1 rounded cursor-pointer text-white/80 hover:text-white transition-opacity bg-transparent border-none"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div className="text-center">
              <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] text-white uppercase drop-shadow-sm leading-tight">
                WYNIKI ANALIZY GŁOSU
              </h1>
              <p className="font-cardo font-normal text-sm sm:text-[15px] text-white/95 mt-1 tracking-wide">
                Kliknij w wybrany parametr, aby dowiedzieć się więcej
              </p>
            </div>
          </div>

          <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-3.5 my-1">
            {evaluateFeedbackMetrics(finalMetrics, scaleMaeCents, mpfrResult).map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openParamInfo(item.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openParamInfo(item.id); } }}
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

          <div className="flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4 mt-4">
            <button
              type="button"
              onClick={startScaleUpFlow}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-4 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              POWTÓRZ CAŁĄ ANALIZĘ
            </button>
            <button
              type="button"
              onClick={() => initMultidisciplinaryTest(mpfrResult === null)}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-4 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              POWTÓRZ DŹWIĘK 
            </button>
            <button
              type="button"
              onClick={() => {
                if (historyRecords.length > 0) {
                  setCurrentHistoryIndex(historyRecords.length - 1);
                }
                navPush({ archive: true }, ['view']);
                setStage('HISTORY_REVIEW');
              }}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-4 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              PRZEJDŹ DO ARCHIWUM ANALIZ
            </button>
            <button
              type="button"
              onClick={onGoToExercises ?? onBack}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-4 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              PRZEJDŹ DO ĆWICZEŃ
            </button>
          </div>

        </div>
      )}

      {/* Widok 2: Przeglądanie archiwum analiz */}
      {stage === 'HISTORY_REVIEW' && !openParam && (
        <div className="w-full min-h-full shrink-0 flex flex-col justify-center items-center px-2 sm:px-6 pt-28 pb-8 md:py-8 max-w-[1240px] mx-auto select-none">
          
          <div className="w-full relative flex flex-col items-center mb-2">
            {activeArchiveRecord && (
              <div className="w-full flex justify-end items-center mb-1 pr-2 sm:pr-4">
                <div className="flex items-center gap-2">
                  <span className="font-seasons font-light text-white/90 text-sm tracking-wide">
                    {activeArchiveRecord.timestamp}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteRecord(activeArchiveRecord.id)}
                    title="Usuń tę analizę"
                    className="p-1 rounded cursor-pointer text-white/80 hover:text-white transition-opacity bg-transparent border-none"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div className="text-center">
              <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] text-white uppercase drop-shadow-sm leading-tight">
                ZAPISANE WYNIKI ANALIZ
              </h1>
              <p className="font-cardo font-normal text-sm sm:text-[15px] text-white/95 mt-1 tracking-wide">
                {historyRecords.length > 0
                  ? 'Przewijaj strzałkami lewo/prawo, aby porównać postępy'
                  : 'Brak zapisanych analiz w pamięci urządzenia'}
              </p>
            </div>
          </div>

          <div className="w-full flex items-center justify-center gap-2 sm:gap-6 my-1">
            {historyRecords.length > 1 ? (
              <button
                type="button"
                onClick={handlePrevHistory}
                disabled={!canGoPrev}
                title="Starsza analiza"
                className={`p-2 sm:p-3 bg-transparent border-none cursor-pointer transition-all flex-shrink-0 ${
                  canGoPrev
                    ? 'text-white hover:scale-125 active:scale-95'
                    : 'text-white/15 cursor-not-allowed pointer-events-none'
                }`}
              >
                <svg className="w-7 h-10 sm:w-9 sm:h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
              <div className="w-7 sm:w-9 flex-shrink-0" />
            )}

            {activeArchiveRecord ? (
              <div className="flex-1 max-w-[1080px] grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-3.5">
                {evaluateFeedbackMetrics(activeArchiveRecord.metrics, activeArchiveRecord.scaleMaeCents, activeArchiveRecord.mpfr).map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openParamInfo(item.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openParamInfo(item.id); } }}
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
            ) : (
              <div className="flex-1 max-w-md py-12 px-6 flex flex-col items-center justify-center bg-white/40 backdrop-blur-md rounded-xl border border-white/35 shadow-md text-center my-4">
                <p className="font-seasons text-[17px] text-[#18388f] mb-2">Nie masz zapisanych żadnych analiz.</p>
                <span className="font-cardo text-sm text-[#466cd2]">Wykonaj badanie, a wynik pojawi się w tym miejscu.</span>
              </div>
            )}

            {historyRecords.length > 1 ? (
              <button
                type="button"
                onClick={handleNextHistory}
                disabled={!canGoNext}
                title="Nowsza analiza"
                className={`p-2 sm:p-3 bg-transparent border-none cursor-pointer transition-all flex-shrink-0 ${
                  canGoNext
                    ? 'text-white hover:scale-125 active:scale-95'
                    : 'text-white/15 cursor-not-allowed pointer-events-none'
                }`}
              >
                <svg className="w-7 h-10 sm:w-9 sm:h-14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <div className="w-7 sm:w-9 flex-shrink-0" />
            )}
          </div>

          <div className="flex flex-row justify-center items-center gap-5 mt-4">
            <button
              type="button"
              onClick={startScaleUpFlow}
              className="bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-7 sm:px-9 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer"
            >
              NOWA ANALIZA
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