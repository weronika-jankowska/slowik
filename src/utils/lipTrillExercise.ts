// Ćwiczenie „Tryl wargowy” – etap 2: rozśpiewka trylem

// ---------- Wzory ----------

export interface PatternNote {
  /** Stopień w półtonach od dźwięku startowego. */
  step: number;
  /** Długość w ćwierćnutach. */
  beats: number;
  /** Jeśli podane – nuta jest glissandem od `step` do `glideTo`. */
  glideTo?: number;
}

export interface TrillPattern {
  id: string;
  name: string;
  description: string;
  /** Tempo bazowe (ćwierćnuta na minutę). */
  bpm: number;
  allowSeparate: boolean;
  notes: PatternNote[];
  /** Rozśpiewka: stałe sylaby wzoru (jedna na nutę) */
  lyrics?: string[];
  /** Rozśpiewka: sylaby śpiewane na wzorze */
  singText?: string;
  /** Rozśpiewka: warianty sylab */
  syllableOptions?: { id: string; label: string; hint: string }[];
  /** Rozśpiewka: tekst wprowadzenia */
  intro?: string[];
  /** Rozśpiewka: wskazówka pod wprowadzeniem. */
  hint?: string;
}

const s = (step: number, beats: number): PatternNote => ({ step, beats });

export const TRILL_PATTERNS: TrillPattern[] = [
  {
    id: 'third',
    name: 'Trzy dźwięki',
    description: 'W górę o trzy dźwięki i z powrotem',
    bpm: 80,
    allowSeparate: true,
    notes: [s(0, 0.5), s(2, 0.5), s(4, 0.5), s(2, 0.5), s(0, 2)]
  },
  {
    id: 'fifth',
    name: 'Pięć dźwięków',
    description: 'W górę o pięć dźwięków i z powrotem',
    bpm: 60,
    allowSeparate: true,
    notes: [s(0, 0.25), s(2, 0.25), s(4, 0.25), s(5, 0.25), s(7, 0.25), s(5, 0.25), s(4, 0.25), s(2, 0.25), s(0, 2)]
  },
  {
    id: 'descent',
    name: 'Zejście',
    description: 'Pięć dźwięków w dół',
    bpm: 60,
    allowSeparate: true,
    notes: [s(7, 0.25), s(5, 0.25), s(4, 0.25), s(2, 0.25), s(0, 1)]
  },
  {
    id: 'glide',
    name: 'Zjazd o oktawę',
    description: 'Płynnie z góry na dół o oktawę',
    bpm: 60,
    allowSeparate: false,
    notes: [s(12, 1), { step: 12, beats: 1, glideTo: 0 }, s(0, 1)]
  }
];

/** Ostatnia nuta wzoru trwa dłużej (zatrzymanie na tonice). */
const run = (steps: number[], beats: number, lastBeats: number): PatternNote[] =>
  steps.map((st, i) => s(st, i === steps.length - 1 ? lastBeats : beats));

