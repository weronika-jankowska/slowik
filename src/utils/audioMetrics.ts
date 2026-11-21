export interface VibratoAnalysisResult {
  rateHz: number;
  extentCents: number;
  extentSemitones: number;
  onsetDelaySec: number;
  sinusoidality: number;
  hasVibrato: boolean;
}

export interface CPPResult {
  cppDb: number;
  f0CepstralHz: number;
  quefrencySec: number;
}

export interface AcousticMetricsState {
  f0: number;
  rms: number;
  rmsDbfs: number;
  maeCents: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  cppDb: number;
  spectralNoiseDb: number;
  spectralCentroidHz: number;
  spectralRolloffHz: number;
  singerFormantEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  vibrato: VibratoAnalysisResult;
  /** Powietrze w głosie (utils/breathiness.ts) */
  breathCppsDb?: number;
  breathHnrDb?: number;
  /** Nachylenie widma */
  breathTiltDbOct?: number;
  breathModel?: number;
  breathIndex?: number;
  breathLevel?: 'none' | 'moderate' | 'clear' | null;
}

export interface MPFRResult {
  f0MinHz: number;
  f0MaxHz: number;
  f0MinMidi: number;
  f0MaxMidi: number;
  f0MinNoteName: string;
  f0MaxNoteName: string;
  mpfrSemitones: number;
  mpfrOctaves: number;
}

const MIN_PERIOD_S = 0.0001;
const MAX_PERIOD_S = 0.02;
const MAX_PERIOD_FACTOR = 1.3;
const MAX_AMPLITUDE_FACTOR = 1.6;

export function isValidMetric(v: number): boolean {
  return Number.isFinite(v);
}

export function medianOfValid(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? (v[mid] ?? NaN) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

export function formatMetric(v: number, digits = 1, fallback = '—'): string {
  return Number.isFinite(v) ? v.toFixed(digits) : fallback;
}

function parabolicVertex(y1: number, y2: number, y3: number): { offset: number; value: number } {
  const denom = y1 - 2 * y2 + y3;
  if (Math.abs(denom) < 1e-15) return { offset: 0, value: y2 };
  const offset = Math.max(-1, Math.min(1, (0.5 * (y1 - y3)) / denom));
  return { offset, value: y2 - 0.25 * (y1 - y3) * offset };
}

function cubicAt(x: ArrayLike<number>, pos: number): number {
  const i = Math.floor(pos);
  const f = pos - i;
  const p0 = x[i - 1] ?? 0;
  const p1 = x[i] ?? 0;
  const p2 = x[i + 1] ?? 0;
  const p3 = x[i + 2] ?? 0;
  return (
    p1 +
    0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
  );
}

function fftRadix2(re: Float64Array, im: Float64Array, invert = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j] ?? 0;
        const uIm = im[i + j] ?? 0;
        const vRe = (re[i + j + half] ?? 0) * wRe - (im[i + j + half] ?? 0) * wIm;
        const vIm = (re[i + j + half] ?? 0) * wIm + (im[i + j + half] ?? 0) * wRe;

        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

export function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

/** YIN z miarą pewności */
export function pitchYINConfidence(
  buffer: Float32Array,
  sampleRate: number,
  threshold = 0.15
): { f0: number; aperiodicity: number; clear: boolean } {
  const none = { f0: -1, aperiodicity: 1, clear: false };
  const bufferSize = Math.floor(buffer.length / 2);
  if (bufferSize < 4) return none;
  const yinBuffer = new Float64Array(bufferSize);

  for (let t = 0; t < bufferSize; t++) {
    let sum = 0;
    for (let i = 0; i < bufferSize; i++) {
      const delta = (buffer[i] ?? 0) - (buffer[i + t] ?? 0);
      sum += delta * delta;
    }
    yinBuffer[t] = sum;
  }

  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let t = 1; t < bufferSize; t++) {
    runningSum += yinBuffer[t] ?? 0;
    yinBuffer[t] = runningSum === 0 ? 1 : ((yinBuffer[t] ?? 0) * t) / runningSum;
  }

  let tau = -1;
  let clear = false;
  for (let t = 2; t < bufferSize; t++) {
    if ((yinBuffer[t] ?? 1) < threshold) {
      clear = true;
      while (t + 1 < bufferSize && (yinBuffer[t + 1] ?? 1) < (yinBuffer[t] ?? 1)) {
        t++;
      }
      tau = t;
      break;
    }
  }

  if (tau === -1) {
    let globalMin = Infinity;
    for (let t = 2; t < bufferSize; t++) {
      const val = yinBuffer[t] ?? 1;
      if (val < globalMin) {
        globalMin = val;
        tau = t;
      }
    }
    if (globalMin > 0.5 || tau <= 0) return none;
  }

  let betterTau = tau;
  if (tau > 0 && tau < bufferSize - 1) {
    betterTau =
      tau + parabolicVertex(yinBuffer[tau - 1] ?? 0, yinBuffer[tau] ?? 0, yinBuffer[tau + 1] ?? 0).offset;
  }

  const aperiodicity = yinBuffer[tau] ?? 1;
  return betterTau > 0 ? { f0: sampleRate / betterTau, aperiodicity, clear } : none;
}

export function pitchYIN(buffer: Float32Array, sampleRate: number, threshold = 0.15): number {
  return pitchYINConfidence(buffer, sampleRate, threshold).f0;
}

