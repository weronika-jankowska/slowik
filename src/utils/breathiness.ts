
import { calculateCPPS, calculateHNR, type CPPSOptions } from './audioMetrics.ts';

/** Ustawienia CPPS */
export const CPPS_OPTIONS: CPPSOptions = {
  pitchFloor: 60,
  peakSearchMinHz: 60,
  peakSearchMaxHz: 600,
  maxFrequency: 5000,
  preEmphasisHz: 50,
  timeAveragingSec: 0.02,
  quefrencyAveragingSec: 0.0005,
  tiltLineStartSec: 0.001,
  robustFit: true,
  cepstrumLengthSec: 0.04
};

export interface BreathFrame {
  /** Czas ramki [s] (od początku nagrania). */
  t: number;
  f0: number;
  cppsDb: number;
  hnrDb: number;
}

// ---------- Pomiar jednej ramki ----------

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      const tr = re[i] ?? 0; re[i] = re[j] ?? 0; re[j] = tr;
      const ti = im[i] ?? 0; im[i] = im[j] ?? 0; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = i + k + len / 2;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr; im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr; im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

export interface HarmonicFeatures {
  /** Nachylenie widma harmonicznych do 4 kHz [dB/oktawę] */
  tiltDbOct: number;
  /** Różnica poziomów 1. i 2. harmonicznej [dB]. */
  h1h2Db: number;
  h1a3Db: number;
}