/** Wzory ćwiczenia „Rozśpiewka” (śpiewane legato) */
export const VOCAL_PATTERNS: TrillPattern[] = [
  {
    id: 'prima',
    name: 'Pryma',
    description: 'Jeden dźwięk, sylaby ma-me-mi-mo-mu',
    bpm: 90,
    allowSeparate: false,
    notes: run([0, 0, 0, 0, 0], 1, 2),
    lyrics: ['ma', 'me', 'mi', 'mo', 'mu'],
    intro: [
      'Usłyszysz dźwięk pianina. W tym ćwiczeniu musisz zaśpiewać różne sylaby na tym samym dźwięku.',
      'Po rozpoczęciu ćwiczenia usłyszysz pierwszy dźwięk melodii. Weź oddech i zaśpiewaj całą melodię na sylabach „ma-me-mi-mo-mu”.',
      'Każde kolejne powtórzenie rozpoczyna się o {krok} wyżej, aż melodia dojdzie do najwyższego dźwięku. Potem początkowe dźwięki będą rozpoczynać się o {krok} niżej w każdym powtórzeniu.',
      'Możesz wybrać dowolny zakres, na którym chcesz wykonać ćwiczenie.'
    ],
    hint: 'Wszystkie sylaby śpiewaj na tym samym dźwięku i z tą samą głośnością. Zmieniają się tylko samogłoski. W każdym powtórzeniu śpiewaj całą melodię na jednym oddechu, legato.'
  },
  {
    id: 'five',
    name: 'Gama do kwinty',
    description: 'Do-re-mi-fa-sol i z powrotem',
    bpm: 80,
    allowSeparate: false,
    notes: run([0, 2, 4, 5, 7, 5, 4, 2, 0], 0.5, 1.5),
    syllableOptions: [
      { id: 'mi-ja', label: 'mi-ja', hint: 'Śpiewaj „mi” na dźwiękach w górę i „ja” na dźwiękach w dół. Całą melodię zaśpiewaj na jednym oddechu, legato.' },
      { id: 'no', label: 'no', hint: 'Śpiewaj „no” na każdym dźwięku. Całą melodię zaśpiewaj na jednym oddechu, legato.' },
      { id: 'la', label: 'la', hint: 'Śpiewaj „la” na każdym dźwięku. Całą melodię zaśpiewaj na jednym oddechu, legato.' }
    ],
    intro: [
      'Usłyszysz melodię pianina. Posłuchaj jej i zwróć uwagę na graficzny układ dźwięków.',
      'W każdym powtórzeniu usłyszysz dźwięk, od którego musisz rozpocząć melodię. Weź oddech i zaśpiewaj całą melodię na {sylaby}. Prowadź swój głos zgodnie z wyświetlanymi dźwiękami.',
      'Każde powtórzenie rozpoczyna się o {krok} wyżej, aż do najwyższego dźwięku, a następnie dźwięki schodzą z każdym powtórzeniem coraz niżej.',
      'Możesz wybrać dowolny zakres, na którym chcesz wykonać ćwiczenie.'
    ]
  },
  {
    id: 'domisol',
    name: 'Do-mi-sol',
    description: 'Do-mi-sol-mi-do-fa-la-fa-do-mi-sol-mi-do',
    bpm: 80,
    allowSeparate: false,
    notes: run([0, 4, 7, 4, 0, 5, 9, 5, 0, 4, 7, 4, 0], 0.5, 1.5),
    lyrics: ['do', 'mi', 'sol', 'mi', 'do', 'fa', 'la', 'fa', 'do', 'mi', 'sol', 'mi', 'do'],
    intro: [
      'Usłyszysz melodię pianina. Posłuchaj jej i zwróć uwagę na graficzny układ dźwięków.',
      'W każdym powtórzeniu usłyszysz dźwięk, od którego musisz rozpocząć melodię. Weź oddech i zaśpiewaj całą melodię na sylabach „do-mi-sol-mi-do-fa-la-fa-do-mi-sol-mi-do”. Niezależnie od dźwięków, śpiewaj te same sylaby. Prowadź swój głos zgodnie z wyświetlanymi dźwiękami.',
      'Każde powtórzenie rozpoczyna się o {krok} wyżej, aż do najwyższego dźwięku, a następnie dźwięki schodzą z każdym powtórzeniem coraz niżej.',
      'Możesz wybrać dowolny zakres, na którym chcesz wykonać ćwiczenie.'
    ],
    hint: 'Śpiewaj nazwy dźwięków. W każdej tonacji sylaby zostają te same – zmienia się tylko wysokość. Całą melodię zaśpiewaj legato, na jednym oddechu.'
  }
];

/** Sylaby wzoru do wyświetlenia, np. „ma-me-mi-mo-mu”. */
export const lyricsText = (p: TrillPattern): string | null => p.singText ?? (p.lyrics ? `„${p.lyrics.join('-')}”` : null);

export type Articulation = 'separate' | 'legato';

export const TEMPOS = [
  { id: 'slow', label: 'wolno', factor: 0.75 },
  { id: 'medium', label: 'średnio', factor: 1 },
  { id: 'fast', label: 'szybko', factor: 1.25 }
] as const;
export type TempoId = (typeof TEMPOS)[number]['id'];

/** Ile półtonów w górę idzie rozśpiewka (potem tyle samo w dół) */
export const SEMITONES_UP = 4;
const SEPARATE_SOUND_FRACTION = 0.55;

export function patternSpan(p: TrillPattern): number {
  return Math.max(...p.notes.map((n) => Math.max(n.step, n.glideTo ?? n.step)));
}

/** Stopnie gamy durowej [półtony od toniki]. */
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];

export function thirdAbove(step: number): number {
  const oct = Math.floor(step / 12);
  const deg = MAJOR_DEGREES.indexOf(step - 12 * oct);
  if (deg < 0) return 4;
  const target = MAJOR_DEGREES[(deg + 2) % 7]! + 12 * (oct + (deg + 2 >= 7 ? 1 : 0));
  return target - step;
}

export function sungRange(p: TrillPattern, harmony = false): { low: number; high: number } {
  const v = p.notes.flatMap((n) => [n.step, n.glideTo ?? n.step]).map((x) => (harmony ? x + thirdAbove(x) : x));
  return { low: Math.min(...v), high: Math.max(...v) };
}

// ---------- Oś czasu ----------

export interface TargetNote {
  /** Początek i koniec brzmienia [s, względem początku ćwiczenia] */
  t0: number;
  t1: number;
  midiFrom: number;
  midiTo: number;
}

