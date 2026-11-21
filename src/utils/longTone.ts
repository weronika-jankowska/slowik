// Długie dźwięki na jednym oddechu: • „Długi oddech”

import type { TakeFrame } from '../hooks/useTake';
import { analyzeIntonationStability, intonationErrorSentence, intonationErrorTile } from './intonationStability';

/** Przerwa dłuższa niż tyle sekund kończy fonację (nowy oddech) */
const BREAK_SEC = 0.25;

export interface LongToneResult {
  sufficient: boolean;
  /** Najdłuższy ciągły dźwięk [s]. */
  durationSec: number;
  /** % czasu w tolerancji – cały dźwięk i jego trzy części. */
  inTolPercent: number;
  thirds: [number, number, number];
  /** Zmiana wysokości */
  driftCents: number;
  meanCents: number;
  /** Średni błąd intonacji */
  meanAbsCents: number;
}

function median(v: number[]): number {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}

export function analyzeLongTone(frames: TakeFrame[], targetHz: number, toleranceCents: number): LongToneResult {
  // najdłuższy ciągły odcinek dźwięku
  let best = { a: 0, b: -1 }, runA = -1, last = NaN;
  frames.forEach((f, i) => {
    if (f.f0 === null) return;
    if (runA < 0 || f.t - last > BREAK_SEC) runA = i;
    last = f.t;
    const bestLen = best.b >= 0 ? (frames[best.b]?.t ?? 0) - (frames[best.a]?.t ?? 0) : -1;
    if (f.t - (frames[runA]?.t ?? f.t) > bestLen) best = { a: runA, b: i };
  });
  const run = best.b >= 0 ? frames.slice(best.a, best.b + 1) : [];
  const duration = run.length ? (run[run.length - 1]?.t ?? 0) - (run[0]?.t ?? 0) : 0;
  if (duration < 1) {
    return { sufficient: false, durationSec: duration, inTolPercent: 0, thirds: [0, 0, 0], driftCents: NaN, meanCents: NaN, meanAbsCents: NaN };
  }

  const st = analyzeIntonationStability(run.map((f) => ({ t: f.t, f0: f.f0 })), { targetHz, toleranceCents, minVoicedSec: 0.5 });
  const t0 = run[0]?.t ?? 0;
  const part = (k: number) => st.frames.filter((f) => f.analyzed && f.t - t0 >= (k * duration) / 3 && f.t - t0 < ((k + 1) * duration) / 3);
  const pct = (fs: typeof st.frames) => (fs.length ? (100 * fs.filter((f) => f.inTolerance).length) / fs.length : 0);
  const p0 = part(0), p1 = part(1), p2 = part(2);

  return {
    sufficient: true,
    durationSec: duration,
    inTolPercent: st.inTolerancePercent,
    thirds: [pct(p0), pct(p1), pct(p2)],
    driftCents: median(p2.map((f) => f.cents ?? NaN)) - median(p0.map((f) => f.cents ?? NaN)),
    meanCents: st.meanCents,
    meanAbsCents: st.meanAbsCents
  };
}

export interface LongToneFeedback {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  rows: { id: string; label: string; value: string; comment: string }[];
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');

export function driftSentence(drift: number, mode: 'mpt' | 'phrase'): string {
  if (!Number.isFinite(drift) || Math.abs(drift) < 15) return '';
  if (drift > 0) {
    return `Pod koniec dźwięk podnosił się (o ${Math.round(drift)} ct) – często to oznaka wyciskania resztek powietrza. Postaraj się nie napinać szyi pod koniec.`;
  }
  return mode === 'mpt'
    ? `Pod koniec dźwięk opadał (o ${Math.round(-drift)} ct) – to typowe, gdy kończy się powietrze. Zakończ dźwięk, zanim głos zacznie się „zapadać”, i z czasem wydłużaj ten moment.`
    : `Pod koniec dźwięk opadał (o ${Math.round(-drift)} ct). Rozłóż powietrze na całą frazę: zacznij oszczędniej, a pod koniec myśl o dźwięku „w górę”, nie w dół.`;
}

export function mptFeedback(r: LongToneResult, prevBestSec: number, toleranceCents: number): LongToneFeedback {
  if (!r.sufficient) {
    return { tone: 'insufficient', headline: 'Za krótki dźwięk', detail: 'Weź spokojny wdech i śpiewaj <i>a</i> tak długo, jak dasz radę.', rows: [] };
  }
  const s = r.durationSec;
  const tone = s >= 20 ? 'good' : s >= 10 ? 'ok' : 'work';
  const record = !Number.isFinite(prevBestSec) || s > prevBestSec;
  const parts = [
    record ? (Number.isFinite(prevBestSec) ? `Nowy rekord! (poprzednio ${f1(prevBestSec)} s)` : 'To Twój pierwszy pomiar.') : `Twój rekord: ${f1(prevBestSec)} s.`,
    tone === 'work'
      ? 'To krótko jak na jeden oddech. Popracuj nad spokojnym, oszczędnym wydechem. Ćwiczenie z przygotowania (długi syk) może być tu pomocne.'
      : '',
    driftSentence(r.driftCents, 'mpt'),
    intonationErrorSentence(r.meanAbsCents, r.meanCents)
  ].filter(Boolean);
  return {
    tone,
    headline: `Dźwięk na jednym oddechu: ${f1(s)} s`,
    detail: parts.join(' '),
    rows: [
      { id: 'duration', label: 'czas dźwięku', value: `${f1(s)} s`, comment: 'Od początku do końca dźwięku, bez przerwy na oddech' },
      { id: 'best', label: 'rekord', value: `${f1(Math.max(s, Number.isFinite(prevBestSec) ? prevBestSec : 0))} s`, comment: record ? 'Ustanowiony teraz' : 'Twój najdłuższy dotąd dźwięk' },
      { id: 'stability', label: 'równość wysokości', value: `${Math.round(r.inTolPercent)}%`, comment: `Czas w granicach ±${toleranceCents} ct od dźwięku wzorcowego` },
      intonationErrorTile('drift', r.meanAbsCents, r.meanCents)
    ]
  };
}
