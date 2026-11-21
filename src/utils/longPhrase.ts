// „Długa fraza” (ćwiczenie dla chórzystów)

import type { TakeFrame } from '../hooks/useTake';
import { NEAR_ERROR_CENTS, analyzeIntonationStability, intonationErrorSentence, intonationErrorTile } from './intonationStability';
import { soundingFrames } from './lipTrillExercise';
import { driftSentence } from './longTone';

/** Cisza co najmniej tak długa [s] oznacza przerwę na oddech. */
export const BREATH_GAP_SEC = 0.35;
export const MIN_PHRASE_SEC = 1.5;
/** Tempo podświetlania tekstu */
export const SYLLABLE_SEC = 0.3;
const MIN_VOICED_RUN_SEC = 0.08;
/** Brzegi odcinków dźwięcznych [s] */
const EDGE_TRIM_SEC = 0.04;

// ---------- Teksty ----------

export type PhraseTextId = 'crows' | 'count' | 'free';

export interface PhraseText {
  id: PhraseTextId;
  label: string;
  description: string;
  /** Kolejne fragmenty tekstu (puste dla tekstu dowolnego). */
  items: string[];
}

const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt'];
const UNITS_COUNT = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];

/** Liczebnik 1–69 do liczenia („raz, dwa…”). */
function numeral(n: number): string {
  if (n === 1) return 'raz';
  if (n < 10) return UNITS_COUNT[n] ?? '';
  if (n < 20) return TEENS[n - 10] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const u = n % 10;
  if (u === 0) return tens;
  return `${tens} ${UNITS_COUNT[u]}`;
}

const ORD_UNITS = ['', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma', 'ósma', 'dziewiąta'];
const ORD_TEENS = ['dziesiąta', 'jedenasta', 'dwunasta', 'trzynasta', 'czternasta', 'piętnasta', 'szesnasta', 'siedemnasta', 'osiemnasta', 'dziewiętnasta'];
const ORD_TENS = ['', '', 'dwudziesta', 'trzydziesta', 'czterdziesta', 'pięćdziesiąta', 'sześćdziesiąta'];

/** Liczebnik porządkowy żeński 1–69 */
function ordinalFem(n: number): string {
  if (n < 10) return ORD_UNITS[n] ?? '';
  if (n < 20) return ORD_TEENS[n - 10] ?? '';
  const tens = ORD_TENS[Math.floor(n / 10)] ?? '';
  const u = n % 10;
  return u === 0 ? tens : `${tens} ${ORD_UNITS[u]}`;
}

/** Odmiana rzeczownika po liczebniku */
export function crowWord(n: number): string {
  if (n === 1) return 'wrona';
  const u = n % 10, t = n % 100;
  return u >= 2 && u <= 4 && !(t >= 12 && t <= 14) ? 'wrony' : 'wron';
}

const MAX_ITEMS = 60;

export const PHRASE_TEXTS: PhraseText[] = [
  {
    id: 'crows',
    label: 'Liczenie wron',
    description: 'pierwsza wrona bez ogona, druga wrona bez ogona…',
    items: Array.from({ length: MAX_ITEMS }, (_, i) => `${ordinalFem(i + 1)} wrona bez ogona`)
  },
  {
    id: 'count',
    label: 'Liczenie',
    description: 'raz, dwa, trzy, cztery…',
    items: Array.from({ length: MAX_ITEMS }, (_, i) => numeral(i + 1))
  },
  {
    id: 'free',
    label: 'Własny tekst',
    description: 'np. słowa frazy z utworu',
    items: []
  }
];

/** Liczba sylab w polskim tekście */
export function syllables(text: string): number {
  const V = 'aeiouyąęó';
  const s = text.toLowerCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (!V.includes(c)) continue;
    const next = s[i + 1];
    if (c === 'i' && next !== undefined && V.includes(next)) continue;
    n++;
  }
  return Math.max(1, n);
}

