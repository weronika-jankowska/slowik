// Analiza stabilności intonacji

export interface PitchFrame {
  t: number;          // czas środka ramki [s]
  f0: number | null;  // [Hz] lub null, gdy brak dźwięku
}

export interface StabilityOptions {
  targetHz: number;
  toleranceCents?: number;   // szerokość połowy pasma, domyślnie ±20 c
  skipOnsetSec?: number;     // pominięcie ataku dźwięku, domyślnie 0.3 s
  smoothingSec?: number;     // długość pojedynczego okna średniej ruchomej, domyślnie 0.2 s
  octaveInvariant?: boolean; // dźwięk o oktawę niżej/wyżej liczony względem tej samej nuty
  minVoicedSec?: number;     // minimalny czas dźwięczny, by wynik miał sens
}

export interface AnalyzedFrame {
  t: number;
  rawCents: number | null; // surowa odchyłka (z wibratem) – tylko do wykresu
  cents: number | null;    // wysokość środkowa (wygładzona)
  analyzed: boolean;      // czy ramka wchodzi do statystyk (dźwięczna i po ataku)
  inTolerance: boolean;
}

export interface StabilityResult {
  frames: AnalyzedFrame[];
  toleranceCents: number;
  analyzedSec: number;
  inTolerancePercent: number; // % czasu analizowanego w paśmie
  meanCents: number;          // średnie odchylenie (znak: + za wysoko, − za nisko)
  meanAbsCents: number;       // średni błąd intonacji
  sdCents: number;            // rozrzut wokół własnej średniej = stabilność
  longestInToleranceSec: number;
  sufficient: boolean;
}

const toCents = (f0: number, ref: number) => 1200 * Math.log2(f0 / ref);
const wrapOctave = (c: number) => c - 1200 * Math.round(c / 1200);

function boxSmooth(x: (number | null)[], half: number): (number | null)[] {
  const out: (number | null)[] = x.slice();
  let i = 0;
  while (i < x.length) {
    if (x[i] === null) { i++; continue; }
    let end = i;
    while (end < x.length && x[end] !== null) end++;
    const prefix = [0];
    for (let k = i; k < end; k++) prefix.push(prefix[prefix.length - 1] + x[k]!);
    for (let k = i; k < end; k++) {
      const a = Math.max(i, k - half), b = Math.min(end - 1, k + half);
      out[k] = (prefix[b - i + 1] - prefix[a - i]) / (b - a + 1);
    }
    i = end;
  }
  return out;
}

function frameStep(frames: PitchFrame[]): number {
  const d = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : 0;
}

export function analyzeIntonationStability(
  input: PitchFrame[],
  {
    targetHz,
    toleranceCents = 20,
    skipOnsetSec = 0.3,
    smoothingSec = 0.2,
    octaveInvariant = true,
    minVoicedSec = 1.0,
  }: StabilityOptions,
): StabilityResult {
  const dt = frameStep(input);

  // 1. Hz -> centy względem celu
  const raw = input.map((f) =>
    f.f0 && f.f0 > 0
      ? (octaveInvariant ? wrapOctave(toCents(f.f0, targetHz)) : toCents(f.f0, targetHz))
      : null,
  );

  // 2. Wysokość środkowa
  let cents = raw;
  if (smoothingSec > 0 && dt > 0) {
    const half = Math.max(1, Math.round(smoothingSec / dt / 2));
    cents = boxSmooth(boxSmooth(raw, half), half);
  }

  // 3. Pominięcie ataku: od pierwszej ramki dźwięcznej
  const firstVoiced = input.find((_, i) => cents[i] !== null);
  const startT = firstVoiced ? firstVoiced.t + skipOnsetSec : Infinity;

  const frames: AnalyzedFrame[] = input.map((f, i) => {
    const c = cents[i];
    const analyzed = c !== null && f.t >= startT;
    return { t: f.t, rawCents: raw[i], cents: c, analyzed, inTolerance: analyzed && Math.abs(c!) <= toleranceCents };
  });

  // 4. Statystyki
  const vals = frames.filter((f) => f.analyzed).map((f) => f.cents!);
  const n = vals.length;
  const inTol = frames.filter((f) => f.inTolerance).length;
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;

  let run = 0, best = 0;
  for (const f of frames) {
    if (f.inTolerance) { run++; best = Math.max(best, run); }
    else if (f.analyzed || f.t >= startT) run = 0; // wyjście z pasma lub przerwa w dźwięku zrywa serię
  }

  return {
    frames,
    toleranceCents,
    analyzedSec: n * dt,
    inTolerancePercent: n ? (100 * inTol) / n : 0,
    meanCents: mean,
    meanAbsCents: n ? vals.reduce((a, v) => a + Math.abs(v), 0) / n : NaN,
    sdCents: sd,
    longestInToleranceSec: best * dt,
    sufficient: n * dt >= minVoicedSec,
  };
}