export function extractGlottalCycles(
  buffer: Float32Array,
  sampleRate: number,
  f0Est: number
): { periods: number[]; peakAmplitudes: number[] } {
  const empty = { periods: [] as number[], peakAmplitudes: [] as number[] };
  if (!(f0Est >= 50 && f0Est <= 1200) || buffer.length < 32 || !(sampleRate > 0)) return empty;

  const N = buffer.length;
  const x = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buffer[i] ?? 0;
  mean /= N;
  let energy = 0;
  for (let i = 0; i < N; i++) {
    const v = (buffer[i] ?? 0) - mean;
    x[i] = v;
    energy += v * v;
  }
  if (energy / N < 1e-10) return empty;

  const T0 = sampleRate / f0Est;
  const Wh = Math.max(4, Math.floor(T0 / 2));
  const M = 2 * Wh + 1;
  const sMin = Math.max(2, Math.floor(0.75 * T0), Math.ceil(MIN_PERIOD_S * sampleRate));
  const sMax = Math.min(Math.ceil(1.33 * T0), Math.floor(MAX_PERIOD_S * sampleRate));
  if (sMax - sMin < 4) return empty;
  const Ly = M + sMax + 3;

  const startLo = Wh + 3;
  const startHi = Math.min(N - 2, startLo + Math.ceil(T0));
  let iMax = startLo;
  let vMax0 = -Infinity;
  for (let i = startLo; i <= startHi; i++) {
    const v = x[i] ?? 0;
    if (v > vMax0) {
      vMax0 = v;
      iMax = i;
    }
  }
  if (!(vMax0 > 0)) return empty;
  let t = iMax + parabolicVertex(x[iMax - 1] ?? 0, x[iMax] ?? 0, x[iMax + 1] ?? 0).offset;

  const MIN_NCC = 0.5;
  const periods: number[] = [];
  const amps: number[] = [];
  let prevS = -1;
  const y = new Float64Array(Ly);
  const cs = new Float64Array(Ly + 1);
  const r = new Float64Array(sMax + 3);

  for (;;) {
    const base = t - Wh;
    if (base < 2 || base + Ly + 2 > N - 1) break;

    for (let j = 0; j < Ly; j++) {
      y[j] = cubicAt(x, base + j);
      cs[j + 1] = (cs[j] ?? 0) + (y[j] ?? 0) * (y[j] ?? 0);
    }
    const eRef = cs[M] ?? 0;
    if (eRef < 1e-18) break;

    let bestS = -1;
    let bestR = -Infinity;
    for (let s = sMin - 1; s <= sMax + 1; s++) {
      let dot = 0;
      for (let j = 0; j < M; j++) dot += (y[j] ?? 0) * (y[s + j] ?? 0);
      const eC = (cs[s + M] ?? 0) - (cs[s] ?? 0);
      const den = Math.sqrt(eRef * eC);
      const val = den > 1e-18 ? dot / den : 0;
      r[s] = val;
      if (s >= sMin && s <= sMax && val > bestR) {
        bestR = val;
        bestS = s;
      }
    }

    if (bestS <= sMin || bestS >= sMax || bestR < MIN_NCC) break;

    let sEst = bestS + parabolicVertex(r[bestS - 1] ?? 0, r[bestS] ?? 0, r[bestS + 1] ?? 0).offset;

    const nccAt = (s: number): number => {
      let dot = 0;
      let eC = 0;
      for (let j = 0; j < M; j++) {
        const c = cubicAt(y, s + j);
        dot += (y[j] ?? 0) * c;
        eC += c * c;
      }
      const den = Math.sqrt(eRef * eC);
      return den > 1e-18 ? dot / den : 0;
    };
    const h = 0.25;
    sEst += h * parabolicVertex(nccAt(sEst - h), nccAt(sEst), nccAt(sEst + h)).offset;

    const widthLeft = 0.2 * (prevS > 0 ? prevS : sEst);
    const widthRight = 0.2 * sEst;
    let sumSq = 0;
    let winSumSq = 0;
    const kLo = Math.max(0, Math.ceil(t - widthLeft));
    const kHi = Math.min(N - 1, Math.floor(t + widthRight));
    for (let k = kLo; k <= kHi; k++) {
      const dtSamp = k - t;
      const width = dtSamp < 0 ? widthLeft : widthRight;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * dtSamp) / width);
      const v = (x[k] ?? 0) * w;
      sumSq += v * v;
      winSumSq += w * w;
    }
    const cycleAmp = winSumSq > 0 ? Math.sqrt(sumSq / winSumSq) : 0;
    prevS = sEst;

    periods.push(sEst / sampleRate);
    amps.push(cycleAmp);

    t += sEst;
    const targetIdx = Math.round(t);
    if (targetIdx > 1 && targetIdx < N - 2) {
      const shift = parabolicVertex(x[targetIdx - 1] ?? 0, x[targetIdx] ?? 0, x[targetIdx + 1] ?? 0).offset;
      t = targetIdx + shift;
    }
  }

  return { periods, peakAmplitudes: amps };
}

export function calculateJitterShimmerCycleToCycle(
  periods: number[],
  amplitudes: number[]
): { jitterPercent: number; shimmerDb: number; jitterAbsoluteSec?: number } {
  const none = { jitterPercent: NaN, shimmerDb: NaN };
  const N = periods.length;
  if (N < 4 || amplitudes.length < 4) return none;

  const validPeriod = (T: number) => Number.isFinite(T) && T >= MIN_PERIOD_S && T <= MAX_PERIOD_S;
  const MIN_PAIRS = 3;

  let diffSum = 0;
  let jitterPairs = 0;
  let validPeriodSum = 0;
  let validPeriodCount = 0;

  for (let i = 0; i < N - 1; i++) {
    const t1 = periods[i] ?? NaN;
    const t2 = periods[i + 1] ?? NaN;
    if (!validPeriod(t1) || !validPeriod(t2)) continue;

    const ratio = t1 / t2;
    if (ratio >= 1 / MAX_PERIOD_FACTOR && ratio <= MAX_PERIOD_FACTOR) {
      diffSum += Math.abs(t1 - t2);
      jitterPairs++;
      validPeriodSum += (t1 + t2) / 2;
      validPeriodCount++;
    }
  }

  const meanT = validPeriodCount > 0 ? validPeriodSum / validPeriodCount : NaN;
  const jitterAbsoluteSec = jitterPairs >= MIN_PAIRS ? diffSum / jitterPairs : NaN;
  const jitterPercent =
    jitterPairs >= MIN_PAIRS && meanT > 0 ? (jitterAbsoluteSec / meanT) * 100 : NaN;

  let shimmerSum = 0;
  let shimmerPairs = 0;
  const nPairs = Math.min(periods.length - 1, amplitudes.length - 1);

  for (let i = 0; i < nPairs; i++) {
    const t1 = periods[i] ?? NaN;
    const t2 = periods[i + 1] ?? NaN;
    if (!validPeriod(t1) || !validPeriod(t2)) continue;
    const pRatio = t1 / t2;
    if (pRatio < 1 / MAX_PERIOD_FACTOR || pRatio > MAX_PERIOD_FACTOR) continue;

    const a1 = amplitudes[i] ?? 0;
    const a2 = amplitudes[i + 1] ?? 0;
    if (a1 <= 1e-9 || a2 <= 1e-9) continue;

    const aRatio = a1 / a2;
    if (aRatio >= 1 / MAX_AMPLITUDE_FACTOR && aRatio <= MAX_AMPLITUDE_FACTOR) {
      shimmerSum += Math.abs(20 * Math.log10(aRatio));
      shimmerPairs++;
    }
  }

  const shimmerDb = shimmerPairs >= MIN_PAIRS ? shimmerSum / shimmerPairs : NaN;

  return {
    jitterPercent: Math.round(jitterPercent * 100) / 100,
    shimmerDb: Math.round(shimmerDb * 100) / 100,
    jitterAbsoluteSec
  };
}

export interface HarmonicityOptions {
  method?: 'cc' | 'ac';
  pitchFloor?: number; // Hz, domyślnie 75 (Praat). Dla niskich głosów można dać 60.
  pitchCeiling?: number;
  timeStep?: number; // s, domyślnie 0.01
  silenceThreshold?: number; // względem globalnego piku, domyślnie 0.1
  voicingThreshold?: number; // domyślnie 0.45
  periodsPerWindow?: number; // domyślnie: cc → 1.0, ac → 4.5 (jak w Praat)
  octaveCost?: number; // domyślnie 0.01
}

export interface HarmonicityResult {
  meanDb: number;
  medianDb: number;
  voicedFrames: number;
  totalFrames: number;
  frameDb: number[]; // NaN dla ramek niedźwięcznych
  frameTimesSec: number[];
  frameF0Hz: number[];
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}

/** Autokorelacja przez FFT. Wynik w `re` (nieznormalizowany). */
function autocorrInPlace(re: Float64Array, im: Float64Array): void {
  fftRadix2(re, im, false);
  for (let i = 0; i < re.length; i++) {
    re[i] = (re[i] ?? 0) * (re[i] ?? 0) + (im[i] ?? 0) * (im[i] ?? 0);
    im[i] = 0;
  }
  fftRadix2(re, im, true);
}

