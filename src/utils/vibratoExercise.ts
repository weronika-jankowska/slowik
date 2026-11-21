import { analyzeVibratoFull, type VibratoAnalysisResult } from './audioMetrics';
import { formatDecimalPl } from './noteUtils';

/** Dla chórzystów */
export const VIBRATO_BAND_SEMITONES = 0.1;
export const VIBRATO_BAND_CENTS = VIBRATO_BAND_SEMITONES * 100;

export interface AttemptData {
  /** Czas od początku śpiewania [s]. */
  t: number[];
  cents: number[];
  /** F0 w Hz; 0 = brak dźwięku. */
  hz: number[];
}

export interface AttemptStats {
  durationSec: number;
  voicedFraction: number;
  voicedSeconds: number;
  inBandFraction: number;
  medianOffsetCents: number;
  /** Amplituda wahań wysokości (±), jak „extent” wibrato */
  wobbleAmplitudeCents: number;
  vibrato: VibratoAnalysisResult;
}

const GRID_DT = 0.016;
const MAX_GAP_SEC = 0.08;
const TREND_WINDOW_SEC = 1.0; // pełny okres wolnego trendu

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? (v[mid] ?? NaN) : (((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2);
}

/** Amplituda wahań */
export function wobbleAmplitudeCents(t: number[], cents: number[]): number {
  const segments: { ts: number[]; vs: number[] }[] = [];
  let cur: { ts: number[]; vs: number[] } | null = null;
  let lastT = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const c = cents[i] ?? NaN;
    const ti = t[i] ?? NaN;
    if (!Number.isFinite(c) || !Number.isFinite(ti)) { cur = null; continue; }
    if (!cur || ti - lastT > MAX_GAP_SEC) { cur = { ts: [], vs: [] }; segments.push(cur); }
    cur.ts.push(ti);
    cur.vs.push(c);
    lastT = ti;
  }

  const win = Math.max(3, Math.round(TREND_WINDOW_SEC / GRID_DT) | 1);
  const half = win >> 1;
  let sumSq = 0;
  let count = 0;

  for (const seg of segments) {
    const t0 = seg.ts[0] ?? 0;
    const t1 = seg.ts[seg.ts.length - 1] ?? 0;
    const n = Math.floor((t1 - t0) / GRID_DT) + 1;
    if (n < 2 * half + 20) continue; // za krótki odcinek, by wiarygodnie odjąć trend
    const grid = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const tg = t0 + i * GRID_DT;
      while (j < seg.ts.length - 2 && (seg.ts[j + 1] ?? 0) < tg) j++;
      const a = seg.ts[j] ?? 0;
      const b = seg.ts[Math.min(seg.ts.length - 1, j + 1)] ?? a;
      const va = seg.vs[j] ?? 0;
      const vb = seg.vs[Math.min(seg.ts.length - 1, j + 1)] ?? va;
      const frac = b > a ? Math.max(0, Math.min(1, (tg - a) / (b - a))) : 0;
      grid[i] = va + frac * (vb - va);
    }
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + (grid[i] ?? 0);
    for (let i = half; i < n - half; i++) { // brzegi pomijamy: tam okno trendu byłoby niepełne
      const mean = ((prefix[i + half + 1] ?? 0) - (prefix[i - half] ?? 0)) / win;
      const d = (grid[i] ?? 0) - mean;
      sumSq += d * d;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) * Math.SQRT2 : NaN;
}

export function computeAttemptStats(data: AttemptData, bandCents = VIBRATO_BAND_CENTS): AttemptStats {
  const n = data.t.length;
  const durationSec = n > 0 ? (data.t[n - 1] ?? 0) - (data.t[0] ?? 0) : 0;
  const voicedIdx: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(data.cents[i] ?? NaN)) voicedIdx.push(i);

  const voicedCents = voicedIdx.map((i) => data.cents[i] ?? 0);
  const inBand = voicedCents.filter((c) => Math.abs(c) <= bandCents).length;

  const hzVoiced = voicedIdx.map((i) => data.hz[i] ?? 0);
  const tVoiced = voicedIdx.map((i) => data.t[i] ?? 0);
  const vibrato = analyzeVibratoFull(hzVoiced, GRID_DT, tVoiced);

  return {
    durationSec,
    voicedFraction: n > 0 ? voicedIdx.length / n : 0,
    voicedSeconds: n > 0 ? (voicedIdx.length / n) * durationSec : 0,
    inBandFraction: voicedIdx.length > 0 ? inBand / voicedIdx.length : 0,
    medianOffsetCents: median(voicedCents),
    wobbleAmplitudeCents: wobbleAmplitudeCents(data.t, data.cents),
    vibrato
  };
}

export type FeedbackTone = 'good' | 'ok' | 'work' | 'insufficient';

export interface AttemptFeedback {
  tone: FeedbackTone;
  headline: string;
  detail: string;
}

export function buildFeedback(stats: AttemptStats, bandCents = VIBRATO_BAND_CENTS): AttemptFeedback {
  const w = stats.wobbleAmplitudeCents;
  if (stats.voicedSeconds < 3 || !Number.isFinite(w)) {
    return {
      tone: 'insufficient',
      headline: 'Za mało dźwięku do oceny',
      detail: 'Zaśpiewaj dłuższy, ciągły dźwięk (około 10 sekund) i nieco głośniej, aby mikrofon dobrze Cię słyszał.'
    };
  }
  const bandSemis = formatDecimalPl(bandCents / 100, 1);
  const off = stats.medianOffsetCents;
  const wobbleSemis = formatDecimalPl(w / 100, 2);

  if (w <= bandCents) {
    if (Math.abs(off) <= 15) {
      return {
        tone: 'good',
        headline: 'Prosty, stabilny dźwięk',
        detail: `Wahania Twojego dźwięku nie przekraczają ±${bandSemis} półtonu. Tak brzmi „prosty ton” w śpiewie chóralnym.`
      };
    }
    return {
      tone: 'ok',
      headline: 'Stabilny, ale nie w tonie',
      detail: `Dźwięk jest bardzo równy, ale jest około ${Math.round(Math.abs(off))} centów ${off > 0 ? 'za wysoko' : 'za nisko'} względem dźwięku wzorcowego. Spróbuj trafić we właściwą wysokość od początku.`
    };
  }
  if (w <= 2 * bandCents) {
    return {
      tone: 'ok',
      headline: 'Delikatne wibrato jeszcze słychać',
      detail: `Dźwięk faluje o około ±${wobbleSemis} półtonu, a cel to ±${bandSemis}. Śpiewaj spokojniej, na równym strumieniu powietrza, bez „bujania” dźwiękiem.`
    };
  }
  const rate = stats.vibrato.hasVibrato ? ` Wykryto regularne falowanie około ${formatDecimalPl(stats.vibrato.rateHz, 1)} razy na sekundę.` : '';
  return {
    tone: 'work',
    headline: 'Dźwięk wyraźnie faluje',
    detail: `Wahania wynoszą około ±${wobbleSemis} półtonu, a cel to ±${bandSemis}.${rate} Spróbuj śpiewać bez napięcia, utrzymując równy, spokojny strumień powietrza.`
  };
}
