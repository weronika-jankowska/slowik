// Zbieranie próbek do kalibracji oceny powietrza w głosie (ukryte okno „Próbki głosu”).
// Nagrania [a] na kolejnych wysokościach w wariantach: normalnie / z powietrzem / ściśnięte
// gardło / falset. Pliki WAV i wyniki pomiarów (JSON) zapisuje serwer deweloperski Vite
// do folderu audio-breathiness w katalogu projektu (vite.config.ts → samplesPlugin).
//
// Pomiar nagrania odtwarza dokładnie sposób liczenia w aplikacji (analiza głosu, ćwiczenie
// „Powietrze w głosie”): bufory 4096 próbek co 1/60 s, RMS ≥ 0,015, f0 z YIN, co 4. dźwięczna
// ramka, mediany bez pierwszych 0,5 s.

import { calculateCPPS, calculateRMS, pitchYIN } from './audioMetrics';
import { getCalibratedMidiFreq } from './noteUtils';
import {
  CPPS_OPTIONS,
  ONSET_SKIP_SEC,
  breathLevel,
  breathinessIndex,
  harmonicFeatures,
  measureBreathFrame,
  type BreathLevel
} from './breathiness';

// ---------- Plan nagrań ----------

export type LabVariant = 'normalnie' | 'powietrze' | 'sciskane' | 'falset';

export const VARIANTS: { id: LabVariant; label: string; hint: string }[] = [
  { id: 'normalnie', label: 'normalnie', hint: 'Swobodnie, dźwięcznie, tak jak zwykle śpiewasz.' },
  { id: 'powietrze', label: 'z powietrzem', hint: 'Z wyraźnie słyszalnym powietrzem – jak głośny szept na dźwięku, przy tej samej wysokości.' },
  { id: 'sciskane', label: 'ściśnięte gardło', hint: 'Z napiętym, ściśniętym gardłem – twardo i „pod ciśnieniem”, bez powietrza.' },
  { id: 'falset', label: 'falset', hint: 'Falsetem (głosem głowowym), swobodnie, bez celowego dodawania powietrza.' }
];