export interface TimedItem { text: string; t0: number; t1: number }

/** Plan podświetlania tekstu */
export function timeItems(items: string[]): TimedItem[] {
  let t = 0;
  return items.map((text) => {
    const d = syllables(text) * SYLLABLE_SEC + 0.1;
    const it = { text, t0: t, t1: t + d };
    t += d;
    return it;
  });
}

// ---------- Analiza ----------

export interface PhraseResult {
  sufficient: boolean;
  /** Czas frazy od pierwszego dźwięku do przerwy na oddech [s]. */
  durationSec: number;
  endedByBreath: boolean;
  inTolPercent: number;
  thirds: [number, number, number];
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

function cleanPitch(frames: TakeFrame[]): (number | null)[] {
  const out: (number | null)[] = frames.map((f) => f.f0);
  let i = 0;
  while (i < frames.length) {
    if (out[i] === null) { i++; continue; }
    let j = i;
    while (j + 1 < frames.length && out[j + 1] !== null) j++;
    const a = frames[i]?.t ?? 0, b = frames[j]?.t ?? 0;
    for (let k = i; k <= j; k++) {
      const t = frames[k]?.t ?? 0;
      if (b - a < MIN_VOICED_RUN_SEC || t - a < EDGE_TRIM_SEC || b - t < EDGE_TRIM_SEC) out[k] = null;
    }
    i = j + 1;
  }
  return out;
}

/** Okno mediany wysokości [s] */
export const TEXT_PITCH_SMOOTH_SEC = 0.3;

/** Mediana wysokości w oknie ±połowa TEXT_PITCH_SMOOTH_SEC */
function smoothPitch(frames: TakeFrame[], pitch: (number | null)[]): (number | null)[] {
  const half = TEXT_PITCH_SMOOTH_SEC / 2;
  let lo = 0, hi = 0;
  return pitch.map((p, i) => {
    if (p === null) return null;
    const t = frames[i]?.t ?? 0;
    while (lo < i && t - (frames[lo]?.t ?? 0) > half) lo++;
    while (hi + 1 < frames.length && (frames[hi + 1]?.t ?? 0) - t <= half) hi++;
    const v: number[] = [];
    for (let k = lo; k <= hi; k++) { const x = pitch[k]; if (x !== null && x !== undefined && x > 0) v.push(Math.log2(x)); }
    if (v.length < 5) return null;
    v.sort((a, b) => a - b);
    return 2 ** (v[v.length >> 1] as number);
  });
}

export function analyzePhrase(frames: TakeFrame[], targetHz: number, toleranceCents: number, endedByBreath: boolean, liveSpan?: { first: number | null; last: number }): PhraseResult {
  const empty: PhraseResult = { sufficient: false, durationSec: 0, endedByBreath, inTolPercent: 0, thirds: [0, 0, 0], driftCents: NaN, meanCents: NaN, meanAbsCents: NaN };
  let phrase: TakeFrame[];
  if (liveSpan) {
    const { first, last } = liveSpan;
    if (first === null) return empty;
    phrase = frames.filter((f) => f.t >= first && f.t <= last);
  } else {
    const sounding = soundingFrames(frames.map((f) => f.f0 ?? 0), frames.map((f) => f.rms));
    const a = sounding.indexOf(true);
    if (a < 0) return empty;

    // koniec frazy
    let b = a;
    for (let i = a + 1; i < frames.length; i++) {
      if (!sounding[i]) continue;
      if ((frames[i]?.t ?? 0) - (frames[b]?.t ?? 0) >= BREATH_GAP_SEC && (frames[b]?.t ?? 0) - (frames[a]?.t ?? 0) >= MIN_PHRASE_SEC) break;
      b = i;
    }
    phrase = frames.slice(a, b + 1);
  }
  if (!phrase.length) return empty;
  const t0 = phrase[0]?.t ?? 0;
  const duration = (phrase[phrase.length - 1]?.t ?? 0) - t0;
  if (duration < 2) return { ...empty, durationSec: duration };

  const pitch = smoothPitch(phrase, cleanPitch(phrase));
  const st = analyzeIntonationStability(phrase.map((f, i) => ({ t: f.t, f0: pitch[i] ?? null })), { targetHz, toleranceCents, minVoicedSec: 0.5 });
  if (!st.sufficient) return { ...empty, durationSec: duration };
  const part = (k: number) => st.frames.filter((f) => f.analyzed && f.t - t0 >= (k * duration) / 3 && f.t - t0 < ((k + 1) * duration) / 3);
  const pct = (fs: typeof st.frames) => (fs.length ? (100 * fs.filter((f) => f.inTolerance).length) / fs.length : 0);
  const p0 = part(0), p1 = part(1), p2 = part(2);

  return {
    sufficient: true,
    durationSec: duration,
    endedByBreath,
    inTolPercent: st.inTolerancePercent,
    thirds: [pct(p0), pct(p1), pct(p2)],
    driftCents: median(p2.map((f) => f.cents ?? NaN)) - median(p0.map((f) => f.cents ?? NaN)),
    meanCents: st.meanCents,
    meanAbsCents: st.meanAbsCents
  };
}

export function itemsReached(timed: TimedItem[], durationSec: number): number {
  return timed.filter((it) => it.t1 <= durationSec + 0.15).length;
}

// ---------- Komunikaty ----------

export interface PhraseFeedback {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  rows: { id: string; label: string; value: string; comment: string }[];
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');

/** Wynik w jednostkach tekstu: „17 wron”, „do 23”, „18,4 s”. */
export function scoreLabel(textId: PhraseTextId, score: number): string {
  if (!Number.isFinite(score)) return '—';
  if (textId === 'crows') return `${score} ${crowWord(score)}`;
  if (textId === 'count') return `do ${score}`;
  return `${f1(score)} s`;
}

export function phraseFeedback(
  r: PhraseResult,
  textId: PhraseTextId,
  score: number,
  prevBest: number,
  toleranceCents: number,
  hitLimit: boolean,
  /** Wrony śpiewane („Długi oddech”) */
  opts: { crows?: boolean } = {}
): PhraseFeedback {
  if (!r.sufficient) {
    return {
      tone: 'insufficient',
      headline: 'Za krótka fraza',
      detail: 'Zaśpiewaj tekst na dźwięku wzorcowym, bez przerw między słowami, aż do chwili, gdy potrzebny będzie oddech.',
      rows: []
    };
  }
  const p = Math.round(r.inTolPercent);
  const byTime = p >= 75 ? 'good' : p >= 50 ? 'ok' : 'work';
  const tone = byTime === 'good' && r.meanAbsCents > NEAR_ERROR_CENTS ? 'ok' : byTime;
  const record = !Number.isFinite(prevBest) || score > prevBest;
  const [a, b, c] = r.thirds;

  const headline = textId === 'crows'
    ? `${scoreLabel(textId, score)} na jednym oddechu`
    : textId === 'count'
    ? `Liczenie do ${score} na jednym oddechu`
    : `Fraza na jednym oddechu: ${f1(r.durationSec)} s`;

  const parts = opts.crows ? [
    hitLimit ? 'Nagranie osiągnęło limit czasu. Wykonaj ćwiczenie ponownie, śpiewając na jednym oddechu.' : '',
    driftSentence(r.driftCents, 'mpt'),
    intonationErrorSentence(r.meanAbsCents, r.meanCents)
  ].filter(Boolean) : [
    record ? (Number.isFinite(prevBest) ? `Nowy rekord (poprzednio ${scoreLabel(textId, prevBest)})!` : '') : `Twój rekord: ${scoreLabel(textId, prevBest)}.`,
    hitLimit ? 'Nagranie osiągnęło limit czasu – fraza mogłaby trwać dłużej.' : '',
    intonationErrorSentence(r.meanAbsCents, r.meanCents),
    c + 15 < Math.max(a, b) ? 'Wysokość najczęściej uciekała pod koniec frazy, gdy kończyło się powietrze.' : '',
    driftSentence(r.driftCents, 'phrase'),
    tone === 'good' ? 'Głoski zmieniały się, a wysokość została na miejscu.' : '',
    tone === 'work' && !(c + 15 < Math.max(a, b))
      ? 'Wysokość zmieniała się razem z głoskami. Myśl o jednej, stałej linii dźwięku, na której „układasz” kolejne słowa.'
      : ''
  ].filter(Boolean);

  return {
    tone,
    headline,
    detail: parts.join(' '),
    rows: [
      {
        id: 'duration',
        label: 'czas frazy',
        value: `${f1(r.durationSec)} s`,
        comment: r.endedByBreath ? 'Do pierwszej przerwy na oddech' : 'Do zakończenia nagrania'
      },
      {
        id: 'best',
        label: 'rekord',
        value: scoreLabel(textId, Math.max(score, Number.isFinite(prevBest) ? prevBest : 0)),
        comment: record ? 'Ustanowiony teraz' : 'Twój najlepszy wynik w tym tekście'
      },
      { id: 'stability', label: 'równa wysokość', value: `${p}%`, comment: `Czas w granicach ±${toleranceCents} ct od dźwięku wzorcowego` },
      intonationErrorTile('end', r.meanAbsCents, r.meanCents)
    ]
  };
}

/** „Długi oddech”, wariant „Własny tekst” */
export function freePhraseFeedback(r: PhraseResult, prevBestSec: number, toleranceCents: number, hitLimit: boolean): PhraseFeedback {
  if (!r.sufficient) {
    return { tone: 'insufficient', headline: 'Za krótka fraza', detail: 'Weź spokojny wdech i zaśpiewaj swój tekst na jednym dźwięku tak długo, jak dasz radę.', rows: [] };
  }
  const s = r.durationSec;
  const p = Math.round(r.inTolPercent);
  const byTime = p >= 75 ? 'good' : p >= 50 ? 'ok' : 'work';
  const tone = byTime === 'good' && r.meanAbsCents > NEAR_ERROR_CENTS ? 'ok' : byTime;
  const record = !Number.isFinite(prevBestSec) || s > prevBestSec;
  const parts = [
    record ? (Number.isFinite(prevBestSec) ? `Nowy rekord! (poprzednio ${f1(prevBestSec)} s)` : 'To Twój pierwszy pomiar.') : `Twój rekord: ${f1(prevBestSec)} s.`,
    hitLimit ? 'Nagranie osiągnęło limit czasu. Wykonaj ćwiczenie ponownie, śpiewając na jednym oddechu.' : '',
    driftSentence(r.driftCents, 'mpt'),
    intonationErrorSentence(r.meanAbsCents, r.meanCents)
  ].filter(Boolean);
  return {
    tone,
    headline: `Fraza na jednym oddechu: ${f1(s)} s`,
    detail: parts.join(' '),
    rows: [
      { id: 'duration', label: 'czas frazy', value: `${f1(s)} s`, comment: 'Od początku do końca frazy, bez przerwy na oddech' },
      { id: 'best', label: 'rekord', value: `${f1(Math.max(s, Number.isFinite(prevBestSec) ? prevBestSec : 0))} s`, comment: record ? 'Ustanowiony teraz' : 'Twoja najdłuższa dotąd fraza' },
      { id: 'stability', label: 'równość wysokości', value: `${p}%`, comment: `Czas w granicach ±${toleranceCents} ct od dźwięku wzorcowego` },
      intonationErrorTile('drift', r.meanAbsCents, r.meanCents)
    ]
  };
}