interface HarmonicityPeak {
  strength: number; // r po korekcie okna (maks. interpolowane)
  lag: number; // w próbkach (ułamkowy)
}

function bestAutocorrPeak(
  r: Float64Array,
  minLag: number,
  maxLag: number,
  sampleRate: number,
  pitchFloor: number,
  octaveCost: number
): HarmonicityPeak {
  let best: HarmonicityPeak = { strength: NaN, lag: NaN };
  let bestScore = -Infinity;
  const hi = Math.min(maxLag, r.length - 2);
  for (let l = Math.max(2, minLag); l <= hi; l++) {
    const c = r[l] ?? 0;
    if (!(c > 0) || !(c > (r[l - 1] ?? 0)) || !(c >= (r[l + 1] ?? 0))) continue;
    const pv = parabolicVertex(r[l - 1] ?? 0, c, r[l + 1] ?? 0);
    const lag = l + pv.offset;
    const strength = pv.value;
    const score = strength - octaveCost * Math.log2((pitchFloor * lag) / sampleRate);
    if (score > bestScore) {
      bestScore = score;
      best = { strength, lag };
    }
  }
  return best;
}

function strengthToHnrDb(r: number): number {
  const rr = Math.min(r, 1 - 1e-10);
  if (!(rr > 1e-10)) return NaN;
  return 10 * Math.log10(rr / (1 - rr));
}

/** Wspólny rdzeń obliczeń HNR */
function harmonicityFrameCore(
  frame: ArrayLike<number>,
  sampleRate: number,
  win: Float64Array,
  winAc: Float64Array,
  nFft: number,
  re: Float64Array,
  im: Float64Array,
  minLag: number,
  maxLag: number,
  pitchFloor: number,
  octaveCost: number
): { peak: HarmonicityPeak; localPeak: number } {
  const n = win.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i] ?? 0;
  mean /= n;

  re.fill(0);
  im.fill(0);
  let localPeak = 0;
  for (let i = 0; i < n; i++) {
    const v = (frame[i] ?? 0) - mean;
    const a = Math.abs(v);
    if (a > localPeak) localPeak = a;
    re[i] = v * (win[i] ?? 0);
  }
  autocorrInPlace(re, im);

  const r0 = re[0] ?? 0;
  if (!(r0 > 1e-20)) return { peak: { strength: NaN, lag: NaN }, localPeak };

  const rCorr = new Float64Array(Math.min(nFft >> 1, maxLag + 3));
  for (let l = 0; l < rCorr.length; l++) {
    const rw = winAc[l] ?? 0;
    rCorr[l] = rw > 1e-3 ? (re[l] ?? 0) / r0 / rw : 0;
  }
  return { peak: bestAutocorrPeak(rCorr, minLag, maxLag, sampleRate, pitchFloor, octaveCost), localPeak };
}

function windowNormAutocorr(win: Float64Array, nFft: number): Float64Array {
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  re.set(win);
  autocorrInPlace(re, im);
  const out = new Float64Array(nFft >> 1);
  const r0 = re[0] ?? 1;
  for (let i = 0; i < out.length; i++) out[i] = (re[i] ?? 0) / r0;
  return out;
}

/** Ramka metody „cc” (Praat) */
function crossCorrelationFrame(
  sig: ArrayLike<number>,
  start: number,
  n: number,
  maxLag: number,
  nFft: number,
  reA: Float64Array,
  imA: Float64Array,
  reB: Float64Array,
  imB: Float64Array
): { r: Float64Array; localPeak: number } {
  const L = n + maxLag + 2;
  const N = sig.length;
  reA.fill(0); imA.fill(0); reB.fill(0); imB.fill(0);

  let mean = 0;
  for (let j = 0; j < L; j++) {
    const idx = start + j;
    mean += idx >= 0 && idx < N ? (sig[idx] ?? 0) : 0;
  }
  mean /= L;

  const cs = new Float64Array(L + 1);
  let localPeak = 0;
  for (let j = 0; j < L; j++) {
    const idx = start + j;
    const v = (idx >= 0 && idx < N ? (sig[idx] ?? 0) : 0) - mean;
    reB[j] = v;
    cs[j + 1] = (cs[j] ?? 0) + v * v;
    if (j < n) {
      reA[j] = v;
      const a = Math.abs(v);
      if (a > localPeak) localPeak = a;
    }
  }
  fftRadix2(reA, imA, false);
  fftRadix2(reB, imB, false);
  for (let i = 0; i < nFft; i++) {
    // conj(A) · B
    const ar = reA[i] ?? 0, ai = imA[i] ?? 0, br = reB[i] ?? 0, bi = imB[i] ?? 0;
    reA[i] = ar * br + ai * bi;
    imA[i] = ar * bi - ai * br;
  }
  fftRadix2(reA, imA, true);

  const sx = cs[n] ?? 0;
  const r = new Float64Array(maxLag + 3);
  for (let lag = 0; lag < r.length; lag++) {
    const sy = (cs[Math.min(L, n + lag)] ?? 0) - (cs[lag] ?? 0);
    const den = Math.sqrt(sx * sy);
    r[lag] = den > 1e-20 ? (reA[lag] ?? 0) / den : 0;
  }
  r[0] = 1;
  return { r, localPeak };
}

