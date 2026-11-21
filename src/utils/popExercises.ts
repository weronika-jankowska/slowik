// Logika ćwiczeń dla śpiewaków rozrywkowych

import { analyzeVibratoFull, type VibratoAnalysisResult } from './audioMetrics';
import type { TakeFrame } from '../hooks/useTake';
import type { Rep, TargetNote, Timeline } from './lipTrillExercise';

type Tone = 'good' | 'ok' | 'work' | 'insufficient';
export interface Feedback { tone: Tone; headline: string; detail: string; rows: { id: string; label: string; value: string; comment: string }[] }

const f1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');
const signedCt = (c: number) => {
  const r = Math.round(c);
  return Number.isFinite(r) ? `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} ct` : '—';
};


export const VIB_SEGMENT_SEC = 4;
export const VIB_PLAN: boolean[] = [false, true, false, true]; // false = bez wibrata
/** Pomijamy początek odcinka – czas na przełączenie się. */
const SWITCH_SEC = 0.6;

export interface VibSegment { index: number; want: boolean; t0: number; t1: number; result: VibratoAnalysisResult; ok: boolean; voiced: number }

export function analyzeVibratoSegments(frames: TakeFrame[]): VibSegment[] {
  return VIB_PLAN.map((want, index) => {
    const t0 = index * VIB_SEGMENT_SEC, t1 = t0 + VIB_SEGMENT_SEC;
    const seg = frames.filter((f) => f.t >= t0 + SWITCH_SEC && f.t <= t1 - 0.1 && f.f0 !== null);
    const result = analyzeVibratoFull(seg.map((f) => f.f0 as number), 0.016, seg.map((f) => f.t));
    return { index, want, t0, t1, result, ok: seg.length >= 40 && result.hasVibrato === want, voiced: seg.length };
  });
}

export function vibratoOnDemandFeedback(segs: VibSegment[]): Feedback {
  const sung = segs.filter((s) => s.voiced >= 40);
  if (sung.length < 2) {
    return { tone: 'insufficient', headline: 'Za mało nagranego dźwięku', detail: 'Śpiewaj przez całe nagranie, zmieniając sposób śpiewania co 4 sekundy.', rows: [] };
  }
  const ok = segs.filter((s) => s.ok).length;
  const tone: Tone = ok === segs.length ? 'good' : ok >= segs.length / 2 ? 'ok' : 'work';
  const vib = segs.filter((s) => s.want && s.result.hasVibrato);
  const straight = segs.filter((s) => !s.want && s.voiced >= 40);
  const rate = vib.length ? vib.reduce((a, s) => a + s.result.rateHz, 0) / vib.length : NaN;
  const extent = vib.length ? vib.reduce((a, s) => a + s.result.extentSemitones, 0) / vib.length : NaN;
  const straightWobble = straight.length ? Math.max(...straight.map((s) => (s.result.hasVibrato ? s.result.extentCents : 0))) : NaN;

  const hints: string[] = [];
  const missedVib = segs.filter((s) => s.want && !s.ok && s.voiced >= 40).length;
  const leaked = segs.filter((s) => !s.want && !s.ok && s.voiced >= 40).length;
  if (missedVib && leaked) hints.push('Śpiewasz przeciwnie niż wymaga ćwiczenie. Śpiewaj prostym dźwiękiem w odcinkach „bez wibrato” i z techniką w wibrato w dwóch pozostałych.');
  else if (missedVib) hints.push('W odcinkach „z wibrato” nie wykryto regularnego falowania.');
  else if (leaked) hints.push('W odcinkach „bez wibrato” wciąż słychać tę technikę. Postaraj się zaśpiewać prostym dźwiękiem.');
  if (!hints.length) hints.push('Świadomie włączasz i wyłączasz wibrato.');

  return {
    tone,
    headline: `Zgodne odcinki: ${ok} z ${segs.length}`,
    detail: hints.join(' '),
    rows: [
      { id: 'ok', label: 'zgodne odcinki', value: `${ok} / ${segs.length}`, comment: 'Wibrato i prosty dźwięk były śpiewane w odpowiednich odcinkach czasu' },
      {
        id: 'rate', label: 'tempo wibrata', value: Number.isFinite(rate) ? `${f1(rate)} Hz` : '—',
        comment: !Number.isFinite(rate) ? 'Nie wykryto wibrata' : rate >= 5 && rate <= 7 ? 'W typowym zakresie 5–7 Hz' : rate < 5 ? 'Wolniej niż typowe 5–7 Hz' : 'Szybciej niż typowe 5–7 Hz'
      },
      {
        id: 'extent', label: 'rozpiętość wibrata', value: Number.isFinite(extent) ? `±${f1(extent)} półtonu` : '—',
        comment: !Number.isFinite(extent) ? 'Nie wykryto wibrata' : extent <= 1 ? 'W granicach ±1 półtonu' : 'Szersze niż ±1 półtonu'
      },
      {
        id: 'straight', label: 'prosty dźwięk', value: !Number.isFinite(straightWobble) ? '—' : straightWobble === 0 ? 'bez wibrato' : `wibrato ±${Math.round(straightWobble)} ct`,
        comment: 'Odcinki, w których wibrato miało być wyłączone'
      }
    ]
  };
}


