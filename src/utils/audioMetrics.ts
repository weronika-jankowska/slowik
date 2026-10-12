export interface VibratoAnalysisResult {
  rateHz: number;
  extentCents: number;
  extentSemitones: number;
  onsetDelaySec: number;
  sinusoidality: number;
  hasVibrato: boolean;
}

export interface AcousticMetricsState {
  f0: number;
  rms: number;
  rmsDbfs: number;
  maeCents: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  spectralNoiseDb: number;
  spectralCentroidHz: number;
  spectralRolloffHz: number;
  singerFormantEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  vibrato: VibratoAnalysisResult;
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

export function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

export function pitchYIN(buffer: Float32Array, sampleRate: number, threshold = 0.15): number {
  const bufferSize = Math.floor(buffer.length / 2);
  if (bufferSize < 4) return -1;
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
  for (let t = 2; t < bufferSize; t++) {
    if ((yinBuffer[t] ?? 1) < threshold) {
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
    if (globalMin > 0.5 || tau <= 0) return -1;
  }

  let betterTau = tau;
  if (tau > 0 && tau < bufferSize - 1) {
    betterTau =
      tau + parabolicVertex(yinBuffer[tau - 1] ?? 0, yinBuffer[tau] ?? 0, yinBuffer[tau + 1] ?? 0).offset;
  }

  return betterTau > 0 ? sampleRate / betterTau : -1;
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

    const cycleStart = Math.max(0, Math.floor(t));
    const cycleEnd = Math.min(N - 1, Math.ceil(t + sEst));
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let j = cycleStart; j <= cycleEnd; j++) {
      const v = x[j] ?? 0;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const peakToPeakAmp = maxVal > minVal ? maxVal - minVal : 0;

    periods.push(sEst / sampleRate);
    amps.push(peakToPeakAmp);

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

export function calculateHNR(
  buffer: Float32Array,
  sampleRate: number,
  f0: number,
  periodsPerWindow = 4.5,
  minPitchHz = 75
): number {
  if (!(f0 > 0) || !(sampleRate > 0) || buffer.length < 32) return NaN;

  const nWin = Math.min(buffer.length, Math.floor((periodsPerWindow / minPitchHz) * sampleRate));
  const T0 = sampleRate / f0;
  if (nWin < 3 * T0) return NaN;

  const minLag = Math.max(2, Math.floor(0.75 * T0));
  const maxLag = Math.min(nWin - 2, Math.ceil(1.25 * T0));
  if (maxLag - minLag < 3) return NaN;

  const w = new Float64Array(nWin);
  const xw = new Float64Array(nWin);
  let mean = 0;
  for (let i = 0; i < nWin; i++) mean += buffer[i] ?? 0;
  mean /= nWin;
  let rxw0 = 0;
  let rw0 = 0;
  for (let i = 0; i < nWin; i++) {
    const wi = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (nWin + 1));
    w[i] = wi;
    const v = ((buffer[i] ?? 0) - mean) * wi;
    xw[i] = v;
    rxw0 += v * v;
    rw0 += wi * wi;
  }
  if (rxw0 <= 1e-15) return NaN;

  const r = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sx = 0;
    let sw = 0;
    for (let i = 0; i < nWin - lag; i++) {
      sx += (xw[i] ?? 0) * (xw[i + lag] ?? 0);
      sw += (w[i] ?? 0) * (w[i + lag] ?? 0);
    }
    const rw = sw / rw0;
    r[lag] = rw > 1e-9 ? sx / rxw0 / rw : 0;
  }

  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if ((r[lag] ?? 0) > best) {
      best = r[lag] ?? 0;
      bestLag = lag;
    }
  }

  let strength = best;
  if (bestLag > minLag && bestLag < maxLag) {
    strength = parabolicVertex(r[bestLag - 1] ?? 0, r[bestLag] ?? 0, r[bestLag + 1] ?? 0).value;
  }
  if (strength > 1) strength = 1 / strength;

  if (strength <= 1e-15) return -150;
  if (strength >= 1 - 1e-15) return 150;
  return Math.round(10 * Math.log10(strength / (1 - strength)) * 10) / 10;
}

export function calculateSpectralNoise(
  analyser: AnalyserNode,
  f0: number,
  vowelFormantCutoffHz = 2000
): number {
  if (!(f0 >= 50) || !Number.isFinite(f0)) return NaN;

  const nBins = analyser.frequencyBinCount;
  const db = new Float32Array(nBins);
  analyser.getFloatFrequencyData(db);

  const nyquist = analyser.context.sampleRate / 2;
  const binHz = nyquist / nBins;
  if (f0 < 2 * binHz) return NaN;

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
  for (let i = 1; i <= belowF0Limit; i++) {
    const val = (db[i] ?? -120) - maxDb;
    noiseDbSum += val;
    noiseBinCount++;
  }

  const maxHarmonic = Math.floor(vowelFormantCutoffHz / f0);
  for (let h = 1; h < maxHarmonic; h++) {
    const hCenter = Math.round(((h + 0.5) * f0) / binHz);
    const span = Math.max(1, Math.floor((0.15 * f0) / binHz));

    for (let j = -span; j <= span; j++) {
      const idx = hCenter + j;
      if (idx > 0 && idx < nBins && idx * binHz < vowelFormantCutoffHz) {
        const val = (db[idx] ?? -120) - maxDb;
        noiseDbSum += val;
        noiseBinCount++;
      }
    }
  }

  if (noiseBinCount === 0) return NaN;
  return Math.round((noiseDbSum / noiseBinCount) * 10) / 10;
}