export const variantLabel = (v: LabVariant) => VARIANTS.find((x) => x.id === v)?.label ?? v;

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Nazwa nuty bez znaków specjalnych (do nazw plików): 60 → C4, 61 → Db4. */
export const noteId = (midi: number) => `${FLAT_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export interface PlanItem {
  midi: number;
  variant: LabVariant;
  rep: number;
  /** Nazwa pliku bez rozszerzenia, np. a_C4_powietrze_1. */
  name: string;
}

export interface LabPlanSettings {
  lowMidi: number;
  highMidi: number;
  step: number;
  reps: number;
  withFalsetto: boolean;
  falsettoFromMidi: number;
}

export const itemName = (midi: number, variant: LabVariant, rep: number) => `a_${noteId(midi)}_${variant}_${rep}`;

/**
 * Kolejność: dźwięki od najniższego; na każdym dźwięku najpierw wszystkie warianty w powtórzeniu 1,
 * potem w powtórzeniu 2 itd. (powtórzenia nie następują bezpośrednio po sobie).
 */
export function buildPlan(s: LabPlanSettings): PlanItem[] {
  const items: PlanItem[] = [];
  for (let m = s.lowMidi; m <= s.highMidi; m += s.step) {
    const variants: LabVariant[] = ['normalnie', 'powietrze', 'sciskane'];
    if (s.withFalsetto && m >= s.falsettoFromMidi) variants.push('falset');
    for (let r = 1; r <= s.reps; r++) for (const v of variants) items.push({ midi: m, variant: v, rep: r, name: itemName(m, v, r) });
  }
  return items;
}

// ---------- Pomiar nagrania ----------

export interface TakeMeasures {
  /** Mediana f0 z ramek pomiarowych [Hz]. */
  f0Hz: number;
  /** Odchyłka od dźwięku wzorcowego [centy]. */
  centsOff: number;
  /** Poziom dźwięcznej części nagrania [dBFS]. */
  levelDbfs: number;
  /** Czas dźwięcznej części nagrania [s]. */
  voicedSec: number;
  /** Liczba ramek pomiarowych (po pominięciu początku). */
  frames: number;
  /** Mediany z ramek – tak jak w aplikacji. */
  cppsDb: number;
  tiltDbOct: number;
  h1h2Db: number;
  h1a3Db: number;
  hnrDb: number;
  /** CPPS z całej dźwięcznej części nagrania (jak „Get CPPS” w Praat) – do porównań z literaturą. */
  cppsWholeDb: number;
  /** Wskaźnik powietrza i ocena według kryterium obowiązującego w chwili nagrania. */
  index: number;
  level: BreathLevel | null;
}

const median = (a: number[]): number => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

const FRAME = 4096;
const MIN_RMS = 0.015;
const EVERY_NTH = 4;

export function analyzeTake(x: Float32Array, sampleRate: number, targetMidi: number): TakeMeasures {
  const hop = Math.round(sampleRate / 60);
  const rows: { t: number; f0: number; cpps: number; tilt: number; h1h2: number; h1a3: number; hnr: number }[] = [];
  let voiced = 0, firstVoiced = -1, lastVoiced = -1, energy = 0, energyN = 0;
  for (let end = FRAME; end <= x.length; end += hop) {
    const buf = x.subarray(end - FRAME, end);
    if (calculateRMS(buf) < MIN_RMS) continue;
    const f0 = pitchYIN(buf, sampleRate, 0.15);
    if (!(f0 >= 50 && f0 <= 1100)) continue;
    voiced++;
    if (firstVoiced < 0) firstVoiced = end;
    lastVoiced = end;
    if (voiced % EVERY_NTH !== 0) continue;
    const t = end / sampleRate;
    const b = measureBreathFrame(buf, sampleRate, f0, t);
    const h = harmonicFeatures(buf, sampleRate, f0);
    rows.push({ t, f0, cpps: b.cppsDb, tilt: h.tiltDbOct, h1h2: h.h1h2Db, h1a3: h.h1a3Db, hnr: b.hnrDb });
  }
  // poziom i CPPS z całej dźwięcznej części
  let whole = NaN, voicedSec = 0;
  if (firstVoiced >= 0) {
    const seg = x.subarray(Math.max(0, firstVoiced - FRAME), lastVoiced);
    for (let i = 0; i < seg.length; i++) { energy += (seg[i] ?? 0) ** 2; energyN++; }
    voicedSec = seg.length / sampleRate;
    whole = calculateCPPS(seg, sampleRate, CPPS_OPTIONS).cppsDb;
  }
  const t0 = rows[0]?.t ?? 0;
  const sel = rows.filter((r) => r.t >= t0 + ONSET_SKIP_SEC);
  const f0Hz = median(sel.map((r) => r.f0));
  const cppsDb = median(sel.map((r) => r.cpps));
  const tiltDbOct = median(sel.map((r) => r.tilt));
  const hnrDb = median(sel.map((r) => r.hnr));
  const index = sel.length >= 6 ? breathinessIndex(cppsDb, hnrDb, f0Hz) : NaN;
  return {
    f0Hz,
    centsOff: 1200 * Math.log2(f0Hz / getCalibratedMidiFreq(targetMidi)),
    levelDbfs: energyN ? 10 * Math.log10(energy / energyN + 1e-12) : NaN,
    voicedSec,
    frames: sel.length,
    cppsDb,
    tiltDbOct,
    h1h2Db: median(sel.map((r) => r.h1h2)),
    h1a3Db: median(sel.map((r) => r.h1a3)),
    hnrDb,
    cppsWholeDb: whole,
    index,
    level: breathLevel(index)
  };
}

// ---------- Zapis ----------

/** WAV 16-bit PCM mono. */
export function encodeWav(x: Float32Array, sampleRate: number): Blob {
  const n = x.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, x[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export interface TakeRecord {
  name: string;
  midi: number;
  note: string;
  targetHz: number;
  variant: LabVariant;
  rep: number;
  sampleRate: number;
  durationSec: number;
  recordedAt: string;
  measures: TakeMeasures;
  /** Ocena na słuch (0 – brak powietrza … 3 – bardzo dużo), null – jeszcze nie oceniono. */
  rating: number | null;
}

const API = '/__samples';

export async function samplesAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/list`);
    return r.ok && (r.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

export async function listTakes(): Promise<TakeRecord[]> {
  const r = await fetch(`${API}/list`);
  if (!r.ok) throw new Error(`Błąd listy próbek (${r.status})`);
  return (await r.json()) as TakeRecord[];
}

async function put(file: string, body: Blob | string, type: string): Promise<void> {
  const r = await fetch(`${API}/file/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'Content-Type': type }, body });
  if (!r.ok) throw new Error(`Nie udało się zapisać ${file} (${r.status})`);
}

export async function saveTake(rec: TakeRecord, wav: Blob): Promise<void> {
  await put(`${rec.name}.wav`, wav, 'audio/wav');
  await saveRecord(rec);
}

export async function saveRecord(rec: TakeRecord): Promise<void> {
  // NaN nie jest poprawnym JSON-em – zapisujemy jako null
  await put(`${rec.name}.json`, JSON.stringify(rec, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2), 'application/json');
}

export const audioUrl = (rec: TakeRecord) => `${API}/file/${encodeURIComponent(rec.name)}.wav?v=${encodeURIComponent(rec.recordedAt)}`;

// ---------- Dostęp ----------

/** SHA-256 hasła (w kodzie nie ma samego hasła). */
const PASSWORD_SHA256 = 'ef07c6f5afaf5d33dbb4d76e61681ae9f81852e0eb3be5497160ab8f4f3e79c3';

export async function checkPassword(pw: string): Promise<boolean> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex === PASSWORD_SHA256;
}