export function analyzeHarmonicity(
  signal: ArrayLike<number>,
  sampleRate: number,
  opts: HarmonicityOptions = {}
): HarmonicityResult {
  const method = opts.method ?? 'cc';
  const pitchFloor = opts.pitchFloor ?? 75;
  const pitchCeiling = opts.pitchCeiling ?? 600;
  const timeStep = opts.timeStep ?? 0.01;
  const silenceThreshold = opts.silenceThreshold ?? 0.1;
  const voicingThreshold = opts.voicingThreshold ?? 0.45;
  const periodsPerWindow = opts.periodsPerWindow ?? (method === 'cc' ? 1.0 : 4.5);
  const octaveCost = opts.octaveCost ?? 0.01;

  const res: HarmonicityResult = {
    meanDb: NaN,
    medianDb: NaN,
    voicedFrames: 0,
    totalFrames: 0,
    frameDb: [],
    frameTimesSec: [],
    frameF0Hz: []
  };
  const N = signal.length;
  if (!(sampleRate > 0) || N < 16) return res;

  const windowSec = periodsPerWindow / pitchFloor;
  const nWin = 2 * Math.floor((windowSec * sampleRate) / 2);
  const duration = N / sampleRate;
  if (nWin < 32 || windowSec > duration) return res;

  let gMean = 0;
  for (let i = 0; i < N; i++) gMean += signal[i] ?? 0;
  gMean /= N;
  let globalPeak = 0;
  for (let i = 0; i < N; i++) globalPeak = Math.max(globalPeak, Math.abs((signal[i] ?? 0) - gMean));
  if (!(globalPeak > 0)) return res;

  const minLag = Math.max(2, Math.floor(sampleRate / pitchCeiling));
  const maxLag = Math.min(Math.floor(nWin / periodsPerWindow) + 2, method === 'ac' ? nWin >> 1 : nWin);

  const nFft = method === 'ac' ? nextPow2(2 * nWin) : nextPow2(nWin + maxLag + 2);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const re2 = new Float64Array(nFft);
  const im2 = new Float64Array(nFft);
  const win = hannWindow(nWin);
  const winAc = method === 'ac' ? windowNormAutocorr(win, nFft) : new Float64Array(0);
  const frame = new Float64Array(nWin);

  const nFrames = Math.floor((duration - windowSec) / timeStep) + 1;
  const t1 = 0.5 * (duration - (nFrames - 1) * timeStep);

  for (let f = 0; f < nFrames; f++) {
    const tc = t1 + f * timeStep;
    const start = Math.round(tc * sampleRate - nWin / 2);

    let peak: HarmonicityPeak;
    let localPeak: number;
    if (method === 'ac') {
      if (start < 0 || start + nWin > N) continue;
      for (let i = 0; i < nWin; i++) frame[i] = signal[start + i] ?? 0;
      ({ peak, localPeak } = harmonicityFrameCore(
        frame, sampleRate, win, winAc, nFft, re, im, minLag, maxLag, pitchFloor, octaveCost
      ));
    } else {
      const cc = crossCorrelationFrame(signal, start, nWin, maxLag, nFft, re, im, re2, im2);
      localPeak = cc.localPeak;
      peak = bestAutocorrPeak(cc.r, minLag, maxLag, sampleRate, pitchFloor, octaveCost);
    }

    const unvoicedStrength =
      voicingThreshold +
      Math.max(0, 2 - localPeak / globalPeak / (silenceThreshold / (1 + voicingThreshold)));

    const voiced = Number.isFinite(peak.strength) && peak.strength > unvoicedStrength;
    const hnr = voiced ? strengthToHnrDb(peak.strength) : NaN;

    res.totalFrames++;
    res.frameTimesSec.push(tc);
    res.frameDb.push(hnr);
    res.frameF0Hz.push(voiced ? sampleRate / peak.lag : NaN);
  }

  const valid = res.frameDb.filter((v) => Number.isFinite(v));
  res.voicedFrames = valid.length;
  if (valid.length > 0) {
    res.meanDb = valid.reduce((a, b) => a + b, 0) / valid.length;
    res.medianDb = medianOfValid(valid);
  }
  return res;
}

/** HNR pojedynczej ramki (np. do podglądu na żywo) */
export function calculateHNR(
  frame: Float32Array | number[],
  sampleRate: number,
  f0: number = NaN,
  opts: HarmonicityOptions = {}
): number {
  const n = frame.length;
  if (n < 64 || !(sampleRate > 0)) return NaN;

  const hasHint = Number.isFinite(f0) && f0 > 0;
  const pitchFloor = hasHint ? Math.max(30, f0 / 1.5) : (opts.pitchFloor ?? 75);
  const pitchCeiling = hasHint ? f0 * 1.5 : (opts.pitchCeiling ?? 600);
  const octaveCost = opts.octaveCost ?? 0.01;

  const nWin = n;
  const nFft = nextPow2(2 * nWin);
  const win = hannWindow(nWin);
  const winAc = windowNormAutocorr(win, nFft);
  const minLag = Math.max(2, Math.floor(sampleRate / pitchCeiling));
  const maxLag = Math.min(Math.ceil(sampleRate / pitchFloor) + 1, Math.floor(nWin / 3));
  if (maxLag <= minLag + 2) return NaN;

  const { peak } = harmonicityFrameCore(
    frame, sampleRate, win, winAc, nFft,
    new Float64Array(nFft), new Float64Array(nFft),
    minLag, maxLag, pitchFloor, octaveCost
  );
  if (!Number.isFinite(peak.strength) || peak.strength < (opts.voicingThreshold ?? 0.45)) return NaN;
  const hnr = strengthToHnrDb(peak.strength);
  return Number.isFinite(hnr) ? Math.round(hnr * 10) / 10 : NaN;
}

function readAnalyserDb(analyser: AnalyserNode): Float32Array {
  const db = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(db);
  return db;
}

export class LongTermSpectrum {
  private sum: Float64Array | null = null;
  private frames = 0;
  private sampleRate = 0;

  add(analyser: AnalyserNode): void {
    const db = readAnalyserDb(analyser);
    if (!this.sum || this.sum.length !== db.length) {
      this.sum = new Float64Array(db.length);
      this.frames = 0;
    }
    this.sampleRate = analyser.context.sampleRate;
    for (let i = 0; i < db.length; i++) {
      const d = Math.max(-120, db[i] ?? -120);
      this.sum[i] = (this.sum[i] ?? 0) + Math.pow(10, d / 10);
    }
    this.frames++;
  }

  get frameCount(): number {
    return this.frames;
  }

  get sampleRateHz(): number {
    return this.sampleRate;
  }

  reset(): void {
    this.sum = null;
    this.frames = 0;
  }

  toDb(): Float32Array {
    if (!this.sum || this.frames === 0) return new Float32Array(0);
    const out = new Float32Array(this.sum.length);
    for (let i = 0; i < out.length; i++) out[i] = 10 * Math.log10(Math.max(1e-12, (this.sum[i] ?? 0) / this.frames));
    return out;
  }
}

export function calculateSpectralNoiseFromDb(
  db: ArrayLike<number>,
  sampleRate: number,
  f0: number,
  vowelFormantCutoffHz = 2000
): number {
  if (!(f0 >= 50) || !Number.isFinite(f0)) return NaN;

  const nBins = db.length;
  if (nBins < 8 || !(sampleRate > 0)) return NaN;

  const nyquist = sampleRate / 2;
  const binHz = nyquist / nBins;
  if (f0 < 6 * binHz) return NaN;

  const lvl = (i: number): number => Math.max(-120, db[i] ?? -120);

  let maxDb = -Infinity;
  const maxSearchBin = Math.min(nBins, Math.round(vowelFormantCutoffHz / binHz));
  for (let i = 0; i < maxSearchBin; i++) {
    const val = db[i] ?? -Infinity;
    if (val > maxDb) maxDb = val;
  }
  if (!Number.isFinite(maxDb) || maxDb < -85) return NaN;

  let noiseDbSum = 0;
  let noiseBinCount = 0;

  const f0Bin = Math.round(f0 / binHz);
  const belowF0Limit = Math.max(1, Math.round(0.75 * f0Bin));
  const firstBin = Math.max(1, Math.ceil(50 / binHz));
  for (let i = firstBin; i <= belowF0Limit; i++) {
    noiseDbSum += lvl(i) - maxDb;
    noiseBinCount++;
  }

  const maxHarmonic = Math.floor(vowelFormantCutoffHz / f0);
  const span = Math.max(1, Math.floor((0.15 * f0) / binHz));
  for (let h = 1; h < maxHarmonic; h++) {
    const hCenter = Math.round(((h + 0.5) * f0) / binHz);
    for (let j = -span; j <= span; j++) {
      const idx = hCenter + j;
      if (idx > 0 && idx < nBins && idx * binHz < vowelFormantCutoffHz) {
        noiseDbSum += lvl(idx) - maxDb;
        noiseBinCount++;
      }
    }
  }

  if (noiseBinCount === 0) return NaN;
  return Math.round((noiseDbSum / noiseBinCount) * 10) / 10;
}

export function calculateSpectralNoise(analyser: AnalyserNode, f0: number, vowelFormantCutoffHz = 2000): number {
  return calculateSpectralNoiseFromDb(readAnalyserDb(analyser), analyser.context.sampleRate, f0, vowelFormantCutoffHz);
}