export const INTERVALS = [
  { semis: 1, name: 'sekunda mała' }, { semis: 2, name: 'sekunda wielka' }, { semis: 3, name: 'tercja mała' },
  { semis: 4, name: 'tercja wielka' }, { semis: 5, name: 'kwarta czysta' }, { semis: 6, name: 'tryton' },
  { semis: 7, name: 'kwinta czysta' }, { semis: 8, name: 'seksta mała' }, { semis: 9, name: 'seksta wielka' },
  { semis: 10, name: 'septyma mała' }, { semis: 11, name: 'septyma wielka' }, { semis: 12, name: 'oktawa' }
] as const;

/** Domyślna liczba prób (użytkownik może ją zmienić). */
export const INTERVAL_ROUNDS = 7;
export const INTERVAL_CLEAN_CENTS = 50;
const NOTE_SEC = 1.4;
const PLAY_SEC = 0.75;

/** Kierunki prób: „oba” */
export function intervalDirections(mode: 'up' | 'down' | 'both', n: number, rnd: () => number = Math.random): boolean[] {
  if (mode !== 'both') return Array.from({ length: n }, () => mode === 'up');
  const half = Math.floor(n / 2);
  const dirs = [...Array.from({ length: half }, () => true), ...Array.from({ length: half }, () => false)];
  for (let i = dirs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [dirs[i], dirs[j]] = [dirs[j] as boolean, dirs[i] as boolean]; }
  if (n % 2) dirs.push(rnd() < 0.5);
  return dirs;
}

export function randomStarts(lo: number, hi: number, n: number, rnd: () => number = Math.random): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = lo;
    for (let k = 0; k < 10; k++) {
      m = lo + Math.floor(rnd() * (hi - lo + 1));
      if (m !== out[out.length - 1]) break;
    }
    out.push(m);
  }
  return out;
}

/** `ups[i]` – kierunek i-tej próby (true = w górę). */
export function buildIntervalTimeline(starts: number[], semis: number, ups: boolean[]): Timeline {
  const stepOf = (i: number) => (ups[i] ?? true ? semis : -semis);
  let t = 0.3;
  const reps: Rep[] = starts.map((a, index) => {
    const b = a + stepOf(index);
    // pierwsza próba
    const heard: TargetNote[] = index === 0
      ? [
          { t0: t, t1: t + PLAY_SEC, midiFrom: a, midiTo: a },
          { t0: t + PLAY_SEC + 0.15, t1: t + 2 * PLAY_SEC + 0.15, midiFrom: b, midiTo: b }
        ]
      : [{ t0: t, t1: t + 0.6, midiFrom: a, midiTo: a }];
    const lastHeard = heard[heard.length - 1] as TargetNote;
    const singT0 = lastHeard.t1 + 0.7;
    const n1: TargetNote = { t0: singT0, t1: singT0 + NOTE_SEC, midiFrom: a, midiTo: a };
    const n2: TargetNote = { t0: n1.t1 + 0.1, t1: n1.t1 + 0.1 + NOTE_SEC, midiFrom: b, midiTo: b };
    const rep: Rep = { index, offset: a - (starts[0] ?? a), startMidi: a, cue: heard[0] as TargetNote, cueNotes: heard, singT0, singT1: n2.t1, t1: n2.t1 + 1, notes: [n1, n2] };
    t = rep.t1;
    return rep;
  });
  const all = reps.flatMap((r, i) => [r.startMidi, r.startMidi + stepOf(i)]);
  return { beatSec: 0.5, demo: [], demoT1: 0, reps, end: t, minMidi: Math.min(...all), maxMidi: Math.max(...all) };
}