// ---------- Komunikaty dla użytkownika ----------

const fmt = (x: number, digits = 1) =>
  x.toLocaleString('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export interface FeedbackLine { id: string; label: string; value: string; comment: string }

export interface StabilityFeedback {
  tone: 'good' | 'ok' | 'work' | 'insufficient';
  headline: string;
  detail: string;
  rows: FeedbackLine[];
}


/** Do tylu centów średniego błędu intonacja jest czysta. */
export const CLEAN_ERROR_CENTS = 20;
/** Powyżej tylu centów średni błąd jest wyraźny („do poprawy”). */
export const NEAR_ERROR_CENTS = 35;

const errorDirection = (meanSigned: number) => (meanSigned > 10 ? 'za wysoko' : meanSigned < -10 ? 'za nisko' : '');

/** Kafelek wyniku „średni błąd intonacji”. */
export function intonationErrorTile(id: string, meanAbs: number, meanSigned: number): { id: string; label: string; value: string; comment: string } {
  const dir = errorDirection(meanSigned);
  const comment = !Number.isFinite(meanAbs) ? 'Brak odczytu'
    : meanAbs <= CLEAN_ERROR_CENTS ? 'Czysta intonacja'
    : meanAbs <= NEAR_ERROR_CENTS ? `Blisko dźwięku wzorcowego${dir ? `, średnio ${dir}` : ''}`
    : `Do poprawy${dir ? ` – średnio ${dir}` : ''}`;
  return { id, label: 'średni błąd intonacji', value: Number.isFinite(meanAbs) ? `${Math.round(meanAbs)} ct` : '—', comment };
}

/** Zdanie do opisu wyniku (puste, gdy intonacja jest czysta). */
export function intonationErrorSentence(meanAbs: number, meanSigned: number, needsWork = 'musisz popracować nad intonacją'): string {
  if (!Number.isFinite(meanAbs) || meanAbs <= CLEAN_ERROR_CENTS) return '';
  const n = Math.round(meanAbs);
  const dir = errorDirection(meanSigned);
  if (meanAbs <= NEAR_ERROR_CENTS) return `Średni błąd intonacji to ${n} ct – blisko dźwięku wzorcowego, ale warto go jeszcze zmniejszyć.`;
  return `Średni błąd intonacji to ${n} ct – ${needsWork}.${dir ? ` Dźwięk był średnio ${dir}.` : ''} Przed startem posłuchaj dźwięku wzorcowego jeszcze raz.`;
}

export function stabilityFeedback(r: StabilityResult): StabilityFeedback {
  if (!r.sufficient) {
    return {
      tone: 'insufficient',
      headline: 'Za mało nagranego dźwięku',
      detail: 'Zaśpiewaj ponownie i trzymaj dźwięk przez cały czas nagrania.',
      rows: [],
    };
  }

  const p = Math.round(r.inTolerancePercent);
  const tol = r.toleranceCents;
  const headline = `Udało Ci się przez ${p}% czasu trzymać dźwięk w tolerancji ±${tol} centów`;

  const byTime: StabilityFeedback['tone'] = p >= 80 ? 'good' : p >= 50 ? 'ok' : 'work';
  const tone: StabilityFeedback['tone'] = byTime === 'good' && r.meanAbsCents > NEAR_ERROR_CENTS ? 'ok' : byTime;
  const detail = [
    byTime === 'good' ? 'Dźwięk trzymany stabilnie.'
    : byTime === 'ok' ? 'Dźwięk w większości stabilny. Pracuj nad utrzymaniem go do samego końca.'
    : 'Dźwięk często wychodzi poza zielone pole. Pracuj nad jego stabilnością.',
    intonationErrorSentence(r.meanAbsCents, r.meanCents)
  ].filter(Boolean).join(' ');

  const sdComment =
    r.sdCents <= tol / 2 ? 'Wysokość jest stabilna'
    : r.sdCents <= tol ? 'Wysokość jest lekko niestabilna'
    : 'Wysokość jest wyraźnie niestabilna w trakcie trzymania dźwięku';

  return {
    tone,
    headline,
    detail,
    rows: [
      { id: 'inband', label: 'czas w zielonym paśmie', value: `${p}%`, comment: `Tyle czasu dźwięk mieścił się w tolerancji ±${tol} ct` },
      intonationErrorTile('offset', r.meanAbsCents, r.meanCents),
      { id: 'spread', label: 'rozrzut wysokości', value: `±${fmt(r.sdCents, 0)} ct`, comment: sdComment },
      { id: 'longest', label: 'najdłuższy odcinek', value: `${fmt(r.longestInToleranceSec)} s`, comment: 'Najdłużej utrzymany bez wyjścia z zielonego pola' },
    ],
  };
}