export interface SingerFormantResult {
  sfEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  spectralCentroidHz: number;
  spectralRolloffHz: number;
}

export function calculateSingerFormantAndSPRFromDb(
  freqData: ArrayLike<number>,
  sampleRate: number,
  f0: number = 0,
  rolloffThreshold = 0.85
): SingerFormantResult {
  const nanResult: SingerFormantResult = {
    sfEnergyDb: NaN,
    spr: NaN,
    sppFreqHz: NaN,
    spectralCentroidHz: NaN,
    spectralRolloffHz: NaN
  };
  const numBins = freqData.length;
  if (numBins < 8 || !(sampleRate > 0)) return nanResult;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / numBins;

  const SF_LO = 2500;
  const SF_HI = 3500;
  const TOTAL_LO = 50;
  const TOTAL_HI = Math.min(10000, nyquist);

  let maxDb = -Infinity;
  for (let i = 0; i < numBins; i++) {
    const val = freqData[i] ?? -Infinity;
    if (val > maxDb) maxDb = val;
  }
  if (!Number.isFinite(maxDb) || maxDb < -85) return nanResult;

  const minBin = Math.max(0, Math.floor(TOTAL_LO / binHz));
  const maxBin = Math.min(numBins - 1, Math.ceil(TOTAL_HI / binHz));

  const mags = new Float64Array(numBins);
  let sfPow = 0;
  let totalPow = 0;
  let sumMag = 0;
  let sumPow = 0; // do centroidu (Praat: domyślnie ważenie mocą, power = 2)
  let sumFPow = 0;

  for (let i = minBin; i <= maxBin; i++) {
    const db = Math.max(-120, freqData[i] ?? -120);
    const f = i * binHz;
    const p = Math.pow(10, db / 10);
    const a = Math.pow(10, db / 20);
    mags[i] = a;
    sumMag += a;
    sumPow += p;
    sumFPow += f * p;
    totalPow += p;
    if (f >= SF_LO && f <= SF_HI) sfPow += p;
  }

  const spectralCentroidHz = sumPow > 0 ? sumFPow / sumPow : NaN;

  const targetEnergy = sumMag * rolloffThreshold;
  let accumulatedMag = 0;
  let spectralRolloffHz = NaN;
  for (let i = minBin; i <= maxBin; i++) {
    accumulatedMag += mags[i] ?? 0;
    if (accumulatedMag >= targetEnergy) {
      spectralRolloffHz = i * binHz;
      break;
    }
  }

  const sfEnergyDb = sfPow > 0 && totalPow > 0 ? 10 * Math.log10(sfPow / totalPow) : NaN;

  const peakSpan = f0 > 60 ? Math.max(1, Math.round((0.35 * f0) / binHz)) : 2;
  const isPeak = (i: number): boolean => {
    const v = freqData[i] ?? -Infinity;
    for (let k = 1; k <= peakSpan; k++) {
      if (i - k < 0 || i + k >= numBins) return false;
      if ((freqData[i - k] ?? -Infinity) >= v || (freqData[i + k] ?? -Infinity) > v) return false;
    }
    return true;
  };

  const refineHz = (i: number): number => {
    const o = parabolicVertex(freqData[i - 1] ?? -120, freqData[i] ?? -120, freqData[i + 1] ?? -120).offset;
    return (i + (Number.isFinite(o) ? Math.max(-0.5, Math.min(0.5, o)) : 0)) * binHz;
  };

  let maxLowDb = -Infinity;
  let maxHighDb = -Infinity;
  let sppFreqHz = NaN;
  for (let i = 1; i < numBins - 1; i++) {
    const f = i * binHz;
    if (f < 50 || f > 4000) continue;
    const v = freqData[i] ?? -Infinity;
    if (!isPeak(i)) continue;
    if (f < 2000) {
      if (v > maxLowDb) maxLowDb = v;
    } else if (v > maxHighDb) {
      maxHighDb = v;
      sppFreqHz = refineHz(i);
    }
  }

  if (maxLowDb === -Infinity) {
    for (let i = 0; i < numBins; i++) {
      const f = i * binHz;
      if (f >= 50 && f < 2000 && (freqData[i] ?? -Infinity) > maxLowDb) maxLowDb = freqData[i] ?? -Infinity;
    }
  }
  if (maxHighDb === -Infinity) {
    for (let i = 1; i < numBins - 1; i++) {
      const f = i * binHz;
      if (f >= 2000 && f <= 4000 && (freqData[i] ?? -Infinity) > maxHighDb) {
        maxHighDb = freqData[i] ?? -Infinity;
        sppFreqHz = refineHz(i);
      }
    }
  }

  const spr = Number.isFinite(maxHighDb) && Number.isFinite(maxLowDb) ? maxHighDb - maxLowDb : NaN;

  return {
    sfEnergyDb: Math.round(sfEnergyDb * 10) / 10,
    spr: Math.round(spr * 10) / 10,
    sppFreqHz: Math.round(sppFreqHz),
    spectralCentroidHz: Math.round(spectralCentroidHz),
    spectralRolloffHz: Math.round(spectralRolloffHz)
  };
}

export function calculateSingerFormantAndSPR(
  analyser: AnalyserNode,
  f0: number = 0,
  rolloffThreshold = 0.85
): SingerFormantResult {
  return calculateSingerFormantAndSPRFromDb(readAnalyserDb(analyser), analyser.context.sampleRate, f0, rolloffThreshold);
}

export interface CPPSOptions {
  pitchFloor?: number; // Hz – wyznacza długość okna (3 / pitchFloor), domyślnie 60
  peakSearchMinHz?: number; // domyślnie 60
  peakSearchMaxHz?: number; // domyślnie 330 (Praat); dla śpiewu można dać 600–1000
  timeStep?: number; // s, domyślnie 0.005 (Praat: 0.002)
  maxFrequency?: number; // Hz, domyślnie 5000
  preEmphasisHz?: number; // domyślnie 50
  timeAveragingSec?: number; // domyślnie 0.02
  quefrencyAveragingSec?: number; // domyślnie 0.0005
  tiltLineStartSec?: number; // domyślnie 0.001
  robustFit?: boolean; // true = Theil–Sen (Praat „Robust”), false = MNK
  cepstrumLengthSec?: number; // koniec zakresu dopasowania linii trendu [s]
}

export interface CPPSResult {
  cppsDb: number;
  frameCppDb: number[];
  frameTimesSec: number[];
}

interface CepstrumContext {
  nWin: number;
  nFft: number;
  K: number; // liczba prążków widma użytych do cepstrum (0 … maxFrequency)
  Q: number; // liczba punktów cepstrum
  dq: number; // krok kwefrencji [s]
  win: Float64Array;
  cosTable: Float64Array; // K × Q
}

const COS_TABLE_CACHE = new Map<string, Float64Array>();