export function intervalPlayback(tl: Timeline): { midi: number; t0: number; dur: number }[] {
  return tl.reps.flatMap((r) => (r.cueNotes ?? [r.cue]).map((n) => ({ midi: n.midiFrom, t0: n.t0, dur: n.t1 - n.t0 })));
}

export interface IntervalRound { startMidi: number; up: boolean; first: number; second: number; intervalError: number; clean: boolean; sung: boolean }

/** Błąd interwału */
export function intervalRounds(noteCents: [number, number][], starts: number[], ups: boolean[]): IntervalRound[] {
  return noteCents.map(([a, b], i) => {
    const sung = Number.isFinite(a) && Number.isFinite(b);
    const up = ups[i] ?? true;
    const err = sung ? (up ? b - a : a - b) : NaN;
    return { startMidi: starts[i] ?? 0, up, first: a, second: b, intervalError: err, clean: sung && Math.abs(err) <= INTERVAL_CLEAN_CENTS, sung };
  });
}

export function intervalFeedback(rounds: IntervalRound[], intervalName: string): Feedback {
  const sung = rounds.filter((r) => r.sung);
  if (sung.length < 2) {
    return { tone: 'insufficient', headline: 'Za mało zaśpiewanych prób', detail: 'Po dźwięku sygnału zaśpiewaj oba dźwięki interwału, za przesuwającą się kreską.', rows: [] };
  }
  const clean = rounds.filter((r) => r.clean).length;
  const tone: Tone = clean >= rounds.length * 0.8 ? 'good' : clean >= rounds.length * 0.4 ? 'ok' : 'work';
  // średnie (nie mediany)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const err = mean(sung.map((r) => r.intervalError));
  const first = mean(sung.map((r) => Math.abs(r.first)));
  const second = mean(sung.map((r) => Math.abs(r.second)));
  const hints: string[] = [];
  if (Math.abs(err) > INTERVAL_CLEAN_CENTS / 2) hints.push(err > 0 ? 'Masz tendencję do śpiewania tego interwału za szeroko.' : 'Masz tendencję do śpiewania tego interwału za wąsko.');
  if (first > 40) hints.push('Już pierwszy dźwięk często odbiegał od sygnału – wsłuchaj się w niego dokładniej przed wejściem.');
  if (!hints.length) hints.push(tone === 'good' ? 'Interwał brzmi czysto.' : 'Postaraj się zapamiętać interwał. To łatwiejsze, jeśli skojarzysz go z wybraną, dobrze Ci znaną melodią.');
  return {
    tone,
    headline: `${intervalName[0]?.toUpperCase()}${intervalName.slice(1)}: czysto w ${clean} z ${rounds.length} prób`,
    detail: hints.join(' '),
    rows: [
      { id: 'clean', label: 'czyste interwały', value: `${clean} / ${rounds.length}`, comment: `Precyzyjny interwał – do ±${INTERVAL_CLEAN_CENTS} ct` },
      { id: 'error', label: 'błąd interwału', value: signedCt(err), comment: Math.abs(err) <= 10 ? 'Średnio prawie idealnie' : err > 0 ? 'Średnio za szeroko' : 'Średnio za wąsko' },
      { id: 'first', label: 'pierwszy dźwięk', value: `±${Math.round(first)} ct`, comment: 'Średni błąd intonacji dla pierwszego dźwięku' },
      { id: 'second', label: 'drugi dźwięk', value: `±${Math.round(second)} ct`, comment: 'Średni błąd intonacji dla drugiego dźwięku' }
    ]
  };
}


export const MESSA_SEC = 10;

export function loudnessCurve(frames: TakeFrame[]): { t: number[]; db: number[] } {
  const firstV = frames.findIndex((f) => f.f0 !== null);
  let lastV = -1;
  frames.forEach((f, i) => { if (f.f0 !== null) lastV = i; });
  const t: number[] = [], raw: number[] = [];
  frames.forEach((f, i) => {
    t.push(f.t);
    raw.push(i >= firstV && i <= lastV && firstV >= 0 ? 20 * Math.log10(Math.max(1e-5, f.rms)) : NaN);
  });
  const sm = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let k = i; k >= 0 && (t[i] ?? 0) - (t[k] ?? 0) <= 0.075; k--) if (Number.isFinite(raw[k] ?? NaN)) { s += raw[k] as number; n++; }
    for (let k = i + 1; k < raw.length && (t[k] ?? 0) - (t[i] ?? 0) <= 0.075; k++) if (Number.isFinite(raw[k] ?? NaN)) { s += raw[k] as number; n++; }
    return n && Number.isFinite(raw[i] ?? NaN) ? s / n : NaN;
  });
  const max = Math.max(...sm.filter(Number.isFinite));
  return { t, db: sm.map((v) => v - max) };
}

