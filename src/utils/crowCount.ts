// „Długi oddech”

import type { TakeFrame } from '../hooks/useTake';
import { BREATH_GAP_SEC, MIN_PHRASE_SEC, PHRASE_TEXTS, crowWord } from './longPhrase';
import { soundingFrames } from './lipTrillExercise';

export const MAX_CROWS = (PHRASE_TEXTS.find((x) => x.id === 'crows')?.items ?? []).length;

export interface SpokenCrowsResult {
  sufficient: boolean;
  /** Czas od pierwszego dźwięku do przerwy na oddech [s]. */
  durationSec: number;
  endedByBreath: boolean;
}

export function analyzeSpokenCrows(frames: TakeFrame[], endedByBreath: boolean, liveSpan?: { first: number | null; last: number }): SpokenCrowsResult {
  const empty: SpokenCrowsResult = { sufficient: false, durationSec: 0, endedByBreath };
  if (liveSpan) {
    if (liveSpan.first === null) return empty;
    const d = liveSpan.last - liveSpan.first;
    return d < 2 ? { ...empty, durationSec: Math.max(0, d) } : { sufficient: true, durationSec: d, endedByBreath };
  }
  const sounding = soundingFrames(frames.map((f) => f.f0 ?? 0), frames.map((f) => f.rms));
  const a = sounding.indexOf(true);
  if (a < 0) return empty;
  // koniec: ostatni dźwięk przed pierwszą przerwą na oddech
  let b = a;
  for (let i = a + 1; i < frames.length; i++) {
    if (!sounding[i]) continue;
    if ((frames[i]?.t ?? 0) - (frames[b]?.t ?? 0) >= BREATH_GAP_SEC && (frames[b]?.t ?? 0) - (frames[a]?.t ?? 0) >= MIN_PHRASE_SEC) break;
    b = i;
  }
  const part = frames.slice(a, b + 1);
  const durationSec = (part[part.length - 1]?.t ?? 0) - (part[0]?.t ?? 0);
  if (durationSec < 2) return { ...empty, durationSec };
  return { sufficient: true, durationSec, endedByBreath };
}

export interface SpokenCrowsFeedback {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  rows: { id: string; label: string; value: string; comment: string }[];
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');
export const crowsLabel = (n: number) => (Number.isFinite(n) ? `${n} ${crowWord(n)}` : '—');

/** Komunikat dla wariantu mówionego */
export function spokenCrowsFeedback(r: SpokenCrowsResult, crows: number, prevBest: number, hitLimit: boolean): SpokenCrowsFeedback {
  if (!r.sufficient) {
    return {
      tone: 'insufficient',
      headline: 'Za krótkie nagranie',
      detail: 'Weź wdech i licz wrony na głos, bez przerw, aż do chwili, gdy potrzebny będzie oddech.',
      rows: []
    };
  }
  const entered = crows > 0;
  const record = entered && (!Number.isFinite(prevBest) || crows > prevBest);
  const perCrow = entered ? r.durationSec / crows : NaN;
  const parts = [
    !entered ? 'Wpisz poniżej, ile wron udało się policzyć.' : record ? (Number.isFinite(prevBest) ? `Nowy rekord! (poprzednio ${crowsLabel(prevBest)})` : 'To pierwszy wynik – kolejne będą z nim porównywane.') : `Twój rekord: ${crowsLabel(prevBest)}.`,
    hitLimit ? 'Nagranie osiągnęło limit czasu.' : '',
    'Pamiętaj, że szybkie tempo ma sens tylko przy odpowiedniej dykcji. Każda wrona powinna być możliwa do zrozumienia.'
  ].filter(Boolean);
  const bestNow = Math.max(crows, Number.isFinite(prevBest) ? prevBest : 0);
  return {
    tone: record ? 'good' : 'ok',
    headline: `Liczenie wron na jednym oddechu: ${f1(r.durationSec)} s`,
    detail: parts.join(' '),
    rows: [
      { id: 'duration', label: 'czas', value: `${f1(r.durationSec)} s`, comment: r.endedByBreath ? 'Do pierwszej przerwy na oddech' : 'Do zakończenia nagrania' },
      { id: 'crows', label: 'policzone wrony', value: entered ? `${crows}` : '—', comment: entered ? 'Liczba wpisana po nagraniu' : 'Wpisz liczbę pod wynikami' },
      { id: 'tempo', label: 'tempo', value: Number.isFinite(perCrow) ? `${f1(perCrow)} s na wronę` : '—', comment: 'Średni czas jednej wrony' },
      { id: 'best', label: 'rekord', value: bestNow > 0 ? crowsLabel(bestNow) : '—', comment: record ? 'Ustanowiony teraz' : 'Najlepszy dotychczasowy wynik' }
    ]
  };
}