function buildCepstrumContext(sampleRate: number, widthSec: number, maxFrequency: number, qEndOverride?: number): CepstrumContext {
  const nWin = Math.max(64, Math.round(widthSec * sampleRate));
  const nFft = nextPow2(nWin);
  const binHz = sampleRate / nFft;
  const fMax = Math.min(maxFrequency, sampleRate / 2);
  const K = Math.max(8, Math.min(nFft >> 1, Math.floor(fMax / binHz)));
  const fMaxActual = K * binHz;
  const dq = 1 / (2 * fMaxActual);
  const nFft10k = nextPow2(Math.round(widthSec * 2 * fMax));
  const qEnd = qEndOverride ?? (nFft10k / 2) * (1 / (2 * fMax));
  const Q = Math.max(16, Math.floor(qEnd / dq) + 1);
  const cacheKey = `${K}x${Q}`;
  let cosTable = COS_TABLE_CACHE.get(cacheKey);
  if (!cosTable) {
    cosTable = new Float64Array(K * Q);
    for (let k = 0; k < K; k++) {
      for (let q = 0; q < Q; q++) cosTable[k * Q + q] = Math.cos((Math.PI * k * q) / K);
    }
    COS_TABLE_CACHE.set(cacheKey, cosTable);
  }
  return { nWin, nFft, K, Q, dq, win: hannWindow(nWin), cosTable };
}

function powerCepstrumOfFrame(
  seg: ArrayLike<number>,
  ctx: CepstrumContext,
  re: Float64Array,
  im: Float64Array,
  logSpec: Float64Array
): Float64Array {
  re.fill(0);
  im.fill(0);
  let mean = 0;
  for (let i = 0; i < ctx.nWin; i++) mean += seg[i] ?? 0;
  mean /= ctx.nWin;
  for (let i = 0; i < ctx.nWin; i++) re[i] = ((seg[i] ?? 0) - mean) * (ctx.win[i] ?? 0);
  fftRadix2(re, im, false);
  for (let k = 0; k < ctx.K; k++) {
    logSpec[k] = Math.log((re[k] ?? 0) * (re[k] ?? 0) + (im[k] ?? 0) * (im[k] ?? 0) + 1e-30);
  }
  const out = new Float64Array(ctx.Q);
  for (let k = 0; k < ctx.K; k++) {
    const L = logSpec[k] ?? 0;
    const row = k * ctx.Q;
    for (let q = 0; q < ctx.Q; q++) out[q] = (out[q] ?? 0) + L * (ctx.cosTable[row + q] ?? 0);
  }
  for (let q = 0; q < ctx.Q; q++) {
    const c = (out[q] ?? 0) / ctx.K;
    out[q] = c * c;
  }
  return out;
}

function toDbCepstrum(p: Float64Array): Float64Array {
  const y = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) y[i] = 10 * Math.log10(Math.max(1e-30, p[i] ?? 0));
  return y;
}

function theilSenLine(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const slopes = new Float64Array((n * (n - 1)) / 2);
  let m = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes[m++] = ((ys[j] ?? 0) - (ys[i] ?? 0)) / ((xs[j] ?? 0) - (xs[i] ?? 0));
    }
  }
  slopes.sort();
  const slope = m % 2 ? (slopes[m >> 1] ?? 0) : ((slopes[(m >> 1) - 1] ?? 0) + (slopes[m >> 1] ?? 0)) / 2;
  const inter = new Float64Array(n);
  for (let i = 0; i < n; i++) inter[i] = (ys[i] ?? 0) - slope * (xs[i] ?? 0);
  inter.sort();
  const intercept = n % 2 ? (inter[n >> 1] ?? 0) : ((inter[(n >> 1) - 1] ?? 0) + (inter[n >> 1] ?? 0)) / 2;
  return { slope, intercept };
}