export function messaTarget(t: number, depth: number): number {
  const k = Math.min(1, Math.max(0, t / MESSA_SEC));
  return -depth * Math.abs(1 - 2 * k);
}

export interface MessaResult {
  sufficient: boolean;
  rangeDb: number;
  peakAt: number;
  shapeR: number;
  durationSec: number;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = (x[i] ?? 0) - mx, dy = (y[i] ?? 0) - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export function analyzeMessa(frames: TakeFrame[]): MessaResult {
  const { t, db } = loudnessCurve(frames);
  const idx = db.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  const dur = idx.length ? (t[idx[idx.length - 1] as number] ?? 0) - (t[idx[0] as number] ?? 0) : 0;
  if (idx.length < 60 || dur < 3) return { sufficient: false, rangeDb: NaN, peakAt: NaN, shapeR: NaN, durationSec: dur };
  const vals = idx.map((i) => db[i] as number).sort((a, b) => a - b);
  const p = (q: number) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] as number;
  const rangeDb = p(0.95) - p(0.05);
  let peakI = idx[0] as number;
  for (const i of idx) if ((db[i] ?? -Infinity) > (db[peakI] ?? -Infinity)) peakI = i;
  const ts = idx.map((i) => t[i] as number), ds = idx.map((i) => db[i] as number);
  const shapeR = pearson(ds, ts.map((x) => messaTarget(x, 20)));
  // ocena dotyczy tylko dynamiki
  return { sufficient: true, rangeDb, peakAt: (t[peakI] ?? 0) / MESSA_SEC, shapeR, durationSec: dur };
}

export function messaFeedback(r: MessaResult): Feedback {
  if (!r.sufficient) {
    return { tone: 'insufficient', headline: 'Za krótki dźwięk', detail: `Utrzymaj jeden dźwięk przez całe ${MESSA_SEC} sekund: narastaj do połowy, potem wyciszaj.`, rows: [] };
  }
  // progi własne (brak norm dla nagrań z mikrofonu komputera)
  const tone: Tone = r.rangeDb >= 20 && r.shapeR >= 0.7 ? 'good' : r.rangeDb >= 12 ? 'ok' : 'work';
  const hints: string[] = [];
  if (r.rangeDb < 12) hints.push('Różnica między cichym a głośnym fragmentem jest niewielka. Postaraj się bardziej zróżnicować dynamikę – zacznij ciszej lub zaśpiewaj głośniej w środkowej części.');
  if (r.peakAt < 0.35) hints.push('Najgłośniej było zbyt wcześnie – rozłóż crescendo na całą pierwszą połowę.');
  else if (r.peakAt > 0.65) hints.push('Najgłośniej było zbyt późno – postaraj się, by diminuendo było bardziej stopniowe.');
  if (!hints.length) hints.push('Płynna zmiana dynamiki.');
  const shape = !Number.isFinite(r.shapeR) ? '—' : r.shapeR >= 0.8 ? 'bardzo zgodny' : r.shapeR >= 0.5 ? 'częściowo zgodny' : 'niezgodny';
  return {
    tone,
    headline: `Rozpiętość dynamiki: ${f1(r.rangeDb)} dB`,
    detail: hints.join(' '),
    rows: [
      { id: 'range', label: 'rozpiętość dynamiki', value: `${f1(r.rangeDb)} dB`, comment: 'Różnica między piano a forte' },
      {
        id: 'shape', label: 'kształt', value: shape,
        comment: !Number.isFinite(r.shapeR) ? 'Brak odczytu'
          : r.shapeR >= 0.8 ? 'Twoja dynamika zgadza się z łukiem wzorcowym niemal idealnie'
          : r.shapeR >= 0.5 ? 'Twoja dynamika jest częściowo zgodna z łukiem wzorcowym'
          : 'Twoja dynamika jest niezgodna z łukiem wzorcowym'
      },
      { id: 'peak', label: 'szczyt głośności', value: `${f1(r.peakAt * MESSA_SEC)} s`, comment: `Celem jest wartość ${MESSA_SEC / 2} s, czyli w połowie dźwięku` }
    ]
  };
}
