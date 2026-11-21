// Pomiar HNR w ćwiczeniach

import { calculateHNR } from './audioMetrics';
import type { TakeFrame } from '../hooks/useTake';

export interface HnrSample { t: number; hnr: number }

const EVERY_NTH = 4;
const MIN_RMS = 0.015;

const makeBuffer = (n: number) => new Float32Array(n);

export function makeHnrCollector() {
  const samples: HnrSample[] = [];
  let voicedCount = 0;
  let buf: ReturnType<typeof makeBuffer> | null = null;
  return {
    samples,
    onFrame(f: TakeFrame, analyser: AnalyserNode | null) {
      if (!analyser || f.f0 === null || f.rms < MIN_RMS) return;
      voicedCount++;
      if (voicedCount % EVERY_NTH !== 0) return;
      if (!buf || buf.length !== analyser.fftSize) buf = makeBuffer(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      const hnr = calculateHNR(buf, analyser.context.sampleRate, f.f0);
      if (Number.isFinite(hnr)) samples.push({ t: f.t, hnr });
    }
  };
}

export function medianHnr(samples: HnrSample[], from = -Infinity, to = Infinity): number {
  const v = samples.filter((s) => s.t >= from && s.t <= to).map((s) => s.hnr).sort((a, b) => a - b);
  if (v.length < 3) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/** Fragment do pomiaru: dla „mmm → aaa” */
export function measureWindow(frames: TakeFrame[], fromFraction: number): { from: number; to: number } {
  const voiced = frames.filter((f) => f.f0 !== null);
  const a = voiced[0]?.t ?? 0;
  const b = voiced[voiced.length - 1]?.t ?? 0;
  return { from: a + (b - a) * fromFraction, to: b };
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');
const signedDb = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${f1(Math.abs(d))} dB`;

/** Różnica uznawana za wyraźną [dB] */
const CLEAR_DIFF_DB = 1;

export interface HnrComparison {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
}

export function compareHnr(before: number, after: number, kind: 'voicing' | 'air'): HnrComparison {
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return { tone: 'insufficient', headline: 'Nie udało się zmierzyć HNR', detail: 'Zaśpiewaj równy, dźwięczny dźwięk przez cały czas nagrania i spróbuj ponownie.' };
  }
  const d = after - before;
  const label = kind === 'voicing' ? 'Po rozpoczęciu od „mmm”' : 'Po ćwiczeniach';
  if (d >= CLEAR_DIFF_DB) {
    return {
      tone: 'good',
      headline: `${label} HNR wzrósł o ${f1(d)} dB`,
      detail: 'W głosie jest mniej szumu, czyli mniej słyszalnego powietrza – dźwięk jest pełniejszy i lepiej podparty.'
    };
  }
  if (d > -CLEAR_DIFF_DB) {
    return {
      tone: 'ok',
      headline: `${label} HNR bez wyraźnej zmiany (${signedDb(d)})`,
      detail: kind === 'voicing'
        ? 'Spróbuj jeszcze raz: poczuj wibrację „mmm” na wargach i w nosie, i nie zgub jej przy otwieraniu ust na „aaa”.'
        : 'Jeśli w głosie wciąż słychać dużo powietrza, postaraj się lepiej podeprzeć dźwięk i powtórz fragment ćwiczeń.'
    };
  }
  return {
    tone: 'work',
    headline: `${label} HNR spadł o ${f1(-d)} dB`,
    detail: kind === 'voicing'
      ? 'W końcowym „aaa” pojawiło się więcej powietrza. Otwieraj usta płynnie i nie wypuszczaj powietrza mocniej przy przejściu z „mmm” na „aaa”.'
      : 'Głos może być zmęczony albo w głosie jest teraz więcej powietrza. Zrób przerwę, napij się wody i spróbuj ponownie na spokojnie.'
  };
}

export { f1 as formatDb, signedDb };