export function calculateSingerFormantAndSPR(
  analyser: AnalyserNode,
  f0: number = 0,
  rolloffThreshold = 0.85
): {
  sfEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  spectralCentroidHz: number;
  spectralRolloffHz: number;
} {
  const numBins = analyser.frequencyBinCount;
  const freqData = new Float32Array(numBins);
  analyser.getFloatFrequencyData(freqData);
  const nyquist = analyser.context.sampleRate / 2;
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
  if (!Number.isFinite(maxDb) || maxDb < -85) {
    return { sfEnergyDb: NaN, spr: NaN, sppFreqHz: NaN, spectralCentroidHz: NaN, spectralRolloffHz: NaN };
  }

  const powers = new Float64Array(numBins);
  let sumPower = 0;
  let sumFPower = 0;
  let sfPow = 0;
  let totalPow = 0;

  for (let i = 0; i < numBins; i++) {
    const db = Math.max(-120, freqData[i] ?? -120);
    const p = Math.pow(10, db / 10);
    const f = i * binHz;
    powers[i] = p;
    sumPower += p;
    sumFPower += f * p;

    if (f >= SF_LO && f <= SF_HI) sfPow += p;
    if (f >= TOTAL_LO && f <= TOTAL_HI) totalPow += p;
  }

  const spectralCentroidHz = sumPower > 0 ? sumFPower / sumPower : 0;

  const target = sumPower * rolloffThreshold;
  let cum = 0;
  let spectralRolloffHz = 0;
  for (let i = 0; i < numBins; i++) {
    cum += powers[i] ?? 0;
    if (cum >= target) {
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

  let maxLowDb = -Infinity;
  let maxHighDb = -Infinity;
  let sppFreqHz = 0;
  for (let i = 1; i < numBins - 1; i++) {
    const f = i * binHz;
    if (f < 50 || f > 4000) continue;
    const v = freqData[i] ?? -Infinity;
    if (!isPeak(i)) continue;
    if (f < 2000) {
      if (v > maxLowDb) maxLowDb = v;
    } else if (v > maxHighDb) {
      maxHighDb = v;
      sppFreqHz = f;
    }
  }

  if (maxLowDb === -Infinity) {
    for (let i = 0; i < numBins; i++) {
      const f = i * binHz;
      if (f >= 50 && f < 2000 && (freqData[i] ?? -Infinity) > maxLowDb) maxLowDb = freqData[i] ?? -Infinity;
    }
  }
  if (maxHighDb === -Infinity) {
    for (let i = 0; i < numBins; i++) {
      const f = i * binHz;
      if (f >= 2000 && f <= 4000 && (freqData[i] ?? -Infinity) > maxHighDb) {
        maxHighDb = freqData[i] ?? -Infinity;
        sppFreqHz = f;
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

  const minLag = Math.max(2, Math.floor(0.117 / dt));
  const maxLag = Math.min(Math.floor(N / 2), Math.ceil(0.25 / dt));

  let maxCorr = -1;
  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < N - lag; i++) {
      const v1 = detrended[i]!;
      const v2 = detrended[i + lag]!;
      r += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }
    const denom = Math.sqrt(norm1 * norm2);
    const normR = denom > 1e-9 ? r / denom : 0;
    if (normR > maxCorr) {
      maxCorr = normR;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || maxCorr < 0.28) return emptyVibrato();

  let fineLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const computeNormR = (lg: number) => {
      let r = 0, n1 = 0, n2 = 0;
      for (let i = 0; i < N - lg; i++) {
        r += detrended[i]! * detrended[i + lg]!;
        n1 += detrended[i]! * detrended[i]!;
        n2 += detrended[i + lg]! * detrended[i + lg]!;
      }
      return r / (Math.sqrt(n1 * n2) || 1);
    };
    const y1 = computeNormR(bestLag - 1);
    const y2 = maxCorr;
    const y3 = computeNormR(bestLag + 1);
    const denom = y1 - 2 * y2 + y3;
    if (Math.abs(denom) > 1e-9) {
      fineLag += Math.max(-0.5, Math.min(0.5, (0.5 * (y1 - y3)) / denom));
    }
  }

  const rateHz = 1 / (fineLag * dt);
  const rmsCents = Math.sqrt(energy0 / N);
  const extentCents = rmsCents * Math.SQRT2;
  const extentSemitones = extentCents / 100;

  const windowPer = Math.max(4, Math.round(fineLag));
  let onsetIndex = 0;
  for (let i = 0; i < N - windowPer; i++) {
    let localEnergy = 0;
    for (let k = 0; k < windowPer; k++) {
      const v = detrended[i + k]!;
      localEnergy += v * v;
    }
    const localExtent = Math.sqrt(localEnergy / windowPer) * Math.SQRT2;
    if (localExtent >= Math.min(15, extentCents * 0.45)) {
      onsetIndex = i;
      break;
    }
  }
  const onsetDelaySec = firstTime - (validEntries[0]?.t ?? firstTime) + onsetIndex * dt;
  const sinusoidality = Math.max(0, Math.min(1, maxCorr));

  const hasVibrato =
    extentCents >= 15 &&
    extentCents <= 220 &&
    rateHz >= 4.0 &&
    rateHz <= 8.2 &&
    sinusoidality >= 0.38;

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