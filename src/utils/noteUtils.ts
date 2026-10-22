// Wspólne funkcje nutowe i odtwarzanie dźwięku wzorcowego (używane przez ćwiczenia).
// Zachowują konwencje z VoiceAnalysis.tsx: próbki /piano-mp3/<Nuta><oktawa>.mp3 (bemole)
// i skalibrowane częstotliwości z pianoFrequencies.json (fallback: strój 440 Hz).
import pianoFrequenciesData from './pianoFrequencies.json';

const CALIBRATED_FREQUENCIES: Record<string, number> = pianoFrequenciesData as Record<string, number>;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const midiToNoteName = (midi: number): string => {
  const idx = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[idx] ?? 'C'}${Math.floor(midi / 12) - 1}`;
};

export const midiToSampleFilename = (midi: number): string => {
  const idx = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES_FLAT[idx] ?? 'C'}${Math.floor(midi / 12) - 1}.mp3`;
};

export const getCalibratedMidiFreq = (midi: number): number => {
  const calibrated = CALIBRATED_FREQUENCIES[midi.toString()];
  if (calibrated !== undefined && Number.isFinite(calibrated)) return calibrated;
  return 440 * Math.pow(2, (midi - 69) / 12);
};

/** Różnica f względem fRef w centach. */
export const centsBetween = (f: number, fRef: number): number => 1200 * Math.log2(f / fRef);

/** Zwija różnicę w centach do najbliższej oktawy (−600…+600): śpiewanie oktawę wyżej/niżej jest OK. */
export const foldCentsToOctave = (cents: number): number => cents - 1200 * Math.round(cents / 1200);

export const formatDecimalPl = (value: number, digits = 1): string => value.toFixed(digits).replace('.', ',');

// ---------------------------------------------------------------------------
// Dźwięk wzorcowy: próbka pianina, a gdy jej brak / przeglądarka blokuje odtwarzanie — prosty syntezator.
// ---------------------------------------------------------------------------
export interface ReferencePlayback {
  /** Resolve po zakończeniu (lub anulowaniu) dźwięku. */
  done: Promise<void>;
  cancel: () => void;
}

let synthCtx: AudioContext | null = null;

function getSynthContext(): AudioContext {
  if (!synthCtx || synthCtx.state === 'closed') {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    synthCtx = new Ctor();
  }
  return synthCtx;
}

function playSynth(freq: number, durationMs: number): ReferencePlayback {
  const ctx = getSynthContext();
  void ctx.resume();
  const now = ctx.currentTime;
  const dur = durationMs / 1000;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.28, now + 0.04);
  master.gain.setValueAtTime(0.28, now + dur - 0.3);
  master.gain.linearRampToValueAtTime(0, now + dur);
  master.connect(ctx.destination);
  const oscs: OscillatorNode[] = [1, 2, 3, 4].map((h, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * h;
    g.gain.value = [1, 0.45, 0.22, 0.1][i] ?? 0.05;
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + dur + 0.05);
    return o;
  });
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
    window.setTimeout(resolve, durationMs);
  });
  return {
    done,
    cancel: () => {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      oscs.forEach((o) => { try { o.stop(ctx.currentTime + 0.1); } catch { /* już zatrzymany */ } });
      resolveDone();
    }
  };
}

export function playReferenceNote(midi: number, durationMs = 2600): ReferencePlayback {
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let fallback: ReferencePlayback | null = null;
  let finish: () => void = () => undefined;
  let timers: number[] = [];

  const done = new Promise<void>((resolve) => {
    finish = () => { timers.forEach((t) => window.clearTimeout(t)); timers = []; resolve(); };
  });

  const useFallback = () => {
    if (cancelled || fallback) return;
    fallback = playSynth(getCalibratedMidiFreq(midi), durationMs);
    void fallback.done.then(finish);
  };

  try {
    audio = new Audio(`/piano-mp3/${midiToSampleFilename(midi)}`);
    audio.volume = 0.85;
    audio.addEventListener('error', useFallback, { once: true });
    audio.play().then(() => {
      // próbka pianina ma długi wybrzmiewający ogon – tniemy ją z krótkim wyciszeniem
      timers.push(window.setTimeout(() => {
        if (!audio) return;
        const a = audio;
        const fade = window.setInterval(() => {
          a.volume = Math.max(0, a.volume - 0.12);
          if (a.volume <= 0.01) { window.clearInterval(fade); a.pause(); finish(); }
        }, 30);
      }, Math.max(0, durationMs - 300)));
    }).catch(useFallback);
  } catch {
    useFallback();
  }

  return {
    done,
    cancel: () => {
      cancelled = true;
      if (audio) audio.pause();
      if (fallback) fallback.cancel();
      finish();
    }
  };
}