export interface Rep {
  index: number;
  /** Przesunięcie względem pierwszej tonacji [półtony]. */
  offset: number;
  startMidi: number;
  /** Dźwięk sygnału (pierwszy dźwięk melodii w tej tonacji). */
  cue: TargetNote;
  singT0: number;
  singT1: number;
  /** Koniec całego powtórzenia (początek następnego sygnału). */
  t1: number;
  notes: TargetNote[];
  cueNotes?: TargetNote[];
  /** Harmonia */
  accomp?: TargetNote[];
}

export interface Timeline {
  beatSec: number;
  demo: TargetNote[];
  /** Harmonia: melodia pianina do pokazu */
  demoAccomp?: TargetNote[];
  demoT1: number;
  reps: Rep[];
  end: number;
  minMidi: number;
  maxMidi: number;
}

export interface TimelineOptions {
  pattern: TrillPattern;
  /** Pierwsza (najniższa) tonacja: dźwięk startowy melodii. */
  startMidi: number;
  tempoFactor: number;
  articulation: Articulation;
  /** Najwyższa tonacja (dźwięk startowy melodii na szczycie) */
  topStartMidi?: number;
  /** Krok między tonacjami [półtony]: 1 – półton, 2 – cały ton. */
  step?: number;
  /** Harmonia */
  harmony?: boolean;
}

/** Przesunięcia kolejnych powtórzeń */
export function repOffsets(n: number, step = 1): number[] {
  const up: number[] = [];
  for (let o = 0; o < n; o += Math.max(1, step)) up.push(o);
  up.push(Math.max(0, n));
  return [...up, ...up.slice(0, -1).reverse()];
}

function layNotes(p: TrillPattern, baseMidi: number, t0: number, beatSec: number, articulation: Articulation, harmony = false): { notes: TargetNote[]; end: number } {
  const separate = articulation === 'separate' && p.allowSeparate;
  const notes: TargetNote[] = [];
  let t = t0;
  p.notes.forEach((n, i) => {
    const dur = n.beats * beatSec;
    const isLast = i === p.notes.length - 1;
    const sound = separate && !isLast ? dur * SEPARATE_SOUND_FRACTION : dur;
    const from = n.step, to = n.glideTo ?? n.step;
    notes.push({ t0: t, t1: t + sound, midiFrom: baseMidi + from + (harmony ? thirdAbove(from) : 0), midiTo: baseMidi + to + (harmony ? thirdAbove(to) : 0) });
    t += dur;
  });
  return { notes, end: t };
}

export function buildTimeline({ pattern, startMidi, tempoFactor, articulation, topStartMidi = startMidi + SEMITONES_UP, step = 1, harmony = false }: TimelineOptions): Timeline {
  const climb = Math.max(0, topStartMidi - startMidi);
  const beatSec = 60 / (pattern.bpm * tempoFactor);
  // pokaz melodii (gra pianino, mikrofon nie ocenia); w harmonii
  const demo = layNotes(pattern, startMidi, 0, beatSec, articulation);
  const demoNotes = harmony ? layNotes(pattern, startMidi, 0, beatSec, articulation, true).notes : demo.notes;
  let t = demo.end + beatSec;

  const reps: Rep[] = repOffsets(climb, step).map((offset, index) => {
    const base = startMidi + offset;
    const first = pattern.notes[0];
    const firstStep = first?.step ?? 0;
    // sygnał
    const cueMidi = base + firstStep + (harmony ? thirdAbove(firstStep) : 0);
    // sygnał: 1 miara ćwierćnuty, potem 1 ćwierćnuta na oddech
    const cue: TargetNote = { t0: t, t1: t + beatSec * 0.85, midiFrom: cueMidi, midiTo: cueMidi };
    const singT0 = t + 2 * beatSec;
    const laid = layNotes(pattern, base, singT0, beatSec, articulation, harmony);
    const lastNote = laid.notes[laid.notes.length - 1];
    const singT1 = lastNote ? lastNote.t1 : laid.end;
    const repEnd = Math.max(laid.end, singT1) + beatSec;
    const rep: Rep = { index, offset, startMidi: cueMidi, cue, singT0, singT1, t1: repEnd, notes: laid.notes };
    if (harmony) rep.accomp = layNotes(pattern, base, singT0, beatSec, articulation).notes;
    t = repEnd;
    return rep;
  });

  const sung = sungRange(pattern, harmony);
  return { beatSec, demo: demoNotes, demoAccomp: harmony ? demo.notes : undefined, demoT1: demo.end, reps, end: t, minMidi: startMidi, maxMidi: startMidi + Math.max(patternSpan(pattern), sung.high) + climb };
}

