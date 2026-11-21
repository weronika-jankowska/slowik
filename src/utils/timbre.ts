// Dopasowanie barwy do wzorca sekcji

import { pitchYIN } from './audioMetrics';

/** Środki pasm tercjowych [Hz]. */
export const BAND_CENTERS = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000];
const EDGE = Math.pow(2, 1 / 6);
const FLOOR_DB = -60;

export function bandsFromPower(pow: ArrayLike<number>, binHz: number): number[] {
  const raw = BAND_CENTERS.map((fc) => {
    const a = Math.max(1, Math.floor(fc / EDGE / binHz)), b = Math.min(pow.length - 1, Math.ceil((fc * EDGE) / binHz));
    let s = 0;
    for (let i = a; i <= b; i++) s += pow[i] ?? 0;
    return 10 * Math.log10(Math.max(1e-20, s));
  });
  const max = Math.max(...raw);
  return raw.map((v) => Math.max(FLOOR_DB, v - max));
}

export class PowerAccumulator {
  pow: Float64Array | null = null;
  frames = 0;
  add(db: ArrayLike<number>): void {
    if (!this.pow || this.pow.length !== db.length) { this.pow = new Float64Array(db.length); this.frames = 0; }
    for (let i = 0; i < db.length; i++) this.pow[i] = (this.pow[i] ?? 0) + Math.pow(10, Math.max(-120, db[i] ?? -120) / 10);
    this.frames++;
  }
}

// ---------- Analiza pliku z nagraniem wzorca ----------

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0; re[i] = re[j] ?? 0; re[j] = tr;
      const ti = im[i] ?? 0; im[i] = im[j] ?? 0; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k] ?? 0, ai = im[i + k] ?? 0;
        const br = (re[i + k + half] ?? 0) * cr - (im[i + k + half] ?? 0) * ci;
        const bi = (re[i + k + half] ?? 0) * ci + (im[i + k + half] ?? 0) * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + half] = ar - br; im[i + k + half] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export interface TimbreReference {
  bands: number[];
  /** Mediana f0 wzorca [Hz] */
  f0: number;
  source: 'file' | 'mic';
  label: string;
  savedAt: string;
}

/** Widmo pasmowe i mediana f0 z zdekodowanego nagrania (mono). */
export function analyzeSamples(x: Float32Array, sampleRate: number): { bands: number[]; f0: number } | null {
  const N = 4096, hop = 2048;
  if (x.length < N) return null;
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const rmsList: number[] = [];
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += (x[s + i] ?? 0) ** 2;
    rmsList.push(Math.sqrt(e / N));
  }
  const gate = Math.max(...rmsList) * 0.2; // tylko fragmenty ze śpiewem
  const pow = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  const f0s: number[] = [];
  let used = 0;
  rmsList.forEach((r, k) => {
    if (r < gate) return;
    const s = k * hop;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] ?? 0) * (win[i] ?? 0); im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) pow[i] = (pow[i] ?? 0) + (re[i] ?? 0) ** 2 + (im[i] ?? 0) ** 2;
    used++;
    if (k % 4 === 0) {
      const f = pitchYIN(x.subarray(s, s + 2048), sampleRate, 0.15);
      if (f >= 50 && f <= 1100) f0s.push(f);
    }
  });
  if (used < 5) return null;
  f0s.sort((a, b) => a - b);
  return { bands: bandsFromPower(pow, sampleRate / N), f0: f0s[f0s.length >> 1] ?? NaN };
}

export async function analyzeFile(file: File): Promise<{ bands: number[]; f0: number } | null> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const ch0 = buf.getChannelData(0);
    let mono = ch0;
    if (buf.numberOfChannels > 1) {
      const ch1 = buf.getChannelData(1);
      mono = new Float32Array(ch0.length).map((_, i) => ((ch0[i] ?? 0) + (ch1[i] ?? 0)) / 2);
    }
    return analyzeSamples(mono, buf.sampleRate);
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}