function leastSquaresLine(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0, y = ys[i] ?? 0;
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const d = n * sxx - sx * sx;
  const slope = Math.abs(d) < 1e-30 ? 0 : (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Prominencja piku w dB-cepstrum `y` względem prostej trendu. */
function peakProminenceDb(
  y: Float64Array,
  dq: number,
  peakMinHz: number,
  peakMaxHz: number,
  tiltStartSec: number,
  robust: boolean
): { prominenceDb: number; quefrencySec: number } {
  const none = { prominenceDb: NaN, quefrencySec: NaN };
  const Q = y.length;
  const iFit0 = Math.max(1, Math.ceil(tiltStartSec / dq));
  if (Q - iFit0 < 8) return none;

  const xs: number[] = [];
  const ys: number[] = [];
  // Theil–Sen ma koszt O(n² log n)
  const stride = robust ? 3 : 1;
  for (let i = iFit0; i < Q; i += stride) {
    xs.push(i * dq);
    ys.push(y[i] ?? 0);
  }
  const { slope, intercept } = robust ? theilSenLine(xs, ys) : leastSquaresLine(xs, ys);

  const iLo = Math.max(2, Math.ceil(1 / peakMaxHz / dq));
  const iHi = Math.min(Q - 2, Math.floor(1 / peakMinHz / dq));
  if (iLo >= iHi) return none;

  let best = -1;
  let bestV = -Infinity;
  for (let i = iLo; i <= iHi; i++) {
    const v = y[i] ?? -Infinity;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  if (best < 0) return none;

  const pv = parabolicVertex(y[best - 1] ?? 0, y[best] ?? 0, y[best + 1] ?? 0);
  const q = (best + pv.offset) * dq;
  const prominence = pv.value - (slope * q + intercept);
  return Number.isFinite(prominence) ? { prominenceDb: prominence, quefrencySec: q } : none;
}

function preEmphasize(x: ArrayLike<number>, sampleRate: number, freqHz: number): Float64Array {
  const out = new Float64Array(x.length);
  const a = freqHz > 0 ? Math.exp((-2 * Math.PI * freqHz) / sampleRate) : 0;
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    out[i] = v - a * prev;
    prev = v;
  }
  return out;
}

export function calculateCPPS(signal: ArrayLike<number>, sampleRate: number, opts: CPPSOptions = {}): CPPSResult {
  const pitchFloor = opts.pitchFloor ?? 60;
  const peakMin = opts.peakSearchMinHz ?? 60;
  const peakMax = opts.peakSearchMaxHz ?? 330;
  const timeStep = opts.timeStep ?? 0.005;
  const maxFreq = opts.maxFrequency ?? 5000;
  const preEmph = opts.preEmphasisHz ?? 50;
  const timeAvg = opts.timeAveragingSec ?? 0.02;
  const quefAvg = opts.quefrencyAveragingSec ?? 0.0005;
  const tiltStart = opts.tiltLineStartSec ?? 0.001;
  const robust = opts.robustFit ?? true;

  const res: CPPSResult = { cppsDb: NaN, frameCppDb: [], frameTimesSec: [] };
  const N = signal.length;
  if (!(sampleRate > 0) || N < 512) return res;

  const widthSec = 3 / pitchFloor;
  const duration = N / sampleRate;
  if (widthSec > duration) return res;

  const ctx = buildCepstrumContext(sampleRate, widthSec, maxFreq, opts.cepstrumLengthSec ?? 0.04);
  const x = preEmphasize(signal, sampleRate, preEmph);
  const re = new Float64Array(ctx.nFft);
  const im = new Float64Array(ctx.nFft);
  const logSpec = new Float64Array(ctx.K);
  const seg = new Float64Array(ctx.nWin);

  const nFrames = Math.floor((duration - widthSec) / timeStep) + 1;
  const t1 = 0.5 * (duration - (nFrames - 1) * timeStep);

  const powerFrames: Float64Array[] = [];
  for (let f = 0; f < nFrames; f++) {
    const tc = t1 + f * timeStep;
    const start = Math.round(tc * sampleRate - ctx.nWin / 2);
    if (start < 0 || start + ctx.nWin > N) continue;
    for (let i = 0; i < ctx.nWin; i++) seg[i] = x[start + i] ?? 0;
    powerFrames.push(powerCepstrumOfFrame(seg, ctx, re, im, logSpec));
    res.frameTimesSec.push(tc);
  }
  const F = powerFrames.length;
  if (F === 0) return res;

  // wygładzanie cepstrogramu
  const halfT = Math.max(0, Math.floor(timeAvg / 2 / timeStep));
  const halfQ = Math.max(0, Math.floor(Math.round(quefAvg / ctx.dq) / 2));
  const timeSmoothed: Float64Array[] = [];
  for (let f = 0; f < F; f++) {
    const a = Math.max(0, f - halfT);
    const b = Math.min(F - 1, f + halfT);
    const acc = new Float64Array(ctx.Q);
    for (let g = a; g <= b; g++) {
      const pf = powerFrames[g]!;
      for (let q = 0; q < ctx.Q; q++) acc[q] = (acc[q] ?? 0) + (pf[q] ?? 0);
    }
    for (let q = 0; q < ctx.Q; q++) acc[q] = (acc[q] ?? 0) / (b - a + 1);
    timeSmoothed.push(acc);
  }

  const cpps: number[] = [];
  for (let f = 0; f < F; f++) {
    const src = timeSmoothed[f]!;
    const sm = new Float64Array(ctx.Q);
    for (let q = 0; q < ctx.Q; q++) {
      const a = Math.max(0, q - halfQ);
      const b = Math.min(ctx.Q - 1, q + halfQ);
      let s = 0;
      for (let k = a; k <= b; k++) s += src[k] ?? 0;
      sm[q] = s / (b - a + 1);
    }
    const p = peakProminenceDb(toDbCepstrum(sm), ctx.dq, peakMin, peakMax, tiltStart, robust);
    res.frameCppDb.push(p.prominenceDb);
    if (Number.isFinite(p.prominenceDb)) cpps.push(p.prominenceDb);
  }
  res.cppsDb = cpps.length > 0 ? cpps.reduce((a, b) => a + b, 0) / cpps.length : NaN;
  return res;
}

export function calculateCPP(
  buffer: Float32Array,
  sampleRate: number,
  pitchFloor = 60,
  pitchCeiling = 600,
  smoothQuefrency = true
): CPPResult {
  const empty: CPPResult = { cppDb: NaN, f0CepstralHz: NaN, quefrencySec: NaN };
  if (!buffer || buffer.length < 512 || !(sampleRate > 0)) return empty;

  const ctx = buildCepstrumContext(sampleRate, buffer.length / sampleRate, 5000, 0.04);
  const x = preEmphasize(buffer, sampleRate, 50);
  const p = powerCepstrumOfFrame(
    x.length === ctx.nWin ? x : x.subarray(0, ctx.nWin),
    ctx,
    new Float64Array(ctx.nFft),
    new Float64Array(ctx.nFft),
    new Float64Array(ctx.K)
  );

  let src = p;
  if (smoothQuefrency) {
    const halfQ = Math.max(0, Math.floor(Math.round(0.0005 / ctx.dq) / 2));
    src = new Float64Array(ctx.Q);
    for (let q = 0; q < ctx.Q; q++) {
      const a = Math.max(0, q - halfQ);
      const b = Math.min(ctx.Q - 1, q + halfQ);
      let s = 0;
      for (let k = a; k <= b; k++) s += p[k] ?? 0;
      src[q] = s / (b - a + 1);
    }
  }

  const r = peakProminenceDb(toDbCepstrum(src), ctx.dq, pitchFloor, pitchCeiling, 0.001, true);
  if (!Number.isFinite(r.prominenceDb)) return empty;
  return {
    cppDb: Math.round(Math.max(0, r.prominenceDb) * 10) / 10,
    f0CepstralHz: Math.round((1 / r.quefrencySec) * 10) / 10,
    quefrencySec: r.quefrencySec
  };
}

function emptyVibrato(): VibratoAnalysisResult {
  return {
    rateHz: 0,
    extentCents: 0,
    extentSemitones: 0,
    onsetDelaySec: 0,
    sinusoidality: 0,
    hasVibrato: false
  };
}

/** Sinusoidalność wibrato VIB_S (Żwan, Kostek 2008) */
export function vibratoSinusoidality(contour: number[], periodSamples: number): number {
  if (!(periodSamples > 1)) return 0;
  const periods = Math.floor(contour.length / periodSamples);
  if (periods < 2) return 0;
  const N = Math.round(periods * periodSamples);
  const x = contour.slice(0, N);
  let mean = 0;
  for (const v of x) mean += v;
  mean /= N;
  let maxP = 0;
  let sumP = 0;
  for (let k = 1; k <= Math.floor(N / 2); k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const a = (-2 * Math.PI * k * n) / N;
      const v = x[n]! - mean;
      re += v * Math.cos(a);
      im += v * Math.sin(a);
    }
    const pw = re * re + im * im;
    sumP += pw;
    if (pw > maxP) maxP = pw;
  }
  return sumP > 0 ? maxP / sumP : 0;
}

export function analyzeVibratoFull(
  pitchHistory: number[],
  sampleIntervalSec = 0.016,
  timestampsSec?: number[]
): VibratoAnalysisResult {
  const hasTs = timestampsSec !== undefined && timestampsSec.length === pitchHistory.length;

  const validEntries: { f: number; t: number }[] = [];
  for (let i = 0; i < pitchHistory.length; i++) {
    const p = pitchHistory[i] ?? 0;
    const t = hasTs ? (timestampsSec?.[i] ?? i * sampleIntervalSec) : i * sampleIntervalSec;
    if (p > 50 && Number.isFinite(p) && Number.isFinite(t)) {
      const prev = validEntries[validEntries.length - 1];
      if (prev && t <= prev.t) continue;
      validEntries.push({ f: p, t });
    }
  }

  if (validEntries.length < 25) return emptyVibrato();

  let bestStart = 0;
  let bestLen = 0;
  let curStart = 0;
  let curLen = 1;

  for (let i = 1; i < validEntries.length; i++) {
    const dt = (validEntries[i]?.t ?? 0) - (validEntries[i - 1]?.t ?? 0);
    if (dt <= 0.08) {
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
      curStart = i;
      curLen = 1;
    }
  }
  if (curLen > bestLen) {
    bestLen = curLen;
    bestStart = curStart;
  }

  if (bestLen < 25) return emptyVibrato();

  const segment = validEntries.slice(bestStart, bestStart + bestLen);
  const firstTime = segment[0]!.t;
  const lastTime = segment[segment.length - 1]!.t;
  const duration = lastTime - firstTime;
  if (duration < 0.35) return emptyVibrato();

  const dt = 0.016;
  const uniformLength = Math.floor(duration / dt) + 1;
  const uniformPitches: number[] = [];

  let segIdx = 0;
  for (let i = 0; i < uniformLength; i++) {
    const curT = firstTime + i * dt;
    while (segIdx < segment.length - 2 && (segment[segIdx + 1]?.t ?? 0) < curT) {
      segIdx++;
    }
    const t0 = segment[segIdx]!.t;
    const t1 = segment[Math.min(segment.length - 1, segIdx + 1)]!.t;
    const f0 = segment[segIdx]!.f;
    const f1 = segment[Math.min(segment.length - 1, segIdx + 1)]!.f;
    const frac = t1 > t0 ? Math.max(0, Math.min(1, (curT - t0) / (t1 - t0))) : 0;
    uniformPitches.push(f0 + frac * (f1 - f0));
  }

  if (uniformPitches.length < 25) return emptyVibrato();

  const sorted = [...uniformPitches].sort((a, b) => a - b);
  const medianPitch = sorted[Math.floor(sorted.length / 2)]!;
  const centsContour = uniformPitches.map((p) => 1200 * Math.log2(p / medianPitch));

  const windowFrames = Math.max(3, Math.round(0.18 / dt));
  const halfWin = Math.floor(windowFrames / 2);
  const detrended: number[] = [];

  for (let i = 0; i < centsContour.length; i++) {
    const start = Math.max(0, i - halfWin);
    const end = Math.min(centsContour.length, i + halfWin + 1);
    let sum = 0;
    for (let k = start; k < end; k++) sum += centsContour[k]!;
    detrended.push(centsContour[i]! - sum / (end - start));
  }

  const N = detrended.length;
  let energy0 = 0;
  for (let i = 0; i < N; i++) energy0 += detrended[i]! * detrended[i]!;
  if (energy0 <= 1e-6) return emptyVibrato();

  const minLag = Math.max(2, Math.floor(0.1 / dt));
  const maxLag = Math.min(Math.floor(N / 2.5), Math.ceil(0.34 / dt));
  if (maxLag - minLag < 3) return emptyVibrato();

  const normAc = (lag: number): number => {
    let r = 0;
    let n1 = 0;
    let n2 = 0;
    for (let i = 0; i < N - lag; i++) {
      const v1 = detrended[i]!;
      const v2 = detrended[i + lag]!;
      r += v1 * v2;
      n1 += v1 * v1;
      n2 += v2 * v2;
    }
    const den = Math.sqrt(n1 * n2);
    return den > 1e-9 ? r / den : 0;
  };

  const ac = new Map<number, number>();
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) ac.set(lag, normAc(lag));
  let globalMax = -1;
  for (let lag = minLag; lag <= maxLag; lag++) globalMax = Math.max(globalMax, ac.get(lag) ?? 0);

  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const v = ac.get(lag) ?? 0;
    if (v >= 0.9 * globalMax && v >= (ac.get(lag - 1) ?? 0) && v >= (ac.get(lag + 1) ?? 0)) {
      bestLag = lag;
      break;
    }
  }
  const maxCorr = bestLag > 0 ? (ac.get(bestLag) ?? 0) : -1;

  if (bestLag <= 0 || maxCorr < 0.28) return emptyVibrato();

  let fineLag = bestLag;
  {
    const y1 = ac.get(bestLag - 1) ?? 0;
    const y2 = maxCorr;
    const y3 = ac.get(bestLag + 1) ?? 0;
    const denom = y1 - 2 * y2 + y3;
    if (Math.abs(denom) > 1e-9) {
      fineLag += Math.max(-0.5, Math.min(0.5, (0.5 * (y1 - y3)) / denom));
    }
  }

  const rateHz = 1 / (fineLag * dt);
  const L = fineLag;
  const m = Math.max(1, Math.floor((L - 1) / 2));
  const outerW = Math.max(0, (L - (2 * m + 1)) / 2);
  let series = detrended;
  let seriesOffset = 0;
  if (centsContour.length > 2 * (m + 1) + Math.ceil(2 * L)) {
    const s2: number[] = [];
    for (let i = m + 1; i < centsContour.length - m - 1; i++) {
      let sum = 0;
      for (let k = -m; k <= m; k++) sum += centsContour[i + k]!;
      sum += outerW * (centsContour[i - m - 1]! + centsContour[i + m + 1]!);
      s2.push(centsContour[i]! - sum / L);
    }
    series = s2;
    seriesOffset = m + 1;
  }
  const Ns = series.length;
  const rmsOf = (arr: number[]): number => {
    let e = 0;
    for (let i = 0; i < arr.length; i++) e += arr[i]! * arr[i]!;
    return Math.sqrt(e / Math.max(1, arr.length));
  };
  const globalExtent = rmsOf(series) * Math.SQRT2;

  const windowPer = Math.max(4, Math.round(fineLag));
  let onsetIndex = 0;
  for (let i = 0; i < Ns - windowPer; i++) {
    let localEnergy = 0;
    for (let k = 0; k < windowPer; k++) {
      const v = series[i + k]!;
      localEnergy += v * v;
    }
    const localExtent = Math.sqrt(localEnergy / windowPer) * Math.SQRT2;
    if (localExtent >= Math.min(15, globalExtent * 0.45)) {
      onsetIndex = i;
      break;
    }
  }

  const steadyStart =
    onsetIndex === 0 ? 0 : Math.max(0, Math.min(onsetIndex + windowPer, Ns - Math.ceil(2 * fineLag)));
  const extentCents = rmsOf(series.slice(steadyStart)) * Math.SQRT2;
  const extentSemitones = extentCents / 100;
  const onsetDelaySec =
    firstTime -
    (validEntries[0]?.t ?? firstTime) +
    (onsetIndex === 0 ? 0 : (seriesOffset + onsetIndex + windowPer / 2) * dt);
  // Okresowość konturu (maks. autokorelacji)
  const periodicity = Math.max(0, Math.min(1, maxCorr));
  const sinusoidality = vibratoSinusoidality(series.slice(steadyStart), fineLag);

  const hasVibrato =
    extentCents >= 15 &&
    extentCents <= 220 &&
    rateHz >= 4.0 &&
    rateHz <= 8.2 &&
    periodicity >= 0.38;

  return {
    rateHz: Math.round(rateHz * 10) / 10,
    extentCents: Math.round(extentCents),
    extentSemitones: Math.round(extentSemitones * 100) / 100,
    onsetDelaySec: hasVibrato ? Math.round(onsetDelaySec * 100) / 100 : 0,
    sinusoidality: Math.round(sinusoidality * 1000) / 1000,
    hasVibrato
  };
}

export function midiToNoteName(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const roundedMidi = Math.round(midi);
  const note = noteNames[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${note}${octave}`;
}

export function calculateMPFRMetrics(lowMidi: number, highMidi: number): MPFRResult {
  const f0MinHz = 440 * Math.pow(2, (lowMidi - 69) / 12);
  const f0MaxHz = 440 * Math.pow(2, (highMidi - 69) / 12);
  const mpfrSemitones = highMidi - lowMidi;
  const mpfrOctaves = Math.round((mpfrSemitones / 12) * 100) / 100;

  return {
    f0MinHz: Math.round(f0MinHz * 10) / 10,
    f0MaxHz: Math.round(f0MaxHz * 10) / 10,
    f0MinMidi: lowMidi,
    f0MaxMidi: highMidi,
    f0MinNoteName: midiToNoteName(lowMidi),
    f0MaxNoteName: midiToNoteName(highMidi),
    mpfrSemitones,
    mpfrOctaves
  };
}