export function harmonicFeatures(buf: ArrayLike<number>, sampleRate: number, f0: number): HarmonicFeatures {
  const none: HarmonicFeatures = { tiltDbOct: NaN, h1h2Db: NaN, h1a3Db: NaN };
  let n = 1;
  while (n * 2 <= buf.length) n *= 2;
  if (n < 1024 || !(f0 >= 60)) return none;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (buf[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fftInPlace(re, im);
  const half = n >> 1;
  const binHz = sampleRate / n;
  const P = new Float64Array(half);
  for (let k = 0; k < half; k++) P[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;

  const xs: number[] = [], ys: number[] = [];
  let a3 = -Infinity;
  for (let k = 1; k * f0 <= 4000 && k <= 60; k++) {
    const c = Math.round((k * f0) / binHz);
    const w = Math.max(2, Math.min(Math.round((0.03 * k * f0) / binHz), Math.floor((0.45 * f0) / binHz)));
    let best = -1, bi = c;
    for (let i = Math.max(2, c - w); i <= Math.min(half - 3, c + w); i++) if ((P[i] ?? 0) > best) { best = P[i] ?? 0; bi = i; }
    if (best <= 0) break;
    let e = 0;
    for (let j = -2; j <= 2; j++) e += P[bi + j] ?? 0; // energia listka głównego okna Hanna
    const L = 10 * Math.log10(Math.max(1e-20, e));
    xs.push(Math.log2(k));
    ys.push(L);
    if (k * f0 >= 2000) a3 = Math.max(a3, L);
  }
  if (xs.length < 4) return none;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
    sxx += ((xs[i] ?? 0) - mx) ** 2;
  }
  const h1 = ys[0] ?? NaN;
  return {
    tiltDbOct: sxx > 0 ? sxy / sxx : NaN,
    h1h2Db: ys.length > 1 ? h1 - (ys[1] ?? NaN) : NaN,
    h1a3Db: Number.isFinite(a3) ? h1 - a3 : NaN
  };
}

/** Nachylenie widma harmonicznych do 4 kHz [dB/oktawę]. */
export function harmonicTilt(buf: ArrayLike<number>, sampleRate: number, f0: number): number {
  return harmonicFeatures(buf, sampleRate, f0).tiltDbOct;
}

/** Obie miary dla jednego bufora. */
export function measureBreathFrame(buf: Float32Array, sampleRate: number, f0: number, t = 0): BreathFrame {
  return { t, f0, cppsDb: calculateCPPS(buf, sampleRate, CPPS_OPTIONS).cppsDb, hnrDb: calculateHNR(buf, sampleRate, f0) };
}

// ---------- Wskaźnik i ocena ----------

/** Typowy głos w zależności od wysokości */
export const BI_NORM = {
  refHz: 300,
  cpps: { atRef: 18.67, perOctave: -3.08, sd: 1.76 },
  hnr: { atRef: 23.53, perOctave: 5.23, sd: 3.35 },
  /** Udział CPPS we wskaźniku (reszta – HNR). */
  wCpps: 0.6
} as const;

/** Granice poziomów wskaźnika */
export const BI_LEVELS = { moderate: 1.0, clear: 1.65 } as const;

export type BreathLevel = 'none' | 'moderate' | 'clear';

/** Wersja kryterium zapisywana razem z wynikiem analizy. */
export const BREATH_MODEL_VERSION = 2;

const zScore = (v: number, n: { atRef: number; perOctave: number; sd: number }, oct: number) =>
  (v - (n.atRef + n.perOctave * oct)) / n.sd;

/** Wskaźnik powietrza w głosie */
export function breathinessIndex(cppsDb: number, hnrDb: number, f0: number): number {
  if (!Number.isFinite(cppsDb) || !(f0 > 0)) return NaN;
  const oct = Math.log2(f0 / BI_NORM.refHz);
  const c = -zScore(cppsDb, BI_NORM.cpps, oct);
  // bez HNR (nie udało się go policzyć) – sam CPPS
  if (!Number.isFinite(hnrDb)) return c;
  return BI_NORM.wCpps * c + (1 - BI_NORM.wCpps) * -zScore(hnrDb, BI_NORM.hnr, oct);
}

export function breathLevel(bi: number): BreathLevel | null {
  if (!Number.isFinite(bi)) return null;
  return bi >= BI_LEVELS.clear ? 'clear' : bi >= BI_LEVELS.moderate ? 'moderate' : 'none';
}

/** Wartość wyświetlana w wynikach („powietrze w głosie: …”). */
export const BREATH_LEVEL_TEXT: Record<BreathLevel, string> = {
  none: 'brak',
  moderate: 'umiarkowane',
  clear: 'wyraźnie słyszalne'
};

export interface BreathSummary {
  f0: number;
  cppsDb: number;
  hnrDb: number;
  index: number;
  level: BreathLevel | null;
  frames: number;
}

const median = (a: number[]): number => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Pomija początek dźwięku. */
export const ONSET_SKIP_SEC = 0.5;
/** Minimalna liczba ramek do wiarygodnego wyniku. */
export const MIN_FRAMES = 6;

export function summarizeBreath(frames: BreathFrame[], from = -Infinity, to = Infinity): BreathSummary {
  const first = frames[0]?.t ?? 0;
  const lo = Math.max(from, first + ONSET_SKIP_SEC);
  const sel = frames.filter((f) => f.t >= lo && f.t <= to);
  const cppsDb = median(sel.map((f) => f.cppsDb));
  const hnrDb = median(sel.map((f) => f.hnrDb));
  const f0 = median(sel.map((f) => f.f0));
  if (sel.length < MIN_FRAMES) return { f0, cppsDb, hnrDb, index: NaN, level: null, frames: sel.length };
  const index = breathinessIndex(cppsDb, hnrDb, f0);
  return { f0, cppsDb, hnrDb, index, level: breathLevel(index), frames: sel.length };
}

export const BI_SCORE_FULL = 3;

export function breathScore(bi: number): number {
  return Number.isFinite(bi) ? Math.round(Math.max(0, Math.min(100, (bi / BI_SCORE_FULL) * 100))) : NaN;
}


/** Zmiana wskaźnika uznawana za wyraźną */
export const BI_CLEAR_CHANGE = 0.9;

export interface BreathComparison {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  /** Opis zmiany do kafelka. */
  change: string;
}

export function compareBreath(before: BreathSummary, after: BreathSummary): BreathComparison {
  if (!before.level || !after.level) {
    return {
      tone: 'insufficient',
      headline: 'Nie udało się ocenić powietrza w głosie',
      detail: 'Wykonaj pomiar ponownie. Śpiewaj dźwięk wzorcowy na samogłosce <i>a</i> przez cały czas nagrania.',
      change: '—'
    };
  }
  const d = after.index - before.index;
  if (d <= -BI_CLEAR_CHANGE) {
    return {
      tone: 'good',
      headline: 'Po ćwiczeniach w głosie jest mniej powietrza',
      detail: after.level === 'none'
        ? 'Głos brzmi teraz dźwięcznie – struny głosowe domykają się lepiej niż przed ćwiczeniami.'
        : 'Twój głos się poprawił, ale wymaga jeszcze trochę pracy. Powtórz ćwiczenia z filmu i wykonaj pomiar ponownie. Staraj się domykać struny głosowe podczas śpiewu.',
      change: 'mniej powietrza'
    };
  }
  if (d >= BI_CLEAR_CHANGE) {
    return {
      tone: 'work',
      headline: 'Po ćwiczeniach w głosie jest więcej powietrza',
      detail: 'Głos może być zmęczony. Zrób krótką przerwę, napij się wody i zmierz ponownie – z tą samą głośnością co za pierwszym razem.',
      change: 'więcej powietrza'
    };
  }
  return after.level === 'none'
    ? {
        tone: 'good',
        headline: 'Głos dźwięczny w obu pomiarach',
        detail: 'Ani przed ćwiczeniami, ani po nich w głosie nie słychać powietrza.',
        change: 'bez zmian'
      }
    : {
        tone: 'ok',
        headline: 'Bez wyraźnej zmiany',
        detail: 'W głosie wciąż słychać powietrze. Powtórz ćwiczenia z filmu i wykonaj pomiar ponownie. Staraj się domykać struny głosowe podczas śpiewu.',
        change: 'bez zmian'
      };
}