export type Section = 'S' | 'A' | 'T' | 'B';
export const SECTION_LABEL: Record<Section, string> = { S: 'soprany', A: 'alty', T: 'tenory', B: 'basy' };
const LS_KEY = 'timbre_section_references';

export function loadReferences(): Partial<Record<Section, TimbreReference>> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Partial<Record<Section, TimbreReference>>; } catch { return {}; }
}

export function saveReference(section: Section, ref: TimbreReference): void {
  try {
    const all = loadReferences();
    all[section] = ref;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* brak localStorage */ }
}

// ---------- Porównanie i komunikaty ----------

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const range = (lo: number, hi: number) => BAND_CENTERS.map((fc, i) => (fc >= lo && fc <= hi ? i : -1)).filter((i) => i >= 0);
export const REGIONS = { low: range(125, 500), mid: range(630, 1600), high: range(2000, 5000) };

export interface TimbreComparison {
  /** Średnia bezwzględna różnica pasm [dB]. */
  distanceDb: number;
  /** Podobieństwo 0–100 % (100 % = identyczne widma). */
  similarity: number;
  low: number;
  mid: number;
  high: number;
}

export function compareTimbre(user: number[], ref: number[]): TimbreComparison {
  const d = user.map((u, i) => u - (ref[i] ?? FLOOR_DB));
  const distanceDb = avg(d.map(Math.abs));
  const region = (idx: number[]) => avg(idx.map((i) => d[i] ?? 0));
  return {
    distanceDb,
    similarity: Math.max(0, Math.min(100, Math.round(100 - 8 * distanceDb))),
    low: region(REGIONS.low),
    mid: region(REGIONS.mid),
    high: region(REGIONS.high)
  };
}

const sd = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} dB`;

export function timbreFeedback(c: TimbreComparison, sectionLabel: string) {
  const tone: 'good' | 'ok' | 'work' = c.distanceDb < 3 ? 'good' : c.distanceDb < 6 ? 'ok' : 'work';
  const hints: string[] = [];
  if (c.high < -3) hints.push('Masz mniej „blasku” (2–5 kHz) niż wzorzec – spróbuj bardziej skupionego, dźwięcznego brzmienia.');
  if (c.high > 3) hints.push('Twoja barwa jest jaśniejsza i ostrzejsza od wzorca – spróbuj bardziej okrągłego dźwięku z większą przestrzenią w ustach.');
  if (c.low > 3) hints.push('Masz więcej niskich składowych – barwa jest ciemniejsza, „głębsza” niż we wzorcu.');
  if (c.low < -3) hints.push('Masz mniej niskich składowych – barwa jest lżejsza, „cieńsza” niż we wzorcu.');
  if (hints.length === 0) hints.push(tone === 'good' ? 'Barwa dobrze wtapia się we wzorzec sekcji.' : 'Różnice są rozłożone po całym paśmie – spróbuj tej samej samogłoski i wysokości co we wzorcu.');
  const regionComment = (x: number) => (Math.abs(x) <= 3 ? 'Jak we wzorcu' : x > 0 ? 'Więcej niż we wzorcu' : 'Mniej niż we wzorcu');
  return {
    tone,
    headline: `Podobieństwo barwy do wzorca (${sectionLabel}): ${c.similarity}%`,
    detail: hints.join(' '),
    rows: [
      { id: 'sim', label: 'podobieństwo', value: `${c.similarity}%`, comment: `Średnia różnica widm: ${c.distanceDb.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} dB` },
      { id: 'low', label: 'niskie (do 500 Hz)', value: sd(c.low), comment: regionComment(c.low) },
      { id: 'mid', label: 'środek (0,6–1,6 kHz)', value: sd(c.mid), comment: regionComment(c.mid) },
      { id: 'high', label: 'blask (2–5 kHz)', value: sd(c.high), comment: regionComment(c.high) }
    ]
  };
}