/** Wszystkie dźwięki, które zagra pianino */
export function playbackEvents(tl: Timeline): { midi: number; t0: number; dur: number }[] {
  const out = tl.demo
    .filter((n) => n.midiFrom === n.midiTo)
    .map((n) => ({ midi: n.midiFrom, t0: n.t0, dur: n.t1 - n.t0 }));
  for (const r of tl.reps) {
    out.push({ midi: r.cue.midiFrom, t0: r.cue.t0, dur: r.cue.t1 - r.cue.t0 });
    for (const n of r.accomp ?? []) if (n.midiFrom === n.midiTo) out.push({ midi: n.midiFrom, t0: n.t0, dur: n.t1 - n.t0 });
  }
  return out;
}

export function targetMidiAt(n: TargetNote, t: number): number {
  const k = n.t1 > n.t0 ? Math.min(1, Math.max(0, (t - n.t0) / (n.t1 - n.t0))) : 0;
  return n.midiFrom + (n.midiTo - n.midiFrom) * k;
}

export function repAt(tl: Timeline, t: number): Rep | null {
  for (const r of tl.reps) if (t >= r.cue.t0 && t < r.t1) return r;
  return null;
}

const SING_LEAD_SEC = 0.1;

/** Okno nagrywania powtórzenia */
export function repWindow(rep: Rep): { from: number; to: number } {
  const lastCue = rep.cueNotes?.[rep.cueNotes.length - 1] ?? rep.cue;
  const from = Math.max(lastCue.t1 + 0.15, rep.singT0 - SING_LEAD_SEC);
  return { from, to: rep.t1 };
}

export function isSingTime(tl: Timeline, t: number): Rep | null {
  const r = repAt(tl, t);
  if (!r) return null;
  const w = repWindow(r);
  return t >= w.from && t <= w.to ? r : null;
}

/** Środek zakresu melodii w powtórzeniu [MIDI] */
export function repCenter(rep: Rep): number {
  const ms = rep.notes.flatMap((n) => [n.midiFrom, n.midiTo]);
  return (Math.min(...ms) + Math.max(...ms)) / 2;
}

export function foldToRep(rep: Rep, rawMidi: number): number {
  const c = repCenter(rep);
  return rawMidi + 12 * Math.round((c - rawMidi) / 12);
}

/** Odległość [ct] od najbliższego dźwięku melodii */
export function nearestNoteCents(rep: Rep, midi: number): number {
  let best = NaN;
  for (const n of rep.notes) {
    const lo = Math.min(n.midiFrom, n.midiTo), hi = Math.max(n.midiFrom, n.midiTo);
    const d = midi < lo ? midi - lo : midi > hi ? midi - hi : 0;
    if (!(Math.abs(d) >= Math.abs(best))) best = d;
  }
  return best * 100;
}

export function noteAt(rep: Rep, t: number): { note: TargetNote; active: boolean } | null {
  let best: TargetNote | null = null;
  let bestD = Infinity;
  for (const n of rep.notes) {
    if (t >= n.t0 && t <= n.t1) return { note: n, active: true };
    const d = t < n.t0 ? n.t0 - t : t - n.t1;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best ? { note: best, active: false } : null;
}

// ---------- Ocena ----------

export interface MelodyFrame {
  t: number;
  midi: number;
  cents: number;
  /** Wysokość zmierzona [MIDI, ułamkowo], bez zawijania oktaw */
  raw?: number;
}

export type NoteStatus = 'hit' | 'off' | 'silent';
export interface NoteScore { status: NoteStatus; medianCents: number }

export const HIT_CENTS = 50;

function lowerBound(frames: MelodyFrame[], t: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((frames[mid]?.t ?? Infinity) < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function median(v: number[]): number {
  const a = v.slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}

/** Ocena jednej nuty */
const GLIDE_TIME_SLACK = 0.2;

function glideDeviation(n: TargetNote, t: number, midi: number): number {
  let best = NaN;
  for (let k = -4; k <= 4; k++) {
    const dev = (midi - targetMidiAt(n, t + (k / 4) * GLIDE_TIME_SLACK)) * 100;
    if (!(Math.abs(dev) >= Math.abs(best))) best = dev;
  }
  return best;
}

export function scoreNote(frames: MelodyFrame[], n: TargetNote): NoteScore {
  const d = n.t1 - n.t0;
  const glide = n.midiFrom !== n.midiTo;
  const a = glide ? n.t0 : n.t0 + Math.max(0.05, 0.3 * d);
  const b = n.t1 - 0.05 * d;
  let all = 0;
  const cents: number[] = [];
  for (let i = lowerBound(frames, a); i < frames.length; i++) {
    const f = frames[i];
    if (!f || f.t > b) break;
    all++;
    if (glide) {
      if (Number.isFinite(f.midi)) cents.push(glideDeviation(n, f.t, f.midi));
    } else if (Number.isFinite(f.cents)) cents.push(f.cents);
  }
  if (all === 0 || cents.length < Math.max(1, 0.4 * all)) return { status: 'silent', medianCents: NaN };
  const m = median(cents);
  return { status: Math.abs(m) <= HIT_CENTS ? 'hit' : 'off', medianCents: m };
}

export interface RepScore {
  rep: Rep;
  notes: NoteScore[];
  hits: number;
  /** Udział czasu z dźwiękiem w obrębie melodii (0–1). */
  voicedFraction: number;
  breaks: number;
}

export interface MelodySummary {
  reps: RepScore[];
  hits: number;
  total: number;
  sung: number;
  meanCents: number;
  voicedFraction: number;
  breaks: number;
  hardest: RepScore | null;
  best: RepScore | null;
}


export interface AlignedNote extends NoteScore {
  t0: number;
  t1: number;
}

export interface RepAlignment {
  notes: AlignedNote[];
  frames: MelodyFrame[];
}

const MAX_FRAME_COST = 3;
const DURATION_PENALTY = 1;
const MOVING_SEMITONES = 0.5;

function median5(v: number[]): number[] {
  return v.map((_, i) => median(v.slice(Math.max(0, i - 2), i + 3)));
}

export function alignRep(frames: MelodyFrame[], rep: Rep): RepAlignment {
  const { from, to } = repWindow(rep);
  const win = frames.filter((f) => f.t >= from && f.t <= to);
  const voiced = win.filter((f) => Number.isFinite(f.raw ?? NaN));
  const K = rep.notes.length;
  const silentNotes = (): AlignedNote[] => rep.notes.map(() => ({ status: 'silent', medianCents: NaN, t0: NaN, t1: NaN }));
  if (voiced.length < Math.max(6, 2 * K)) {
    return { notes: silentNotes(), frames: win.map((f) => ({ t: f.t, midi: NaN, cents: NaN, raw: f.raw })) };
  }

  // jedna oktawa dla całego powtórzenia
  const center = repCenter(rep);
  const shift = 12 * Math.round(median(voiced.map((f) => center - (f.raw as number))) / 12);
  const m = voiced.map((f) => (f.raw as number) + shift);
  const sm = median5(m);
  const N = sm.length;

  const lo = rep.notes.map((n) => Math.min(n.midiFrom, n.midiTo));
  const hi = rep.notes.map((n) => Math.max(n.midiFrom, n.midiTo));
  const cost = (i: number, k: number) => {
    const x = sm[i] as number;
    return Math.min(MAX_FRAME_COST, Math.max(0, (lo[k] as number) - x, x - (hi[k] as number)));
  };
  // sumy prefiksowe kosztów dla każdej nuty
  const P = rep.notes.map((_, k) => {
    const arr = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) arr[i + 1] = (arr[i] as number) + cost(i, k);
    return arr;
  });
  const seg = (k: number, a: number, b: number) => (P[k]?.[b + 1] as number) - (P[k]?.[a] as number);
  const totalDur = rep.notes.reduce((acc, n) => acc + (n.t1 - n.t0), 0);
  const expLen = rep.notes.map((n) => Math.max(1, ((n.t1 - n.t0) / totalDur) * N));
  const pen = (k: number, len: number) => DURATION_PENALTY * Math.log(len / (expLen[k] as number)) ** 2;
  const minLen = N >= 2 * K ? 2 : 1;

  // D[k][i]: najlepszy koszt, gdy nuta k kończy się na ramce i
  const D = rep.notes.map(() => new Float64Array(N).fill(Infinity));
  const B = rep.notes.map(() => new Int32Array(N).fill(-1));
  for (let i = minLen - 1; i < N; i++) (D[0] as Float64Array)[i] = seg(0, 0, i) + pen(0, i + 1);
  for (let k = 1; k < K; k++) {
    const Dk = D[k] as Float64Array, Dp = D[k - 1] as Float64Array, Bk = B[k] as Int32Array;
    for (let i = (k + 1) * minLen - 1; i < N; i++) {
      for (let j = k * minLen - 1; j <= i - minLen; j++) {
        const prev = Dp[j] as number;
        if (prev === Infinity) continue;
        const c = prev + seg(k, j + 1, i) + pen(k, i - j);
        if (c < (Dk[i] as number)) { Dk[i] = c; Bk[i] = j; }
      }
    }
  }
  if (!Number.isFinite((D[K - 1] as Float64Array)[N - 1] as number)) {
    return { notes: silentNotes(), frames: win.map((f) => ({ t: f.t, midi: NaN, cents: NaN, raw: f.raw })) };
  }
  // odtworzenie podziału
  const bounds: [number, number][] = new Array(K);
  let end = N - 1;
  for (let k = K - 1; k >= 0; k--) {
    const start = k === 0 ? 0 : ((B[k] as Int32Array)[end] as number) + 1;
    bounds[k] = [start, end];
    end = start - 1;
  }

  const assigned = new Map<MelodyFrame, number>(); // ramka → odchyłka [ct]
  const dev = (x: number, k: number) => (x < (lo[k] as number) ? x - (lo[k] as number) : x > (hi[k] as number) ? x - (hi[k] as number) : 0) * 100;
  const notes: AlignedNote[] = bounds.map(([a, b], k) => {
    const flat = lo[k] === hi[k];
    const len = b - a + 1;
    const skip = flat && len >= 4 ? Math.floor(len * 0.25) : 0;
    const skipEnd = flat && len >= 8 ? Math.floor(len * 0.1) : 0;
    const devs: number[] = [];
    for (let i = a; i <= b; i++) {
      const moving = Math.abs((m[Math.min(N - 1, i + 1)] as number) - (m[Math.max(0, i - 1)] as number)) > MOVING_SEMITONES;
      assigned.set(voiced[i] as MelodyFrame, moving ? NaN : dev(m[i] as number, k));
      // ocena z wysokości wygładzonej (mediana z 5 ramek)
      if (i >= a + skip && i <= b - skipEnd) devs.push(dev(sm[i] as number, k));
    }
    const med = median(devs);
    return {
      status: Math.abs(med) <= HIT_CENTS ? 'hit' : 'off',
      medianCents: med,
      t0: (voiced[a] as MelodyFrame).t,
      t1: (voiced[b] as MelodyFrame).t
    };
  });

  return {
    notes,
    frames: win.map((f) => {
      const d = assigned.get(f);
      return Number.isFinite(f.raw ?? NaN)
        ? { t: f.t, midi: (f.raw as number) + shift, cents: d ?? NaN, raw: f.raw }
        : { t: f.t, midi: NaN, cents: NaN, raw: f.raw };
    })
  };
}

const MELODY_BREAK_SEC = 0.3;

function continuityRaw(frames: MelodyFrame[], from: number, to: number): { fraction: number; breaks: number } {
  const v = frames.filter((f) => f.t >= from && f.t <= to && Number.isFinite(f.raw ?? NaN));
  if (v.length < 2) return { fraction: 0, breaks: 0 };
  const a = (v[0] as MelodyFrame).t, b = (v[v.length - 1] as MelodyFrame).t;
  let breaks = 0, gapSum = 0;
  for (let i = 1; i < v.length; i++) {
    const gap = (v[i] as MelodyFrame).t - (v[i - 1] as MelodyFrame).t;
    if (gap > MELODY_BREAK_SEC) { breaks++; gapSum += gap; }
  }
  return { fraction: b > a ? Math.max(0, 1 - gapSum / (b - a)) : 0, breaks };
}

export interface MelodySummaryWithFrames extends MelodySummary {
  alignedFrames: MelodyFrame[];
}

export function summarize(frames: MelodyFrame[], tl: Timeline, upTo = Infinity): MelodySummaryWithFrames {
  const alignedFrames: MelodyFrame[] = [];
  const reps: RepScore[] = tl.reps
    .filter((r) => r.singT1 <= upTo)
    .map((rep) => {
      const al = alignRep(frames, rep);
      alignedFrames.push(...al.frames);
      const w = repWindow(rep);
      const c = continuityRaw(frames, w.from, w.to);
      return { rep, notes: al.notes, hits: al.notes.filter((n) => n.status === 'hit').length, voicedFraction: c.fraction, breaks: c.breaks };
    });
  const allNotes = reps.flatMap((r) => r.notes);
  const sungCents = allNotes.filter((n) => n.status !== 'silent').map((n) => n.medianCents);
  const ratio = (r: RepScore) => r.hits / Math.max(1, r.notes.length);
  const sungReps = reps.filter((r) => r.notes.some((n) => n.status !== 'silent'));
  const hardest = sungReps.length ? sungReps.reduce((a, b) => (ratio(b) < ratio(a) ? b : a)) : null;
  const best = sungReps.length ? sungReps.reduce((a, b) => (ratio(b) > ratio(a) ? b : a)) : null;
  alignedFrames.sort((x, y) => x.t - y.t);
  return {
    reps,
    hits: allNotes.filter((n) => n.status === 'hit').length,
    total: allNotes.length,
    sung: sungCents.length,
    meanCents: sungCents.length ? median(sungCents) : NaN,
    voicedFraction: reps.length ? reps.reduce((a, r) => a + r.voicedFraction, 0) / reps.length : 0,
    breaks: reps.reduce((a, r) => a + r.breaks, 0),
    hardest,
    best,
    alignedFrames
  };
}

// ---------- Etap 1: tryl na jednym dźwięku ----------

/** Przerwy krótsze niż tyle sekund nie przerywają trylu */
const ENGINE_GAP_SEC = 0.3;

/** Czy w ramce trwa tryl */
export function soundingFrames(hz: number[], rms: number[]): boolean[] {
  const voicedRms = rms.filter((_, i) => (hz[i] ?? 0) > 0).sort((a, b) => a - b);
  const med = voicedRms[voicedRms.length >> 1] ?? Infinity;
  const thr = Math.max(0.006, med * 0.35);
  return hz.map((h, i) => h > 0 || (rms[i] ?? 0) >= thr);
}

export interface EngineContinuity {
  /** Najdłuższy odcinek trylu bez przerwy [s]. */
  longestSec: number;
  /** Łączny czas z dźwiękiem [s]. */
  voicedSec: number;
  /** Liczba przerw dłuższych niż ENGINE_GAP_SEC. */
  breaks: number;
}

export function engineContinuity(t: number[], voiced: boolean[]): EngineContinuity {
  let longest = 0, voicedSec = 0, breaks = 0;
  let runStart = NaN, lastVoiced = NaN;
  for (let i = 0; i < t.length; i++) {
    const ti = t[i] ?? 0;
    if (!voiced[i]) continue;
    if (Number.isFinite(lastVoiced)) {
      const gap = ti - lastVoiced;
      if (gap > ENGINE_GAP_SEC) {
        breaks++;
        runStart = ti;
      } else voicedSec += gap;
    } else runStart = ti;
    lastVoiced = ti;
    longest = Math.max(longest, ti - runStart);
  }
  return { longestSec: longest, voicedSec, breaks };
}

export function engineFeedback(
  c: EngineContinuity,
  durationSec: number,
  inBandPercent: number,
  bandCents: number
): TrillFeedback {
  if (c.voicedSec < 1) {
    return {
      tone: 'insufficient',
      headline: 'Za mało nagranego dźwięku',
      detail: 'Zamrucz dźwięk trylem zaraz po odliczaniu i postaraj się go utrzymać.',
      rows: []
    };
  }
  const full = c.longestSec >= durationSec - 0.5;
  const tone: TrillFeedback['tone'] = c.longestSec >= 0.9 * durationSec ? 'good' : c.longestSec >= 0.5 * durationSec ? 'ok' : 'work';
  const fmt1 = (x: number) => x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const headline = full ? `Tryl bez przerwy przez całe ${durationSec} s` : `Najdłuższy tryl bez przerwy: ${fmt1(c.longestSec)} s`;

  const hints: string[] = [];
  if (tone === 'good') hints.push('Równy strumień powietrza – wargi drgały przez cały czas.');
  else hints.push('Tryl się przerywał. Rozluźnij wargi i policzki i dmuchaj spokojnie, równym strumieniem.');
  if (inBandPercent < 60) hints.push('Wysokość mocno się zmieniała – trzymaj jeden dźwięk, jak silnik na równych obrotach.');

  return {
    tone,
    headline,
    detail: hints.join(' '),
    rows: [
      { id: 'longest', label: 'najdłuższy tryl', value: `${fmt1(c.longestSec)} s`, comment: 'Bez przerwy w drganiu warg i głosie' },
      { id: 'breaks', label: 'przerwy', value: `${c.breaks}`, comment: c.breaks === 0 ? 'Tryl ani razu się nie urwał' : 'Tyle razy tryl się urwał' },
      { id: 'inband', label: 'czas w zielonym paśmie', value: `${Math.round(inBandPercent)}%`, comment: `Wysokość w granicach ±${bandCents} ct od dźwięku wzorcowego` }
    ]
  };
}

// ---------- Komunikaty ----------

export interface TrillFeedbackRow { id: string; label: string; value: string; comment: string }
export interface TrillFeedback {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  rows: TrillFeedbackRow[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedCents = (c: number) => {
  const r = Math.round(c);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} ct`;
};

/** Tryl albo rozśpiewka */
export type MelodyKind = 'trill' | 'vocal';

export function melodyFeedback(sum: MelodySummary, articulation: Articulation, noteName: (m: number) => string, kind: MelodyKind = 'trill'): TrillFeedback {
  const vocal = kind === 'vocal';
  if (!vocal && articulation === 'separate') return separateTrillFeedback(sum, noteName);
  if (sum.total === 0 || sum.sung < Math.max(3, sum.total * 0.25)) {
    return {
      tone: 'insufficient',
      headline: 'Za mało zaśpiewanych dźwięków',
      detail: vocal
        ? 'Zaśpiewaj melodię zaraz po dźwięku sygnału, w tempie przesuwających się kafelków.'
        : 'Zaśpiewaj melodię trylem zaraz po dźwięku sygnału, w tempie przesuwających się kafelków.',
      rows: []
    };
  }
  const ratio = sum.hits / sum.total;
  const tone: TrillFeedback['tone'] = ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'ok' : 'work';
  const headline = `Trafione dźwięki: ${sum.hits} z ${sum.total}`;

  const hints: string[] = [];
  // tryl służy rozgrzewce i rozluźnieniu
  if (vocal && Number.isFinite(sum.meanCents) && Math.abs(sum.meanCents) > 25) {
    hints.push(sum.meanCents > 0 ? 'Masz tendencję do śpiewania nieco za wysoko.' : 'Masz tendencję do śpiewania nieco za nisko.');
  }
  // czy trudniej było w wyższych tonacjach?
  const maxOffset = Math.max(0, ...sum.reps.map((r) => r.rep.offset));
  const top = sum.reps.filter((r) => r.rep.offset >= maxOffset - 2);
  const low = sum.reps.filter((r) => r.rep.offset <= 2);
  const rate = (rs: RepScore[]) => rs.reduce((a, r) => a + r.hits, 0) / Math.max(1, rs.reduce((a, r) => a + r.notes.length, 0));
  if (top.length && low.length && rate(top) + 0.2 < rate(low)) {
    hints.push('Trudniej było w wyższych tonacjach. Możesz wykonać ćwiczenia na poszerzanie skali, żeby przygotować głos albo zmniejszyć zakres śpiewanych dźwięków.');
  }
  if (articulation === 'legato' && sum.breaks > sum.reps.length) {
    hints.push(vocal
      ? 'Głos często się urywał w trakcie melodii. Zaśpiewaj ją na jednym oddechu, bez przerw między sylabami.'
      : 'Tryl często się przerywał. Postaraj się prowadzić go jednym, równym strumieniem powietrza.');
  }
  if (hints.length === 0) {
    hints.push(tone === 'good'
      ? 'Melodia prowadzona pewnie w kolejnych tonacjach.'
      : 'Spróbuj wolniejszego tempa, a gdy pójdzie lepiej – przyspiesz.');
  }

  const repRatio = (r: RepScore | null) => (r ? r.hits / Math.max(1, r.notes.length) : NaN);
  const allEqual = repRatio(sum.hardest) === repRatio(sum.best);

  const rows: TrillFeedbackRow[] = [
    { id: 'hits', label: 'trafione dźwięki', value: pct(ratio), comment: `Dźwięk trafiony, gdy mieści się w ±${HIT_CENTS} ct od nuty` },
    ...(!vocal ? [] : [{
      id: 'offset',
      label: 'odchylenie od nut',
      value: Number.isFinite(sum.meanCents) ? signedCents(sum.meanCents) : '—',
      comment: !Number.isFinite(sum.meanCents) ? 'Brak odczytu'
        : Math.abs(sum.meanCents) <= 25 ? 'Trafiasz w dźwięki precyzyjnie'
        : sum.meanCents > 0 ? 'Śpiewasz średnio za wysoko' : 'Śpiewasz średnio za nisko'
    }]),
    {
      id: 'hardest',
      label: 'najtrudniejsze powtórzenie',
      value: sum.hardest && !allEqual ? `od ${noteName(sum.hardest.rep.startMidi)}` : 'brak',
      comment: sum.hardest && !allEqual
        ? `Trafione ${sum.hardest.hits} z ${sum.hardest.notes.length} dźwięków`
        : 'Wszystkie powtórzenia wypadły tak samo'
    },
    articulation === 'legato'
      ? {
          id: 'flow',
          label: vocal ? 'ciągłość głosu' : 'ciągłość trylu',
          value: pct(sum.voicedFraction),
          comment: sum.breaks === 0 ? 'Bez przerw w trakcie melodii' : `${vocal ? 'Przerwy w głosie' : 'Przerwy w trylu'}: ${sum.breaks}`
        }
      : {
          id: 'flow',
          label: 'najlepsze powtórzenie',
          value: sum.best && !allEqual ? `od ${noteName(sum.best.rep.startMidi)}` : 'wszystkie',
          comment: sum.best && !allEqual
            ? `Trafione ${sum.best.hits} z ${sum.best.notes.length} dźwięków`
            : `Trafione ${sum.best?.hits ?? 0} z ${sum.best?.notes.length ?? 0} dźwięków w każdym`
        }
  ];

  return { tone, headline, detail: hints.join(' '), rows };
}

/** Tryl oddzielnymi dźwiękami */
function separateTrillFeedback(sum: MelodySummary, noteName: (m: number) => string): TrillFeedback {
  const n = sum.reps.length;
  if (n === 0) {
    return { tone: 'insufficient', headline: 'Wykonane powtórzenia: 0', detail: '', rows: [] };
  }
  const midis = sum.reps.flatMap((r) => r.rep.notes.flatMap((x) => [x.midiFrom, x.midiTo]));
  return {
    tone: 'good',
    headline: `Wykonane powtórzenia: ${n}`,
    detail: `Zakres dźwięków: ${noteName(Math.min(...midis))} – ${noteName(Math.max(...midis))}`,
    rows: []
  };
}
